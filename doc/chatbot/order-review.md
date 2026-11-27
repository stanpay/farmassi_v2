# 카카오 챗봇 — 주문 검수·등록 연동 안내

챗봇이 농가 회원 대신 카톡 주문을 검수하고 등록하는 방법. 조회 API(`/chatbot/query`, [developer-handoff.md](developer-handoff.md))와
같은 키를 쓴다. 검수 API 자체 명세는 [review-farm-orders.md](../backend/orders/command/review-farm-orders.md).

## 1. 엔드포인트

```
POST {API}/chatbot/rpc/review-farm-orders
POST {API}/chatbot/rpc/create-farm-orders
x-chatbot-key: <CHATBOT_API_KEY>
Content-Type: application/json
```

- `{API}`: 운영 `https://api.shop.lkim.me`, dev `https://dev.api.farmassi.kr`
- 본문은 `/rpc/review-farm-orders`·`/rpc/create-farm-orders` 와 같고, **`kakaoUserId` 를 하나 더** 넣는다.
  - `kakaoUserId` = 카카오 스킬 요청의 `userRequest.user.properties.appUserId`
    (= `auth.identities.provider_user_id`, provider `kakao`)
- 서버가 `kakaoUserId` 로 회원을 찾아 **그 회원 권한으로** 실행한다. 권한 검사(슈퍼어드민 또는 그 농가 `farm_members`)는 화면과 같다.
- `farmId` 를 빼면, 회원이 연결된 농가가 **딱 하나일 때만** 그 농가로 채운다.

| 상황 | 응답 |
|---|---|
| 키 없음·틀림 | 401 `{"error","code":"unauthorized"}` |
| 서버에 키 설정 없음 | 503 `code: disabled` |
| 이 두 함수가 아님 | 404 `code: not_found` |
| `kakaoUserId` 없음 | 400 `code: bad_request` |
| 카카오 계정과 연결된 회원 없음 | 403 `code: not_linked` → "먼저 카카오로 로그인해 주세요" 안내 |
| `farmId` 없음 + 농가 여러 개 | 400 `code: farm_required`, `farms: [{id,name}]` → 어느 농가인지 묻기 |
| `farmId` 없음 + 농가 없음 | 403 `code: no_farm` |
| 그 밖의 오류 | 함수 응답 그대로 `{"error": "한글 안내"}` (400·403·404·500) |

## 2. 대화 흐름

```
WAIT_TEXT ─(원문)→ review {text}
   └→ 응답 orders 를 세션에 보관
REVIEW: 첫 번째로 status ≠ ok 인 주문을 골라 묻는다
   needs_address_select → WAIT_ADDRESS_SELECT  "주소가 여러 건 검색됩니다. 번호를 골라 주세요. 1) [07524] … 2) …"
   needs_address_fix    → WAIT_ADDRESS_DETAIL  (MISSING_*·INVALID_* : 동·호만) / WAIT_ADDRESS (NOT_FOUND 등 : 주소 전체)
   needs_product_select → WAIT_PRODUCT         "상품을 골라 주세요. 1) 캠벨 5kg 45,000원 …"
   needs_field_fix      → WAIT_FIELD           errors[].field 의 칸만 다시 묻기
   전부 ok              → CONFIRM_SAVE         "N건 모두 확인됐습니다. 등록할까요?"
사용자 답 → review {action, orders(직전 응답 그대로), targetIndex, selection|patch} → REVIEW 로
CONFIRM_SAVE ─(등록)→ create {…saveRequest} → SAVED (orderNo 안내)
```

| 묻는 것 | 사용자 답 예 | 보내는 것 |
|---|---|---|
| 주소 번호 | `2` | `{"action":"select_address","targetIndex":i,"selection":{"candidateNo":2}}` |
| 주소 번호 + 동호 | `2 103동 801호` | `selection: {"candidateNo":2,"addressDetail":"103동 801호"}` |
| 시·군·구 다름 확인 | `맞아요` | `selection: {"candidateNo":1}` (후보 1건) |
| 동·호 | `103동 801호` | `{"action":"patch_order","targetIndex":i,"patch":{"addressDetail":"103동 801호"}}` |
| 주소 전체 | `서울 강서구 강서로 532, 103동 801호` | `patch: {"address":"…"}` |
| 상품 번호 | `1` | `patch: {"productId": productCandidates[0].id}` |
| 수량·이름·전화 | `2박스` / `김민수` / `010…` | `patch: {"quantity":"2박스"}` 등 |

- `targetIndex` 는 **0부터** (응답 `index` - 1). 응답 `index` 는 사람에게 보여 줄 번호.
- 메시지는 `errors[].message` 를 그대로 읽어 줘도 된다.

## 3. 꼭 지킬 것

1. **후보가 있으면 사용자가 고르기 전에 고르지 않는다.** 1건이어도 `needs_address_select` 면 확인받는다. 서버도 자동 확정하지 않는다.
2. **저장은 `summary.needsFix === 0` 이고 `saveRequest` 가 있을 때만**, 사용자가 "등록" 을 확인한 뒤. `saveRequest` 를 고치지 말고 그대로 보낸다.
   서버도 우체국 확정(5자리 우편번호)이 없거나 판매 중이 아닌 상품이면 거절한다.
3. 매 요청에 **직전 응답의 `orders` 전체**를 보낸다. `fields.addressToken` 을 지우거나 바꾸지 않는다(지우면 주소를 처음부터 다시 찾는다).
4. 등록은 한 묶음 전부 아니면 전무다. 일부만 먼저 등록하지 않는다.
5. 원문 검수(`text`)는 Claude 파싱이라 수십 초 걸릴 수 있다. 카카오 스킬 5초 제한에 걸리면 콜백(useCallback)으로 답한다.
   재검수(`action`)는 캐시 덕에 보통 1초 안이다.

## 4. 운영 전에 다시 볼 것

- `kakaoUserId` 는 챗봇(키를 가진 쪽)이 카카오가 준 값을 그대로 넘긴다는 전제다. 키가 새면 누구든 아무 회원으로 주문을 넣을 수 있으므로
  키는 Edge Function 비밀값에만 두고, 새면 바로 바꾼다.
- 서버 로그에는 `[chatbot-rpc] 함수 상태 ms` 만 남긴다 (주문 내용·전화번호는 남기지 않는다).
