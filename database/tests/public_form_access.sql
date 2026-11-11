\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_database() not like 'survey_personal_check_%' then raise exception 'Disposable test database required'; end if;
end $$;
insert into auth.users(id,email) values ('af110000-0000-4000-8000-000000000001','public-owner@example.invalid');
insert into public.forms(id,title,author_id,form_type,form_reason,schema,is_public,deadline_at) values
 ('bf110000-0000-4000-8000-000000000001','Known link','af110000-0000-4000-8000-000000000001','anketa','plan','{"pages":[]}',true,null),
 ('bf110000-0000-4000-8000-000000000002','Private','af110000-0000-4000-8000-000000000001','anketa','plan','{"pages":[]}',false,null),
 ('bf110000-0000-4000-8000-000000000003','Expired','af110000-0000-4000-8000-000000000001','anketa','plan','{"pages":[]}',true,now()-interval '1 day');
set local role anon;
do $$ declare value jsonb; begin
  begin
    perform id from public.forms;
    raise exception 'Anonymous caller can still enumerate form IDs' using errcode='XX001';
  exception when insufficient_privilege then null; end;
  value := public.get_public_form('bf110000-0000-4000-8000-000000000001');
  assert value->>'title' = 'Known link';
  assert value->'schema' = '{"pages":[]}'::jsonb;
  assert not (value ?| array['author_id','author_name','author_email']);
  assert public.get_public_form('bf110000-0000-4000-8000-000000000002') is null;
  assert public.get_public_form('bf110000-0000-4000-8000-000000000003') is null;
  assert public.get_public_form('bf110000-0000-4000-8000-000000000004') is null;
  assert public.get_public_form(null) is null;
  assert not has_any_column_privilege('anon','public.forms','SELECT');
  assert (select status='submitted' from public.submit_form_response(
    'bf110000-0000-4000-8000-000000000001',gen_random_uuid(),gen_random_uuid(),'{}'));
end $$;
reset role;
select set_config('request.jwt.claim.sub','af110000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
  assert (select count(*)=3 from public.forms where author_id='af110000-0000-4000-8000-000000000001');
end $$;
rollback;
