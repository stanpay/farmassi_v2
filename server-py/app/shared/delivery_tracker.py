"""
Delivery Tracker (tracker.delivery) 배송 조회.

문서: https://tracker.delivery/docs/tracking-api
  - POST https://apis.tracker.delivery/graphql
  - Authorization: TRACKQL-API-KEY {client_id}:{client_secret}
  - 오류는 HTTP 200 이어도 body.errors[].extensions.code 로 온다
    (UNAUTHENTICATED·FORBIDDEN·INTERNAL·BAD_REQUEST·NOT_FOUND).
  - 이벤트 상태 코드: UNKNOWN, INFORMATION_RECEIVED, AT_PICKUP, IN_TRANSIT,
    OUT_FOR_DELIVERY, ATTEMPT_FAIL, DELIVERED, AVAILABLE_FOR_PICKUP, EXCEPTION

키: DELIVERY_TRACKER_CLIENT_ID / DELIVERY_TRACKER_CLIENT_SECRET. 없으면 조회하지 않는다.
무료 요금제 자격증명은 21일마다 콘솔(console.tracker.delivery)에서 갱신해야 한다.
"""
from __future__ import annotations

import os
from typing import Any

import httpx

API_URL = "https://apis.tracker.delivery/graphql"

#: 화면에서 고르는 택배사 → Delivery Tracker carrierId. 문서 택배사 목록에서 확인한 것만 둔다.
CARRIERS: dict[str, dict[str, str]] = {
    "kr.epost": {"name": "우체국택배", "provider": "kpost"},
    "kr.cjlogistics": {"name": "CJ대한통운", "provider": "cj"},
}

_QUERY = """
query Track($carrierId: ID!, $trackingNumber: String!) {
  track(carrierId: $carrierId, trackingNumber: $trackingNumber) {
    trackingNumber
    lastEvent { time description status { code name } }
    events(last: 20) { edges { node { time description status { code name } } } }
  }
}
"""


class TrackerError(Exception):
    """조회 실패. code 는 Delivery Tracker 오류 코드(없으면 HTTP 등)."""

    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        self.code = code


def configured() -> bool:
    return bool(_credentials())


def _credentials() -> str | None:
    cid = (os.environ.get("DELIVERY_TRACKER_CLIENT_ID") or "").strip()
    secret = (os.environ.get("DELIVERY_TRACKER_CLIENT_SECRET") or "").strip()
    return f"{cid}:{secret}" if cid and secret else None


def parse_track(data: dict[str, Any] | None) -> dict[str, Any] | None:
    """track 응답 → {'last': 이벤트|None, 'events': [오래된 것부터]}. 기록이 없으면 None."""
    if not data:
        return None
    edges = ((data.get("events") or {}).get("edges")) or []
    events = []
    for edge in edges:
        node = (edge or {}).get("node") or {}
        status = node.get("status") or {}
        events.append({"time": node.get("time"), "description": node.get("description"),
                       "code": status.get("code"), "name": status.get("name")})
    last = data.get("lastEvent")
    last_event = None
    if last:
        status = last.get("status") or {}
        last_event = {"time": last.get("time"), "description": last.get("description"),
                      "code": status.get("code"), "name": status.get("name")}
    if not last_event and not events:
        return None
    return {"last": last_event or events[-1], "events": events}


async def track(carrier_id: str, tracking_number: str) -> dict[str, Any] | None:
    """배송 조회. 아직 택배사 기록이 없으면 None. 그 밖의 실패는 TrackerError."""
    credentials = _credentials()
    if not credentials:
        raise TrackerError("Delivery Tracker 키가 없습니다.", "NOT_CONFIGURED")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15, connect=5)) as client:
            response = await client.post(
                API_URL,
                json={"query": _QUERY,
                      "variables": {"carrierId": carrier_id, "trackingNumber": tracking_number}},
                headers={"Authorization": f"TRACKQL-API-KEY {credentials}",
                         "Content-Type": "application/json"},
            )
    except httpx.HTTPError as error:
        raise TrackerError(f"연결 실패: {error}", "NETWORK") from error
    try:
        body = response.json()
    except ValueError as error:
        raise TrackerError(f"HTTP {response.status_code} 응답을 읽지 못했습니다.", "HTTP") from error

    errors = body.get("errors") or []
    if errors:
        code = ((errors[0].get("extensions") or {}).get("code")) or "UNKNOWN"
        if code == "NOT_FOUND":
            return None  # 아직 택배사에 기록이 없다. 다음에 다시 본다.
        raise TrackerError(str(errors[0].get("message") or code), code)
    return parse_track((body.get("data") or {}).get("track"))
