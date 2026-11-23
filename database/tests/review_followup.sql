\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';

do $$ begin
  if current_database() not like 'survey_personal_check_%' then
    raise exception 'Disposable test database required';
  end if;
end $$;

insert into auth.users(id, email, raw_user_meta_data) values
  ('adb00000-0000-4000-8000-000000000001', 'followup-admin@example.invalid', '{"name":"Administrator"}'),
  ('adb00000-0000-4000-8000-000000000002', 'followup-user@example.invalid', '{"name":"Employee"}');
update public.profiles set role = 'admin' where id = 'adb00000-0000-4000-8000-000000000001';

insert into public.forms(id, title, author_id, is_public, form_type, form_reason, schema) values (
  'adb00000-0000-4000-8000-000000000003', 'Legacy attachment',
  'adb00000-0000-4000-8000-000000000001', true, 'anketa', 'plan',
  '{"pages":[{"questions":[{"type":"radiogroup","name":"selection","choices":[{"value":"yes","elements":[{"type":"file","name":"attachment","acceptedTypes":".pdf"}]}]}]}]}'
);

do $$
declare
  browser uuid := gen_random_uuid();
  form uuid := 'adb00000-0000-4000-8000-000000000003';
  upload_path text;
  submitted record;
begin
  upload_path := public.reserve_survey_upload(form, browser, repeat('1', 64), 20, '.pdf');
  insert into storage.objects(bucket_id, name, metadata, user_metadata)
  values ('survey-files', upload_path, '{"size":20,"mimetype":"application/pdf"}', '{"fileName":"document.pdf","questionName":"attachment"}');

  select * into submitted from public.submit_form_response(form, browser, gen_random_uuid(),
    jsonb_build_object('selection', 'yes', 'attachment', jsonb_build_array(jsonb_build_object('content', upload_path))));
  assert submitted.status = 'submitted';
  assert exists (select 1 from public.response_file_references where response_id = submitted.response_id and object_path = upload_path),
    'An uploaded file in a legacy choice must be linked to the saved response';
end
$$;

do $$
declare
  matrix jsonb := '{"elements":[{"type":"matrixdropdown","name":"matrix","rows":[{"value":"morning","text":"Morning"}],"columns":[{"name":"hours","cellType":"text"}]}]}';
begin
  assert public.response_data_matches_form(matrix, '{}', '{"matrix":{"morning":{"hours":"2"}}}');
  assert not public.response_data_matches_form(matrix, '{}', '{"matrix":{"evening":{"hours":"2"}}}'),
    'A matrix with fixed rows must accept only declared row names';
end
$$;

do $$ begin
  assert public.survey_theme_is_safe('{"backgroundImage":"/assets/picture.png"}');
  assert public.survey_theme_is_safe('{"backgroundImage":"__APP_SURVEY_ASSET__/gallery/picture.png"}');
end $$;

-- Existing user-selected images stay in the gallery, while unused copies age out.
insert into storage.objects(bucket_id, name, user_metadata, created_at) values
  ('survey-assets', 'forms/adb00000-0000-4000-8000-000000000003/adb00000-0000-4000-8000-000000000001/adb00000-0000-4000-8000-000000000010.png',
    '{}', now() - interval '8 days'),
  ('survey-assets', 'forms/adb00000-0000-4000-8000-000000000003/adb00000-0000-4000-8000-000000000001/adb00000-0000-4000-8000-000000000011.png',
    '{"surveyThemeCopy":true}', now() - interval '8 days');

do $$ begin
  assert (select count(*) from public.list_orphan_survey_assets(now() - interval '7 days', 10)) = 1;
  assert (select name from public.list_orphan_survey_assets(now() - interval '7 days', 10))
    like '%/adb00000-0000-4000-8000-000000000011.png';
end $$;

-- A new upload at the limit fails, and deleting an existing image frees space.
insert into storage.objects(bucket_id, name)
select 'survey-assets', 'forms/adb00000-0000-4000-8000-000000000003/adb00000-0000-4000-8000-000000000001/' || gen_random_uuid() || '.png'
from generate_series(1, 498);
select set_config('request.jwt.claim.sub', 'adb00000-0000-4000-8000-000000000001', true);

do $$
declare
  new_path text := 'forms/adb00000-0000-4000-8000-000000000003/adb00000-0000-4000-8000-000000000001/adb00000-0000-4000-8000-000000000012.png';
begin
  begin
    insert into storage.objects(bucket_id, name) values ('survey-assets', new_path);
    raise exception 'Expected a quota rejection';
  exception when sqlstate '22023' then
    assert sqlerrm like 'Достигнут лимит%';
  end;
  delete from storage.objects where bucket_id = 'survey-assets' and name like '%/adb00000-0000-4000-8000-000000000010.png';
  insert into storage.objects(bucket_id, name) values ('survey-assets', new_path);
end
$$;
select set_config('request.jwt.claim.sub', '', true);

-- Housekeeping removes long-deleted objects and leaves fresh claims intact.
insert into public.survey_file_deletion_claims(object_path, claimed_at)
values ('public/adb00000-0000-4000-8000-000000000003/previous.pdf', now() - interval '31 days'),
       ('public/adb00000-0000-4000-8000-000000000003/recent.pdf', now());
do $$ begin
  assert public.prune_survey_file_deletion_claims(10) = 1;
  assert exists (select 1 from public.survey_file_deletion_claims where object_path like '%/recent.pdf');
end $$;

update public.forms set deadline_at = now() - interval '1 minute'
where id = 'adb00000-0000-4000-8000-000000000003';
insert into survey_automation.form_deadlines(form_id, due_at)
select id, deadline_at from public.forms where id = 'adb00000-0000-4000-8000-000000000003';
do $$ begin
  assert public.process_automations('https://forms.example.invalid', 10) = 1, 'Finishing a deadline should count as work';
  assert public.process_automations('https://forms.example.invalid', 10) = 0;
end $$;

-- The mutation owns the same transaction as validation and session/profile cascades.
create table if not exists auth.audit_log_entries(
  id uuid primary key, instance_id uuid, payload json, created_at timestamptz, ip_address varchar(64)
);
do $$ begin
  assert public.delete_employee('adb00000-0000-4000-8000-000000000002', 'adb00000-0000-4000-8000-000000000001');
  assert not exists (select 1 from auth.users where id = 'adb00000-0000-4000-8000-000000000002');
  assert not exists (select 1 from public.profiles where id = 'adb00000-0000-4000-8000-000000000002');
  assert exists (select 1 from public.profiles where id = 'adb00000-0000-4000-8000-000000000001' and role = 'admin');
  assert not has_function_privilege('authenticated', 'public.delete_employee(uuid,uuid)', 'EXECUTE');
  assert exists (select 1 from auth.audit_log_entries
    where instance_id = '00000000-0000-0000-0000-000000000000'
      and payload ->> 'action' = 'user_deleted'
      and payload ->> 'actor_id' = 'adb00000-0000-4000-8000-000000000001');
end $$;

rollback;
