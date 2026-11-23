-- 관리자 권한 분리 14단계: 슈퍼어드민을 고객으로 내릴 때도 '농가 1곳' 규칙을 지킨다 (리뷰 반영).
--
-- 07 은 farm_members 를 넣거나 바꿀 때만 본다. 여러 농가에 연결된 슈퍼(예: 박지훈 5곳)를
-- customer 로 바꾸면 연결이 그대로 남아 일반 어드민이 여러 농가를 쓰게 된다.
-- 역할을 내릴 때 연결이 2곳 이상이면 거부한다. 먼저 1곳만 남기고 내려야 한다.

create or replace function private.enforce_one_farm_on_demote()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  if old.role = 'super_admin' and new.role <> 'super_admin' then
    perform pg_advisory_xact_lock(hashtext('farm_members:' || new.id::text));
    select count(*) into n from public.farm_members where user_id = new.id;
    if n > 1 then
      raise exception '농가 %곳에 연결된 계정은 슈퍼어드민에서 내릴 수 없습니다. 연결을 1곳만 남긴 뒤 다시 하세요.', n
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_demote_one_farm on public.profiles;
create trigger profiles_demote_one_farm
  before update of role on public.profiles
  for each row execute function private.enforce_one_farm_on_demote();
