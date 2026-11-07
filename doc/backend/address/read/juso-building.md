# `POST /rpc/juso-building` — 도로명주소 건물 동·호 조회

행정안전부 [도로명주소 API](https://business.juso.go.kr/jst/jstAddressApiList) 프록시.
검색 API 로 건물을 찾고, 상세주소 API 로 동·호 목록을 받는다.
승인키는 서버 환경변수 `JUSO_SEARCH_API_KEY`(검색 API), `JUSO_DETAIL_API_KEY`(상세주소 API) 만 쓴다.

- `address` (필수) — 확정된 도로명주소. 괄호 뒤(참고항목)는 서버에서 잘라 낸다.
- `dong` (옵션) — 상세주소에서 뽑은 동. `103` / `103동` 모두 된다.

응답:

| 필드 | 설명 |
|------|------|
| `found` | 검색 API 에서 건물을 1건으로 특정했는지 |
| `apartment` | 공동주택 여부 (`bdKdcd == 1`) |
| `buildingName` | 건물명 (`bdNm`) |
| `dongs` | 주거용 동 이름. 상가동·관리동 등은 뺀다. 동 이름 없는 단일 건물이면 `[]` |
| `hos` | `hoDong` 의 호 목록. 동을 특정하지 못하면 `null` |
| `hoDong` | `hos` 를 조회한 동. `''` 은 동 이름이 없는 건물 |

## 판단 규칙 (프론트 `checkAddressDetail`)

- 공동주택이거나 등록된 동·호가 있으면 호 필수
- 주거용 동이 2개 이상이면 동 필수
- 동·호가 목록에 없으면 확인 요청
- 건물 조회 실패 시: 주소에 아파트·빌라 등 표기나 동이 있는데 호가 없으면 확인 요청

자동 검증에서 걸리면 주소 오류로 표시하고, 주소 수정 창에서 사용자가 확인 후 그대로 확정할 수 있다.

## 관련 파일

- [`server-py/app/functions/juso_building.py`](../../../../server-py/app/functions/juso_building.py)
- [`server/src/functions/jusoBuildingLookup.ts`](../../../../server/src/functions/jusoBuildingLookup.ts)
- [`src/lib/jusoBuilding.ts`](../../../../src/lib/jusoBuilding.ts)
