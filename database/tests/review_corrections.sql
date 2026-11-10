\set ON_ERROR_STOP on
begin;
set local statement_timeout = '60s';
do $$ begin
  if current_database() not like 'survey_personal_check_%' then raise exception 'Disposable test database required'; end if;
end $$;

insert into auth.users(id, email) values
  ('aa100000-0000-4000-8000-000000000001', 'review-owner@example.invalid'),
  ('aa100000-0000-4000-8000-000000000002', 'review-stranger@example.invalid');
select set_config('request.jwt.claim.sub', 'aa100000-0000-4000-8000-000000000001', true);
insert into public.forms(id,title,author_id,form_type,form_reason,schema,is_public,deadline_at,max_responses) values
  ('bb100000-0000-4000-8000-000000000001','Active','aa100000-0000-4000-8000-000000000001','anketa','plan','{"pages":[]}',true,null,null),
  ('bb100000-0000-4000-8000-000000000002','At limit','aa100000-0000-4000-8000-000000000001','anketa','plan','{"pages":[]}',true,null,1),
  ('bb100000-0000-4000-8000-000000000003','Expired','aa100000-0000-4000-8000-000000000001','anketa','plan','{"pages":[]}',true,now()-interval '1 day',null);
-- Model legacy/imported counters. Normal submissions also close is_public.
update public.forms set responses_count = 1 where id = 'bb100000-0000-4000-8000-000000000002';

set local role authenticated;
do $$ declare result record; begin
  select * into result from public.get_dashboard_forms_stats(p_author_id => 'aa100000-0000-4000-8000-000000000001');
  assert result.total_count = 3 and result.active_count = 1;
  assert (select count(*) = 1 from public.list_forms_by_activity(true) where author_id = 'aa100000-0000-4000-8000-000000000001');
  assert (select count(*) = 2 from public.list_forms_by_activity(false) where author_id = 'aa100000-0000-4000-8000-000000000001');
  assert (select count(*) = 1 from public.list_forms_sorted(p_is_public => true, p_author_id => 'aa100000-0000-4000-8000-000000000001'));
  assert (select count(*) = 2 from public.list_forms_sorted(p_is_public => false, p_author_id => 'aa100000-0000-4000-8000-000000000001'));
  select * into result from public.get_dashboard_forms_stats(p_is_public => false, p_author_id => 'aa100000-0000-4000-8000-000000000001');
  assert result.total_count = 2 and result.active_count = 0;
  assert not has_function_privilege('authenticated','public.delete_form_with_files(uuid,uuid)','execute');
  assert not has_function_privilege('anon','public.delete_form_with_files(uuid,uuid)','execute');
end $$;
reset role;

insert into public.forms(id,title,author_id,form_type,form_reason,schema) values
  ('bb100000-0000-4000-8000-000000000004','Many files','aa100000-0000-4000-8000-000000000001','anketa','plan',
    '{"pages":[{"elements":[{"type":"file","name":"upload"}]}]}');

do $$ declare payload jsonb; result jsonb; batch integer; doc_path text := 'forms/bb100000-0000-4000-8000-000000000004/documents/test.docx'; begin
  insert into storage.objects(bucket_id,name,metadata)
    select 'survey-files', 'aa100000-0000-4000-8000-000000000001/bb100000-0000-4000-8000-000000000004/'||g||'.pdf','{"size":1}'::jsonb
    from generate_series(1,1025) g;
  for batch in 0..40 loop
    select jsonb_build_object('upload', jsonb_agg(jsonb_build_object('content',
      'aa100000-0000-4000-8000-000000000001/bb100000-0000-4000-8000-000000000004/'||g||'.pdf')))
    into payload from generate_series(batch*25+1,batch*25+25) g;
    perform public.submit_form_response('bb100000-0000-4000-8000-000000000004',gen_random_uuid(),gen_random_uuid(),payload);
  end loop;
  assert (select count(*) = 1025 from public.response_file_references where form_id = 'bb100000-0000-4000-8000-000000000004');
  begin
    perform public.delete_form_with_files('bb100000-0000-4000-8000-000000000004','aa100000-0000-4000-8000-000000000002');
    raise exception 'Another employee deleted a form';
  exception when insufficient_privilege then null; end;
  update public.profiles set is_disabled = true where id = 'aa100000-0000-4000-8000-000000000001';
  begin
    perform public.delete_form_with_files('bb100000-0000-4000-8000-000000000004','aa100000-0000-4000-8000-000000000001');
    raise exception 'Disabled employee deleted a form';
  exception when insufficient_privilege then null; end;
  update public.profiles set is_disabled = false where id = 'aa100000-0000-4000-8000-000000000001';
  insert into public.office_documents(form_id,name,storage_path,size_bytes,created_by)
    values('bb100000-0000-4000-8000-000000000004','Template.docx',doc_path,1,'aa100000-0000-4000-8000-000000000001');
  result := public.delete_form_with_files('bb100000-0000-4000-8000-000000000004','aa100000-0000-4000-8000-000000000001');
  assert jsonb_array_length(result->'objectPaths') = 1025, 'Deletion lost paths at a REST row cap';
  assert (select count(*) = 1025 from public.survey_file_deletion_claims where split_part(object_path,'/',2) = 'bb100000-0000-4000-8000-000000000004');
  assert not exists(select 1 from public.forms where id = 'bb100000-0000-4000-8000-000000000004');
  assert not exists(select 1 from public.response_file_references where form_id = 'bb100000-0000-4000-8000-000000000004');
  assert exists(select 1 from public.office_storage_cleanup where storage_path = doc_path), 'Office cleanup was not queued';
end $$;

-- A failure of profile persistence rolls back the Auth write in the same RPC.
update public.profiles set role = 'admin' where id = 'aa100000-0000-4000-8000-000000000001';
update auth.users set banned_until = now() + interval '1 hour' where id = 'aa100000-0000-4000-8000-000000000002';
create function pg_temp.reject_status_update() returns trigger language plpgsql as $$
begin raise exception 'Injected profile failure' using errcode = 'P0001'; end;
$$;
create trigger test_reject_status_update before update of is_disabled on public.profiles
  for each row when (new.id = 'aa100000-0000-4000-8000-000000000002'::uuid)
  execute function pg_temp.reject_status_update();
do $$ declare original_ban timestamptz; begin
  select banned_until into original_ban from auth.users where id = 'aa100000-0000-4000-8000-000000000002';
  begin
    perform public.set_employee_disabled('aa100000-0000-4000-8000-000000000002',true,'aa100000-0000-4000-8000-000000000001');
    raise exception 'Expected profile failure' using errcode = 'XX001';
  exception when sqlstate 'P0001' then null; end;
  assert (select banned_until = original_ban from auth.users where id = 'aa100000-0000-4000-8000-000000000002');
  assert (select not is_disabled from public.profiles where id = 'aa100000-0000-4000-8000-000000000002');
  assert not has_function_privilege('authenticated','public.set_employee_disabled(uuid,boolean,uuid)','execute');
  assert not has_function_privilege('anon','public.set_employee_disabled(uuid,boolean,uuid)','execute');
end $$;
drop trigger test_reject_status_update on public.profiles;
select public.set_employee_disabled('aa100000-0000-4000-8000-000000000002',true,'aa100000-0000-4000-8000-000000000001');
do $$ begin
  assert (select is_disabled from public.profiles where id = 'aa100000-0000-4000-8000-000000000002');
  assert (select banned_until > now() + interval '99 years' from auth.users where id = 'aa100000-0000-4000-8000-000000000002');
  begin
    perform public.set_employee_disabled('aa100000-0000-4000-8000-000000000002',false,'aa100000-0000-4000-8000-000000000002');
    raise exception 'Self change was accepted';
  exception when insufficient_privilege then null; end;
end $$;
select public.set_employee_disabled('aa100000-0000-4000-8000-000000000002',false,'aa100000-0000-4000-8000-000000000001');
do $$ begin
  assert (select not is_disabled from public.profiles where id = 'aa100000-0000-4000-8000-000000000002');
  assert (select banned_until is null from auth.users where id = 'aa100000-0000-4000-8000-000000000002');
end $$;
rollback;
