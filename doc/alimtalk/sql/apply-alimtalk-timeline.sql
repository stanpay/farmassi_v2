-- 알림톡별 시간 기록 (11/25, 카카오톡 로그에서 초 단위로 보기). 다시 실행해도 안전하다.
--
--   psql -d farmassi -v ON_ERROR_STOP=1 -f doc/alimtalk/sql/apply-alimtalk-timeline.sql
--
-- alimtalk_logs: 알리고 결과 조회(history/detail, sms_list)가 주는 시각을 남긴다 (알리고는 KST 문자열).
--   at_req_at    알리고 접수 (reqdate)
--   at_sent_at   카카오로 발송 (sentdate)
--   at_result_at 결과 수신 (rsltdate)
--   at_report_at 리포트 (reportdate)
--   sms_sent_at  대체문자 발송 (sms_list send_date)
-- shipments.tracker_first_event_at: 이번 배송의 첫 택배사 기록(= 접수) 시각.
-- 입금 시각은 기존 컬럼을 쓴다: deposit_transactions.occurred_at(은행 거래)·created_at(뱅크다에서 가져옴),
-- orders.paid_at(입금완료 처리).

alter table public.alimtalk_logs
  add column if not exists at_req_at    timestamptz,
  add column if not exists at_sent_at   timestamptz,
  add column if not exists at_result_at timestamptz,
  add column if not exists at_report_at timestamptz,
  add column if not exists sms_sent_at  timestamptz;

alter table public.shipments add column if not exists tracker_first_event_at timestamptz;

-- 11/23 17시 이후 response 가 JSON 문자열로 두 번 감싸져 배열로 쌓였다(서버 코드 버그, 같은 날 수정).
-- 배열·문자열을 풀어 하나의 객체로 합친다. 이미 객체인 행은 건드리지 않는다.
create or replace function pg_temp.unwrap(v jsonb) returns jsonb language plpgsql immutable as $$
declare acc jsonb := '{}'::jsonb; e jsonb;
begin
  if jsonb_typeof(v) = 'object' then return v; end if;
  if jsonb_typeof(v) = 'string' then return pg_temp.unwrap((v #>> '{}')::jsonb); end if;
  if jsonb_typeof(v) = 'array' then
    for e in select * from jsonb_array_elements(v) loop
      acc := acc || pg_temp.unwrap(e);
    end loop;
    return acc;
  end if;
  return '{}'::jsonb;
end $$;

update public.alimtalk_logs set response = pg_temp.unwrap(response)
 where jsonb_typeof(response) in ('array', 'string');

-- 이미 결과 확인한 로그는 저장해 둔 원문(response.result_check)에서 채운다.
create or replace function pg_temp.kst(v text) returns timestamptz language sql immutable as $$
  select case when v ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$' then (v || '+09')::timestamptz end
$$;

update public.alimtalk_logs set
  at_req_at    = coalesce(at_req_at,    pg_temp.kst(response #>> '{result_check,alimtalk,reqdate}')),
  at_sent_at   = coalesce(at_sent_at,   pg_temp.kst(response #>> '{result_check,alimtalk,sentdate}')),
  at_result_at = coalesce(at_result_at, pg_temp.kst(response #>> '{result_check,alimtalk,rsltdate}')),
  at_report_at = coalesce(at_report_at, pg_temp.kst(response #>> '{result_check,alimtalk,reportdate}')),
  sms_sent_at  = coalesce(sms_sent_at,  pg_temp.kst(response #>> '{result_check,sms,send_date}'))
 where response ? 'result_check';
