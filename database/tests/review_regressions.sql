begin;

insert into auth.users(id,email) values ('fe110000-0000-4000-8000-000000000001','review-owner@example.invalid');
select set_config('request.jwt.claim.sub','fe110000-0000-4000-8000-000000000001',true);

do $$
declare
  form_id uuid := gen_random_uuid();
  batch uuid := gen_random_uuid();
  exhausted uuid := gen_random_uuid();
  retryable uuid := gen_random_uuid();
  next_job uuid := gen_random_uuid();
  in_flight uuid := gen_random_uuid();
  owner_id uuid := auth.uid();
  jobs uuid[];
begin
  insert into public.forms(id,title,author_id,form_type,form_reason,schema)
  values(form_id,'Queue limit',owner_id,'anketa','plan','{"pages":[]}');
  insert into public.mail_batches(id,kind,form_id,created_by,total_count)
  values(batch,'reminder',form_id,owner_id,4);
  insert into public.mail_queue(id,batch_id,form_id,recipient_email,recipient_name,subject,body_text,
    status,attempts,locked_at,locked_by,next_attempt_at)
  values
    (exhausted,batch,form_id,'exhausted@example.invalid','Exhausted','Fixture','Fixture','processing',20,now()-interval '11 minutes','old',now()-interval '1 hour'),
    (retryable,batch,form_id,'retry@example.invalid','Retry','Fixture','Fixture','processing',2,now()-interval '11 minutes','old',now()-interval '10 minutes'),
    (next_job,batch,form_id,'next@example.invalid','Next','Fixture','Fixture','queued',0,null,null,now()),
    (in_flight,batch,form_id,'sending@example.invalid','Active','Fixture','Fixture','processing',3,now(),'old',now());

  select array_agg(q.id) into jobs from public.claim_mail_jobs('retry-worker',10) q;
  assert cardinality(jobs)=2 and jobs @> array[retryable,next_job], 'A spent lease blocked otherwise eligible mail';
  assert exists (select from public.mail_queue where id=exhausted and status='failed' and attempts=20
    and locked_at is null and locked_by is null and last_error is not null), 'An expired spent lease was not finalized';
  assert exists (select from public.mail_queue where id=retryable and status='processing' and attempts=3
    and locked_by='retry-worker'), 'A lease with attempts remaining was not reclaimed';
  assert public.finish_mail_job(in_flight,'old',true)= 'sent', 'A live SMTP claim on its final attempt was invalidated';
end;
$$;

insert into public.mail_settings(host,port,username,password_encrypted,from_email,from_name,enabled)
values('smtp.invalid',465,'test','test-encrypted-password','review@example.invalid','Review',true);

do $$
declare
  test_form uuid := gen_random_uuid();
  rule uuid;
  queued_run uuid;
  pending_run uuid;
  old_version integer;
  claimed_job public.mail_queue;
  claimed_sent text;
  action jsonb := '{"recipients":["keep@example.invalid","remove@example.invalid"],"subject":"Review","body":"{{response}}","mode":"full"}';
begin
  insert into public.forms(id,title,author_id,form_type,form_reason,schema)
  values(test_form,'Review form',auth.uid(),'anketa','plan','{"pages":[{"elements":[{"type":"text","name":"note"}]}]}');
  rule := public.save_automation_rule(null,test_form,'Review rule','',true,'response_received',null,null,null,'all','[]',action);
  perform public.submit_form_response(test_form,gen_random_uuid(),gen_random_uuid(),'{"note":"Private"}');
  perform public.process_automations('https://forms.example.invalid',50);
  select id into strict queued_run from public.automation_runs where rule_id=rule;
  select q.* into strict claimed_job from public.claim_mail_jobs('in-flight',1) q where q.automation_run_id=queued_run;

  perform public.submit_form_response(test_form,gen_random_uuid(),gen_random_uuid(),'{"note":"New private answer"}');
  select id into strict pending_run from public.automation_runs where rule_id=rule and status='pending';
  select delivery_version into old_version from public.automation_rules where id=rule;
  perform public.save_automation_rule(rule,test_form,'Renamed rule','Description',true,'response_received',null,null,null,'all','[]',
    action || '{"recipients":[" REMOVE@example.invalid ","KEEP@example.invalid","keep@example.invalid"]}');
  assert (select delivery_version from public.automation_rules where id=rule)=old_version,
    'Changing the title or using an equivalent canonical recipient list invalidated existing runs';

  action := action || '{"recipients":["keep@example.invalid"],"mode":"summary"}';
  perform public.save_automation_rule(rule,test_form,'Renamed rule','Description',true,'response_received',null,null,null,'all','[]',action);
  assert not exists (select from public.claim_mail_jobs('new-claim',100) q where q.automation_run_id=queued_run),
    'A changed email could still be claimed for its old recipient';
  perform public.process_automations('https://forms.example.invalid',50);
  assert (select status from public.automation_runs where id=pending_run)='cancelled'
    and not exists (select from public.mail_queue where automation_run_id=pending_run),
    'An old pending run generated email after the rule changed';
  claimed_sent := public.finish_mail_job(claimed_job.id,'in-flight',true);
  assert claimed_sent='sent' and exists (select from public.automation_runs where id=queued_run and status='cancelled'
    and sent_count=1 and cancelled_count=1), 'Cancelling queued work changed the outcome of an already claimed job';

  perform public.submit_form_response(test_form,gen_random_uuid(),gen_random_uuid(),'{"note":"Newest answer"}');
  perform public.process_automations('https://forms.example.invalid',50);
  assert (select count(*) from public.mail_queue q join public.automation_runs r on r.id=q.automation_run_id
    where r.rule_id=rule and q.status='queued' and q.recipient_email='keep@example.invalid')=1,
    'The edited rule did not deliver using its new settings';
end;
$$;

insert into auth.users(id,email) values ('fe110000-0000-4000-8000-000000000002','review-other@example.invalid');

do $$
declare
  owner_id uuid := auth.uid();
  archived_rule public.automation_rules;
  old_version integer;
  archive_stamp timestamptz;
  run_count integer;
  action jsonb := '{"recipients":["keep@example.invalid"],"subject":"Review","body":"Review","mode":"summary"}';
begin
  select * into strict archived_rule from public.automation_rules where user_id=owner_id and name='Renamed rule';
  old_version := archived_rule.delivery_version;
  select count(*) into run_count from public.automation_runs where rule_id=archived_rule.id;
  insert into public.automation_rules(user_id,name,enabled,event_type,match_mode,conditions,action_config)
  select owner_id,'Additional rule',false,'response_received','all','[]',action from generate_series(1,49);
  begin
    perform public.save_automation_rule(null,null,'New rule','',false,'response_received',null,null,null,'all','[]',action);
    raise exception 'Saving a 51st rule bypassed the limit';
  exception when invalid_parameter_value then null;
  end;

  assert has_function_privilege('authenticated','public.archive_automation_rule(uuid)','execute')
    and not has_function_privilege('anon','public.archive_automation_rule(uuid)','execute'),
    'The archive RPC must be available only to signed-in users';
  perform set_config('request.jwt.claim.sub','fe110000-0000-4000-8000-000000000002',true);
  begin
    perform public.archive_automation_rule(archived_rule.id);
    raise exception 'Archiving another owner''s rule was accepted';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);

  perform public.archive_automation_rule(archived_rule.id);
  select r.archived_at into archive_stamp from public.automation_rules r where r.id=archived_rule.id
    and not r.enabled and r.delivery_version=old_version+1;
  assert archive_stamp is not null, 'Archiving did not deactivate the rule and its queued delivery';
  perform public.archive_automation_rule(archived_rule.id);
  assert exists (select from public.automation_rules r where r.id=archived_rule.id
    and r.archived_at=archive_stamp and r.delivery_version=old_version+1), 'Archiving was not idempotent';

  perform public.save_automation_rule(null,null,'New rule','',false,'response_received',null,null,null,'all','[]',action);
  begin
    perform public.set_automation_rule_enabled(archived_rule.id,true);
    raise exception 'An archived rule was enabled';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_automation_rule(archived_rule.id,archived_rule.form_id,'New title','',false,
      'response_received',null,null,null,'all','[]',action);
    raise exception 'An archived rule was edited';
  exception when insufficient_privilege then null;
  end;

  assert not exists (select from public.claim_mail_jobs('archived-claim',100) q
    join public.automation_runs r on r.id=q.automation_run_id where r.rule_id=archived_rule.id),
    'An archived rule still offered jobs for delivery';
  perform public.process_automations('https://forms.example.invalid',50);
  assert (select count(*) from public.automation_runs where rule_id=archived_rule.id)=run_count
    and exists (select from public.automation_runs where rule_id=archived_rule.id and sent_count=1)
    and not exists (select from public.automation_runs where rule_id=archived_rule.id and status in ('queued','pending')),
    'Archiving lost delivery history or left work active';
end;
$$;

do $$
begin
  perform public.save_notification_preferences(array['form_status','form_status','form_status','form_status','response_updated']);
  assert (select muted_categories from public.notification_preferences where user_id=auth.uid()) =
    array['form_status','response_updated'], 'Repeated categories were not saved as a set';

  begin
    perform public.list_notification_feed(p_before_at => now());
    raise exception 'The feed accepted a timestamp without its matching id';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.list_notification_feed(p_before_id => gen_random_uuid());
    raise exception 'The feed accepted an id without its matching timestamp';
  exception when invalid_parameter_value then null;
  end;

  assert not exists (select from survey_automation.form_fields(
    '{"type":"paneldynamic","templateElements":[{"type":"text","name":"orphan"}]}')),
    'A repeating panel without a response key exposed invalid condition paths';
  assert exists (select from survey_automation.form_fields(
    '{"type":"paneldynamic","valueName":"items","templateElements":[{"type":"text","name":"name"}]}')
    where path=array['items','name'] and label='items / name'), 'A repeating panel with valueName alone did not resolve';

  assert survey_automation.condition_matches('5.0','{"op":"eq","value":"5"}'),
    'A numeric response was compared at its display scale';
  assert survey_automation.condition_matches('"5.0"','{"op":"eq","value":5}'),
    'A numeric condition was compared at its display scale';
  assert not survey_automation.condition_matches('"005"','{"op":"eq","value":"5"}'),
    'A comparison of two text identifiers coerced them to numbers';
end;
$$;

do $$
declare
  first_form uuid := gen_random_uuid();
  second_form uuid := gen_random_uuid();
  rule uuid;
begin
  perform set_config('request.jwt.claim.sub','fe110000-0000-4000-8000-000000000002',true);
  insert into public.forms(id,title,author_id,form_type,form_reason,schema)
  values (first_form,'Completed threshold',auth.uid(),'anketa','plan','{}'),
    (second_form,'Ready threshold',auth.uid(),'anketa','plan','{}');
  insert into public.responses(form_id,data) values(second_form,'{}');
  rule := public.save_automation_rule(null,null,'Threshold','',true,'response_count',1,null,null,'all','[]',
    '{"recipients":["threshold@example.invalid"],"subject":"Review","body":"Review","mode":"summary"}');
  update survey_automation.targets set complete=true,check_at=now()-interval '1 minute'
  where rule_id=rule and form_id=first_form;
  update survey_automation.targets set matching_count=1,check_at=now() where rule_id=rule and form_id=second_form;

  perform survey_automation.process_threshold_checks(1);
  assert exists (select from public.automation_runs where rule_id=rule and form_id=second_form),
    'A stale completed target occupied a slot needed for a ready threshold check';
end;
$$;

rollback;
