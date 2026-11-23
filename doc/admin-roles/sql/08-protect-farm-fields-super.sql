-- 관리자 권한 분리 8단계: 농가 보호 필드 트리거가 슈퍼어드민을 알아보게 한다.
--
-- farms_protect_fields 는 관리자가 아니면 owner_user_id·slug·is_active 변경을 조용히 되돌린다
-- (농가 멤버가 자기 농가 설정을 저장할 때 이 셋은 못 바꾸게 하려는 것).
-- 그런데 role = 'admin' 을 직접 비교하고 있어서, 03 이관 뒤에는 슈퍼도 막힌다
-- (오류 없이 값만 원래대로 돌아간다 — 농가 공개/비공개, 주소(slug), 대표 변경이 안 먹힘).
-- 판단을 private.is_admin() 하나로 모은다. 일반 어드민(멤버)은 지금처럼 이 셋을 못 바꾼다.

create or replace function private.protect_farm_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not private.is_admin()
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    new.owner_user_id := old.owner_user_id;
    new.slug := old.slug;
    new.is_active := old.is_active;
  end if;
  return new;
end;
$$;
