# `farms` — 농가

농가 한 곳이 한 행이다. `slug` 가 주소에 그대로 들어가 `/farm/haneul-farm` 이 된다.

계좌 정보(`bank_name`·`account_number`·`account_holder`)가 이 표에 있는 이유는
결제가 무통장입금이기 때문이다. 손님은 농가 계좌로 직접 보내고, 우리는 그 입금을
읽어 주문과 맞춘다. 카드 결제가 없으므로 PG 사도 없다.

`is_active` 와 `is_listed` 는 다르다. `is_active=false` 는 랜딩·주문까지 막지만,
`is_listed=false` 는 목록에서만 빼고 `slug` 주소로는 열린다. 시험용 농가를 링크로만
열어 두려고 나눴다.

`delivery_days` 는 `0=일 … 6=토` 로 JS 의 `Date.getDay()` 와 번호가 같다. 화면에서
변환 없이 비교하려는 것이다. **빈 배열은 '배송 안 함' 이 아니라 '설정 안 함'** 이다.
빈 배열을 '아무 요일도 안 됨' 으로 읽으면 그 농가는 아무것도 못 하게 된다.

관련 문서: [products](products.md) · [shipping_pauses](shipping_pauses.md) · [farm_members](farm_members.md)

## 컬럼

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| `id` | uuid | 아니오 | `gen_random_uuid()` |  |
| `slug` | text | 아니오 |  |  |
| `name` | text | 아니오 |  |  |
| `owner_user_id` | uuid | 아니오 |  |  |
| `location` | text | 예 |  |  |
| `product_summary` | text | 예 |  |  |
| `description` | text | 예 |  |  |
| `bank_name` | text | 아니오 |  |  |
| `account_number` | text | 아니오 |  |  |
| `account_holder` | text | 아니오 |  |  |
| `is_active` | boolean | 아니오 | `true` |  |
| `created_at` | timestamptz | 아니오 | `now()` |  |
| `updated_at` | timestamptz | 아니오 | `now()` |  |
| `kakao_channel_url` | text | 예 |  |  |
| `landing_blocks` | jsonb | 아니오 | `'[]'::jsonb` |  |
| `phone` | text | 예 |  |  |
| `mobile_phone` | text | 예 |  |  |
| `address` | text | 예 |  |  |
| `map_url` | text | 예 |  |  |
| `share_text` | text | 예 |  |  |
| `auto_sms` | jsonb | 아니오 | `'{}'::jsonb` | 콜백문자 규칙·제외 번호. 자동 발신 스위치는 기기에만 둔다. |
| `address_zonecode` | text | 예 |  |  |
| `address_detail` | text | 예 |  |  |
| `is_listed` | boolean | 아니오 | `true` | 메인 농가 목록 노출 여부. false 여도 slug 주소로는 접속된다. |
| `delivery_days` | smallint[] | 아니오 | `'{}'::smallint[]` | 배송 가능 요일 (0=일 … 6=토). 빈 배열이면 설정 안 함. |
| `daily_qty_limit` | integer | 아니오 | `100` | 농가 일일 주문 수량 한도. 넘어도 주문은 받고 화면 경고만 한다. |

## 외래키

| 컬럼 | 참조 |
|---|---|
| `owner_user_id` | `profiles.id` |

## 제약

- `farms_daily_qty_limit_check` — `CHECK ((daily_qty_limit >= 1))`
- `farms_delivery_days_check` — `CHECK (((delivery_days <@ ARRAY[(0)::smallint, (1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint]) AND (array_length(delivery_days, 1) IS DISTINCT FROM 0)))`
- `farms_landing_blocks_is_array` — `CHECK ((jsonb_typeof(landing_blocks) = 'array'::text))`
- `farms_auto_sms_is_object` — `CHECK ((jsonb_typeof(auto_sms) = 'object'::text))`

## 인덱스

- `farms_owner_user_id_idx`
- `farms_pkey`
- `farms_slug_key`

## RLS 정책

| 정책 | 대상 | 조건 |
|---|---|---|
| `farms_delete_admin` | DELETE | `private.is_admin()` |
| `farms_insert_admin` | INSERT | `-` |
| `farms_select` | SELECT | `true` |
| `farms_update` | UPDATE | `(private.is_admin() OR private.is_farm_member(id))` |

## 정의

- [`supabase/migrations/20260823000001_drop_farms_bankda_merchant_email.sql`](../../supabase/migrations/20260823000001_drop_farms_bankda_merchant_email.sql)
- [`supabase/migrations/20260823000002_farms_visible_when_inactive.sql`](../../supabase/migrations/20260823000002_farms_visible_when_inactive.sql)
- [`supabase/migrations/20260824000000_farms_delivery_days.sql`](../../supabase/migrations/20260824000000_farms_delivery_days.sql)
- [`supabase/migrations/20260824000004_farms_shipping_pause.sql`](../../supabase/migrations/20260824000004_farms_shipping_pause.sql)
- [`supabase/migrations/20260824000006_farms_update_members.sql`](../../supabase/migrations/20260824000006_farms_update_members.sql)
- [`supabase/migrations/20260824000007_qty_limits.sql`](../../supabase/migrations/20260824000007_qty_limits.sql)
- [`supabase/migrations/20260825000000_shipping_pauses.sql`](../../supabase/migrations/20260825000000_shipping_pauses.sql)
- [`supabase/migrations/20260825000002_shipping_history.sql`](../../supabase/migrations/20260825000002_shipping_history.sql)
- [`supabase/migrations/20261108000000_farms_auto_sms.sql`](../../supabase/migrations/20261108000000_farms_auto_sms.sql)

## 쓰는 곳

- [`server-py/app/functions/approve_farm.py`](../../server-py/app/functions/approve_farm.py)
- [`server-py/app/functions/bankda_account_status.py`](../../server-py/app/functions/bankda_account_status.py)
- [`server-py/app/functions/bankda_ott.py`](../../server-py/app/functions/bankda_ott.py)
- [`server-py/app/functions/create_order.py`](../../server-py/app/functions/create_order.py)
- [`server-py/app/functions/scrape_deposits.py`](../../server-py/app/functions/scrape_deposits.py)
- [`src/components/shared/ProductManager.tsx`](../../src/components/shared/ProductManager.tsx)
- [`src/lib/auth.tsx`](../../src/lib/auth.tsx)
- [`src/lib/farmWorkspace.tsx`](../../src/lib/farmWorkspace.tsx)
- [`src/lib/orders.ts`](../../src/lib/orders.ts)
- [`src/lib/shippingHistory.ts`](../../src/lib/shippingHistory.ts)
