# 송장 직접 등록 + 배송시작 알림톡 (Delivery Tracker)

요청: 박지훈 11/25 — 관리자 송장 탭에 '배송중' 필터와 '직접 등록'. 송장번호를 등록하고
Delivery Tracker 에서 배송접수가 뜨면 배송시작 알림톡 발송, 수동 재전송.

## 흐름

1. 관리자 → 송장 → **직접 등록**: 주문·택배사(우체국/CJ)·송장번호 → RPC `register-tracking`
   - shipments 에 `status='registered'`, 주문이 입금완료면 '송장 발급 완료'(packing)
   - 이 단계에서는 알림톡을 보내지 않는다
2. 서버 스케줄러 `_tracking_loop` (1분마다, 같은 송장은 10분 간격, 등록 후 14일까지)
   → Delivery Tracker 조회. 택배사 기록이 하나라도 생기면 = 접수:
   - 주문을 **배송중**으로, **배송시작(택배번호 안내 UO_1352) 알림톡** 1회, `started_at` 기록
3. 송장 → **배송중** 탭: 추적 상태, **알림톡 재전송**(변수만 고쳐 다시 보내기)

화면에서 주문 상태를 '송장 발급 완료'로 바꿔도 택배번호 알림톡은 더 이상 나가지 않는다 (접수 확인 후에만).

## 설정

- `DELIVERY_TRACKER_CLIENT_ID`, `DELIVERY_TRACKER_CLIENT_SECRET` — https://console.tracker.delivery 에서 발급.
  없으면 조회하지 않는다(등록은 됨, 접수 확인·알림톡은 멈춤).
- **무료 요금제 자격증명은 21일마다 콘솔에서 갱신**해야 한다. 만료되면 조회가 UNAUTHENTICATED 로 거절되고
  관리자에게 메일·웹푸시가 하루 한 번 간다.
- 요금: Free $0 / Pro 월 $49.99~ (문서 기준). 월 고유 송장번호 10,000건 기본 한도.
- 운영 반영: `doc/delivery-tracker/sql/apply-delivery-tracking.sql` 먼저, 그다음 코드.

## 확인한 것 (11/25, dev)

- 실제 API: 가짜 키로 호출 → `UNAUTHENTICATED` 를 문서 형식 그대로 받아 해석함 (요청 형식 확인).
  정상 응답 해석은 문서 스키마 기준이고, 실제 키로는 아직 못 봤다.
- 접수 → 배송중·알림톡: Delivery Tracker 응답을 흉내 내 시험. UO_1352 실제 발송 '알림톡 도착 · 성공'.
- 우체국 '접수'가 어느 상태 코드로 오는지 문서에 없어 '기록이 하나라도 생기면 접수'로 본다.
- 11/25 실제 키로 확인: 인증 OK, 기록 없는 번호는 NOT_FOUND(=대기), 정상 응답 해석 OK.
  **송장번호는 재사용된다** — 임의 번호(1234567890123)에서 남의 2025~2026 배송 기록이 나왔다.
  그래서 등록 7일 전 이후 기록만 이번 배송으로 본다 (RECENT_DAYS).
- Delivery Tracker 에서 확인한 한국 택배사 ID 중 화면에 넣은 것: kr.epost, kr.cjlogistics. kr.hanjin 등도 있다.
