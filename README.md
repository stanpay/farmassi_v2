# 팜어시 (Farmassi)

농가별 주문 페이지, 무통장 입금, 농가 알림, 관리자 운영을 위한 주문·배송 플랫폼입니다.

## 로컬 실행

```bash
cp .env.example .env.local
npm install
npm run dev
```

브라우저에서 `http://localhost:5173`

## 역할

- **주문자 / 농가**: 카카오 로그인
- **관리자**: 지정된 카카오 계정만 (`/admin/login` 또는 로그인 후 `/admin`)

## 화면

- `/farm/:farmSlug` — 농가 주문 페이지
- `/manage` — 농가 주문·배송 (계정에 연결된 농가)
- `/admin` — 주문·입금·농가 전체 관리
- `/admin/farms` — 농가 생성 및 담당 계정 연결

## 처음 쓰는 순서

1. [카카오 디벨로퍼스](https://developers.kakao.com/console/app)에서 앱을 만들고 **카카오 로그인을 ON** 합니다.
2. REST API 키의 Redirect URI에 **자체 API 콜백**을 등록합니다.
   - `https://api.shop.lkim.me/auth/kakao/callback`
3. REST API 키에서 **Client Secret을 활성화**하고 값을 복사합니다. `server/.env` 의 `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET` 에 넣습니다.
4. [카카오 로그인] → [동의항목]에서 **닉네임**(`profile_nickname`), **프로필 사진**(`profile_image`)을 [설정]으로 켜 둡니다. 필수·선택 어느 쪽이든 됩니다. `account_email`은 비즈 앱이 아니면 요청하지 않습니다.
5. 배송지 검색용 **카카오맵**을 켭니다.
   - [카카오 개발자](https://developers.kakao.com) → 내 애플리케이션 → 앱 키의 **JavaScript 키**를 사용합니다.
   - 플랫폼 → Web: `http://localhost:5173`, `https://shop.lkim.me`
   - JavaScript 키는 프론트 env의 `VITE_KAKAO_JS_KEY`에 넣습니다.
   - 주소 검색·역지오코딩은 서버의 `KAKAO_REST_API_KEY`(REST API 키)를 사용합니다.
6. 관리자는 카카오로 로그인한 뒤, 해당 사용자만 `profiles.role` 을 `admin` 으로 올립니다.

```sql
update public.profiles
   set role = 'admin'
 where id = '<user uuid>';
```

7. 관리자 → **농가**에서 농가를 만들고, 카카오로 이미 로그인한 담당 계정을 연결합니다. 연결된 계정만 `/manage` 에 들어갑니다.
8. (선택) 웹 푸시용 VAPID 키는 `server/.env` 에 둡니다 (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`).

웹 푸시는 브라우저 권한·iOS 홈화면 추가 여부에 따라 100% 보장되지 않습니다. 앱이 열려 있으면 폴링 기반 인앱 알림이 동작합니다.

## 이후 연동

- 우체국 송장: 상품에 저장한 택배 정보로 창구소포 엑셀을 농가별로 다운로드 (`/manage/products`, `/admin/shipments`)
- 입금 스크래핑: 자체 API `POST /rpc/scrape-deposits`
- 입금 확인: `POST /rpc/confirm-deposit`

## 뱅크다A 입금 자동확인

무통장입금 내역을 뱅크다A에서 가져와 입금대기 주문에 붙입니다.

### 설정

`server/.env`:

```
BANKDA_ACCESS_TOKEN=...   # 뱅크다 > 설정 > 데이터전송 관리 > REST API
CRON_SECRET=...           # 크론이 scrape-deposits 를 호출할 때 쓰는 값
```

`farms.account_number` 가 뱅크다에 등록된 계좌번호와 같아야 농가를 찾습니다.
하이픈은 무시하고 숫자만 비교합니다.

### 실행

```bash
# 크론에서
curl -X POST -H "x-cron-secret: $CRON_SECRET" \
  -H "Content-Type: application/json" -d '{"days":3}' \
  https://api.shop.lkim.me/rpc/scrape-deposits
```

관리자는 로그인 상태로 같은 RPC를 호출해 수동 실행할 수 있습니다.

### 매칭 규칙

서버의 입금 매칭 로직에 있습니다. **금액이 정확히 같아야** 후보가 되고,
입금자명은 후보를 좁히는 데만 씁니다.

| 상황 | 결과 |
|---|---|
| 금액 일치 주문이 1건 | 자동 확인 (`amount_unique`) |
| 금액 일치 여러 건, 입금자명에 입금코드 있음 | 자동 확인 (`deposit_code`) |
| 금액 일치 여러 건, 입금자명이 수령인과 같음 | 자동 확인 (`recipient_name`) |
| 그 외 | `unmatched` 로 남기고 사람이 확인 |

확실하지 않으면 붙이지 않습니다. 잘못 붙으면 오출고로 이어지지만, 안 붙으면
관리자가 화면에서 확인만 하면 되기 때문입니다.

### 주의

- 뱅크다 거래내역 조회는 **계좌당 5분에 1회**입니다. 크론 간격을 그보다 짧게 두지 마세요.
- 스크래핑 주기(현재 **60분**)만큼 지연이 있습니다. 즉시 알림이 필요하면 푸시 경로를 병행하세요.
- 같은 거래를 두 번 넣지 않도록 `deposit_transactions (provider, external_id)` 에
  유니크 인덱스가 있습니다. `external_id` 는 뱅크다의 `bkcode` 입니다.

---

## 자체 스택

로컬 PostgreSQL + 자체 API 서버로 동작합니다.

```
브라우저 ── https://shop.lkim.me ──────► nginx ──► /opt/homebrew/var/www/shop (정적)
         └─ https://api.shop.lkim.me ──► nginx ──► 127.0.0.1:4310 (Node API)
                                                        └──► PostgreSQL 17 (farmassi)
```

### 데이터베이스

`supabase/migrations/` 의 SQL 을 **고치지 않고** 그대로 씁니다. `server/db/000_local_shim.sql`
이 Supabase 가 제공하던 것(`auth.users`, `auth.uid()`, `auth.jwt()`, 역할 4개)만 흉내냅니다.

```bash
server/db/apply.sh          # 마이그레이션 적용
server/db/apply.sh --reset  # 데이터베이스를 지우고 다시 구축
```

**RLS 정책 24개를 그대로 살려뒀습니다.** API 는 요청마다
`set_config('request.jwt.claim.sub', <사용자 id>, true)` 를 걸고 `farmassi_app` 역할로
접속하므로, 인가는 DB 가 계속 검사합니다. 서버 내부 작업만 `farmassi_admin`(BYPASSRLS)으로 나갑니다.

### API 서버

의존성은 `pg` 와 `web-push` 둘뿐입니다. Node 의 타입 스트리핑을 쓰므로 빌드 단계가 없습니다.

| 경로 | 역할 |
|---|---|
| `POST /query` | 데이터 게이트웨이. 프론트의 조회 문법을 SQL 로 옮긴다 |
| `POST /rpc/<이름>` | 기존 Edge Function 7개 |
| `POST /storage/upload`, `/storage/delete` | 이미지 업로드 |
| `GET /files/<경로>` | 업로드된 이미지 서빙 |
| `GET /auth/kakao/start`, `/auth/kakao/callback` | 카카오 로그인 |
| `GET /auth/me` | 현재 사용자 |

환경변수는 `server/.env` 에 있습니다. `KAKAO_REST_API_KEY` 를 채워야 로그인이 됩니다.

### 배포

```bash
npm run build && rsync -a --delete dist/ /opt/homebrew/var/www/shop/
launchctl kickstart -k gui/$(id -u)/me.lkim.farmassi-api    # API 재시작
```

nginx 설정은 `/opt/homebrew/etc/nginx/nginx.conf` 에 있고, 원본 백업과 추가한 블록은
`deploy/` 에 있습니다. 인증서는 certbot(`~/letsencrypt/config/live/shop.lkim.me`)으로 발급했습니다.

### 실시간 알림

Postgres 논리복제 대신 15초 폴링으로 대체했습니다 (`src/lib/apiClient.ts` 의 `channel`).
첫 조회는 기존 행을 기록만 하므로 새로고침할 때마다 알림이 다시 뜨지 않습니다.

### 저장소에 없는 것

비밀값과 업로드 파일은 커밋하지 않습니다. 새 기기에 세울 때 따로 챙겨야 합니다.

| 필요한 것 | 놓을 위치 | 없으면 |
|---|---|---|
| `server/.env` | 그대로 | API 가 뜨지 않음 |
| `.env.production` | 그대로 | 번들이 잘못된 API 주소를 가리킴 |
| 업로드 이미지 | `/opt/homebrew/var/www/shop-uploads/` | 상품·랜딩 이미지가 깨짐 |

`server/.env` 에 들어가는 항목은 `.env.example` 을, 프론트 항목은 `src/vite-env.d.ts` 를
보면 됩니다. **값은 저장소 어디에도 없습니다.**

운영 중인 기기에서는 `~/FetchAccount/farmassi-secrets/` 에 모아 두었습니다(권한 700).
