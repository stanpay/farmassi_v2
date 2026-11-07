-- 손님이 고른 출고일.
--
-- 지금은 주문하면 가장 이른 출고일에 자동으로 나간다. 추석 전에 미리 주문하고
-- 나중에 받고 싶다는 요구가 있어, 농가가 정한 배송 요일 중에서 손님이 뒤로
-- 미룰 수 있게 한다.
--
-- null 이면 지금까지처럼 가장 이른 출고일이다. 기존 주문이 그대로 동작해야
-- 하므로 기본값을 두지 않는다.
alter table public.orders
  add column if not exists requested_ship_date date;

comment on column public.orders.requested_ship_date is
  '손님이 고른 출고일. null 이면 가장 이른 출고일에 나간다.';

-- 송장 화면이 '오늘까지 나갈 것' 과 '나중에 나갈 것' 을 가르는 데 쓴다.
create index if not exists orders_requested_ship_date_idx
  on public.orders (requested_ship_date)
  where requested_ship_date is not null;
