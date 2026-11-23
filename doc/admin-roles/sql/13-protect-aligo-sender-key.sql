-- 관리자 권한 분리 13단계: 알림톡 senderkey(farms.aligo_sender_key)는 슈퍼만 바꾼다 (리뷰 반영).
--
-- farms_update 정책은 농가 멤버(일반 어드민)에게 자기 농가 행 수정을 허용한다. 보호 트리거가
-- owner_user_id·slug·is_active 만 지키고 있어서, 일반 어드민이 senderkey 를 다른 농가 채널 값으로
-- 바꾸면 자기 손님 알림이 남의 채널로 나간다. 농가 페이지에는 이 값을 고치는 화면이 없다
-- (관리자 농가 목록에만 있음) → 슈퍼 전용으로 둔다. 12 의 대표 이전 표시는 그대로 둔다.

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
  end if;
  return new;
end;
$$;
