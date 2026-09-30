-- Run only on a disposable restored database after the personal links migration.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';
do $$ begin
  if current_database() not like 'survey_personal_check_%' then
    raise exception 'Requires a disposable survey_personal_check_* database';
  end if;
end $$;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;
create function pg_temp.expect_error(statement text, expected_state text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise exception 'Expected %, got %: %', expected_state, sqlstate, sqlerrm;
  end;
  raise exception 'Expected rejection: %', statement;
end $$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('a3000000-0000-4000-8000-000000000001','links-owner@example.invalid','{"name":"Links owner"}'),
 ('a3000000-0000-4000-8000-000000000002','links-reader@example.invalid','{"name":"Links reader"}'),
 ('a3000000-0000-4000-8000-000000000003','links-admin@example.invalid','{"name":"Links admin"}');
update public.profiles set role='admin' where id='a3000000-0000-4000-8000-000000000003';
update public.education_organizations set is_archived=true;
insert into public.education_organizations(id,organization_type,number,alias,email,is_archived) values
 ('e3000000-0000-4000-8000-000000000001','school','test-1','Школа','one@example.invalid',false),
 ('e3000000-0000-4000-8000-000000000002','school','test-2','Школа','two@example.invalid',false),
 ('e3000000-0000-4000-8000-000000000003','kindergarten','test-3','Сад','three@example.invalid',false),
 ('e3000000-0000-4000-8000-000000000004','school','test-4','Архив','four@example.invalid',true);
insert into public.forms(id,title,form_type,form_reason,schema,author_id,organization_types,allow_response_editing) values
 ('b3000000-0000-4000-8000-000000000001','Personal test','anketa','other',
 '{"pages":[{"elements":[{"type":"organization","name":"org","valueName":"institution"},{"type":"text","name":"answer"}]}]}',
 'a3000000-0000-4000-8000-000000000001',array['school'],true),
 ('b3000000-0000-4000-8000-000000000002','No organization','anketa','other',
 '{"pages":[{"elements":[{"type":"text","name":"answer"}]}]}',
 'a3000000-0000-4000-8000-000000000001',array['school'],true);
select set_config('request.jwt.claim.sub','a3000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.assert_true((public.set_form_personal_links('b3000000-0000-4000-8000-000000000001',true)->>'enabled')::boolean,'owner enables');
select pg_temp.assert_true(jsonb_array_length(public.get_form_personal_links('b3000000-0000-4000-8000-000000000001')->'links')=2,'only selected active organizations');
select pg_temp.expect_error($s$select public.set_form_personal_links('b3000000-0000-4000-8000-000000000002',true)$s$,'22023');
select pg_temp.expect_error('select * from public.form_personal_links','42501');
select pg_temp.expect_error($s$update public.forms set personal_links_enabled=false where id='b3000000-0000-4000-8000-000000000001'$s$,'42501');
reset role;
select token as token1, browser_id as secret_browser from public.form_personal_links where form_id='b3000000-0000-4000-8000-000000000001' and organization_id='e3000000-0000-4000-8000-000000000001' \gset
select token as token2 from public.form_personal_links where form_id='b3000000-0000-4000-8000-000000000001' and organization_id='e3000000-0000-4000-8000-000000000002' \gset
select set_config('test.token1', :'token1', true);
select set_config('test.token2', :'token2', true);
select set_config('request.jwt.claim.sub','a3000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.assert_true(public.get_form_personal_links('b3000000-0000-4000-8000-000000000001')->'links'='[]'::jsonb,'reader cannot export capabilities');
select pg_temp.expect_error($s$select public.set_form_personal_links('b3000000-0000-4000-8000-000000000001',false)$s$,'42501');
select pg_temp.expect_error($s$select public.prepare_form_mail_recipients('b3000000-0000-4000-8000-000000000001','invitation')$s$,'42501');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.expect_error($s$select public.get_form_personal_links('b3000000-0000-4000-8000-000000000001')$s$,'42501');
select pg_temp.expect_error($s$select public.resolve_form_personal_link('b3000000-0000-4000-8000-000000000001',current_setting('test.token1')::uuid)$s$,'42501');
select pg_temp.assert_true(public.get_personal_form_context('b3000000-0000-4000-8000-000000000001',:'token1')->>'id'='e3000000-0000-4000-8000-000000000001','valid context');
select pg_temp.assert_true(not (public.get_personal_form_context('b3000000-0000-4000-8000-000000000001',:'token1') ?| array['email','browser_id','token']),'no secret or email in public context');
select pg_temp.expect_error($s$select public.get_personal_form_context('b3000000-0000-4000-8000-000000000002',current_setting('test.token1')::uuid)$s$,'42501');
select pg_temp.expect_error($s$select public.submit_personal_form_response('b3000000-0000-4000-8000-000000000001',current_setting('test.token1')::uuid,gen_random_uuid(),'{"institution":"e3000000-0000-4000-8000-000000000002"}')$s$,'22023');
select pg_temp.expect_error($s$select public.submit_personal_form_response('b3000000-0000-4000-8000-000000000001',current_setting('test.token1')::uuid,gen_random_uuid(),'{"answer":"missing organization"}')$s$,'22023');
select pg_temp.assert_true((select status='submitted' from public.submit_personal_form_response('b3000000-0000-4000-8000-000000000001',:'token1',gen_random_uuid(),'{"institution":"e3000000-0000-4000-8000-000000000001","answer":"first"}')),'submit');
select pg_temp.assert_true((select status='already_submitted' from public.submit_personal_form_response('b3000000-0000-4000-8000-000000000001',:'token1',gen_random_uuid(),'{"institution":"e3000000-0000-4000-8000-000000000001","answer":"duplicate"}')),'idempotent across browsers');
select response_id as response1 from public.get_personal_form_response_status('b3000000-0000-4000-8000-000000000001',:'token1') \gset
select set_config('test.response1', :'response1', true);
select pg_temp.assert_true((select count(*)=0 from public.get_personal_form_response_status('b3000000-0000-4000-8000-000000000001',:'token2')),'another organization cannot read answer');
select pg_temp.expect_error($s$select public.update_personal_form_response('b3000000-0000-4000-8000-000000000001',current_setting('test.token2')::uuid,current_setting('test.response1')::uuid,'{"institution":"e3000000-0000-4000-8000-000000000002"}')$s$,'P0002');
select pg_temp.expect_error($s$select public.update_personal_form_response('b3000000-0000-4000-8000-000000000001',current_setting('test.token1')::uuid,current_setting('test.response1')::uuid,'{"institution":"e3000000-0000-4000-8000-000000000002"}')$s$,'22023');
select pg_temp.assert_true((select response_data->>'answer'='edited' from public.update_personal_form_response('b3000000-0000-4000-8000-000000000001',:'token1',:'response1','{"institution":"e3000000-0000-4000-8000-000000000001","answer":"edited"}')),'edit with binding');
reset role;
set local role service_role;
select pg_temp.assert_true(jsonb_array_length(public.prepare_form_mail_recipients('b3000000-0000-4000-8000-000000000001','invitation')->'recipients')=2,'invitations include both organizations');
select pg_temp.assert_true(public.prepare_form_mail_recipients('b3000000-0000-4000-8000-000000000001','reminder')->'recipients'->0->>'token'=:'token2','reminders only to missing, same token');
reset role;
select set_config('request.jwt.claim.sub','a3000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select pg_temp.expect_error($s$select public.set_form_personal_links('b3000000-0000-4000-8000-000000000001',false)$s$,'42501');
select pg_temp.assert_true(public.get_form_personal_links('b3000000-0000-4000-8000-000000000001')->'links'='[]'::jsonb,'non-author admin cannot export capabilities');
select set_config('request.jwt.claim.sub','a3000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true((public.set_form_personal_links('b3000000-0000-4000-8000-000000000001',false)->>'enabled')::boolean=false,'author disables');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.expect_error($s$select public.get_personal_form_context('b3000000-0000-4000-8000-000000000001',current_setting('test.token1')::uuid)$s$,'42501');
reset role;
set local role service_role;
select pg_temp.assert_true(public.prepare_form_mail_recipients('b3000000-0000-4000-8000-000000000001','reminder')->'recipients'->0->'token'='null'::jsonb,'disabled mode reminders use common URL');
reset role;
select set_config('request.jwt.claim.sub','a3000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.assert_true(public.set_form_personal_links('b3000000-0000-4000-8000-000000000001',true)->'links'->0->>'token'=:'token1','reenabling preserves links');
reset role;
insert into public.education_organizations(organization_type,number,alias,email)
select 'school', 'mass-'||n, 'Тест', 'test'||n||'@example.invalid' from generate_series(1,1100) n;
set local role service_role;
select pg_temp.assert_true(jsonb_array_length(public.prepare_form_mail_recipients('b3000000-0000-4000-8000-000000000001','invitation')->'recipients')=1102,'snapshot beyond 1000 and new links');
select pg_temp.assert_true(public.enqueue_form_mail_batch('c3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',
 '[{"organization_id":"e3000000-0000-4000-8000-000000000002","recipient_email":"two@example.invalid","recipient_name":"Школа","subject":"Тест","body_text":"Приглашение"}]','invitation',true)=1,'atomic invitation batch');
select pg_temp.expect_error($s$select public.enqueue_form_mail_batch(gen_random_uuid(),'b3000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','[{"organization_id":"e3000000-0000-4000-8000-000000000002","recipient_email":"two@example.invalid","recipient_name":"Школа","subject":"Тест","body_text":"Повтор"}]','reminder',true)$s$,'55000');
reset role;
set local role authenticated;
select pg_temp.expect_error($s$select public.set_form_personal_links('b3000000-0000-4000-8000-000000000001',false)$s$,'55000');
reset role;
update public.education_organizations set is_archived=true where id='e3000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.expect_error($s$select public.get_personal_form_context('b3000000-0000-4000-8000-000000000001',current_setting('test.token2')::uuid)$s$,'42501');
reset role;
insert into public.response_file_references(response_id,form_id,object_path) values
 (:'response1','b3000000-0000-4000-8000-000000000001','public/b3000000-0000-4000-8000-000000000001/test.txt');
set local role service_role;
select pg_temp.assert_true(public.can_restore_personal_upload('b3000000-0000-4000-8000-000000000001',:'token1','public/b3000000-0000-4000-8000-000000000001/test.txt'),'own attached file accessible from personal link');
select pg_temp.assert_true(not public.can_restore_personal_upload('b3000000-0000-4000-8000-000000000001',:'token1','public/b3000000-0000-4000-8000-000000000001/other.txt'),'unattached file inaccessible');
reset role;
update public.forms set deadline_at=now()-interval '1 day' where id='b3000000-0000-4000-8000-000000000001';
set local role anon;
select pg_temp.expect_error($s$select public.get_personal_form_context('b3000000-0000-4000-8000-000000000001',current_setting('test.token1')::uuid)$s$,'42501');
reset role;
rollback;
