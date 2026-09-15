-- Integration check against an installed database with at least one form.
-- All fixtures are rolled back; no Storage API deletions are performed.
begin;
do $$
declare
 f uuid; paths text[]; candidates text[]; confirmed text[]; i integer;
begin
 select id into f from public.forms limit 1;
 if f is null then raise exception 'This integration check requires one existing form'; end if;
 for i in 1..7 loop
  paths[i]:='forms/'||f||'/documents/'||gen_random_uuid()||'/'||gen_random_uuid()||'.xlsx';
 end loop;
 paths[2]:='forms/'||f||'/results/'||gen_random_uuid()||'.zip';
 paths[4]:='forms/'||f||'/results/'||gen_random_uuid()||'.zip';
 paths[8]:='unmanaged/'||gen_random_uuid()||'.xlsx';
 for i in 1..8 loop
  insert into storage.objects(bucket_id,name,created_at) values('survey-documents',paths[i],now()-interval '10 days');
 end loop;
 update storage.objects set created_at=now()-interval '1 day' where bucket_id='survey-documents' and name=paths[5];
 insert into public.office_documents(form_id,name,file_type,storage_path) values(f,'Protected.xlsx','xlsx',paths[3]);
 insert into public.office_generation_results(form_id,name,file_type,storage_path,files,size_bytes) values(f,'Protected.zip','xlsx',paths[4],'["result.xlsx"]',1);
 insert into public.office_storage_cleanup(storage_path,created_at) values(paths[6],now()),(paths[7],now()-interval '3 hours');
 select array_agg(name) into candidates from public.list_orphan_office_documents(now(),500) where name=any(paths);
 assert cardinality(candidates)=3, 'Expected only two orphans and one expired queued file';
 assert paths[1]=any(candidates) and paths[2]=any(candidates) and paths[7]=any(candidates), 'Active references, recent files, grace period and namespaces must be protected';
 -- A reference created after enumeration must be rechecked before deletion.
 insert into public.office_documents(form_id,name,file_type,storage_path) values(f,'Attached.xlsx','xlsx',paths[1]);
 select array_agg(name) into confirmed from public.confirm_orphan_office_documents(now(),paths);
 assert cardinality(confirmed)=2 and paths[2]=any(confirmed) and paths[7]=any(confirmed), 'Confirmation must exclude newly attached files';
 assert not has_function_privilege('anon','public.list_orphan_office_documents(timestamptz,integer)','execute'), 'Anonymous access forbidden';
 assert not has_function_privilege('authenticated','public.confirm_orphan_office_documents(timestamptz,text[])','execute'), 'Employee direct RPC access forbidden';
 assert has_function_privilege('service_role','public.confirm_orphan_office_documents(timestamptz,text[])','execute'), 'Worker access required';
 raise notice 'Office orphan cleanup: retention, both reference tables, session grace, namespace, recheck and permissions passed';
end $$;
rollback;
