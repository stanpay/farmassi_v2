from ..sb import sb
from ..shared.push import notify_farm_members
from ..shared.util import is_admin, is_farm_member, now_iso
from .types import FnCtx, FnResult, fail, ok


async def confirm_deposit(ctx: FnCtx) -> FnResult:
    if not ctx.user_id:
        return fail("로그인이 필요합니다.", 401)
    if not ctx.body.get("orderId"):
        return fail("orderId가 필요합니다.")

    db = sb(ctx.admin)
    provider = ctx.body.get("provider") or "manual"
    order = (await db.from_("orders").select("*").eq("id", ctx.body["orderId"]).maybe_single()).data
    if not order:
        return fail("주문을 찾을 수 없습니다.", 404)
    if order["status"] != "pending_deposit":
        return fail("입금 대기 주문이 아닙니다.")

    allowed = await is_admin(ctx.admin, ctx.user_id) or await is_farm_member(
        ctx.admin, ctx.user_id, order["farm_id"]
    )
    if not allowed:
        return fail("이 주문의 입금을 확인할 권한이 없습니다.", 403)

    update = await db.from_("orders").update({
        "status": "paid",
        "deposit_confirmed_at": now_iso(),
        "deposit_confirmed_by": ctx.user_id,
        "deposit_provider": provider,
    }).eq("id", order["id"])
    if update.error:
        return fail(update.error["message"])

    await db.from_("deposit_transactions").insert({
        "farm_id": order["farm_id"],
        "provider": provider,
        "occurred_at": now_iso(),
        "amount": order["deposit_due_amount"],
        "depositor_name": order["deposit_code"],
        "raw_payload": {"source": "confirm-deposit", "by": ctx.user_id},
        "matched_order_id": order["id"],
        "match_status": "matched",
    })

    await notify_farm_members(
        ctx.admin,
        farm_id=order["farm_id"],
        order_id=order["id"],
        type_="deposit_confirmed",
        title="입금 확인됨, 출고 준비",
        body=f"{order['order_no']} 입금이 확인되었습니다. 포장을 시작해주세요.",
    )
    return ok()
