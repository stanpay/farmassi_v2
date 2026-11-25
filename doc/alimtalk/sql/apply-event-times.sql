-- 알림톡 시작 시각 채우기 + 배달완료 자동 처리 (11/26). 다시 실행해도 안전하다.
--
--   psql -d farmassi -v ON_ERROR_STOP=1 -f doc/alimtalk/sql/apply-event-times.sql
--
-- orders.completed_at          주문이 배송완료(completed)가 된 시각 (트리거, 어떤 경로든)
-- profiles.phone_first_set_at  휴대폰 번호를 처음 저장한 시각 (회원가입 알림톡이 나가는 계기)
-- shipments.delivered_at / delivered_via / delivered_webhook_at / tracker_delivered_event_at
--   Delivery Tracker 에 '배달완료(DELIVERED)'가 뜨면 서버가 주문을 배송완료로 바꾸고 배송완료 알림톡을 보낸 기록

alter table public.orders add column if not exists completed_at timestamptz;

create or replace function private.set_order_completed_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    new.completed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists orders_set_completed_at on public.orders;
create trigger orders_set_completed_at
  before insert or update of status on public.orders
  for each row execute function private.set_order_completed_at();

-- 이미 배송완료인 주문은 마지막 수정 시각으로 (정확한 시각은 남아 있지 않다).
update public.orders set completed_at = updated_at
 where completed_at is null and status = 'completed';

alter table public.profiles add column if not exists phone_first_set_at timestamptz;

create or replace function private.set_phone_first_set_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.phone_first_set_at is null and coalesce(new.phone, '') <> ''
     and (tg_op = 'INSERT' or coalesce(old.phone, '') = '') then
    new.phone_first_set_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_set_phone_first_set_at on public.profiles;
create trigger profiles_set_phone_first_set_at
  before insert or update of phone on public.profiles
  for each row execute function private.set_phone_first_set_at();
-- 기존 회원은 처음 저장한 시각을 알 수 없어 비워 둔다.

alter table public.shipments
  add column if not exists delivered_at               timestamptz,
  add column if not exists delivered_via              text,
  add column if not exists delivered_webhook_at       timestamptz,
  add column if not exists tracker_delivered_event_at timestamptz,
  -- 배송시작: 이번 배송의 택배사 기록 중 가장 이른 것의 이름 (시각은 tracker_first_event_at)
  add column if not exists tracker_first_event_name   text;
