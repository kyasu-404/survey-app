-- Run after 202610270900 on a disposable survey_personal_check_* database.
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
create function pg_temp.expect_error(statement text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when invalid_parameter_value then return;
  end;
  raise exception 'Expected rejection: %', statement;
end $$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('a5000000-0000-4000-8000-000000000001','scope-owner@example.invalid','{}'),
 ('a5000000-0000-4000-8000-000000000002','scope-disabled@example.invalid','{}');
update public.profiles set is_disabled=true where id='a5000000-0000-4000-8000-000000000002';
insert into public.education_organizations(id,organization_type,number,alias,email) values
 ('e5000000-0000-4000-8000-000000000001','school','scope-1','School','scope-one@example.invalid'),
 ('e5000000-0000-4000-8000-000000000002','school','scope-2','School','scope-two@example.invalid'),
 ('e5000000-0000-4000-8000-000000000003','kindergarten','scope-3','Garden','scope-three@example.invalid');
insert into public.forms(id,title,form_type,form_reason,schema,author_id,organization_types,allow_response_editing)
values ('b5000000-0000-4000-8000-000000000001','Scope validation','anketa','other',
 '{"commentSuffix":"_note","pages":[{"name":"page","elements":[{"type":"panel","name":"section","elements":[
   {"type":"paneldynamic","name":"entries","valueName":"records","templateElements":[
     {"type":"panel","name":"details","elements":[{"type":"organization","name":"org","valueName":"institution"}]},
     {"type":"dropdown","name":"choice","valueName":"selected","hasOther":true},
     {"type":"paneldynamic","name":"children","templateElements":[{"type":"organization","name":"org","valueName":"institution"}]}
   ]}
 ]},{"type":"organization","name":"rootOrg","valueName":"rootInstitution"},{"type":"text","name":"answer"}]}]}',
 'a5000000-0000-4000-8000-000000000001',array['school'],true);

-- Ordinary responses: every scope and occurrence, including valueName and comments.
do $$ declare s jsonb; payload jsonb; begin
  select schema into s from public.forms where id='b5000000-0000-4000-8000-000000000001';
  assert public.response_data_matches_form(s,array['school'],'{}'), 'Ordinary organizations remain optional';
  assert public.response_data_matches_form(s,array['school'],'{"records":[{},{}]}'), 'Empty entries remain valid';
  assert public.response_data_matches_form(s,array['school'],'{"records":[{"institution":"e5000000-0000-4000-8000-000000000001","selected":"other","selected_note":"Comment","children":[{"institution":"e5000000-0000-4000-8000-000000000002"}]}]}'), 'Nested aliases/comments rejected';
  foreach payload in array array[
    '{"records":[{"institution":"not-a-uuid"}]}'::jsonb,
    '{"records":[{"institution":"e5000000-0000-4000-8000-000000000099"}]}',
    '{"records":[{"institution":"e5000000-0000-4000-8000-000000000003"}]}',
    '{"records":[{"institution":null}]}', '{"records":[{"institution":{}}]}',
    '{"records":[{"children":[{"institution":"not-a-uuid"}]}]}',
    '{"records":[{"institution":"e5000000-0000-4000-8000-000000000001"},{"institution":"bad"}]}',
    '{"records":[{"foreign":"injected"}]}', '{"records":[{"answer":"wrong scope"}]}',
    '{"records":[{"children":[{"foreign":"injected"}]}]}',
    '{"institution":"e5000000-0000-4000-8000-000000000001"}',
    '{"org":"e5000000-0000-4000-8000-000000000001"}', '{"entries":[]}',
    '{"section":{}}', '{"page":{}}', '{"records":[{"details":{}}]}',
    '{"records":[{"selected_note":{}}]}', '{"records":[{"selected-Comment":"wrong suffix"}]}',
    '{"records":[{"foreign_note":"injected"}]}', '{"records":[{"selected_note":null}]}',
    '{"records":{}}', '{"records":null}', '{"records":[null]}', '{"records":[1]}',
    '{"records":[[]]}', '{"records":[{"children":{}}]}'
  ] loop
    assert not public.response_data_matches_form(s,array['school'],payload), 'Unsafe payload accepted: ' || payload;
  end loop;
  assert public.response_data_matches_form('{"elements":[{"type":"paneldynamic","name":"empty"}]}',array['school'],'{"empty":[{}]}'), 'SurveyJS omits empty templateElements';
  assert not public.response_data_matches_form('{"elements":[{"type":"paneldynamic","name":"empty"}]}',array['school'],'{"empty":[{"foreign":1}]}');
  assert not public.response_data_matches_form(s,array['school'],null), 'SQL NULL accepted';
  assert not public.response_data_matches_form(s,array['school'],'null'), 'JSON NULL accepted';
  assert public.response_data_matches_form('{"elements":[{"type":"paneldynamic","name":"empty","templateElements":[]}]}',array['school'],'{"empty":[{}]}');
  assert public.response_data_matches_form('{"pages":null,"elements":[{"type":"paneldynamic","name":"empty","templateElements":null}]}',array['school'],'{"empty":[{}]}');
  assert public.response_data_matches_form('{"pages":[{"elements":null}]}',array['school'],'{}');
  assert (select count(*)=1 from public.survey_response_bindings('{"elements":[{"type":"paneldynamic","name":"entries","templateElements":[{"name":"omittedType"}]}]}','{"entries":[{}]}'));
  assert not public.response_data_matches_form('{"elements":[{"type":"paneldynamic","name":"empty","templateElements":[]}]}',array['school'],'{"empty":[{"foreign":1}]}');
end $$;

set local role anon;
select pg_temp.expect_error($s$select public.submit_form_response('b5000000-0000-4000-8000-000000000001',
 'd5000000-0000-4000-8000-000000000001',gen_random_uuid(),'{"records":[{"institution":"not-a-uuid"}]}')$s$);
select pg_temp.assert_true((select status='submitted' from public.submit_form_response(
 'b5000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001',gen_random_uuid(),
 '{"records":[{"institution":"e5000000-0000-4000-8000-000000000001","children":[{"institution":"e5000000-0000-4000-8000-000000000002"}]}],"rootInstitution":"e5000000-0000-4000-8000-000000000001","answer":"before"}')),'valid ordinary submission');
reset role;
select id as response_id from public.responses where form_id='b5000000-0000-4000-8000-000000000001' \gset
select set_config('test.scope_response', :'response_id', true);
update public.education_organizations set is_archived=true where id in
 ('e5000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000002');

-- Same-path archives survive an edit; insertion, copying and switching do not.
set local role anon;
select * from public.update_form_response('b5000000-0000-4000-8000-000000000001',
 'd5000000-0000-4000-8000-000000000001',:'response_id',
 '{"records":[{"institution":"e5000000-0000-4000-8000-000000000001","children":[{"institution":"e5000000-0000-4000-8000-000000000002"}]}],"rootInstitution":"e5000000-0000-4000-8000-000000000001","answer":"after"}');
select pg_temp.expect_error($s$select public.submit_form_response('b5000000-0000-4000-8000-000000000001',
 'd5000000-0000-4000-8000-000000000002',gen_random_uuid(),'{"records":[{"institution":"e5000000-0000-4000-8000-000000000001"}]}')$s$);
select pg_temp.expect_error($s$select public.update_form_response('b5000000-0000-4000-8000-000000000001',
 'd5000000-0000-4000-8000-000000000001',current_setting('test.scope_response')::uuid,
 '{"records":[{"institution":"e5000000-0000-4000-8000-000000000002"}]}')$s$);
select pg_temp.expect_error($s$select public.update_form_response('b5000000-0000-4000-8000-000000000001',
 'd5000000-0000-4000-8000-000000000001',current_setting('test.scope_response')::uuid,
 '{"records":[{"institution":"e5000000-0000-4000-8000-000000000001"},{"institution":"e5000000-0000-4000-8000-000000000001"}]}')$s$);
select pg_temp.assert_true((select count(*)=2 from public.list_saved_form_organizations(
 'b5000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001')),'saved nested/valueName archives visible to owner');
select pg_temp.assert_true((select count(*)=0 from public.list_saved_form_organizations(
 'b5000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000002')),'foreign browser cannot read archives');
reset role;
select pg_temp.expect_error($s$insert into public.responses(form_id,data) values(
 'b5000000-0000-4000-8000-000000000001','{"records":[{"institution":"e5000000-0000-4000-8000-000000000002"}]}')$s$);
select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.assert_true((select count(*)=2 from public.list_saved_form_organizations(
 'b5000000-0000-4000-8000-000000000001',null)),'enabled staff can read nested archive labels');
reset role;
select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.assert_true((select count(*)=0 from public.list_saved_form_organizations(
 'b5000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001')),'disabled account cannot use browser fallback');
reset role;
select pg_temp.assert_true(not has_function_privilege('anon','public.survey_response_bindings(jsonb,jsonb,text[],integer)','execute'),'traversal stays private');
rollback;
