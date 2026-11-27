# `POST /rpc/review-farm-orders` — 농가 직접 주문 검수

카톡 주문 원문을 **파싱 → 상품 매칭 → 우체국 주소 확정 → 동·호 검증 → 필수값** 까지 한 번에 검수한다.
저장은 하지 않는다. 전부 `ok` 가 되면 응답의 `saveRequest` 를 그대로 [`create-farm-orders`](create-farm-orders.md) 에 보낸다.

- 기획: [`doc/기획-챗봇-주문검수-작업.md`](../../../기획-챗봇-주문검수-작업.md)
- 코드: `server-py/app/functions/review_farm_orders.py`, 판정 `server-py/app/shared/order_review.py`
- 판정은 화면(`src/pages/farm/OrderCreate.tsx`, `src/lib/epostAddress.ts`, `src/lib/jusoBuilding.ts`,
  `src/lib/phone.ts`, `src/lib/matchFarmProduct.ts`)과 1:1 로 맞췄다. 어느 쪽을 고치든
  `server-py/test/review_parity/run.sh` 로 양쪽이 같은지 확인한다.
- 챗봇은 같은 함수를 `POST /chatbot/rpc/review-farm-orders` 로 부른다 → [챗봇 안내](../../../chatbot/order-review.md)

## 권한

`create-farm-orders` 와 같다 — 슈퍼어드민이거나 그 농가의 `farm_members`. 아니면 403. 없는 농가 404.

## 요청

서버는 검수 상태를 저장하지 않는다. 다시 검수할 때는 **직전 응답의 `orders` 를 그대로** 돌려보낸다.
돌려받은 값 중 `status`·`errors` 는 무시하고 서버가 매번 다시 판정한다.

### A) 원문 검수

```json
{ "farmId": "uuid", "text": "카톡 원문 (최대 20000자)" }
```

### B) 다시 검수 · 주소 선택 · 칸 고치기

```json
{
  "farmId": "uuid",
  "action": "recheck | select_address | patch_order",
  "orders": [ /* 직전 응답의 orders 그대로 */ ],
  "targetIndex": 0,
  "selection": { "candidateNo": 1, "addressDetail": "103동 801호" },
  "patch": { "addressDetail": "103동 801호" }
}
```

| action | 하는 일 |
|---|---|
| `recheck` | 전부 다시 검수 |
| `select_address` | `targetIndex` 주문에 `addressCandidates` 중 하나를 넣고 동·호까지 다시 본다 |
| `patch_order` | `targetIndex` 주문의 칸을 고치고 다시 검수 |

- **`targetIndex` 는 `orders` 배열의 0부터 세는 위치**다. 응답의 `index` 는 사람에게 보이는 1부터 번호다.
- `selection`: `candidateId`(후보의 `id`) 또는 `candidateNo`(후보 목록의 1부터 번호) 중 하나.
  `addressDetail` 을 같이 주면 상세도 그 값으로 바꾼다 (“2번, 103동 801호” 를 한 번에).
  고른 후보는 우체국에서 **다시 찾아 실제로 있는지 확인**한다. 없으면 400.
- `patch` 로 고칠 수 있는 칸: `address`, `addressDetail`, `recipientName`, `phone`, `senderName`,
  `senderPhone`, `depositorName`, `memo`, `productId`, `productQuery`, `quantity`. 다른 칸은 400.
  - `addressDetail` 만: 확정된 기본주소는 그대로 두고 동·호만 다시 본다.
  - `address`: 새 주소로 우체국부터 다시 찾는다. 상세는 같이 보낸 `addressDetail`, 없으면 새 주소에서
    떼어 낸 값을 쓴다 (예전 상세는 버린다). `"서울 강서구 강서로 532, 103동 801호"` 처럼 한 줄로 보내도 된다.
  - `productId`: `productCandidates` 의 `id`. 이 농가의 판매 중 상품이 아니면 400.
  - `productQuery`: 상품 문구를 바꿔 다시 매칭 (로컬 매칭 → 안 되면 Claude).
  - `quantity`: 숫자만 뽑는다 (`"3개"` → 3, 없으면 1).

## 응답

```json
{
  "orders": [
    {
      "index": 1,
      "status": "ok | needs_address_select | needs_address_fix | needs_product_select | needs_field_fix",
      "fields": {
        "recipientName": "", "phone": "010-1234-5678",
        "zonecode": "07524", "address": "서울특별시 강서구 강서로 532 (…)", "addressDetail": "103동 801호",
        "addressRaw": "원문 주소 구간", "addressToken": "확정 표시(서버 서명)",
        "productId": "uuid | null", "productName": "캠벨 5kg", "unitPrice": 45000, "productQuery": "포도 5키로",
        "quantity": 1, "senderName": "", "senderPhone": "", "depositorName": "", "memo": "", "raw": "주문 원문 덩어리"
      },
      "errors": [{ "field": "address", "code": "MISSING_HO", "message": "호수가 빠졌습니다. 확인해 주세요." }],
      "addressCandidates": [{ "id": "epost:…", "zipNo": "07524", "roadAddress": "…", "jibunAddress": "…" }],
      "addressSearchQuery": "서울 강서구 강서로 532",
      "productCandidates": [{ "id": "uuid", "name": "캠벨 5kg", "unit": "박스", "price": 45000 }]
    }
  ],
  "summary": { "total": 3, "ready": 2, "needsFix": 1 },
  "saveRequest": { "farmId": "uuid", "orders": [ /* create-farm-orders 요청 그대로 — needsFix 가 0 일 때만 */ ] },
  "ignored": ["원문 검수(A)일 때 Claude 가 무시한 구간(재전송 등)"]
}
```

- `status` 가 여러 개 해당하면 위 순서(주소 선택 → 주소 수정 → 상품 → 나머지 칸)로 하나만 준다. `errors` 에는 전부 있다.
- `addressToken`: 우체국으로 확정한 주소에 서버가 붙이는 서명. 다시 검수할 때 이 값이 `zonecode`·`address` 와 맞으면
  우체국을 다시 찾지 않고 동·호만 본다 (같은 건물이 단지명만 달리 여러 줄로 나오는 주소는 다시 찾으면 또 다건이 된다).
  주소·우편번호를 손으로 바꾸면 서명이 안 맞아 처음부터 다시 찾는다.
- `addressCandidates` 는 선택이 필요하거나, 기본주소가 확정된 채 동·호만 틀렸을 때(확정 후보 1건) 준다.
- 외부 조회는 10분 캐시한다 (같은 주문을 여러 번 재검수해도 우체국·도로명주소 API 를 다시 부르지 않는다).

## 코드

| field | code | status | 뜻 |
|---|---|---|---|
| address | `MULTI_CANDIDATES` | needs_address_select | 우체국 결과 여러 건. **자동으로 고르지 않는다** |
| address | `DISTRICT_MISMATCH` | needs_address_select | 도로명·번호는 같은데 시·군·구가 원문과 다름 (예: 인천 서구 → 검단구) |
| address | `ADDRESS_MISMATCH` | needs_address_select | 1건인데 원문과 안 맞음 |
| address | `FALLBACK_CANDIDATES` | needs_address_select | 원문으로 0건 → 시·도+도로명+번호로 다시 찾은 후보 (확인 필요) |
| address | `NOT_FOUND` | needs_address_fix | 대체 검색으로도 0건 |
| address | `SEARCH_FAILED` | needs_address_fix | 우체국 API 실패 |
| address | `REQUIRED` | needs_address_fix | 주소 없음 |
| address | `MISSING_DONG` / `INVALID_DONG` | needs_address_fix | 동 빠짐 / 건물에 없는 동 |
| address | `MISSING_HO` / `INVALID_HO` | needs_address_fix | 호 빠짐 / 등록된 호수에 없음 (건물 조회 실패 시 공동주택 표기로 추정) |
| product | `UNMATCHED_PRODUCT` / `REQUIRED` | needs_product_select | 상품 미매칭 / 상품 문구 없음 |
| product | `NO_PRODUCTS` | needs_product_select | 농가에 판매 중 상품이 없음 |
| recipientName | `REQUIRED` | needs_field_fix | 수령인 없음 |
| phone · senderPhone | `REQUIRED` / `INVALID_PHONE` | needs_field_fix | 연락처 없음 / 휴대폰 형식 아님 |

## 화면과 다른 점

- 원문으로 0건일 때 대체 검색어(시·도+도로명+번호)로 한 번 더 찾아 **후보로만** 보여 준다(`FALLBACK_CANDIDATES`).
  화면은 이 검색을 주소 수정 창에서 사용자가 열 때 한다. 어느 쪽도 자동 확정은 하지 않는다.
- 화면은 아직 이 API 를 쓰지 않고 같은 판정을 브라우저에서 돈다. 판정이 같은지는 대조 시험으로 본다.

## 저장 쪽 규칙 (create-farm-orders)

검수를 건너뛴 요청도 막도록 `create-farm-orders` 는 5자리 우편번호(=우체국 확정)가 없는 주문을 거절한다.
판매 중이 아닌 상품·수량 0 도 거절한다. 한 건이라도 틀리면 한 건도 넣지 않는다.
