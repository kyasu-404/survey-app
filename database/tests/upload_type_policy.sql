\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';
do $$ begin
  if current_database() not like 'survey_personal_check_%' then raise exception 'Disposable test database required'; end if;
end $$;

create function pg_temp.reject_upload(statement text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when sqlstate '22023' then return; end;
  raise exception 'Expected author file-type rejection: %', statement;
end;
$$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('a9700000-0000-4000-8000-000000000001','upload-types@example.invalid','{}');
insert into public.forms(id,title,author_id,is_public,allow_response_editing,form_type,form_reason,schema) values
 ('b9700000-0000-4000-8000-000000000001','Upload types','a9700000-0000-4000-8000-000000000001',true,true,'anketa','plan',
 '{"pages":[{"elements":[{"type":"file","name":"any"},{"type":"panel","name":"section","elements":[
 {"type":"paneldynamic","name":"people","valueName":"entries","templateElements":[{"type":"file","name":"document","valueName":"proof","acceptedTypes":".pdf"}]},
 {"type":"file","name":"photo","acceptedTypes":"image/*"},{"type":"file","name":"pdfMime","acceptedTypes":["application/pdf"]},
 {"type":"file","name":"documents","acceptedCategories":["document"]},
 {"type":"matrixdynamic","name":"matrix","cellType":"file","columns":[{"name":"cell","acceptedTypes":".txt"}]}]}]}]}'),
 ('b9700000-0000-4000-8000-000000000002','Unrestricted uploads','a9700000-0000-4000-8000-000000000001',true,true,'anketa','plan',
 '{"elements":[{"type":"file","name":"anything"}]}'),
 ('b9700000-0000-4000-8000-000000000003','Repeated template names','a9700000-0000-4000-8000-000000000001',true,true,'anketa','plan',
 '{"pages":[{"elements":[
 {"type":"paneldynamic","name":"documents","templateElements":[{"type":"file","name":"attachment","acceptedTypes":".pdf"}]},
 {"type":"paneldynamic","name":"pictures","templateElements":[{"type":"file","name":"attachment","acceptedTypes":".png"}]}]}]}'),
 ('b9700000-0000-4000-8000-000000000004','Stored signature','a9700000-0000-4000-8000-000000000001',true,true,'anketa','plan',
 '{"pages":[{"elements":[{"type":"signaturepad","name":"signature","storeDataAsText":false}]}]}');

-- Signature questions use the same SurveyJS upload event when stored remotely.
do $$ declare path text; browser uuid:=gen_random_uuid(); begin
 perform public.assert_survey_upload_type('b9700000-0000-4000-8000-000000000004','signature','signature.png','image/png');
 path:=public.reserve_survey_upload('b9700000-0000-4000-8000-000000000004',browser,repeat('c',64),1,'.png');
 insert into storage.objects(bucket_id,name,metadata,user_metadata) values('survey-files',path,
  '{"size":1,"mimetype":"image/png"}','{"questionName":"signature","fileName":"signature.png","mimeType":"image/png"}');
 assert exists(select 1 from storage.objects where bucket_id='survey-files' and name=path), 'Stored signature upload was rejected';
end $$;

-- The client canonicalizes only the suffix used for its opaque object name;
-- an unrestricted author's policy must still accept the original filename.
do $$ declare fixture record; path text; begin
 for fixture in select * from (values
  ('config.json.bak~','.bak'),('report.данные',''),('name.1234567890123','')
 ) f(file_name,extension) loop
  path:=public.reserve_survey_upload('b9700000-0000-4000-8000-000000000002',gen_random_uuid(),repeat('d',64),1,fixture.extension);
  insert into storage.objects(bucket_id,name,metadata,user_metadata) values('survey-files',path,
   '{"size":1,"mimetype":"application/octet-stream"}',jsonb_build_object('questionName','anything','fileName',fixture.file_name,'mimeType','application/octet-stream'));
 end loop;
 -- A caller cannot claim .pdf while writing an actual .exe object, even for an
 -- unrestricted question. Legacy objects without original-name metadata remain valid.
 path:=public.reserve_survey_upload('b9700000-0000-4000-8000-000000000002',gen_random_uuid(),repeat('d',64),1,'.exe');
 perform pg_temp.reject_upload(format('insert into storage.objects(bucket_id,name,metadata,user_metadata) values(''survey-files'',%L,''{"size":1}'',''{"questionName":"anything","fileName":"report.pdf"}'')',path));
 path:=public.reserve_survey_upload('b9700000-0000-4000-8000-000000000002',gen_random_uuid(),repeat('d',64),1,'.1234567890123');
 insert into storage.objects(bucket_id,name,metadata) values('survey-files',path,'{"size":1}');
 -- Canonicalization must not silently make .pdf~ match the author's .pdf rule.
 path:=public.reserve_survey_upload('b9700000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('d',64),1,'.pdf');
 perform pg_temp.reject_upload(format('insert into storage.objects(bucket_id,name,metadata,user_metadata) values(''survey-files'',%L,''{"size":1}'',''{"questionName":"document","fileName":"report.pdf~"}'')',path));
end $$;

-- SurveyJS emits the same local question name for both repeated templates.
-- Upload preparation may accept either candidate, while the response must still
-- obey the policy of the exact template receiving each attachment.
do $$ declare pdf_path text; png_path text; browser uuid:=gen_random_uuid(); response record; begin
 perform public.assert_survey_upload_type('b9700000-0000-4000-8000-000000000003','attachment','.pdf','application/pdf');
 perform public.assert_survey_upload_type('b9700000-0000-4000-8000-000000000003','attachment','.png','image/png');
 pdf_path:=public.reserve_survey_upload('b9700000-0000-4000-8000-000000000003',browser,repeat('b',64),1,'.pdf');
 png_path:=public.reserve_survey_upload('b9700000-0000-4000-8000-000000000003',browser,repeat('b',64),1,'.png');
 insert into storage.objects(bucket_id,name,metadata,user_metadata) values
  ('survey-files',pdf_path,'{"size":1,"mimetype":"application/pdf"}','{"questionName":"attachment","mimeType":"application/pdf"}'),
  ('survey-files',png_path,'{"size":1,"mimetype":"image/png"}','{"questionName":"attachment","mimeType":"image/png"}');
 perform pg_temp.reject_upload(format('select public.submit_form_response(%L,%L,gen_random_uuid(),%L::jsonb)',
  'b9700000-0000-4000-8000-000000000003',browser,jsonb_build_object('pictures',jsonb_build_array(jsonb_build_object('attachment',pdf_path)))));
 perform pg_temp.reject_upload(format('select public.submit_form_response(%L,%L,gen_random_uuid(),%L::jsonb)',
  'b9700000-0000-4000-8000-000000000003',browser,jsonb_build_object('documents',jsonb_build_array(jsonb_build_object('attachment',png_path)))));
 select * into response from public.submit_form_response('b9700000-0000-4000-8000-000000000003',browser,gen_random_uuid(),
  jsonb_build_object('documents',jsonb_build_array(jsonb_build_object('attachment',pdf_path)),
   'pictures',jsonb_build_array(jsonb_build_object('attachment',png_path))));
 assert response.status='submitted', 'Valid attachments sharing template question names were rejected';
 assert (select count(*)=2 from public.response_file_references where response_id=response.response_id), 'Repeated template attachments were not bound';
end $$;

-- Exercise real Storage writes before testing helpers. Client-side filtering and
-- the anonymous reservation RPC must not be the only enforcement boundary.
do $$ declare path text; begin
 path:=public.reserve_survey_upload('b9700000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64),1,'.exe');
 perform pg_temp.reject_upload(format('insert into storage.objects(bucket_id,name,metadata,user_metadata) values(''survey-files'',%L,''{"size":1,"mimetype":"application/pdf"}'',''{"questionName":"document","mimeType":"application/pdf"}'')',path));
end $$;

do $$ begin
 assert public.survey_question_upload_type_allowed('{"acceptedTypes":".pdf"}','report.PDF','application/octet-stream');
 assert not public.survey_question_upload_type_allowed('{"acceptedTypes":".pdf"}','program.exe','application/pdf');
 assert public.survey_question_upload_type_allowed('{"acceptedTypes":"image/*"}','picture.png','image/png');
 assert public.survey_question_upload_type_allowed('{"acceptedTypes":"image/*"}','picture.svg','image/svg+xml'), 'Author image wildcard must retain SVG support';
 assert public.survey_question_upload_type_allowed('{"acceptedTypes":"image/*"}','icon.ico','image/x-icon');
 assert public.survey_question_upload_type_allowed('{"acceptedTypes":"audio/*"}','recording.flac','audio/flac');
 assert public.survey_question_upload_type_allowed('{"acceptedTypes":"audio/*"}','recording.aac','audio/aac');
 assert public.survey_question_upload_type_allowed('{"acceptedTypes":"audio/*"}','recording.wma','audio/x-ms-wma');
 assert public.survey_question_upload_type_allowed('{"acceptedTypes":"video/*"}','recording.avi','video/x-msvideo');
 assert public.survey_question_upload_type_allowed('{"acceptedTypes":"video/*"}','recording.mkv','video/x-matroska');
 assert not public.survey_question_upload_type_allowed('{"acceptedTypes":"image/*"}','program.exe','image/png');
 assert public.survey_question_upload_type_allowed('{"acceptedTypes":"image/x-invented"}','custom.asset','image/x-invented'), 'An author may explicitly allow a custom MIME';
 assert public.survey_question_upload_type_allowed('{"acceptedTypes":"application/pdf"}','report.pdf','application/pdf');
 assert not public.survey_question_upload_type_allowed('{"acceptedTypes":"application/pdf"}','program.exe','application/pdf');
 assert not public.survey_question_upload_type_allowed('{"acceptedTypes":"application/pdf"}','report.pdf','text/html');
 assert public.survey_question_upload_type_allowed('{"acceptedTypes":[".docx",".xlsx"]}','book.xlsx','application/zip');
 assert public.survey_question_upload_type_allowed('{"acceptedCategories":["document"]}','report.pdf','application/pdf');
 assert not public.survey_question_upload_type_allowed('{"acceptedCategories":["document"]}','program.exe','application/pdf');
 assert public.survey_question_upload_type_allowed('{}','program.exe','application/x-msdownload'), 'No author restriction means any type';
 assert not has_function_privilege('anon','public.assert_survey_upload_type(uuid,text,text,text)','execute');
 assert not has_function_privilege('authenticated','public.assert_survey_upload_type(uuid,text,text,text)','execute');
end $$;

-- Anonymous reservations remain subject to the persisted nested question rules.
do $$ declare path text; begin
 path:=public.reserve_survey_upload('b9700000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64),1,'.pdf');
 insert into storage.objects(bucket_id,name,metadata,user_metadata) values('survey-files',path,'{"size":1,"mimetype":"application/pdf"}','{"questionName":"proof","mimeType":"application/pdf"}');
 perform public.assert_survey_upload_type('b9700000-0000-4000-8000-000000000001','document','.pdf','application/pdf');
 perform pg_temp.reject_upload($s$select public.assert_survey_upload_type('b9700000-0000-4000-8000-000000000001','document','.exe','application/pdf')$s$);
 perform pg_temp.reject_upload($s$select public.assert_survey_upload_type('b9700000-0000-4000-8000-000000000001','unknown','.pdf','application/pdf')$s$);
 perform pg_temp.reject_upload($s$select public.assert_survey_upload_type('b9700000-0000-4000-8000-000000000001',null,'.exe','application/pdf')$s$);
 perform public.assert_survey_upload_type('b9700000-0000-4000-8000-000000000002',null,'.exe','application/x-msdownload');
end $$;

-- Authenticated uploads bypass reservations but must obey the same author rule.
select set_config('request.jwt.claim.sub','a9700000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.reject_upload($s$insert into storage.objects(bucket_id,name,metadata,user_metadata) values('survey-files',
 'a9700000-0000-4000-8000-000000000001/b9700000-0000-4000-8000-000000000001/wrong.exe',
 '{"size":1,"mimetype":"application/pdf"}','{"questionName":"pdfMime","mimeType":"application/pdf"}')$s$);
insert into storage.objects(bucket_id,name,metadata,user_metadata) values('survey-files',
 'a9700000-0000-4000-8000-000000000001/b9700000-0000-4000-8000-000000000001/report.pdf',
 '{"size":1,"mimetype":"application/pdf"}','{"questionName":"pdfMime","mimeType":"application/pdf"}');
reset role;
select set_config('request.jwt.claim.sub','',true);

-- Storage first authorizes a placeholder, then writes its detected MIME as the
-- service role. The final write must reject MIME and question metadata changes.
do $$ declare path text; begin
 path:=public.reserve_survey_upload('b9700000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64),1,'.png');
 insert into storage.objects(bucket_id,name,metadata,user_metadata) values('survey-files',path,null,'{"questionName":"photo","mimeType":"image/png"}');
 perform pg_temp.reject_upload(format('update storage.objects set metadata=''{"size":1,"mimetype":"text/html"}'' where name=%L',path));
 update storage.objects set metadata='{"size":1,"mimetype":"image/png"}' where name=path;
 perform pg_temp.reject_upload(format('update storage.objects set user_metadata=''{"questionName":"document"}'' where name=%L',path));
end $$;

-- Selecting an unrestricted question while uploading cannot authorize moving
-- that object into a restricted question, including valueName/dynamic panels.
do $$ declare path text; browser uuid:=gen_random_uuid(); response record; begin
 path:=public.reserve_survey_upload('b9700000-0000-4000-8000-000000000001',browser,repeat('a',64),1,'.exe');
 insert into storage.objects(bucket_id,name,metadata,user_metadata) values('survey-files',path,
  '{"size":1,"mimetype":"application/x-msdownload"}','{"questionName":"any","mimeType":"application/x-msdownload"}');
 perform pg_temp.reject_upload(format('select public.submit_form_response(%L,%L,gen_random_uuid(),%L::jsonb)',
  'b9700000-0000-4000-8000-000000000001',browser,jsonb_build_object('entries',jsonb_build_array(jsonb_build_object('proof',jsonb_build_array(jsonb_build_object('content',path)))))));
 select * into response from public.submit_form_response('b9700000-0000-4000-8000-000000000001',browser,gen_random_uuid(),
  jsonb_build_object('any',jsonb_build_array(jsonb_build_object('content',path))));
 assert response.status='submitted', 'Author unrestricted question rejected an executable extension';
 perform pg_temp.reject_upload(format('select public.update_form_response(%L,%L,%L,%L::jsonb)',
  'b9700000-0000-4000-8000-000000000001',browser,response.response_id,jsonb_build_object('entries',jsonb_build_array(jsonb_build_object('proof',path)))));
 -- Tightening the author's rule does not make an unchanged submitted answer
 -- uneditable. Reusing that object in another question remains disallowed.
 update public.forms set schema=jsonb_set(schema,'{pages,0,elements,0,acceptedTypes}','".pdf"')
  where id='b9700000-0000-4000-8000-000000000001';
 perform public.update_form_response('b9700000-0000-4000-8000-000000000001',browser,response.response_id,
  jsonb_build_object('any',jsonb_build_array(jsonb_build_object('content',path))));
 perform pg_temp.reject_upload(format('select public.update_form_response(%L,%L,%L,%L::jsonb)',
  'b9700000-0000-4000-8000-000000000001',browser,response.response_id,jsonb_build_object('entries',jsonb_build_array(jsonb_build_object('proof',path)))));
end $$;

-- A matrix file cell's actual column policy is also enforced at submission.
do $$ declare path text; browser uuid:=gen_random_uuid(); begin
 path:=public.reserve_survey_upload('b9700000-0000-4000-8000-000000000001',browser,repeat('a',64),1,'.pdf');
 insert into storage.objects(bucket_id,name,metadata,user_metadata) values('survey-files',path,
  '{"size":1,"mimetype":"application/pdf"}','{"questionName":"any","mimeType":"application/pdf"}');
 perform pg_temp.reject_upload(format('select public.submit_form_response(%L,%L,gen_random_uuid(),%L::jsonb)',
  'b9700000-0000-4000-8000-000000000001',browser,jsonb_build_object('matrix',jsonb_build_array(jsonb_build_object('cell',path)))));
end $$;
rollback;
