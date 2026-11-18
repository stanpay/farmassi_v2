# 우편번호 정보조회 (통합검색 5자리)

검색어 하나로 도로명·지번 목록과 **5자리 우편번호**를 조회하는 우정사업본부 Open API.

- 공공데이터포털: [우편번호 정보조회](https://www.data.go.kr/data/15056971/openapi.do)
- 참고 명세서: `통합검색5자리우편번호조회서비스명세서.docx` (포털 참고문서와 동일)

도로명/지번/우편번호로 **검색 구분을 나누는** [도로명주소조회서비스](https://www.data.go.kr/data/15000124/openapi.do)와 달리, 이 API는 `srchwrd` 한 칸 통합검색이다. 응답에 들어가는 값(우편번호·도로명·지번)은 같은 계열이다.

## 개요

| 항목 | 내용 |
|------|------|
| OpenAPI 명 | 과학기술정보통신부 우정사업본부_우편번호 정보조회 |
| 서비스명(국문) | 통합검색 5자리 우편번호 조회서비스 |
| 서비스명(영문) | `RetrieveNewAdressAreaCdSearchAllService` |
| 제공기관 | 과학기술정보통신부 우정사업본부 |
| API 유형 | REST (GET) |
| 데이터 포맷 | XML |
| 인증 | 서비스 Key (`serviceKey`) — 공공데이터포털 활용신청 |
| 비용 | 무료 |
| 승인 | 개발·운영 모두 자동승인 |
| 트래픽 | 개발계정 10,000회/일 · 운영은 활용사례 등록 후 증설 가능 |
| 등록일 / 수정일 | 2015-05-19 / 2021-08-17 |

출력 항목: **우편번호**, **도로명주소**, **지번주소**.

## 오퍼레이션

| 항목 | 내용 |
|------|------|
| 오퍼레이션(영문) | `getNewAddressListAreaCdSearchAll` |
| 오퍼레이션(국문) | 통합검색 |
| 유형 | 조회(목록) |
| 설명 | 검색어에 해당하는 도로명주소·지번주소 상세 목록을 조회한다 |
| 요청 메시지 | `NewAddressListAreaCdSearchAllRequest` |
| 응답 메시지 | `NewAddressListResponse` |

## 엔드포인트

```
http://openapi.epost.go.kr/postal/retrieveNewAdressAreaCdSearchAllService/retrieveNewAdressAreaCdSearchAllService/getNewAddressListAreaCdSearchAll
```

## 요청 파라미터

포털 요청변수 표에는 `serviceKey`가 없지만, **인증키 없이 호출하면 실패**한다. URL에 반드시 포함한다.

| 항목명(국문) | 항목명(영문) | 크기 | 구분 | 샘플 | 설명 |
|--------------|--------------|------|------|------|------|
| 인증키 | `serviceKey` | — | 필수 | (발급키) | 공공데이터포털 인증키. URL 인코딩된 Decoding 키 사용 |
| 검색어 | `srchwrd` | 200 | 필수 | `공평동` | 통합 검색어 (동명, 도로명+건물번호 등) |
| 페이지당 출력 개수 | `countPerPage` | 10 | 옵션 | `10` | 페이지당 건수 (**최대 50**) |
| 출력될 페이지 번호 | `currentPage` | 10 | 옵션 | `1` | 페이지 번호 |

### 호출 예시

```
http://openapi.epost.go.kr/postal/retrieveNewAdressAreaCdSearchAllService/retrieveNewAdressAreaCdSearchAllService/getNewAddressListAreaCdSearchAll?serviceKey={인증키}&srchwrd=세종로17&countPerPage=10&currentPage=1
```

```bash
curl -sG \
  'http://openapi.epost.go.kr/postal/retrieveNewAdressAreaCdSearchAllService/retrieveNewAdressAreaCdSearchAllService/getNewAddressListAreaCdSearchAll' \
  --data-urlencode "serviceKey=${EPOST_SERVICE_KEY}" \
  --data-urlencode 'srchwrd=테헤란로 152' \
  --data 'countPerPage=10' \
  --data 'currentPage=1'
```

검색어 예: `공평동`, `세종로 17`, `테헤란로 152` — 지번/도로명 구분 없이 한 칸에 넣는다.

## 응답 필드

목록은 `newAddressListAreaCdSearchAll` 아래에 0..n건이 오고, 페이징·공통 헤더는 별도 노드다.

| 항목명(국문) | 항목명(영문) | 크기 | 구분 | 샘플 | 설명 |
|--------------|--------------|------|------|------|------|
| 우편번호 | `zipNo` | 5 | 필수 | `36991` | 5자리 우편번호 |
| 도로명주소 | `lnmAdres` | 200 | 필수 | `경상북도 문경시 …` | 검색결과 도로명주소 |
| 지번주소 | `rnAdres` | 200 | 필수 | `경상북도 문경시 …` | 검색결과 지번주소 |
| 전체 데이터 개수 | `totalCount` | 10 | 옵션 | `255` | 검색된 전체 건수 |
| 페이지당 출력 개수 | `countPerPage` | 10 | 옵션 | `10` | 요청한 페이지 크기 |
| 전체 페이지 수 | `totalPage` | 10 | 옵션 | `26` | 전체 페이지 수 |
| 현재 페이지 번호 | `currentPage` | 10 | 옵션 | `1` | 현재 페이지 |
| 공통 메시지 | `cmmMsgHeader` | — | — | — | 성공 여부·결과 코드 등 |

> 필드명 주의: 이 서비스(통합검색) 명세·포털 기준 `lnmAdres` = 도로명, `rnAdres` = 지번이다.  
> [도로명주소조회서비스](https://www.data.go.kr/data/15000124/openapi.do) 쪽 예제 문서와 국문 라벨이 뒤바뀌어 적힌 경우가 있어, **연동 시 샘플 XML의 실제 값으로 확인**할 것.

### 응답 예시 (명세서 샘플, `srchwrd=세종로17`)

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<xsync>
  <xsyncData>
    <zipNo><![CDATA[ 12621 ]]></zipNo>
    <rnAdres><![CDATA[ 경기도 여주시 홍문동 111-15 ]]></rnAdres>
    <lnmAdres><![CDATA[ 경기도 여주시 세종로 17 (홍문동) ]]></lnmAdres>
  </xsyncData>
  <xsyncData>
    <zipNo><![CDATA[ 12621 ]]></zipNo>
    <rnAdres><![CDATA[ 경기도 여주시 홍문동 111-2 ]]></rnAdres>
    <lnmAdres><![CDATA[ 경기도 여주시 세종로 17-1 (홍문동) ]]></lnmAdres>
  </xsyncData>
  <!-- … 목록 생략 … -->
  <xsyncData>
    <totalCount><![CDATA[ 22 ]]></totalCount>
    <countPerPage><![CDATA[ 10 ]]></countPerPage>
    <totalPage><![CDATA[ 3 ]]></totalPage>
    <currentPage><![CDATA[ 1 ]]></currentPage>
  </xsyncData>
</xsync>
```

실제 게이트웨이 응답은 `NewAddressListResponse` / `cmmMsgHeader` / `newAddressListAreaCdSearchAll` 래퍼를 쓰는 형태일 수 있다. 연동 시 필드명(`zipNo`, `lnmAdres`, `rnAdres`)을 기준으로 파싱한다.

## 에러 코드

공공데이터포털 GW 공통 코드.

| 에러메시지 | 코드 | 설명 |
|------------|------|------|
| `APPLICATION_ERROR` | 01 | GW 내부 처리 오류. 재시도 후 반복 시 활용지원센터 문의 |
| `HTTP_ERROR` | 04 | 허용되지 않은 HTTP 요청 또는 기관 API 응답 처리 실패 |
| `SERVICETIMEOUT_ERROR` | 05 | 기관 API·GW 연결 실패 또는 응답 대기 시간 초과 |
| `INVALID_REQUEST_PARAMETER_ERROR` | 10 | 요청 파라미터 값·형식 오류 |
| `NO_OPENAPI_SERVICE_ERROR` | 12 | 서비스 없음·폐기. URL 확인 |
| `SERVICE_KEY_IS_NULL` | 20 | 인증키 미포함 |
| `PERMISSION_DENIED` | 20 | 접근 권한 거부. 활용신청·권한 확인 |
| `SERVICE_ACCESS_DENIED_ERROR` | 20 | 해당 API 이용 권한 없음 (신청·승인·일시중지 확인) |
| `LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR` | 22 | 일일 호출 한도 초과 |
| `LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR` | 23 | 초당 호출 한도 초과 |
| `BLACKLIST_IP_ACCESS_ERROR` | 29 | 차단된 IP에서 호출 |
| `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` | 30 | 등록되지 않은 인증키 |
| `DEADLINE_HAS_EXPIRED_ERROR` | 31 | 인증키 사용 기한 만료 |

기관 쪽 결과 코드(헤더)는 보통 `00` 정상, `01` Application Error, `02` DB Error, `03` No Data, `04` HTTP Error, `99` Unknown 등으로 온다.

## 연동 시 참고

- 브라우저에서 `serviceKey`를 직접 넣지 말고 **서버(Edge Function 등) 프록시**로 호출한다.
- 응답이 XML이라 파싱이 필요하다.
- 창구소포 엑셀 주소검증과 맞추려면 네이버/카카오보다 **이 API(우체국 계열)** 가 가깝다.
- 앱 `AddressPicker`의 `AddressValue`(`zonecode`, `address`, …) 매핑 후보: `zipNo` → `zonecode`, `lnmAdres` → `address`.

## 출처

1. [공공데이터포털 — 우편번호 정보조회](https://www.data.go.kr/data/15056971/openapi.do)
2. 우정사업본부 `통합검색5자리우편번호조회서비스명세서.docx`
