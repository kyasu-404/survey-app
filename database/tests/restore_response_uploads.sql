begin;
do $$
declare
  owner_id uuid := gen_random_uuid(); form_id uuid := gen_random_uuid();
  browser_id uuid := gen_random_uuid(); file_path text;
begin
  insert into auth.users(id,email,raw_user_meta_data) values(owner_id,owner_id||'@example.invalid','{}');
  insert into public.forms(id,title,author_id,is_public,form_type,form_reason,schema)
    values(form_id,'Restore regression',owner_id,true,'anketa','plan','{"pages":[{"elements":[{"type":"file","name":"file"}]}]}');
  file_path := public.reserve_survey_upload(form_id,browser_id,repeat('e',64),1,'.txt');
  assert not public.can_restore_survey_upload(file_path,browser_id), 'Incomplete uploads cannot be read';
  insert into storage.objects(bucket_id,name,metadata) values('survey-files',file_path,'{"size":1}');
  assert public.can_restore_survey_upload(file_path,browser_id), 'Owner cannot restore upload';
  assert not public.can_restore_survey_upload(file_path,gen_random_uuid()), 'Another browser can read a private upload';
  assert not public.can_restore_survey_upload(file_path,null), 'Missing capability can read a private upload';
  assert not public.can_restore_survey_upload(file_path||'x',browser_id), 'Wrong path accepted';
  assert not has_function_privilege('anon','public.can_restore_survey_upload(text,uuid)','execute');
  assert not has_function_privilege('authenticated','public.can_restore_survey_upload(text,uuid)','execute');
  update public.survey_upload_reservations set expires_at=now()-interval '1 hour' where object_path=file_path;
  assert not public.can_restore_survey_upload(file_path,browser_id), 'Expired draft file accepted';
  update public.survey_upload_reservations set attached=true where object_path=file_path;
  assert public.can_restore_survey_upload(file_path,browser_id), 'Submitted file no longer accessible to owner';
  update public.survey_upload_reservations set cleanup_claimed=true where object_path=file_path;
  assert not public.can_restore_survey_upload(file_path,browser_id), 'File claimed for cleanup accepted';
  raise notice 'Draft upload restoration: ownership, expiry and permissions passed';
end $$;
rollback;
