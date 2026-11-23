"""
예상 배송일 계산. 프론트 `src/lib/deliveryEstimate.ts` 와 같은 규칙이다.

알림톡 '주문완료 안내'의 배송예정일을 서버에서 채우려고 옮겼다. 규칙을 바꿀 때는
두 파일을 같이 고친다. 어긋나면 화면과 알림톡이 서로 다른 날짜를 말한다.

  - 출고는 빨라야 다음날. 마감(서울 17시)을 넘기면 모레부터 본다.
  - 배송 요일이 정해져 있으면 그 요일에만, 정지 기간이면 끝난 다음날 이후로.
  - 일요일·공휴일에는 출고하지 않는다.
  - 도착일 = 출고일에서 일요일·공휴일을 빼고 2일 뒤.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Iterable

KST = timezone(timedelta(hours=9))
CUTOFF_HOUR = 17
WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"]


def _js_weekday(d: date) -> int:
    """JS Date.getDay() 번호 (0=일 … 6=토). DB 의 delivery_days 가 이 번호다."""
    return (d.weekday() + 1) % 7


def normalize_delivery_days(value: object) -> list[int]:
    if not isinstance(value, list):
        return []
    out: set[int] = set()
    for day in value:
        try:
            n = int(day)
        except (TypeError, ValueError):
            continue
        if 0 <= n <= 6 and float(day) == n:
            out.add(n)
    return sorted(out)


def _to_date(value: str | date) -> date:
    return value if isinstance(value, date) else date.fromisoformat(str(value)[:10])


def _pause_covering(pauses: list[tuple[date, date]], d: date) -> tuple[date, date] | None:
    return next((p for p in pauses if p[0] <= d <= p[1]), None)


def ship_date(
    days: object,
    pauses: Iterable[dict] = (),
    from_: str | date | None = None,
    holidays: Iterable[str | date] = (),
    after_cutoff: bool | None = None,
) -> date | None:
    now = datetime.now(KST)
    start = _to_date(from_) if from_ is not None else now.date()
    if after_cutoff is None:
        after_cutoff = now.hour >= CUTOFF_HOUR
    allowed = set(normalize_delivery_days(days))
    ranges = [(_to_date(p["start_date"]), _to_date(p["end_date"])) for p in pauses]
    closed_days = {_to_date(h) for h in holidays}

    cursor = start + timedelta(days=2 if after_cutoff else 1)
    for _ in range(400):
        paused = _pause_covering(ranges, cursor)
        if paused:
            cursor = paused[1] + timedelta(days=1)
            continue
        closed = _js_weekday(cursor) == 0 or cursor in closed_days
        if not closed and (not allowed or _js_weekday(cursor) in allowed):
            return cursor
        cursor += timedelta(days=1)
    return None


def arrival_date(ship: str | date, holidays: Iterable[str | date] = (), business_days: int = 2) -> date:
    closed_days = {_to_date(h) for h in holidays}
    cursor = _to_date(ship)
    left = business_days
    for _ in range(400):
        if left <= 0:
            break
        cursor += timedelta(days=1)
        if _js_weekday(cursor) == 0 or cursor in closed_days:
            continue
        left -= 1
    return cursor


def format_ymd(value: str | date) -> str:
    d = _to_date(value)
    return f"{d.month}월 {d.day}일({WEEKDAY_LABEL[_js_weekday(d)]})"
