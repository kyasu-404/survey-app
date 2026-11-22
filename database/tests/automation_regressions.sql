begin;

do $$
declare matrix_type text; answer jsonb; rendered text;
begin
  for matrix_type in select unnest(array['matrixdynamic','matrixdropdown']) loop
    answer := '{"score":"А","file":[{"name":"Уведомление.pdf","content":"public/example/attachment.pdf"}],"signature":"data:image/png;base64,TEST"}';
    rendered := survey_automation.response_text(
      jsonb_build_object('type',matrix_type,'name','matrix',
        'columns','[{"name":"score","title":"Оценка","cellType":"text"}]'::jsonb,
        'detailElements','[{"name":"file","type":"file"},{"name":"signature","type":"signaturepad"}]'::jsonb),
      jsonb_build_object('matrix',case matrix_type
        when 'matrixdynamic' then jsonb_build_array(answer)
        else jsonb_build_object('row',answer) end));
    assert rendered like '%Оценка: А%', 'The text cell must be rendered';
    assert rendered like '%file: Прикреплённый файл%' and rendered not like '%Уведомление.pdf%',
      'File answers must use a generic notice without including user-supplied file metadata';
    assert rendered like '%Подпись доступна в ответе%', 'The signature notice must be rendered';
    assert rendered not like '%base64%' and rendered not like '%public/example/%',
      'A matrix parent leaked raw attachment or signature data';
  end loop;
  assert survey_automation.condition_matches('["A"]','{"op":"eq","value":"A"}'),
    'A saved equality comparison must support a single selected option';
  assert not survey_automation.condition_matches('["A","B"]','{"op":"eq","value":"A"}'),
    'Equality must differ from membership when two options were selected';
end;
$$;

insert into auth.users(id,email) values
  ('a1000000-0000-4000-8000-000000000001','owner@example.invalid');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
insert into public.mail_settings(host,port,username,password_encrypted,from_email,from_name,enabled)
values('smtp.invalid',465,'test','test-encrypted-password','mail@example.invalid','Test',true);

do $$
declare
  owner_id uuid := auth.uid();
  test_form_id uuid := gen_random_uuid();
  late_form_id uuid := gen_random_uuid();
  test_rule_id uuid;
  job public.mail_queue;
  initial_schema jsonb := '{"pages":[{"elements":[{"type":"text","name":"amount"}]}]}';
  action jsonb := '{"recipients":["one@example.invalid","two@example.invalid"],"subject":"Form","body":"{{answer_count}} {{matching_count}}","mode":"summary"}';
begin
  insert into public.forms(id,title,author_id,form_type,form_reason,schema,created_at)
    values(test_form_id,'Existing form',owner_id,'anketa','plan',initial_schema,now()-interval '2 days');
  test_rule_id := public.save_automation_rule(null,null,'Single date','',true,'date',null,null,now()-interval '1 day','all','[]',action);
  insert into public.forms(id,title,author_id,form_type,form_reason,schema)
    values(late_form_id,'Late form',owner_id,'anketa','plan',initial_schema);
  perform public.process_automations('https://forms.example.invalid',50);

  select * into job from public.claim_mail_jobs('review-worker',1);
  assert job.form_id=test_form_id, 'The original form should get the scheduled message';
  perform public.finish_mail_job(job.id,'review-worker',true,null);
  delete from public.forms f where f.id=test_form_id;
  perform public.process_automations('https://forms.example.invalid',50);
  assert exists (select from public.automation_runs r where r.rule_id=test_rule_id and r.form_id=test_form_id
    and r.status='cancelled' and r.sent_count=1 and r.recipient_count=2),
    'Deleting a form must cancel its queued run and retain delivery counts';
  assert not exists (select from public.mail_queue q where q.form_id=test_form_id), 'Deleted form still has queued jobs';

  perform public.set_automation_rule_enabled(test_rule_id,false);
  perform public.set_automation_rule_enabled(test_rule_id,true);
  perform public.process_automations('https://forms.example.invalid',50);
  assert not exists (select from public.automation_runs r where r.form_id=late_form_id),
    'Re-enabling a date rule must not deliver for a form created after its scheduled time';

  perform public.submit_form_response(late_form_id,gen_random_uuid(),gen_random_uuid(),'{"amount":"2"}');
  update public.forms f set max_responses=1 where f.id=late_form_id;
  assert exists (select from public.notifications n where n.form_id=late_form_id
    and n.category='form_status' and n.title='Достигнут лимит ответов'),
    'Setting the limit to the current response count closed the form without notifying the owner';
end;
$$;

do $$
declare
  test_form_id uuid := gen_random_uuid();
  test_rule_id uuid;
  first_id uuid;
  last_id uuid;
  initial_schema jsonb := '{"pages":[{"elements":[{"type":"text","name":"amount"}]}]}';
  action jsonb := '{"recipients":["owner@example.invalid"],"subject":"Threshold","body":"{{answer_count}} / {{matching_count}}","mode":"summary"}';
begin
  insert into public.forms(id,title,author_id,form_type,form_reason,schema)
    values(test_form_id,'Counted form',auth.uid(),'anketa','plan',initial_schema);
  insert into public.responses(form_id,data,created_at)
    select test_form_id,jsonb_build_object('amount',case when i in (1,2,3) then '9' else '0' end),
      now() - make_interval(secs=>3002-i)
    from generate_series(1,2501) i;
  select r.id into first_id from public.responses r where r.form_id=test_form_id order by r.created_at limit 1;
  select r.id into last_id from public.responses r where r.form_id=test_form_id order by r.created_at desc limit 1;

  test_rule_id := public.save_automation_rule(null,test_form_id,'Filtered threshold','',true,'matching_count',4,null,null,'all',
    '[{"path":["amount"],"op":"gt","value":5}]',action);
  perform public.submit_form_response(test_form_id,gen_random_uuid(),gen_random_uuid(),'{"amount":"9"}');
  assert not exists (select from public.automation_runs r where r.rule_id=test_rule_id),
    'Submitting a response must not calculate the historical filtered threshold inline';
  perform public.process_automations('https://forms.example.invalid',50);
  assert not exists (select from public.automation_runs r where r.rule_id=test_rule_id),
    'The worker should count history in bounded batches';

  -- Mutate both sides of the cursor and insert a response with an older timestamp.
  update public.responses set data='{"amount":"1"}' where id=first_id;
  update public.responses set data='{"amount":"9"}' where id=last_id;
  delete from public.responses r where r.form_id=test_form_id and r.created_at=now()-interval '3000 seconds';
  insert into public.responses(form_id,data,created_at) values(test_form_id,'{"amount":"9"}',now()-interval '1 day');

  for i in 1..6 loop
    perform public.process_automations('https://forms.example.invalid',50);
  end loop;
  assert (select count(*) from public.automation_runs r where r.rule_id=test_rule_id)=1,
    'Catch-up must finish and trigger the rule exactly once';
  assert exists (select from public.mail_queue q join public.automation_runs r on r.id=q.automation_run_id
    where r.rule_id=test_rule_id and q.body_text like '2502 / 4%'),
    'The threshold omitted a historical response or miscounted changes between batches';
  assert exists (select from public.automation_runs r where r.rule_id=test_rule_id and r.response_id is not null),
    'The threshold run should link to an eligible response';

  -- For a nonmatching change, the email uses the most recent eligible
  -- historical response, which can be several pages back.
  update public.responses r set data='{"amount":"0"}' where r.form_id=test_form_id and r.created_at=now();
  test_rule_id := public.save_automation_rule(null,test_form_id,'Historical match','',true,'matching_count',2,null,null,'all',
    '[{"path":["amount"],"op":"gt","value":5}]',action);
  update public.responses set data='{"amount":"2"}' where id=last_id;
  for i in 1..3 loop
    perform public.process_automations('https://forms.example.invalid',50);
  end loop;
  assert not exists (select from public.automation_runs r where r.rule_id=test_rule_id),
    'Finding the latest match must also use bounded pages';
  for i in 1..3 loop
    perform public.process_automations('https://forms.example.invalid',50);
  end loop;
  assert exists (select from public.automation_runs r where r.rule_id=test_rule_id and r.response_id=(
    select entry.id from public.responses entry where entry.form_id=test_form_id and entry.data->>'amount'='9'
    order by entry.created_at desc,entry.id desc limit 1
  )), 'The run must link to the latest matching historical response';
end;
$$;

rollback;
