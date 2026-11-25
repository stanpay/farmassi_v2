# 카카오 챗봇 — DB 조회 엔드포인트 개발자 안내

카카오톡 채널 챗봇이 운영 DB를 **읽기만** 할 수 있게 API 서버(`server-py`)에
엔드포인트 하나를 추가합니다. 챗봇 본체는 Supabase Edge Function에 있고, 그쪽에서
Claude가 SQL을 직접 써서 이 엔드포인트로 보냅니다.

**프로토타입입니다.** 테스트 채널에서만 쓰고, 운영 채널에 배포하기 전에 조회 범위를 좁힙니다.

```
카톡 → 카카오 챗봇 → Supabase Edge Function(kakao-skill) → Claude
                                                         │ run_sql 도구
                                                         ▼
                  https://api.shop.lkim.me/chatbot/query   ← 이번에 추가
                                                         │ chatbot_ro, READ ONLY
                                                         ▼
                                                  PostgreSQL (farmassi)
```

---

## 0. 적용 순서

1. DB: 읽기 전용 롤 `chatbot_ro` 만들기 (§1)
2. 환경변수 두 개 추가 (§2)
3. `server-py` 에 `POST /chatbot/query` 구현 (§3, §4)
4. API 재시작 후 curl 로 확인 (§5)
5. `CHATBOT_API_KEY` 값을 챗봇 담당자에게 **채팅이 아닌 안전한 경로로** 전달 → Supabase 시크릿에 등록

nginx 는 건드리지 않습니다. `api.shop.lkim.me` 는 `location /` 전체를 4310 으로 넘기므로
새 경로도 그대로 들어옵니다(저장소의 `deploy/nginx-shop.conf` 기준. 서버 설정이 다르면 확인).

---

## 1. DB — `chatbot_ro` 롤 (서버에서 직접 실행)

`ops_ro`(관리자 웹용, `server/db/005_ops_readonly.sql`)와 같은 성격의 롤이지만
**`private` 스키마는 뺍니다.** `private.bankda_merchant.password` 처럼 외부로 나가면 안 되는
값이 있고, 챗봇이 조회한 결과는 Claude 와 고객 카톡으로 나갈 수 있기 때문입니다.

```sql
-- 카카오 챗봇(Claude)이 쓰는 읽기 전용 롤.
-- public, auth 만 조회. private(뱅크다 계정 등)는 권한을 주지 않는다.
-- BYPASSRLS: RLS 가 auth.uid() 기준이라 익명 접속으로는 orders 등이 0 건으로 보인다.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'chatbot_ro') then
    create role chatbot_ro login bypassrls;
  end if;
end $$;

alter role chatbot_ro bypassrls;

-- 20260824000005_db_connect_isolation.sql 에서 PUBLIC 의 CONNECT 를 걷었으므로 직접 준다.
grant connect on database farmassi to chatbot_ro;

grant usage on schema public, auth to chatbot_ro;
grant select on all tables in schema public, auth to chatbot_ro;

alter default privileges in schema public grant select on tables to chatbot_ro;
alter default privileges in schema auth   grant select on tables to chatbot_ro;
```

- 비밀번호 여부는 `ops_ro` 와 같게 맞춥니다(서버의 `pg_hba.conf` 가 localhost 를 어떻게 받는지에 따름).
- `alter default privileges` 는 실행한 롤이 앞으로 만드는 테이블에만 적용됩니다. 테이블 소유자(lkim)로 실행하세요.
- 확인: `select has_schema_privilege('chatbot_ro', 'private', 'usage');` → `false` 여야 합니다.

---

## 2. 환경변수 (서버 `server/.env`, git 밖)

```bash
# 챗봇 → API 인증 키. openssl rand -hex 32 로 만들고, 줄바꿈 없이 넣는다.
CHATBOT_API_KEY=...
# chatbot_ro 접속 정보
CHATBOT_DATABASE_URL=postgres://chatbot_ro@localhost:5432/farmassi
```

둘 중 하나라도 비어 있으면 엔드포인트는 **꺼진 상태(503)** 로 동작해야 합니다.

---

## 3. 엔드포인트 명세

### `POST /chatbot/query`

SQL 한 문장을 읽기 전용으로 실행하고 결과를 돌려줍니다.

**요청 헤더**

| 헤더 | 값 |
|---|---|
| `x-chatbot-key` | `CHATBOT_API_KEY` 와 같은 값. 앞뒤 공백은 무시 |
| `Content-Type` | `application/json` |

**요청 본문**

```json
{ "sql": "select id, status, created_at from orders where buyer_id = $1 order by created_at desc limit 5",
  "params": ["4f0c...-uuid"] }
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `sql` | string | O | **한 문장만.** 최대 10,000자 |
| `params` | array | X | `$1`, `$2` … 에 들어갈 값. 문자열·숫자·불리언·null |

**응답 200**

```json
{
  "columns": ["id", "status", "created_at"],
  "rows": [["4f0c...", "paid", "2026-11-25 14:03:11.2+09"]],
  "row_count": 1,
  "truncated": false,
  "elapsed_ms": 12
}
```

| 필드 | 설명 |
|---|---|
| `columns` | 컬럼 이름 순서 |
| `rows` | 행 배열(각 행은 값 배열). 값은 문자열·숫자·불리언·null 만. 날짜·numeric·uuid·json/jsonb 는 **문자열**로 |
| `row_count` | 돌려준 행 수 (최대 200) |
| `truncated` | 200 행을 넘어서 잘렸으면 `true` |
| `elapsed_ms` | DB 실행 시간 |

**오류**

| 상태 | 본문 | 언제 |
|---|---|---|
| 401 | `{"error": {"code": "unauthorized"}}` | 키가 없거나 다름 |
| 400 | `{"error": {"code": "bad_request", "message": "..."}}` | `sql` 없음, 10,000자 초과, `params` 가 배열 아님 |
| 400 | `{"error": {"code": "sql_error", "pg_code": "42P01", "message": "relation \"order\" does not exist"}}` | SQL 오류(여러 문장은 `42601`, 권한 없음은 `42501`). **Postgres 메시지를 그대로** 줍니다 — Claude 가 보고 고쳐서 다시 보냅니다 |
| 400 | `{"error": {"code": "timeout", "pg_code": "57014", "message": "..."}}` | 5초 초과 |
| 400 | `{"error": {"code": "read_only", "pg_code": "25006", "message": "..."}}` | 쓰기 시도 |
| 503 | `{"error": {"code": "disabled"}}` | 환경변수 미설정 |

### 실행 규칙 (반드시 지킬 것)

| 규칙 | 이유 |
|---|---|
| `chatbot_ro` 전용 풀로 접속 (`max_size` 3 정도) | 앱·관리 풀과 분리. 롤 권한으로 1차 차단 |
| 매 요청 `READ ONLY` 트랜잭션 안에서 실행, 끝나면 **롤백** | 롤 권한 + 트랜잭션 이중 방어 (`server/ops` 와 같은 방식) |
| `set local statement_timeout = '5s'` | 무거운 질의가 운영 DB 를 잡지 않게 |
| 접속 시 `timezone = 'Asia/Seoul'` | 고객에게 답할 시각을 한국 시간으로 |
| 한 문장만 허용 (asyncpg `prepare` 가 여러 문장을 `42601` 로 거부함) | `select ...; delete ...` 같은 끼워넣기 차단 |
| 최대 200 행 (커서로 201 행까지만 읽고 자름) | 응답 크기·메모리 |
| 키 비교는 `hmac.compare_digest` | 타이밍 공격 방지 |
| 요청마다 로그 한 줄: 시각, SQL(앞 2,000자), 행 수, 소요, 오류 코드 | 무엇을 조회했는지 나중에 추적. **결과 값은 로그에 남기지 않음** |

요청량은 카톡 메시지 1건당 1~5회 정도입니다(Claude 가 여러 번 조회할 수 있음).

---

## 4. 구현 참고 (FastAPI + asyncpg)

기존 코드 스타일에 맞춰 옮겨 쓰면 됩니다. 저장소에는 넣지 않았습니다.

```python
# server-py/app/chatbot.py
"""카카오 챗봇용 읽기 전용 조회. chatbot_ro + READ ONLY 트랜잭션."""
import hmac
import json
import os
import time

import asyncpg

MAX_SQL = 10_000
ROW_LIMIT = 200
_pool: asyncpg.Pool | None = None


def _key() -> str:
    return (os.environ.get("CHATBOT_API_KEY") or "").strip()


def enabled() -> bool:
    return bool(_key() and os.environ.get("CHATBOT_DATABASE_URL"))


def authorized(header: str | None) -> bool:
    return hmac.compare_digest((header or "").strip(), _key())


async def _init(conn: asyncpg.Connection) -> None:
    # 시각·숫자·uuid 를 DB 가 찍어 준 텍스트 그대로 받는다.
    # asyncpg 기본값은 timestamptz 를 UTC datetime 으로 바꿔서 세션 timezone 이 무시된다.
    for name in ("timestamptz", "timestamp", "date", "numeric", "uuid"):
        await conn.set_type_codec(name, encoder=str, decoder=str,
                                  schema="pg_catalog", format="text")


async def _get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            os.environ["CHATBOT_DATABASE_URL"], min_size=0, max_size=3, init=_init,
            server_settings={"timezone": "Asia/Seoul", "application_name": "chatbot"},
        )
    return _pool


def _cell(v):
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    return str(v)  # Decimal, datetime, UUID, date ...


async def run(sql: str, params: list) -> dict:
    pool = await _get_pool()
    async with pool.acquire() as conn:
        tr = conn.transaction(readonly=True)
        await tr.start()
        try:
            await conn.execute("set local statement_timeout = '5s'")
            started = time.monotonic()
            stmt = await conn.prepare(sql)           # 여러 문장이면 여기서 오류
            cur = await stmt.cursor(*params)
            records = await cur.fetch(ROW_LIMIT + 1)
            elapsed = int((time.monotonic() - started) * 1000)
            columns = [a.name for a in stmt.get_attributes()]
        finally:
            await tr.rollback()
    truncated = len(records) > ROW_LIMIT
    rows = [[_cell(v) for v in r] for r in records[:ROW_LIMIT]]
    return {"columns": columns, "rows": rows, "row_count": len(rows),
            "truncated": truncated, "elapsed_ms": elapsed}
```

```python
# server-py/app/main.py 에 추가
import time

import asyncpg

from . import chatbot

_PG_CODES = {"57014": "timeout", "25006": "read_only"}


@app.post("/chatbot/query")
async def chatbot_query(request: Request):
    if not chatbot.enabled():
        return JSONResponse({"error": {"code": "disabled"}}, status_code=503)
    if not chatbot.authorized(request.headers.get("x-chatbot-key")):
        return JSONResponse({"error": {"code": "unauthorized"}}, status_code=401)

    body = await request.json()
    sql = str(body.get("sql") or "").strip()
    params = body.get("params") or []
    if not sql or len(sql) > chatbot.MAX_SQL or not isinstance(params, list):
        return JSONResponse({"error": {"code": "bad_request", "message": "sql 은 1~10000자, params 는 배열"}}, status_code=400)

    started = time.monotonic()
    try:
        result = await chatbot.run(sql, params)
        print(f"[chatbot] ok rows={result['row_count']} {result['elapsed_ms']}ms sql={sql[:2000]!r}")
        return result
    except asyncpg.PostgresError as e:
        code = _PG_CODES.get(e.sqlstate, "sql_error")
        print(f"[chatbot] {code} {e.sqlstate} {int((time.monotonic()-started)*1000)}ms sql={sql[:2000]!r}")
        return JSONResponse({"error": {"code": code, "pg_code": e.sqlstate, "message": str(e)}}, status_code=400)
    except asyncpg.InterfaceError as e:   # params 개수·타입이 안 맞을 때 등
        return JSONResponse({"error": {"code": "bad_request", "message": str(e)}}, status_code=400)
```

- 종료 시 `_pool.close()` 를 `lifespan` 에 붙이면 깔끔합니다.
- `params` 의 타입은 SQL 쪽에서 캐스팅합니다(`$1::uuid`). Claude 에게도 그렇게 쓰라고 안내합니다.

---

## 5. 확인 (서버에서)

```bash
KEY=...   # CHATBOT_API_KEY 값

# 1) 정상 조회
curl -s https://api.shop.lkim.me/chatbot/query -H "x-chatbot-key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"sql":"select count(*) as n from orders"}'
# → {"columns":["n"],"rows":[["..."]],"row_count":1,...}

# 2) 키 없음 → 401
curl -s -o /dev/null -w '%{http_code}\n' https://api.shop.lkim.me/chatbot/query -d '{"sql":"select 1"}'

# 3) 쓰기 차단 → 400 read_only (또는 권한 오류 sql_error 42501)
curl -s https://api.shop.lkim.me/chatbot/query -H "x-chatbot-key: $KEY" \
  -H 'Content-Type: application/json' -d '{"sql":"delete from orders"}'

# 4) private 차단 → 400 sql_error 42501 (permission denied)
curl -s https://api.shop.lkim.me/chatbot/query -H "x-chatbot-key: $KEY" \
  -H 'Content-Type: application/json' -d '{"sql":"select * from private.bankda_merchant"}'

# 5) 여러 문장 → 400 sql_error 42601
curl -s https://api.shop.lkim.me/chatbot/query -H "x-chatbot-key: $KEY" \
  -H 'Content-Type: application/json' -d '{"sql":"select 1; select 2"}'

# 6) 시간 초과 → 400 timeout
curl -s https://api.shop.lkim.me/chatbot/query -H "x-chatbot-key: $KEY" \
  -H 'Content-Type: application/json' -d '{"sql":"select pg_sleep(6)"}'
```

---

## 6. 챗봇 쪽에서 쓰는 방식 (참고)

- 카카오가 보내는 `appUserId` = 카카오 로그인 회원번호 = `auth.identities.provider_user_id`
  (`provider = 'kakao'`). 챗봇은 먼저 이 값으로 `user_id` 를 찾고, 그 사용자 기준으로 조회합니다.
- 스키마는 첫 호출 때 `information_schema.columns` 를 이 엔드포인트로 읽어 Claude 에게 줍니다.
- 챗봇 코드: 저장소의 `kakao-chatbot/` (Supabase 마이그레이션·Edge Function).

## 7. 운영 배포 전에 다시 볼 것

- 조회 범위: 지금은 `public`·`auth` 전체. 고객 응대에 필요한 테이블·컬럼만 남긴 뷰로 좁힐 것
  (예: 본인 주문·배송만, 다른 고객 정보는 불가).
- 고객이 대화로 다른 사람 정보를 캐낼 수 있으므로, "누구의 데이터를 볼지"는 서버가
  `appUserId` 로 고정하는 구조로 바꿀 것.
