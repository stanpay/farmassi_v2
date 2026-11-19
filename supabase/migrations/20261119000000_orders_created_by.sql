-- 농가가 카톡 주문을 붙여 넣어 직접 추가한 주문을 DB 에 저장한다.
--
-- 지금까지 주문은 손님이 스토어에서만 만들었고, customer_id 가 곧 '주문한 사람' 이었다.
-- 직접 추가한 주문에는 로그인한 손님이 없다. 손님 자리에 농가 사람을 넣으면 그
-- 주문이 농가 사람의 '내 주문' 에 섞이므로, customer_id 는 비워 두고 누가 넣었는지는
-- created_by 로 따로 남긴다.
--
-- created_by_name 은 넣은 시점의 이름이다. 농가 회원은 profiles 를 본인 것만 읽을 수
-- 있어 created_by 만으로는 화면에 이름을 띄울 수 없다.

alter table public.orders
  alter column customer_id drop not null;

alter table public.orders
  add column if not exists source text not null default 'store',
  add column if not exists created_by uuid references public.profiles(id),
  add column if not exists created_by_name text;

alter table public.orders
  drop constraint if exists orders_source_check;
alter table public.orders
  add constraint orders_source_check
  check (source in ('store', 'farm_manual'));

-- 스토어 주문에는 손님이 있어야 한다. 직접 추가 주문에는 넣은 사람이 있어야 한다.
alter table public.orders
  drop constraint if exists orders_source_actor_check;
alter table public.orders
  add constraint orders_source_actor_check
  check (
    (source = 'store' and customer_id is not null)
    or (source = 'farm_manual' and created_by is not null)
  );

-- 기존 주문은 모두 손님이 스토어에서 만든 것이다.
update public.orders o
   set created_by = o.customer_id,
       created_by_name = p.display_name
  from public.profiles p
 where p.id = o.customer_id
   and o.created_by is null;

create index if not exists orders_created_by_idx on public.orders (created_by);

comment on column public.orders.source is
  '주문 경로. store = 손님이 스토어에서 주문, farm_manual = 농가가 직접 추가.';
comment on column public.orders.created_by is
  '주문을 만든 사람. 스토어 주문은 손님, 직접 추가 주문은 추가한 농가 회원·관리자.';
comment on column public.orders.created_by_name is
  '주문을 만든 시점의 created_by 표시 이름.';
