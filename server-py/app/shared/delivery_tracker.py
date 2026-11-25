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

웹훅 (https://tracker.delivery/docs/tracking-webhook-api):
  - registerTrackWebhook(input: {carrierId, trackingNumber, callbackUrl, expirationTime}): Boolean
  - 만료 48시간 권장, 24시간마다 다시 불러 연장. 현재 시각을 주면 지운다.
  - 콜백: POST {callbackUrl}, body {"carrierId", "trackingNumber"} 만. 1초 안에 202 권장,
    2XX 가 아니면 만료까지 재시도. 서명이 없어 콜백 주소에 비밀 토큰을 넣고, 내용은 다시 조회해 확인한다.
  - 콜백 주소: DELIVERY_TRACKER_WEBHOOK_BASE + /webhooks/delivery-tracker/{DELIVERY_TRACKER_WEBHOOK_TOKEN}
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
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


_REGISTER_WEBHOOK = """
mutation Register($input: RegisterTrackWebhookInput!) {
  registerTrackWebhook(input: $input)
}
"""

WEBHOOK_HOURS = 48


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


def webhook_url() -> str | None:
    """우리 콜백 주소. 주소·토큰 중 하나라도 없으면 웹훅을 걸지 않는다(조회만 한다)."""
    base = (os.environ.get("DELIVERY_TRACKER_WEBHOOK_BASE") or "").strip().rstrip("/")
    token = (os.environ.get("DELIVERY_TRACKER_WEBHOOK_TOKEN") or "").strip()
    return f"{base}/webhooks/delivery-tracker/{token}" if base and token else None


def webhook_token() -> str:
    return (os.environ.get("DELIVERY_TRACKER_WEBHOOK_TOKEN") or "").strip()


async def _graphql(query: str, variables: dict[str, Any]) -> dict[str, Any]:
    credentials = _credentials()
    if not credentials:
        raise TrackerError("Delivery Tracker 키가 없습니다.", "NOT_CONFIGURED")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15, connect=5)) as client:
            response = await client.post(
                API_URL, json={"query": query, "variables": variables},
                headers={"Authorization": f"TRACKQL-API-KEY {credentials}",
                         "Content-Type": "application/json"})
    except httpx.HTTPError as error:
        raise TrackerError(f"연결 실패: {error}", "NETWORK") from error
    try:
        return response.json()
    except ValueError as error:
        raise TrackerError(f"HTTP {response.status_code} 응답을 읽지 못했습니다.", "HTTP") from error


async def register_webhook(carrier_id: str, tracking_number: str,
                           hours: int = WEBHOOK_HOURS) -> datetime:
    """웹훅을 건다(이미 있으면 만료만 늘어난다). 만료 시각을 돌려준다. hours=0 이면 지운다."""
    url = webhook_url()
    if not url:
        raise TrackerError("웹훅 주소(DELIVERY_TRACKER_WEBHOOK_BASE/TOKEN)가 없습니다.", "NOT_CONFIGURED")
    expires = datetime.now(timezone.utc) + timedelta(hours=hours)
    body = await _graphql(_REGISTER_WEBHOOK, {"input": {
        "carrierId": carrier_id, "trackingNumber": tracking_number, "callbackUrl": url,
        "expirationTime": expires.isoformat().replace("+00:00", "Z")}})
    errors = body.get("errors") or []
    if errors:
        code = ((errors[0].get("extensions") or {}).get("code")) or "UNKNOWN"
        raise TrackerError(str(errors[0].get("message") or code), code)
    if not (body.get("data") or {}).get("registerTrackWebhook"):
        raise TrackerError("웹훅 등록이 거절됐습니다 (false).", "REJECTED")
    return expires


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
    body = await _graphql(_QUERY, {"carrierId": carrier_id, "trackingNumber": tracking_number})
    errors = body.get("errors") or []
    if errors:
        code = ((errors[0].get("extensions") or {}).get("code")) or "UNKNOWN"
        if code == "NOT_FOUND":
            return None  # 아직 택배사에 기록이 없다. 다음에 다시 본다.
        raise TrackerError(str(errors[0].get("message") or code), code)
    return parse_track((body.get("data") or {}).get("track"))
