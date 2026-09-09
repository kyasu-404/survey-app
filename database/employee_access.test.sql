-- Run only on a disposable copy of the production database after the migration.
-- Fixtures and assertions are rolled back, including on any psql error.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';

do $$ begin
  if current_database() not like 'survey_access_check_%' then
    raise exception 'This test requires a disposable survey_access_check_* database';
  end if;
end $$;

create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'Assertion failed: %', message; end if;
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000001', 'access-author@example.invalid', '{"name":"Access author"}'),
  ('a1000000-0000-4000-8000-000000000002', 'access-reader@example.invalid', '{"name":"Access reader"}'),
  ('a1000000-0000-4000-8000-000000000003', 'access-disabled@example.invalid', '{"name":"Disabled author"}'),
  ('a1000000-0000-4000-8000-000000000004', 'access-admin@example.invalid', '{"name":"Access admin"}');
update public.profiles set is_disabled = true where id = 'a1000000-0000-4000-8000-000000000003';
update auth.users set banned_until = now() + interval '100 years' where id = 'a1000000-0000-4000-8000-000000000003';
update public.profiles set role = 'admin' where id = 'a1000000-0000-4000-8000-000000000004';

insert into public.education_organizations (id, organization_type, number, alias, email)
values ('e1000000-0000-4000-8000-000000000001', 'school', 'access-test', 'Access school', 'school@example.invalid');

insert into public.forms (id, title, form_type, form_reason, schema, author_id, is_public, deadline_at, allow_response_editing)
select ('b1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'Access fixture ' || n, 'anketa', 'other',
  '{"pages":[{"name":"p1","elements":[{"type":"text","name":"q1"},{"type":"file","name":"attachment"},{"type":"organization","name":"org"}]}]}'::jsonb,
  case when n in (1,5) then 'a1000000-0000-4000-8000-000000000003'::uuid
    else 'a1000000-0000-4000-8000-000000000001'::uuid end,
  n <> 3, case when n = 4 then now() - interval '1 day' else null end, n = 5
from generate_series(1,5) n;

insert into public.responses (id, form_id, data)
select ('c1000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  ('b1000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  jsonb_build_object('q1','original','attachment',jsonb_build_array(jsonb_build_object(
    'name','submitted.txt','content','public/b1000000-0000-4000-8000-' || lpad(n::text,12,'0') || '/submitted.txt')))
from generate_series(1,5) n;

insert into storage.objects (bucket_id,name)
select 'survey-files', 'public/b1000000-0000-4000-8000-' || lpad(n::text,12,'0') || '/submitted.txt'
from generate_series(1,5) n;
insert into storage.objects (bucket_id,name)
values ('survey-files','public/b1000000-0000-4000-8000-000000000003/draft.txt');

-- An ordinary colleague sees all response states and submitted attachments.
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.assert_true(public.request_role() = 'user', 'reader is an ordinary employee');
select pg_temp.assert_true((select count(id) = 5 from public.forms where id::text like 'b1000000-%'), 'staff see open, closed, expired and disabled-author forms');
select pg_temp.assert_true((select count(id) = 5 from public.responses where id::text like 'c1000000-%'), 'staff see other employees responses in all states');
select pg_temp.assert_true((select count(*) = 1 from public.list_form_organizations('b1000000-0000-4000-8000-000000000003') where id = 'e1000000-0000-4000-8000-000000000001'), 'closed response previews resolve organizations');
select pg_temp.assert_true((select count(*) = 5 from storage.objects where bucket_id = 'survey-files' and name like 'public/b1000000-%'), 'staff read only submitted files, including closed forms');
select pg_temp.assert_true(not public.can_read_survey_file('public/b1000000-0000-4000-8000-000000000003/draft.txt'), 'other upload drafts stay private');
select pg_temp.assert_true(not public.can_delete_survey_file('public/b1000000-0000-4000-8000-000000000003/submitted.txt'), 'read permission does not grant delete');
do $$ declare changed integer; begin
  update public.forms set title = 'forbidden' where id = 'b1000000-0000-4000-8000-000000000002';
  get diagnostics changed = row_count;
  perform pg_temp.assert_true(changed = 0, 'reader cannot modify another employee form');
  begin
    delete from public.responses where id = 'c1000000-0000-4000-8000-000000000002';
    raise exception 'reader deleted another response';
  exception when insufficient_privilege then null; end;
  begin
    perform browser_id from public.responses limit 1;
    raise exception 'browser capability became readable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- A disabled session cannot read staff data or call respondent RPCs as that user.
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select pg_temp.assert_true(not public.request_is_enabled(), 'disabled user is still blocked');
select pg_temp.assert_true((select count(id) = 0 from public.forms), 'disabled session cannot read forms');
select pg_temp.assert_true((select count(id) = 0 from public.responses), 'disabled session cannot read answers');
select pg_temp.assert_true(not public.can_read_survey_file('public/b1000000-0000-4000-8000-000000000001/submitted.txt'), 'disabled session cannot read files');
do $$ begin
  begin
    perform * from public.submit_form_response('b1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','{"q1":"blocked"}');
    raise exception 'disabled session submitted an answer';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.get_form_response_status('b1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001');
    raise exception 'disabled session read response status';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Anonymous respondents can still use published forms from the disabled author.
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.assert_true((select count(id) = 3 from public.forms where id::text like 'b1000000-%'), 'anon sees only active public forms regardless of author status');
select pg_temp.assert_true(public.can_upload_survey_file('public/b1000000-0000-4000-8000-000000000001/new.txt',true,10), 'anon uploads to disabled-author form');
select pg_temp.assert_true(not public.can_upload_survey_file('public/b1000000-0000-4000-8000-000000000003/new.txt',true,10), 'closed form still rejects uploads');
select pg_temp.assert_true((select count(*) = 1 from public.list_form_organizations('b1000000-0000-4000-8000-000000000001') where id = 'e1000000-0000-4000-8000-000000000001'), 'public organization choices survive author suspension');
select pg_temp.assert_true((select status = 'submitted' from public.submit_form_response('b1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','{"q1":"first"}')), 'anonymous submission accepted');
select pg_temp.assert_true((select status = 'already_submitted' from public.submit_form_response('b1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000002','{"q1":"duplicate"}')), 'one response per browser is preserved');
select pg_temp.assert_true((select not response_editable from public.get_form_response_status('b1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001')), 'editing disabled is respected');
select pg_temp.assert_true((select count(*) = 0 from public.get_form_response_status('b1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000099')), 'other browser cannot retrieve an answer');
do $$ declare saved uuid; begin
  select response_id into saved from public.submit_form_response('b1000000-0000-4000-8000-000000000005','d1000000-0000-4000-8000-000000000005','d2000000-0000-4000-8000-000000000005','{"q1":"before"}');
  perform pg_temp.assert_true((select response_data->>'q1' = 'after' from public.update_form_response('b1000000-0000-4000-8000-000000000005','d1000000-0000-4000-8000-000000000005',saved,'{"q1":"after"}')), 'allowed editing survives author suspension');
  begin
    perform * from public.update_form_response('b1000000-0000-4000-8000-000000000005','d1000000-0000-4000-8000-000000000099',saved,'{"q1":"forbidden"}');
    raise exception 'wrong browser edited an answer';
  exception when no_data_found then null; end;
  begin
    perform * from public.submit_form_response('b1000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000003','{"q1":"closed"}');
    raise exception 'closed form accepted an answer';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.submit_form_response('b1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000004','d2000000-0000-4000-8000-000000000004','{"q1":"expired"}');
    raise exception 'expired form accepted an answer';
  exception when insufficient_privilege then null; end;
  begin
    perform id from public.responses limit 1;
    raise exception 'anonymous response listing was allowed';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.assert_true((select count(*) = 0 from storage.objects where bucket_id = 'survey-files' and name like 'public/b1000000-%'), 'anonymous storage listing stays private');
reset role;

-- Owner and administrator management permissions still work.
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
with changed as (update public.forms set title = 'Owner edit' where id = 'b1000000-0000-4000-8000-000000000002' returning id)
select pg_temp.assert_true((select count(*) = 1 from changed), 'owner can still edit');
reset role;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000004',true);
set local role authenticated;
with changed as (update public.forms set title = 'Admin edit' where id = 'b1000000-0000-4000-8000-000000000001' returning id)
select pg_temp.assert_true((select count(*) = 1 from changed), 'admin can manage disabled-author form');
reset role;

select pg_temp.assert_true((select is_public and responses_count = 2 from public.forms where id = 'b1000000-0000-4000-8000-000000000001'), 'public flag and atomic response counter remain correct');
select pg_temp.assert_true((select banned_until > now() from auth.users where id = 'a1000000-0000-4000-8000-000000000003'), 'account auth ban is preserved');
rollback;
select 'Employee access integration checks passed; fixtures rolled back' as result;
