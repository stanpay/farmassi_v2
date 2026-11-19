# `POST /rpc/create-farm-orders` — 농가 직접 주문 추가

농가가 카톡 주문을 붙여 넣어 카드로 바꾼 뒤 "주문 추가" 를 누르면 부른다.
화면: 농가 → 주문 → 직접 추가하기 (`src/pages/farm/OrderCreate.tsx`).

## 요청

```json
{
  "farmId": "uuid",
  "orders": [
    {
      "recipient": { "name": "", "phone": "", "zonecode": "", "address": "", "addressDetail": "" },
      "sender": { "name": "", "phone": "", "depositorName": "" },
      "requestMemo": "",
      "items": [{ "productId": "uuid", "quantity": 1 }]
    }
  ]
}
```

응답: `{ "orders": [{ "id", "orderNo", "total" }] }`

## 규칙

- **권한**: 관리자이거나 그 농가의 `farm_members` 여야 한다. 아니면 403.
- **전부 아니면 전무.** 한 트랜잭션으로 넣는다. 한 건이라도 틀리면 아무것도 들어가지 않고
  "N번 주문: …" 메시지를 돌려준다. 일부만 들어가면 농가가 어디까지 들어갔는지 다시 맞춰 봐야 한다.
- 한 번에 50건까지.
- **금액은 서버가 계산한다.** 상품은 그 농가의 `on_sale` 상품만 받고, 가격·배송비 구간표를
  DB 에서 다시 읽는다. [주문 생성](create-order.md) 과 같은 규칙이다.
- **누가 넣었는지 남긴다.** `source = 'farm_manual'`, `customer_id` 는 비우고 `created_by` 에
  넣은 사람, `created_by_name` 에 그때의 표시 이름을 넣는다. 손님 자리에 농가 사람을 넣으면
  그 주문이 농가 사람의 '내 주문' 에 섞이기 때문이다. [orders](../../../database/orders.md) 참고.
- 입금자명이 없으면 보내는 분, 그것도 없으면 받는 분 이름을 쓴다 (화면과 같은 순서).
- 알림·메일은 보내지 않는다. 넣은 사람이 이미 알고 있다.
- 비활성 농가도 넣을 수 있다. 스토어를 닫고 카톡으로만 받는 경우가 있다.

## 관련 파일

- [`server-py/app/functions/create_farm_orders.py`](../../../../server-py/app/functions/create_farm_orders.py)
- [`supabase/migrations/20261119000000_orders_created_by.sql`](../../../../supabase/migrations/20261119000000_orders_created_by.sql)
