# `orders` — 주문

주문 한 건이 한 행이다. 품목은 [order_items](order_items.md) 에 따로 있다.

`deposit_due_amount` 가 **손님이 실제로 보내야 하는 금액**이고, 자동 대사가 이 값을
기준으로 입금을 맞춘다. `total_amount` 는 상품가 + 배송비 합계이고 `shipping_fee` 는
그중 배송비다. 배송비는 `total_amount` 에 이미 포함돼 있다 — 두 번 더하면 안 된다.

`deposit_code` 는 주문마다 다른 짧은 코드다. 같은 금액의 주문이 여럿일 때 이걸로
가른다. `depositor_name` 은 손님이 적어 낸 입금자명으로, 자동 대사의 후보로 쓴다.

`sender_*` 는 '보내는 분' 이다. 받는 분(`recipient_*`)과 다를 수 있어 따로 둔다.
선물로 보내는 경우가 있다.

`status` 흐름: `pending_deposit` → `paid` → `packing`(송장 발급 완료) → `shipped` → `done`.

관련 문서: [order_items](order_items.md) · [deposit_transactions](deposit_transactions.md) · [shipments](shipments.md)

## 컬럼

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| `id` | uuid | 아니오 | `gen_random_uuid()` |  |
| `order_no` | text | 아니오 |  |  |
| `farm_id` | uuid | 아니오 |  |  |
| `customer_id` | uuid | 예 |  | 주문한 손님. 농가가 직접 추가한 주문(`source = farm_manual`)은 비어 있다. |
| `status` | text | 아니오 | `'pending_deposit'::text` |  |
| `recipient_name` | text | 아니오 |  |  |
| `recipient_phone` | text | 아니오 |  |  |
| `zonecode` | text | 예 |  |  |
| `address` | text | 아니오 |  |  |
| `address_detail` | text | 예 |  |  |
| `request_memo` | text | 예 |  |  |
| `total_amount` | integer | 아니오 |  |  |
| `deposit_due_amount` | integer | 아니오 |  |  |
| `deposit_code` | text | 아니오 |  |  |
| `deposit_confirmed_at` | timestamptz | 예 |  |  |
| `deposit_confirmed_by` | uuid | 예 |  |  |
| `deposit_provider` | text | 예 |  |  |
| `created_at` | timestamptz | 아니오 | `now()` |  |
| `updated_at` | timestamptz | 아니오 | `now()` |  |
| `depositor_name` | text | 예 |  | 손님이 적은 입금자명. 자동 대사의 후보로 쓴다. |
| `sender_name` | text | 예 |  | 보내는 분 이름 (선택). |
| `sender_phone` | text | 예 |  | 보내는 분 연락처. |
| `sender_address` | text | 예 |  | 보내는 분 주소 (선택). |
| `shipping_fee` | integer | 아니오 | `0` | 주문 전체 배송비. total_amount 에 이미 포함돼 있다. |
| `source` | text | 아니오 | `'store'::text` | 주문 경로. `store` = 손님이 스토어에서, `farm_manual` = 농가가 카톡 주문을 붙여 넣어 직접 추가. |
| `created_by` | uuid | 예 |  | 주문을 만든 사람. 스토어 주문은 손님, 직접 추가는 추가한 농가 회원·관리자. |
| `created_by_name` | text | 예 |  | 만든 시점의 `created_by` 표시 이름. 농가 회원은 남의 profiles 를 못 읽어서 따로 남긴다. |

## 외래키

| 컬럼 | 참조 |
|---|---|
| `farm_id` | `farms.id` |
| `customer_id` | `profiles.id` |
| `deposit_confirmed_by` | `profiles.id` |
| `created_by` | `profiles.id` |

## 제약

- `orders_deposit_due_amount_check` — `CHECK ((deposit_due_amount >= 0))`
- `orders_status_check` — `CHECK ((status = ANY (ARRAY['pending_deposit'::text, 'paid'::text, 'packing'::text, 'shipping'::text, 'completed'::text, 'cancelled'::text])))`
- `orders_total_amount_check` — `CHECK ((total_amount >= 0))`
- `orders_source_check` — `CHECK ((source = ANY (ARRAY['store'::text, 'farm_manual'::text])))`
- `orders_source_actor_check` — 스토어 주문은 `customer_id`, 직접 추가 주문은 `created_by` 가 있어야 한다.

## 인덱스

- `orders_created_by_idx`
- `orders_customer_id_idx`
- `orders_deposit_code_key`
- `orders_deposit_confirmed_by_idx`
- `orders_farm_id_idx`
- `orders_order_no_key`
- `orders_pkey`
- `orders_status_idx`

## RLS 정책

| 정책 | 대상 | 조건 |
|---|---|---|
| `orders_select` | SELECT | `((customer_id = auth.uid()) OR private.is_admin() OR private.is_farm_member(farm_id))` |
| `orders_update_ops` | UPDATE | `(private.is_admin() OR private.is_farm_member(farm_id))` |

## 정의

- [`supabase/migrations/20260817000001_init_farmassi.sql`](../../supabase/migrations/20260817000001_init_farmassi.sql)
- [`supabase/migrations/20260817000002_fk_indexes.sql`](../../supabase/migrations/20260817000002_fk_indexes.sql)
- [`supabase/migrations/20260824000003_orders_depositor_and_sender.sql`](../../supabase/migrations/20260824000003_orders_depositor_and_sender.sql)
- [`supabase/migrations/20260826000000_shipping_fees.sql`](../../supabase/migrations/20260826000000_shipping_fees.sql)

## 쓰는 곳

- [`server-py/app/functions/confirm_deposit.py`](../../server-py/app/functions/confirm_deposit.py)
- [`server-py/app/functions/create_order.py`](../../server-py/app/functions/create_order.py)
- [`server-py/app/functions/kpost_shipment.py`](../../server-py/app/functions/kpost_shipment.py)
- [`server-py/app/functions/match_deposit.py`](../../server-py/app/functions/match_deposit.py)
- [`server-py/app/functions/scrape_deposits.py`](../../server-py/app/functions/scrape_deposits.py)
- [`server-py/app/sb.py`](../../server-py/app/sb.py)
- [`src/App.tsx`](../../src/App.tsx)
- [`src/components/shared/KpostParcelExport.tsx`](../../src/components/shared/KpostParcelExport.tsx)
- [`src/lib/apiClient.ts`](../../src/lib/apiClient.ts)
- [`src/lib/shippingHistory.ts`](../../src/lib/shippingHistory.ts)
