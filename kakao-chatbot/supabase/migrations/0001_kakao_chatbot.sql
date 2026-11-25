-- 카카오 챗봇: 사용자 + 대화 기록
-- 외부(anon/authenticated)에는 열지 않고, Edge Function(service_role)만 읽고 씁니다.

create table if not exists public.kakao_users (
  id                  uuid primary key default gen_random_uuid(),
  bot_user_key        text not null unique,          -- userRequest.user.id (봇별 고정값)
  plusfriend_user_key text,                          -- 채널 기준 사용자 키
  app_user_id         text,                          -- 디벨로퍼스 앱 연결 시 = 카카오 로그인 회원번호
  is_friend           boolean not null default false,
  member_id           text,                          -- 우리 서비스 회원 ID (2차에서 매칭)
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now()
);
create index if not exists kakao_users_app_user_id_idx on public.kakao_users (app_user_id);
create index if not exists kakao_users_plusfriend_user_key_idx on public.kakao_users (plusfriend_user_key);

create table if not exists public.kakao_messages (
  id            bigint generated always as identity primary key,
  kakao_user_id uuid references public.kakao_users (id) on delete cascade,
  direction     text not null check (direction in ('in', 'out')),  -- in: 사용자 → 봇, out: 봇 → 사용자
  text          text,
  block_id      text,
  block_name    text,
  via           text check (via in ('sync', 'callback')),         -- out 메시지가 나간 방식
  latency_ms    integer,
  error         text,
  raw           jsonb,                                             -- 요청/응답 원문
  created_at    timestamptz not null default now()
);
create index if not exists kakao_messages_user_time_idx on public.kakao_messages (kakao_user_id, created_at desc);

alter table public.kakao_users enable row level security;
alter table public.kakao_messages enable row level security;

revoke all on public.kakao_users, public.kakao_messages from anon, authenticated;
grant select, insert, update, delete on public.kakao_users, public.kakao_messages to service_role;

-- 사용자 저장/갱신 후 id 반환. 값이 빠져 온 경우 기존 값을 유지합니다.
create or replace function public.kakao_touch_user(
  p_bot_user_key        text,
  p_plusfriend_user_key text,
  p_app_user_id         text,
  p_is_friend           boolean
) returns uuid
language sql
set search_path = public
as $$
  insert into kakao_users (bot_user_key, plusfriend_user_key, app_user_id, is_friend)
  values (p_bot_user_key, p_plusfriend_user_key, p_app_user_id, coalesce(p_is_friend, false))
  on conflict (bot_user_key) do update set
    plusfriend_user_key = coalesce(excluded.plusfriend_user_key, kakao_users.plusfriend_user_key),
    app_user_id         = coalesce(excluded.app_user_id, kakao_users.app_user_id),
    is_friend           = excluded.is_friend,
    last_seen_at        = now()
  returning id;
$$;

revoke execute on function public.kakao_touch_user(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.kakao_touch_user(text, text, text, boolean) to service_role;
