# `POST /rpc/parse-order-messages` — 카톡 주문 메시지 파싱

카카오톡 대화 원문을 Claude 로 구조화한다. API 키는 서버 환경변수
`ANTHROPIC_API_KEY` 만 쓴다. 브라우저/`VITE_*` 로 노출하지 않는다.

**분리·병합·무시:** 맥락 판단이 필요해 Claude 가 결정한다. 나중에 보낸 보완은
그 주문의 `supplements`, 재전송 등은 최상위 `ignored` 에 원문 구간으로 담긴다.
프론트(`normalizeParsedOrders`)는 이 구간들의 원문 위치만 맞추고, 분리·병합은 하지 않는다.

**문자열 충실성:** 모델이 문자를 다시 쓰면 서버가 원문에서 구간을 다시 찾아
덮어쓴다. 허용은 자르기·공백 무시 매칭뿐이고, 전화/주소 포맷 교정은 하지 않는다.

로컬에서 `VITE_DEV_BYPASS_AUTH=true` 이면 Vite 프록시
`POST /__dev/parse-order-messages` 가 같은 키로 대신 호출한다.

## 요청

- `text` (필수) — 카톡 대화를 그대로 붙여 넣은 문자열

## 응답

`orders[]` 각 항목:

| 필드 | 설명 |
|------|------|
| `raw` | 원문에서 잘라 낸 주문 블록 |
| `blockStart` / `blockEnd` | 원문 인덱스 (없으면 `null`, 프론트에서 `raw`로 재계산) |
| `recipientName`, `phone` | 수령인·연락처 |
| `address` | 기본주소 (도로명 또는 지번) |
| `addressDetail` | 동·호·건물명 등 상세 |
| `product`, `quantity` | 상품·수량(양의 정수) |
| `senderName`, `senderPhone` | 보내는분 이름·전화 |
| `depositorName`, `memo` | 입금자·요청사항 |
| `highlight` | `raw` 안의 부분문자열 (카드 색칠용) |
| `supplements` | 이 주문에 병합한 보완 말풍선 원문 구간 목록 |

`ignored[]` — 주문으로 만들지 않고 무시한 원문 구간(재전송 등). 미연결로 표시하지 않는다.

파싱 후 프론트는 우체국 통합검색(`epost-address`)으로 주소를 검증한다.
결과가 **정확히 1건**이고 도로명/지번이 일치할 때만 자동 확정한다.

상품은 파서가 원문 문구만 남기고, 프론트가 농가 카탈로그와 맞춘다.
1. 로컬 `matchFarmProduct` — 정확/포함/무게·품종 점수
2. 실패 건만 `match-farm-products`(Claude) — 예: `포도 5kg` → `캠벨 5kg`

## 환경변수

- `ANTHROPIC_API_KEY` — Anthropic API 키 (루트 `.env` 또는 `server/.env`)
- 모델 ID: `claude-sonnet-5-5` (콘솔 Models 목록에 있는 id 를 써야 함. 없는 id 는 HTTP 404)

## 관련 파일

- [`server/src/functions/parseOrderMessages.ts`](../../../../server/src/functions/parseOrderMessages.ts)
- [`server-py/app/functions/parse_order_messages.py`](../../../../server-py/app/functions/parse_order_messages.py)
- [`vite.parseOrderDevProxy.ts`](../../../../vite.parseOrderDevProxy.ts)
- [`src/lib/parseOrderMessages.ts`](../../../../src/lib/parseOrderMessages.ts)
- [`src/pages/farm/OrderCreate.tsx`](../../../../src/pages/farm/OrderCreate.tsx)
