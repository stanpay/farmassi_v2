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
