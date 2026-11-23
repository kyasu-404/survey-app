begin;

alter table public.automation_rules
  drop constraint automation_rules_event_type_check,
  add constraint automation_rules_event_type_check check (event_type in (
    'response_received','response_updated','response_count','matching_count','matching_share',
    'inactivity','date','recurring','form_closed')),
  add constraint automation_rules_form_closed_global check (event_type<>'form_closed' or form_id is null);

alter table survey_automation.targets add column form_close_armed_at timestamptz;

create or replace function survey_automation.seed_targets(p_rule public.automation_rules,p_only_form uuid default null)
returns void language sql set search_path = '' as $$
  insert into survey_automation.targets(rule_id,form_id,next_run_at,last_received_at,gap_key,matching_count,count_ready,form_close_armed_at)
  select p_rule.id,f.id,
    case p_rule.event_type
      when 'date' then case when p_rule.scheduled_at>=f.created_at then p_rule.scheduled_at end
      when 'recurring' then case when f.created_at<=p_rule.scheduled_at then p_rule.scheduled_at
        else survey_automation.schedule_slot(p_rule.scheduled_at,p_rule.interval_minutes,f.created_at) + make_interval(mins=>p_rule.interval_minutes) end
      when 'inactivity' then greatest(now(),f.created_at,latest.created_at)+make_interval(mins=>p_rule.interval_minutes)
    end,
    latest.created_at,coalesce(latest.id::text,'none'),0,
    p_rule.conditions='[]'::jsonb or p_rule.event_type not in ('response_count','matching_count','matching_share'),
    case when p_rule.event_type='form_closed' then clock_timestamp() end
  from public.forms f
  left join lateral (
    select r.id,r.created_at from public.responses r
    where p_rule.event_type='inactivity' and r.form_id=f.id order by r.created_at desc,r.id desc limit 1
  ) latest on true
  where p_rule.enabled and f.author_id=p_rule.user_id and f.form_type<>'template'
    and (p_rule.form_id is null or f.id=p_rule.form_id) and (p_only_form is null or f.id=p_only_form)
  on conflict (rule_id,form_id) do update set
    matching_count=excluded.matching_count,
    count_ready=excluded.count_ready,
    count_cursor_at=null,
    count_cursor_id=null,
    schedule_slot_at=null,
    form_close_armed_at=coalesce(targets.form_close_armed_at,excluded.form_close_armed_at),
    check_at=null,
    check_response_id=null,
    last_received_at=greatest(targets.last_received_at,excluded.last_received_at),
    gap_key=case when targets.last_received_at is null or
      (excluded.last_received_at,excluded.gap_key)>(targets.last_received_at,targets.gap_key)
      then excluded.gap_key else targets.gap_key end,
    next_run_at=case when targets.complete then null
      when p_rule.event_type='inactivity' and targets.next_run_at is null
        and (excluded.last_received_at is null or (excluded.last_received_at,excluded.gap_key)
          <=(targets.last_received_at,targets.gap_key)) then null
      when p_rule.event_type='recurring' then coalesce(targets.next_run_at,excluded.next_run_at)
      else excluded.next_run_at end;
$$;

create or replace function survey_automation.resume_targets(p_rule public.automation_rules)
returns void language plpgsql set search_path = '' as $$
begin
  perform survey_automation.seed_targets(p_rule);
  if p_rule.event_type='recurring' then
    update survey_automation.targets set next_run_at=
      survey_automation.schedule_slot(p_rule.scheduled_at,p_rule.interval_minutes,now())+make_interval(mins=>p_rule.interval_minutes)
    where rule_id=p_rule.id and next_run_at<=now();
  elsif p_rule.event_type='form_closed' then
    update survey_automation.targets set form_close_armed_at=clock_timestamp() where rule_id=p_rule.id;
  end if;
end;
$$;

create or replace function public.save_automation_rule(
  p_id uuid,p_form_id uuid,p_name text,p_description text,p_enabled boolean,p_event_type text,
  p_threshold numeric,p_interval_minutes integer,p_scheduled_at timestamptz,p_match_mode text,
  p_conditions jsonb,p_action jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  schema_json jsonb;
  previous public.automation_rules;
  saved public.automation_rules;
  event_changed boolean;
  condition jsonb;
  recipients text[];
begin
  if not public.request_is_enabled() then raise exception 'Нет доступа' using errcode='42501'; end if;
  if p_form_id is not null then
    select f.schema into schema_json from public.forms f
    where f.id=p_form_id and f.author_id=actor and f.form_type<>'template';
    if not found then raise exception 'Выберите свою форму' using errcode='42501'; end if;
  end if;

  p_name:=btrim(p_name,E' \t\n\r\f\013');
  p_description:=coalesce(btrim(p_description,E' \t\n\r\f\013'),'');
  if p_enabled is null or coalesce(char_length(btrim(p_name)),0) not between 1 and 120
    or char_length(p_description)>1000 or coalesce(p_event_type,'') not in (
      'response_received','response_updated','response_count','matching_count','matching_share','inactivity','date','recurring','form_closed')
    or coalesce(p_match_mode,'') not in ('all','any') then
    raise exception 'Проверьте название и настройки события' using errcode='22023';
  end if;
  if p_event_type='form_closed' and p_form_id is not null then
    raise exception 'Завершение сбора ответов доступно только для общих автоматизаций' using errcode='22023';
  end if;
  if (p_event_type in ('response_count','matching_count') and
      (p_threshold is null or p_threshold not between 1 and 100000 or trunc(p_threshold)<>p_threshold))
    or (p_event_type='matching_share' and (p_threshold is null or p_threshold not between 0.01 and 100))
    or (p_event_type in ('inactivity','recurring') and (p_interval_minutes is null or p_interval_minutes not between 1 and 525600))
    or (p_event_type='recurring' and p_interval_minutes<15)
    or (p_event_type in ('date','recurring') and (p_scheduled_at is null or not isfinite(p_scheduled_at)
      or p_scheduled_at not between '2000-01-01 UTC'::timestamptz and '2200-01-01 UTC'::timestamptz)) then
    raise exception 'Проверьте порог, дату или интервал' using errcode='22023';
  end if;
  if p_event_type not in ('response_count','matching_count','matching_share') then p_threshold:=null; end if;
  if p_event_type not in ('inactivity','recurring') then p_interval_minutes:=null; end if;
  if p_event_type not in ('date','recurring') then p_scheduled_at:=null; end if;

  if jsonb_typeof(p_conditions) is distinct from 'array' or octet_length(p_conditions::text)>30000 then
    raise exception 'Некорректные условия' using errcode='22023';
  end if;
  if jsonb_array_length(p_conditions)>12 then raise exception 'Можно добавить до 12 условий' using errcode='22023'; end if;
  for condition in select value from jsonb_array_elements(p_conditions) loop
    if jsonb_typeof(condition) is distinct from 'object' or jsonb_typeof(condition->'path') is distinct from 'array'
      or not exists (select from survey_automation.form_fields(schema_json) q where to_jsonb(q.path)=condition->'path') then
      raise exception 'Выберите вопрос для каждого условия' using errcode='22023';
    end if;
    case condition->>'op'
      when 'eq','contains' then
        if coalesce(jsonb_typeof(condition->'value'),'') not in ('string','number','boolean')
          or char_length(btrim(condition->>'value',E' \t\n\r\f\013')) not between 1 and 2000 then
          raise exception 'Укажите значение для сравнения' using errcode='22023';
        end if;
      when 'gt','lt' then
        if survey_automation.number(condition->'value') is null then raise exception 'Введите число для сравнения' using errcode='22023'; end if;
      when 'any_of','all_of' then
        if jsonb_typeof(condition->'value') is distinct from 'array' then raise exception 'Выберите варианты ответа' using errcode='22023'; end if;
        if jsonb_array_length(condition->'value') not between 1 and 50 or exists (
          select from jsonb_array_elements(condition->'value') v
          where jsonb_typeof(v) not in ('string','number','boolean') or char_length(v #>> '{}') not between 1 and 1000
        ) then raise exception 'Выберите от 1 до 50 вариантов ответа' using errcode='22023'; end if;
      else raise exception 'Неизвестное сравнение' using errcode='22023';
    end case;
  end loop;

  if jsonb_typeof(p_action) is distinct from 'object' or octet_length(p_action::text)>56000 or
    jsonb_typeof(p_action->'recipients') is distinct from 'array' or
    jsonb_typeof(p_action->'subject') is distinct from 'string' or coalesce(char_length(btrim(p_action->>'subject',E' \t\n\r\f\013')),0) not between 1 and 500 or
    jsonb_typeof(p_action->'body') is distinct from 'string' or coalesce(char_length(btrim(p_action->>'body',E' \t\n\r\f\013')),0) not between 1 and 10000 or
    coalesce(p_action->>'mode','') not in ('summary','full') then
    raise exception 'Проверьте параметры письма' using errcode='22023';
  end if;
  if jsonb_array_length(p_action->'recipients')>50 or exists (
    select from jsonb_array_elements(p_action->'recipients') r
    where jsonb_typeof(r)<>'string' or survey_automation.email_address(r #>> '{}') is null
  ) then raise exception 'Укажите до 50 корректных адресов электронной почты' using errcode='22023'; end if;
  select coalesce(array_agg(distinct survey_automation.email_address(r) order by survey_automation.email_address(r)),'{}')
    into recipients from jsonb_array_elements_text(p_action->'recipients') r;
  if p_action ? 'recipientPath' and p_action->'recipientPath'<>'null'::jsonb then
    if not survey_automation.allowed_recipient_path(schema_json,p_action || jsonb_build_object('recipients',recipients)) then
      raise exception 'Выберите один вопрос «Организация» вне повторяющейся панели, краткое письмо и до 49 дополнительных адресов' using errcode='22023';
    end if;
  elsif cardinality(recipients)=0 then raise exception 'Укажите получателя письма' using errcode='22023';
  end if;

  p_action:=jsonb_strip_nulls(jsonb_build_object('recipients',recipients,'subject',btrim(p_action->>'subject',E' \t\n\r\f\013'),
    'body',btrim(p_action->>'body',E' \t\n\r\f\013'),'mode',p_action->>'mode','recipientPath',p_action->'recipientPath'));
  -- Serialize rule changes with new forms so an all-forms rule always gets a target.
  perform pg_advisory_xact_lock(hashtextextended('survey-automation-owner:'||actor::text,0));
  if p_id is not null then
    select * into previous from public.automation_rules where id=p_id and user_id=actor;
    if not found then raise exception 'Правило не найдено' using errcode='42501'; end if;
    if previous.archived_at is not null then raise exception 'Правило в архиве' using errcode='42501'; end if;
  end if;
  event_changed:=p_id is null or row(previous.form_id,previous.event_type,previous.threshold,previous.interval_minutes,
    previous.scheduled_at,previous.match_mode,previous.conditions) is distinct from
    row(p_form_id,p_event_type,p_threshold,p_interval_minutes,p_scheduled_at,p_match_mode,p_conditions);
  -- Deletion locks forms before cascading to rules and their targets.
  perform from public.forms f
  where f.id in (previous.form_id,p_form_id)
    or (p_enabled and p_form_id is null and (event_changed or not previous.enabled)
      and f.author_id=actor and f.form_type<>'template')
  order by f.id for key share;
  if p_form_id is not null and not exists (
    select from public.forms f where f.id=p_form_id and f.author_id=actor and f.form_type<>'template'
  ) then raise exception 'Выберите свою форму' using errcode='42501'; end if;

  if p_id is null then
    if (select count(*) from public.automation_rules where user_id=actor and archived_at is null)>=50 then
      raise exception 'На одну учётную запись доступно до 50 правил' using errcode='22023';
    end if;
    insert into public.automation_rules(user_id,form_id,name,description,enabled,event_type,threshold,interval_minutes,
        scheduled_at,match_mode,conditions,action_config)
      values(actor,p_form_id,btrim(p_name),p_description,p_enabled,p_event_type,p_threshold,p_interval_minutes,
        p_scheduled_at,p_match_mode,p_conditions,p_action)
      returning * into saved;
  else
    update public.automation_rules set form_id=p_form_id,name=btrim(p_name),description=p_description,
      enabled=p_enabled,event_type=p_event_type,threshold=p_threshold,interval_minutes=p_interval_minutes,scheduled_at=p_scheduled_at,
      match_mode=p_match_mode,conditions=p_conditions,action_config=p_action,updated_at=now(),
      event_version=event_version+event_changed::integer,
      delivery_version=delivery_version+((previous.enabled and not p_enabled) or previous.action_config is distinct from p_action)::integer
      where id=p_id and user_id=actor returning * into saved;
    if not found then raise exception 'Правило не найдено' using errcode='42501'; end if;
    if event_changed then delete from survey_automation.targets where rule_id=p_id; end if;
  end if;
  if saved.enabled then
    if previous.enabled=false then perform survey_automation.resume_targets(saved);
    elsif event_changed then perform survey_automation.seed_targets(saved);
    end if;
  end if;
  return saved.id;
end;
$$;

create or replace function survey_automation.stage_form_closed(p_form public.forms,p_event_key text,p_closed_at timestamptz)
returns void language sql set search_path = '' as $$
  select survey_automation.stage_run(a,p_form,p_event_key,null)
  from public.automation_rules a
  join survey_automation.targets t on t.rule_id=a.id and t.form_id=p_form.id
  join public.profiles p on p.id=a.user_id and not p.is_disabled
  where a.user_id=p_form.author_id and a.enabled and a.form_id is null and a.event_type='form_closed'
    and t.form_close_armed_at<=p_closed_at
  order by a.id;
$$;

create or replace function survey_automation.on_form_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  a public.automation_rules;
  owner uuid;
  content text;
  changed_at timestamptz;
begin
  if tg_op='UPDATE' and old.author_id=new.author_id and old.form_type=new.form_type
    and old.deadline_at is not distinct from new.deadline_at and old.is_public=new.is_public then return new;
  end if;
  if tg_op='INSERT' or old.author_id<>new.author_id or old.form_type<>new.form_type then
    for owner in select distinct id from unnest(array[old.author_id,new.author_id]) id where id is not null order by id loop
      perform pg_advisory_xact_lock(hashtextextended('survey-automation-owner:'||owner::text,0));
    end loop;
    if tg_op='UPDATE' then
      delete from survey_automation.targets t using public.automation_rules r
      where t.form_id=new.id and r.id=t.rule_id and (r.user_id<>new.author_id or new.form_type='template');
    end if;
    if new.form_type<>'template' then
      for a in select * from public.automation_rules
        where user_id=new.author_id and enabled and (form_id is null or form_id=new.id) order by id
      loop
        perform survey_automation.seed_targets(a,new.id);
      end loop;
    end if;
  end if;

  changed_at:=clock_timestamp();
  if tg_op='UPDATE' and old.form_type<>'template' and new.form_type<>'template'
    and old.author_id=new.author_id and old.is_public then
    if old.deadline_at<=changed_at then
      -- Preserve expiry when the deadline or publication is edited before the
      -- worker has consumed its deadline row. The row is always guarded by the form lock.
      if exists (select from survey_automation.form_deadlines d where d.form_id=old.id and d.due_at=old.deadline_at) then
        perform survey_automation.stage_form_closed(old,
          'closed:deadline:'||extract(epoch from old.deadline_at)::text,old.deadline_at);
      end if;
    elsif not new.is_public then
      perform survey_automation.stage_form_closed(new,case
        when new.responses_count>=least(coalesce(new.max_responses,100000),100000) then 'closed:limit:'
        else 'closed:manual:' end||new.revision,changed_at);
    elsif new.deadline_at<=changed_at then
      perform survey_automation.stage_form_closed(new,'closed:deadline:'||new.revision,changed_at);
    end if;
  end if;

  if new.form_type<>'template' and new.is_public and new.deadline_at>changed_at then
    insert into survey_automation.form_deadlines(form_id,due_at) values(new.id,new.deadline_at)
    on conflict (form_id) do update set due_at=excluded.due_at;
  else
    delete from survey_automation.form_deadlines where form_id=new.id;
  end if;
  if tg_op='UPDATE' and new.form_type<>'template' then
    if new.is_public is distinct from old.is_public then
      content:=case when new.is_public then 'Открыт приём ответов'
        when new.responses_count>=least(coalesce(new.max_responses,100000),100000) then 'Достигнут лимит ответов'
        else 'Закрыт приём ответов' end;
      perform survey_automation.notify(new.author_id,'form_status','form-status:'||new.id||':'||new.revision,
        content,new.title,new.id);
    end if;
    if new.deadline_at is distinct from old.deadline_at then
      perform survey_automation.notify(new.author_id,'form_status','form-deadline:'||new.id||':'||new.revision,
        case when new.deadline_at is null then 'Срок приёма снят' else 'Срок приёма изменён' end,new.title,new.id);
    end if;
  end if;
  return new;
end;
$$;

create or replace function survey_automation.process_schedules(p_now timestamptz,p_limit integer)
returns void language plpgsql set search_path = '' as $$
declare
  candidate record;
  due survey_automation.targets;
  deadline record;
  rule public.automation_rules;
  f public.forms;
  r public.responses;
  page record;
  slot timestamptz;
  next_slot timestamptz;
  key text;
begin
  for candidate in
    select t.rule_id,t.form_id from survey_automation.targets t
    join public.automation_rules a on a.id=t.rule_id and a.enabled
    join public.profiles p on p.id=a.user_id and not p.is_disabled
    join public.forms form on form.id=t.form_id and form.author_id=a.user_id and form.form_type<>'template'
    where t.next_run_at<=p_now order by t.next_run_at,t.rule_id,t.form_id limit least(p_limit,4)
  loop
    -- Acquire parents before the target, following the threshold worker's lock order.
    select a.* into rule from public.automation_rules a
    join public.forms form on form.id=candidate.form_id and form.author_id=a.user_id and form.form_type<>'template'
    join public.profiles p on p.id=a.user_id and not p.is_disabled
    where a.id=candidate.rule_id and a.enabled
    for key share of form,p skip locked for share of a skip locked;
    if not found then continue; end if;
    select * into due from survey_automation.targets t
    where t.rule_id=rule.id and t.form_id=candidate.form_id and t.next_run_at<=p_now and not t.complete
    for no key update skip locked;
    if not found then continue; end if;
    select * into f from public.forms where id=due.form_id;

    next_slot:=null;
    slot:=null;
    case rule.event_type
      when 'date' then key:='date';
      when 'inactivity' then key:='gap:'||due.gap_key;
      when 'recurring' then
        slot:=coalesce(due.schedule_slot_at,survey_automation.schedule_slot(rule.scheduled_at,rule.interval_minutes,p_now));
        key:='slot:'||extract(epoch from slot)::text;
        next_slot:=survey_automation.schedule_slot(rule.scheduled_at,rule.interval_minutes,p_now)
          +make_interval(mins=>rule.interval_minutes);
      else continue;
    end case;
    if rule.conditions='[]'::jsonb then
      select * into r from public.responses entry where entry.form_id=f.id
        order by created_at desc,id desc limit 1;
    else
      -- Each target uses the count cursor for either a threshold or a scheduled search, never both.
      with batch as materialized (
        select entry.id,entry.created_at,entry.data from public.responses entry
        where entry.form_id=f.id and (entry.created_at,entry.id)<(
          coalesce(due.count_cursor_at,'infinity'::timestamptz),
          coalesce(due.count_cursor_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
        order by entry.created_at desc,entry.id desc limit 500
      )
      select (select count(*) from batch) as entries,tail.id,tail.created_at,
        (select b.id from batch b where survey_automation.matches(b.data,rule.conditions,rule.match_mode)
          order by b.created_at desc,b.id desc limit 1) as matching_id into page
      from (select id,created_at from batch order by created_at,id limit 1) tail;
      if page.matching_id is null and page.entries=500 then
        update survey_automation.targets set count_cursor_at=page.created_at,count_cursor_id=page.id,
          schedule_slot_at=slot,next_run_at=clock_timestamp() where rule_id=rule.id and form_id=f.id;
        continue;
      end if;
      select * into r from public.responses where id=page.matching_id and form_id=f.id;
    end if;
    if r.id is not null or rule.conditions='[]'::jsonb then
      perform survey_automation.stage_run(rule,f,key,r);
    end if;
    update survey_automation.targets set next_run_at=next_slot,complete=(rule.event_type='date'),
      count_cursor_at=null,count_cursor_id=null,schedule_slot_at=null where rule_id=rule.id and form_id=f.id;
  end loop;

  for deadline in
    -- Updates to a form can replace or consume its deadline. Both paths take
    -- the form lock before touching the deadline row.
    select d.* from survey_automation.form_deadlines d
    join public.forms form on form.id=d.form_id
    where d.due_at<=p_now
    order by d.due_at,d.form_id limit p_limit for no key update of form skip locked
  loop
    select * into f from public.forms where id=deadline.form_id;
    if found and f.is_public and f.form_type<>'template' and f.deadline_at=deadline.due_at then
      perform survey_automation.notify(f.author_id,'form_status',
        'deadline-reached:'||f.id||':'||extract(epoch from deadline.due_at)::text,'Срок приёма истёк',f.title,f.id);
      perform survey_automation.stage_form_closed(f,
        'closed:deadline:'||extract(epoch from deadline.due_at)::text,deadline.due_at);
    end if;
    delete from survey_automation.form_deadlines where form_id=deadline.form_id and due_at=deadline.due_at;
  end loop;
end;
$$;

revoke all on function survey_automation.stage_form_closed(public.forms,text,timestamptz)
  from public, anon, authenticated;

notify pgrst,'reload schema';

commit;
