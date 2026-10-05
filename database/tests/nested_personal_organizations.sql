-- Run only on a disposable database after 202610050900; fixtures roll back.
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

insert into auth.users(id,email,raw_user_meta_data)
values ('a4000000-0000-4000-8000-000000000001','nested-owner@example.invalid','{}');
update public.education_organizations set is_archived=true;
insert into public.education_organizations(id,organization_type,number,alias,email) values
 ('e4000000-0000-4000-8000-000000000001','school','nested-1','Школа','nested-one@example.invalid'),
 ('e4000000-0000-4000-8000-000000000002','school','nested-2','Школа','nested-two@example.invalid');
insert into public.forms(id,title,form_type,form_reason,schema,author_id,organization_types,allow_response_editing)
values ('b4000000-0000-4000-8000-000000000001','Nested personal links','anketa','other',
 '{"pages":[{"elements":[{"type":"panel","name":"section","elements":[
   {"type":"paneldynamic","name":"entries","valueName":"records","templateElements":[
     {"type":"panel","name":"details","elements":[{"type":"organization","name":"org","valueName":"institution"}]},
     {"type":"paneldynamic","name":"children","templateElements":[{"type":"organization","name":"org","valueName":"institution"}]}
   ]}
 ]},{"type":"text","name":"answer"}]}]}',
 'a4000000-0000-4000-8000-000000000001',array['school'],true);
select set_config('request.jwt.claim.sub','a4000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.assert_true((public.set_form_personal_links('b4000000-0000-4000-8000-000000000001',true)->>'enabled')::boolean,'nested question enables links');
reset role;
select token as token from public.form_personal_links
where form_id='b4000000-0000-4000-8000-000000000001' and organization_id='e4000000-0000-4000-8000-000000000001' \gset
select set_config('test.nested_token', :'token', true);
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.assert_true((select status='submitted' from public.submit_personal_form_response(
 'b4000000-0000-4000-8000-000000000001',:'token',gen_random_uuid(),
 '{"records":[{"institution":"e4000000-0000-4000-8000-000000000001","children":[{"institution":"e4000000-0000-4000-8000-000000000001"}]},
              {"institution":"e4000000-0000-4000-8000-000000000001"}],"answer":"first"}')),'nested submission');
select response_id as response from public.get_personal_form_response_status('b4000000-0000-4000-8000-000000000001',:'token') \gset
select set_config('test.nested_response', :'response', true);
select pg_temp.assert_true((select response_data->>'answer'='edited' from public.update_personal_form_response(
 'b4000000-0000-4000-8000-000000000001',:'token',:'response',
 '{"records":[{"institution":"e4000000-0000-4000-8000-000000000001"}],"answer":"edited"}')),'nested edit');
-- Check every existing row and every nested scope, including updates.
select pg_temp.expect_error($s$select public.update_personal_form_response(
 'b4000000-0000-4000-8000-000000000001',current_setting('test.nested_token')::uuid,current_setting('test.nested_response')::uuid,
 '{"records":[{"institution":"e4000000-0000-4000-8000-000000000001"},{"institution":"e4000000-0000-4000-8000-000000000002"}]}')$s$,'22023');
select pg_temp.expect_error($s$select public.update_personal_form_response(
 'b4000000-0000-4000-8000-000000000001',current_setting('test.nested_token')::uuid,current_setting('test.nested_response')::uuid,
 '{"records":[{"institution":"e4000000-0000-4000-8000-000000000001","children":[{"institution":"e4000000-0000-4000-8000-000000000002"}]}]}')$s$,'22023');
select pg_temp.expect_error($s$select public.update_personal_form_response(
 'b4000000-0000-4000-8000-000000000001',current_setting('test.nested_token')::uuid,current_setting('test.nested_response')::uuid,
 '{"records":[{"institution":"e4000000-0000-4000-8000-000000000001"},{}]}')$s$,'22023');
select pg_temp.expect_error($s$select public.update_personal_form_response(
 'b4000000-0000-4000-8000-000000000001',current_setting('test.nested_token')::uuid,current_setting('test.nested_response')::uuid,
 '{"institution":"e4000000-0000-4000-8000-000000000001","records":[{}]}')$s$,'22023');
select pg_temp.expect_error($s$select public.update_personal_form_response(
 'b4000000-0000-4000-8000-000000000001',current_setting('test.nested_token')::uuid,current_setting('test.nested_response')::uuid,
 '{"records":{"institution":"e4000000-0000-4000-8000-000000000001"}}')$s$,'22023');
select pg_temp.expect_error($s$select public.update_personal_form_response(
 'b4000000-0000-4000-8000-000000000001',current_setting('test.nested_token')::uuid,current_setting('test.nested_response')::uuid,
 '{"records":[],"answer":"e4000000-0000-4000-8000-000000000001"}')$s$,'22023');
select pg_temp.assert_true(not has_function_privilege('anon','public.survey_organization_values(jsonb,jsonb,integer)','execute'),'traversal stays private');
reset role;
set local role service_role;
select pg_temp.assert_true(jsonb_array_length(public.prepare_form_mail_recipients('b4000000-0000-4000-8000-000000000001','reminder')->'recipients')=1,'nested response suppresses reminder');
select pg_temp.assert_true(public.prepare_form_mail_recipients('b4000000-0000-4000-8000-000000000001','reminder')->'recipients'->0->>'id'='e4000000-0000-4000-8000-000000000002','only missing organization receives reminder');
reset role;
select set_config('request.jwt.claim.sub','a4000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.set_form_personal_links('b4000000-0000-4000-8000-000000000001',false);
reset role;
set local role service_role;
select pg_temp.assert_true(jsonb_array_length(public.prepare_form_mail_recipients('b4000000-0000-4000-8000-000000000001','reminder')->'recipients')=1,'common links also respect nested responses');
reset role;
rollback;
