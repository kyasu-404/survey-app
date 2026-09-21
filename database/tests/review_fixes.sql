-- Run only on the isolated integration database; all fixture changes roll back.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid(); form_id uuid := gen_random_uuid();
  browser_a uuid := gen_random_uuid(); browser_b uuid := gen_random_uuid();
  file_path text; i integer; n integer; snapshot jsonb;
begin
  insert into auth.users(id,email,raw_user_meta_data) values(owner_id,'review@example.invalid','{}');
  insert into public.forms(id,title,author_id,is_public,form_type,form_reason,schema) values(form_id,'Review',owner_id,true,'anketa','plan','{"pages":[{"elements":[{"type":"file","name":"files"}]}]}');
  for i in 1..20 loop
    file_path := public.reserve_survey_upload(form_id,browser_a,repeat('a',64),1,'.txt');
    assert public.can_upload_survey_file(file_path,true,1);
    assert not public.can_upload_survey_file(file_path,true,2), 'Reservation must enforce declared size';
    insert into storage.objects(bucket_id,name,metadata) values('survey-files',file_path,'{"size":1}');
    begin
      update storage.objects set metadata='{"size":10485760}' where name=file_path;
      raise exception 'Expected actual size rejection even for service writes';
    exception when sqlstate '22023' then null; end;
  end loop;
  begin
    perform public.reserve_survey_upload(form_id,browser_a,repeat('a',64),1,'.txt');
    raise exception 'Expected per-browser rejection';
  exception when sqlstate '54000' then null; end;
  file_path := public.reserve_survey_upload(form_id,browser_b,repeat('b',64),1,'.txt');
  assert public.can_upload_survey_file(file_path,true,1), 'Another visitor must still upload';
  assert not public.can_upload_survey_file('public/'||form_id||'/'||gen_random_uuid()||'.txt',true,1), 'Direct anonymous upload cannot bypass reservation';
  insert into storage.objects(bucket_id,name,metadata) values('survey-files',file_path,'{"size":1}');
  perform public.submit_form_response(form_id,browser_b,gen_random_uuid(),jsonb_build_object('files',jsonb_build_array(jsonb_build_object('name','file.txt','content',file_path))));
  update public.survey_upload_reservations u set expires_at=now()-interval '1 hour' where u.form_id in (select id from public.forms where title='Review');
  select count(*) into n from public.list_expired_survey_uploads(100);
  assert n = 20, 'Attached file must survive expiry cleanup';
  assert not has_function_privilege('anon','public.reserve_survey_upload(uuid,uuid,text,bigint,text)','execute');
  assert not has_table_privilege('anon','public.survey_upload_reservations','select');

end $$;
rollback;

begin;
do $$
declare
  owner_id uuid := gen_random_uuid(); target_id uuid := gen_random_uuid();
  organization_form uuid := gen_random_uuid(); n integer; payload jsonb;
begin
  insert into auth.users(id,email,raw_user_meta_data) values(owner_id,'scale-review@example.invalid','{}');
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.forms(id,title,author_id,is_public,form_type,form_reason,schema)
    values(target_id,'Scale review',owner_id,true,'anketa','plan','{"pages":[{"elements":[{"type":"text","name":"answer"}]}]}');
  insert into public.responses(form_id,data)
    select target_id,jsonb_build_object('answer',g) from generate_series(1,10001) g;
  select count(*) into n from (select id from public.responses where form_id=target_id order by created_at desc,id desc limit 50) page;
  assert n=50, 'Browsing must stay bounded above 10000 answers';
  begin
    perform public.export_form_responses(target_id);
    raise exception 'Expected bounded export rejection';
  exception when sqlstate '54000' then null; end;
  select public.export_form_responses(target_id,array(select id from public.responses where form_id=target_id limit 50)) into payload;
  assert jsonb_array_length(payload)=50;
  assert not (payload->0 ? 'browser_id'), 'Browser capability must never be exported';
  insert into public.forms(id,title,author_id,is_public,form_type,form_reason,schema)
    values(organization_form,'Reminder review',owner_id,true,'anketa','plan','{"pages":[{"elements":[{"type":"organization","name":"org"}]}]}');
  insert into public.education_organizations(organization_type,number,alias,email)
    select 'school',g::text,'Review '||g,'review'||g||'@example.invalid' from generate_series(1,1001) g;
  select jsonb_array_length(public.list_missing_form_organizations_snapshot(organization_form)) into n;
  assert n >= 1001, 'A scalar snapshot must preserve more than 1000 recipients';
  assert not has_function_privilege('authenticated','public.list_missing_form_organizations_snapshot(uuid)','execute');
end $$;
rollback;
