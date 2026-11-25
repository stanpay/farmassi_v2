-- 알림톡 수동 발송·재전송 기록 (11/25). apply-alimtalk-log.sql 다음에 실행한다. 다시 실행해도 안전하다.
--
--   psql -d farmassi -v ON_ERROR_STOP=1 -f doc/alimtalk/sql/apply-alimtalk-manual.sql
--
--   sent_by   : 관리자 화면에서 직접 보낸 사람. 자동 발송은 null.
--   resend_of : 발송 로그의 '재전송'으로 보낸 경우 원래 로그.

alter table public.alimtalk_logs
  add column if not exists sent_by   uuid references public.profiles(id) on delete set null,
  add column if not exists resend_of uuid references public.alimtalk_logs(id) on delete set null;

comment on column public.alimtalk_logs.sent_by is '관리자 수동 발송·재전송한 사람 (자동 발송은 null)';
comment on column public.alimtalk_logs.resend_of is '재전송한 원래 로그';
