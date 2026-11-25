-- Delivery Tracker 웹훅 (11/26). apply-delivery-tracking.sql 다음에 실행한다. 다시 실행해도 안전하다.
--
--   psql -d farmassi -v ON_ERROR_STOP=1 -f doc/delivery-tracker/sql/apply-delivery-webhook.sql
--
-- 송장을 등록하면 Delivery Tracker 에 웹훅을 건다(48시간, 24시간마다 연장). 택배 상태가 바뀌면
-- Delivery Tracker 가 우리 서버로 {carrierId, trackingNumber} 를 보낸다. 받은 내용은 믿지 않고
-- 우리가 다시 조회해서 접수를 확인한다 (문서상 서명이 없다).
--
-- shipments
--   tracker_webhook_expires_at  걸어 둔 웹훅 만료 시각
--   tracker_webhook_error       등록 실패 사유
--   tracker_webhook_tried_at    마지막 등록 시도 시각 (실패하면 30분 뒤 다시)
--   tracker_webhook_last_at     마지막 웹훅 수신 시각
--   started_via                 접수 확인 경로: webhook / poll / register
--   started_webhook_at          접수를 확인하게 한 웹훅의 수신 시각 (via=webhook 일 때)
-- delivery_webhook_events: 받은 웹훅 하나하나 (수신 시각 초 단위, 처리 결과)

alter table public.shipments
  add column if not exists tracker_webhook_expires_at timestamptz,
  add column if not exists tracker_webhook_error      text,
  add column if not exists tracker_webhook_tried_at   timestamptz,
  add column if not exists tracker_webhook_last_at    timestamptz,
  add column if not exists started_via                text,
  add column if not exists started_webhook_at         timestamptz;

create table if not exists public.delivery_webhook_events (
  id              uuid primary key default gen_random_uuid(),
  received_at     timestamptz not null default now(),
  carrier_id      text,
  tracking_number text,
  shipment_id     uuid references public.shipments(id) on delete set null,
  outcome         text,          -- started / waiting / no_shipment / already_started / error
  processed_at    timestamptz,
  error           text
);

create index if not exists delivery_webhook_events_number_idx
  on public.delivery_webhook_events (tracking_number, received_at desc);

alter table public.delivery_webhook_events enable row level security;

drop policy if exists delivery_webhook_events_admin_select on public.delivery_webhook_events;
create policy delivery_webhook_events_admin_select on public.delivery_webhook_events
  for select using (private.is_admin());

grant select on public.delivery_webhook_events to authenticated;
