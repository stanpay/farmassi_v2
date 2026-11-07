import re
from datetime import datetime, timedelta, timezone

from ..sb import sb
from ..shared.mailer import send_order_mail
from ..shared.push import notify_farm_members
from ..shared.shipping_fee import fee_for
from ..shared.util import now_iso, random_code, seoul_date_compact
from .types import FnCtx, FnResult, fail, ok

_KST = timezone(timedelta(hours=9))


def _normalize(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


async def create_order(ctx: FnCtx) -> FnResult:
    if not ctx.user_id:
        return fail("로그인이 필요합니다.", 401)
    body = ctx.body
    recipient = body.get("recipient") or {}
    sender = body.get("sender") or {}
    if not (body.get("farmId") and body.get("items") and recipient.get("name")
            and recipient.get("phone") and recipient.get("address")):
        return fail("주문 정보가 올바르지 않습니다.")

    db = sb(ctx.admin)
    farm = (await db.from_("farms").select("*").eq("id", body["farmId"]).maybe_single()).data
    if not farm:
        return fail("농가를 찾을 수 없습니다.", 404)
    # 비활성 농가는 화면은 열려 있지만 주문은 받지 않는다.
    # "찾을 수 없다" 고 하면 사용자가 주소를 잘못 눌렀다고 오해한다.
    if not farm["is_active"]:
        return fail("이 농가는 지금 주문을 받지 않습니다.", 409)

    products = (await db.from_("products").select("*")
                .eq("farm_id", farm["id"]).eq("sale_status", "on_sale")
                .in_("id", [item["productId"] for item in body["items"]])).data or []

    by_id = {p["id"]: p for p in products}
    lines = []
    for item in body["items"]:
        product = by_id.get(item["productId"])
        if not product or item["quantity"] < 1:
            raise Exception("판매 중인 상품만 주문할 수 있습니다.")
        # 배송비는 수량에 비례하지 않는다. 상품마다 정해 둔 구간표에서 뽑는다.
        shipping = fee_for(product.get("shipping_fees"), item["quantity"])
        lines.append({
            "product_id": product["id"],
            "product_name": product["name"],
            "unit": product["unit"],
            "unit_price": product["price"],
            "quantity": item["quantity"],
            "line_amount": product["price"] * item["quantity"],
            "shipping_fee": shipping,
        })
    goods = sum(line["line_amount"] for line in lines)
    shipping_total = sum(line["shipping_fee"] for line in lines)
    # 손님이 실제로 보낼 금액. deposit_due_amount 가 자동 대사의 기준이라
    # 배송비까지 더한 값이어야 한다.
    total = goods + shipping_total
    deposit_code = random_code(6)
    order_no = f"FA{seoul_date_compact()}-{random_code(4)}"

    # 손님이 고른 출고일.
    #
    # 형식과 과거 여부만 본다. 요일·정지 규칙까지 서버에서 다시 계산하려면
    # 공휴일과 정지 구간을 또 한 벌 들고 있어야 하고, 그 규칙이 화면과
    # 어긋나면 손님이 고를 수 있던 날짜가 거부된다. 잘못 고른 날짜는
    # 송장 화면에서 사람이 본다.
    raw_ship = (body.get("requestedShipDate") or "").strip()
    requested_ship = None
    if raw_ship:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw_ship):
            return fail("출고일 형식이 올바르지 않습니다.")
        if raw_ship < datetime.now(_KST).strftime('%Y-%m-%d'):
            return fail("지난 날짜로는 출고할 수 없습니다.")
        requested_ship = raw_ship

    order_result = await db.from_("orders").insert({
        "order_no": order_no,
        "farm_id": farm["id"],
        "customer_id": ctx.user_id,
        "status": "pending_deposit",
        "recipient_name": recipient["name"],
        "recipient_phone": recipient["phone"],
        "zonecode": recipient.get("zonecode"),
        "address": recipient["address"],
        "address_detail": recipient.get("addressDetail"),
        "request_memo": body.get("requestMemo"),
        # 손님이 적은 입금자명. 없으면 수령인 이름으로 둔다 — 자동 대사가
        # 후보를 넓게 잡을 수 있게 하려는 것이다.
        "depositor_name": (sender.get("depositorName") or "").strip() or recipient["name"],
        "sender_name": (sender.get("name") or "").strip() or None,
        "sender_phone": (sender.get("phone") or "").strip() or None,
        "sender_address": (sender.get("address") or "").strip() or None,
        "sender_zonecode": (sender.get("zonecode") or "").strip() or None,
        "sender_address_detail": (sender.get("addressDetail") or "").strip() or None,
        "total_amount": total,
        "shipping_fee": shipping_total,
        "deposit_due_amount": total,
        "deposit_code": deposit_code,
        "requested_ship_date": requested_ship,
    }).select("id").single()
    if order_result.error or not order_result.data:
        return fail((order_result.error or {}).get("message") or "주문 생성에 실패했습니다.")
    order = order_result.data

    items_result = await db.from_("order_items").insert(
        [{**line, "order_id": order["id"]} for line in lines])
    if items_result.error:
        return fail(items_result.error["message"])

    saved_rows = (await db.from_("saved_addresses")
                  .select("id, address, address_detail, zonecode")
                  .eq("user_id", ctx.user_id)).data or []
    same = next((row for row in saved_rows
                 if _normalize(row["address"]) == _normalize(recipient["address"])
                 and _normalize(row["address_detail"]) == _normalize(recipient.get("addressDetail"))
                 and _normalize(row["zonecode"]) == _normalize(recipient.get("zonecode"))), None)

    saved_payload = {
        "recipient_name": recipient["name"],
        "phone": recipient["phone"],
        "zonecode": recipient.get("zonecode"),
        "address": recipient["address"],
        "address_detail": recipient.get("addressDetail"),
        "last_used_at": now_iso(),
    }
    if same:
        await db.from_("saved_addresses").update(
            {**saved_payload, "is_default": True}).eq("id", same["id"])
    elif body.get("saveAddress"):
        await db.from_("saved_addresses").insert(
            {**saved_payload, "user_id": ctx.user_id, "is_default": True})

    # 메일과 푸시를 함께 보낸다. 푸시는 브라우저 구독이 있어야 도착하는데,
    # 관리자가 구독하지 않은 채로 주문을 놓치는 일이 실제로 있었다.
    await send_order_mail(
        order_no=order_no,
        farm_name=farm["name"],
        amount=total,
        deposit_code=deposit_code,
        recipient_name=recipient["name"],
        recipient_phone=recipient["phone"],
        address=" ".join(x for x in [
            f"[{recipient['zonecode']}]" if recipient.get("zonecode") else "",
            recipient["address"], recipient.get("addressDetail") or ""] if x),
        items=[{"name": line["product_name"], "quantity": line["quantity"]} for line in lines],
        memo=body.get("requestMemo"),
    )

    await notify_farm_members(
        ctx.admin,
        farm_id=farm["id"],
        order_id=order["id"],
        type_="order_created",
        title="새 주문(입금대기)",
        body=f"{recipient['name']}님이 ₩{total:,} 주문했습니다. 입금자명 {deposit_code}",
    )
    return ok({"orderId": order["id"]})
