begin;
insert into auth.users(id,email) values
  ('a0000000-0000-4000-8000-000000000001','owner@example.invalid'),
  ('a0000000-0000-4000-8000-000000000002','other@example.invalid');
update public.profiles set role='admin' where id='a0000000-0000-4000-8000-000000000002';
insert into public.forms(id,title,author_id,form_type,form_reason,schema) values
  ('b0000000-0000-4000-8000-000000000001','Проверка автоматизации','a0000000-0000-4000-8000-000000000001','anketa','plan',
   '{"pages":[{"elements":[{"type":"text","name":"amount","valueName":"total","inputType":"number","title":"Количество"},{"type":"text","name":"contact","inputType":"email","title":"Получатель"},{"type":"checkbox","name":"topics","choices":["first","second"]}]}]}'),
  ('b0000000-0000-4000-8000-000000000002','Чужая форма','a0000000-0000-4000-8000-000000000002','anketa','plan','{"pages":[]}');

update public.forms set created_at=now()-interval '1 day' where title='Проверка автоматизации';
insert into public.mail_settings(host,port,username,password_encrypted,from_email,from_name,enabled)
values('smtp.invalid',465,'test','migration-encrypted-password','test@example.invalid','Test',true);

set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);

do $$
declare
  rule_id uuid;
  form_id uuid := 'b0000000-0000-4000-8000-000000000001';
  mail_action jsonb := '{"recipients":["author@example.invalid"],"subject":"{{form_title}}","body":"{{answer_count}} {{response_link}}","mode":"summary"}';
  matching jsonb := '[{"path":["total"],"op":"gt","value":5},{"path":["topics"],"op":"all_of","value":["first","second"]}]';
begin
  if not exists(select from public.automation_form_fields(form_id) where path=array['total']) then
    raise exception 'valueName was not offered as an answer field';
  end if;
  rule_id := public.save_automation_rule(null,form_id,'Каждый ответ','',true,'response_received',null,null,null,'all','[]',
    mail_action || '{"recipientPath":["contact"],"mode":"full"}');
  perform public.save_automation_rule(null,null,'Все мои формы','',true,'response_received',null,null,null,'all','[]',mail_action);
  perform public.save_automation_rule(null,form_id,'Изменение','',true,'response_updated',null,null,null,'any',matching,mail_action);
  perform public.save_automation_rule(null,form_id,'Два ответа','',true,'response_count',2,null,null,'all','[]',mail_action);
  perform public.save_automation_rule(null,form_id,'Два совпадения','',true,'matching_count',2,null,null,'all',matching,mail_action);
  perform public.save_automation_rule(null,form_id,'Все совпали','',true,'matching_share',100,null,null,'all',matching,mail_action);
  perform public.save_automation_rule(null,form_id,'Тишина','',true,'inactivity',null,60,null,'all','[]',mail_action);
  perform public.save_automation_rule(null,form_id,'Дата','',true,'date',null,null,now()-interval '1 minute','all','[]',mail_action);
  perform public.save_automation_rule(null,form_id,'Расписание','',true,'recurring',null,60,now()-interval '2 hours','all','[]',mail_action);
  perform public.save_automation_rule(null,form_id,'Выключено','',false,'response_received',null,null,null,'all','[]',mail_action);
  begin
    perform public.save_automation_rule(null,'b0000000-0000-4000-8000-000000000002','Нельзя','',true,'response_received',null,null,null,'all','[]',mail_action);
    raise exception 'A foreign form was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_automation_rule(null,form_id,'Неверный адрес','',true,'response_received',null,null,null,'all','[]',
      mail_action || '{"recipients":["Некорректный адрес"]}');
    raise exception 'Malformed email address was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.process_automations('https://forms.example.invalid',20);
    raise exception 'A staff member could invoke the scheduler';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select * from public.submit_form_response(
  'b0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',
  '{"total":4,"contact":"recipient@пример.рф","topics":["first"]}');
select * from public.submit_form_response(
  'b0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',
  '{"total":4,"contact":"recipient@пример.рф","topics":["first"]}');
select * from public.submit_form_response(
  'b0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002',
  '{"total":10,"contact":"other-recipient@пример.рф","topics":["first","second"]}');
reset role;

update public.responses set data='{"total":12,"contact":"recipient@пример.рф","topics":["first","second"]}'
  where submission_id='d0000000-0000-4000-8000-000000000001';
update public.responses set data=data where submission_id='d0000000-0000-4000-8000-000000000001';

-- Time moves independently of the worker's polling cadence.
update survey_automation.targets set next_run_at=now()-interval '1 minute'
where rule_id=(select id from public.automation_rules where event_type='inactivity');
set local role service_role;
select public.process_automations('https://forms.example.invalid',100);
select public.process_automations('https://forms.example.invalid',100);
reset role;

do $$
declare job public.mail_queue; failed_job boolean := false;
begin
  if (select count(*) from public.automation_runs)<>11 then
    raise exception 'Expected 11 runs across all 8 event types, got %', (select count(*) from public.automation_runs);
  end if;
  if (select count(*) from public.mail_queue)<>13 or
    not exists(select from public.mail_queue where recipient_email='recipient@пример.рф'
      and body_text like '%https://forms.example.invalid/dashboard/forms/%/responses?response=%'
      and body_text like '%Количество: 4%')
  then raise exception 'Expected separate, deduplicated recipients and a response link'; end if;
  for job in select * from public.claim_mail_jobs('test-worker',100) loop
    perform public.finish_mail_job(job.id,'test-worker',failed_job,'Тестовая ошибка SMTP');
    failed_job := true;
  end loop;
  if (select count(*) from public.automation_runs where status='failed')<>1 or
     (select count(*) from public.automation_runs where status='succeeded')<>10 then
    raise exception 'Terminal delivery results were not recorded';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000002',true);
do $$
begin
  if exists(select from public.automation_runs) or exists(select from public.notifications) or
      exists(select from public.mail_batches where kind='automation') then
    raise exception 'An unrelated administrator read personal activity';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
do $$
declare entry uuid;
begin
  if (select count(*) from public.notifications where category='response_received')<>2 or
     (select count(*) from public.notifications where category='response_updated')<>1 or
     (select count(*) from public.notifications where category='automation_succeeded')<>10 or
     (select count(*) from public.notifications where category='automation_failed')<>1 then
    raise exception 'Unexpected personal notification history';
  end if;
  select id into entry from public.notifications order by created_at,id limit 1;
  perform public.mark_notifications_read(entry);
  if (select count(*) from public.notifications where read_at is not null)<>1 then
    raise exception 'Marking one read changed other notifications';
  end if;
  perform public.mark_notifications_read(null);
  if exists(select from public.notifications where read_at is null) then
    raise exception 'Marking all read failed';
  end if;
  perform public.save_notification_preferences(array['form_status']);
  update public.forms set is_public=false where title='Проверка автоматизации';
  if exists(select from public.notifications where category='form_status') then
    raise exception 'Disabled notification category was created';
  end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
do $$
declare
  form_id uuid := 'b0000000-0000-4000-8000-000000000001';
  inactivity_id uuid;
  recurring_id uuid;
  receipt_rule uuid;
  expired_job uuid;
begin
  select id into inactivity_id from public.automation_rules where event_type='inactivity';
  select id into recurring_id from public.automation_rules where event_type='recurring';
  select id into receipt_rule from public.automation_rules where name='Каждый ответ';

  -- A new response starts a fresh inactivity period and a later slot re-arms the periodic rule.
  update public.forms f set is_public=true where f.id=form_id;
  perform public.submit_form_response(form_id,gen_random_uuid(),gen_random_uuid(),
    '{"total":13,"contact":"recipient@пример.рф","topics":["first","second"]}');
  update survey_automation.targets t set next_run_at=now()-interval '1 minute' where t.rule_id=inactivity_id;
  perform survey_automation.process_schedules(now()+interval '1 hour 1 minute',100);
  perform public.process_automations('https://forms.example.invalid',100);
  if (select count(*) from public.automation_runs where rule_id=inactivity_id)<>2 or
     (select count(*) from public.automation_runs where rule_id=recurring_id)<>2 or
     exists (select rule_id from public.automation_runs where event_key='threshold' group by rule_id having count(*)<>1) then
    raise exception 'Repeated inactivity, schedule slots or threshold de-duplication is incorrect';
  end if;

  -- Disabling and re-enabling a rule also cancels the old pending deliveries.
  perform set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
  perform public.set_automation_rule_enabled(receipt_rule,false);
  perform public.set_automation_rule_enabled(receipt_rule,true);
  perform set_config('request.jwt.claim.sub','',true);
  if exists (select from public.claim_mail_jobs('lease-test',100) q
    join public.automation_runs r on r.id=q.automation_run_id where r.rule_id=receipt_rule) then
    raise exception 'An email staged before disabling the rule was claimed again';
  end if;
  select id into expired_job from public.mail_queue where status='processing' order by id limit 1;
  if expired_job is null then raise exception 'Expected a job in processing'; end if;
  update public.mail_queue set locked_at=now()-interval '11 minutes' where id=expired_job;
  if exists(select from public.claim_mail_jobs('other-worker',100) q where q.id=expired_job) then
    raise exception 'An uncertain SMTP delivery was reclaimed';
  end if;
  perform public.process_automations('https://forms.example.invalid',100);
  if (select status from public.mail_queue where id=expired_job)<>'failed' then
    raise exception 'The uncertain delivery did not become a visible failure';
  end if;
end;
$$;
rollback;
