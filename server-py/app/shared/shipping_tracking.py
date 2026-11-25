"""
직접 등록한 송장의 배송 추적 (Delivery Tracker).

관리자가 송장번호를 등록하면(register-tracking) 여기서 주기적으로 조회한다.
택배사 기록이 처음 뜨면(= 택배사가 접수함):
  1. 주문이 입금완료·송장 발급 완료 상태면 배송중으로 바꾼다.
  2. 배송시작(택배번호 안내) 알림톡을 보낸다. 같은 주문에는 한 번만 간다(alimtalk_logs).
  3. shipments.started_at 을 찍어 다시 처리하지 않는다.

어떤 상태 코드가 우체국 '접수'에 해당하는지 문서에 없어서, 기록이 하나라도 생기면 접수로 본다.
키가 만료·오류면(무료 요금제는 21일마다 갱신) 관리자에게 하루 한 번 알린다.
"""
from __future__ import annotations

import time
from typing import Any

import asyncpg

from . import delivery_tracker
from .alimtalk import notify_order

CHECK_EVERY_MINUTES = 10   # 같은 송장을 다시 볼 간격
GIVE_UP_DAYS = 14          # 등록 후 이 기간 안에 접수가 안 뜨면 더 보지 않는다
BATCH = 50
_AUTH_CODES = {"UNAUTHENTICATED", "FORBIDDEN"}
_last_auth_alert = 0.0


async def _alert_auth(conn: asyncpg.Connection, error: delivery_tracker.TrackerError) -> None:
    global _last_auth_alert
    if time.time() - _last_auth_alert < 86400:
        return
    _last_auth_alert = time.time()
    from .mailer import send_admin_mail
    from .push import notify_admins
    lines = [f"Delivery Tracker 조회가 거절됐습니다 ({error.code}): {error}",
             "무료 요금제 키는 21일마다 console.tracker.delivery 에서 갱신해야 합니다.",
             "갱신 전까지 송장 접수 확인과 배송시작 알림톡이 멈춥니다."]
    try:
        await send_admin_mail(subject="[팜어시] 배송 조회 키 확인 필요", lines=lines)
        await notify_admins(conn, title="배송 조회 키 확인 필요", body=lines[0], url="/admin/shipments")
    except Exception as alert_error:  # noqa: BLE001
        print("배송 조회 키 알림 실패", alert_error)


async def start_shipment(conn: asyncpg.Connection, shipment_id: str) -> dict[str, Any]:
    """접수 확인된 송장 1건 처리: 주문 배송중 + 배송시작 알림톡 + started_at."""
    row = await conn.fetchrow(
        """select s.order_id, o.status from public.shipments s
             join public.orders o on o.id = s.order_id
            where s.id = $1 and s.started_at is null""", shipment_id)
    if not row:
        return {"skipped": "이미 처리했습니다."}
    if row["status"] in ("paid", "packing"):
        await conn.execute(
            "update public.orders set status = 'shipping', updated_at = now() where id = $1",
            row["order_id"])
    result = await notify_order(conn, "tracking", str(row["order_id"]))
    await conn.execute("update public.shipments set started_at = now() where id = $1", shipment_id)
    return {"alimtalk": result}


async def check_one(conn: asyncpg.Connection, shipment: Any) -> str:
    """송장 1건 조회. 돌려주는 값: started / waiting / error / auth_error."""
    try:
        info = await delivery_tracker.track(shipment["carrier_id"], shipment["tracking_number"])
    except delivery_tracker.TrackerError as error:
        await conn.execute(
            """update public.shipments set tracker_checked_at = now(),
                      tracker_check_count = tracker_check_count + 1, tracker_error = $2
                where id = $1""", shipment["id"], f"{error.code}: {error}"[:500])
        if error.code in _AUTH_CODES:
            await _alert_auth(conn, error)
            return "auth_error"
        return "error"

    last = (info or {}).get("last") or {}
    await conn.execute(
        """update public.shipments set tracker_checked_at = now(),
                  tracker_check_count = tracker_check_count + 1, tracker_error = null,
                  tracker_status = $2, tracker_status_name = $3, tracker_description = $4,
                  tracker_event_at = $5::timestamptz
            where id = $1""",
        shipment["id"], last.get("code"), last.get("name"), last.get("description"),
        last.get("time"))
    if not info:
        return "waiting"
    await start_shipment(conn, str(shipment["id"]))
    return "started"


async def check_pending(conn: asyncpg.Connection) -> dict[str, int]:
    """등록됐지만 아직 접수 전인 송장을 조회한다. 키가 없으면 아무것도 하지 않는다."""
    counts = {"checked": 0, "started": 0, "waiting": 0, "error": 0}
    if not delivery_tracker.configured():
        return counts
    rows = await conn.fetch(
        f"""select s.id, s.carrier_id, s.tracking_number
              from public.shipments s
              join public.orders o on o.id = s.order_id
             where s.status = 'registered' and s.tracking_number is not null
               and s.carrier_id is not null and s.started_at is null
               and o.status in ('paid', 'packing', 'shipping')
               and s.created_at > now() - interval '{GIVE_UP_DAYS} days'
               and (s.tracker_checked_at is null
                    or s.tracker_checked_at < now() - interval '{CHECK_EVERY_MINUTES} minutes')
             order by s.tracker_checked_at nulls first
             limit {BATCH}""")
    for row in rows:
        outcome = await check_one(conn, row)
        counts["checked"] += 1
        if outcome == "auth_error":
            counts["error"] += 1
            break  # 키 문제면 나머지도 같다
        counts[outcome] += 1
    return counts
