-- 관리자 권한 분리 2단계 (전환용): is_admin() 이 admin 과 super_admin 을 둘 다 참으로 본다.
--
-- 이관(03)으로 role 을 super_admin 으로 바꾸는 순간 기존 함수(role = 'admin')는 거짓이 되어
-- 관리자가 잠긴다. 그래서 먼저 둘 다 받게 해 두고, 이관과 앱 배포가 끝난 뒤(05)
-- super_admin 만 남긴다. 이 파일 자체는 동작을 바꾸지 않는다 (지금 super_admin 은 0명).

create or replace function private.is_admin()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(
    (select role in ('admin', 'super_admin') from public.profiles where id = auth.uid()),
    false);
$$;
