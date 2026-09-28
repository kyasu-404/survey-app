-- Regression: SurveyJS "Other" answers and comments must survive real submission.
-- Fixtures and any generated responses are rolled back.
begin;
do $$
declare
  survey jsonb := '{"pages":[{"elements":[{"type":"panel","name":"section","elements":[
    {"type":"checkbox","name":"выбор","showOtherItem":true},
    {"type":"dropdown","name":"list","showOtherItem":true},
    {"type":"text","name":"text","showCommentArea":true},
    {"type":"text","name":"plain"},
    {"type":"matrix","name":"matrix"},
    {"type":"file","name":"files"},
    {"type":"signaturepad","name":"signature"},
    {"type":"paneldynamic","name":"people","templateElements":[{"type":"text","name":"person","showCommentArea":true}]},
    {"type":"organization","name":"org"}
  ]}]}]}';
  answer jsonb := '{"выбор":["other"],"выбор-Comment":"Свой вариант","list":"other","list-Comment":"Другой пункт","text":"Текст","text-Comment":"Пояснение","plain":"Обычный ответ","matrix":{"row":"column"},"files":[{"name":"file.txt","content":"fixture"}],"signature":"data:image/png;base64,fixture","people":[{"person":"Анна","person-Comment":"Комментарий записи"}]}';
  owner_id uuid := gen_random_uuid(); target_id uuid := gen_random_uuid();
  browser_id uuid := gen_random_uuid(); submission_id uuid := gen_random_uuid();
  result record;
begin
  assert public.response_data_matches_form(survey, array['school'], answer), 'Other/comment payload was rejected';
  assert not public.response_data_matches_form(survey, array['school'], answer || '{"foreign":"value"}'), 'Unknown answers must remain rejected';
  assert not public.response_data_matches_form(survey, array['school'], answer || '{"foreign-Comment":"value"}'), 'Unknown comments must remain rejected';
  assert not public.response_data_matches_form(survey, array['school'], answer || '{"plain-Comment":"value"}'), 'Disabled comments must remain rejected';
  assert not public.response_data_matches_form(survey, array['school'], answer || '{"list-Comment":{"bad":true}}'), 'Comments must be strings';
  assert not public.response_data_matches_form(survey, array['school'], answer || '{"org":"invalid-uuid"}'), 'Organization checks must remain active';
  assert not public.response_data_matches_form(survey, array['school'], jsonb_build_object('text',repeat('x',262145))), 'Payload size must remain bounded';
  assert public.response_data_matches_form(survey || '{"commentSuffix":"_note"}', array['school'], '{"list":"other","list_note":"Комментарий"}'), 'Custom comment suffix rejected';
  assert public.response_data_matches_form('{"pages":[{"elements":[{"type":"dropdown","name":"q","valueName":"stored","showOtherItem":true}]}]}', array['school'], '{"stored":"other","stored-Comment":"Свой"}'), 'valueName and its comment rejected';
  assert not public.response_data_matches_form('{"pages":[{"elements":[{"type":"organization","name":"q","valueName":"org"}]}]}', array['school'], '{"org":"invalid"}'), 'valueName must not bypass organization validation';
  assert not public.response_data_matches_form(survey || '{"commentSuffix":"_note"}', array['school'], '{"list-Comment":"Комментарий"}'), 'Wrong suffix accepted';
  assert public.response_data_matches_form('{"pages":[{"elements":[{"name":"old","type":"dropdown","hasOther":true},{"name":"note","type":"text","hasComment":true}]}]}', array['school'], '{"old-Comment":"Другой","note-Comment":"Пояснение"}'), 'SurveyJS property aliases rejected';

  insert into auth.users(id,email,raw_user_meta_data) values(owner_id,owner_id||'@example.invalid','{}');
  insert into public.forms(id,title,author_id,is_public,allow_response_editing,form_type,form_reason,schema)
    values(target_id,'Comment regression',owner_id,true,true,'anketa','plan',survey);
  select * into result from public.submit_form_response(target_id,browser_id,submission_id,answer);
  assert result.status = 'submitted' and result.response_data = answer, 'Submission must preserve every answer and comment';
  select * into result from public.submit_form_response(target_id,browser_id,submission_id,answer);
  assert result.status = 'already_submitted', 'Submission retries must remain idempotent';
  perform public.update_form_response(target_id,browser_id,result.response_id,answer || '{"list-Comment":"Исправлено"}');
  assert (select data->>'list-Comment' = 'Исправлено' from public.responses where id = result.response_id), 'Editing comments failed';
  raise notice 'Response comments: validation, submission, retry and editing passed';
end $$;
rollback;
