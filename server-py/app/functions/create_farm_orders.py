"""
농가가 카톡 주문을 붙여 넣어 '직접 추가' 한 주문을 저장한다.

손님 주문(create-order)과 다른 점
- 손님이 없다. customer_id 는 비우고, 넣은 사람을 created_by·created_by_name 에 남긴다.
- 여러 건을 한 번에 넣는다. 중간에 하나라도 틀리면 **한 건도 넣지 않는다** —
  일부만 들어가면 농가가 어디까지 들어갔는지 다시 맞춰 봐야 한다.
- 알림·메일을 보내지 않는다. 넣은 사람이 이미 알고 있다.
- 비활성 농가도 넣을 수 있다. 스토어를 닫아 둔 채 카톡으로만 주문을 받는 농가가 있다.

금액은 create-order 와 같이 프론트 값을 믿지 않고 DB 의 상품가·배송비 구간표로 다시 계산한다.
"""
import re

from ..sb import sb
from ..shared.shipping_fee import fee_for
from ..shared.util import is_admin, is_farm_member, random_code, seoul_date_compact
from .types import FnCtx, FnResult, fail, ok

MAX_ORDERS = 50


class _Invalid(Exception):
    """한 건이라도 틀리면 트랜잭션을 되돌리고 이 메시지를 돌려준다."""


def _text(value) -> str:
    return str(value or "").strip()


def _quantity(value) -> int:
    """정수나 숫자 문자열만 받는다. 2.5·'2개' 같은 값은 0 으로 본다."""
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    text = _text(value)
    return int(text) if text.isdigit() else 0


async def create_farm_orders(ctx: FnCtx) -> FnResult:
    if not ctx.user_id:
        return fail("로그인이 필요합니다.", 401)

    body = ctx.body or {}
    farm_id = _text(body.get("farmId"))
    orders = body.get("orders")
    if not farm_id or not isinstance(orders, list) or not orders:
        return fail("farmId 와 orders 가 필요합니다.")
    if len(orders) > MAX_ORDERS:
        return fail(f"한 번에 {MAX_ORDERS}건까지 넣을 수 있습니다.")

    db = sb(ctx.admin)
    farm = (await db.from_("farms").select("id, name").eq("id", farm_id).maybe_single()).data
    if not farm:
        return fail("농가를 찾을 수 없습니다.", 404)

    allowed = await is_admin(ctx.admin, ctx.user_id) or await is_farm_member(
        ctx.admin, ctx.user_id, farm_id
    )
    if not allowed:
        return fail("이 농가에 주문을 추가할 권한이 없습니다.", 403)

    profile = (await db.from_("profiles").select("display_name")
               .eq("id", ctx.user_id).maybe_single()).data or {}
    created_by_name = _text(profile.get("display_name")) or None

    product_ids = sorted({
        _text(item.get("productId"))
        for order in orders if isinstance(order, dict)
        for item in (order.get("items") or []) if isinstance(item, dict)
    } - {""})
    products: list[dict] = []
    if product_ids:
        products = (await db.from_("products").select("*")
                    .eq("farm_id", farm_id).eq("sale_status", "on_sale")
                    .in_("id", product_ids)).data or []
    by_id = {p["id"]: p for p in products}

    created: list[dict] = []
    try:
        async with ctx.admin.transaction():
            for index, order in enumerate(orders, start=1):
                created.append(await _insert_one(db, farm_id, order, index, by_id,
                                                 ctx.user_id, created_by_name))
    except _Invalid as error:
        return fail(str(error))
    except RuntimeError as error:
        return fail(str(error) or "주문 저장에 실패했습니다.", 500)

    return ok({"orders": created})


async def _insert_one(db, farm_id: str, order, index: int, by_id: dict,
                      user_id: str, created_by_name: str | None) -> dict:
    if not isinstance(order, dict):
        raise _Invalid(f"{index}번 주문 형식이 올바르지 않습니다.")
    recipient = order.get("recipient") or {}
    sender = order.get("sender") or {}
    name = _text(recipient.get("name"))
    phone = _text(recipient.get("phone"))
    address = _text(recipient.get("address"))
    if not (name and phone and address):
        raise _Invalid(f"{index}번 주문에 받는 분 이름·연락처·주소가 모두 있어야 합니다.")
    # 우체국으로 확정한 주소만 받는다 (확정하면 5자리 우편번호가 붙는다). 화면·챗봇 검수를 건너뛴 요청을 막는다.
    if not re.fullmatch(r"\d{5}", _text(recipient.get("zonecode"))):
        raise _Invalid(f"{index}번 주문 주소가 확정되지 않았습니다. 우체국 검색으로 주소를 골라 주세요.")

    items = order.get("items") or []
    if not isinstance(items, list) or not items:
        raise _Invalid(f"{index}번 주문에 상품이 없습니다.")

    lines = []
    for item in items:
        product = by_id.get(_text((item or {}).get("productId")))
        qty = _quantity((item or {}).get("quantity"))
        if not product:
            raise _Invalid(f"{index}번 주문: 이 농가에서 판매 중인 상품을 골라 주세요.")
        if qty < 1:
            raise _Invalid(f"{index}번 주문: 수량은 1 이상이어야 합니다.")
        lines.append({
            "product_id": product["id"],
            "product_name": product["name"],
            "unit": product["unit"],
            "unit_price": product["price"],
            "quantity": qty,
            "line_amount": product["price"] * qty,
            "shipping_fee": fee_for(product.get("shipping_fees"), qty),
        })

    shipping_total = sum(line["shipping_fee"] for line in lines)
    total = sum(line["line_amount"] for line in lines) + shipping_total
    order_no = f"FA{seoul_date_compact()}-{random_code(4)}"

    inserted = await db.from_("orders").insert({
        "order_no": order_no,
        "farm_id": farm_id,
        "customer_id": None,
        "source": "farm_manual",
        "created_by": user_id,
        "created_by_name": created_by_name,
        "status": "pending_deposit",
        "recipient_name": name,
        "recipient_phone": phone,
        "zonecode": _text(recipient.get("zonecode")) or None,
        "address": address,
        "address_detail": _text(recipient.get("addressDetail")) or None,
        "request_memo": _text(order.get("requestMemo")) or None,
        # 입금자명이 없으면 보내는 분, 그것도 없으면 받는 분 — 화면의 규칙과 같다.
        "depositor_name": (_text(sender.get("depositorName"))
                           or _text(sender.get("name")) or name),
        "sender_name": _text(sender.get("name")) or None,
        "sender_phone": _text(sender.get("phone")) or None,
        "total_amount": total,
        "shipping_fee": shipping_total,
        "deposit_due_amount": total,
        "deposit_code": random_code(6),
    }).select("id, order_no").single()
    if inserted.error or not inserted.data:
        raise RuntimeError((inserted.error or {}).get("message") or "주문 저장에 실패했습니다.")

    items_result = await db.from_("order_items").insert(
        [{**line, "order_id": inserted.data["id"]} for line in lines])
    if items_result.error:
        raise RuntimeError(items_result.error["message"])

    return {"id": inserted.data["id"], "orderNo": inserted.data["order_no"], "total": total}
