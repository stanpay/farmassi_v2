-- 관리자 권한 분리 1단계: 역할 값에 super_admin 을 허용한다.
-- 기획: doc/기획-농가-다중계정연결-및-관리자권한.md (6.1절)
--
-- 서버 Postgres 에 직접 실행한다 (supabase/migrations 를 쓰지 않음).
--   psql -v ON_ERROR_STOP=1 -f doc/admin-roles/sql/01-role-super-admin.sql
--
-- 이 파일만 적용해서는 동작이 바뀌지 않는다. 'admin' 은 아직 그대로 전권이다.
-- 일반 어드민은 role 을 따로 두지 않고 farm_members(연결)로만 판단한다.
-- 'admin' 값은 이관(02) 이후 쓰지 않지만, 이관 전후로 끊기지 않게 당분간 허용해 둔다.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('customer', 'admin', 'super_admin'));
