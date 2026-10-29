\set ON_ERROR_STOP on
begin;
set local statement_timeout='60s';
do $$ begin
  if current_database() not like 'survey_personal_check_%' then raise exception 'Disposable test database required'; end if;
end $$;
create function pg_temp.reject(statement text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when sqlstate '22023' then return; end;
  raise exception 'Expected invalid answer rejection: %',statement;
end;
$$;
insert into auth.users(id,email,raw_user_meta_data) values
 ('a9600000-0000-4000-8000-000000000001','review-fixes@example.invalid','{}');
insert into public.forms(id,title,author_id,form_type,form_reason,schema,is_public,allow_response_editing) values
 ('b9600000-0000-4000-8000-000000000001','Scalar review fixes','a9600000-0000-4000-8000-000000000001','anketa','plan',
 '{"pages":[{"elements":[{"type":"paneldynamic","name":"p","templateElements":[{"type":"signaturepad","name":"sig"}]},{"type":"text","inputType":"number","name":"n"},{"type":"boolean","name":"flag","valueTrue":{"custom":"yes"}}]}]}',true,true),
 ('b9600000-0000-4000-8000-000000000002','Files review fixes','a9600000-0000-4000-8000-000000000001','anketa','plan',
 '{"pages":[{"elements":[{"type":"file","name":"upload"}]}]}',true,true),
 ('b9600000-0000-4000-8000-000000000003','Matrix file review fixes','a9600000-0000-4000-8000-000000000001','anketa','plan',
 '{"pages":[{"elements":[{"type":"matrixdynamic","name":"m","cellType":"file","columns":[{"name":"files","cellType":"default"}],"detailElements":[{"type":"file","name":"details"}]}]}]}',true,true);

-- Both the early RPC validator and the trigger enforce scalar shapes.
set local role anon;
select pg_temp.reject($s$select public.submit_form_response('b9600000-0000-4000-8000-000000000001',gen_random_uuid(),gen_random_uuid(),
 '{"p":[{"sig":{"toString":"x"}}]}')$s$);
select pg_temp.reject($s$select public.submit_form_response('b9600000-0000-4000-8000-000000000001',gen_random_uuid(),gen_random_uuid(),
 '{"n":{"toString":"x"}}')$s$);
select public.submit_form_response('b9600000-0000-4000-8000-000000000001',gen_random_uuid(),gen_random_uuid(),
 '{"p":[{"sig":"data:image/png;base64,fixture"}],"n":"1.5","flag":{"custom":"yes"}}');
reset role;

do $$ declare
 browser uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); path text; other_path text; result record; url text;
begin
 path:=public.reserve_survey_upload('b9600000-0000-4000-8000-000000000002',browser,repeat('f',64),1,'.pdf');
 insert into storage.objects(bucket_id,name,metadata) values('survey-files',path,'{"size":1}');
 url:='https://api.test/api/storage/v1/object/sign/survey-files/'||replace(path,'/','%2F')||'?token=old';
 perform pg_temp.reject(format('select public.submit_form_response(%L,%L,gen_random_uuid(),%L::jsonb)',
  'b9600000-0000-4000-8000-000000000002',stranger,jsonb_build_object('upload',jsonb_build_array(jsonb_build_object('content',url)))));
 perform pg_temp.reject(format('select public.submit_form_response(%L,%L,gen_random_uuid(),%L::jsonb)',
  'b9600000-0000-4000-8000-000000000003',browser,jsonb_build_object('m',jsonb_build_array(jsonb_build_object('files',jsonb_build_array(path))))));
 select * into result from public.submit_form_response('b9600000-0000-4000-8000-000000000002',browser,gen_random_uuid(),
  jsonb_build_object('upload',jsonb_build_array(jsonb_build_object('name','file.pdf','storagePath',path,'content',url))));
 assert result.status='submitted';
 assert result.response_data #>> '{upload,0,content}'=path, 'Storage URL was not normalized';
 assert (select count(*)=1 from public.response_file_references where response_id=result.response_id and object_path=path);
 assert public.claim_survey_file_deletions(array[path])='[]'::jsonb,'Attached file claimed for deletion';
 update public.survey_upload_reservations set expires_at=now()-interval '9 days' where object_path=path;
 delete from public.survey_upload_reservations where object_path=path;
 assert public.can_restore_survey_upload(path,browser),'Original browser lost submitted file after pruning';
 assert not public.can_restore_survey_upload(path,stranger),'Another browser restored file';
 perform public.update_form_response('b9600000-0000-4000-8000-000000000002',browser,result.response_id,'{}');
 assert public.claim_survey_file_deletions(array[path]) ? path;
 perform pg_temp.reject(format('select public.update_form_response(%L,%L,%L,%L::jsonb)',
  'b9600000-0000-4000-8000-000000000002',browser,result.response_id,jsonb_build_object('upload',path)));

 -- Matrix cells and expanded detail questions use the same ownership boundary.
 other_path:=public.reserve_survey_upload('b9600000-0000-4000-8000-000000000003',browser,repeat('e',64),1,'.pdf');
 insert into storage.objects(bucket_id,name,metadata) values('survey-files',other_path,'{"size":1}');
 perform pg_temp.reject(format('select public.submit_form_response(%L,%L,gen_random_uuid(),%L::jsonb)',
  'b9600000-0000-4000-8000-000000000003',stranger,jsonb_build_object('m',jsonb_build_array(jsonb_build_object('files',jsonb_build_array(jsonb_build_object('content',
  'https://api.test/storage/v1/object/public/survey-files/'||other_path)))))));
 select * into result from public.submit_form_response('b9600000-0000-4000-8000-000000000003',browser,gen_random_uuid(),
  jsonb_build_object('m',jsonb_build_array(jsonb_build_object('files',jsonb_build_array(other_path),'details',jsonb_build_object('path',other_path)))));
 assert (select count(*)=1 from public.response_file_references where response_id=result.response_id);
 perform pg_temp.reject(format('select public.update_form_response(%L,%L,%L,%L::jsonb)',
  'b9600000-0000-4000-8000-000000000003',browser,result.response_id,
  jsonb_build_object('m',jsonb_build_array(jsonb_build_object('files',jsonb_build_object('path',other_path,'content',path))))));
end $$;

-- A scalar RPC response does not lose shared-reference rows at a REST row cap.
select set_config('request.jwt.claim.sub','a9600000-0000-4000-8000-000000000001',true);
do $$ declare paths text[]; payload jsonb; selected uuid[]:='{}'; id uuid; result jsonb; i integer;
begin
 select array_agg('a9600000-0000-4000-8000-000000000001/b9600000-0000-4000-8000-000000000002/'||g||'.pdf')
 into paths from generate_series(1,25) g;
 insert into storage.objects(bucket_id,name,metadata) select 'survey-files',p,'{"size":1}' from unnest(paths) p;
 select jsonb_build_object('upload',jsonb_agg(jsonb_build_object('content',p))) into payload from unnest(paths) p;
 for i in 1..51 loop
  select response_id into id from public.submit_form_response('b9600000-0000-4000-8000-000000000002',gen_random_uuid(),gen_random_uuid(),payload);
  if i<=50 then selected:=array_append(selected,id); end if;
 end loop;
 result:=public.delete_form_responses_with_files('b9600000-0000-4000-8000-000000000002',selected,'a9600000-0000-4000-8000-000000000001');
 assert result->>'deletedResponses'='50';
 assert result->'objectPaths'='[]'::jsonb,'Shared attachments were scheduled for deletion';
 assert (select count(*)=25 from public.response_file_references where response_id=id);
 result:=public.delete_form_responses_with_files('b9600000-0000-4000-8000-000000000002',array[id],'a9600000-0000-4000-8000-000000000001');
 assert jsonb_array_length(result->'objectPaths')=25,'Last reference deletion did not claim files';
 assert (select count(*)=25 from public.survey_file_deletion_claims where object_path=any(paths));
end $$;

do $$ declare path text:='a9600000-0000-4000-8000-000000000001/b9600000-0000-4000-8000-000000000002/direct-delete.pdf';
begin
 insert into storage.objects(bucket_id,name,metadata) values('survey-files',path,'{"size":1}');
 assert public.can_delete_survey_file(path);
 assert exists(select 1 from public.survey_file_deletion_claims where object_path=path),'Direct Storage delete did not claim';
 perform pg_temp.reject(format('select public.submit_form_response(%L,gen_random_uuid(),gen_random_uuid(),%L::jsonb)',
  'b9600000-0000-4000-8000-000000000002',jsonb_build_object('upload',path)));
 perform set_config('request.jwt.claim.sub','a9600000-0000-4000-8000-000000000001',true);
 execute 'set local role authenticated';
 delete from storage.objects where bucket_id='survey-files' and name=path;
 execute 'reset role';
 assert not exists(select 1 from storage.objects where bucket_id='survey-files' and name=path),'Storage RLS deletion failed';
 assert not has_column_privilege('anon','public.responses','data','INSERT');
 assert not has_column_privilege('authenticated','public.responses','data','INSERT');
 assert not has_function_privilege('anon','public.claim_survey_file_deletions(text[])','EXECUTE');
 assert not has_function_privilege('authenticated','public.delete_form_responses_with_files(uuid,uuid[],uuid)','EXECUTE');
end $$;
do $$ declare rev bigint; begin
 select revision into rev from public.forms where id='b9600000-0000-4000-8000-000000000001';
 update public.forms set responses_count=responses_count+1 where id='b9600000-0000-4000-8000-000000000001';
 assert (select revision=rev from public.forms where id='b9600000-0000-4000-8000-000000000001');
 update public.forms set title='Revision changed' where id='b9600000-0000-4000-8000-000000000001';
 assert (select revision=rev+1 from public.forms where id='b9600000-0000-4000-8000-000000000001');
end $$;
rollback;
