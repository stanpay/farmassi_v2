-- 관리자 권한 분리 10단계: 가입 처리(handle_new_user)가 옛 'admin' 을 만들지 않게 한다.
--
-- auth.users.raw_app_meta_data.role 이 'admin' 이면 profiles.role 을 'admin' 으로 만들고 있었다
-- (서버/스크립트가 관리자 계정을 직접 만들 때 쓰는 경로). 이관 뒤 규칙에 맞춰
-- 'admin' 또는 'super_admin' 이면 'super_admin' 으로 만든다. 그 밖은 지금처럼 customer.

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.profiles (id, display_name, avatar_url, role)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'nickname',
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url',
    case
      when coalesce(new.raw_app_meta_data->>'role', '') in ('admin', 'super_admin') then 'super_admin'
      else 'customer'
    end
  );
  return new;
end;
$$;
