-- 입금완료 → 주문완료 알림톡 보장 + 로그에 주문번호 (11/25). 다시 실행해도 안전하다.
--
--   psql -d farmassi -v ON_ERROR_STOP=1 -f doc/alimtalk/sql/apply-order-done-guarantee.sql
--
-- 1) orders.paid_at: 주문이 입금완료(paid)가 된 시각. 어떤 경로로 바뀌든(입금 확인, 관리자·농가 화면에서
--    상태 변경, DB 직접 수정) 트리거가 찍는다. 서버가 이 값으로 '입금완료인데 주문완료 알림톡이 아직
--    없는 주문'을 찾아 보낸다 (화면이 닫혀 발송 요청이 빠진 경우 대비).
-- 2) alimtalk_logs.order_no: 로그에 주문번호를 남긴다. 주문이 지워져도 보인다.

alter table public.orders add column if not exists paid_at timestamptz;

create or replace function private.set_order_paid_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    new.paid_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists orders_set_paid_at on public.orders;
create trigger orders_set_paid_at
  before insert or update of status on public.orders
  for each row execute function private.set_order_paid_at();

-- 이미 입금완료 이후인 주문은 확인 시각(없으면 마지막 수정)으로 채운다. 새로 보내지 않게 과거 시각이다.
update public.orders
   set paid_at = coalesce(deposit_confirmed_at, updated_at)
 where paid_at is null and status in ('paid', 'packing', 'shipping', 'completed');

alter table public.alimtalk_logs add column if not exists order_no text;

update public.alimtalk_logs l
   set order_no = o.order_no
  from public.orders o
 where l.order_no is null and l.order_id = o.id;

-- 주문이 없는 기록(시험 발송 등)은 보낸 본문의 '주문번호 : …' 에서 꺼낸다.
update public.alimtalk_logs
   set order_no = substring(message from '주문번호 : ([^' || chr(10) || ']+)')
 where order_no is null and message like '%주문번호 : %';
