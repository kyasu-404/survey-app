-- Run on a disposable survey_personal_check_* database after 202610281200.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';
do $$ begin
  if current_database() not like 'survey_personal_check_%' then
    raise exception 'Requires a disposable survey_personal_check_* database';
  end if;
end $$;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('a6000000-0000-4000-8000-000000000001','review-owner@example.invalid','{"name":"Review owner"}'),
 ('a6000000-0000-4000-8000-000000000002','review-reader@example.invalid','{"name":"Review reader"}');
insert into public.forms(id,title,author_id,form_type,form_reason,schema,is_public,deadline_at)
values
 ('b6000000-0000-4000-8000-000000000001',E'Review 50%_\\ "literal"','a6000000-0000-4000-8000-000000000001','anketa','plan','{"pages":[]}',true,null),
 ('b6000000-0000-4000-8000-000000000002','Review expired','a6000000-0000-4000-8000-000000000001','anketa','plan','{"pages":[]}',true,now()),
 ('b6000000-0000-4000-8000-000000000003','Review manually closed','a6000000-0000-4000-8000-000000000001','anketa','plan','{"pages":[]}',false,now()+interval '1 day'),
 ('b6000000-0000-4000-8000-000000000004','Review future','a6000000-0000-4000-8000-000000000001','anketa','plan','{"pages":[]}',true,now()+interval '1 day');
select set_config('request.jwt.claim.sub','a6000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.assert_true((select count(*)=2 from public.list_forms_sorted(p_search=>'Review',p_is_public=>true)), 'only effective active forms pass the active filter');
select pg_temp.assert_true((select count(*)=2 from public.list_forms_sorted(p_search=>'Review',p_is_public=>false)), 'expired and manually closed forms pass the closed filter');
select pg_temp.assert_true((select count(*)=2 from public.list_forms_sorted(p_search=>'Review',p_is_public=>true,p_reference_time=>now()-interval '1 day')), 'a frozen sort clock does not keep expired forms in the active filter');
select pg_temp.assert_true((select active_count=2 and total_count=4 from public.get_dashboard_forms_stats(p_search=>'Review')), 'statistics agree with both list filters');
select pg_temp.assert_true((select total_count=2 and active_count=0 from public.get_dashboard_forms_stats(p_search=>'Review',p_is_public=>false)), 'closed statistics include expired raw-public forms');
select pg_temp.assert_true((select sort_value='false' from public.list_forms_sorted(p_search=>'manually closed',p_sort_field=>'status')), 'a future deadline does not reopen a manually closed form while sorting');
do $$ declare term text; begin
  foreach term in array array['%', '_', E'\\', '"literal"'] loop
    perform pg_temp.assert_true((select count(*)=1 from public.list_forms_sorted(p_search=>term)), 'sorted search treats '||term||' literally');
    perform pg_temp.assert_true((select total_count=1 from public.get_dashboard_forms_stats(p_search=>term)), 'statistics search treats '||term||' literally');
  end loop;
end $$;
reset role;
update public.forms set author_name=E'Name 20%_\\' where id='b6000000-0000-4000-8000-000000000004';
set local role authenticated;
select pg_temp.assert_true((select count(*)=1 from public.list_forms_sorted(p_search=>E'20%_\\')), 'author search escapes metacharacters');
select pg_temp.assert_true((select total_count=1 from public.get_dashboard_forms_stats(p_search=>E'20%_\\')), 'author statistics search escapes metacharacters');
reset role;

-- A successful INSERT can close the form before the RPC returns its edit flag.
select set_config('request.jwt.claim.sub','a6000000-0000-4000-8000-000000000001',true);
insert into public.forms(id,title,author_id,form_type,form_reason,schema,is_public,max_responses,allow_response_editing)
values
 ('b6000000-0000-4000-8000-000000000005','Limit review','a6000000-0000-4000-8000-000000000001','anketa','plan','{"pages":[{"elements":[{"type":"text","name":"answer"}]}]}',true,1,true),
 ('b6000000-0000-4000-8000-000000000006','Personal limit review','a6000000-0000-4000-8000-000000000001','anketa','plan','{"pages":[{"elements":[{"type":"organization","name":"org"}]}]}',true,1,true);
do $$ declare result record; browser_id uuid := gen_random_uuid(); begin
  select * into result from public.submit_form_response('b6000000-0000-4000-8000-000000000005',browser_id,gen_random_uuid(),'{"answer":"last"}');
  assert result.status='submitted' and not result.response_editable, 'Last response cannot be edited';
  assert not (select is_public from public.forms where id='b6000000-0000-4000-8000-000000000005');
  select * into result from public.submit_form_response('b6000000-0000-4000-8000-000000000005',browser_id,gen_random_uuid(),'{"answer":"retry"}');
  assert result.status='already_submitted' and not result.response_editable, 'Retries agree with the original result';
end $$;
insert into public.education_organizations(id,organization_type,number,alias,email)
values ('e6000000-0000-4000-8000-000000000001','school','review-1','Review school','school@example.invalid');
select public.set_form_personal_links('b6000000-0000-4000-8000-000000000006',true);
do $$ declare result record; token uuid; begin
  select l.token into token from public.form_personal_links l where l.form_id='b6000000-0000-4000-8000-000000000006' and l.organization_id='e6000000-0000-4000-8000-000000000001';
  select * into result from public.submit_personal_form_response('b6000000-0000-4000-8000-000000000006',token,gen_random_uuid(),'{"org":"e6000000-0000-4000-8000-000000000001"}');
  assert result.status='submitted' and not result.response_editable, 'Personal submissions also return the post-trigger state';
end $$;

-- A claim survives COMMIT of the RPC; crashed/failed attempts become retryable.
insert into public.forms(id,title,author_id,form_type,form_reason,schema,is_public)
values ('b6000000-0000-4000-8000-000000000007','Upload review','a6000000-0000-4000-8000-000000000001','anketa','plan','{"pages":[]}',true);
do $$ declare path text; n integer; begin
  path := public.reserve_survey_upload('b6000000-0000-4000-8000-000000000007',gen_random_uuid(),repeat('a',64),1,'.txt');
  insert into storage.objects(bucket_id,name,metadata) values('survey-files',path,'{"size":1}');
  update public.survey_upload_reservations set expires_at=now()-interval '1 hour' where object_path=path;
  select count(*) into n from public.list_expired_survey_uploads(100);
  assert n=1, 'First worker claims the expired upload';
  select count(*) into n from public.list_expired_survey_uploads(100);
  assert n=0, 'The next worker cannot immediately reclaim it';
  update public.survey_upload_reservations set cleanup_claimed_at=now()-interval '11 minutes' where object_path=path;
  select count(*) into n from public.list_expired_survey_uploads(100);
  assert n=1, 'Expired claim is retried after an interrupted Storage deletion';
  update public.survey_upload_reservations set attached=true,cleanup_claimed_at=now()-interval '11 minutes' where object_path=path;
  select count(*) into n from public.list_expired_survey_uploads(100);
  assert n=0, 'Attached files are excluded even after claim expiry';
  update public.survey_upload_reservations set attached=false,cleanup_claimed_at=null where object_path=path;
  select count(*) into n from public.list_expired_survey_uploads(100);
  assert n=1, 'Legacy claims without timestamps remain recoverable';
end $$;
rollback;
