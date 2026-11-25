-- 카카오 챗봇(Claude)이 쓰는 읽기 전용 롤 (doc/chatbot/developer-handoff.md §1).
-- public, auth 만 조회. private(뱅크다 계정 등)는 권한을 주지 않는다.
-- BYPASSRLS: RLS 가 auth.uid() 기준이라 익명 접속으로는 orders 등이 0 건으로 보인다.
--
-- 롤은 Postgres 서버 전체에 하나다(dev·운영 DB 가 같은 서버). 접속 권한은 DB 마다 따로 준다:
--   psql -d farmassi_dev -v ON_ERROR_STOP=1 -v dbname=farmassi_dev -f doc/chatbot/sql/chatbot-ro.sql   ← dev
--   psql -d farmassi     -v ON_ERROR_STOP=1 -v dbname=farmassi     -f doc/chatbot/sql/chatbot-ro.sql   ← 운영 (승인 후)
-- 테이블 소유자(lkim)로 실행한다 (alter default privileges 가 그 롤이 만드는 테이블에 걸리므로).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'chatbot_ro') then
    create role chatbot_ro login bypassrls;
  end if;
end $$;

alter role chatbot_ro bypassrls;

grant connect on database :"dbname" to chatbot_ro;

grant usage on schema public, auth to chatbot_ro;
grant select on all tables in schema public, auth to chatbot_ro;

alter default privileges in schema public grant select on tables to chatbot_ro;
alter default privileges in schema auth   grant select on tables to chatbot_ro;
