\set ON_ERROR_STOP on
begin;
set local statement_timeout = '60s';
do $$ begin
  if current_database() not like 'survey_personal_check_%' then raise exception 'Disposable test database required'; end if;
end $$;

insert into auth.users(id, email) values
  ('aa110000-0000-4000-8000-000000000001', 'counter-owner@example.invalid');
insert into public.forms(id,title,author_id,form_type,form_reason,schema) values
  ('bb110000-0000-4000-8000-000000000001','Large form','aa110000-0000-4000-8000-000000000001','anketa','plan',
    jsonb_build_object('pages','[]'::jsonb,'description',repeat('x',200000)));

-- Actual metadata edits still invalidate schema CAS, including status changes
-- that the response limit trigger makes after the last accepted response.
do $$ declare saved_revision bigint; begin
  select revision into saved_revision from public.forms where id = 'bb110000-0000-4000-8000-000000000001';
  update public.forms set title = title where id = 'bb110000-0000-4000-8000-000000000001';
  assert (select revision = saved_revision from public.forms where id = 'bb110000-0000-4000-8000-000000000001'), 'No-op metadata edit bumped revision';
  update public.forms set title = 'Edited form' where id = 'bb110000-0000-4000-8000-000000000001';
  update public.forms set schema = schema || '{"title":"Edited schema"}'::jsonb, responses_count = 1
    where id = 'bb110000-0000-4000-8000-000000000001';
  update public.forms set personal_links_enabled = true where id = 'bb110000-0000-4000-8000-000000000001';
  update public.forms set max_responses = 2 where id = 'bb110000-0000-4000-8000-000000000001';
  assert (select revision = saved_revision + 4 from public.forms where id = 'bb110000-0000-4000-8000-000000000001'), 'Metadata edit did not bump revision';
  perform public.submit_form_response('bb110000-0000-4000-8000-000000000001',gen_random_uuid(),gen_random_uuid(),'{}'::jsonb);
  assert (select responses_count = 2 and not is_public and revision = saved_revision + 5
    from public.forms where id = 'bb110000-0000-4000-8000-000000000001'), 'Reaching the response limit did not close the form and bump revision';
  update public.forms set max_responses = null, is_public = true where id = 'bb110000-0000-4000-8000-000000000001';
end $$;

-- Replace only the body inside this rolled-back test. A counter-only UPDATE
-- must never enter the revision function, even with a large toasted schema.
create or replace function public.increment_form_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Counter-only update invoked the revision trigger';
end;
$$;

do $$ declare saved_revision bigint; begin
  select revision into saved_revision from public.forms where id = 'bb110000-0000-4000-8000-000000000001';
  assert (select length(schema::text) > 200000 from public.forms where id = 'bb110000-0000-4000-8000-000000000001');
  update public.forms set responses_count = responses_count + 1 where id = 'bb110000-0000-4000-8000-000000000001';
  update public.forms set responses_count = responses_count where id = 'bb110000-0000-4000-8000-000000000001';
  perform public.submit_form_response('bb110000-0000-4000-8000-000000000001',gen_random_uuid(),gen_random_uuid(),'{}'::jsonb);
  delete from public.responses where form_id = 'bb110000-0000-4000-8000-000000000001';
  assert (select responses_count = 2 and revision = saved_revision
    from public.forms where id = 'bb110000-0000-4000-8000-000000000001'), 'Counter-only path changed revision or lost counter updates';
end $$;
rollback;
