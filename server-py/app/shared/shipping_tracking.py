"""
직접 등록한 송장의 배송 추적 (Delivery Tracker).

관리자가 송장번호를 등록하면(register-tracking) 여기서 주기적으로 조회한다.
택배사 기록이 처음 뜨면(= 택배사가 접수함):
  1. 주문이 입금완료·송장 발급 완료 상태면 배송중으로 바꾼다.
  2. 배송시작(택배번호 안내) 알림톡을 보낸다. 같은 주문에는 한 번만 간다(alimtalk_logs).
  3. shipments.started_at 을 찍어 다시 처리하지 않는다.

어떤 상태 코드가 우체국 '접수'에 해당하는지 문서에 없어서, 기록이 하나라도 생기면 접수로 본다.
단 송장번호는 재사용된다(실제 조회에서 남의 옛 배송 기록이 나왔다). 등록 시각 기준
RECENT_DAYS 일 전부터의 기록만 이번 배송으로 친다.
키가 만료·오류면(무료 요금제는 21일마다 갱신) 관리자에게 하루 한 번 알린다.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta
from typing import Any

import asyncpg

from . import delivery_tracker
from .alimtalk import notify_order

CHECK_EVERY_MINUTES = 10   # 같은 송장을 다시 볼 간격 (웹훅이 없을 때)
CHECK_WITH_WEBHOOK_MINUTES = 60  # 웹훅이 걸려 있으면 조회는 놓친 경우 대비로만
RETRY_WEBHOOK_MINUTES = 30  # 웹훅 등록이 실패하면 이만큼 뒤에 다시
RENEW_BEFORE_HOURS = 24    # 웹훅 만료가 이 안으로 다가오면 연장 (문서: 48시간, 24시간마다 연장)
GIVE_UP_DAYS = 14          # 등록 후 이 기간 안에 접수가 안 뜨면 더 보지 않는다
BATCH = 50
RECENT_DAYS = 7            # 등록 전 이 기간 안의 기록만 이번 배송으로 본다 (번호 재사용 대비)


def _parse_time(value: str | datetime | None) -> datetime | None:
    # DB 커넥션은 timestamptz 를 문자열로 돌려준다. 문자열·datetime 둘 다 받는다.
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def current_events(info: dict[str, Any] | None,
                   registered_at: str | datetime | None) -> list[dict[str, Any]]:
    """이번 배송의 기록만 (등록 RECENT_DAYS 일 전 이후, 시각 없는 기록은 뺀다)."""
    base = _parse_time(registered_at)
    if base is None:
        return []  # 등록 시각을 모르면 판단하지 않는다 (다음 조회에서 다시)
    since = base - timedelta(days=RECENT_DAYS)
    events = list((info or {}).get("events") or [])
    last = (info or {}).get("last")
    if last and last not in events:
        events.append(last)
    out = []
    for event in events:
        at = _parse_time(event.get("time"))
        if at and at >= since:
            out.append(event)
    return sorted(out, key=lambda e: _parse_time(e["time"]))
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


async def start_shipment(conn: asyncpg.Connection, shipment_id: str, *, via: str = "poll",
                         webhook_at: Any = None) -> dict[str, Any]:
    """접수 확인된 송장 1건 처리: 주문 배송중 + 배송시작 알림톡 + started_at.

    웹훅과 조회가 동시에 들어와도 한 번만: 송장 행을 잠그고(커밋까지) started_at 을 다시 본다.
    """
    row = await conn.fetchrow(
        """select s.order_id, o.status from public.shipments s
             join public.orders o on o.id = s.order_id
            where s.id = $1 and s.started_at is null
            for update of s""", shipment_id)
    if not row:
        return {"skipped": "이미 처리했습니다."}
    if row["status"] in ("paid", "packing"):
        await conn.execute(
            "update public.orders set status = 'shipping', updated_at = now() where id = $1",
            row["order_id"])
    result = await notify_order(conn, "tracking", str(row["order_id"]))
    await conn.execute(
        """update public.shipments set started_at = now(), started_via = $2,
                  started_webhook_at = $3::timestamptz
            where id = $1""", shipment_id, via, webhook_at)
    return {"alimtalk": result}


async def ensure_webhook(conn: asyncpg.Connection, shipment: Any) -> str:
    """송장에 웹훅을 건다(또는 연장). 돌려주는 값: registered / not_configured / error."""
    if not delivery_tracker.configured() or not delivery_tracker.webhook_url():
        return "not_configured"
    await conn.execute(
        "update public.shipments set tracker_webhook_tried_at = now() where id = $1", shipment["id"])
    try:
        expires = await delivery_tracker.register_webhook(
            shipment["carrier_id"], shipment["tracking_number"])
    except delivery_tracker.TrackerError as error:
        await conn.execute(
            "update public.shipments set tracker_webhook_error = $2 where id = $1",
            shipment["id"], f"{error.code}: {error}"[:500])
        if error.code in _AUTH_CODES:
            await _alert_auth(conn, error)
        return "error"
    await conn.execute(
        """update public.shipments set tracker_webhook_expires_at = $2,
                  tracker_webhook_error = null where id = $1""", shipment["id"], expires)
    return "registered"


async def handle_webhook(conn: asyncpg.Connection, event_id: str) -> str:
    """받은 웹훅 1건 처리. 내용은 믿지 않고, 우리 송장과 맞는지 본 뒤 다시 조회한다."""
    event = await conn.fetchrow(
        "select carrier_id, tracking_number, received_at from public.delivery_webhook_events"
        " where id = $1", event_id)
    shipment = await conn.fetchrow(
        """select id, carrier_id, tracking_number, requested_at, created_at, started_at
             from public.shipments
            where carrier_id = $1 and tracking_number = $2 and status = 'registered'
            order by created_at desc limit 1""",
        event["carrier_id"], event["tracking_number"]) if event else None
    if not shipment:
        outcome, shipment_id = "no_shipment", None
    else:
        shipment_id = shipment["id"]
        await conn.execute(
            "update public.shipments set tracker_webhook_last_at = $2 where id = $1",
            shipment_id, event["received_at"])
        if shipment["started_at"]:
            outcome = "already_started"
        else:
            outcome = await check_one(conn, shipment, via="webhook", webhook_at=event["received_at"])
    await conn.execute(
        """update public.delivery_webhook_events
              set shipment_id = $2, outcome = $3, processed_at = now() where id = $1""",
        event_id, shipment_id, outcome)
    return outcome


async def check_one(conn: asyncpg.Connection, shipment: Any, *, via: str = "poll",
                    webhook_at: Any = None) -> str:
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

    registered_at = shipment["requested_at"] or shipment["created_at"]
    recent = current_events(info, registered_at)
    # 화면에 보일 '최근 상태'도 이번 배송 것만. 옛 기록은 남기지 않는다.
    last = recent[-1] if recent else {}
    await conn.execute(
        """update public.shipments set tracker_checked_at = now(),
                  tracker_check_count = tracker_check_count + 1, tracker_error = null,
                  tracker_status = $2, tracker_status_name = $3, tracker_description = $4,
                  tracker_event_at = $5::timestamptz,
                  tracker_first_event_at = coalesce(tracker_first_event_at, $6::timestamptz)
            where id = $1""",
        shipment["id"], last.get("code"), last.get("name"), last.get("description"),
        last.get("time"), recent[0].get("time") if recent else None)
    if not recent:
        return "waiting"
    done = await start_shipment(conn, str(shipment["id"]), via=via, webhook_at=webhook_at)
    # 웹훅·조회가 겹치면 먼저 잡은 쪽만 처리한다. 나머지는 already_started.
    return "already_started" if "skipped" in done else "started"


async def check_pending(conn: asyncpg.Connection) -> dict[str, int]:
    """등록됐지만 아직 접수 전인 송장을 조회한다. 키가 없으면 아무것도 하지 않는다."""
    counts = {"checked": 0, "started": 0, "waiting": 0, "error": 0, "webhook_renewed": 0}
    if not delivery_tracker.configured():
        return counts
    # 웹훅 걸기·연장: 접수 전 송장 중 웹훅이 없거나 만료가 다가온 것.
    if delivery_tracker.webhook_url():
        renew = await conn.fetch(
            f"""select s.id, s.carrier_id, s.tracking_number
                  from public.shipments s
                 where s.status = 'registered' and s.tracking_number is not null
                   and s.carrier_id is not null and s.started_at is null
                   and s.created_at > now() - interval '{GIVE_UP_DAYS} days'
                   and (s.tracker_webhook_expires_at is null
                        or s.tracker_webhook_expires_at < now() + interval '{RENEW_BEFORE_HOURS} hours')
                   and (s.tracker_webhook_tried_at is null
                        or s.tracker_webhook_tried_at < now() - interval '{RETRY_WEBHOOK_MINUTES} minutes')
                 limit {BATCH}""")
        for row in renew:
            if await ensure_webhook(conn, row) == "registered":
                counts["webhook_renewed"] += 1
    rows = await conn.fetch(
        f"""select s.id, s.carrier_id, s.tracking_number, s.requested_at, s.created_at
              from public.shipments s
              join public.orders o on o.id = s.order_id
             where s.status = 'registered' and s.tracking_number is not null
               and s.carrier_id is not null and s.started_at is null
               and o.status in ('paid', 'packing', 'shipping')
               and s.created_at > now() - interval '{GIVE_UP_DAYS} days'
               and (s.tracker_checked_at is null
                    or s.tracker_checked_at < now() - case
                         when s.tracker_webhook_expires_at > now()
                         then interval '{CHECK_WITH_WEBHOOK_MINUTES} minutes'
                         else interval '{CHECK_EVERY_MINUTES} minutes' end)
             order by s.tracker_checked_at nulls first
             limit {BATCH}""")
    for row in rows:
        outcome = await check_one(conn, row)
        counts["checked"] += 1
        if outcome == "auth_error":
            counts["error"] += 1
            break  # 키 문제면 나머지도 같다
        counts[outcome] = counts.get(outcome, 0) + 1
    return counts
