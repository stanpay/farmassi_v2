-- 관리자 권한 분리 3단계: 슈퍼어드민 이관 (기획 11절 + 11/23 결정)
--
-- 대상 (라이브 farmassi 기준, 계정 ID 로 지정한다 — 개발 DB 는 전화번호가 가려져 있어서
-- 번호로 찾으면 안 맞는다. ID 는 두 DB 가 같다):
--   8ae35b50-e1c2-463a-b52b-3321e3c068de  박지훈 010-8767-5708  (admin)
--   3af2c4cd-d623-4531-b915-0e10ec22f304  김이현 010-5109-0625  (admin)
--   eac586c5-93ff-435d-9545-6ea8bcc2f5c5  김미자 010-2075-5708  (admin)
--   12f6dbc9-5a36-4ebc-ac54-979e078a6dff  박지훈 010-8113-5708  (customer → 슈퍼, 11/23 결정)
--
-- 그 밖에 role='admin' 이 남아 있으면 지금 전권을 가진 사람이므로 같이 올린다
-- (기획: 현행 admin 은 전원 슈퍼). 02 가 적용돼 있어야 이 사이에 잠기지 않는다.
-- 농가 연결(farm_members)·대표(owner_user_id)는 건드리지 않는다.

begin;

-- profiles_protect_role 트리거가 service_role 이 아니면 role 변경을 되돌린다 (권한 상승 방지).
-- 이 트랜잭션 안에서만 service_role 로 표시한다.
set local request.jwt.claims = '{"role": "service_role"}';

update public.profiles
   set role = 'super_admin', updated_at = now()
 where id in ('8ae35b50-e1c2-463a-b52b-3321e3c068de',
              '3af2c4cd-d623-4531-b915-0e10ec22f304',
              'eac586c5-93ff-435d-9545-6ea8bcc2f5c5',
              '12f6dbc9-5a36-4ebc-ac54-979e078a6dff')
    or role = 'admin';

-- 확인: admin 은 0명이어야 한다.
do $$ begin
  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'admin 이 남아 있습니다';
  end if;
end $$;

commit;

select id, display_name, role from public.profiles where role = 'super_admin' order by display_name;
