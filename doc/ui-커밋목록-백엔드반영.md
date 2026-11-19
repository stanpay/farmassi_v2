# f5add51 이후 커밋 요약 · 백엔드 반영

범위: `f5add51` ~ `01aadcb` (ui 라인 → main merge)  
기준: `server/`, `server-py/`, `supabase/` 변경이 있으면 백엔드 반영 O

## 커밋별 요약

| # | 커밋 | 날짜 | 작업 요약 | 백엔드 |
|---|------|------|-----------|--------|
| 1 | `f5add51` | 09-09 | `.gitignore`에 `env-vault` 추가 | ❌ |
| 2 | `5eaba89` | 09-16 | 농가 직접주문 추가 버튼·페이지 + 데모 데이터 | ❌ |
| 3 | `d211c99` | 09-17 | 입금 확인/관리 강화, 고객·입금 UI, 권한(`isFarmMember`), epost-address, 민감정보 마스킹, 로컬 인증 우회 | ✅ |
| 4 | `faa032f` | 09-22 | 기존 Supabase Edge Functions 연결 코드 삭제 | ✅ (삭제) |
| 5 | `c091f1d` | 11-07 | 메시지상 “입금 관리 개선”이지만 문서 2개만 추가 | ❌ |
| 6 | `d3f0e02` | 11-08 | 카톡 주문 Claude 파싱, 주소/상품 검증, 직접주문 실데이터 연동 | ✅ |
| 7 | `9a59eca` | 11-08 | `merge(ui)` — 위 파싱·검증 작업 main 반영 | ✅ (머지) |
| 8 | `77f8fa6` | 11-08 | Capacitor/Android + 자동문자(Auto SMS) UI·네이티브 플러그인 | ✅ (마이그레이션만) |
| 9 | `46cd23f` | 11-08 | 카카오 로그인·연락처·PWA/아이콘, Auto SMS 연락처 선택 | ✅ |
| 10 | `5134092` | 11-08 | `merge(ui)` — 카카오/Auto SMS/Capacitor main 반영 | ✅ (머지) |
| 11 | `962c94d` | 11-10 | 브랜드 회사정보 + SiteFooter 공통 적용 | ❌ |
| 12 | `01aadcb` | 11-10 | `merge(ui)` — 푸터/브랜드 main 반영 | ❌ |

## 백엔드 반영된 커밋 상세

### `d211c99` (2026-09-17) — 입금 권한 완화 + 우체국 주소 API

**한줄:** 입금 확인/매칭을 관리자 전용에서 **소속 농가 멤버도 가능**하게 바꾸고, 우체국 우편번호 조회 API를 서버에 추가했다.

#### 1) `isFarmMember` 유틸 추가

`farm_members` 테이블에서 `(farm_id, user_id)` 존재 여부를 본다.

| 런타임 | 파일 |
|--------|------|
| Node | `server/src/shared/util.ts` → `isFarmMember()` |
| Python | `server-py/app/shared/util.py` → `is_farm_member()` |
| (당시) Edge | `supabase/functions/_shared/http.ts` → `isFarmMember()` |

#### 2) `confirm-deposit` 권한 변경

- **이전:** 관리자만 (`isAdmin` 아니면 403 `"관리자만 입금을 확인할 수 있습니다."`)
- **이후:** 관리자 **또는** 해당 주문의 `farm_id` 멤버
  - 실패 메시지: `"이 주문의 입금을 확인할 권한이 없습니다."`
- 동작 자체는 동일: `pending_deposit` → `paid`, `deposit_confirmed_at` 기록, 농가 멤버 푸시

수정 파일:

- `server/src/functions/confirmDeposit.ts`
- `server-py/app/functions/confirm_deposit.py`
- `supabase/functions/confirm-deposit/index.ts` (이후 `faa032f`에서 삭제됨)

#### 3) `match-deposit` 권한 변경

관리자 전역 차단을 제거하고, action별로 농가 단위 권한을 검사한다.

| action | 권한 규칙 |
|--------|-----------|
| `ignore` | 입금(`deposit.farm_id`)을 관리할 수 있어야 함 |
| `unmatch` | 동일. 주문도 `pending_deposit`으로 되돌림 |
| `match` (기본) | 주문의 `farm_id` 관리 가능해야 함. 비관리자는 **다른 농가 입금 ↔ 주문 연결 금지** (`deposit.farm_id !== order.farm_id`) |

`canManageFarm(farmId)` = 관리자이거나 `isFarmMember(farmId)`.

수정 파일:

- `server/src/functions/matchDeposit.ts`
- `server-py/app/functions/match_deposit.py`

#### 4) 신규 RPC `epost-address`

우정사업본부 **우편번호 정보조회** Open API 프록시. `serviceKey`를 브라우저에 안 넘기기 위해 서버에서만 호출.

| 항목 | 내용 |
|------|------|
| 엔드포인트 | `POST /rpc/epost-address` |
| 외부 API | `openapi.epost.go.kr` … `getNewAddressListAreaCdSearchAll` |
| 환경변수 | `EPOST_SERVICE_KEY` (인코딩 키 `%2B` 등이면 decode 후 재인코딩) |
| 인증 | 로그인 필수 |
| 요청 | `query`(필수, 2글자+), `countPerPage`(기본 20, 최대 50), `currentPage`(기본 1) |
| 응답 | `results[]`: `id`, `zipNo`, `roadAddress`(lnmAdres), `jibunAddress`(rnAdres) |
| 구현 | Node 정규식 XML 파싱 / Python `ElementTree` |

등록:

- `server/src/functions/epostAddress.ts` + `index.ts`에 `'epost-address'`
- `server-py/app/functions/epost_address.py` + `__init__.py` 등록
- (당시) `supabase/functions/epost-address/index.ts`도 같이 추가 → 다음 커밋에서 삭제

문서: `doc/backend/address/read/epost-address.md`

#### 변경량 (백엔드만)

`server` + `server-py` + `supabase/functions` 13 files, **+393 / −13**

---

### `faa032f` (2026-09-22) — Supabase Edge Functions 삭제 (이전 정리)

**한줄:** API를 자체 Node/Python 서버로 옮긴 뒤, 남아 있던 **Supabase Edge Function 코드·설정·parity 테스트**를 통째로 지웠다. 새 API 추가는 없고 **삭제·문서 정리**다.

#### 삭제한 Edge Functions

| 경로 | 역할(삭제 전) |
|------|----------------|
| `approve-farm` | 농가 승인 |
| `confirm-deposit` | 입금 확인 |
| `create-order` | 주문 생성 |
| `deposit-callback` | 입금 콜백 |
| `epost-address` | 우체국 주소 (`d211c99`에서 막 추가된 것 포함) |
| `kpost-shipment` | 우체국 송장 |
| `naver-address` | 네이버 주소 |
| `scrape-deposits` | 입금 스크래핑 |
| `send-push` | 푸시 발송 |

#### 삭제한 공유 모듈 / 설정

- `_shared/bankda.ts`, `depositMatch.ts`, `depositMatching.ts`, `http.ts`, `push.ts`
- `supabase/config.toml`
- `server/test/parity.ts` (Edge ↔ Node 동작 비교 테스트)

#### README / 운영 안내 변경

- 카카오 Redirect URI: Supabase Auth 콜백 → **자체 API** `…/auth/kakao/callback`
- 입금 스크래핑·확인 호출처: `*.supabase.co/functions/v1/…` → `POST /rpc/scrape-deposits`, `POST /rpc/confirm-deposit`
- VAPID·뱅크다 설정 위치를 Edge secrets → `server/.env` 로 안내 수정
- `.cursor/mcp.json`, `eslint.config.js` 정리

#### 변경량

19 files, **+22 / −1759** (대부분 삭제)

---

### `d3f0e02` (2026-11-08) — 카톡 주문 파싱·상품 매칭·건물 동호 조회 API

**한줄:** 직접주문용으로 Claude 기반 파싱/매칭 API 2개 + 행안부 도로명 건물 동·호 API 1개를 Node·Python에 동시에 추가했다. (프론트 연동·주소 검증 로직도 이 커밋에 포함되지만, 아래는 백엔드만)

백엔드 변경량: 14 files, **+1373** (`server` / `server-py` / `doc/backend`)

공통:

- 세 RPC 모두 **로그인 필수**
- Claude 모델: `claude-sonnet-5-5` → `https://api.anthropic.com/v1/messages`
- 로컬: Vite 프록시 `POST /__dev/…` (`vite.parseOrderDevProxy.ts`, `vite.jusoDevProxy.ts`)가 같은 키로 대신 호출
- API 키는 서버 env만 (`VITE_*` 금지)

---

#### A) `POST /rpc/parse-order-messages`

카톡 대화 원문 → 주문 JSON.

| 항목 | 내용 |
|------|------|
| 요청 | `text` (필수) — 대화 원문 그대로 |
| env | `ANTHROPIC_API_KEY` |
| 구현 | `server/src/functions/parseOrderMessages.ts`, `server-py/app/functions/parse_order_messages.py` |

**Claude 역할 (분리·병합·무시):**

- 받는분/배송지가 보이면 주문. 다르면 별도 주문
- 부족한 조각은 일단 미연결 → 기존 주문과 단서(지역·이름·전화·상품, 오타·약칭 포함)가 있으면 `supplements`로 병합
- 재전송·닉네임 등은 최상위 `ignored`
- 어디에도 안 들어간 구간은 응답에 안 넣음 → 프론트가 빨간 “미연결”로 표시

**서버 후처리 (문자열 충실성):**

- 모델이 글자를 바꿔 써도, 서버가 원문에서 **공백 무시 매칭**으로 구간을 다시 찾아 덮어씀
- 전화/주소 **포맷 교정은 하지 않음** (원문 부분문자열 유지)
- `depositorName` 채움 우선순위: 입금자 → 보내는분 → 받는분

**응답 `orders[]` 필드:**

`raw`, `blockStart`/`blockEnd`, `recipientName`, `phone`, `address`, `addressDetail`, `product`, `quantity`, `senderName`, `senderPhone`, `depositorName`, `memo`, `highlight`, `supplements[]`  
+ 최상위 `ignored[]`

문서: `doc/backend/orders/command/parse-order-messages.md`

---

#### B) `POST /rpc/match-farm-products`

로컬 점수 매칭 실패 건만 Claude에 넘기는 **농가 카탈로그 상품 매칭**.

| 항목 | 내용 |
|------|------|
| 요청 | `queries: string[]` (상품 문구), `products: { id, name }[]` |
| 응답 | `productIds` — queries와 같은 길이, 매칭 id 또는 `null` |
| env | `ANTHROPIC_API_KEY` |
| 구현 | `server/src/functions/matchFarmProducts.ts`, `server-py/app/functions/match_farm_products.py` |

예: `포도 5kg` → 카탈로그 `캠벨 5kg`의 id  
(1차 매칭은 프론트 `matchFarmProduct` — 정확/포함/무게·품종 점수, 1건으로 좁혀질 때만 확정)

문서: `doc/backend/orders/command/match-farm-products.md`

---

#### C) `POST /rpc/juso-building`

행정안전부 도로명주소 API 프록시. 확정된 도로명 주소의 **동·호 목록** 조회.

| 항목 | 내용 |
|------|------|
| 요청 | `address` (필수, 괄호 참고항목은 서버에서 절단), `dong` (옵션, `103`/`103동` 모두 가능) |
| env | `JUSO_SEARCH_API_KEY` (검색), `JUSO_DETAIL_API_KEY` (상세주소) |
| 구현 | `server/src/functions/jusoBuilding.ts` + `jusoBuildingLookup.ts`, `server-py/app/functions/juso_building.py` |

**응답:**

| 필드 | 의미 |
|------|------|
| `found` | 검색 API에서 건물 1건 특정 여부 |
| `apartment` | 공동주택 (`bdKdcd == 1`) |
| `buildingName` | 건물명 |
| `dongs` | 주거용 동 (상가·관리동 제외). 동 없는 단일 건물이면 `[]` |
| `hos` | 해당 동의 호 목록. 동 미특정 시 `null` |
| `hoDong` | `hos`를 조회한 동 (`''` = 동 이름 없는 건물) |

프론트 `checkAddressDetail` 규칙(서버가 강제하진 않음): 공동주택/등록 호 있으면 호 필수, 주거 동 2개+면 동 필수, 목록에 없으면 확인 요청.

문서: `doc/backend/address/read/juso-building.md`

---

#### 라우터 등록

- Node: `server/src/functions/index.ts`에 `parse-order-messages`, `match-farm-products`, `juso-building`
- Python: `server-py/app/functions/__init__.py` 동일 키 등록

---

### `77f8fa6` (2026-11-08) — `farms.auto_sms` 마이그레이션만

**한줄:** Auto SMS(콜백문자)용 DB 컬럼만 추가. RPC/서버 핸들러 변경 없음. 발신·규칙은 기기(Android 플러그인) + 프론트가 `farms` 행을 읽고 쓴다.

#### 마이그레이션 `supabase/migrations/20261108000000_farms_auto_sms.sql`

```sql
alter table public.farms
  add column if not exists auto_sms jsonb not null default '{}'::jsonb;

alter table public.farms
  add constraint farms_auto_sms_is_object
  check (jsonb_typeof(auto_sms) = 'object');
```

- 컬럼 의미: **콜백문자 규칙·제외 번호** 저장
- 주석: `자동 발신 스위치는 기기에만 둔다` (서버/DB가 켜짐·꺼짐을 권위로 두지 않음)
- RLS는 기존 `farms_update` (`admin` 또는 `is_farm_member`)로 갱신

이 커밋의 나머지(Capacitor 8.6, Android `AutoSmsPlugin`, `/farm/.../auto-sms` UI, `share_text` 연동)는 **앱·프론트** 범위.

문서: `doc/database/farms.md` (`auto_sms` 컬럼), `doc/ui/auto-callback-sms.md`

---

### `46cd23f` (2026-11-08) — 카카오 로그인 앱 커스텀 스킴 핸드오프

**한줄:** 안드로이드 앱 카카오 로그인 콜백(`kr.farmassi.app://auth/callback…`)을 허용하고, 카카오톡 인앱 브라우저가 **커스텀 스킴 302를 무시**하는 문제를 HTML 핸드오프로 우회했다.

#### 변경 파일

| 파일 | 역할 |
|------|------|
| `server/src/kakao.ts` | Node 카카오 OAuth |
| `server-py/app/kakao.py` | Python 카카오 OAuth |
| `server-py/app/main.py` | `/auth/kakao/callback` 응답 분기 |

백엔드 변경량: 3 files, **+86 / −7**

#### 1) `safeRedirect` / `safe_redirect` 허용 범위 확장

- **이전:** `siteOrigin`(및 localhost)만 — 열린 리다이렉트 방지
- **이후:** 앱 콜백도 허용  
  - scheme: `kr.farmassi.app`  
  - host: `auth`  
  - path: `/callback` (또는 그 prefix)

#### 2) 앱 콜백이면 302 대신 HTML handoff

카카오톡 인앱 브라우저는 `Location: kr.farmassi.app://…` 302를 무시하는 경우가 있어:

1. `meta refresh` + `location.replace(customScheme)`
2. 400ms 뒤 Android Intent URL  
   `intent://auth/callback?...#Intent;scheme=kr.farmassi.app;package=kr.farmassi.app;end`
3. 수동 링크(“앱으로 돌아가기” / Intent 폴백)
4. `Cache-Control: no-store`

Python: `app_handoff_html()` + `kakao_callback`에서 `is_app_callback_url(target)`이면 `HTMLResponse`  
Node: `sendClientRedirect()`가 앱 URL이면 HTML, 아니면 기존 302

#### 3) 적용 지점

로그인 성공 시 JWT를 query에 실어 돌리는 응답, 에러 시 `error_description`을 붙인 응답 **모두** handoff 경로를 탄다.

이 커밋의 나머지(연락처 권한, PWA 아이콘, Auto SMS UI)는 백엔드 밖.
