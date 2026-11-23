# 알림톡 (템플릿 · 채널 · 개발 연동)

카카오/알리고는 **채널(senderkey)마다 템플릿을 따로 등록·검수**해야 한다.  
문구·옵션은 채널이 달라도 동일하고, 회원가입만 팜어시 채널 전용이다.

**DB는 서버 Postgres에 SQL 직접 적용.** Supabase 마이그레이션 경로를 쓰지 않는다.

## 개발자 먼저 볼 문서

→ **[developer-handoff.md](developer-handoff.md)**  
DB SQL · env · 서버/프론트 변경 요지 · 검수 체크리스트.

## 채널 정책

| 상황 | 발송 채널 | 등록할 템플릿 |
|------|-----------|----------------|
| 농가에 사업자 카카오채널 없음 | `@팜어시` | 주문완료 · 택배번호 · 배송완료 · 회원가입 |
| 농가 채널을 알리고에 추가함 | 해당 농가 채널 | 주문완료 · 택배번호 · 배송완료 (**회원가입 제외**) |

런타임: `farms.aligo_sender_key` 가 있으면 그 senderkey, 없으면 `.env` 의 `ALIGO_SENDER_KEY`(팜어시).

## 공통 옵션 (모든 템플릿)

- 강조유형: **기본형**
- **채널추가** 체크
- 대체문자: **사용** · 전송타입 **장문** · 본문은 알림톡과 동일(변수 유지)
- 검수: 등록 후 → 영업일 3~5일

## 파일 목록

| 파일 | 내용 |
|------|------|
| [developer-handoff.md](developer-handoff.md) | **검수·적용 안내 (서버 SQL / 코드)** |
| [sql/apply-aligo-sender-key.sql](sql/apply-aligo-sender-key.sql) | 서버에서 직접 실행할 DDL |
| [templates.md](templates.md) | 확정 문구·변수·버튼 |
| [templates.json](templates.json) | 같은 내용 기계용 |
| [register-flow.md](register-flow.md) | 알리고 콘솔 등록 절차 |
| [channels.md](channels.md) | 채널별 발급 코드 기록 |

## 현재 @팜어시 코드 (검수중, 2026-11-23)

| kind | 템플릿명 | 코드 | env |
|------|----------|------|-----|
| order_done | 주문완료 안내 | `UO_1351` | `ALIGO_TPL_ORDER_DONE` |
| tracking | 택배번호 안내 | `UO_1352` | `ALIGO_TPL_TRACKING` |
| delivered | 배송완료 안내 | `UO_1353` | `ALIGO_TPL_DELIVERED` |
| signup | 회원가입 완료 | `UO_1354` | `ALIGO_TPL_SIGNUP` |

발송 문구 골격은 서버 `server-py/app/shared/alimtalk.py` 와 [templates.md](templates.md) 가 **동일**해야 한다.  
문구를 바꾸면 둘 다 고치고, 알리고에는 **새 템플릿**으로 다시 올린다(승인본 수정 불가).
