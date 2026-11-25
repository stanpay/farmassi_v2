"""
RPC `register-tracking` — 송장번호 직접 등록 (관리자 송장 탭 '직접 등록').

  {orderId, carrierId, trackingNumber} → shipments 에 status 'registered' 로 저장

- 주문 상태가 입금완료면 '송장 발급 완료'(packing)로 바꾼다. 알림톡은 여기서 보내지 않는다.
  배송시작 알림톡은 Delivery Tracker 에 택배사 기록(접수)이 뜰 때 서버가 보낸다
  (shared/shipping_tracking.py). 키가 있으면 등록 직후 한 번 바로 조회해 본다.
- 이미 등록한 번호가 있으면 새 번호로 바꾼다(오타 정정). 접수 처리는 처음부터 다시 본다.
- 슈퍼어드민 또는 그 농가 멤버만.
"""
from __future__ import annotations

import re

from ..shared import delivery_tracker
from ..shared.shipping_tracking import check_one, ensure_webhook
from ..shared.util import is_admin, is_farm_member
from .types import FnCtx, FnResult, fail, ok

ALLOWED_ORDER_STATUS = {"paid", "packing", "shipping"}


async def register_tracking(ctx: FnCtx) -> FnResult:
    if not ctx.user_id:
        return fail("로그인이 필요합니다.", 401)
    order_id = str(ctx.body.get("orderId") or "")
    carrier_id = str(ctx.body.get("carrierId") or "")
    number = re.sub(r"[\s-]", "", str(ctx.body.get("trackingNumber") or ""))
    if not order_id:
        return fail("주문을 골라 주세요.")
    if carrier_id not in delivery_tracker.CARRIERS:
        return fail("택배사를 골라 주세요.")
    if not re.fullmatch(r"\d{9,14}", number):
        return fail("송장번호는 숫자 9~14자리입니다.")

    order = await ctx.admin.fetchrow(
        "select id, farm_id, status, order_no from public.orders where id = $1", order_id)
    if not order:
        return fail("주문을 찾을 수 없습니다.", 404)
    allowed = await is_admin(ctx.admin, ctx.user_id) or await is_farm_member(
        ctx.admin, ctx.user_id, str(order["farm_id"]))
    if not allowed:
        return fail("이 주문의 송장을 등록할 권한이 없습니다.", 403)
    if order["status"] not in ALLOWED_ORDER_STATUS:
        return fail(f"이 주문은 송장을 등록할 수 없는 상태입니다 ({order['status']}).")

    provider = delivery_tracker.CARRIERS[carrier_id]["provider"]
    async with ctx.admin.transaction():
        # 한 주문에 살아 있는 송장은 하나: 기존 것(초안 포함)을 고쳐 쓰고, 없으면 만든다.
        existing = await ctx.admin.fetchrow(
            """select id from public.shipments where order_id = $1 and status <> 'cancelled'
                order by updated_at desc limit 1 for update""", order_id)
        if existing:
            shipment_id = await ctx.admin.fetchval(
                """update public.shipments
                      set provider = $2, carrier_id = $3, tracking_number = $4, status = 'registered',
                          registered_by = $5, requested_at = now(), updated_at = now(),
                          started_at = null, tracker_status = null, tracker_status_name = null,
                          tracker_description = null, tracker_event_at = null,
                          tracker_checked_at = null, tracker_check_count = 0, tracker_error = null,
                          tracker_first_event_at = null, started_via = null, started_webhook_at = null,
                          delivered_at = null, delivered_via = null, delivered_webhook_at = null,
                          tracker_delivered_event_at = null, tracker_webhook_expires_at = null,
                          tracker_webhook_error = null, tracker_webhook_tried_at = null,
                          tracker_webhook_last_at = null
                    where id = $1 returning id""",
                existing["id"], provider, carrier_id, number, ctx.user_id)
        else:
            shipment_id = await ctx.admin.fetchval(
                """insert into public.shipments
                     (order_id, provider, carrier_id, tracking_number, status, registered_by,
                      requested_at, request_payload, response_payload)
                   values ($1, $2, $3, $4, 'registered', $5, now(), '{}'::jsonb, '{}'::jsonb)
                   returning id""",
                order_id, provider, carrier_id, number, ctx.user_id)
        if order["status"] == "paid":
            await ctx.admin.execute(
                "update public.orders set status = 'packing' where id = $1", order_id)

    tracked = "not_configured"
    webhook = "not_configured"
    if delivery_tracker.configured():
        row = await ctx.admin.fetchrow(
            """select id, carrier_id, tracking_number, requested_at, created_at,
                      started_at, delivered_at
                 from public.shipments where id = $1""", shipment_id)
        # 웹훅을 걸고(접수되면 Delivery Tracker 가 알려 줌), 바로 한 번 조회해 본다.
        # 둘 다 덤이다. 실패해도 등록은 이미 저장됐고, 루프가 다시 걸고 다시 본다.
        try:
            webhook = await ensure_webhook(ctx.admin, row)
        except Exception as error:  # noqa: BLE001
            print("등록 직후 웹훅 등록 실패", shipment_id, error)
            webhook = "error"
        try:
            tracked = await check_one(ctx.admin, row, via="register")
        except Exception as error:  # noqa: BLE001
            print("등록 직후 배송 조회 실패", shipment_id, error)
            tracked = "error"
    return ok({"shipmentId": str(shipment_id), "orderNo": order["order_no"],
               "trackingNumber": number, "tracked": tracked, "webhook": webhook})
