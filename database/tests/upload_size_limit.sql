\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';
do $$ begin
  if current_database() not like 'survey_personal_check_%' then raise exception 'Disposable test database required'; end if;
end $$;

insert into auth.users(id,email) values
 ('a9800000-0000-4000-8000-000000000001','upload-size@example.invalid');
insert into public.forms(id,title,author_id,is_public,form_type,form_reason,schema) values
 ('b9800000-0000-4000-8000-000000000001','Upload size','a9800000-0000-4000-8000-000000000001',true,'anketa','plan',
 '{"pages":[{"elements":[{"type":"file","name":"attachment"}]}]}');

-- Legacy objects without a recorded size keep their previous quota accounting.
insert into storage.objects(bucket_id,name,metadata,user_metadata)
select 'survey-files','a9800000-0000-4000-8000-000000000001/b9800000-0000-4000-8000-000000000001/legacy-' || n || '.pdf',
  null,'{"questionName":"attachment","mimeType":"application/pdf"}'
from generate_series(1,41) as n;

do $$
declare
  form_id uuid := 'b9800000-0000-4000-8000-000000000001';
  browser_id uuid := gen_random_uuid();
  upload_path text;
begin
  assert (select file_size_limit = 52428800 from storage.buckets where id = 'survey-files'),
    'Storage bucket must allow 50 MiB';
  begin
    perform public.reserve_survey_upload(form_id,browser_id,repeat('a',64),52428801,'.pdf');
    raise exception 'Reservation accepted a file above 50 MiB';
  exception when invalid_parameter_value then null;
  end;
  upload_path := public.reserve_survey_upload(form_id,browser_id,repeat('a',64),52428800,'.pdf');
  assert (select size_bytes = 52428800 from public.survey_upload_reservations where object_path = upload_path);
  perform set_config('test.full_upload',upload_path,true);
  perform set_config('test.upload_browser',browser_id::text,true);
  perform public.reserve_survey_upload(form_id,browser_id,repeat('a',64),52428800,'.pdf');
  begin
    perform public.reserve_survey_upload(form_id,browser_id,repeat('a',64),1,'.pdf');
    raise exception 'Reservation exceeded the existing client byte budget';
  exception when sqlstate '54000' then null;
  end;
  upload_path := public.reserve_survey_upload(form_id,gen_random_uuid(),repeat('b',64),26214400,'.pdf');
  perform set_config('test.partial_upload',upload_path,true);
end $$;

set local role anon;
insert into storage.objects(bucket_id,name,metadata,user_metadata) values
 ('survey-files',current_setting('test.full_upload'),'{"size":52428800,"mimetype":"application/pdf"}','{"questionName":"attachment"}'),
 ('survey-files',current_setting('test.partial_upload'),null,'{"questionName":"attachment","mimeType":"application/pdf"}');
reset role;

do $$ begin
  begin
    update storage.objects set metadata = '{"size":26214401,"mimetype":"application/pdf"}'
      where bucket_id = 'survey-files' and name = current_setting('test.partial_upload');
    raise exception 'Storage accepted a file that exceeded its reservation';
  exception when invalid_parameter_value then null;
  end;
  assert (select status = 'submitted' from public.submit_form_response(
    'b9800000-0000-4000-8000-000000000001',current_setting('test.upload_browser')::uuid,gen_random_uuid(),
    jsonb_build_object('attachment',jsonb_build_array(jsonb_build_object('content',current_setting('test.full_upload'))))
  )), 'A 50 MiB attachment must remain usable in a submitted answer';
end $$;

select set_config('request.jwt.claim.sub','a9800000-0000-4000-8000-000000000001',true);
set local role authenticated;
insert into storage.objects(bucket_id,name,metadata,user_metadata) values
 ('survey-files','a9800000-0000-4000-8000-000000000001/b9800000-0000-4000-8000-000000000001/full.pdf',
  '{"size":52428800,"mimetype":"application/pdf"}','{"questionName":"attachment"}');
do $$ begin
  begin
    insert into storage.objects(bucket_id,name,metadata,user_metadata) values
     ('survey-files','a9800000-0000-4000-8000-000000000001/b9800000-0000-4000-8000-000000000001/over.pdf',
      '{"size":52428801,"mimetype":"application/pdf"}','{"questionName":"attachment"}');
    raise exception 'Storage accepted an authenticated upload above 50 MiB';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
