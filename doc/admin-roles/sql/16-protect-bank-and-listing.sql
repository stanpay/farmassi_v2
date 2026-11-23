-- 관리자 권한 분리 16단계: 입금 계좌(bank_name·account_number·account_holder)와 목록 노출(is_listed)도
-- 슈퍼만 바꾼다 (사용자 결정 2026-11-24 "막아줘").
--
-- farms_update 정책이 농가 멤버(일반 어드민)에게 자기 농가 행 수정을 허용하므로, 지금까지는
-- 일반 어드민이 API 로 계좌를 바꿀 수 있었다. 계좌가 바뀌면 손님 입금이 엉뚱한 곳으로 가고
-- 입금 대사도 어긋난다. 농가 페이지에는 이 값을 고치는 화면이 없다(관리자 농가 목록에만 있음).
-- 서버 코드는 이 컬럼들을 UPDATE 하지 않는다(approve_farm 은 INSERT, 트리거는 BEFORE UPDATE 만).
-- 12 의 대표 이전 표시, 13 의 senderkey 보호는 그대로 둔다.

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
    new.aligo_sender_key := old.aligo_sender_key;
    new.bank_name := old.bank_name;
    new.account_number := old.account_number;
    new.account_holder := old.account_holder;
    new.is_listed := old.is_listed;
  end if;
  return new;
end;
$$;
