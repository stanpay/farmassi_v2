-- 관리자 권한 분리 7단계: 일반 어드민(슈퍼가 아닌 계정)은 농가 1곳에만 연결된다 (기획 2·6.4절).
--
-- 화면에서만 막으면 API 로 우회할 수 있어서 DB 에서 막는다.
-- 슈퍼어드민은 여러 농가에 연결돼도 된다 (박지훈 5곳).
-- 같은 계정을 두 요청이 동시에 다른 농가에 넣으면 둘 다 통과할 수 있어서,
-- 계정별 잠금(pg_advisory_xact_lock)을 잡고 확인한다.
--
-- 적용 전 확인: 슈퍼가 아닌데 2곳 이상 연결된 계정이 있으면 먼저 정리해야 한다.
--   select user_id, count(*) from farm_members m join profiles p on p.id = m.user_id
--    where p.role not in ('admin', 'super_admin') group by 1 having count(*) > 1;
--   (11/23 운영·개발 모두 0건)

create or replace function private.enforce_one_farm_per_general_admin()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  other_farm text;
begin
  if exists (select 1 from public.profiles
              where id = new.user_id and role in ('admin', 'super_admin')) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('farm_members:' || new.user_id::text));

  select f.name into other_farm
    from public.farm_members m
    join public.farms f on f.id = m.farm_id
   where m.user_id = new.user_id
     and m.farm_id <> new.farm_id
     -- 연결을 다른 농가로 옮기는 update 는 자기 자신(옛 행)을 세지 않는다.
     and not (tg_op = 'UPDATE' and m.farm_id = old.farm_id and m.user_id = old.user_id)
   limit 1;

  if other_farm is not null then
    raise exception '이미 %에 연결된 계정입니다. 일반 어드민은 농가 1곳에만 연결할 수 있습니다.', other_farm
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists farm_members_one_farm on public.farm_members;
create trigger farm_members_one_farm
  before insert or update of user_id, farm_id on public.farm_members
  for each row execute function private.enforce_one_farm_per_general_admin();
