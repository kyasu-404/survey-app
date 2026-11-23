\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';
do $$ begin
  if current_database() not like 'survey_personal_check_%' then raise exception 'Disposable test database required'; end if;
end $$;

create function pg_temp.assert_rejected(statement text, expected_state text default null) returns void language plpgsql as $$
declare actual text;
begin
  begin
    execute statement;
  exception when others then
    actual := sqlstate;
    if expected_state is null or actual = expected_state then return; end if;
    raise exception 'Expected SQLSTATE %, got % for: %', expected_state, actual, statement;
  end;
  raise exception 'Expected statement to fail: %', statement;
end;
$$;

insert into auth.users(id, email, raw_user_meta_data) values
  ('a9900000-0000-4000-8000-000000000001', 'rev-author@example.invalid', '{"name":"Author"}'),
  ('a9900000-0000-4000-8000-000000000002', 'rev-other@example.invalid', '{"name":"Other"}'),
  ('a9900000-0000-4000-8000-000000000003', 'rev-admin@example.invalid', '{"name":"Admin"}'),
  ('a9900000-0000-4000-8000-000000000004', 'rev-disabled@example.invalid', '{"name":"Disabled"}');
update public.profiles set role = 'admin' where id = 'a9900000-0000-4000-8000-000000000003';
update public.profiles set is_disabled = true where id = 'a9900000-0000-4000-8000-000000000004';

insert into public.forms(id, title, author_id, is_public, allow_response_editing, form_type, form_reason, schema) values
  ('b9900000-0000-4000-8000-000000000001', 'Text only form', 'a9900000-0000-4000-8000-000000000001', true, true, 'anketa', 'plan',
   '{"pages":[{"elements":[{"type":"text","name":"q1"}]}]}'),
  ('b9900000-0000-4000-8000-000000000002', 'Matrix & signature form', 'a9900000-0000-4000-8000-000000000001', true, true, 'anketa', 'plan',
   '{"pages":[{"elements":[{"type":"matrixdynamic","name":"md","columns":[{"name":"c1","cellType":"text"}]},{"type":"matrixdropdown","name":"mdd","rows":["r1"],"columns":[{"name":"c1","cellType":"text"}]},{"type":"signaturepad","name":"sig","storeDataAsText":false}]}]}'),
  ('b9900000-0000-4000-8000-000000000003', 'Public template', 'a9900000-0000-4000-8000-000000000001', true, true, 'template', 'plan',
   '{"pages":[{"elements":[{"type":"text","name":"q1"},{"type":"file","name":"f1"}]}]}'),
  ('b9900000-0000-4000-8000-000000000004', 'Legacy choice file form', 'a9900000-0000-4000-8000-000000000001', true, true, 'anketa', 'plan',
   '{"pages":[{"questions":[{"type":"radiogroup","name":"rg","choices":[{"value":"a","elements":[{"type":"file","name":"cf","acceptedTypes":".pdf"}]}]}]}]}');

-- F-01: Wildcard MIME rules must reject unlisted subtypes bypassing extension checks.
do $$ begin
  assert not public.survey_question_upload_type_allowed('{"acceptedTypes":"image/*"}', 'payload.exe', 'image/x-bypass'), 'Wildcard image/* accepted unlisted subtype';
  assert not public.survey_question_upload_type_allowed('{"acceptedTypes":"video/*"}', 'payload.html', 'video/x-bypass'), 'Wildcard video/* accepted unlisted subtype';
  assert public.survey_question_upload_type_allowed('{"acceptedTypes":"image/*"}', 'photo.png', 'image/png'), 'Wildcard image/* rejected valid image/png';
  assert public.survey_question_upload_type_allowed('{"acceptedTypes":"image/x-custom"}', 'data.bin', 'image/x-custom'), 'Explicit custom MIME was rejected';
end $$;

-- F-02: No uploads allowed to forms without file/signaturepad questions; signaturepad restricted to images; legacy questions/choices[].elements traversed.
do $$ declare path text; begin
  perform pg_temp.assert_rejected($s$select public.assert_survey_upload_type('b9900000-0000-4000-8000-000000000001', null, 'a.bin', 'application/octet-stream')$s$, '22023');
  perform pg_temp.assert_rejected($s$select public.reserve_survey_upload('b9900000-0000-4000-8000-000000000001', gen_random_uuid(), repeat('a', 64), 10, '.bin')$s$, '22023');
  assert not public.can_upload_survey_file('a9900000-0000-4000-8000-000000000001/b9900000-0000-4000-8000-000000000001/a.bin', false, 10), 'Text-only form allowed upload';

  -- signaturepad rejects non-images
  perform pg_temp.assert_rejected($s$select public.assert_survey_upload_type('b9900000-0000-4000-8000-000000000002', 'sig', 'bad.exe', 'application/x-msdownload')$s$, '22023');
  perform pg_temp.assert_rejected($s$select public.assert_survey_upload_type('b9900000-0000-4000-8000-000000000002', null, 'bad.exe', 'application/x-msdownload')$s$, '22023');
  perform public.assert_survey_upload_type('b9900000-0000-4000-8000-000000000002', 'sig', 'sig.png', 'image/png');

  -- legacy questions + choices[].elements restricted file question cannot be bypassed by omitting questionName
  perform pg_temp.assert_rejected($s$select public.assert_survey_upload_type('b9900000-0000-4000-8000-000000000004', null, 'bad.exe', 'application/octet-stream')$s$, '22023');
  perform public.assert_survey_upload_type('b9900000-0000-4000-8000-000000000004', 'cf', 'ok.pdf', 'application/pdf');
end $$;

-- F-03: can_manage_survey_asset enforces form ownership and allows authors to manage admin-uploaded assets on their forms.
select set_config('request.jwt.claim.sub', 'a9900000-0000-4000-8000-000000000002', true);
set local role authenticated;
do $$ begin
  assert not public.can_manage_survey_asset('forms/b9900000-0000-4000-8000-000000000001/a9900000-0000-4000-8000-000000000002/11111111-1111-4111-8111-111111111111.png'),
    'Non-owner was allowed to upload asset under another author form';
  assert public.can_manage_survey_asset('forms/b9900000-0000-4000-8000-000000000099/a9900000-0000-4000-8000-000000000002/11111111-1111-4111-8111-111111111111.png'),
    'Draft upload for non-existent form under own UID was blocked';
end $$;
reset role;

select set_config('request.jwt.claim.sub', 'a9900000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$ begin
  assert public.can_manage_survey_asset('forms/b9900000-0000-4000-8000-000000000001/a9900000-0000-4000-8000-000000000003/11111111-1111-4111-8111-111111111111.png'),
    'Form author could not manage admin-uploaded asset on their own form';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- F-04 & F-38 DB side: leading \t/\n/\r and CSS escapes/image-set are rejected.
do $$ begin
  assert public.survey_schema_has_unsafe_network_assets(jsonb_build_object('logo', E'\nhttps://evil.invalid/pixel.png')),
    'Leading newline bypassed schema URL check';
  assert public.survey_schema_has_unsafe_network_assets(jsonb_build_object('imageLink', E'\t//evil.invalid/a.png')),
    'Leading tab bypassed schema URL check';
  assert not public.survey_theme_is_safe('{"cssVariables":{"--sjs-general-backcolor":"\\75 rl(https://evil.invalid)"}}'::jsonb),
    'CSS escape bypassed theme validator';
  assert not public.survey_theme_is_safe('{"cssVariables":{"--sjs-general-backcolor":"image-set(\"https://evil.invalid/a.png\" 1x)"}}'::jsonb),
    'image-set bypassed theme validator';
  assert not public.survey_theme_is_safe('{"backgroundImage":"/ok path with spaces)"}'::jsonb),
    'Unanchored relative backgroundImage bypassed theme validator';
end $$;

-- F-05: matrixdynamic and matrixdropdown reject non-object rows and injected keys.
do $$ declare s jsonb; begin
  select schema into s from public.forms where id = 'b9900000-0000-4000-8000-000000000002';
  assert not public.response_data_matches_form(s, array['school'], '{"md":[123]}'::jsonb), 'matrixdynamic non-object row accepted';
  assert not public.response_data_matches_form(s, array['school'], '{"md":[{"c1":"ok","injected":"bad"}]}'::jsonb), 'matrixdynamic extra key accepted';
  assert not public.response_data_matches_form(s, array['school'], '{"mdd":{"r1":"not-object"}}'::jsonb), 'matrixdropdown non-object row accepted';
  assert not public.response_data_matches_form(s, array['school'], '{"mdd":{"r1":{"c1":"ok","injected":"bad"}}}'::jsonb), 'matrixdropdown extra key accepted';
  assert public.response_data_matches_form(s, array['school'], '{"md":[{"c1":"ok"}],"mdd":{"r1":{"c1":"ok"}}}'::jsonb), 'valid matrixdynamic/matrixdropdown rejected';
end $$;

-- F-25 & F-26: obsolete oracles dropped, template excluded from public access/submissions, disabled user blocked from public RPCs, anon has no privileges on responses.
do $$ begin
  assert to_regprocedure('public.is_existing_response_submission(uuid,uuid,uuid)') is null, 'is_existing_response_submission still exists';
  assert to_regprocedure('public.is_public_active_admin_authored_form(uuid)') is null, 'is_public_active_admin_authored_form still exists';
  assert not has_table_privilege('anon', 'public.responses', 'SELECT'), 'anon retains SELECT on responses';
  assert not has_table_privilege('authenticated', 'public.responses', 'UPDATE'), 'authenticated retains UPDATE on responses';
  assert not has_table_privilege('authenticated', 'public.responses', 'DELETE'), 'authenticated retains DELETE on responses';
  assert not public.is_public_active_form('b9900000-0000-4000-8000-000000000003'), 'Template treated as public active form';
  assert public.get_public_form('b9900000-0000-4000-8000-000000000003') is null, 'get_public_form returned a template';
  perform pg_temp.assert_rejected($s$select * from public.submit_form_response('b9900000-0000-4000-8000-000000000003', gen_random_uuid(), gen_random_uuid(), '{"q1":"x"}'::jsonb)$s$, 'P0002');
end $$;

select set_config('request.jwt.claim.sub', 'a9900000-0000-4000-8000-000000000004', true);
set local role authenticated;
do $$ begin
  assert public.get_public_form('b9900000-0000-4000-8000-000000000001') is null, 'Disabled user read public form via get_public_form';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- F-27: claim_mail_jobs rejects NULL worker id; office_assign_question_ids caps depth and ignores name:null; profiles.name length checked.
do $$ declare deep jsonb := '{"type":"text","name":"leaf"}'::jsonb; i integer; begin
  perform pg_temp.assert_rejected($s$select * from public.claim_mail_jobs(null, 5)$s$, '22023');
  for i in 1..40 loop deep := jsonb_build_object('elements', jsonb_build_array(deep)); end loop;
  perform pg_temp.assert_rejected(format('select public.office_assign_question_ids(%L::jsonb)', deep::text), '22023');
  -- name: null must not crash UPDATE OF schema
  update public.forms set schema = '{"pages":[{"elements":[{"type":"text","name":null}]}]}'::jsonb
    where id = 'b9900000-0000-4000-8000-000000000001';
  update public.forms set schema = '{"pages":[{"elements":[{"type":"text","name":"q1"}]}]}'::jsonb
    where id = 'b9900000-0000-4000-8000-000000000001';
  perform pg_temp.assert_rejected(format('update public.profiles set name = %L where id = %L', repeat('a', 201), 'a9900000-0000-4000-8000-000000000001'), '23514');
end $$;

-- F-32: serialized admin role/delete/disable RPCs protect last active admin.
do $$ begin
  perform public.set_employee_role('a9900000-0000-4000-8000-000000000002', 'admin', 'a9900000-0000-4000-8000-000000000003');
  assert (select role = 'admin' from public.profiles where id = 'a9900000-0000-4000-8000-000000000002');
  perform public.set_employee_role('a9900000-0000-4000-8000-000000000002', 'user', 'a9900000-0000-4000-8000-000000000003');
  assert (select role = 'user' from public.profiles where id = 'a9900000-0000-4000-8000-000000000002');
  perform pg_temp.assert_rejected($s$select public.set_employee_role('a9900000-0000-4000-8000-000000000003', 'user', 'a9900000-0000-4000-8000-000000000003')$s$, '42501');
  perform pg_temp.assert_rejected($s$select public.assert_can_delete_employee('a9900000-0000-4000-8000-000000000003', 'a9900000-0000-4000-8000-000000000003')$s$, '42501');
  perform public.assert_can_delete_employee('a9900000-0000-4000-8000-000000000002', 'a9900000-0000-4000-8000-000000000003');
end $$;

-- F-35: dedicated least-privilege office_service role exists without superuser and only sees allowed tables.
do $$ begin
  assert exists (select 1 from pg_roles where rolname = 'office_service' and not rolsuper and rolbypassrls), 'office_service role misconfigured';
  assert has_table_privilege('office_service', 'public.office_documents', 'INSERT'), 'office_service missing office_documents INSERT';
  assert has_table_privilege('office_service', 'public.forms', 'SELECT'), 'office_service missing forms SELECT';
  assert not has_table_privilege('office_service', 'public.forms', 'DELETE'), 'office_service unexpectedly has forms DELETE';
  assert not has_table_privilege('office_service', 'public.mail_settings', 'SELECT'), 'office_service unexpectedly has mail_settings SELECT';
end $$;

rollback;
