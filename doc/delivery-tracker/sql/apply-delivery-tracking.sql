-- 송장 직접 등록 + Delivery Tracker 배송 추적 (11/25). 다시 실행해도 안전하다.
--
--   psql -d farmassi -v ON_ERROR_STOP=1 -f doc/delivery-tracker/sql/apply-delivery-tracking.sql
--
-- 관리자가 송장번호를 직접 등록하면(status 'registered') 서버가 Delivery Tracker 로 조회한다.
-- 택배사 기록이 처음 뜨면(접수) 주문을 배송중으로 바꾸고 배송시작(택배번호 안내) 알림톡을 보낸다.
--
--   carrier_id       Delivery Tracker 택배사 ID (우체국 kr.epost, CJ kr.cjlogistics)
--   tracker_status   마지막 이벤트 코드 (INFORMATION_RECEIVED·AT_PICKUP·IN_TRANSIT·DELIVERED …)
--   tracker_status_name / tracker_description / tracker_event_at  마지막 이벤트 원문
--   tracker_checked_at / tracker_check_count / tracker_error      조회 기록
--   started_at       접수 확인 → 배송중 전환·알림톡 처리한 시각 (한 번만)

alter table public.shipments
  add column if not exists carrier_id          text,
  add column if not exists tracker_status      text,
  add column if not exists tracker_status_name text,
  add column if not exists tracker_description text,
  add column if not exists tracker_event_at    timestamptz,
  add column if not exists tracker_checked_at  timestamptz,
  add column if not exists tracker_check_count integer not null default 0,
  add column if not exists tracker_error       text,
  add column if not exists started_at          timestamptz,
  add column if not exists registered_by       uuid references public.profiles(id) on delete set null;

-- 상태 값에 'registered'(직접 등록)를 더한다. 기존 값은 하나도 빼지 않는다.
alter table public.shipments drop constraint if exists shipments_status_check;
alter table public.shipments add constraint shipments_status_check
  check (status = any (array['draft', 'requested', 'printed', 'registered', 'cancelled']));

-- 조회 대상: 번호가 있고 아직 접수 처리 전인 것.
create index if not exists shipments_tracking_pending_idx
  on public.shipments (tracker_checked_at nulls first)
  where tracking_number is not null and started_at is null and status <> 'cancelled';
