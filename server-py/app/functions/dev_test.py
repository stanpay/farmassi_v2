"""
RPC `dev-test` — dev 시험 도구 (DEV_TEST_TOOLS=1 인 서버에서만, 슈퍼어드민만).

실제 처리 코드를 그대로 태워서 카카오톡 탭의 단계별 시각(초)을 dev 에서 확인하기 위한 도구다.
외부와 닿는 부분만 대신한다:
  - 뱅크다: dev 에는 뱅크다 토큰이 없고, 운영과 같은 계좌라 조회하면 5분 제한으로 운영 조회를 막을 수 있다.
    → 뱅크다가 주는 거래 1건과 같은 모양을 만들어 운영과 같은 처리(process_bankda_row)에 넣는다.
  - 택배: 실제 송장이 없다. → 9999 로 시작하는 시험 번호를 등록하고, 택배사 기록(접수·배달완료)은
    delivery_tracker.TEST_EVENTS 로 흉내 낸다. 웹훅은 실제 공개 주소로 보내 받은 시각이 실제로 찍힌다.
알림톡은 그 주문 번호가 ALIMTALK_ALLOWED_PHONES 에 있을 때만 실제로 나간다.

  action=status                         → {enabled}
  action=inspect   {orderId}            → 주문 상태·받는 번호(가림)·허용 여부·기록 수
  action=reset     {orderId}            → 이 주문을 입금대기로 되돌리고 시험 기록(알림톡·시험 입금·시험 송장) 삭제
  action=deposit   {orderId, amount?, depositorName?, bankDelaySeconds?}
  action=parcel    {orderId, carrierId?} → 시험 송장 등록 (register-tracking 그대로)
  action=event     {orderId, event: pickup|delivered} → 택배사 기록 추가 + 웹훅을 실제 주소로 보냄
"""
from __future__ import annotations

import random
import re
import uuid
from datetime import datetime, timedelta, timezone

import httpx

from ..sb import sb
from ..shared import delivery_tracker
from ..shared.alimtalk import _allowed, normalize_phone
from ..shared.util import is_admin
from .register_tracking import register_tracking
from .scrape_deposits import process_bankda_row
from .types import FnCtx, FnResult, fail, ok

KST = timezone(timedelta(hours=9))
TEST_DEPOSIT_PREFIX = "DEVTEST-"
EVENT = {
    "pickup": ("AT_PICKUP", "접수", "접수 - dev 시험"),
    "delivered": ("DELIVERED", "배달완료", "배달완료 - dev 시험"),
}


def _mask(phone: str | None) -> str | None:
    digits = normalize_phone(phone)
    return f"{digits[:3]}-****-{digits[-4:]}" if digits else None


async def dev_test(ctx: FnCtx) -> FnResult:
    if str(ctx.body.get("action") or "") == "status" and not delivery_tracker.test_mode():
        # 운영 화면도 이걸 물어본다. 오류로 돌려주면 화면에 오류 알림이 뜨므로 꺼짐으로만 답한다.
        return ok({"enabled": False})
    if not delivery_tracker.test_mode():
        return fail("시험 도구가 꺼져 있습니다 (dev 서버에서만 켭니다).", 404)
    if not ctx.user_id:
        return fail("로그인이 필요합니다.", 401)
    if not await is_admin(ctx.admin, ctx.user_id):
        return fail("관리자만 사용할 수 있습니다.", 403)

    action = str(ctx.body.get("action") or "")
    if action == "status":
        return ok({"enabled": True})

    order_id = str(ctx.body.get("orderId") or "")
    order = await ctx.admin.fetchrow(
        """select o.id, o.order_no, o.status, o.farm_id, o.deposit_due_amount, o.depositor_name,
                  coalesce(o.sender_phone, p.phone, o.recipient_phone) as phone,
                  f.account_number, f.bank_name
             from public.orders o
             join public.farms f on f.id = o.farm_id
             left join public.profiles p on p.id = o.customer_id
            where o.id = $1""", order_id) if order_id else None
    if not order:
        return fail("주문을 골라 주세요.")

    if action == "inspect":
        logs = await ctx.admin.fetch(
            "select kind, count(*) as n from public.alimtalk_logs where order_id = $1 group by kind",
            order_id)
        shipment = await ctx.admin.fetchrow(
            """select tracking_number, started_at, delivered_at from public.shipments
                where order_id = $1 and status <> 'cancelled' order by updated_at desc limit 1""", order_id)
        phone = normalize_phone(order["phone"])
        return ok({
            "orderNo": order["order_no"], "status": order["status"],
            "phone": _mask(order["phone"]), "alimtalkAllowed": bool(phone and _allowed(phone)),
            "amount": int(order["deposit_due_amount"] or 0), "depositorName": order["depositor_name"],
            "farmAccount": bool(re.sub(r"\D", "", order["account_number"] or "")),
            "logs": {r["kind"]: r["n"] for r in logs},
            "shipment": dict(shipment) if shipment else None,
        })

    if action == "reset":
        async with ctx.admin.transaction():
            await ctx.admin.execute(
                "delete from public.alimtalk_logs where order_id = $1"
                " and kind in ('order_done', 'tracking', 'delivered')", order_id)
            await ctx.admin.execute(
                "delete from public.deposit_transactions where matched_order_id = $1"
                " and external_id like $2", order_id, f"{TEST_DEPOSIT_PREFIX}%")
            await ctx.admin.execute(
                "delete from public.shipments where order_id = $1 and tracking_number like $2",
                order_id, f"{delivery_tracker.TEST_PREFIX}%")
            await ctx.admin.execute(
                """update public.orders set status = 'pending_deposit', deposit_confirmed_at = null,
                          paid_at = null, completed_at = null where id = $1""", order_id)
        return ok({"reset": True})

    if action == "deposit":
        if order["status"] != "pending_deposit":
            return fail("입금대기 주문만 시험 입금할 수 있습니다. 먼저 '처음 상태로'를 누르세요.")
        account = re.sub(r"\D", "", order["account_number"] or "")
        if not account:
            return fail("이 농가에 입금 계좌가 없어 대사할 수 없습니다.")
        delay = max(0, min(int(ctx.body.get("bankDelaySeconds") or 0), 3600))
        occurred = datetime.now(KST) - timedelta(seconds=delay)
        row = {
            "bkcode": f"{TEST_DEPOSIT_PREFIX}{uuid.uuid4().hex[:12]}",
            "bkdate": occurred.strftime("%Y%m%d"), "bktime": occurred.strftime("%H%M%S"),
            "bkinput": int(ctx.body.get("amount") or order["deposit_due_amount"] or 0),
            "bkjukyo": str(ctx.body.get("depositorName") or order["depositor_name"] or ""),
            "accountnum": account, "bkname": order["bank_name"] or "",
            "dev_test": True,
        }
        db = sb(ctx.admin)
        farm = {"id": str(order["farm_id"]), "name": None}
        name = await ctx.admin.fetchval("select name from public.farms where id = $1", order["farm_id"])
        farm["name"] = name
        outcome = await process_bankda_row(ctx.admin, db, row, {account: farm})
        return ok({"deposit": outcome.get("result"), "matched": outcome.get("matched", False)})

    if action == "parcel":
        number = delivery_tracker.TEST_PREFIX + "".join(random.choice("0123456789") for _ in range(9))
        carrier = str(ctx.body.get("carrierId") or "kr.epost")
        return await register_tracking(FnCtx(
            user_id=ctx.user_id, admin=ctx.admin,
            body={"orderId": order_id, "carrierId": carrier, "trackingNumber": number}))

    if action == "event":
        kind = str(ctx.body.get("event") or "")
        if kind not in EVENT:
            return fail("event 는 pickup 또는 delivered 입니다.")
        shipment = await ctx.admin.fetchrow(
            """select carrier_id, tracking_number from public.shipments
                where order_id = $1 and status = 'registered' and tracking_number like $2
                order by created_at desc limit 1""", order_id, f"{delivery_tracker.TEST_PREFIX}%")
        if not shipment:
            return fail("시험 송장이 없습니다. 먼저 '시험 송장 등록'을 누르세요.")
        code, name, description = EVENT[kind]
        events = delivery_tracker.TEST_EVENTS.setdefault(shipment["tracking_number"], [])
        if not any(e["code"] == "AT_PICKUP" for e in events) and kind == "delivered":
            # 배달완료만 누르면 접수도 같이 있었던 것으로 (택배사 기록 순서대로)
            at = (datetime.now(KST) - timedelta(seconds=1)).isoformat()
            events.append({"time": at, "description": EVENT["pickup"][2], "code": "AT_PICKUP", "name": "접수"})
        events.append({"time": datetime.now(KST).isoformat(), "description": description,
                       "code": code, "name": name})
        url = delivery_tracker.webhook_url()
        if not url:
            return fail("웹훅 주소(DELIVERY_TRACKER_WEBHOOK_BASE/TOKEN)가 없습니다.")
        # 실제 공개 주소로 보낸다 — nginx·수신 처리·받은 시각이 운영과 같은 길을 탄다.
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(url, json={"carrierId": shipment["carrier_id"],
                                                    "trackingNumber": shipment["tracking_number"]})
        return ok({"webhookStatus": response.status_code, "trackingNumber": shipment["tracking_number"],
                   "event": name})

    return fail("action 은 status·inspect·reset·deposit·parcel·event 중 하나입니다.")
