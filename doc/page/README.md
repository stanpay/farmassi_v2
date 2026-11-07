# 페이지

상단 //뒤에 작성된 내용은 작성자 메모로 개발에 참고하지 않음
"[FIXME] 내용"은 해당 줄에 수정해야할 사항을 표시한 것으로 수정을 검수한 뒤 지움, 추후 문서화가 완료되면 [FIXME] 대신 커밋해시와 디스코드 사유설명만 남기는것으로 바꿀 예정
경로 하나에 문서 하나.
요소는 왼쪽에서 오른쪽, 위에서 아래 순으로 나열한다
요소는 이름과 document.querySelector를 사용했을 때 검색되는 css selector를 작성한다
구성은 아래 양식과 예시를 참고한다
요소와 정책, 예외를 한번호에 작성한다
정책과 예외는 1., 2. 번호순으로 우선순위이다
정책 안에서 조건 분기는 a), b), c)로 작성한다 이 순서로 우선순위이다
페이지의 모든 요소 작성, 다른 페이지와 겹치는 header같은 것도 복사해서 작성
요소란 작성자가 지정한 버튼, 카드 등을 말한다
~등으로 표시하지 않고 모든 상태, 사항을 작성한다

## 손님

| 화면 | 경로 |
|---|---|
| [랜딩](landing.md) | `/` |
| [농가 스토어](farm-store.md) | `/farm/:farmSlug` |
| [농가 소개](farm-landing.md) | `/farm/:farmSlug/landingpage` |
| [주문하기](checkout.md) | `/farm/:farmSlug/checkout` |
| [주문 완료](order-complete.md) | `/me/orders/:orderId/complete` |
| [계좌 복사](account-copy.md) | `/farm/:farmSlug/qr` |
| [내 주문](my-orders.md) | `/me/orders` |
| [주문 상세](my-order-detail.md) | `/me/orders/:orderId` |

## 로그인

| 화면 | 경로 |
|---|---|
| [로그인](login.md) | `/login` |
| [관리자 로그인](admin-login.md) | `/admin/login` |
| [로그인 콜백](auth-callback.md) | `/auth/callback` |

## 관리자

| 화면 | 경로 |
|---|---|
| [대시보드](admin-dashboard.md) | `/admin` |
| [농가 관리](admin-farms.md) | `/admin/farms` |
| [주문 관리](admin-orders.md) | `/admin/orders` |
| [입금 관리](admin-deposits.md) | `/admin/deposits` |
| [입금 원장](admin-deposit-ledger.md) | `/admin/deposits/ledger` |
| [송장](admin-shipments.md) | `/admin/shipments` |
| [배송이력 관리](admin-shipping-history.md) | `/admin/shipping-history` |
| [우체국 접수 안내](admin-shipping-manual.md) | `/admin/shipping-manual` |

## 농가 작업공간

관리자 화면 안에 탭으로 들어 있다.

| 화면 | 경로 |
|---|---|
| [대시보드](farm-dashboard.md) | `/admin/farms/:farmId` |
| [주문](farm-orders.md) | `/admin/farms/:farmId/orders` |
| [상품 관리](farm-products.md) | `/admin/farms/:farmId/products` |
| [배송 설정](farm-delivery.md) | `/admin/farms/:farmId/delivery` |
| [설정](farm-settings.md) | `/admin/farms/:farmId/settings` |

## 양식
//[작성자 메모 — ai가 읽지 않도록 할 내용이 있으면 여기에]

[페이지 명]
//페이지 파일 명이 아닌 사람이 알아보기 좋은 이름으로 예 - 주문페이지
[페이지 엔드포인트]

1. [요소명]
   selector: `[css selector]` (텍스트: [버튼/링크에 보이는 글자, 없으면 생략])
   - 설명
     1. [동작·역할 — 클릭/입력 시 무엇을 하는지]
   - 정책
     1. [표시 조건, 데이터 출처, 화면 형식]
   - 예외
   [표시하지 않는 조건, 다른 동작으로 빠지는 경우]

2. [요소명]
   selector: `[css selector]`
   - 설명
   [이 요소가 무엇인지 한두 문장]
   - 정책
     1. [정책 1]
        a) [분기 A]
        b) [분기 B]
        c) [분기 C]
   - 예외
   [예외]

3. [요소명]
   selector: `[css selector]`
   - 설명
   [설명]
   - 정책
     1. [동작이 여러 갈래일 때]
        a) [조건 A]: [동작]
        b) [조건 B]: [동작]
   - 예외
   [예외]

4. [요소명]
   selector: `[css selector]` (텍스트: [글자])
   - 설명
   [설명]
   - 정책
     1. [정책 1]
     2. [정책 2]
   - 예외
   [예외]

[N]. [큰 요소명 — 카드·폼·목록 등]
   selector: `[css selector]`
   - 설명
   [부모 요소가 무엇을 묶는지. 반복·레이아웃 특성]
   - 정책
   **1. [정책 소제목]**: [핵심 규칙 한 줄]

   **2. [정책 소제목]** ([보조 설명]):
   1. [단계/조건 1]
   2. [단계/조건 2]
   3. [단계/조건 3]

   **3. [정책 소제목]**: [계산·표시 방식]

   **4. 표시**: [N-M]에 [무엇], [N-M]에 [무엇]을 표시한다. [상태별 UI 변화]. [추가 문구 조건과 전문: '[고정 문구]'].
   - 예외
   [카드/블록 전체를 숨기는 조건]

   [N]-1. [서브 요소명]
   selector: `[css selector — 부모 범위 안에서]`
   - 설명
   [설명]
   - 정책
   [정책. 고정 문구면 '[화면에 보이는 글자]' 명시]
   - 예외
   [예외]

   [N]-2. [서브 요소명]
   selector: `[css selector]`
   - 설명
   [설명]
   - 정책
   [정책. 형식 예: '[M월 D일(요일)]' 형식]
   - 예외
   [예외]

   [N]-3. [서브 요소명]
   selector: `[css selector]`
   - 설명
   [설명]
   - 정책
   [기본 표시 형식]

   [조건 그룹명]([왜 이 분기가 있는지]):
   - [조건 A]: '[화면 문구]' [추가 동작]
   - [조건 B]: '[화면 문구]' [추가 동작]
   - 예시: [구체적 시나리오 → 화면 결과]
   - 예외
   [예외]

   [N]-4. [서브 요소명]
   selector: `[css selector]`
   - 설명
   [설명]
   - 정책
   '[고정 안내 문구 전문]' 을 [항상/조건부] 표시한다.
   - 예외
   [예외]

[M]. [반복 요소명 — 상품 카드 등]
   selector: `[css selector — querySelector 시 첫 항목]`
   - 설명
   [요소 설명. 그리드/목록 반복 여부. 반응형 레이아웃]
   - 정책
   [데이터 출처 테이블·필터·정렬. localStorage/API 등 상태 저장]
   - 예외
   [목록이 비었을 때 대체 UI. 연관 요소(다른 번호) 비활성 조건]

   [M]-1. [서브 요소명]
   selector: `[css selector]`
   - 설명
   [설명]
   - 정책
   [기본 표시 방식. fallback UI]
   - [enum값1] ([라벨]): [뱃지/UI 동작]
   - [enum값2] ([라벨]): [뱃지/UI 동작]
   - [enum값3] ([라벨]): [뱃지/UI 동작]
   [enum 전부 나열 — '등'으로 생략하지 않음]
   [공통 스타일 설명]
   - 예외
   [예외]

   [M]-2. [서브 요소명]
   selector: `[css selector]`
   - 설명
   [설명]
   - 정책
   [정책]
   - 예외
   [예외]

   [M]-3. [서브 요소명]
   selector: `[css selector]`
   - 설명
   [설명. 함께 표시되는 부가 문구]
   - 정책
   [금액/텍스트 형식. 조건부 UI 분기 — 조건마다 무엇을 표시하는지 전부]
   - 예외
   [예외]

   [M]-4. [서브 요소명]
   selector: `[css selector]`
   - 설명
   [설명]
   - 정책
   [구성 요소(라벨, 버튼, 숫자). 클릭 시 동작. 다른 번호 요소와 연동]
   - 예외
   [상태·권한별로 숨기는 조건 — 가능한 값 전부 나열]

[K]. [고정 바·푸터 등]
   selector: `[css selector]`
   - 설명
   [설명]
   - 정책
   [표시 조건. 레이아웃(고정 위치, 여백 확보)]
   - 예외
   [예외]

   [K]-1. [서브 요소명]
   selector: `[css selector]`
   - 설명
   [설명]
   - 정책
   '{n}개 선택' 등 화면 형식. 합산/필터 규칙
   - 예외
   [예외]

   [K]-2. [서브 요소명]
   selector: `[css selector]`
   - 설명
   [설명]
   - 정책
   [계산식·표시 형식]
   - 예외
   [예외]

   [K]-3. [버튼명]
   selector: `[css selector]` (텍스트: [글자])
   - 설명
   [이동 경로/기능]
   - 정책
   클릭 시 [조건 A]이면 [중간 UI — 제목/본문/확인 버튼 전문]. [조건 B]이면 [동작]. 미로그인 시 [로그인 후 이동 경로].
   - 예외
   [예외]

[L]. [배너·알림]
   selector: `[css selector]`
   - 설명
   [언제·어디에 뜨는지]
   - 정책
   [표시 조건 = DB/API 필드와 값]. 제목 '[제목 전문]', 부제 '[부제 전문]'. [함께 숨겨지는 다른 번호 요소].
   - 예외
   [표시하지 않는 경우 — 비슷해 보이는 다른 상태와 구분]

## 예시
//

농가 스토어
/farm/:farmSlug

1. 뒤로가기 버튼
   selector: `button[data-leave-guard][aria-label="뒤로가기"]`
   - 설명
     1. 클릭 시 농가 랜딩페이지(/farm/[farmSlug]/landingpage)로 이동
   - 정책
     1. 장바구니 여부와 상관없이 뒤로가기 -> 장바구니는 localstorage에 남아있기 때문
   - 예외
   브라우저 뒤로가기 시 헤더버튼과 무관하게 직전페이지로 이동 -> 고객 퍼널을 농가 랜딩페이지로 해두어서 항시 농가 랜딩페이지 방문
   
2. 농가명
   selector: `header h1`
   - 설명
   /admin/farms에서 입력 된 농가명 표시
   - 정책
     1. farms.name 값을 그대로 표시. 길면  marquee 처리 [FIXME] 현재 한 줄 말줄임(truncate).
   - 예외
     
3. 농가 주소
   selector: `header p > span`
   - 설명
   /admin/farms 에서 입력 된 농가 주소 표시
   - 정책
     1. 주소표시
        a) address + address_detail 이 있으면 우선 표시(우편번호 제외).
        b) 없으면 location.
        c) a,b에 해당하지 않는 경우 '주소 불러올 수 없음'으로 표시 [FIXME] 현재 농가 직송으로 표시됨
   - 예외
      address 가 비어 있으면 주소복사 버튼은 표시하지 않음.
     
4. 주소복사 버튼
   selector: `header p > button` (텍스트: 주소복사 / 복사됨)
   - 설명
     클릭 시 헤더에 보이는 주소 문자열(subtitle)을 클립보드에 복사하는 기능
   - 정책
      1. 성공 시 2초간 '복사됨'으로 표시.
      2. 실패 시 주소복사 형태 그대로 유지
   - 예외
     address 가 없으면 버튼 자체를 표시하지 않음.

5. 관리자 페이지 링크
   selector: `a[href="/admin/farms"]`
   - 설명
      농가 관리 화면(/admin/farms)으로 이동하는 링크
   - 정책
      로그인 한 사용자가 admin일 때만 버튼이 보임.
   - 예외
      비로그인 또는 admin이 아닌 사용자에게는 표시하지 않음.
    
6. 내 주문 버튼
   selector: `header div.shrink-0 button`
   - 설명
      내 주문 목록(/me/orders)으로 이동하는 버튼
   - 정책
     1. 클릭 시
        a) 로그인되어 있으면 /me/orders 로 이동.
        b) 미로그인 시 로그인 시트를 열고, 로그인 후 /me/orders 로 이동.
   - 예외
     정책b에서 로그인 실패 시??????.

7. 카카오톡 문의 버튼
   selector: `a[href*="pf.kakao.com"][target="_blank"]`
   - 설명
   농가 카카오톡 채널 1:1 채팅으로 이동하는 버튼.
   - 정책
     farms.kakao_channel_url 이 유효한 http(s) URL일 때만 표시.
     클릭 시 새 탭에서 카카오 채널 /chat 링크를 연다.
   - 예외
     1. kakao_channel_url 이 없거나 유효하지 않으면 표시하지 않음.
     2. 카카오·전화 모두 없으면 7·8번 대신 농가 설명(description 또는 product_summary) 카드를 표시한다.

8. 전화문의 버튼
   selector: `a[href^="tel:"]`
   - 설명
      농가 전화번호로 전화를 거는 버튼.
      클릭 시 기기 전화 앱을 연다.
      가로 공간이 충분할 때는 카카오톡 문의 버튼 오른쪽, 부족할 때는 아래로 이동한다
   - 정책
     1. 전화번호 표시
        a) mobile_phone 이 있으면 표시
        b) a가 없으면 phone 을 tel: 링크로 연다. 
   - 예외
      mobile_phone · phone 모두 없으면 버튼 표시하지 않음.

9. 예상 배송일정 카드
   selector: `div.space-y-4 > div.rounded-2xl.flex.items-start.gap-2.px-3.py-2.5`
   - 설명
   지금 주문했을 때 받을 도착 예정일과 출고 정보를 보여주는 안내 카드
   - 정책
   **1. 주문 마감**: 출고일 전날 17시(서울 기준)까지 주문·결제해야 해당 출고일에 실립니다. 17시를 넘기면 그 출고일은 빠지고, 다음 가능한 출고일로 잡힙니다.
   이는 출고일을 계산하는 안내일 뿐으로, 17시가 지난 주문도 관리자가 접수만하면 다음날 발송 가능

   **2. 출고일 계산** (가장 가까운 출고일부터 순서대로):
   1. 후보 시작일 = 내일. 단, 오늘 17시를 넘겼으면 모레부터 시작(오늘 접수분에 못 들어가므로).
   3. 후보 날짜가 배송 일시정지(shipping_pauses) 구간이면 정지 종료 다음날로 이동.
   4. 일요일·공휴일(holidays)은 우체국 미운행이므로 건너뜀.
   5. delivery_days 가 설정되어 있으면 그 요일(예: 월·금)만 출고일로 선택. 없으면 위 조건만 맞으면 됨.

   **3. 도착 예정일 계산**: 출고일 다음날부터 일요일·공휴일을 빼고 2일 뒤(우체국 택배 기준).

   **4. 표시**: 9-2에 도착 예정일(손님이 받는 날), 9-3에 출고 요일·출고 예정일(물건이 나가는 날)을 함께 표시한다. 배송 일시정지 중에도 주문은 받으며, 정지 기간이 있으면 카드 배경이 amber 로 바뀌고 정지 안내 문구를 추가 표시한다(사유 있음: '"{사유}"로 인해 "{시작일} ~ {종료일}" 배송이 불가능합니다', 사유 없음: '"{시작일} ~ {종료일}" 배송이 불가능합니다'). 당일 주문 수량이 한도를 넘으면 '현재 주문 물량 증가로 예상배송일정을 확인해주세요' 문구를 추가 표시한다.
   - 예외
   farmId 로 계산할 도착일이 없으면 카드 전체를 표시하지 않음.

   9-1. 예상 배송일정 라벨
   selector: `div.space-y-4 > div.rounded-2xl.flex.items-start span.font-semibold.text-gray-900`
   - 설명
   '예상 배송일정' 고정 문구
   - 정책
   항상 동일한 라벨 텍스트를 표시한다.
   - 예외

   9-2. 도착 예정일
   selector: `div.space-y-4 > div.rounded-2xl.flex.items-start span.font-semibold.text-primary`
   - 설명
   위 출고일 계산으로 잡힌 출고일 기준, 도착 예정일(손님이 받는 날). 출고일이 아님.
   - 정책
   출고일 + 2영업일(일요일·공휴일 제외)을 'M월 D일(요일)' 형식으로 크게 표시한다. 예: 금요일 출고 → 화요일 도착(주말·공휴일 건너뜀). 주문 물량 한도 초과 경고가 켜져도 날짜 자체는 동일하게 표시한다.
   - 예외

   9-3. 출고 요일·출고 예정일
   selector: `div.space-y-4 > div.rounded-2xl.flex.items-start > div.min-w-0 > p.text-xs.leading-snug.text-muted`
   - 설명
   출고 요일 설정과 이번 주문의 출고 예정일, 17시 마감 안내를 보여주는 줄
   - 정책
   delivery_days 가 있으면 '월, 금 출고' 형식으로 표시하고, 없으면 '주문 다음날 출고'로 표시한다. 뒤에 '· {출고 예정일} 출고 예정'을 붙인다.

   17시 마감 안내(출고일 전날 17시까지 주문해야 해당 출고일에 실리는 규칙을 화면에 반영):
   - 오늘 17시 이전이고 내일이 출고일이면: '17시 이전까지 결제 시 내일 출발' 줄바꿈 추가.
   - 오늘 17시를 넘겨 내일 출고가 불가능해진 경우: '오늘 17시 주문마감으로 다음 출고일에 배송됩니다' 줄바꿈 추가.
   - 예시: 월·금 출고 농가, 오늘이 목요일 16시 → 금요일 출고·도착 예정일 표시 + '17시 이전까지 결제 시 내일 출발'. 같은 날 18시 → 다음 월요일 출고로 밀림 + 마감 안내.
   - 예외
   배송 정지 중(activePause)이면 17시 마감 관련 줄은 표시하지 않음(정지로 인해 출고가 밀리므로).

   9-4. 신선도 안내 문구
   selector: `div.space-y-4 > div.rounded-2xl.flex.items-start > div.min-w-0 > p.text-xs.leading-snug.text-muted:last-of-type`
   - 설명
   수확 후 출고되는 특성을 설명하는 고정 안내 문구
   - 정책
   '신선도를 위해 주문이 들어온 후 수확하므로 다음날부터 출고가 가능한 점 양해 부탁드립니다.' 를 항상 표시한다.
   - 예외

10. 상품 카드
    selector: `div.grid.gap-4 > div.rounded-2xl.bg-white.border.border-gray-100`
    - 설명
    판매 중인 상품 하나를 보여주는 카드. 그리드에 상품 수만큼 반복된다.
    기본 한줄에 2개, 가로가 좁아지면 1개 표시
    - 정책
    products 테이블에서 is_active=true 인 상품을 sort_order 순으로 표시한다. 장바구니 수량은 localStorage(/farm/:farmSlug 키)에 저장한다.
    - 예외
    판매 중인 상품이 없으면 '판매 중인 상품이 없습니다' 문구만 표시하고 카드는 없음. 농가가 비활성(is_active=false)이면 수량 조절을 비활성화한다(주문 불가).

    10-1. 상품 이미지
    selector: `div.grid.gap-4 > div.rounded-2xl.bg-white img`
    - 설명
    상품 대표 이미지
    - 정책
    products.image_url 이 있으면 16:9 비율로 object-cover 표시. 없으면 상품 id 기반 그라데이션 placeholder 를 표시한다. sale_status 에 따라 이미지 위 상태 뱃지를 표시한다.
    - on_sale (판매중): 뱃지 없음
    - coming_soon (판매 예정): '판매 예정' 뱃지
    - sold_out (품절): '품절' 뱃지
    - inquiry (별도 문의): '별도 문의' 뱃지
    - hidden (숨김): '숨김' 뱃지
    뱃지는 이미지 전체를 반투명 검정 오버레이로 덮고 중앙에 흰색 pill 로 표시한다.
    - 예외

    10-2. 상품명
    selector: `div.grid.gap-4 h3.font-bold.leading-snug.text-gray-900`
    - 설명
    products.name 을 한 줄로 표시하는 제목
    - 정책
    카드 너비에 맞게 글자 크기를 줄이고, 그래도 넘치면 marquee 애니메이션으로 전체 이름을 보여준다.
    - 예외

    10-3. 가격
    selector: `div.grid.gap-4 span.text-lg.font-bold.text-primary`
    - 설명
    상품 판매가. '배송비 포함' 문구와 함께 표시된다.
    - 정책
    products.price 를 ₩ 형식으로 표시한다. list_price 가 price 보다 클 때만 할인 표시: 취소선 원가(list_price) + 할인가(price) + 할인율 N% 빨간 배지. list_price 가 없거나 price 이하이면 할인가만 표시한다.
    - 예외

    10-4. 수량 조절
    selector: `div.grid.gap-4 div.mt-3.flex.items-center.justify-between`
    - 설명
    장바구니에 담을 수량을 +/- 버튼으로 조절하는 영역
    - 정책
    '수량' 라벨과 감소·증가 버튼, 현재 수량 숫자를 표시한다. +/- 클릭 시 localStorage 장바구니를 갱신한다. 수량이 1개 이상이면 하단 고정 '주문하기' 바가 나타난다.
    - 예외
    판매중(on_sale)일 때만 수량 조절을 표시한다. 판매 예정·품절·별도 문의·숨김 상태에서는 표시하지 않음. 농가가 비활성(is_active=false)이면 농가 전체 주문이 닫혀 수량 조절을 표시하지 않음.

11. 주문하기 바
    selector: `div.fixed.bottom-0.left-0.right-0`
    - 설명
    장바구니에 담긴 상품이 있을 때 화면 하단에 고정되는 주문 요약·진행 바
    - 정책
    판매중(on_sale) 상품 수량 합계가 1개 이상이고 농가가 활성(is_active=true)일 때만 표시한다. 본문 영역 하단 여백(pb-28)은 이 바가 가리지 않도록 확보한다.
    - 예외
    수량 0이면 표시하지 않음. 농가 비활성(is_active=false)이면 표시하지 않음.

    11-1. 선택 개수
    selector: `div.fixed.bottom-0 p.text-xs.text-muted`
    - 설명
    장바구니에 담긴 판매중 상품 총 수량
    - 정책
    '{n}개 선택' 형식으로 표시한다. 판매중(on_sale)이고 수량이 1 이상인 상품만 합산한다.
    - 예외

    11-2. 합계 금액
    selector: `div.fixed.bottom-0 p.font-bold.text-primary`
    - 설명
    선택된 상품의 price × quantity 합계
    - 정책
    formatPrice(total) 형식(₩)으로 표시한다.
    - 예외

    11-3. 주문하기 버튼
    selector: `div.fixed.bottom-0 button` (텍스트: 주문하기)
    - 설명
    주문하기(/farm/:farmSlug/checkout) 화면으로 이동하는 버튼
    - 정책
    클릭 시 주문 물량 한도 초과 경고가 켜져 있으면 '배송 일정 확인' 확인 대화상자를 먼저 연다(본문: '현재 주문 물량 증가로 예상배송일정을 확인해주세요', 확인 버튼: '확인하고 주문하기'). 확인 후, 또는 경고가 없으면 /farm/:farmSlug/checkout 으로 이동한다. 미로그인 시 로그인 시트를 열고, 로그인 완료 후 checkout 으로 이동한다.
    - 예외

12. 주문 중지 안내 배너
    selector: `div.rounded-xl.border-amber-200.bg-amber-50`
    - 설명
    농가가 비활성일 때 상품 목록 아래에 표시되는 주문 중지 안내
    - 정책
    farms.is_active = false 일 때만 표시한다. 제목 '지금은 주문을 받지 않습니다', 부제 '상품과 농가 정보는 그대로 보실 수 있습니다. 주문은 잠시 멈춰 있습니다.' 를 amber 배경 카드로 표시한다. slug 로 페이지는 열리고 상품·농가 정보·예상 배송일정은 그대로 보이지만, 10-4 수량 조절과 11 주문하기 바는 표시하지 않는다.
    - 예외
    farms.is_active = true 이면 표시하지 않음. 배송 일시정지(shipping_pauses)만 걸린 경우에는 표시하지 않음 — 배송 일시정지 중에도 주문은 받고 예상 배송일만 뒤로 미뤄 표시한다.


