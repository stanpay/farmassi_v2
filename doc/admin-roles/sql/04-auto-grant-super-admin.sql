-- 관리자 권한 분리 4단계: 가입 시 자동 관리자 부여(private.admin_auto_grant)가 super_admin 을 준다.
--
-- profiles_auto_admin 트리거는 이름이 등록된 패턴과 맞는 첫 가입자에게 관리자를 준다.
-- 지금 패턴은 '지훈' 하나이고 8/19 에 이미 쓰였다 (다시 동작하지 않음).
-- 그래도 패턴을 새로 넣으면 옛 'admin' 값이 생기므로, 이관 뒤 규칙과 맞춘다.
-- 이 트리거로 생기는 관리자는 지금과 같이 전권(슈퍼)이다.

create or replace function private.auto_grant_admin()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  claimed integer;
begin
  if new.display_name is null or new.role in ('admin', 'super_admin') then
    return new;
  end if;

  -- 아직 아무에게도 부여되지 않은 패턴만 집어간다.
  -- 조건을 update 안에 두어서, 동시에 두 명이 들어와도 한 명만 가져간다.
  update private.admin_auto_grant
     set granted_user_id = new.id,
         granted_name    = new.display_name,
         granted_at      = now()
   where granted_user_id is null
     and new.display_name like '%' || pattern || '%';

  get diagnostics claimed = row_count;
  if claimed > 0 then
    new.role := 'super_admin';
  end if;

  return new;
end;
$$;
