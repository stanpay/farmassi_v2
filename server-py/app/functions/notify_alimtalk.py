"""
RPC `notify-alimtalk` — 화면에서 상태를 바꾼 뒤 알림톡을 보낸다.

주문 상태 변경은 화면이 DB 를 직접 고치므로(서버 함수를 거치지 않음) 발송만 따로 부른다.
요청 값을 그대로 믿지 않는다: 주문이 실제로 그 상태인지, 부른 사람이 그 주문을
다룰 수 있는지 서버에서 다시 본다. 회원가입은 프로필에 저장된 번호로만 보낸다.

  kind=tracking   주문 상태 packing  (송장번호가 없으면 보내지 않음)
  kind=delivered  주문 상태 completed
  kind=order_done 주문 상태 paid 이후 (보통은 입금 확정 훅이 보낸다)
  kind=signup     본인(또는 관리자가 userId 지정)
"""
from ..shared.alimtalk import notify_order, notify_signup
from ..shared.util import is_admin, is_farm_member
from .types import FnCtx, FnResult, fail, ok

REQUIRED_STATUS = {
    "tracking": {"packing"},
    "delivered": {"completed"},
    "order_done": {"paid", "packing", "shipping", "completed"},
}


async def notify_alimtalk(ctx: FnCtx) -> FnResult:
    if not ctx.user_id:
        return fail("로그인이 필요합니다.", 401)
    kind = str(ctx.body.get("kind") or "")

    if kind == "signup":
        target = str(ctx.body.get("userId") or ctx.user_id)
        if target != ctx.user_id and not await is_admin(ctx.admin, ctx.user_id):
            return fail("다른 사용자에게는 보낼 수 없습니다.", 403)
        return ok(await notify_signup(ctx.admin, target))

    if kind not in REQUIRED_STATUS:
        return fail("kind 는 order_done·tracking·delivered·signup 중 하나여야 합니다.")
    order_id = ctx.body.get("orderId")
    if not order_id:
        return fail("orderId가 필요합니다.")

    order = await ctx.admin.fetchrow(
        "select farm_id, status from public.orders where id = $1", str(order_id))
    if not order:
        return fail("주문을 찾을 수 없습니다.", 404)
    allowed = await is_admin(ctx.admin, ctx.user_id) or await is_farm_member(
        ctx.admin, ctx.user_id, str(order["farm_id"]))
    if not allowed:
        return fail("이 주문의 알림을 보낼 권한이 없습니다.", 403)
    if order["status"] not in REQUIRED_STATUS[kind]:
        return ok({"sent": False, "skipped": f"주문 상태가 {order['status']} 입니다."})

    return ok(await notify_order(ctx.admin, kind, str(order_id)))
