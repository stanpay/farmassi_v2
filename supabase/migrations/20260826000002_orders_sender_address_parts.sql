-- 보내는 분 주소를 받는 분 주소와 같은 모양으로 맞춘다.
--
-- 지금은 sender_address 한 칸뿐이라 주소를 통째로 넣을 수밖에 없었다. 실제로는
-- 주문서의 주소 검색 버튼이 붙어 있지 않아 상세주소만 이 칸에 들어가 있었다.
-- 우편번호와 상세주소를 나눠 받는 분(zonecode / address / address_detail)과
-- 같은 구조로 만든다.
alter table public.orders
  add column if not exists sender_zonecode text,
  add column if not exists sender_address_detail text;

comment on column public.orders.sender_zonecode is '보내는 분 우편번호.';
comment on column public.orders.sender_address is '보내는 분 도로명 주소.';
comment on column public.orders.sender_address_detail is '보내는 분 상세주소 (동·호수 등).';
