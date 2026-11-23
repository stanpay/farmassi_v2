-- 관리자 권한 분리 15단계: 연결을 추가할 때 대표를 DB 에서 정한다 (리뷰 반영).
--
-- 화면은 '연결 추가'와 '첫 연결이면 대표 지정'을 따로 요청했다. 두 번째가 실패하거나,
-- 슈퍼 두 명이 동시에 첫 연결을 추가하면 owner 가 둘이 되거나 대표와 어긋날 수 있었다.
-- 규칙 (09 와 짝):
--   - 농가의 대표(owner_user_id)가 연결 목록에 없으면, 방금 연결한 사람이 대표가 된다.
--   - 대표가 연결 목록에 있는데 새 연결이 owner 로 들어오면 staff 로 바로잡는다.
--   - 농가 행을 잠가서(for update) 동시 추가도 차례로 처리한다.

create or replace function private.owner_on_member_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  current_owner uuid;
  owner_is_member boolean;
begin
  select owner_user_id into current_owner from public.farms where id = new.farm_id for update;

  select exists (select 1 from public.farm_members
                  where farm_id = new.farm_id and user_id = current_owner)
    into owner_is_member;

  if not owner_is_member then
    perform set_config('farmassi.owner_reassign', 'on', true);
    update public.farms set owner_user_id = new.user_id where id = new.farm_id;
    perform set_config('farmassi.owner_reassign', '', true);
    update public.farm_members set member_role = 'owner'
     where farm_id = new.farm_id and user_id = new.user_id;
  elsif new.user_id <> current_owner and new.member_role = 'owner' then
    update public.farm_members set member_role = 'staff'
     where farm_id = new.farm_id and user_id = new.user_id;
  end if;
  return null;
end;
$$;

drop trigger if exists farm_members_owner_on_insert on public.farm_members;
create trigger farm_members_owner_on_insert
  after insert on public.farm_members
  for each row execute function private.owner_on_member_insert();
