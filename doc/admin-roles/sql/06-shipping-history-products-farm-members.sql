-- 관리자 권한 분리 6단계: 출고기록 상품별 수량(shipping_history_products)도 그 농가 멤버가 쓰게 한다.
-- 05 와 같은 이유·같은 규칙. 출고기록 화면이 두 테이블을 같이 저장하므로 둘 다 열어야 한다.

drop policy if exists shipping_history_products_admin on public.shipping_history_products;
drop policy if exists shipping_history_products_admin_or_member on public.shipping_history_products;
create policy shipping_history_products_admin_or_member on public.shipping_history_products
  for all
  using (private.is_admin() or private.is_farm_member(farm_id))
  with check (private.is_admin() or private.is_farm_member(farm_id));
