begin;

insert into auth.users(id,email) values
  ('e4000000-0000-4000-8000-000000000001','form-close-owner@example.invalid'),
  ('e4000000-0000-4000-8000-000000000002','form-close-other@example.invalid');
select set_config('request.jwt.claim.sub','e4000000-0000-4000-8000-000000000001',true);

do $$
declare
  owner_id uuid := auth.uid();
  other_owner uuid := 'e4000000-0000-4000-8000-000000000002';
  manual_form uuid := gen_random_uuid();
  limit_form uuid := gen_random_uuid();
  deadline_form uuid := gen_random_uuid();
  extended_form uuid := gen_random_uuid();
  changed_before_deadline uuid := gen_random_uuid();
  past_form uuid := gen_random_uuid();
  foreign_form uuid := gen_random_uuid();
  inactive_form uuid := gen_random_uuid();
  closing_rule uuid;
  later_rule uuid;
  resumed_rule uuid;
  deadline timestamptz;
  mail_action jsonb := '{"recipients":["staff@example.invalid"],"subject":"{{form_title}}: сбор завершён","body":"Ответов: {{answer_count}}. {{form_link}}","mode":"summary"}';
begin
  insert into public.forms(id,title,author_id,form_type,form_reason,schema,is_public)
    values(manual_form,'Manual',owner_id,'anketa','plan','{}',true),
      (foreign_form,'Foreign',other_owner,'anketa','plan','{}',true),
      (inactive_form,'Inactive',owner_id,'anketa','plan','{}',false);

  closing_rule := public.save_automation_rule(null,null,'Сбор завершён','',true,'form_closed',
    null,null,null,'all','[]',mail_action);
  begin
    perform public.save_automation_rule(null,manual_form,'Отдельная форма','',true,'form_closed',
      null,null,null,'all','[]',mail_action);
    raise exception 'Allowed a scoped rule';
  exception when invalid_parameter_value then null;
  end;

  assert not exists (select from public.automation_runs where rule_id=closing_rule), 'Existing closed forms were backfilled';
  update public.forms set is_public=false where id in (manual_form,foreign_form,inactive_form);
  update public.forms set is_public=false where id=manual_form;
  assert (select count(*) from public.automation_runs where rule_id=closing_rule)=1, 'Manual closure was duplicated or escaped its owner';
  assert exists (select from public.automation_runs where rule_id=closing_rule and form_id=manual_form
    and event_key like 'closed:manual:%'), 'Manual closure did not stage a run';
  update public.forms set is_public=true where id=manual_form;
  update public.forms set is_public=false where id=manual_form;
  assert (select count(*) from public.automation_runs where rule_id=closing_rule and form_id=manual_form)=2,
    'Reopening the form did not permit a new closing event';

  insert into public.forms(id,title,author_id,form_type,form_reason,schema,is_public,max_responses)
    values(limit_form,'Limit',owner_id,'anketa','plan','{"pages":[]}',true,2);
  perform public.submit_form_response(limit_form,gen_random_uuid(),gen_random_uuid(),'{}'::jsonb);
  assert not exists (select from public.automation_runs where rule_id=closing_rule and form_id=limit_form),
    'A response below the limit triggered closure';
  perform public.submit_form_response(limit_form,gen_random_uuid(),gen_random_uuid(),'{}'::jsonb);
  assert exists (select from public.automation_runs r join survey_automation.payloads p on p.run_id=r.id
    where r.rule_id=closing_rule and r.form_id=limit_form and r.event_key like 'closed:limit:%'
      and r.response_id is null and p.payload->>'answerCount'='2'), 'Limit closure did not capture the final count';

  resumed_rule := public.save_automation_rule(null,null,'Выключено до срока','',true,'form_closed',
    null,null,null,'all','[]',mail_action);
  deadline := clock_timestamp()+interval '300 milliseconds';
  insert into public.forms(id,title,author_id,form_type,form_reason,schema,is_public,deadline_at)
    values(deadline_form,'Due',owner_id,'anketa','plan','{}',true,deadline),
      (extended_form,'Extended',owner_id,'anketa','plan','{}',true,deadline),
      (changed_before_deadline,'Moved before expiry',owner_id,'anketa','plan','{}',true,deadline),
      (past_form,'Shortened',owner_id,'anketa','plan','{}',true,deadline+interval '1 day');
  update public.forms set deadline_at=deadline+interval '1 day' where id=changed_before_deadline;
  perform public.set_automation_rule_enabled(resumed_rule,false);
  perform pg_sleep_until(deadline+interval '10 milliseconds');
  perform public.set_automation_rule_enabled(resumed_rule,true);
  later_rule := public.save_automation_rule(null,null,'Создано после срока','',true,'form_closed',
    null,null,null,'all','[]',mail_action);
  update public.forms set deadline_at=clock_timestamp()+interval '1 day',form_type='monitoring' where id=extended_form;
  update public.forms set deadline_at=clock_timestamp()-interval '1 day' where id=past_form;
  perform survey_automation.process_schedules(clock_timestamp(),50);
  perform survey_automation.process_schedules(clock_timestamp(),50);
  update public.forms set is_public=false where id=deadline_form;

  assert (select count(*) from public.automation_runs where rule_id=closing_rule
    and form_id in (deadline_form,extended_form,past_form) and event_key like 'closed:deadline:%')=3,
    'Deadline sweep or edit lost a real closure or delivered it twice';
  assert not exists (select from public.automation_runs where rule_id in (later_rule,resumed_rule)
    and form_id in (deadline_form,extended_form)),
    'Enabling a rule after expiry replayed a deadline';
  assert not exists (select from public.automation_runs where form_id=changed_before_deadline),
    'Extending an active deadline sent an obsolete closing email';
  assert exists (select from public.automation_runs where rule_id=later_rule and form_id=past_form),
    'Applying a deadline in the past should close a currently open form now';

  insert into public.mail_settings(host,port,username,password_encrypted,from_email,from_name,enabled)
  values('smtp.invalid',465,'test','test-encrypted-password','review@example.invalid','Review',true);
  perform public.process_automations('https://forms.example.invalid',50);
  assert exists (select from public.mail_queue q join public.automation_runs r on r.id=q.automation_run_id
    where r.rule_id=closing_rule and r.form_id=limit_form and r.status='queued'
      and q.recipient_email='staff@example.invalid' and q.body_text like 'Ответов: 2.%/responses'),
    'Closing run did not queue the expected summary email';
end;
$$;

rollback;
