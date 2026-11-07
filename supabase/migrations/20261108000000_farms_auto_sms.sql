alter table public.farms
  add column if not exists auto_sms jsonb not null default '{}'::jsonb;

alter table public.farms
  drop constraint if exists farms_auto_sms_is_object;

alter table public.farms
  add constraint farms_auto_sms_is_object
  check (jsonb_typeof(auto_sms) = 'object');

comment on column public.farms.auto_sms is
  '콜백문자 규칙·제외 번호. 자동 발신 스위치는 기기에만 둔다.';
