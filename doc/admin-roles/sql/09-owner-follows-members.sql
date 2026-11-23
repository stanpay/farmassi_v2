-- 관리자 권한 분리 9단계: 대표 담당(farms.owner_user_id)을 연결 목록(farm_members)에 맞춘다 (기획 8.2절).
--
-- 권한의 근거는 연결 목록이다. owner_user_id 는 '대표 표시'용으로만 남는다
-- (어떤 정책·서버 코드도 owner_user_id 로 권한을 주지 않는다 — 11/23 확인).
-- 규칙:
--   - 대표의 연결을 해제하면, 남은 연결 중 가장 먼저 연결된 사람이 대표가 된다
--     (그 사람의 member_role 도 owner 로).
--   - 남은 연결이 없으면 owner_user_id 는 그대로 둔다 (NOT NULL 이라 비울 수 없다).
--     연결이 없으니 그 사람에게 권한은 없다. 화면은 '연결 없음'으로 보여 준다.
-- 11/23 운영: 농가 6곳 모두 대표가 연결 목록에 있다.

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
    update public.farms set owner_user_id = next_owner where id = old.farm_id;
    update public.farm_members set member_role = 'owner'
     where farm_id = old.farm_id and user_id = next_owner;
  end if;
  return old;
end;
$$;

drop trigger if exists farm_members_reassign_owner on public.farm_members;
create trigger farm_members_reassign_owner
  after delete on public.farm_members
  for each row execute function private.reassign_farm_owner();
