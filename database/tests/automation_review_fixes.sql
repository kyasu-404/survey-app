begin;

insert into auth.users(id,email) values
  ('a7000000-0000-4000-8000-000000000001','rule-owner@example.invalid'),
  ('a7000000-0000-4000-8000-000000000002','second-owner@example.invalid');
insert into public.education_organizations(id,organization_type,number,alias,email)
values('e7000000-0000-4000-8000-000000000001','school','94','Школа 94','school94@example.invalid');
insert into public.forms(id,author_id,title,form_type,form_reason,schema) values
  ('b7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001','Основная','anketa','plan',
   '{"pages":[{"elements":[{"type":"text","name":"note","title":{"ru":"Заметка","default":"Note"}},
     {"type":"panel","name":"layout","elements":[{"type":"organization","name":"org"}]},
     {"type":"paneldynamic","name":"rows","templateElements":[{"type":"organization","name":"org"}]}]}]}'),
  ('b7000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000002','Другая','anketa','plan','{"pages":[]}');
insert into public.mail_settings(host,port,username,password_encrypted,from_email,from_name,enabled)
values('smtp.invalid',465,'test','fixture-encrypted-password','test@example.invalid','Test',true);
select set_config('request.jwt.claim.sub','a7000000-0000-4000-8000-000000000001',true);

do $$
declare
  owner_id uuid := auth.uid();
  form_id uuid := 'b7000000-0000-4000-8000-000000000001';
  action jsonb := '{"subject":"Письмо","body":"Краткое уведомление","mode":"summary","recipients":[]}';
  invalid jsonb;
  valid_rule uuid;
  campaign jsonb := '[{"organization_id":"e7000000-0000-4000-8000-000000000001","recipient_email":"school94@example.invalid","recipient_name":"Школа 94","subject":"Проверка","body_text":"Проверка"}]';
begin
  assert exists(select from public.automation_form_fields(form_id) where path=array['note'] and label='Заметка');
  foreach invalid in array array[
    action||'{"recipientPath":["note"]}',
    action||'{"recipientPath":["rows","org"]}',
    action||'{"recipientPath":["org"],"mode":"full"}',
    action||'{"recipientPath":["org"],"subject":"\t\n"}'
  ] loop
    begin
      perform public.save_automation_rule(null,form_id,'Проверка','',true,'response_received',null,null,null,'all','[]',invalid);
      raise exception 'Invalid action passed the rule API';
    exception when invalid_parameter_value then null;
    end;
  end loop;
  begin
    perform public.save_automation_rule(null,form_id,'Проверка','',true,'recurring',null,14,now(),'all','[]',
      action||'{"recipientPath":["org"]}');
    raise exception 'Short recurring interval passed the rule API';
  exception when invalid_parameter_value then null;
  end;
  valid_rule:=public.save_automation_rule(null,form_id,'Письмо организации','',true,'response_received',null,null,null,
    'all','[]',action||jsonb_build_object('recipientPath',array['org'],'subject',repeat('я',470)||'{{sent_at}}'));
  perform public.submit_form_response(form_id,gen_random_uuid(),gen_random_uuid(),
    '{"org":"e7000000-0000-4000-8000-000000000001","note":"Содержание ответа"}');
  begin
    perform public.process_automations(null,10);
    raise exception 'Invalid worker configuration was accepted' using errcode='23514';
  exception when raise_exception then null;
  end;
  begin
    perform public.process_automations('https://forms.example.invalid:99999',10);
    raise exception 'Out-of-range worker port was accepted' using errcode='23514';
  exception when raise_exception then null;
  end;
  assert exists(select from public.automation_runs r join survey_automation.payloads p on p.run_id=r.id
    where r.rule_id=valid_rule and r.status='pending'), 'Bad worker configuration consumed a pending payload';
  perform public.process_automations('https://forms.example.invalid',10);
  assert (select count(*) from public.mail_queue where automation_run_id is not null)=1;
  assert exists(select from public.mail_queue q where q.recipient_email='school94@example.invalid'
    and q.body_text not like '%Содержание ответа%' and q.subject not like '%{{sent_at:%'),
    'Directory delivery must omit raw answers and partial time placeholders';

  perform public.set_form_personal_links(form_id,true);
  perform public.enqueue_form_mail_batch(gen_random_uuid(),form_id,owner_id,campaign,'invitation',true);
  begin
    perform public.set_form_personal_links(form_id,false);
    raise exception 'Active invitation failed to protect link mode';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.enqueue_form_mail_batch(gen_random_uuid(),form_id,owner_id,campaign,'reminder',true);
    raise exception 'Concurrent normal campaigns were accepted';
  exception when object_not_in_prerequisite_state then null;
  end;
  perform public.set_automation_rule_enabled(valid_rule,false);
  perform public.process_automations('https://forms.example.invalid',10);
  assert exists(select from public.automation_runs where rule_id=valid_rule and status='cancelled' and cancelled_count=1 and failed_count=0);
  assert exists(select from public.notifications where rule_id=valid_rule and title='Выполнение правила отменено');
  assert exists(select from public.mail_queue where automation_run_id is null and status='queued');
  perform set_config('survey_test.foreign_rule',valid_rule::text,true);

  -- A pending legacy snapshot can differ from the currently saved rule's safe action.
  perform public.set_automation_rule_enabled(valid_rule,true);
  insert into public.responses(form_id,data) values(form_id,'{"org":"e7000000-0000-4000-8000-000000000001"}');
  update survey_automation.payloads p set payload=jsonb_set(payload,'{action,recipientPath}','["note"]')
    where p.run_id in (select id from public.automation_runs where rule_id=valid_rule and status='pending');
  perform public.process_automations('https://forms.example.invalid',10);
  assert exists(select from public.automation_runs where rule_id=valid_rule and status='failed' and recipient_count=0),
    'Dispatch must validate the original pending action independently from the current rule';
end;
$$;

do $$
declare
  schema_json jsonb := '{"elements":[{"type":"file","name":"f"},{"type":"boolean","name":"yes","labelTrue":{"ru":"Верно"}}]}';
  file_answer jsonb;
  rendered text;
begin
  foreach file_answer in array array['"sample.txt"'::jsonb,'{"name":"sample.txt","content":"fixture"}','[{"name":"sample.txt","content":"fixture"}]'] loop
    rendered:=survey_automation.response_text(schema_json,jsonb_build_object('f',file_answer,'yes',true));
    assert rendered like '%f: Прикреплённый файл%' and rendered like '%yes: Верно%';
    assert rendered not like '%sample.txt%' and rendered not like '%fixture%';
  end loop;
  rendered:=survey_automation.response_text(
    '{"elements":[{"type":"text","name":"a","showCommentArea":true},{"type":"file","name":"attachment","valueName":"a-Comment"},
       {"type":"text","name":"alias","valueName":"a-Comment"},{"type":"text","name":"b","hasComment":true}]}',
    '{"a":"Первый","a-Comment":"sensitive-file-metadata","b":"Второй","b-Comment":"Пояснение"}');
  assert rendered not like '%sensitive-file-metadata%' and rendered like '%Комментарий: Пояснение%',
    'Comments and aliased questions must respect attachment redaction while preserving genuine comments';
end;
$$;

do $$
declare
  owner_id uuid := auth.uid();
  test_form uuid := gen_random_uuid();
  rule uuid;
  gap_rule uuid;
  date_rule uuid;
  owner_rule uuid;
  action jsonb := '{"subject":"Письмо","body":"Кратко","mode":"summary","recipients":["fixed@example.invalid"]}';
  stamp timestamptz := now()-interval '1 day';
begin
  insert into public.forms(id,author_id,title,form_type,form_reason,schema,created_at)
  values(test_form,owner_id,'Расписание','anketa','plan','{"elements":[{"type":"text","name":"q"}]}',now()-interval '2 days');
  insert into public.responses(id,form_id,data,created_at)
    values('d7000000-0000-4000-8000-000000000001',test_form,'{"q":"yes"}',stamp);
  insert into public.responses(form_id,data,created_at)
    select test_form,'{"q":"no"}'::jsonb,stamp+make_interval(secs=>i) from generate_series(1,505) i;
  date_rule:=public.save_automation_rule(null,test_form,'Дата','',true,'date',null,null,now()-interval '1 minute',
    'all','[{"path":["q"],"op":"eq","value":"yes"}]',action);
  perform public.process_automations('https://forms.example.invalid',10);
  assert exists(select from survey_automation.targets where rule_id=date_rule and count_cursor_id is not null and not complete);
  perform public.process_automations('https://forms.example.invalid',10);
  assert exists(select from public.automation_runs where rule_id=date_rule and response_id='d7000000-0000-4000-8000-000000000001');
  rule:=public.save_automation_rule(null,test_form,'Повтор','',true,'recurring',null,15,now()-interval '1 hour','all','[]',action);
  perform public.set_automation_rule_enabled(rule,false);
  perform public.set_automation_rule_enabled(rule,true);
  assert exists(select from survey_automation.targets where rule_id=rule and next_run_at>now());
  update survey_automation.targets set next_run_at=now()-interval '30 minutes' where rule_id=rule;
  update public.profiles set is_disabled=true where id=owner_id;
  update public.profiles set is_disabled=false where id=owner_id;
  assert exists(select from survey_automation.targets where rule_id=rule and next_run_at>now());
  assert not exists(select from public.claim_mail_jobs('reactivation-check',10) q
    where q.automation_run_id in (select id from public.automation_runs where rule_id=date_rule)),
    'Reactivating a profile made a pre-disable message eligible again';

  gap_rule:=public.save_automation_rule(null,test_form,'Тишина','',true,'inactivity',null,1,null,'all','[]',action);
  insert into public.responses(id,form_id,data,created_at)
    values('d7000000-0000-4000-8000-000000000010',test_form,'{"q":"first"}',now());
  update survey_automation.targets set next_run_at=now() where rule_id=gap_rule;
  perform public.process_automations('https://forms.example.invalid',10);
  perform public.set_automation_rule_enabled(gap_rule,false);
  insert into public.responses(id,form_id,data,created_at)
    values('d7000000-0000-4000-8000-000000000011',test_form,'{"q":"second"}',now());
  perform public.set_automation_rule_enabled(gap_rule,true);
  update survey_automation.targets set next_run_at=now() where rule_id=gap_rule;
  perform public.process_automations('https://forms.example.invalid',10);
  assert (select count(*) from public.automation_runs where rule_id=gap_rule)=2, 'Tied timestamps lost the second inactivity gap';

  -- An account's egress budget is independent of other accounts and ordinary campaigns.
  update survey_automation.mail_usage set recipient_count=500 where user_id=owner_id;
  owner_rule:=public.save_automation_rule(null,test_form,'Лимит','',true,'response_received',null,null,null,'all','[]',action);
  perform public.submit_form_response(test_form,gen_random_uuid(),gen_random_uuid(),'{"q":"new"}');
  perform public.process_automations('https://forms.example.invalid',10);
  assert exists(select from public.automation_runs where rule_id=owner_rule and status='failed' and last_error like '%500%');
  assert not exists(select from public.mail_queue q join public.automation_runs r on r.id=q.automation_run_id where r.rule_id=owner_rule);
  for i in (select count(*)+1 from public.automation_rules where user_id=owner_id)..50 loop
    perform public.save_automation_rule(null,test_form,'Лимит','',false,'response_received',null,null,null,'all','[]',action);
  end loop;
  begin
    perform public.save_automation_rule(null,test_form,'Лимит','',false,'response_received',null,null,null,'all','[]',action);
    raise exception 'A 51st rule was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

set local role anon;
do $$
begin
  assert not has_function_privilege(current_user,'public.set_automation_rule_enabled(uuid,boolean)','execute');
  assert not has_table_privilege(current_user,'public.mail_queue','select');
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','a7000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$
declare
  test_form uuid := 'b7000000-0000-4000-8000-000000000002';
  action jsonb := '{"subject":"Письмо","body":"Тест","mode":"summary","recipients":["second@example.invalid"]}';
begin
  assert not exists(select from public.mail_queue) and not exists(select from public.automation_rules);
  begin
    perform public.set_automation_rule_enabled(current_setting('survey_test.foreign_rule')::uuid,true);
    raise exception 'A foreign rule ID was accepted by the enable RPC';
  exception when insufficient_privilege then null;
  end;
  perform public.save_automation_rule(null,test_form,'Другой автор','',true,'response_received',null,null,null,'all','[]',action);
  perform public.submit_form_response(test_form,gen_random_uuid(),gen_random_uuid(),'{}');
  begin
    perform public.save_automation_rule(null,'b7000000-0000-4000-8000-000000000001','Чужая форма','',true,'response_received',
      null,null,null,'all','[]',action);
    raise exception 'Editing another owner''s rules was allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select public.process_automations('https://forms.example.invalid',10);
update public.profiles set is_disabled=true where id=auth.uid();
set local role authenticated;
do $$
begin
  assert not exists(select from public.automation_rules) and not exists(select from public.mail_queue);
  begin
    perform public.mark_notifications_read(null);
    raise exception 'A disabled profile could mutate notifications';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
do $$ begin
  assert exists(select from public.mail_queue where recipient_email='second@example.invalid');
end; $$;
rollback;
