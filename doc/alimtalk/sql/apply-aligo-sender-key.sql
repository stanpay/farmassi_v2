-- 라이브/서버 Postgres에 직접 실행.
-- Supabase CLI / supabase/migrations 경유하지 않음.
--
-- 적용 예:
--   psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f doc/alimtalk/sql/apply-aligo-sender-key.sql
--
-- 확인:
--   select column_name, data_type
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'farms' and column_name = 'aligo_sender_key';

alter table public.farms
  add column if not exists aligo_sender_key text;

comment on column public.farms.aligo_sender_key is
  '알리고 카카오 채널 senderkey. 있으면 농가 채널로 알림톡, 없으면 팜어시 채널.';
