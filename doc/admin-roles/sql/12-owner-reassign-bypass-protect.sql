-- 관리자 권한 분리 12단계: 대표 자동 이전(09)이 농가 보호 트리거(08)에 막히지 않게 한다.
--
-- 리뷰에서 나온 문제 (11/23): 09 의 reassign_farm_owner 가 farms.owner_user_id 를 바꾸면
-- protect_farm_fields 가 '슈퍼도 service_role 도 아니면' 조용히 되돌린다. 화면(슈퍼 로그인)에서는
-- 괜찮지만, 로그인 정보 없는 서버·스크립트 연결이나 프로필 삭제(cascade)로 연결이 지워지면
-- 대표는 지워진 사람 그대로, 다음 사람의 member_role 만 owner 가 되어 서로 어긋난다.
--
-- 고침: 대표 이전 순간에만 트랜잭션 로컬 표시(farmassi.owner_reassign)를 켜고 바로 끈다.
-- 보호 트리거는 이 표시가 있을 때만 owner_user_id 변경을 통과시킨다 (slug·is_active 는 그대로 보호).
-- 이 표시는 SQL 로만 켤 수 있고, 앱의 /query 는 임의 SQL 을 받지 않는다.

create or replace function private.protect_farm_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not private.is_admin()
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    if coalesce(current_setting('farmassi.owner_reassign', true), '') <> 'on' then
      new.owner_user_id := old.owner_user_id;
    end if;
    new.slug := old.slug;
    new.is_active := old.is_active;
  end if;
  return new;
end;
$$;

create or replace function private.reassign_farm_owner()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  next_owner uuid;
begin
  if not exists (select 1 from public.farms where id = old.farm_id and owner_user_id = old.user_id) then
    return old;
  end if;

  select user_id into next_owner
    from public.farm_members
   where farm_id = old.farm_id
   order by created_at, user_id
   limit 1;

  if next_owner is not null then
    perform set_config('farmassi.owner_reassign', 'on', true);
    update public.farms set owner_user_id = next_owner where id = old.farm_id;
    perform set_config('farmassi.owner_reassign', '', true);
    update public.farm_members set member_role = 'owner'
     where farm_id = old.farm_id and user_id = next_owner;
  end if;
  return old;
end;
$$;
