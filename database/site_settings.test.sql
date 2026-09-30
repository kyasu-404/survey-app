\set ON_ERROR_STOP on
begin;
do $$ begin if current_database() not like 'survey_personal_check_%' then raise exception 'Disposable database required'; end if; end $$;
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'Assertion failed: %',label; end if; end;$$;
create function pg_temp.denied(statement text, code text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if sqlstate=code then return;end if;raise;end;
 raise exception 'Expected rejection: %',statement;end;$$;
insert into auth.users(id,email,raw_user_meta_data) values
 ('a4000000-0000-4000-8000-000000000001','site-admin@example.invalid','{"name":"Admin"}'),
 ('a4000000-0000-4000-8000-000000000002','site-user@example.invalid','{"name":"User"}');
update public.profiles set role='admin' where id='a4000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','a4000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.denied($s$select public.set_form_embedding_origins(array['https://example.ru'])$s$,'42501');
select pg_temp.assert_true((select count(*)=0 from public.form_embedding_settings),'settings hidden from non-admin');
select pg_temp.denied($s$select public.set_app_favicon(null,null,'a4000000-0000-4000-8000-000000000002')$s$,'42501');
select set_config('request.jwt.claim.sub','a4000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true(public.set_form_embedding_origins(array['https://example.ru','https://portal.example.ru'])->'allowed_origins'='["https://example.ru","https://portal.example.ru"]'::jsonb,'admin saves exact origins');
select pg_temp.denied($s$select public.set_form_embedding_origins(array['https://example.ru','https://example.ru'])$s$,'22023');
select pg_temp.denied($s$select public.set_form_embedding_origins(array['https://*.example.ru'])$s$,'22023');
select pg_temp.denied($s$select public.set_form_embedding_origins(array['https://example.ru; script-src *'])$s$,'22023');
select pg_temp.denied($s$select public.set_form_embedding_origins(array['javascript:alert(1)'])$s$,'22023');
select pg_temp.denied($s$select public.set_form_embedding_origins(array['https://example.ru/path'])$s$,'22023');
select pg_temp.denied($s$select public.set_form_embedding_origins(array['https://example.ru:99999'])$s$,'22023');
select pg_temp.denied($s$select public.set_form_embedding_origins(array[null]::text[])$s$,'22023');
reset role;
set local role anon;
select pg_temp.assert_true(public.get_form_embedding_policy()->>'frameAncestors'='https://example.ru https://portal.example.ru','anonymous header contains only configured sites');
select pg_temp.assert_true(current_setting('response.headers')::jsonb->0->>'X-Form-Frame-Ancestors'='https://example.ru https://portal.example.ru','nginx header available');
select pg_temp.denied('select * from public.form_embedding_settings','42501');
select pg_temp.assert_true(public.get_app_favicon() ? 'path','public favicon metadata available');
reset role;
set local role authenticated;
select public.set_form_embedding_origins('{}');
select pg_temp.assert_true(public.get_form_embedding_policy()->>'frameAncestors'='''none''','empty list denies all embedding');
select pg_temp.denied($s$select public.set_app_favicon(null,null,'a4000000-0000-4000-8000-000000000001')$s$,'42501');
reset role;
set local role service_role;
select pg_temp.assert_true(public.set_app_favicon('favicon-11111111-1111-4111-8111-111111111111.png','image/png','a4000000-0000-4000-8000-000000000001')->>'path' like 'favicon-%','service validated upload metadata saved');
select pg_temp.denied($s$select public.set_app_favicon('favicon-11111111-1111-4111-8111-111111111111.png',null,'a4000000-0000-4000-8000-000000000001')$s$,'23514');
select pg_temp.denied($s$select public.set_app_favicon(null,null,'a4000000-0000-4000-8000-000000000002')$s$,'42501');
select pg_temp.assert_true(public.set_app_favicon(null,null,'a4000000-0000-4000-8000-000000000001')->>'previousPath' like 'favicon-%','reset returns previous file for cleanup');
reset role;
rollback;
