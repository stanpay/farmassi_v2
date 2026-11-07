from ..sb import sb
from ..shared.push import notify_farm_members
from ..shared.util import is_admin, is_farm_member, now_iso
from .types import FnCtx, FnResult, fail, ok


async def match_deposit(ctx: FnCtx) -> FnResult:
    """
    입금 내역을 주문에 손으로 붙이거나 떼어낸다.

    자동 대사는 금액이 정확히 같아야 하고 입금자명이 다르면 붙이지 않는다.
    "김철수" 로 주문했는데 "고길동" 이 입금한 경우가 그렇다. 그런 건을 사람이
    확인하고 연결할 수 있어야 한다.

    action:
      match   depositId + orderId  → 주문을 결제완료로, 입금을 matched 로
      unmatch depositId            → 연결을 끊고 주문을 다시 입금대기로
      ignore  depositId            → 주문과 무관한 입금으로 표시
    """
    if not ctx.user_id:
        return fail("로그인이 필요합니다.", 401)

    db = sb(ctx.admin)
    action = str(ctx.body.get("action") or "match")
    deposit_id = str(ctx.body.get("depositId") or "")
    if not deposit_id:
        return fail("depositId 가 필요합니다.")

    deposit = (await db.from_("deposit_transactions").select("*")
               .eq("id", deposit_id).maybe_single()).data
    if not deposit:
        return fail("입금 내역을 찾을 수 없습니다.", 404)

    admin_user = await is_admin(ctx.admin, ctx.user_id)

    async def can_manage_farm(farm_id: str | None) -> bool:
        if admin_user:
            return True
        if not farm_id:
            return False
        return await is_farm_member(ctx.admin, ctx.user_id, farm_id)

    if action == "ignore":
        if not await can_manage_farm(deposit.get("farm_id")):
            return fail("이 입금을 처리할 권한이 없습니다.", 403)
        await db.from_("deposit_transactions").update(
            {"match_status": "ignored", "matched_order_id": None}).eq("id", deposit_id)
        return ok({"action": action, "depositId": deposit_id})

    if action == "unmatch":
        if not await can_manage_farm(deposit.get("farm_id")):
            return fail("이 입금을 처리할 권한이 없습니다.", 403)
        if deposit["matched_order_id"]:
            # 사람이 되돌리는 것이므로 주문도 입금대기로 돌린다.
            await db.from_("orders").update({
                "status": "pending_deposit",
                "deposit_confirmed_at": None,
                "deposit_confirmed_by": None,
                "deposit_provider": None,
            }).eq("id", deposit["matched_order_id"]).eq("status", "paid")
        await db.from_("deposit_transactions").update(
            {"match_status": "unmatched", "matched_order_id": None}).eq("id", deposit_id)
        return ok({"action": action, "depositId": deposit_id})

    order_id = str(ctx.body.get("orderId") or "")
    if not order_id:
        return fail("연결할 주문을 선택하세요.")

    order = (await db.from_("orders")
             .select("id, order_no, farm_id, status, deposit_due_amount")
             .eq("id", order_id).maybe_single()).data
    if not order:
        return fail("주문을 찾을 수 없습니다.", 404)
    if order["status"] != "pending_deposit":
        return fail("입금 대기 주문이 아닙니다.")

    if not await can_manage_farm(order["farm_id"]):
        return fail("이 주문의 입금을 처리할 권한이 없습니다.", 403)
    if deposit.get("farm_id") and deposit["farm_id"] != order["farm_id"] and not admin_user:
        return fail("다른 농가의 입금은 연결할 수 없습니다.", 403)

    # 이미 다른 입금이 붙어 있는 주문인지 확인한다.
    already = (await db.from_("deposit_transactions").select("id")
               .eq("matched_order_id", order_id).eq("match_status", "matched")
               .maybe_single()).data
    if already:
        return fail("이 주문에는 이미 다른 입금이 연결돼 있습니다.")

    updated = (await db.from_("orders").update({
        "status": "paid",
        "deposit_confirmed_at": now_iso(),
        "deposit_confirmed_by": ctx.user_id,
        "deposit_provider": deposit["provider"],
    }).eq("id", order_id).eq("status", "pending_deposit")
        .select("id, order_no, farm_id")).data or []

    saved = updated[0] if updated else None
    if not saved:
        return fail("주문 상태를 바꾸지 못했습니다.")

    await db.from_("deposit_transactions").update({
        "matched_order_id": order_id,
        "match_status": "matched",
        "farm_id": deposit["farm_id"] or saved["farm_id"],
        "raw_payload": {**(deposit["raw_payload"] or {}),
                        "matched_by": ctx.user_id, "matched_manually": True},
    }).eq("id", deposit_id)

    await notify_farm_members(
        ctx.admin,
        farm_id=saved["farm_id"],
        order_id=saved["id"],
        type_="deposit_confirmed",
        title="입금 확인됨, 출고 준비",
        body=f"{saved['order_no']} 입금이 확인되었습니다. 포장을 시작해주세요.",
    )

    return ok({
        "action": action,
        "depositId": deposit_id,
        "orderNo": saved["order_no"],
        "amountMatches": int(deposit["amount"]) == int(order["deposit_due_amount"]),
    })
