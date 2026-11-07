# `POST /rpc/match-farm-products` — 농가 카탈로그 상품 매칭

카톡에서 뽑힌 상품 문구(`포도 5kg`)를 농가 판매 상품 목록과 연결한다.
로컬 점수 매칭이 실패한 건만 프론트가 이 API로 넘긴다.

## 요청

- `queries` (필수) — 상품 문구 배열
- `products` (필수) — `{ id, name }[]` 농가 판매 상품

## 응답

- `productIds` — `queries` 와 같은 길이. 매칭되면 상품 id, 아니면 `null`

## 환경변수

- `ANTHROPIC_API_KEY`
- 모델: `claude-sonnet-5-5`

로컬 `VITE_DEV_BYPASS_AUTH=true` 이면 Vite 프록시
`POST /__dev/match-farm-products` 가 대신 호출한다.

## 관련 파일

- [`server/src/functions/matchFarmProducts.ts`](../../../../server/src/functions/matchFarmProducts.ts)
- [`server-py/app/functions/match_farm_products.py`](../../../../server-py/app/functions/match_farm_products.py)
- [`src/lib/matchFarmProduct.ts`](../../../../src/lib/matchFarmProduct.ts)
- [`src/lib/matchFarmProductsRemote.ts`](../../../../src/lib/matchFarmProductsRemote.ts)
- [`vite.parseOrderDevProxy.ts`](../../../../vite.parseOrderDevProxy.ts)
