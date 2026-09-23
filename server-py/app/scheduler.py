"""
입금내역 조회 시점 결정.

뱅크다는 60분마다 은행에서 계좌를 긁어온다. 그 사이에 거래내역을 아무리 불러봐야
같은 데이터만 돌아온다. 그래서 제한이 없는 계좌 목록 API 로 last_scraping_at 을
지켜보다가, 값이 바뀐 계좌가 있을 때만 거래내역(5분 제한)을 부른다.

결과적으로 거래내역 호출은 하루 24회 근처가 되고, 새 입금은 스크래핑 직후에 잡힌다.
"""
import asyncio
import os
import re
from datetime import datetime, timedelta, timezone

import asyncpg

from . import db
from .config import config
from .functions import FUNCTIONS, FnCtx
from .shared.bankda import list_accounts
from .shared.holidays import sync as sync_holidays

_KST = timezone(timedelta(hours=9))


def log(message: str) -> None:
    """로그에 시각이 없으면 나중에 무슨 일이 언제 있었는지 알 수가 없다."""
    now = datetime.now(_KST).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {message}", flush=True)


async def _tick() -> None:
    try:
        # 뱅크다가 새로 긁어간 계좌가 있는지 본다.
        accounts = await list_accounts()
        advanced: list[str] = []
        async with db.with_admin() as conn:
            for account in accounts:
                key = re.sub(r"\D", "", str(account.get("account_number") or ""))
                if not key:
                    continue
                seen = await conn.fetchrow(
                    "select last_scraping_at from private.bankda_scrape_state"
                    " where account_number = $1", key)
                previous = seen["last_scraping_at"] if seen else None
                current = account.get("last_scraping_at")

                # 처음 보는 계좌는 한 번 가져온다. 서버가 꺼져 있던 동안의 입금을 놓치지 않기 위해.
                if seen is None or previous != current:
                    advanced.append(key)

                await conn.execute(
                    "insert into private.bankda_scrape_state"
                    " (account_number, last_scraping_at, checked_at)"
                    " values ($1, $2, now())"
                    " on conflict (account_number) do update set"
                    " last_scraping_at = excluded.last_scraping_at, checked_at = now()",
                    key, current)

        # 새 데이터가 없어도 재대사는 돌린다. 주문은 계속 생기기 때문이다.
        async with db.with_admin() as conn:
            result = await FUNCTIONS["scrape-deposits"](FnCtx(
                user_id=None,
                body={"__byCron": True, "days": 3, "rematchOnly": not advanced},
                admin=conn,
            ))

        body = result.body or {}
        if result.status != 200:
            log(f"입금 조회 건너뜀: {body.get('error')}")
            return
        if advanced:
            log(f"입금 조회(계좌 {len(advanced)}곳 갱신됨: {', '.join(advanced)}):"
                f" 신규 {body.get('inserted')}건, 연결 {body.get('matched')}건")
        elif body.get("rematched"):
            log(f"재대사로 {body['rematched']}건 연결")
    except Exception as error:  # noqa: BLE001
        log(f"입금 조회 실패: {error}")


async def _holiday_loop() -> None:
    """공휴일은 자주 바뀌지 않는다. 기동 직후 한 번, 그 뒤 하루에 한 번."""
    await asyncio.sleep(30)
    while True:
        try:
            async with db.with_admin() as conn:
                count = await sync_holidays(conn)
            if count:
                log(f"공휴일 동기화: {count}건")
        except Exception as error:  # noqa: BLE001
            log(f"공휴일 동기화 실패: {error}")
        await asyncio.sleep(86400)


async def _loop(minutes: float) -> None:
    await asyncio.sleep(20)
    while True:
        await _tick()
        await asyncio.sleep(minutes * 60)


# 워커가 여럿이어도 스케줄러는 하나만 돌아야 한다. 둘이 돌면 뱅크다를 두 번 부르고
# 같은 입금을 두 번 대사한다. DB advisory lock 을 쥔 워커만 돌린다. 잠금은 DB 별이라
# 운영(farmassi)과 개발(farmassi_dev)은 서로 막지 않는다.
_LOCK_KEY = 7_302_026   # 아무 값이나 괜찮다. 이 앱에서 advisory lock 은 이것 하나다
_RETRY_SECONDS = 60      # 맡은 워커가 죽으면 이 안에 다른 워커가 이어받는다


async def _hold_lock_and_run(minutes: float | None) -> None:
    while True:
        conn = None
        try:
            # 풀이 아닌 전용 연결. 잠금은 세션에 붙어 있어서, 이 연결이 살아 있는 동안만 유효하다.
            conn = await asyncpg.connect(config.db_admin_url)
            if await conn.fetchval("select pg_try_advisory_lock($1)", _LOCK_KEY):
                log(f"스케줄러: 이 워커(pid {os.getpid()})가 맡는다")
                tasks = [asyncio.create_task(_holiday_loop())]
                if minutes is not None:
                    tasks.append(asyncio.create_task(_loop(minutes)))
                try:
                    # 연결이 끊기면 잠금도 풀린다. 그때는 다른 워커가 맡을 수 있으니 여기서 멈춘다.
                    while True:
                        await asyncio.sleep(30)
                        await conn.fetchval("select 1")
                finally:
                    for task in tasks:
                        task.cancel()
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001
            log(f"스케줄러 잠금 연결 끊김, 다시 시도: {error}")
        finally:
            if conn is not None:
                await conn.close()
        await asyncio.sleep(_RETRY_SECONDS)


def start_scheduler() -> asyncio.Task:
    raw = os.environ.get("SCRAPE_CHECK_MINUTES")
    try:
        minutes = float(raw) if raw not in (None, "") else 5.0
    except ValueError:
        minutes = float("nan")
    if not (minutes == minutes) or minutes <= 0:   # NaN 또는 0 이하
        log("입금 자동조회: 꺼짐")
        # 입금 조회를 꺼도 공휴일은 받는다. 예상 배송일 계산에 쓰이기 때문이다.
        return asyncio.create_task(_hold_lock_and_run(None))

    log(f"입금 자동조회: {minutes:g}분마다 갱신 여부 확인 (거래내역은 갱신됐을 때만 호출)")
    return asyncio.create_task(_hold_lock_and_run(minutes))
