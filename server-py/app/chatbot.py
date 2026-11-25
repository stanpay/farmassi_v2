"""
카카오 챗봇용 읽기 전용 조회 (doc/chatbot/developer-handoff.md).

챗봇(Supabase Edge Function → Claude)이 SQL 한 문장을 보내면 읽기 전용으로 실행해 돌려준다.
프로토타입 — 테스트 채널에서만 쓴다. 운영 채널 전에 조회 범위를 좁힐 것(문서 §7).

막는 장치 (겹쳐서):
  - chatbot_ro 롤: public·auth SELECT 만, private 없음, 쓰기 권한 없음 (doc/chatbot/sql/chatbot-ro.sql)
  - 앱·관리 풀과 분리된 전용 풀 (최대 3)
  - 매 요청 READ ONLY 트랜잭션 + 끝나면 롤백, statement_timeout 5초
  - 한 문장만 (prepare 가 여러 문장을 42601 로 거부)
  - 최대 200행 (커서로 201행까지만 읽고 자름)
  - 키 비교는 hmac.compare_digest
CHATBOT_API_KEY·CHATBOT_DATABASE_URL 중 하나라도 없으면 꺼짐(503).
"""
from __future__ import annotations

import hmac
import os
import time
from typing import Any

import asyncpg

MAX_SQL = 10_000
ROW_LIMIT = 200
_pool: asyncpg.Pool | None = None


def _key() -> str:
    return (os.environ.get("CHATBOT_API_KEY") or "").strip()


def enabled() -> bool:
    return bool(_key() and (os.environ.get("CHATBOT_DATABASE_URL") or "").strip())


def authorized(header: str | None) -> bool:
    key = _key()
    return bool(key) and hmac.compare_digest((header or "").strip().encode(), key.encode())


async def _init(conn: asyncpg.Connection) -> None:
    # 시각·숫자·uuid 를 DB 가 찍어 준 텍스트 그대로 받는다. asyncpg 기본값은 timestamptz 를
    # UTC datetime 으로 바꿔서 세션 timezone(Asia/Seoul)이 무시된다.
    for name in ("timestamptz", "timestamp", "date", "time", "numeric", "uuid"):
        await conn.set_type_codec(name, encoder=str, decoder=str, schema="pg_catalog", format="text")


async def _get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            os.environ["CHATBOT_DATABASE_URL"], min_size=0, max_size=3, init=_init,
            # 문장 캐시를 끈다: 챗봇 SQL 은 매번 달라 캐시 이득이 없고, 스키마 변경 뒤
            # InvalidCachedStatementError 도 피한다.
            statement_cache_size=0,
            server_settings={"timezone": "Asia/Seoul", "application_name": "chatbot"},
        )
    return _pool


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def _cell(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return str(value)  # Decimal, datetime, UUID, list(배열) …


async def run(sql: str, params: list) -> dict[str, Any]:
    pool = await _get_pool()
    async with pool.acquire() as conn:
        tr = conn.transaction(readonly=True)
        await tr.start()
        try:
            await conn.execute("set local statement_timeout = '5s'")
            started = time.monotonic()
            stmt = await conn.prepare(sql)  # 여러 문장이면 여기서 42601
            cursor = await stmt.cursor(*params)
            records = await cursor.fetch(ROW_LIMIT + 1)
            elapsed = int((time.monotonic() - started) * 1000)
            columns = [a.name for a in stmt.get_attributes()]
        finally:
            await tr.rollback()  # 읽기만 하고 항상 되돌린다
    truncated = len(records) > ROW_LIMIT
    rows = [[_cell(v) for v in r] for r in records[:ROW_LIMIT]]
    return {"columns": columns, "rows": rows, "row_count": len(rows),
            "truncated": truncated, "elapsed_ms": elapsed}
