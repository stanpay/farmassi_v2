-- 관리자 권한 분리 5단계: 출고기록(shipping_history)을 그 농가 멤버(일반 어드민)도 쓰게 한다.
--
-- 기획 결정(11/23, 박지훈): "농가페이지(/admin/farms/:id)에 있는 기능 기준" — 일반 어드민도
-- 농가 페이지의 송장·출고기록을 써야 한다. 출고기록 화면(배송 > 출고기록)이 이 테이블을 읽고 쓴다.
-- 지금 정책은 관리자 전용이라 멤버는 0건으로 보이고 저장이 거부된다.
--
-- 다른 농가 행은 여전히 못 보고 못 쓴다 (farm_id 기준). 슈퍼는 그대로 전부.

drop policy if exists shipping_history_admin on public.shipping_history;
drop policy if exists shipping_history_admin_or_member on public.shipping_history;
create policy shipping_history_admin_or_member on public.shipping_history
  for all
  using (private.is_admin() or private.is_farm_member(farm_id))
  with check (private.is_admin() or private.is_farm_member(farm_id));
