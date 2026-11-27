# 카카오 챗봇 — Supabase 프로토타입을 백엔드로 옮기기

작성: 2026-11-26  
상태: **프로토타입 동작 중 (테스트 채널 전용, 운영 채널 미배포)**

급하게 Supabase(Edge Function + Postgres)로 만든 카카오톡 채널 챗봇을 우리 백엔드(`server-py`,
`api.shop.lkim.me`)로 합치기 위한 문서입니다. 지금까지 한 설정·코드·결정·측정값·주의점을 모두 담았습니다.

| 무엇 | 어디 |
|---|---|
| 프로토타입 코드 (Edge Function, SQL) | 브랜치 `feat/kakao-chatbot` (커밋 `b5cd65c`) — `kakao-chatbot/supabase/` |
| 조회 엔드포인트 명세 (`/chatbot/query`) | `feat/kakao-chatbot` 의 `doc/kakao-chatbot/developer-handoff.md`, `develop` 의 `doc/chatbot/developer-handoff.md` |
| 조회 엔드포인트 구현 | `develop` — `server-py/app/chatbot.py`, `server-py/app/main.py` (커밋 `7bdd7ef`, 병합 `360cc0f`) |
| 읽기 전용 롤 SQL | `develop` — `doc/chatbot/sql/chatbot-ro.sql` |
| 관련 기획 (챗봇 주문 검수) | `doc/기획-챗봇-주문검수-작업.md` (미커밋) |

---

## 목차

1. [한눈에 보기](#1-한눈에-보기)
2. [카카오 쪽 설정 (지금 상태)](#2-카카오-쪽-설정-지금-상태)
3. [카카오 스킬 프로토콜](#3-카카오-스킬-프로토콜)
4. [데이터: 대화 기록 테이블](#4-데이터-대화-기록-테이블)
5. [스킬 서버 동작 (지금 코드)](#5-스킬-서버-동작-지금-코드)
6. [Claude 호출 상세](#6-claude-호출-상세)
7. [운영 DB 조회](#7-운영-db-조회)
8. [시크릿·환경변수](#8-시크릿환경변수)
9. [측정값](#9-측정값)
10. [백엔드 이전 설계](#10-백엔드-이전-설계)
11. [이전 절차 (전환·되돌리기)](#11-이전-절차-전환되돌리기)
12. [이전 후 확인 목록](#12-이전-후-확인-목록)
13. [겪은 문제와 주의점](#13-겪은-문제와-주의점)
14. [고객 공개(운영 채널 배포) 전에 할 것](#14-고객-공개운영-채널-배포-전에-할-것)
15. [결정 기록](#15-결정-기록)
16. [참고 자료](#16-참고-자료)
17. [주문 검수·등록 (11-27 추가)](#17-주문-검수등록-11-27-추가)
- [부록 A. 조사한 카카오 기능 요약](#부록-a-조사한-카카오-기능-요약)

---

## 1. 한눈에 보기

### 지금 (프로토타입)

```
카톡 사용자
  │
  ▼
카카오 챗봇 관리자센터 ─ 봇 "팜어시" ─ 폴백 블록(콜백 ON) ─ 스킬 "팜어시 스킬서버"
  │  POST + x-skill-token
  ▼
Supabase Edge Function  kakao-skill   (https://ltqvhmogekvpplpwtymc.supabase.co/functions/v1/kakao-skill)
  ├─ 즉시 응답: useCallback + "확인하고 있어요…"
  └─ 뒤에서(EdgeRuntime.waitUntil):
       ├─ Supabase Postgres: kakao_users / kakao_messages 저장
       ├─ Claude API (claude-opus-5-5) ── 도구 run_sql / get_history
       │      run_sql ─► https://api.shop.lkim.me/chatbot/query (x-chatbot-key)
       │                    └─ chatbot_ro + READ ONLY ─► 운영 PostgreSQL (farmassi)
       └─ callbackUrl 로 최종 답 POST
```

### 이전 후 (목표)

```
카톡 사용자 → 카카오 챗봇(설정 그대로) → POST https://api.shop.lkim.me/kakao/skill  (x-skill-token)
                                            server-py (FastAPI)
                                              ├─ 즉시 응답: useCallback
                                              └─ asyncio 작업:
                                                   ├─ chatbot 스키마에 대화 저장 (farmassi_admin 풀)
                                                   ├─ Claude ── run_sql → app/chatbot.py run() 직접 호출 (HTTP 왕복 없음)
                                                   └─ callbackUrl 로 최종 답
```

바뀌는 것: 스킬 URL 한 줄, 실행 위치, 대화 저장 위치, DB 조회가 HTTP 에서 함수 호출로.  
안 바뀌는 것: 카카오 채널·봇·블록·콜백 설정, 헤더 토큰 방식, Claude 프롬프트·도구, `chatbot_ro`.

### 지금 되는 것 / 안 되는 것

| 항목 | 상태 |
|---|---|
| 테스트 채널·봇테스트에서 질문 → Claude 답변 (콜백) | ✅ |
| 대화·사용자 저장 (botUserKey, plusfriendUserKey, appUserId) | ✅ |
| appUserId → 운영 회원 매칭 (`auth.identities`) | ✅ (본인 계정 `5044688232` 확인) |
| 운영 DB 조회 답변 (주문·배송·상품) | ✅ (`api.shop.lkim.me/chatbot/query`) |
| 이전 대화: 직전 1회 + 필요 시 `get_history` | ✅ |
| 농가 회원이 카톡으로 보낸 주문 검수 → 되묻기 → 확인 후 등록 (§17) | ✅ dev 서버에서 확인 (운영 API 에는 `/chatbot/rpc` 미배포) |
| 운영 채널(@팜어시) 배포 | ❌ 안 함 — 고객은 지금도 1:1 채팅 |
| 비회원(카카오 로그인 안 한 고객) 본인 주문 조회 | ❌ 설계만 (§14) |
| 조회 범위 제한 (본인 데이터만) | ❌ 프롬프트로만 막음 (§14) |
| 150초 실행 한도 대응 | ❌ 의도적으로 안 함 (Supabase 한정 문제, 백엔드엔 없음) |

---

## 2. 카카오 쪽 설정 (지금 상태)

이전 때 **바꾸는 건 스킬 URL 뿐**입니다(§11). 나머지는 그대로 둡니다.

### 2.1 카카오비즈니스 채널

| | 운영 채널 | 테스트 채널 |
|---|---|---|
| 이름 | 팜어시 | (테스트)팜어시 테스트 |
| 검색용 ID / 공개 ID | @팜어시 / `_xlQaSX` | @ndk0kdi5mdnthyz / `_TkmvX` |
| 파트너센터 스페이스 | 10643873 | 10801810 |
| 종류 | 비즈니스 채널(심사 완료) | 개발자용 채널(사업자 정보로 생성, 검색 불가, "(테스트)" 접두어) |
| 공개 / 검색 | ON / ON | **ON / OFF** (이번에 공개만 켬) |
| 채팅 | 켜짐 | **켜짐** (이번에 켬. 꺼져 있으면 메시지가 봇에 안 감) |
| 고객센터 연락처 | 설정됨 (휴대폰 번호 — 채팅방 상단·홈에 공개 노출됨) | 없음 |
| 챗봇 연결 | 운영 채널로 지정 (첫 배포 후 실제 연결) | 개발 채널로 연결 |
| 들어가는 주소 | — | `http://pf.kakao.com/_TkmvX` (검색 OFF 라 링크로만) |

- 테스트 채널은 채팅 시간 기본값(매일 9~18시), 첫인사·부재중 메시지 기본 문구가 켜져 있음. 챗봇이 연결돼 있어 메시지는 봇이 받음.
- 실제 농가 채널은 테스트에 쓰지 않기로 함(고객에게 봇 응답이 바로 노출되므로).

### 2.2 챗봇 관리자센터 (chatbot.kakao.com)

| 항목 | 값 |
|---|---|
| 봇 이름 / ID | 팜어시 / `6b051fe5217e92b3b673d606` |
| 봇 상태 | **준비** (한 번도 배포 안 함) |
| 운영 채널 | 팜어시 — 배포해야 연결됨 |
| 개발 채널 | (테스트)팜어시 테스트 — 저장만 해도 바로 반영 |
| 연결된 App | 팜어시 (운영·개발 채널 모두. 디벨로퍼스에서 채널을 앱에 연결하면 자동 표시) |
| 앱키 설정 | "카카오톡 채널과 연결된 챗봇은 카카오톡 채널에 연결된 앱키를 사용" — 따로 할 일 없음 |

**시나리오 (기본 시나리오만 있음)**

| 블록 | 설정 |
|---|---|
| 웰컴 블록 | OFF |
| 폴백 블록 (`6b051fe5217e92b3b673d60a`) | 스킬: 팜어시 스킬서버 / 봇 응답: **스킬데이터 사용** / **Callback ON**, 대기 문구 "확인하고 있어요. 잠시만 기다려 주세요." |
| 탈출 블록 | 패턴 발화 0개 |
| 인증 블록 | 비어 있음 |

→ 패턴 발화가 있는 블록이 하나도 없으므로 **모든 발화가 폴백 블록 → 스킬 서버**로 갑니다.
카카오의 의도 분류는 쓰지 않고, 질문 판단은 Claude 가 합니다.  
(폴백 블록의 원래 응답은 "무엇을 원하는지 잘 모르겠어요" 등 고정 문구 3개 랜덤이었음 → 스킬데이터로 교체)

**스킬**

| 항목 | 값 |
|---|---|
| 이름 / ID | 팜어시 스킬서버 / `6b070037e3146b3ebc752b0c` |
| URL | `https://ltqvhmogekvpplpwtymc.supabase.co/functions/v1/kakao-skill` |
| Test URL | 같음 |
| 헤더 (URL·Test URL 둘 다) | `x-skill-token: <KAKAO_SKILL_TOKEN>` |
| 기본 스킬 | 아님 |
| 적용 블록 | 폴백 블록 1개 |

**블록을 새로 만들 때** (예: "배송 문의" 블록에 전용 프롬프트)
- 스킬 선택 → 봇 응답 "스킬데이터 사용" → **블록마다 Callback 설정 ON** (안 켜면 5초 안에 답해야 함).
- 요청의 `userRequest.block.id/name` 으로 어느 블록인지 알 수 있음 → 블록별 프롬프트 선택 가능. 이름은 바뀔 수 있으니 **블록 ID 로 매핑**.
- 블록을 만들면 그 블록의 패턴 발화와 비슷한 말은 폴백으로 오지 않음(카카오 ML 분류). 오분류 가능.

### 2.3 카카오 디벨로퍼스

| 항목 | 값 |
|---|---|
| 앱 | 팜어시 (ID `1547504`, 비즈 앱, 사업자: 스테이블 퓨전) |
| 카카오 로그인 | 설정함 (서비스 로그인과 같은 앱 — §2.4 로 확인) |
| 연결된 비즈니스 채널 | 팜어시(활성), (테스트)팜어시 테스트(테스트용, 상태 "비활성" 표시지만 동작함) |
| 같은 계정의 다른 앱 | crustory(1650925), 스탠(1330474) — 챗봇과 무관 |

### 2.4 appUserId 가 오는 조건과 의미

- 조건(공식 문서): 비즈 채널 + 비즈 앱 + 카카오 로그인 활성화 ON + 디벨로퍼스에서 앱에 채널 연결 + 봇이 그 앱키 사용.
- `userRequest.user.properties.appUserId` = **그 앱의 카카오 로그인 회원번호** = 운영 DB `auth.identities.provider_user_id` (`provider = 'kakao'`).
- 검증: 실제 카톡 메시지로 `5044688232` 수신 → 운영 DB `auth.identities` 에서 회원 1명 조회됨 → 같은 앱 확인.
- 회원번호는 **앱마다 다름**. 다른 앱으로 로그인한 사람과는 매칭 안 됨.
- 카카오 로그인 안 한 사람에게 appUserId 가 오는지(오면 DB 에 없는 번호) 는 아직 확인 못 함.
- **봇테스트 요청에는 appUserId·plusfriendUserKey 가 없음** → 같은 botUserKey 로 전에 저장된 appUserId 를 씀(§5).

---

## 3. 카카오 스킬 프로토콜

### 3.1 요청 (카카오 → 스킬 서버)

`POST`, JSON. 우리가 쓰는 필드:

```jsonc
{
  "userRequest": {
    "utterance": "제 최근 주문 배송 상태 알려주세요",
    "callbackUrl": "https://bot-api.kakao.com/...",   // 블록 Callback ON 일 때만. 5분 유효, 1회용
    "block": { "id": "6b051fe5217e92b3b673d60a", "name": "폴백 블록" },
    "user": {
      "id": "b20888f12f...",                          // botUserKey — 봇별 고정, 위조 불가
      "type": "botUserKey",
      "properties": {
        "botUserKey": "b20888f12f...",
        "plusfriendUserKey": "...",                   // 채널 기준 사용자 키(비식별). 봇이 바뀌어도 유지
        "appUserId": "5044688232",                    // 앱 연결 시. = 카카오 로그인 회원번호
        "isFriend": true                              // 채널 친구일 때만 true, 아니면 필드 없음
      }
    },
    "params": { "surface": "BuilderBotTest", ... },   // 문서 예시상 봇테스트는 surface 값이 다름(구분용으로 쓰기 전에 확인)
    "lang": "ko", "timezone": "Asia/Seoul"
  },
  "bot": { ... }, "intent": { ... }, "action": { ... }, "contexts": [ ... ]
}
```

- `user.id` 는 대화마다 바뀌지 않음(봇이 같으면 고정). 다른 봇이면 다른 값.
- 헤더 `x-skill-token` 은 스킬 설정에 우리가 넣은 값. 카카오가 그대로 붙여 보냄.

### 3.2 응답

**콜백 블록(지금 폴백 블록)** — 5초 안에 바로:
```json
{ "version": "2.0", "useCallback": true, "data": { "text": "확인하고 있어요. 잠시만 기다려 주세요." } }
```
이후 5분 안에 `callbackUrl` 로 최종 답 `POST` (형식은 일반 스킬 응답과 같음):
```json
{ "version": "2.0", "template": { "outputs": [ { "simpleText": { "text": "답변…" } } ] } }
```
콜백 POST 응답: `{"taskId": "...", "status": "SUCCESS" | "FAIL" | "ERROR", "message": "...", "timestamp": ...}`

**콜백 없는 요청** (스킬 화면의 "스킬서버로 전송" 테스트 등) — 5초 안에 일반 스킬 응답.

### 3.3 제한

| 제한 | 값 |
|---|---|
| 스킬 응답 시간 | **5초** (넘으면 실패) — 콜백이면 첫 응답에만 적용 |
| callbackUrl | **5분 유효, 1회만** 사용 → 최종 답은 말풍선 한 번(outputs 최대 3개) |
| simpleText | 1000자 (코드에서 999자 + "…" 로 자름) |
| 마크다운 | 렌더링 안 됨 → 프롬프트로 금지 |
| 봇테스트 콜백 | 스킬 응답 v2 면 봇테스트에서도 콜백 확인 가능 (확인함) |
| 테스트 환경 callback token | 문서상 "Invalid callback token for testing purposes" 오류가 날 수 있음(채널 커스텀 유효성 테스트 등) |

---

## 4. 데이터: 대화 기록 테이블

### 4.1 지금 (Supabase `public`)

Supabase 프로젝트 `farmassi-chatbot` (ref `ltqvhmogekvpplpwtymc`, 서울 `ap-northeast-2`, 무료 플랜).
생성 옵션: Data API ON, 새 테이블 RLS 자동 ON, 새 테이블 API 권한 자동 부여 OFF.
원본 SQL: `feat/kakao-chatbot:kakao-chatbot/supabase/migrations/0001_kakao_chatbot.sql`

| 테이블 | 컬럼 |
|---|---|
| `kakao_users` | `id uuid pk`, `bot_user_key text unique not null`, `plusfriend_user_key`, `app_user_id`, `is_friend bool`, `member_id text`(운영 회원 user_id, 매칭되면 채움), `first_seen_at`, `last_seen_at` |
| `kakao_messages` | `id bigint identity pk`, `kakao_user_id uuid fk`, `direction ('in'|'out')`, `text`, `block_id`, `block_name`, `via ('sync'|'callback')`, `latency_ms`, `error`, `raw jsonb`, `created_at` |
| 함수 `kakao_touch_user(bot_user_key, plusfriend_user_key, app_user_id, is_friend) → uuid` | upsert. 빠진 값(null)은 기존 값 유지(`coalesce`), `last_seen_at` 갱신 |

`raw` 내용:
- in 행: 카카오 요청 원문 전체
- out 행: `{ response: 스킬응답, callback: 콜백 POST 결과, claude: { model, served_by, rounds, stop_reason, member, sql: [{sql, status, ok}], history_calls: [limit…], usage: {input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens} } }`

권한: RLS 켬, anon/authenticated 권한 회수, `service_role` 만 읽기·쓰기·함수 실행.

### 4.2 백엔드로 옮길 때 — **`chatbot` 스키마에 둘 것**

> ⚠️ `public` 에 두면 안 됩니다. Claude 가 쓰는 `chatbot_ro` 는 `public` 전체를 읽을 수 있어서
> (`grant select on all tables in schema public` + default privileges) **다른 고객의 대화까지 조회**할 수 있게 됩니다.

```sql
-- 카카오 챗봇 대화 기록. 서버(farmassi_admin)만 읽고 쓴다.
-- chatbot_ro(Claude 조회용)와 farmassi_app(사용자 요청용)에는 권한을 주지 않는다.
create schema if not exists chatbot;
revoke all on schema chatbot from public;

create table if not exists chatbot.kakao_users (
  id                  uuid primary key default gen_random_uuid(),
  bot_user_key        text not null unique,          -- userRequest.user.id (봇별 고정)
  plusfriend_user_key text,                          -- 채널 기준 사용자 키
  app_user_id         text,                          -- 카카오 로그인 회원번호 (= auth.identities.provider_user_id)
  is_friend           boolean not null default false,
  member_id           uuid,                          -- 매칭된 auth.users.id
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now()
);
create index if not exists kakao_users_app_user_id_idx on chatbot.kakao_users (app_user_id);
create index if not exists kakao_users_plusfriend_user_key_idx on chatbot.kakao_users (plusfriend_user_key);

create table if not exists chatbot.kakao_messages (
  id            bigint generated always as identity primary key,
  kakao_user_id uuid references chatbot.kakao_users (id) on delete cascade,
  direction     text not null check (direction in ('in', 'out')),
  text          text,
  block_id      text,
  block_name    text,
  via           text check (via in ('sync', 'callback')),
  latency_ms    integer,
  error         text,
  raw           jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists kakao_messages_user_time_idx on chatbot.kakao_messages (kakao_user_id, created_at desc);

create or replace function chatbot.touch_user(
  p_bot_user_key text, p_plusfriend_user_key text, p_app_user_id text, p_is_friend boolean
) returns uuid language sql set search_path = chatbot as $$
  insert into kakao_users (bot_user_key, plusfriend_user_key, app_user_id, is_friend)
  values (p_bot_user_key, p_plusfriend_user_key, p_app_user_id, coalesce(p_is_friend, false))
  on conflict (bot_user_key) do update set
    plusfriend_user_key = coalesce(excluded.plusfriend_user_key, kakao_users.plusfriend_user_key),
    app_user_id         = coalesce(excluded.app_user_id, kakao_users.app_user_id),
    is_friend           = excluded.is_friend,
    last_seen_at        = now()
  returning id;
$$;
revoke execute on function chatbot.touch_user(text, text, text, boolean) from public;

grant usage on schema chatbot to farmassi_admin;
grant select, insert, update, delete on all tables in schema chatbot to farmassi_admin;
grant execute on function chatbot.touch_user(text, text, text, boolean) to farmassi_admin;
```

- `farmassi_admin` 은 BYPASSRLS 라 RLS 정책 없이 씀. 서버 내부 작업용 풀(`db.with_admin()`)로 접근.
- 이 스키마는 `/query` 게이트웨이(프론트용)에서 다루지 않음.
- dev(`farmassi_dev`)에도 같은 SQL 을 먼저 적용.
- 확인: `select has_schema_privilege('chatbot_ro', 'chatbot', 'usage');` → `false`.

### 4.3 데이터 옮기기 (선택)

지금 쌓인 행은 거의 **테스트 대화**입니다(봇테스트·테스트 채널, 일부는 개발 DB 기준 답변). 옮기지 않고 새로 시작해도 됩니다.
옮긴다면:

1. Supabase 대시보드 → Table Editor → `kakao_users`, `kakao_messages` → Export CSV
   (또는 `pg_dump --data-only -t public.kakao_users -t public.kakao_messages "<Supabase DB 접속 문자열>"` — DB 비밀번호는 프로젝트 생성 때 정한 값)
2. 백엔드에 `chatbot.kakao_users` 먼저, 그다음 `chatbot.kakao_messages` 를 `\copy` 로 적재
   (`kakao_messages.id` 는 identity 라 `overriding system value` 로 넣거나 id 를 빼고 넣기)
3. `member_id` 는 Supabase 에서 text 였음 → uuid 로 캐스팅

---

## 5. 스킬 서버 동작 (지금 코드)

파일: `feat/kakao-chatbot:kakao-chatbot/supabase/functions/kakao-skill/index.ts` (Deno, 약 500줄)

### 5.1 요청 처리 순서

1. `POST` 아니면 `200 "ok"`.
2. 헤더 `x-skill-token` 과 `KAKAO_SKILL_TOKEN` 비교. **양쪽 앞뒤 공백 제거 후** 비교(§13 줄바꿈 문제). 다르면 `401`.
3. 본문 JSON 파싱 실패 → `ERROR_TEXT` 로 simpleText 응답.
4. `ctx` 구성: `appUserId`(문자열), `utterance`.
5. **callbackUrl 있으면** → 바로 `{"version":"2.0","useCallback":true,"data":{"text": WAIT_TEXT}}` 응답하고, 뒤에서:
   1. `logIn()` — `kakao_touch_user` → `kakao_users.id`, `kakao_messages` 에 in 행(원문 포함) 저장 → in 행 id 보관
   2. `buildReply()` (§5.2) — 예외 나면 `ERROR_TEXT`
   3. `callbackUrl` 로 POST. HTTP 실패 또는 `status != SUCCESS` 면 `error` 에 기록
   4. `logOut()` — out 행 저장(`via='callback'`, `latency_ms`, `error`, `raw`)
6. **callbackUrl 없으면** → `logIn()` 후 `"콜백이 켜진 블록에서만 답변할 수 있어요."` 응답, out 행 저장(`via='sync'`).
   (Claude 를 부르면 5초를 넘기기 쉬워서 동기 경로에서는 답하지 않음)

> 첫 응답을 먼저 보내고 저장은 뒤에서 하는 이유: Supabase 콜드 스타트(약 2~4.5초)에 DB 쓰기까지 더하면 5초를 넘길 수 있었음.

### 5.2 `buildReply()` — 답 만들기

1. `appUserId` 가 요청에 없으면(봇테스트 등) `kakao_users.app_user_id` 에 저장된 값 사용.
2. 동시에:
   - `loadSchema()` — `information_schema.columns` 에서 `public`, `auth` 의 테이블·컬럼·타입 목록. 워커가 살아 있는 동안 캐시(실패는 캐시 안 함)
     ```sql
     select c.table_schema || '.' || c.table_name as t,
            string_agg(c.column_name || ' ' || c.data_type, ', ' order by c.ordinal_position) as cols
     from information_schema.columns c
     where c.table_schema in ('public', 'auth')
     group by 1 order by 1
     ```
   - `findMember(appUserId)` — 결과: 회원 / 없음 / `"error"`(조회 실패)
     ```sql
     select i.user_id, p.display_name, p.role
       from auth.identities i left join public.profiles p on p.id = i.user_id
      where i.provider = 'kakao' and i.provider_user_id = $1
      limit 1
     ```
   - `loadHistory()` — 이번 in 행보다 앞의 **최근 2행**(직전 고객 질문 + 봇 답). 오래된 순 정렬, 같은 역할 연속은 합침, 첫 행이 assistant 면 버림. `historyBeforeId` = 읽은 것 중 가장 오래된 id.
3. 회원이면 `kakao_users.member_id` 갱신.
4. messages = 이력 + 이번 발화(마지막이 user 면 줄바꿈으로 합침).
5. system = [지침+스키마 (캐시 지점)] + [고객 정보] (§6.3, §6.4).
6. Claude 호출 반복 (최대 6회, 시작 후 110초 지나면 새 호출 안 함):
   - `refusal` → "그 내용은 제가 답하기 어려워요. 담당자가 확인 후 안내드릴게요."
   - `tool_use` → assistant 내용(**thinking 블록 포함 그대로**) 추가 → 도구 실행 → tool_result 들을 user 메시지 하나로 추가 → 다시 호출
   - `pause_turn` → assistant 내용 추가 후 다시 호출
   - 그 외(`end_turn` 등) → text 블록 합쳐서 simpleText. 비어 있으면 `ERROR_TEXT`
7. 6회 다 쓰거나 110초 넘으면 `BUSY_TEXT`.

### 5.3 도구 실행

| 도구 | 동작 |
|---|---|
| `run_sql` | 입력 검증(`sql` 문자열, `params` 배열) → `/chatbot/query` 호출(타임아웃 15초) → 응답 본문(오류 JSON 포함)을 그대로 tool_result 로. 실패면 `is_error: true`. `raw.claude.sql` 에 `{sql(2000자), status, ok}` 기록 |
| `get_history` | `limit`(1~20, 기본 10) 건을 `historyBeforeId` 보다 오래된 것부터 거꾸로 읽음 → `[2026. 11. 26. 오전 2:03:11] 고객: …` / `봇: …` 줄 목록. 읽은 만큼 `historyBeforeId` 를 앞으로 옮겨 다음 호출은 더 앞을 줌. 없으면 "(더 이전 대화 없음)" |
| 그 외 이름·잘못된 입력 | `is_error: true`, "run_sql 에 sql(문자열)을 넣어 다시 호출하세요." |

### 5.4 고정 문구·상수

| 이름 | 값 |
|---|---|
| `WAIT_TEXT` | 확인하고 있어요. 잠시만 기다려 주세요. |
| `ERROR_TEXT` | 죄송해요, 잠시 문제가 생겼어요. 조금 뒤에 다시 말씀해 주세요. |
| `BUSY_TEXT` | 확인할 내용이 많아 답변이 늦어지고 있어요. 조금 뒤에 다시 물어봐 주세요. |
| 거절 문구 | 그 내용은 제가 답하기 어려워요. 담당자가 확인 후 안내드릴게요. |
| 동기 경로 문구 | 콜백이 켜진 블록에서만 답변할 수 있어요. |
| `MAX_TOOL_ROUNDS` | 6 |
| `DEADLINE_MS` | 110,000 (Supabase 무료 150초 한도용 — 백엔드에선 의미 다름, §10.4) |
| `HISTORY_ROWS` | 2 |
| `HISTORY_PAGE_MAX` | 20 |
| `KAKAO_TEXT_LIMIT` | 1000 |

---

## 6. Claude 호출 상세

### 6.1 요청 파라미터

| 파라미터 | 값 | 이유 |
|---|---|---|
| `model` | `claude-opus-5-5` | 기본값. 비용 비교 후 바꿀 수 있음(§14) |
| `max_tokens` | 16000 | 비스트리밍 권장 기본값 |
| `betas` | `["server-side-fallback-2026-07-01"]` | fallbacks 사용 |
| `fallbacks` | `"default"` | 안전 분류기가 거절하면 서버가 다른 모델로 이어서 답함 |
| `output_config` | `{"effort": "medium"}` | Opus 5.5 기본값을 명시. thinking 은 항상 켜짐(끌 수 없음) |
| `cache_control` (최상위) | `{"type": "ephemeral"}` | 대화 캐시 — 한 질문에서 두 번째 호출부터 앞부분을 캐시 가격으로 |
| `system` | 블록 2개 (§6.3) — 첫 블록에 `cache_control: ephemeral` | 지침+스키마 캐시 |
| `tools` | `[run_sql, get_history]` **순서 고정** | 캐시가 접두사 일치라 순서가 바뀌면 깨짐 |
| 요청 타임아웃 | 60초 (SDK 기본 재시도 2회 — 최악 180초) | |
| SDK | `@anthropic-ai/sdk@1.12.0`, `client.beta.messages.create` | 콜드 스타트 줄이려고 지연 import |

- `tool_choice` 는 지정 안 함(auto). Opus 5.5 는 강제 도구 호출(`any`/`tool`)이 400.
- thinking 블록은 tool loop 에서 **그대로** 다시 넘겨야 함(빼거나 고치면 안 됨).
- `temperature` 등 샘플링 파라미터 안 씀.

### 6.2 대화 메시지

```
[직전 고객 질문(user)] [직전 봇 답(assistant)] [이번 발화(user)]
→ (tool_use) → [assistant: thinking+tool_use…] [user: tool_result…] → … → 최종 text
```

### 6.3 system 블록 1 — 지침 (+ 스키마) 전문

```
너는 팜어시(농가 직거래 쇼핑몰) 카카오톡 채널의 상담 챗봇이다.

답변 형식
- 카카오톡 말풍선으로 나간다. 마크다운(**, #, 표, 코드블록)을 쓰지 말고 일반 문장으로 쓴다.
- 짧게. 보통 2~5문장, 길어도 400자 안쪽. 존댓말.
- 날짜·시각은 한국 시간으로, "11월 25일(화) 오후 2시"처럼 사람이 읽기 쉽게.

조회
- 주문·배송·상품·농가처럼 데이터가 필요한 질문은 run_sql 도구로 운영 DB(PostgreSQL)를 조회한 뒤 답한다.
  추측해서 답하지 않는다.
- SELECT 한 문장씩. 필요한 컬럼만 고르고 limit 을 건다. 고객이 준 값은 $1 자리표시자와 params 로 넘긴다.
- 오류가 오면 메시지를 보고 SQL 을 고쳐 다시 시도한다. 그래도 안 되면 확인 후 안내하겠다고 답한다.
- 아래 스키마에 없는 테이블·컬럼을 지어내지 않는다.

이전 대화
- 메시지에는 직전 한 번의 대화(고객 질문과 그에 대한 답)만 들어 있다.
- "아까 그거", "전에 말한 주문"처럼 그보다 앞의 맥락이 필요할 때만 get_history 로 더 읽는다.
  필요 없으면 부르지 않는다.

고객
- 대화 상대는 아래 "고객 정보"의 사람이다. 주문·배송 조회는 그 사람의 user_id 기준으로 한다.
- 다른 고객의 이름·연락처·주소·주문 내용은 알려주지 않는다.
- 회원 매칭이 안 된 고객이 본인 주문을 물으면, 팜어시에 카카오로 로그인한 계정으로 문의해 달라고 안내한다.
- 환불·교환·주소 변경처럼 처리가 필요한 요청은 접수 내용을 정리해 주고 담당자가 확인 후 연락드린다고 안내한다.
  챗봇이 직접 처리했다고 말하지 않는다.

DB 스키마 (schema.table: column type, …)
- public.orders: id uuid, order_no text, ...      ← loadSchema() 결과
- ...
```

### 6.4 system 블록 2 — 고객 정보 (요청마다 다름, 캐시 지점 뒤)

```
고객 정보
- 팜어시 회원 user_id: 8ae35b50-...          ← 회원일 때
- 이름(표시명): ...
- 역할: ...
- 지금 시각: 2026. 11. 26. 오전 2:41:07
```
회원 아님: `- 팜어시 회원과 매칭되지 않음(카카오 로그인 기록 없음).`  
appUserId 없음: `- 카카오 회원번호를 받지 못함. 회원 여부를 알 수 없음.`  
조회 실패: `- 회원 조회 실패(DB 연결 문제). 주문 조회가 어려우면 확인 후 안내하겠다고 답한다.`

### 6.5 도구 정의 전문

```json
[
  {
    "name": "run_sql",
    "description": "팜어시 운영 PostgreSQL 에서 읽기 전용 SQL 한 문장을 실행한다. 결과는 {columns, rows, row_count, truncated} JSON 이며 최대 200행, 5초 제한. 쓰기·여러 문장은 거부된다. 시각은 Asia/Seoul. $1, $2 자리표시자를 쓰면 params 에 값을 넣고, 타입은 SQL 에서 캐스팅한다(예: $1::uuid).",
    "input_schema": {
      "type": "object",
      "properties": {
        "sql": { "type": "string", "description": "실행할 SELECT 문 한 개" },
        "params": { "type": "array", "description": "$1, $2 … 에 들어갈 값",
                    "items": { "type": ["string", "number", "boolean", "null"] } }
      },
      "required": ["sql"],
      "additionalProperties": false
    }
  },
  {
    "name": "get_history",
    "description": "이 고객과의 이전 카카오톡 대화를 지금 보이는 것보다 더 앞에서부터 읽는다. 최근 것부터 거꾸로 limit 건. 다시 부르면 그보다 더 앞의 대화를 준다. 더 없으면 빈 결과.",
    "input_schema": {
      "type": "object",
      "properties": { "limit": { "type": "integer", "description": "읽을 메시지 수 (1~20)" } },
      "required": ["limit"],
      "additionalProperties": false
    }
  }
]
```

개선 후보(미적용): `get_history` 설명에 "보통 6건(대화 3번)부터 읽고 부족하면 더" 기준 추가. 1건씩 읽게 하면 왕복이 늘어 오히려 비쌈(왕복 1회 ≈ $0.003~0.006 + 2~4초, 메시지 1건 ≈ $0.0005).

---

## 7. 운영 DB 조회

### 7.1 `POST /chatbot/query` (이미 구현·배포됨)

- 구현: `develop` 의 `server-py/app/chatbot.py`(풀·실행), `main.py`(라우트). 명세: `doc/chatbot/developer-handoff.md`.
- 배포: dev `https://dev.api.farmassi.kr/chatbot/query` (커밋 `360cc0f`), 운영 `https://api.shop.lkim.me/chatbot/query` (버전 `e85bf94` 에서 확인).
- 요청: 헤더 `x-chatbot-key`, 본문 `{"sql": "...", "params": [...]}`. 응답: `{columns, rows, row_count, truncated, elapsed_ms}`.
- 막는 장치: `chatbot_ro` 롤(`public`·`auth` SELECT 만, **`private` 없음**, BYPASSRLS), 전용 풀(최대 3), 매 요청 READ ONLY 트랜잭션 후 롤백, `statement_timeout 5s`, 한 문장만(42601), 200행, `hmac.compare_digest`, 문장 캐시 끔, 시각 텍스트 코덱(KST), 결과 값은 로그에 안 남김.
- 오류 코드: 401 unauthorized / 400 bad_request·sql_error(pg_code)·timeout(57014)·read_only(25006) / 503 disabled.

### 7.2 `chatbot_ro`

- SQL: `doc/chatbot/sql/chatbot-ro.sql` (psql 변수 `dbname` 으로 dev·운영 각각 실행. 테이블 소유자 lkim 으로).
- `private` 를 뺀 이유: `private.bankda_merchant.password`(뱅크다 계정 비밀번호) 등 외부로 나가면 안 되는 값.
- 기존 `ops_ro`(관리자 웹용)는 `private` 까지 읽으므로 챗봇에 쓰지 않음.

### 7.3 백엔드로 옮긴 뒤

챗봇이 같은 서버 안에 있으므로 **HTTP 왕복 없이 `app.chatbot.run(sql, params)` 를 직접 호출**합니다.
`/chatbot/query` 엔드포인트와 `CHATBOT_API_KEY` 는 필요 없어짐 → 환경변수를 지워 503(꺼짐)으로 두거나 라우트 제거.

---

## 8. 시크릿·환경변수

### 8.1 지금 (Supabase Edge Function Secrets)

| 이름 | 용도 | 비고 |
|---|---|---|
| `KAKAO_SKILL_TOKEN` | 카카오 → 스킬 서버 인증 (`x-skill-token`) | 48자 hex. 카카오 스킬 헤더에도 같은 값 |
| `ANTHROPIC_API_KEY` | Claude API | 백엔드 `.env` 의 키를 복사해 넣음 |
| `CHATBOT_API_KEY` | 스킬 서버 → `/chatbot/query` 인증 | 운영 서버 키와 같아야 함 |
| `CHATBOT_QUERY_URL` | 조회 주소 | 지금 `https://api.shop.lkim.me/chatbot/query` (운영). 시험 땐 dev 주소 |
| (자동) `SUPABASE_URL`, `SUPABASE_SECRET_KEYS` 등 | DB 접속 | `@supabase/server` 의 `withSupabase` 가 읽음 |

### 8.2 이전 후 (백엔드 `server/.env`)

| 이름 | 할 일 |
|---|---|
| `KAKAO_SKILL_TOKEN` | **추가**. 같은 값을 쓰거나 새로 만들고 카카오 스킬 헤더도 동시에 교체 |
| `ANTHROPIC_API_KEY` | 이미 있음 |
| `CHATBOT_DATABASE_URL` | 이미 있음(`chatbot_ro`) — 그대로 사용 |
| `CHATBOT_API_KEY` | 챗봇이 직접 호출하면 불필요 → 제거 검토 |
| `CHATBOT_QUERY_URL` | 불필요 |

이전 끝나면 Supabase 시크릿 삭제·프로젝트 일시정지. Supabase 에 복사했던 `ANTHROPIC_API_KEY` 는 교체(rotate) 검토.

---

## 9. 측정값

Supabase 프로토타입 기준 (봇테스트, 운영·개발 DB).

| 항목 | 값 |
|---|---|
| 첫 응답(useCallback) | 웜 0.1초 / 콜드 2.4초 (SDK 지연 import 전 4.5초) |
| 최종 답(콜백까지) | DB 조회 없음 1.9~5.8초, 조회 1~2회 8~12초 |
| Claude 호출 수 | 질문당 1~3회 |
| SQL 수 | 질문당 0~2개, 모두 성공(운영) |

토큰·비용 (Opus 5.5: 입력 $4 / 출력 $20 / 캐시 읽기 $0.20 / 5분 캐시 쓰기 $5, 100만 토큰당):

| 질문 | 입력 | 캐시 쓰기 | 캐시 읽기 | 출력 | 비용 |
|---|---|---|---|---|---|
| 주문 상태 (대화 캐시 전, 2회) | 3,857 | — | 7,064 | 1,004 | 약 $0.037 |
| 주문 상태 (대화 캐시 후, 배포 직후 1회성 재작성 포함) | 6 | 5,471 | 4,365 | 786 | 약 $0.044 |
| "고마워요" (1회) | 4 | 483 | 3,850 | 90 | 약 $0.005 |
| "처음에 알려준 주문번호" (3회, get_history 1번) | 8 | 2,887 | 13,795 | 609 | 약 $0.029 |

운영 DB 첫 조회("제 최근 주문 배송 상태", 3회 호출, SQL 2개)는 11.9초, 출력 1,170토큰.

- 지침+스키마(약 3.8천 토큰)는 캐시됨. 비용의 절반 이상은 **출력(답 + 내부 생각)**.
- 모델별 예상(같은 토큰 가정): Sonnet 5.5($2/$10) 약 절반, Haiku 5.5($0.10/$0.50) 약 1/30. 품질 비교 미실시(§14).

---

## 10. 백엔드 이전 설계

### 10.1 라우트

`POST /kakao/skill` (FastAPI, `server-py/app/main.py` 또는 새 모듈). nginx 는 `location /` 전체를 4310 으로 넘기므로 설정 변경 없음.

### 10.2 처리 흐름

```python
# server-py/app/kakao_skill.py (예시 — 스타일은 기존 코드에 맞출 것)
import asyncio, hmac, os, time
from fastapi import Request
from fastapi.responses import JSONResponse

WAIT_TEXT = "확인하고 있어요. 잠시만 기다려 주세요."
_tasks: set[asyncio.Task] = set()      # 작업 참조 유지 (GC 방지)


def _authorized(header: str | None) -> bool:
    token = (os.environ.get("KAKAO_SKILL_TOKEN") or "").strip()
    return bool(token) and hmac.compare_digest((header or "").strip().encode(), token.encode())


@app.post("/kakao/skill")
async def kakao_skill(request: Request):
    if not _authorized(request.headers.get("x-skill-token")):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    body = await request.json()
    ur = body.get("userRequest") or {}
    started = time.monotonic()

    if ur.get("callbackUrl"):
        task = asyncio.create_task(_answer_by_callback(body, started))
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
        return {"version": "2.0", "useCallback": True, "data": {"text": WAIT_TEXT}}

    # 콜백 없는 요청(스킬 테스트 등)
    ctx = await _log_in(body)
    res = simple_text("콜백이 켜진 블록에서만 답변할 수 있어요.")
    await _log_out(ctx, res, "sync", started, None)
    return res
```

- 기존 `main.py` 의 배송 웹훅(`asyncio.create_task(_process_delivery_webhook(...))` 후 202)과 같은 패턴.
- 대화 저장은 `db.with_admin()`(farmassi_admin) 커넥션으로 `chatbot.*` 에.
- `run_sql` 은 `await chatbot.run(sql, params)` 직접 호출, 예외는 `/chatbot/query` 라우트와 같은 방식으로 `{"error": {...}}` JSON 문자열로 바꿔 tool_result 에 넣음(Claude 가 오류 보고 SQL 을 고침).
- 스키마 목록은 프로세스 메모리에 캐시(워커마다 1번).

### 10.3 Claude 호출

기존 백엔드는 `parse_order_messages.py`, `match_farm_products.py` 에서 httpx 로 `https://api.anthropic.com/v1/messages` 를 직접 부름(`anthropic-version: 2023-06-01`).
챗봇은 도구 반복·캐시·fallbacks 를 쓰므로 공식 SDK(`anthropic`, `AsyncAnthropic`) 추가를 권장. httpx 로 해도 본문 필드는 같음(베타는 `anthropic-beta` 헤더).

```python
import anthropic
client = anthropic.AsyncAnthropic()          # ANTHROPIC_API_KEY 를 env 에서 읽음

resp = await client.with_options(timeout=60).beta.messages.create(
    model="claude-opus-5-5",
    max_tokens=16000,
    betas=["server-side-fallback-2026-07-01"],
    fallbacks="default",
    output_config={"effort": "medium"},
    cache_control={"type": "ephemeral"},
    system=[
        {"type": "text", "text": INSTRUCTIONS + "\n\nDB 스키마 (schema.table: column type, …)\n" + schema,
         "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": customer_context},
    ],
    tools=TOOLS,
    messages=messages,
)

if resp.stop_reason == "tool_use":
    messages.append({"role": "assistant", "content": resp.content})   # thinking 포함 그대로
    results = []
    for block in resp.content:
        if block.type == "tool_use":
            results.append({"type": "tool_result", "tool_use_id": block.id,
                            "content": await run_tool(block.name, block.input), "is_error": ...})
    messages.append({"role": "user", "content": results})
```

- `pyproject.toml` 에 `anthropic` 추가(1.x 는 `httpx2` 기반 — 기존 `httpx` 와 함께 써도 됨).
- 응답 `usage` 의 `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` 를 합산해 out 행 `raw.claude.usage` 에 저장(비용 추적).

### 10.4 시간 제한

- 백엔드에는 Supabase 의 150초 같은 실행 한도가 없음. 대신 **callbackUrl 이 5분 유효**.
- 권장: 답 만들기 전체를 `asyncio.wait_for(..., timeout=240)` 로 감싸고, 넘으면 `BUSY_TEXT` 를 콜백으로 보냄.
- Claude 호출마다 `with_options(timeout=…, max_retries=1)` 로 남은 시간 안에서만 기다리게.

### 10.5 서버 재시작·다중 워커

- 응답 후 도는 작업이라 **API 재시작 중이던 질문은 콜백이 안 나감**(고객은 "확인하고 있어요"만 봄).
  필요하면 처리 대기 행을 DB 에 남기고 시작 시 5분 안 지난 것만 다시 처리.
- `WORKERS` 가 여러 개여도 요청을 받은 워커에서 작업이 돌므로 문제 없음.

---

## 11. 이전 절차 (전환·되돌리기)

1. **dev DB** 에 §4.2 SQL 적용 → dev 서버에 `/kakao/skill` 배포, `.env.dev` 에 `KAKAO_SKILL_TOKEN`.
2. 카카오 스킬 설정에서 **Test URL 만** `https://dev.api.farmassi.kr/kakao/skill` 로 바꿈(헤더 그대로) →
   스킬 화면 "스킬서버로 전송"(Test URL 선택) → 동기 문구가 오면 OK.
   (봇테스트·개발 채널이 URL 과 Test URL 중 무엇을 쓰는지는 확인 필요 — 둘 다 바꿔 시험해도 됨)
3. 봇테스트로 질문 → 콜백 답·`chatbot.kakao_messages` 저장 확인.
4. **운영 DB** 에 §4.2 SQL → 운영 서버 배포·재시작, `server/.env` 에 `KAKAO_SKILL_TOKEN`.
5. 스킬 **URL·Test URL** 을 `https://api.shop.lkim.me/kakao/skill` 로 → 저장.
   (운영 채널이 아직 미배포라 고객 영향 없음. 배포 후라면 저장 즉시 반영되는지 확인 — 시나리오 변경은 배포가 필요하지만 스킬 URL 은 확인 필요)
6. 테스트 채널 실제 카톡으로 질문 → appUserId·회원 매칭·조회·콜백 확인(§12).
7. (선택) Supabase 데이터 이전(§4.3).
8. Supabase: 시크릿 삭제, Edge Function 삭제 또는 프로젝트 일시정지. `ANTHROPIC_API_KEY` 교체 검토.
9. `/chatbot/query`·`CHATBOT_API_KEY` 정리(§7.3).

**되돌리기**: 스킬 URL·Test URL 을 Supabase 주소로 되돌리면 끝(Supabase 쪽을 지우기 전까지).

---

## 12. 이전 후 확인 목록

- [ ] 키 없이 `POST /kakao/skill` → 401
- [ ] 스킬 화면 "스킬서버로 전송" → 동기 문구, `via='sync'` 행
- [ ] 봇테스트 "판매 중인 상품 뭐 있어요?" → 상품 목록, SQL 200
- [ ] 봇테스트 "제 최근 주문 배송 상태 알려주세요" → 본인 주문, 회원 매칭(`member_id`)
- [ ] 실제 카톡(테스트 채널) → `app_user_id`, `plusfriend_user_key` 저장
- [ ] "고마워요" → 도구 없이 1회 호출
- [ ] 앞앞 대화를 묻는 질문 → `get_history` 호출 기록
- [ ] `chatbot_ro` 로 `chatbot.*`·`private.*` 조회 불가 (42501)
- [ ] 첫 응답 시간 < 1초, 최종 답 < 15초
- [ ] out 행 `raw.claude.usage` 기록
- [ ] API 재시작 직후 첫 질문도 5초 안에 첫 응답

---

## 13. 겪은 문제와 주의점

| 문제 | 원인 | 해결/주의 |
|---|---|---|
| 스킬 401 | `openssl rand … \| pbcopy` 가 **끝 줄바꿈까지 복사** → Supabase 시크릿(여러 줄 입력 허용)에만 줄바꿈 | 비교 전 양쪽 `strip()`. 복사는 `tr -d '\r\n'` |
| `/chatbot/query` 401 | Supabase 에 넣은 `CHATBOT_API_KEY` 와 개발자가 서버에 넣은 키(64자)가 다름 | 서버 키를 기준으로 맞춤. Supabase 시크릿 목록의 SHA256 다이제스트로 값 노출 없이 비교 가능 |
| 첫 응답 5초 근접 | Supabase 콜드 스타트 + Anthropic SDK 로딩(약 2초) | SDK 지연 import, 응답 먼저·저장 나중. 백엔드는 해당 없음 |
| 테스트 채널 메시지가 봇에 안 감 | 개발자용 채널 **채팅 기본 꺼짐** | 파트너센터 → 채팅 설정 → 켜기 |
| 봇테스트에서 "회원 아님" | 봇테스트 요청엔 appUserId 없음 | 저장된 `app_user_id` 로 대체 |
| 시각이 UTC 로 나옴 | asyncpg 가 timestamptz 를 UTC datetime 으로 변환 | 텍스트 코덱 + `timezone=Asia/Seoul` (개발자 구현에 반영됨) |
| Edge Function JWT | Supabase 기본은 JWT 필수 → 카카오가 보낼 수 없음 | `withSupabase({auth:"none"})` + 함수 설정 "Verify JWT" OFF |
| Supabase 새 키 체계 | 새 프로젝트는 `sb_secret_…` 키 (`SUPABASE_SECRET_KEYS`) | `@supabase/server` 사용. 백엔드는 해당 없음 |
| 개발 DB 답이 이력에 남음 | 개발 DB 로 시험한 답(없는 주문번호)이 대화 이력에 남아 운영 전환 후 Claude 가 정정하느라 조회 1회 추가 | 테스트 대화 삭제 여부 결정 필요(미삭제) |
| 고객센터 연락처 | 팜어시 채널에 휴대폰 번호가 공개 노출 | 사업용 번호·URL 로 교체 검토 |
| 스킬 테스트("스킬서버로 전송") | 콜백 URL 이 없어 동기 경로로 감 | 정상. Claude 답은 봇테스트·실제 채널로 확인 |

---

## 14. 고객 공개(운영 채널 배포) 전에 할 것

1. **조회 범위 제한 (필수)** — 지금 Claude 는 `public`·`auth` 전체를 읽고, "다른 고객 정보 금지"는 프롬프트로만 막음.
   비회원이 "제 번호 010-… 주문 알려줘" 라고 하면 남의 주문이 나갈 수 있음.
   - 회원: 서버가 `user_id` 로 범위를 고정한 도구(예: `my_orders`, `my_shipments`)로 바꾸거나, 범위 고정 뷰 + 행 필터.
   - "누구의 데이터인지"는 Claude 가 아니라 **서버 코드**가 정함.
2. **비회원 조회 설계 (결정: 주문 시점 연결 방식)**
   - 카톡으로 주문할 때 서버가 `(카톡 사용자 키, 주문번호)` 를 기록 → 나중에 같은 사용자에게 **그 주문만** 보여줌.
   - 사용자 키는 카카오가 붙여 보내 위조 불가. 저장은 `plusfriend_user_key`(채널 기준, 봇이 바뀌어도 유지) + `bot_user_key`.
   - **고객이 나중에 입력한 주문번호로 묶으면 안 됨**(남의 주문번호를 알면 조회 가능).
   - 연결 테이블 예: `chatbot.order_links(kakao_user_id, order_no, linked_at, source)`.
   - 묶는 방법은 카톡 주문 방식에 따라 다름 — **미정**:
     | 주문 방식 | 묶는 방법 |
     |---|---|
     | 봇이 주문서 링크를 보내고 고객이 웹 작성 | 링크에 서명 토큰(사용자 키) → 주문 생성 시 저장 |
     | 채팅 내용을 보고 농가·상담원이 대신 입력 | 상담 화면에 "이 대화와 주문 연결" 기능 필요 |
     | 봇이 대화로 주문을 받아 생성 | 생성 시 바로 기록 — `doc/기획-챗봇-주문검수-작업.md` 의 `create-farm-orders` 흐름과 연결 |
   - 카톡을 거치지 않은 주문은 연결이 없음 → 카카오 로그인 유도, 또는 휴대폰 인증번호·주문번호+뒤 4자리 방식(검토만 함) 병행.
3. **답변 마스킹**: 이름(김*수), 주소(시·구까지), 전화(010-****-5678).
4. **상담원 전환**: 배포하면 운영 채널 채팅이 전부 봇으로 감 → "상담원 연결" 경로 필요.
5. **개인정보처리방침**: 카카오톡 상담 내용 수집·보관 기간 추가. 보관 기간 지난 대화 삭제 작업.
6. **비용·모델 결정**: 실제 질문 15개 정도로 Opus medium / Opus low / Sonnet 5.5 / Haiku 5.5 비교(시험비 $3 이내 예상) 후 선택.
   Haiku 는 server-side fallbacks 미지원 → 그 파라미터 빼야 함.
7. **자주 묻는 단순 질문**은 카카오 블록·버튼 고정 답변(비용 0)으로 분리 검토.
8. **테스트 대화 정리**: 개발 DB 시절 답이 담긴 테스트 이력 삭제 여부.
9. **봇 배포**: 챗봇 관리자센터 → 배포 (최대 30분 소요). 배포해야 운영 채널에 연결됨.

---

## 15. 결정 기록

순서대로 (2026-11-24 봇 생성 ~ 11-26):

| # | 결정 | 이유 |
|---|---|---|
| 1 | 운영 채널 = 팜어시, 테스트는 새 개발자용 채널 | 실제 농가 채널은 고객에게 바로 노출됨 |
| 2 | 운영 채널 배포 보류 | 고객은 1:1 채팅 유지 |
| 3 | 스킬 서버를 Supabase Edge Function 으로 (임시) | 빠른 프로토타입. 나중에 백엔드로 합침 |
| 4 | 콜백 사용, 첫 응답 즉시 | 카카오 5초 제한 |
| 5 | 카카오 의도 분류 안 씀 — 전부 폴백 → Claude | 블록 관리·오분류 없이 시작, 쌓인 대화 보고 FAQ 분리 |
| 6 | 운영 DB 는 API 서버 읽기 전용 엔드포인트로 | 운영 DB 가 외부에 안 열려 있음(서버 Mac 로컬) |
| 7 | 프로토타입은 DB 전체 조회 허용, 단 `private` 제외 | 무엇을 조회할지 아직 미정 / 뱅크다 비밀번호 등 |
| 8 | dev 로 먼저 시험 후 운영 DB 연결 | 개발자 진행 순서 |
| 9 | 150초 실행 한도 대응 안 함 | Supabase 한정, 백엔드 이전 예정 |
| 10 | 이전 대화: 직전 1회 + `get_history` | 비용 절감(대화가 길어질수록 효과) |
| 11 | 대화 캐시(최상위 `cache_control`) | 한 질문 내 반복 호출 입력 비용 절감 |
| 12 | 비회원 조회: 주문 시점에 카톡 사용자 키와 주문 연결 | 인증번호 없이 안전. 구체 방식은 미정 |

---

## 16. 참고 자료

카카오 공식 문서 (kakaobusiness.gitbook.io, `.md` 를 붙이면 마크다운으로 받음):
- 스킬 응답 형식: `/main/tool/chatbot/skill_guide/answer_json_format`
- 콜백 개발 가이드: `/main/tool/chatbot/skill_guide/ai_chatbot_callback_guide`
- 블록에 스킬 적용: `/main/tool/chatbot/skill_guide/apply_skill_to_block`
- 봇 설정(채널·앱 연결): `/main/tool/chatbot/main_notions/bot_setting`
- Event API: `/main/tool/chatbot/main_notions/event-api`

저장소:
- `feat/kakao-chatbot` — `kakao-chatbot/supabase/functions/kakao-skill/index.ts`, `kakao-chatbot/supabase/migrations/0001_kakao_chatbot.sql`, `doc/kakao-chatbot/developer-handoff.md`, `dev-channel-steps/*.png`(개발자용 채널 만들기 화면)
- `develop` — `server-py/app/chatbot.py`, `server-py/app/main.py`(`/chatbot/query`), `doc/chatbot/`
- `server/db/005_ops_readonly.sql` (`ops_ro` — 챗봇에 쓰지 않음)
- `doc/alimtalk/` (알림톡 템플릿·발송)

관리 화면:
- 챗봇: `https://chatbot.kakao.com/bot/6b051fe5217e92b3b673d606`
- 파트너센터: `https://business.kakao.com/space/10643873/channel/_xlQaSX` (팜어시), `…/space/10801810/channel/_TkmvX` (테스트)
- 디벨로퍼스 앱: `https://developers.kakao.com/console/app/1547504`
- Supabase: `https://supabase.com/dashboard/project/ltqvhmogekvpplpwtymc`

---

## 부록 A. 조사한 카카오 기능 요약

| 기능 | 요점 |
|---|---|
| **챗봇 관리자센터 vs 카나나** | 직접 만든 스킬 서버를 붙이려면 챗봇 관리자센터(스킬). 카나나 상담매니저는 채팅 설정의 AI 답변 기능(테스트 채널에서 꺼짐) |
| **개발자용 채널** | 이미 등록된 사업자 정보로 만들어 별도 사업자 인증 불필요. 사업자번호당 1개, 검색 불가, "(테스트)" 접두어, 프로필 사진 없음 |
| **user 식별자** | `user.id`(botUserKey, 봇별 고정), `plusfriendUserKey`(채널 기준, 옛 자동응답 user_key 와 같음), `appUserId`(앱 연결 시, 로그인 회원번호), `isFriend` |
| **디벨로퍼스 앱 연결 vs 콜백** | 앱 연결 = appUserId 받기 + Event API 전제. 콜백 = 5초 넘는 답을 5분 안에 보내기. 서로 무관 |
| **Event API** | 봇이 먼저 메시지 보내기. `POST https://bot-api.kakao.com/v2/bots/{botId}/talk` (개발 채널은 `{botId}!`), `Authorization: KakaoAK {REST API 키}`, 요청당 100명, 채널 친구에게만, 건당 15원+VAT(개발 채널도 과금). 광고성은 (광고) 표기·08:00~20:50·고객센터 연락처 필요. appUserId 로는 개발 채널 발송 불가 |
| **알림톡과의 차이** | 알림톡은 전화번호 기반·친구 아니어도 됨·템플릿 심사·문자 대체 발송(딜러사). Event API 가 알림톡을 대체하지 않음 |
| **고객센터 연락처가 필요한 기능** | 알림톡·브랜드메시지(비즈 채널 + 홈 공개 ON + 연락처), 채널 메시지(광고·정보 모두), Event API 광고성. 팜어시 채널은 세 조건 충족 |
| **스킬 등록** | 심사 없음. Callback 설정도 블록 ⋯ 메뉴에서 바로 가능 |
| **배포** | 최대 30분. 운영 채널은 첫 배포 후 연결. 개발 채널은 저장 상태 즉시 반영 |

---

## 17. 주문 검수·등록 (11-27 추가)

농가 회원이 손님에게 받은 주문 내용을 카톡으로 보내면, 챗봇이 검수하고 부족한 것을 되물은 뒤
**사용자가 확인하면** 주문으로 등록합니다. 화면의 「직접 추가하기」(`src/pages/farm/OrderCreate.tsx`)와 같은 판정을 씁니다.

### 17.1 쓰는 API (백엔드, `develop` 커밋 `9523104`)

```
POST {API}/chatbot/rpc/review-farm-orders     검수 (저장 안 함, 상태도 저장 안 함)
POST {API}/chatbot/rpc/create-farm-orders     등록 (전부 아니면 전무)
x-chatbot-key: <CHATBOT_API_KEY>              본문에 kakaoUserId(= appUserId) 추가
```

- 명세: `develop` 의 `doc/chatbot/order-review.md`, `doc/backend/orders/command/review-farm-orders.md`
- 서버가 `kakaoUserId` 로 회원을 찾아 **그 회원 권한으로** 실행(슈퍼어드민 또는 그 농가 `farm_members`).
- 배포: dev `https://dev.api.farmassi.kr` ✅ (`d8d68b6`) / 운영 `https://api.shop.lkim.me` ❌ (404, 11-27 기준)
- 주소는 `CHATBOT_QUERY_URL` 의 호스트에서 만든다(`/chatbot/query` → `/chatbot/rpc/{name}`). 조회와 같은 키.

### 17.2 검수 중간 상태 — `kakao_order_drafts`

검수 API 가 상태를 저장하지 않아서, 직전 응답의 `orders` 를 통째로 보관했다가 다음 요청에 그대로 돌려보냅니다.
`addressToken`(서버 서명) 같은 값이 Claude 를 거치지 않게 하려는 것입니다. SQL: `kakao-chatbot/supabase/migrations/0002_kakao_order_drafts.sql`

| 컬럼 | 뜻 |
|---|---|
| `kakao_user_id` (pk) | 사용자당 한 묶음 |
| `farm_id`, `farm_name` | 어느 농가 주문인지 |
| `pending_text` | 농가를 못 정해(`farm_required`·`no_farm`) 아직 검수하지 못한 원문 |
| `orders` | review 응답의 `orders` 그대로 |
| `summary`, `save_request` | `{total, ready, needsFix}`, 전부 ok 일 때의 등록 요청 |
| `saving_at` | 등록 요청을 보냈는데 결과를 모를 때 남음(중복 등록 방지) |
| `rev` | 쓸 때마다 바뀜. 동시에 온 메시지끼리 덮어쓰지 않게 비교 |
| `updated_at` | 24시간 지나면 버림 |

백엔드로 옮길 때는 §4.2 와 같이 **`chatbot` 스키마**에 둡니다(`chatbot_ro` 가 읽지 못하게).

### 17.3 Claude 도구 (기존 `run_sql`, `get_history` 뒤에 순서 고정)

| 도구 | 입력 | 하는 일 |
|---|---|---|
| `review_orders` | `source`(current_message·pending·text), `text?`, `farm_id?`, `append?` | 원문 검수. current_message 면 **방금 받은 발화를 코드가 그대로** 넘김(Claude 가 옮겨 적지 않음) |
| `select_address` | `order_no`, `candidate_no`, `address_detail?` | 사용자가 고른 주소 후보 반영 (`targetIndex` = no-1) |
| `patch_order` | `order_no` + 고칠 칸(`address`, `address_detail`, `recipient_name`, `phone`, `sender_name`, `sender_phone`, `depositor_name`, `memo`, `product_no`, `product_query`, `quantity`) | 칸 고치고 재검수. `product_no` 는 코드가 후보의 `productId` 로 바꿈 |
| `remove_order` | `order_no` | 한 건 빼고 나머지 `recheck` |
| `recheck_orders` | — | 전체 재검수 |
| `save_orders` | — | 보관한 `save_request` 를 **그대로** `create-farm-orders` 에 보냄 |
| `cancel_orders` | — | 검수 내용 삭제 |

Claude 에게는 주문마다 요약(`no`, `status`, 받는 분, 주소, 상품, 수량, `errors`, 번호 붙은 후보 최대 10개)만 보여 줍니다.
같은 요약이 system 두 번째 블록의 "진행 중인 주문 검수"에도 들어가, 다음 메시지("2번", "등록")에서 문맥을 압니다.

### 17.4 코드로 막아 둔 것

| 규칙 | 구현 |
|---|---|
| 누구 권한인지는 카카오가 준 값으로만 | `kakaoUserId` 는 `ctx.appUserId` 로만 채움. 도구 입력에 없음 |
| **확인 전에는 등록 안 함** | `save_orders` 는 "이 메시지를 받기 전에 이미 전부 ok" 이고 "이번 처리 중 검수가 안 바뀜" 일 때만 실행. 아니면 `confirm_first` |
| 중복 등록 방지 | 등록 요청 전에 `saving_at` 기록. 응답을 못 받으면(시간 초과·502·504) 남겨 두고 재전송 거부(`save_in_doubt`) → Claude 가 `run_sql` 로 실제 등록 여부 확인 |
| 서버가 거절(4xx)하면 | 한 건도 안 들어간 것이므로 `saving_at` 지우고 검수 유지 |
| 동시에 온 메시지 | 쓰기 전에 `rev` 비교. 새 원문 검수는 **덮어쓰지 않고 합쳐서** `recheck`, 고치기·등록은 거부하고 현재 상태를 돌려줌 |
| 농가를 못 정함 | 원문을 `pending_text` 에 보관 → 사용자가 농가를 고르면 `review_orders(source=pending, farm_id)` |

### 17.5 지침에 추가한 내용 (system 블록 1 끝)

"주문 등록 (농가 회원용)" 단락: 원문을 고치지 않고 넘길 것, 확인이 필요한 주문은 번호 앞선 것부터 하나씩 물을 것,
후보가 1건이어도 사용자가 확인하기 전엔 고르지 않을 것, 말하지 않은 값을 추측해 채우지 않을 것,
전부 ok 가 되면 농가·주문 내용을 보여 주고 등록할지 묻되 그 답에서는 등록하지 않을 것, 도구가 성공하지 않았으면 등록됐다고 말하지 않을 것,
오류 code 별 안내(`not_linked`·`no_kakao_id`·`farm_required`·`no_farm`). 전문은 `index.ts` 의 `INSTRUCTIONS`.

### 17.6 함께 바뀐 것

- 긴 답은 줄 경계에서 잘라 **말풍선 최대 3개**(각 1000자)로 보냄 (`splitForKakao`). 넘치면 마지막을 "…" 로 자름.
- `MAX_TOOL_ROUNDS` 6 → 8.
- out 행 `raw.claude` 에 `order_tools`(부른 도구), `rpc`(`{name, action, status, code, ms}`), `saved`(`{id, order_no, total}`) 추가. 주문 내용·전화번호는 여기에 남기지 않음(대화 원문에는 남음).

### 17.7 시험 결과 (dev 서버, 봇테스트, 11-27)

| 보낸 말 | 결과 |
|---|---|
| 주문 원문 (농가 언급 없음) | `farm_required` → 연결된 농가 5곳을 보여 주고 물음 (6.0초) |
| "4" | 보관한 원문으로 진영농원 재검수 → 주소 후보 2건 중 고르라고 물음 (검수 5.5초, 전체 11.5초) |
| "1번" | 주소 반영 → 전부 ok → 내용 보여 주고 "이대로 등록할까요?" (4.7초, 등록 안 함) |
| "네 등록해 주세요" | `create-farm-orders` 200 (78ms) → 주문번호 `FA20261127-J5EM`, 45,000원 안내 (3.2초) |
| 동·호 없는 주문 + "확인 필요 없이 바로 등록해" | 검수만 하고 주소·동호를 물음. 등록 안 함 |
| "2번이고 103동 801호야. 바로 등록해" | 주소·동호 반영, 내용 보여 주고 다시 확인 요청. 등록 안 함 |
| "아니야 이건 취소할게" | `cancel_orders` → 검수 내용 삭제 |

- 코드 차단 로직은 로컬 시험(가짜 DB·가짜 fetch)으로 17개 확인: 확인 전 등록 차단, 같은 턴 변경 후 차단, 동시 변경 차단,
  결과 불명 시 재전송 거부, 4xx 후 검수 유지, 동시 도착 주문 합치기, `pending` 재검수, `targetIndex`·`orders` 전달.
- dev DB 에 시험 주문 1건이 남아 있음: `FA20261127-J5EM` (진영농원, 받는 분 "테스트").

### 17.8 알아 둘 한계

- 원문 검수는 백엔드에서 Claude 파싱을 거쳐 수 초~수십 초. Supabase 함수 150초 한도와 nginx 프록시 타임아웃(기본 60초)에 걸릴 수 있음.
- 검수 내용은 사용자당 한 묶음, 24시간 보관. 한 번에 50건(백엔드 제한).
- 메시지를 연달아 여러 개 보내면 답이 메시지마다 따로 오고, 순서는 보장되지 않음(내용은 합쳐짐).
- `kakaoUserId` 는 키를 가진 쪽이 넘기는 값이라, **`CHATBOT_API_KEY` 가 새면 아무 회원으로 주문을 넣을 수 있음** (백엔드 문서 §4).

### 17.9 백엔드로 옮길 때

- `kakao_order_drafts` → `chatbot.order_drafts` (§4.2 방식, `farmassi_admin` 만).
- HTTP 대신 `FUNCTIONS["review-farm-orders"](FnCtx(user_id=uid, body=..., admin=conn))` 직접 호출.
  `uid` 는 `auth.identities` 에서 `appUserId` 로 찾은 값(지금 `/chatbot/rpc` 라우트가 하는 일 그대로).
- 동시성은 `rev` 비교 대신 사용자별 락(`pg_advisory_xact_lock(hashtext(kakao_user_id))`)으로 순서대로 처리하는 편이 단순.
- 등록 결과 불명(`saving_at`) 처리는 같은 프로세스 안에서는 필요 없어짐(함수 호출이 예외 아니면 결과가 확실).

