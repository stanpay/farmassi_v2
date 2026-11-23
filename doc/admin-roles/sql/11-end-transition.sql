-- 관리자 권한 분리 11단계 (전환 종료): 옛 'admin' 값을 없앤다. 마지막에 적용한다.
--
-- 순서: 01~10 적용 → 서버·화면 배포(super_admin 을 알아보는 버전) → 이 파일.
-- 이 파일 뒤에는 서버(util.ADMIN_ROLES)·화면(isSuperAdminRole)도 super_admin 만 받게 배포한다.
-- 이관(03)이 끝나 admin 은 0명이어야 한다. 남아 있으면 멈춘다.

begin;

do $$ begin
  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'role = admin 이 남아 있습니다. 03 을 먼저 적용하세요.';
  end if;
end $$;

create or replace function private.is_admin()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce((select role = 'super_admin' from public.profiles where id = auth.uid()), false);
$$;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('customer', 'super_admin'));

commit;
