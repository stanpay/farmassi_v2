# `POST /rpc/epost-address` — 우체국 통합검색 우편번호

우정사업본부 [우편번호 정보조회](https://www.data.go.kr/data/15056971/openapi.do) Open API 프록시.
`serviceKey` 는 서버 환경변수 `EPOST_SERVICE_KEY` 만 쓴다.

- `query` (필수) — 검색어 (`srchwrd`)
- `countPerPage` (옵션, 기본 20, 최대 50)
- `currentPage` (옵션, 기본 1)

응답 `results[]`: `zipNo`, `roadAddress`(`lnmAdres`), `jibunAddress`(`rnAdres`).

명세: [`openapi/postal-search-all.md`](../../../../openapi/postal-search-all.md)

## 관련 파일

- [`server-py/app/functions/epost_address.py`](../../../../server-py/app/functions/epost_address.py)
- [`src/lib/epostAddress.ts`](../../../../src/lib/epostAddress.ts)
