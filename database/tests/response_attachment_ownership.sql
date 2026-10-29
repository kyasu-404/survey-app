-- Run after 202610281600 on a disposable survey_personal_check_* database.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';
do $$ begin
  if current_database() not like 'survey_personal_check_%' then
    raise exception 'Requires a disposable survey_personal_check_* database';
  end if;
end $$;
create function pg_temp.expect_error(statement text, expected_state text default '22023') returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise;
  end;
  raise exception 'Expected rejection: %', statement;
end $$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('a7000000-0000-4000-8000-000000000001','attachment-owner@example.invalid','{}');
insert into public.education_organizations(id,organization_type,number,alias,email) values
 ('e7000000-0000-4000-8000-000000000001','school','attachment-1','School','attachment@example.invalid');
insert into public.forms(id,title,author_id,form_type,form_reason,schema,is_public,allow_response_editing) values
 ('b7000000-0000-4000-8000-000000000001','Attachment ownership','a7000000-0000-4000-8000-000000000001',
 'anketa','plan','{"elements":[{"type":"file","name":"upload"}]}',true,true),
 ('b7000000-0000-4000-8000-000000000002','Personal attachments','a7000000-0000-4000-8000-000000000001',
 'anketa','plan','{"elements":[{"type":"organization","name":"org"},{"type":"file","name":"upload"}]}',true,true);

create function pg_temp.submit_upload(browser_id uuid, path text) returns uuid language sql as $$
 select response_id from public.submit_form_response('b7000000-0000-4000-8000-000000000001',browser_id,gen_random_uuid(),
   jsonb_build_object('upload',jsonb_build_array(jsonb_build_object('content',path))));
$$;

-- A known, same-form object without a reservation is not an upload capability.
insert into storage.objects(bucket_id,name,metadata) values('survey-files',
 'public/b7000000-0000-4000-8000-000000000001/c7000000-0000-4000-8000-000000000001.pdf','{"size":1}');
set local role anon;
select pg_temp.expect_error($s$select pg_temp.submit_upload(gen_random_uuid(),
 'public/b7000000-0000-4000-8000-000000000001/c7000000-0000-4000-8000-000000000001.pdf')$s$);
reset role;

do $$ declare
  owner_browser uuid := gen_random_uuid();
  foreign_browser uuid := gen_random_uuid();
  path text;
  other_path text;
  response uuid;
begin
  path := public.reserve_survey_upload('b7000000-0000-4000-8000-000000000001',owner_browser,repeat('a',64),1,'.pdf');
  insert into storage.objects(bucket_id,name,metadata) values('survey-files',path,'{"size":1}');
  perform pg_temp.expect_error(format('select pg_temp.submit_upload(%L,%L)',foreign_browser,path));
  assert not (select attached from public.survey_upload_reservations where object_path=path), 'Foreign browser attached file';
  response := pg_temp.submit_upload(owner_browser,path);
  assert (select attached from public.survey_upload_reservations where object_path=path), 'Owner cannot attach';
  assert (select count(*)=1 from public.response_file_references where response_id=response and object_path=path);
  update public.survey_upload_reservations set expires_at=now()-interval '1 hour' where object_path=path;
  perform public.update_form_response('b7000000-0000-4000-8000-000000000001',owner_browser,response,
    jsonb_build_object('upload',jsonb_build_array(jsonb_build_object('path',path))));
  -- The worker eventually prunes even attached reservations; old answers stay editable.
  delete from public.survey_upload_reservations where object_path=path;
  perform public.update_form_response('b7000000-0000-4000-8000-000000000001',owner_browser,response,
    jsonb_build_object('upload',jsonb_build_array(jsonb_build_object('storagePath',path))));
  perform pg_temp.expect_error(format('select pg_temp.submit_upload(%L,%L)',foreign_browser,path));

  other_path := public.reserve_survey_upload('b7000000-0000-4000-8000-000000000001',foreign_browser,repeat('b',64),1,'.pdf');
  perform pg_temp.expect_error(format('select public.update_form_response(%L,%L,%L,%L::jsonb)',
    'b7000000-0000-4000-8000-000000000001',owner_browser,response,jsonb_build_object('upload',other_path)));
  assert (select count(*)=1 from public.response_file_references where response_id=response and object_path=path), 'Rejected edit removed original reference';
  update public.survey_upload_reservations set expires_at=now()-interval '1 hour' where object_path=other_path;
  perform pg_temp.expect_error(format('select pg_temp.submit_upload(%L,%L)',foreign_browser,other_path));
  update public.survey_upload_reservations set expires_at=now()+interval '1 hour',cleanup_claimed=true where object_path=other_path;
  perform pg_temp.expect_error(format('select pg_temp.submit_upload(%L,%L)',foreign_browser,other_path));
  perform public.update_form_response('b7000000-0000-4000-8000-000000000001',owner_browser,response,'{}');
  assert not exists(select 1 from public.response_file_references where response_id=response), 'Removed file kept its reference';
end $$;

-- Every representation, including nested strings, passes through the same guard.
do $$ declare browser uuid := gen_random_uuid(); own_path text; payload jsonb; begin
  own_path := public.reserve_survey_upload('b7000000-0000-4000-8000-000000000001',browser,repeat('c',64),1,'.pdf');
  payload := jsonb_build_object('upload',jsonb_build_array(jsonb_build_object('content',own_path),
    jsonb_build_object('nested',jsonb_build_object('path','public/b7000000-0000-4000-8000-000000000001/missing.pdf'))));
  perform pg_temp.expect_error(format('select public.submit_form_response(%L,%L,gen_random_uuid(),%L::jsonb)',
    'b7000000-0000-4000-8000-000000000001',browser,payload));
  assert not (select attached from public.survey_upload_reservations where object_path=own_path), 'Failed multi-file submission was not atomic';
  assert not exists(select 1 from public.responses where browser_id=public.browser_capability_hash(browser));
end $$;

-- Unreserved authenticated owner uploads remain valid, foreign owner paths fail.
insert into storage.objects(bucket_id,name,metadata) values('survey-files',
 'a7000000-0000-4000-8000-000000000001/b7000000-0000-4000-8000-000000000001/owned.pdf','{"size":1}');
select set_config('request.jwt.claim.sub','a7000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.submit_upload(gen_random_uuid(),
 'a7000000-0000-4000-8000-000000000001/b7000000-0000-4000-8000-000000000001/owned.pdf');
select pg_temp.expect_error($s$select pg_temp.submit_upload(gen_random_uuid(),
 'a7000000-0000-4000-8000-000000000099/b7000000-0000-4000-8000-000000000001/foreign.pdf')$s$);
reset role;

select public.set_form_personal_links('b7000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.sub','',true);
do $$ declare token uuid; uploader uuid := gen_random_uuid(); path text; draft_path text; result record; begin
  select l.token into token from public.form_personal_links l where l.form_id='b7000000-0000-4000-8000-000000000002'
    and organization_id='e7000000-0000-4000-8000-000000000001';
  path := public.reserve_personal_survey_upload('b7000000-0000-4000-8000-000000000002',uploader,repeat('d',64),1,'.pdf',token);
  insert into storage.objects(bucket_id,name,metadata) values('survey-files',path,'{"size":1}');
  assert public.can_restore_survey_upload(path,uploader), 'Personal upload lost its local browser owner';
  perform pg_temp.expect_error(format('select public.reserve_personal_survey_upload(%L,%L,%L,1,%L,%L)',
    'b7000000-0000-4000-8000-000000000002',uploader,repeat('d',64),'.pdf',gen_random_uuid()),'42501');
  -- Personal drafts uploaded before the upgrade need both capabilities to bind.
  draft_path := public.reserve_survey_upload('b7000000-0000-4000-8000-000000000002',uploader,repeat('d',64),1,'.pdf');
  assert not public.bind_personal_survey_upload('b7000000-0000-4000-8000-000000000002',token,gen_random_uuid(),draft_path);
  perform pg_temp.expect_error(format('select public.bind_personal_survey_upload(%L,%L,%L,%L)',
    'b7000000-0000-4000-8000-000000000002',gen_random_uuid(),uploader,draft_path),'42501');
  assert public.bind_personal_survey_upload('b7000000-0000-4000-8000-000000000002',token,uploader,draft_path);
  insert into storage.objects(bucket_id,name,metadata) values('survey-files',draft_path,'{"size":1}');
  select * into result from public.submit_personal_form_response('b7000000-0000-4000-8000-000000000002',token,gen_random_uuid(),
    jsonb_build_object('org','e7000000-0000-4000-8000-000000000001','upload',jsonb_build_array(path,draft_path)));
  assert result.status='submitted';
  -- Historical personal responses did not yet carry response_browser_hash.
  update public.survey_upload_reservations set response_browser_hash=null where object_path=path;
  perform public.update_personal_form_response('b7000000-0000-4000-8000-000000000002',token,result.response_id,
    jsonb_build_object('org','e7000000-0000-4000-8000-000000000001','upload',jsonb_build_array(path)));
  assert (select count(*)=1 from public.response_file_references where response_id=result.response_id);
end $$;
do $$ begin
  assert not has_function_privilege('anon','public.reserve_personal_survey_upload(uuid,uuid,text,bigint,text,uuid)','execute');
  assert not has_function_privilege('authenticated','public.bind_personal_survey_upload(uuid,uuid,uuid,text)','execute');
end $$;
rollback;
