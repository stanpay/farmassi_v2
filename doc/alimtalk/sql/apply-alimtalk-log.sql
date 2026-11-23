-- 알림톡 발송 기록. 서버 Postgres 에 직접 실행한다 (supabase/migrations 를 쓰지 않음).
--
--   psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f doc/alimtalk/sql/apply-alimtalk-log.sql
--
-- 쓰임:
--   1) 같은 주문·같은 종류를 두 번 보내지 않는다 (상태를 오가며 다시 눌러도 1번만).
--   2) 회원가입 알림을 사용자당 1번만 보낸다.
--   3) 실패 원인 확인 (알리고 응답을 그대로 남김. 비밀값은 넣지 않는다).
-- 서버(service 커넥션)만 읽고 쓴다. 화면에서 볼 일이 없어 정책을 열지 않는다.

create table if not exists public.alimtalk_logs (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('order_done', 'tracking', 'delivered', 'signup')),
  order_id   uuid references public.orders(id) on delete set null,
  user_id    uuid references public.profiles(id) on delete set null,
  farm_id    uuid references public.farms(id) on delete set null,
  phone      text,
  tpl_code   text,
  sent       boolean not null default false,
  mid        text,
  message    text,
  response   jsonb,
  created_at timestamptz not null default now()
);

create index if not exists alimtalk_logs_order_idx on public.alimtalk_logs (order_id, kind) where sent;
create index if not exists alimtalk_logs_user_idx on public.alimtalk_logs (user_id, kind) where sent;

alter table public.alimtalk_logs enable row level security;

comment on table public.alimtalk_logs is '알림톡 발송 기록. 중복 발송 방지와 실패 확인용.';

-- ---- 2단계: 도착 결과 추적 (11/23) ----------------------------------------
-- 발송 요청이 접수돼도 손님에게 갔는지는 모른다. 서버가 1분마다 알리고에 물어서 채운다.
--   알림톡 결과조회(akv10/history/detail) → 실패면 대체문자 결과(apis.aligo.in/sms_list, smid)
--   result: pending(확인 중) / alimtalk(알림톡 도착) / sms(대체문자 도착) / failed(둘 다 실패)
--   failed 가 되면 관리자에게 알린다(메일·웹푸시) — alerted_at 으로 한 번만.

alter table public.alimtalk_logs
  add column if not exists result          text not null default 'pending',
  add column if not exists at_rslt         text,
  add column if not exists at_rslt_message text,
  add column if not exists smid            text,
  add column if not exists sms_state       text,
  add column if not exists fail_reason     text,
  add column if not exists checked_at      timestamptz,
  add column if not exists check_count     integer not null default 0,
  add column if not exists alerted_at      timestamptz;

do $$ begin
  alter table public.alimtalk_logs add constraint alimtalk_logs_result_check
    check (result in ('pending', 'alimtalk', 'sms', 'failed'));
exception when duplicate_object then null; end $$;

-- 1단계에서 이미 쌓인 행: 접수 거절·예외는 실패로, 나머지는 확인 대상으로 둔다.
update public.alimtalk_logs set result = 'failed',
       fail_reason = coalesce(response->>'message', response->>'error', '발송 요청 실패')
 where not sent and result = 'pending';

create index if not exists alimtalk_logs_pending_idx on public.alimtalk_logs (created_at) where result = 'pending';
create index if not exists alimtalk_logs_farm_idx on public.alimtalk_logs (farm_id, created_at desc);

-- 관리자 화면(관리자 > 카카오톡 > 발송 로그)에서 읽는다. 쓰기는 서버만.
drop policy if exists alimtalk_logs_admin_select on public.alimtalk_logs;
create policy alimtalk_logs_admin_select on public.alimtalk_logs
  for select using (private.is_admin());
