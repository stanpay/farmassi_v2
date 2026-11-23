# 알림톡 연동 — 개발자 구현·적용 안내

**앱 코드 초안은 저장소에 넣지 않았습니다.** 이 문서 + [templates.md](templates.md) 기준으로 구현하면 됩니다.  
알리고 `@팜어시` 템플릿(`UO_1351`~`UO_1354`)은 콘솔에 **이미 등록·검수중**입니다. 건드리지 마세요.

**새 페이지/라우트는 필요 없습니다.** 기존 입금·주문상태·가입 흐름에 발송만 붙입니다.

스키마는 **서버 Postgres에 SQL을 직접 실행**합니다. Supabase 마이그레이션을 쓰지 않습니다.

---

## 0. 적용 순서 권장

1. DB: [sql/apply-aligo-sender-key.sql](sql/apply-aligo-sender-key.sql) 서버에서 실행
2. 환경변수 (아래 §2) — 로컬 `.env`에 템플릿 코드는 이미 적어 둘 수 있음
3. 서버 Python 모듈·훅 구현 (§3)
4. 프론트 소폭 수정 (§4)
5. 알리고 템플릿 승인·IP 화이트리스트 확인 후 테스트 발송

운영 문서(문구·채널 등록): [README.md](README.md), [register-flow.md](register-flow.md)

---

## 1. DB (서버 직접)

파일: [sql/apply-aligo-sender-key.sql](sql/apply-aligo-sender-key.sql)

```sql
alter table public.farms
  add column if not exists aligo_sender_key text;
```

- `NULL` → 팜어시 `ALIGO_SENDER_KEY` 로 발송
- 값 있음 → 해당 농가 카카오채널 senderkey 로 발송
- 로컬에 이미 컬럼이 있을 수 있음 → `IF NOT EXISTS` 로 중복 안전

`supabase/migrations/` 에는 **넣지 않음**. 이 폴더의 SQL만 사용.

---

## 2. 환경변수 (서버 `.env`, git 밖)

```bash
ALIGO_API_KEY=...
ALIGO_USERID=...
ALIGO_SENDER_KEY=...          # @팜어시
ALIGO_SENDER=010...           # 대체문자 발신번호
ALIGO_TPL_ORDER_DONE=UO_1351
ALIGO_TPL_TRACKING=UO_1352
ALIGO_TPL_DELIVERED=UO_1353
ALIGO_TPL_SIGNUP=UO_1354
```

- 템플릿은 2026-11-23 `@팜어시` 등록분(검수중). 승인·재등록 시 코드만 갱신.
- 알리고 API는 **서버 IP 화이트리스트** 필요. 미등록이면 발송 실패(입금/주문은 막지 않음).

---

## 3. 서버 (Python) — 구현할 것

### 신규 파일 (권장 경로)

| 경로 | 역할 |
|------|------|
| `server-py/app/shared/alimtalk.py` | 발송·문구 치환·senderkey 분기 |
| `server-py/app/shared/delivery_estimate.py` | 배송예정일 (프론트 `src/lib/deliveryEstimate.ts`와 동일 규칙) |
| `server-py/app/functions/notify_alimtalk.py` | RPC `notify-alimtalk` |
| `server-py/app/functions/aligo_templates.py` | RPC `aligo-templates` (기존 `/admin/kakao` UI용, 서버만 비어 있었음) |

문구 상수는 [templates.md](templates.md) / [templates.json](templates.json) 과 **항상 동기화**.

### 기존 함수에 훅 (입금 → 주문완료 알림톡)

입금이 `paid` 로 확정된 직후 `await notify_order_done(conn, order_id)`:

| 파일 | 위치 |
|------|------|
| `server-py/app/functions/confirm_deposit.py` | `notify_farm_members` 다음 |
| `server-py/app/functions/match_deposit.py` | match 성공 후 `notify_farm_members` 다음 |
| `server-py/app/functions/scrape_deposits.py` | 자동매칭·리매칭 두 곳, 각각 `notify_farm_members` 다음 |
| `server-py/app/functions/__init__.py` | `aligo-templates`, `notify-alimtalk` 등록 |

실패는 `alimtalk.py` 안에서 catch → 로그만. 입금 트랜잭션을 되돌리지 않음.

### RPC 계약

**`POST /rpc/notify-alimtalk`**

| kind | body | 트리거(프론트/서버) |
|------|------|---------------------|
| `order_done` | `{ orderId }` | 입금 확정 서버 훅 |
| `tracking` | `{ orderId }` | 주문 상태 → `packing` (송장번호 없으면 skip) |
| `delivered` | `{ orderId }` | 주문 상태 → `completed` |
| `signup` | `{ phone, name, userId? }` | 프로필 연락처 최초 저장 |

권한: 주문계열은 admin 또는 해당 농가 멤버. signup은 본인 또는 admin.

---

## 4. 프론트 — 구현할 소폭 수정 (새 페이지 없음)

### 4.1 `src/types/models.ts`

`Farm` 에 선택 필드:

```ts
aligo_sender_key?: string | null
```

### 4.2 `src/pages/admin/Farms.tsx` (관리자 농가)

- `FarmForm` / `emptyForm` 에 `aligo_sender_key`
- 생성·수정 폼: 카카오 채널 URL 아래에  
  **「알림톡 senderkey (없으면 팜어시 채널)」** Input
- `insert` / `update` payload 에 `aligo_sender_key: trim || null`

UI만. 새 라우트 없음. 기존 `/admin/farms`.

### 4.3 `src/pages/farm/Orders.tsx`

`changeStatus` 성공 후:

```ts
const kind = status === 'packing' ? 'tracking' : status === 'completed' ? 'delivered' : null
if (kind) {
  void invokeFunction('notify-alimtalk', { kind, orderId: id }).catch(...)
}
```

`invokeFunction` import 추가.

### 4.4 `src/pages/admin/Orders.tsx`

상태 `<select>` onChange 에서 동일 패턴 (`packing` → tracking, `completed` → delivered).

### 4.5 `src/components/auth/ProfileCompletionSheet.tsx`

연락처가 **비어 있던 사용자가 처음 저장**할 때만:

```ts
void invokeFunction('notify-alimtalk', {
  kind: 'signup',
  phone: trimmedPhone,
  name: trimmedName,
  userId: profileId,
}).catch(...)
```

가입 직후 폰이 없으면 알림톡은 이 시점에 감.

### 프론트에서 안 한 것

- 신규 페이지 / 라우트 / 네비 항목
- `/admin/kakao` UI 자체는 기존 파일. 서버 RPC만 새로 필요

---

## 5. 검수 체크리스트

- [ ] 서버에 `aligo_sender_key` 컬럼 적용·확인
- [ ] `.env` 템플릿 코드·IP 화이트리스트
- [ ] 입금 확정 3경로에서 주문완료 알림톡 시도(승인 전엔 실패 로그 OK)
- [ ] `packing` + 송장 없음 → tracking skip
- [ ] `packing` + 송장 있음 → 택배번호 알림
- [ ] `completed` → 배송완료 알림
- [ ] 프로필 폰 최초 입력 → 회원가입 알림 (팜어시 채널)
- [ ] 농가 senderkey 비우면 팜어시, 채우면 농가 채널 (템플릿은 채널마다 알리고 재등록 필요 — [register-flow.md](register-flow.md))

---

## 6. 알림: 템플릿 코드가 채널마다 다르면

현재 발송 코드는 **env의 템플릿 코드 + senderkey만 교체** 전제입니다.  
알리고가 채널마다 다른 `UO_xxxx` 를 주면 `farms` 에 템플릿 코드 컬럼이 추가로 필요합니다. 그때 스키마·발송 헬퍼를 확장하세요.
