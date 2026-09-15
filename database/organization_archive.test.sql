-- Run on a disposable production copy after 202609160200_organization_archive.sql.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';
do $$ begin
  if current_database() not like 'survey_archive_check_%' then
    raise exception 'Requires a disposable survey_archive_check_* database';
  end if;
end $$;
create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'Assertion failed: %', message; end if;
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a2000000-0000-4000-8000-000000000001', 'archive-admin@example.invalid', '{"name":"Archive admin"}'),
  ('a2000000-0000-4000-8000-000000000002', 'archive-reader@example.invalid', '{"name":"Archive reader"}'),
  ('a2000000-0000-4000-8000-000000000003', 'archive-disabled@example.invalid', '{"name":"Archive disabled"}');
update public.profiles set role = 'admin' where id = 'a2000000-0000-4000-8000-000000000001';
update public.profiles set is_disabled = true where id = 'a2000000-0000-4000-8000-000000000003';
insert into public.education_organizations (id, organization_type, number, alias, email) values
  ('e2000000-0000-4000-8000-000000000001', 'school', 'archive-test-1', 'Archive school', 'one@example.invalid'),
  ('e2000000-0000-4000-8000-000000000002', 'school', 'archive-test-2', 'Archive school', 'two@example.invalid'),
  ('e2000000-0000-4000-8000-000000000003', 'udod', null, 'Archive udod', 'udod@example.invalid');
insert into public.forms (id, title, form_type, form_reason, schema, author_id, is_public, allow_response_editing)
values ('b2000000-0000-4000-8000-000000000001', 'Archive fixture', 'anketa', 'other',
 '{"pages":[{"name":"p1","elements":[{"type":"text","name":"q1"},{"type":"organization","name":"org"},{"type":"organization","name":"org2"}]}]}',
 'a2000000-0000-4000-8000-000000000001', true, true);

-- Submit through the public API before archiving.
set local role anon;
select * from public.submit_form_response('b2000000-0000-4000-8000-000000000001',
 'd2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001',
 '{"org":"e2000000-0000-4000-8000-000000000001","q1":"before"}');
reset role;
select id as saved_response_id from public.responses where form_id = 'b2000000-0000-4000-8000-000000000001' \gset

-- The existing DELETE API archives even for an old client; a normal user cannot do it.
select set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000002',true);
set local role authenticated;
delete from public.education_organizations where id = 'e2000000-0000-4000-8000-000000000001';
select pg_temp.assert_true((select not is_archived from public.education_organizations where id = 'e2000000-0000-4000-8000-000000000001'), 'ordinary user cannot archive');
reset role;
select set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000001',true);
set local role authenticated;
delete from public.education_organizations where id::text like 'e2000000-%';
select pg_temp.assert_true((select count(*) = 3 and bool_and(is_archived) from public.education_organizations where id::text like 'e2000000-%'), 'bulk delete keeps every original UUID');
select pg_temp.assert_true((select data ->> 'org' = 'e2000000-0000-4000-8000-000000000001' from public.responses where id = :'saved_response_id'), 'saved answer unchanged');
reset role;

-- Archive names are still available to staff, and only the owning browser anonymously.
select set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.assert_true((select count(*) = 1 from public.list_saved_form_organizations('b2000000-0000-4000-8000-000000000001', null)), 'staff resolve historical names');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.assert_true((select count(*) = 0 from public.list_form_organizations('b2000000-0000-4000-8000-000000000001') where id::text like 'e2000000-%'), 'archived records absent from new choices');
select pg_temp.assert_true((select count(*) = 1 from public.list_saved_form_organizations('b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001')), 'own browser resolves saved archive');
select pg_temp.assert_true((select count(*) = 0 from public.list_saved_form_organizations('b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000002')), 'other browser cannot read saved archive');
select * from public.update_form_response('b2000000-0000-4000-8000-000000000001',
 'd2000000-0000-4000-8000-000000000001', :'saved_response_id',
 '{"org":"e2000000-0000-4000-8000-000000000001","q1":"edited"}');
do $$ begin
  begin
    perform public.submit_form_response('b2000000-0000-4000-8000-000000000001',
      'd2000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002',
      '{"org":"e2000000-0000-4000-8000-000000000001"}');
    raise exception 'New response accepted archived organization';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- The trigger also rejects introducing an archive through direct writes or another question.
do $$ declare response_id uuid; begin
  select id into response_id from public.responses where form_id = 'b2000000-0000-4000-8000-000000000001';
  begin
    update public.responses set data = data || '{"org2":"e2000000-0000-4000-8000-000000000001"}' where id = response_id;
    raise exception 'Archive copied to another question';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.update_form_response('b2000000-0000-4000-8000-000000000001',
      'd2000000-0000-4000-8000-000000000001', response_id,
      '{"org":"e2000000-0000-4000-8000-000000000002"}');
    raise exception 'Switched to a different archive';
  exception when invalid_parameter_value then null; end;
end $$;
select pg_temp.assert_true((select count(*) = 0 from public.list_missing_form_organizations('b2000000-0000-4000-8000-000000000001') where id::text like 'e2000000-%'), 'reminders exclude archived organizations');

-- Matching import restores UUIDs, including null UDOD numbers, and updates email.
select set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000001',true);
set local role authenticated;
insert into public.education_organizations (organization_type, number, alias, email, is_archived) values
 ('school','archive-test-1','Archive school','changed@example.invalid',false),
 ('school','archive-test-2','Archive school','two@example.invalid',false),
 ('udod',null,'Archive udod','udod-new@example.invalid',false)
on conflict (organization_type, number, alias) do update set email = excluded.email, is_archived = excluded.is_archived;
select pg_temp.assert_true((select count(*) = 3 and bool_and(not is_archived) from public.education_organizations where id::text like 'e2000000-%'), 'import restores original IDs, including UDOD');
select pg_temp.assert_true((select email = 'changed@example.invalid' from public.education_organizations where id = 'e2000000-0000-4000-8000-000000000001'), 'import updates email');
reset role;
select pg_temp.assert_true((select count(*) = 1 from public.list_missing_form_organizations('b2000000-0000-4000-8000-000000000001') where id::text like 'e2000000-%'), 'restored submitted organization still counted as submitted');
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select * from public.submit_form_response('b2000000-0000-4000-8000-000000000001',
 'd2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000002',
 '{"org":"e2000000-0000-4000-8000-000000000002"}');
reset role;
-- Repeated deletion remains harmless, and disabled sessions cannot read history.
delete from public.education_organizations where id::text like 'e2000000-%';
delete from public.education_organizations where id::text like 'e2000000-%';
select set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select pg_temp.assert_true((select count(*) = 0 from public.list_saved_form_organizations('b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001')), 'disabled session cannot read history even with browser capability');
reset role;
rollback;
