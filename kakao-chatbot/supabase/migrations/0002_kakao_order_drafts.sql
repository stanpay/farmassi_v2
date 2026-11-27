-- 카카오 챗봇: 주문 검수 중간 상태
-- 농가 회원이 카톡으로 보낸 주문을 검수하는 동안(등록 전까지) 사용자당 한 묶음을 보관한다.
-- 백엔드 검수 API(review-farm-orders)는 상태를 저장하지 않아서, 직전 응답의 orders 를
-- 통째로 여기에 두었다가 다음 요청에 그대로 돌려보낸다.
-- 외부(anon/authenticated)에는 열지 않고, Edge Function(service_role)만 읽고 씁니다.

create table if not exists public.kakao_order_drafts (
  kakao_user_id uuid primary key references public.kakao_users (id) on delete cascade,
  farm_id       text,                                  -- 어느 농가 주문인지
  farm_name     text,
  pending_text  text,                                  -- 농가를 못 정해 아직 검수하지 못한 원문
  orders        jsonb not null default '[]'::jsonb,    -- review 응답의 orders 그대로 (addressToken 포함)
  summary       jsonb,                                 -- {total, ready, needsFix}
  save_request  jsonb,                                 -- 전부 ok 일 때만. create-farm-orders 에 그대로 보냄
  saving_at     timestamptz,                           -- 등록 요청을 보낸 시각. 결과를 모르면 남아 있음(중복 등록 방지)
  rev           bigint not null default 0,             -- 쓸 때마다 바뀜. 동시에 온 메시지끼리 덮어쓰지 않게 비교
  updated_at    timestamptz not null default now()
);

alter table public.kakao_order_drafts enable row level security;

revoke all on public.kakao_order_drafts from anon, authenticated;
grant select, insert, update, delete on public.kakao_order_drafts to service_role;
