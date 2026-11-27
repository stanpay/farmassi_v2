"""
RPC `review-farm-orders` — 농가 「직접 추가」 주문 검수 (파싱 + 상품 매칭 + 우체국 주소 + 동·호 + 필수값).

화면(OrderCreate)과 챗봇이 같은 판정을 쓰게 하려고 서버에 둔다. 저장은 하지 않는다 —
전부 ok 가 되면 응답의 saveRequest 를 그대로 create-farm-orders 에 보낸다.
상태는 서버에 남기지 않는다. 다시 검수할 때 직전 응답의 orders 를 그대로 돌려보낸다.

  {farmId, text}                                            원문부터 전체 검수
  {farmId, action:'recheck',        orders}                 전부 다시 검수
  {farmId, action:'select_address', orders, targetIndex, selection:{candidateId|candidateNo, addressDetail?}}
  {farmId, action:'patch_order',    orders, targetIndex, patch:{address?, addressDetail?, recipientName?, phone?,
                                     senderName?, senderPhone?, depositorName?, memo?, productId?, productQuery?, quantity?}}

targetIndex 는 orders 배열의 0부터 세는 위치다 (응답의 index 는 사람에게 보이는 1부터 번호).
문서: doc/backend/orders/command/review-farm-orders.md
"""
from __future__ import annotations

import re

from ..config import config
from ..shared import order_review as rv
from ..shared.util import is_admin, is_farm_member
from .epost_address import search_epost_addresses
from .juso_building import lookup_building
from .match_farm_products import match_farm_products_with_claude
from .parse_order_messages import parse_order_messages_text
from .types import FnCtx, FnResult, fail, ok

MAX_ORDERS = 50
MAX_TEXT = 20_000
MAX_FIELD = 500
TEXT_FIELDS = ("recipientName", "phone", "zonecode", "address", "addressDetail", "addressRaw", "addressToken",
               "productId", "productQuery", "senderName", "senderPhone", "depositorName", "memo", "raw")
PATCH_TEXT = ("address", "addressDetail", "recipientName", "phone", "senderName", "senderPhone",
              "depositorName", "memo", "productId", "productQuery")
STATUS_ORDER = ("needs_address_select", "needs_address_fix", "needs_product_select", "needs_field_fix")


def _text(value, limit: int = MAX_FIELD) -> str:
    return str(value if value is not None else "").strip()[:limit]


def _quantity(value) -> int:
    digits = re.sub(r"\D", "", str(value if value is not None else ""))
    return max(1, int(digits[:4])) if digits else 1


def _clean(order) -> dict:
    """클라이언트가 돌려보낸 주문에서 아는 칸만 받는다. 판정(status·errors)은 받지 않는다."""
    src = order.get("fields") if isinstance(order, dict) and isinstance(order.get("fields"), dict) else order
    src = src if isinstance(src, dict) else {}
    fields = {key: _text(src.get(key), 2000 if key == "raw" else MAX_FIELD) for key in TEXT_FIELDS}
    fields["quantity"] = _quantity(src.get("quantity"))
    return fields


def _from_parsed(order: dict) -> dict:
    """parse-order-messages 결과 → 검수 칸 (화면 toDraftOrder 와 같은 정리)."""
    raw = order.get("raw") or ""
    highlight = order.get("highlight") or {}
    address, detail = rv.normalize_address_parts(order.get("address", ""), order.get("addressDetail", ""))
    span = (rv.find_address_span_text(raw, order.get("address", ""), order.get("addressDetail", ""))
            or rv.find_address_span_text(raw, address, detail))
    address_raw = span if len(span) > len(highlight.get("address") or "") else (highlight.get("address") or "")
    return {
        "recipientName": _text(order.get("recipientName")),
        "phone": _text(order.get("phone")),
        "zonecode": "", "addressToken": "",
        "address": address, "addressDetail": detail, "addressRaw": _text(address_raw),
        "productId": "",
        "productQuery": _text(order.get("product")) or _text(highlight.get("product")),
        "quantity": _quantity(order.get("quantity")),
        "senderName": _text(order.get("senderName")),
        "senderPhone": _text(order.get("senderPhone")),
        "depositorName": _text(order.get("depositorName")),
        "memo": _text(order.get("memo")),
        "raw": _text(raw, 2000),
    }


def _field_errors(fields: dict) -> list[dict]:
    """필수값·전화 형식. 고칠 수 있는 값은 정규화해 fields 에 다시 넣는다 (REQUIRED_FIELD_ERRORS 와 같은 문구)."""
    errors = []
    if not fields["recipientName"]:
        errors.append({"field": "recipientName", "code": "REQUIRED", "message": "수령인 이름이 비어 있습니다."})
    if not fields["phone"]:
        errors.append({"field": "phone", "code": "REQUIRED", "message": "연락처가 비어 있습니다."})
    else:
        normalized = rv.normalize_phone(fields["phone"])
        if normalized:
            fields["phone"] = normalized
        else:
            errors.append({"field": "phone", "code": "INVALID_PHONE", "message": "연락처 형식을 확인해 주세요."})
    if fields["senderPhone"]:
        normalized = rv.normalize_phone(fields["senderPhone"])
        if normalized:
            fields["senderPhone"] = normalized
        else:
            errors.append({"field": "senderPhone", "code": "INVALID_PHONE",
                           "message": "보내는분 연락처 형식을 확인해 주세요."})
    return errors


async def _resolve_products(rows: list[dict], catalog: list[dict], use_claude: list[bool]) -> None:
    """productId 가 판매 중 상품이 아니면 비우고, 로컬 매칭 → (허용된 건만) Claude 매칭."""
    by_id = {p["id"]: p for p in catalog}
    unresolved = []
    for i, fields in enumerate(rows):
        if fields["productId"] in by_id:
            continue
        fields["productId"] = ""
        hit = rv.match_farm_product(fields["productQuery"], catalog)
        if hit:
            fields["productId"] = hit["id"]
        elif use_claude[i] and fields["productQuery"]:
            unresolved.append(i)
    if unresolved and catalog:
        try:
            ids = await match_farm_products_with_claude(
                [rows[i]["productQuery"] for i in unresolved],
                [{"id": p["id"], "name": p["name"]} for p in catalog])
            for i, product_id in zip(unresolved, ids):
                if product_id in by_id:
                    rows[i]["productId"] = product_id
        except Exception:  # noqa: BLE001 — 매칭 실패는 상품 선택으로 넘긴다 (화면과 같다)
            pass


def _save_order(fields: dict) -> dict:
    """create-farm-orders 요청 한 건. 입금자명은 입금자 → 보내는분 → 받는분 (resolveDepositorName)."""
    return {
        "recipient": {"name": fields["recipientName"], "phone": fields["phone"], "zonecode": fields["zonecode"],
                      "address": fields["address"], "addressDetail": fields["addressDetail"]},
        "sender": {"name": fields["senderName"], "phone": fields["senderPhone"],
                   "depositorName": fields["depositorName"] or fields["senderName"] or fields["recipientName"]},
        "requestMemo": fields["memo"],
        "items": [{"productId": fields["productId"], "quantity": fields["quantity"]}],
    }


async def review_farm_orders(ctx: FnCtx) -> FnResult:
    if not ctx.user_id:
        return fail("로그인이 필요합니다.", 401)
    body = ctx.body or {}
    farm_id = _text(body.get("farmId"))
    if not farm_id:
        return fail("farmId 가 필요합니다.")
    farm = await ctx.admin.fetchrow("select id from public.farms where id::text = $1", farm_id)
    if not farm:
        return fail("농가를 찾을 수 없습니다.", 404)
    if not (await is_admin(ctx.admin, ctx.user_id) or await is_farm_member(ctx.admin, ctx.user_id, farm_id)):
        return fail("이 농가에 주문을 추가할 권한이 없습니다.", 403)

    catalog = [dict(r) for r in await ctx.admin.fetch(
        """select id::text as id, name, unit, price from public.products
            where farm_id = $1 and sale_status = 'on_sale'
            order by sort_order nulls last, created_at""", farm["id"])]

    action = _text(body.get("action"))
    if not action:
        text = str(body.get("text") or "")
        if len(text.strip()) < 2:
            return fail("주문 메시지(text)를 보내 주세요.")
        if len(text) > MAX_TEXT:
            return fail(f"주문 메시지는 {MAX_TEXT}자까지 받습니다.")
        try:
            parsed = await parse_order_messages_text(text)
        except Exception as error:  # noqa: BLE001
            return fail(str(error) or "주문 메시지 파싱에 실패했습니다.", 500)
        rows = [_from_parsed(o) for o in parsed["orders"]][:MAX_ORDERS]
        use_claude = [True] * len(rows)
        target = None
    elif action in ("recheck", "select_address", "patch_order"):
        incoming = body.get("orders")
        if not isinstance(incoming, list) or not incoming:
            return fail("orders 가 필요합니다. 직전 응답의 orders 를 그대로 보내 주세요.")
        if len(incoming) > MAX_ORDERS:
            return fail(f"한 번에 {MAX_ORDERS}건까지 검수합니다.")
        rows = [_clean(o) for o in incoming]
        use_claude = [False] * len(rows)
        target = None
        if action != "recheck":
            try:
                target = int(body.get("targetIndex"))
            except (TypeError, ValueError):
                target = -1
            if not 0 <= target < len(rows):
                return fail("targetIndex 는 orders 배열의 0부터 세는 위치입니다.")
        if action == "patch_order":
            patch = body.get("patch")
            if not isinstance(patch, dict) or not patch:
                return fail("patch 가 필요합니다.")
            error = _apply_patch(rows[target], patch, catalog)
            if error:
                return fail(error)
            use_claude[target] = "productQuery" in patch and "productId" not in patch
        if action == "select_address":
            selection = body.get("selection") if isinstance(body.get("selection"), dict) else {}
            original = incoming[target] if isinstance(incoming[target], dict) else {}
            error = await _apply_selection(rows[target], original, selection)
            if error:
                return fail(error)
    else:
        return fail("action 은 recheck · select_address · patch_order 중 하나이거나, 없이 text 를 보냅니다.")

    await _resolve_products(rows, catalog, use_claude)
    by_id = {p["id"]: p for p in catalog}

    async def check(fields: dict) -> dict:
        return await rv.review_address(fields, search=search_epost_addresses, lookup=lookup_building,
                                       secret=config.jwt_secret)

    addresses = await rv.gather_limited([check(fields) for fields in rows])

    out = []
    for i, (fields, address) in enumerate(zip(rows, addresses)):
        fields = address["fields"]
        errors = _field_errors(fields) + address["errors"]
        statuses = []
        if address["status"] != "ok":
            statuses.append(address["status"])
        product = by_id.get(fields["productId"])
        candidates: list[dict] = []
        if not catalog:
            errors.append({"field": "product", "code": "NO_PRODUCTS", "message": "이 농가에 판매 중인 상품이 없습니다."})
            statuses.append("needs_product_select")
        elif not product:
            query = fields["productQuery"]
            errors.append({"field": "product", "code": "UNMATCHED_PRODUCT" if query else "REQUIRED",
                           "message": "농가 상품 목록과 일치하지 않습니다." if query else "상품을 선택해 주세요."})
            candidates = rv.product_candidates(query, catalog)
            statuses.append("needs_product_select")
        if any(e["field"] not in ("address", "product") for e in errors):
            statuses.append("needs_field_fix")
        status = next((s for s in STATUS_ORDER if s in statuses), "ok")
        out.append({
            "index": i + 1,
            "status": status,
            "fields": {**fields, "productId": product["id"] if product else None,
                       "productName": product["name"] if product else "",
                       "unitPrice": int(product["price"]) if product else 0},
            "errors": errors,
            "addressCandidates": address["candidates"] if status in ("needs_address_select", "needs_address_fix") else [],
            "addressSearchQuery": address["searchQuery"],
            "productCandidates": candidates,
        })

    ready = sum(1 for o in out if o["status"] == "ok")
    response = {"orders": out, "summary": {"total": len(out), "ready": ready, "needsFix": len(out) - ready}}
    if out and ready == len(out):
        response["saveRequest"] = {"farmId": farm_id, "orders": [_save_order(o["fields"]) for o in out]}
    if action == "" and parsed.get("ignored"):
        response["ignored"] = parsed["ignored"]
    return ok(response)


def _apply_patch(fields: dict, patch: dict, catalog: list[dict]) -> str | None:
    unknown = set(patch) - set(PATCH_TEXT) - {"quantity"}
    if unknown:
        return f"고칠 수 없는 칸입니다: {', '.join(sorted(unknown))}"
    if "address" in patch:
        # 새 기본주소 — 상세는 같이 보낸 값, 없으면 새 주소에서 떼어 낸 값. 예전 확정·상세는 버린다.
        address, detail = rv.normalize_address_parts(_text(patch["address"]), _text(patch.get("addressDetail")))
        fields.update(address=address, addressDetail=detail, zonecode="", addressToken="",
                      addressRaw=" ".join(x for x in (address, detail) if x))
    elif "addressDetail" in patch:
        # 상세만 — 확정된 기본주소(서명)는 그대로 두고 동·호만 다시 본다.
        fields["addressDetail"] = _text(patch["addressDetail"])
    for key in ("recipientName", "phone", "senderName", "senderPhone", "depositorName", "memo"):
        if key in patch:
            fields[key] = _text(patch[key])
    if "quantity" in patch:
        fields["quantity"] = _quantity(patch["quantity"])
    if "productId" in patch:
        product_id = _text(patch["productId"])
        if product_id not in {p["id"] for p in catalog}:
            return "이 농가에서 판매 중인 상품이 아닙니다. productCandidates 의 id 를 보내 주세요."
        fields["productId"] = product_id
    elif "productQuery" in patch:
        fields.update(productQuery=_text(patch["productQuery"]), productId="")
    return None


async def _apply_selection(fields: dict, original: dict, selection: dict) -> str | None:
    """사용자가 고른 우체국 후보를 넣는다. 후보는 클라이언트가 돌려보낸 것이라 우체국에서 다시 확인한다."""
    candidates = original.get("addressCandidates") if isinstance(original.get("addressCandidates"), list) else []
    candidates = [c for c in candidates if isinstance(c, dict)]
    picked = None
    if selection.get("candidateId"):
        picked = next((c for c in candidates if str(c.get("id")) == str(selection["candidateId"])), None)
    elif selection.get("candidateNo") is not None:
        try:
            number = int(selection["candidateNo"])
        except (TypeError, ValueError):
            number = 0
        picked = candidates[number - 1] if 1 <= number <= len(candidates) else None
    if not picked:
        return "고른 주소 후보를 찾을 수 없습니다. 직전 응답의 addressCandidates 에서 candidateId 나 candidateNo(1부터)를 보내 주세요."
    detail = _text(selection.get("addressDetail"))

    # 이미 확정된 기본주소(동·호만 고치는 경우)를 고르면 상세만 바꾼다.
    if (rv.address_token_ok(config.jwt_secret, fields["zonecode"], fields["address"], fields["addressToken"])
            and _text(picked.get("roadAddress")) == fields["address"]):
        if detail:
            fields["addressDetail"] = detail
        return None

    query = _text(original.get("addressSearchQuery")) or rv.build_epost_search_query(_text(picked.get("roadAddress")))
    verified = None
    for q in dict.fromkeys(x for x in (query, rv.build_epost_search_query(_text(picked.get("roadAddress")))) if len(x) >= 2):
        try:
            results = await rv.search_epost(search_epost_addresses, q)
        except Exception:  # noqa: BLE001
            continue
        verified = next((r for r in results if r.get("id") == picked.get("id")
                         or (r.get("zipNo") == picked.get("zipNo") and r.get("roadAddress") == picked.get("roadAddress"))),
                        None)
        if verified:
            break
    if not verified:
        return "고른 주소를 우체국에서 다시 확인하지 못했습니다. 주소를 다시 검색해 주세요."
    selected = rv.apply_address_selection(fields, verified, detail or fields["addressDetail"])
    selected["addressToken"] = rv.address_token(config.jwt_secret, selected["zonecode"], selected["address"])
    fields.clear()
    fields.update(selected)
    return None
