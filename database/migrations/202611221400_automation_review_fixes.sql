begin;

alter table survey_automation.targets add column schedule_slot_at timestamptz;
alter table public.automation_runs add column cancelled_count integer not null default 0;

-- One counter per owner survives rule deletion and rolls over without a cleanup job.
create table survey_automation.mail_usage (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  hour_start timestamptz not null,
  recipient_count integer not null check (recipient_count between 1 and 500)
);

revoke all on survey_automation.mail_usage from public, anon, authenticated;

create or replace function public.set_form_personal_links(p_form_id uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.forms%rowtype;
begin
  if not public.request_is_enabled() then
    raise exception 'Требуется действующая учётная запись' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mail-reminder/' || p_form_id::text, 0));
  select * into f from public.forms where id = p_form_id for update;
  if not found or not (f.author_id = auth.uid()) then
    raise exception 'Нет прав на управление персональными ссылками' using errcode = '42501';
  end if;
  if p_enabled is null then raise exception 'Укажите состояние переключателя' using errcode = '22023'; end if;
  if p_enabled and not jsonb_path_exists(f.schema, '$.** ? (@.type == "organization")') then
    raise exception 'Добавьте в форму вопрос «Организация»' using errcode = '22023';
  end if;
  if p_enabled is distinct from f.personal_links_enabled and exists (
    select 1 from public.mail_queue where form_id = p_form_id and automation_run_id is null and status in ('queued', 'processing')
  ) then
    raise exception 'Дождитесь завершения текущей рассылки по форме' using errcode = '55000';
  end if;
  update public.forms set personal_links_enabled = p_enabled where id = p_form_id;
  if p_enabled then perform public.ensure_form_personal_links(p_form_id); end if;
  return public.get_form_personal_links(p_form_id);
end;
$$;

create or replace function public.enqueue_form_mail_batch(
  p_batch_id uuid, p_form_id uuid, p_created_by uuid, p_jobs jsonb, p_kind text, p_personal boolean
)
returns integer language plpgsql security definer set search_path = '' as $$
declare job_count integer; f public.forms%rowtype;
begin
  if p_batch_id is null or p_form_id is null or p_created_by is null or p_jobs is null
    or jsonb_typeof(p_jobs) <> 'array' or p_kind is null or p_kind not in ('reminder','invitation') then
    raise exception 'Некорректная рассылка' using errcode = '22023';
  end if;
  job_count := jsonb_array_length(p_jobs);
  if job_count not between 1 and 5000 then raise exception 'Некорректное число писем' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mail-reminder/' || p_form_id::text, 0));
  select * into f from public.forms where id = p_form_id for update;
  if not found or not public.is_public_active_form(p_form_id)
    or f.personal_links_enabled is distinct from p_personal or (p_kind = 'invitation' and not p_personal)
    or not jsonb_path_exists(f.schema, '$.** ? (@.type == "organization")') then
    raise exception 'Настройки формы изменились. Повторите рассылку.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_created_by and not p.is_disabled
    and p.id = f.author_id) then
    raise exception 'Нет прав на рассылку по этой форме' using errcode = '42501';
  end if;
  if exists (select 1 from public.mail_queue q where q.form_id = p_form_id and q.automation_run_id is null and q.status in ('queued','processing')) then
    raise exception 'Previous reminder run is still active' using errcode = '55000';
  end if;
  insert into public.mail_batches(id, kind, form_id, created_by, total_count)
  values (p_batch_id, p_kind, p_form_id, p_created_by, job_count);
  insert into public.mail_queue(batch_id, form_id, organization_id, recipient_email, recipient_name, subject, body_text)
  select p_batch_id, p_form_id, (job ->> 'organization_id')::uuid,
    lower(btrim(job ->> 'recipient_email')), btrim(job ->> 'recipient_name'), job ->> 'subject', job ->> 'body_text'
  from jsonb_array_elements(p_jobs) job;
  return job_count;
end;
$$;

create function survey_automation.localized_text(p_text jsonb)
returns text language sql immutable set search_path = '' as $$
  select case jsonb_typeof(p_text)
    when 'string' then nullif(btrim(p_text #>> '{}'),'')
    when 'object' then coalesce(nullif(btrim(p_text->>'ru'),''),nullif(btrim(p_text->>'default'),''))
  end;
$$;

create or replace function survey_automation.form_fields(p_schema jsonb)
returns table(path text[], label text, question jsonb)
language sql immutable set search_path = '' as $$
  with recursive nodes(node,parent_path,parent_label,depth) as (
    select p_schema,'{}'::text[],''::text,0
    union all
    select children.node,
      case when n.node->>'type'='paneldynamic' then n.parent_path || field.key else n.parent_path end,
      case when n.node->>'type'='paneldynamic' then n.parent_label || field.label || ' / ' else n.parent_label end,
      n.depth+1
    from nodes n
    cross join lateral (select coalesce(nullif(n.node->>'valueName',''),n.node->>'name') as key,
      coalesce(survey_automation.localized_text(n.node->'title'),n.node->>'name') as label) field
    cross join lateral jsonb_array_elements(
      (case when jsonb_typeof(n.node->'pages')='array' then n.node->'pages' else '[]'::jsonb end) ||
      (case when jsonb_typeof(n.node->'elements')='array' then n.node->'elements' else '[]'::jsonb end) ||
      (case when n.node->>'type'='paneldynamic' and jsonb_typeof(n.node->'templateElements')='array'
        then n.node->'templateElements' else '[]'::jsonb end)
    ) children(node)
    where n.depth<32
  )
  select distinct on (1) parent_path || coalesce(nullif(node->>'valueName',''),node->>'name'),
    parent_label || coalesce(survey_automation.localized_text(node->'title'),node->>'name'),node
  from nodes where char_length(node->>'name')>0 and node->>'type' in (
    'text','email','comment','boolean','rating','slider','integer','number','float','date','datetime','time','phone',
    'dropdown','radiogroup','checkbox','tagbox','imagepicker','ranking','organization')
  order by 1,depth,node;
$$;

-- Ordinary layout panels share the root answer object. Repeated/nested answer paths are ineligible.
create function survey_automation.allowed_recipient_path(p_schema jsonb,p_action jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_action->>'mode'='summary' and jsonb_array_length(p_action->'recipients')<50
    and exists(select from survey_automation.form_fields(p_schema) q
      where cardinality(q.path)=1 and to_jsonb(q.path)=p_action->'recipientPath'
        and q.question->>'type'='organization'),false);
$$;

create or replace function survey_automation.seed_targets(p_rule public.automation_rules,p_only_form uuid default null)
returns void language sql set search_path = '' as $$
  insert into survey_automation.targets(rule_id,form_id,next_run_at,last_received_at,gap_key,matching_count,count_ready)
  select p_rule.id,f.id,
    case p_rule.event_type
      when 'date' then case when p_rule.scheduled_at>=f.created_at then p_rule.scheduled_at end
      when 'recurring' then case when f.created_at<=p_rule.scheduled_at then p_rule.scheduled_at
        else survey_automation.schedule_slot(p_rule.scheduled_at,p_rule.interval_minutes,f.created_at) + make_interval(mins=>p_rule.interval_minutes) end
      when 'inactivity' then greatest(now(),f.created_at,latest.created_at)+make_interval(mins=>p_rule.interval_minutes)
    end,
    latest.created_at,coalesce(latest.id::text,'none'),0,
    p_rule.conditions='[]'::jsonb or p_rule.event_type not in ('response_count','matching_count','matching_share')
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

create function survey_automation.resume_targets(p_rule public.automation_rules)
returns void language plpgsql set search_path = '' as $$
begin
  perform survey_automation.seed_targets(p_rule);
  if p_rule.event_type='recurring' then
    update survey_automation.targets set next_run_at=
      survey_automation.schedule_slot(p_rule.scheduled_at,p_rule.interval_minutes,now())+make_interval(mins=>p_rule.interval_minutes)
    where rule_id=p_rule.id and next_run_at<=now();
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
  if p_enabled is null or coalesce(char_length(btrim(p_name)),0) not between 1 and 120
    or char_length(coalesce(p_description,''))>1000 or coalesce(p_event_type,'') not in (
      'response_received','response_updated','response_count','matching_count','matching_share','inactivity','date','recurring')
    or coalesce(p_match_mode,'') not in ('all','any') then
    raise exception 'Проверьте название и настройки события' using errcode='22023';
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
          or char_length(btrim(condition->>'value')) not between 1 and 2000 then
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
  if p_id is null then
    if (select count(*) from public.automation_rules where user_id=actor)>=50 then
      raise exception 'На одну учётную запись доступно до 50 правил' using errcode='22023';
    end if;
    insert into public.automation_rules(user_id,form_id,name,description,enabled,event_type,threshold,interval_minutes,
        scheduled_at,match_mode,conditions,action_config)
      values(actor,p_form_id,btrim(p_name),coalesce(btrim(p_description),''),p_enabled,p_event_type,p_threshold,p_interval_minutes,
        p_scheduled_at,p_match_mode,p_conditions,p_action)
      returning * into saved;
    event_changed:=true;
  else
    select * into previous from public.automation_rules where id=p_id and user_id=actor for no key update;
    if not found then raise exception 'Правило не найдено' using errcode='42501'; end if;
    event_changed:=row(previous.form_id,previous.event_type,previous.threshold,previous.interval_minutes,
      previous.scheduled_at,previous.match_mode,previous.conditions) is distinct from
      row(p_form_id,p_event_type,p_threshold,p_interval_minutes,p_scheduled_at,p_match_mode,p_conditions);
    update public.automation_rules set form_id=p_form_id,name=btrim(p_name),description=coalesce(btrim(p_description),''),
      enabled=p_enabled,event_type=p_event_type,threshold=p_threshold,interval_minutes=p_interval_minutes,scheduled_at=p_scheduled_at,
      match_mode=p_match_mode,conditions=p_conditions,action_config=p_action,updated_at=now(),
      event_version=event_version+event_changed::integer,
      delivery_version=delivery_version+(previous.enabled and not p_enabled)::integer
      where id=p_id returning * into saved;
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

create or replace function public.set_automation_rule_enabled(p_id uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare current_rule public.automation_rules;
begin
  if not public.request_is_enabled() or p_enabled is null then raise exception 'Нет доступа' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('survey-automation-owner:'||auth.uid()::text,0));
  select * into current_rule from public.automation_rules where id=p_id and user_id=auth.uid() for no key update;
  if not found then raise exception 'Правило не найдено' using errcode='42501'; end if;
  if p_enabled and current_rule.form_id is not null and not exists (
    select from public.forms where id=current_rule.form_id and author_id=auth.uid() and form_type<>'template'
  ) then raise exception 'Выберите свою форму' using errcode='42501'; end if;
  if p_enabled and ((current_rule.event_type='recurring' and current_rule.interval_minutes<15)
    or (current_rule.action_config ? 'recipientPath' and not survey_automation.allowed_recipient_path(
      (select schema from public.forms where id=current_rule.form_id),current_rule.action_config))) then
    raise exception 'Перед включением обновите настройки получателя или интервала' using errcode='22023';
  end if;
  if p_enabled is distinct from current_rule.enabled then
    update public.automation_rules set enabled=p_enabled,updated_at=now(),delivery_version=delivery_version+(not p_enabled)::integer
      where id=p_id returning * into current_rule;
    if p_enabled then perform survey_automation.resume_targets(current_rule); end if;
  end if;
end;
$$;

create or replace function survey_automation.on_profile_enabled()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.automation_rules;
begin
  perform pg_advisory_xact_lock(hashtextextended('survey-automation-owner:'||new.id::text,0));
  -- Runs captured before the account was disabled must stay inactive after reactivation.
  for a in update public.automation_rules set delivery_version=delivery_version+1
    where user_id=new.id and enabled returning * loop
    perform survey_automation.resume_targets(a);
  end loop;
  return new;
end;
$$;

create or replace function survey_automation.process_response_changes(
  p_form_id uuid,p_old jsonb,p_new jsonb,p_event text,p_change_id uuid
)
returns void language plpgsql set search_path = '' as $$
declare
  f public.forms;
  target record;
  r public.responses;
  latest public.responses;
  matching integer;
begin
  -- Serialize changes to each form's aggregate counters. This lock does not
  -- lock the form row, which existing delete RPCs lock before response rows.
  perform pg_advisory_xact_lock(hashtextextended('survey-automation-form:'||p_form_id::text,0));
  select * into f from public.forms where id=p_form_id and form_type<>'template';
  if not found or not exists(select from public.profiles where id=f.author_id and not is_disabled) then return; end if;

  if p_event in ('response_received','response_updated') then
    perform survey_automation.notify(f.author_id,p_event,
      case when p_event='response_received' then 'received:'||entry.id::text else 'updated:'||p_change_id::text||':'||entry.id::text end,
      case when p_event='response_received' then 'Новый ответ' else 'Ответ изменён' end,
      f.title,f.id,entry.id)
    from jsonb_populate_recordset(null::public.responses,p_new) entry;
  end if;

  for target in
    select t.*,a as rule
    from survey_automation.targets t join public.automation_rules a on a.id=t.rule_id
    where t.form_id=f.id and a.user_id=f.author_id and a.enabled and not t.complete
      and (a.event_type=p_event or a.event_type in ('response_count','matching_count','matching_share')
        or (a.event_type='inactivity' and p_event='response_received'))
    order by t.rule_id for update of t
  loop
    if (target.rule).event_type in ('response_received','response_updated') then
      for r in select * from jsonb_populate_recordset(null::public.responses,p_new) entry
        where survey_automation.matches(entry.data,(target.rule).conditions,(target.rule).match_mode)
      loop
        perform survey_automation.stage_run(target.rule,f,
          case when p_event='response_received' then 'received:'||r.id::text
            else 'updated:'||p_change_id::text||':'||r.id::text end,r);
      end loop;
    elsif (target.rule).event_type='inactivity' then
      select * into latest from jsonb_populate_recordset(null::public.responses,p_new)
        order by created_at desc,id desc limit 1;
      update survey_automation.targets
        set next_run_at=clock_timestamp()+make_interval(mins=>(target.rule).interval_minutes),
          last_received_at=greatest(last_received_at,latest.created_at),gap_key=latest.id::text,
          count_cursor_at=null,count_cursor_id=null,schedule_slot_at=null
        where rule_id=target.rule_id and form_id=f.id;
    else
      if (target.rule).conditions='[]'::jsonb then
        matching:=f.responses_count;
      else
        -- While the worker counts history, adjust only the range it has already read.
        matching:=target.matching_count
          + (select count(*) from jsonb_populate_recordset(null::public.responses,p_new) entry
             where (target.count_ready or (entry.created_at,entry.id)<=(target.count_cursor_at,target.count_cursor_id))
               and survey_automation.matches(entry.data,(target.rule).conditions,(target.rule).match_mode))
          - (select count(*) from jsonb_populate_recordset(null::public.responses,p_old) entry
             where (target.count_ready or (entry.created_at,entry.id)<=(target.count_cursor_at,target.count_cursor_id))
               and survey_automation.matches(entry.data,(target.rule).conditions,(target.rule).match_mode));
      end if;
      update survey_automation.targets set matching_count=matching
        where rule_id=target.rule_id and form_id=f.id;

      if not target.count_ready or survey_automation.threshold_reached(target.rule,f.responses_count,matching) then
        select * into latest from jsonb_populate_recordset(null::public.responses,p_new) entry
          where survey_automation.matches(entry.data,(target.rule).conditions,(target.rule).match_mode)
          order by created_at desc,id desc limit 1;
        if latest.id is null and (target.rule).conditions='[]'::jsonb then
          select * into latest from public.responses entry where entry.form_id=f.id
            order by created_at desc,id desc limit 1;
        end if;
        if target.count_ready and latest.id is not null then
          perform survey_automation.stage_run(target.rule,f,'threshold',latest,matching);
          update survey_automation.targets set complete=true,check_at=null,check_response_id=null
            where rule_id=target.rule_id and form_id=f.id;
        else
          update survey_automation.targets set check_at=coalesce(check_at,clock_timestamp()),
            check_response_id=coalesce(latest.id,check_response_id)
            where rule_id=target.rule_id and form_id=f.id;
        end if;
      end if;
    end if;
  end loop;
end;
$$;

create or replace function survey_automation.response_text(p_schema jsonb,p_data jsonb)
returns text language sql set search_path = '' as $$
  with bindings as materialized (
    select b.* from public.survey_response_bindings(p_schema,p_data)
      with ordinality b(question,value,value_path,ord)
  ), sensitive as materialized (
    select distinct value_path from bindings
    where question->>'type' in ('file','signaturepad') and value is not null and value<>'null'::jsonb
  ), printable as (
    select ord,coalesce(survey_automation.localized_text(b.question->'title'),b.question->>'name') as label,
      case when b.question->>'type'='file' then 'Прикреплённый файл'
      when b.question->>'type'='boolean' and b.value=coalesce(nullif(b.question->'valueTrue','null'::jsonb),'true'::jsonb)
        then coalesce(survey_automation.localized_text(b.question->'labelTrue'),'Да')
      when b.question->>'type'='boolean' and b.value=coalesce(nullif(b.question->'valueFalse','null'::jsonb),'false'::jsonb)
        then coalesce(survey_automation.localized_text(b.question->'labelFalse'),'Нет')
      when b.question->>'type'='signaturepad' then 'Подпись доступна в ответе'
      when b.question->>'type'='organization' then coalesce(o.alias,b.value #>> '{}')
      when jsonb_typeof(b.value)='array' and b.question->>'type' in ('checkbox','tagbox','imagepicker','ranking') then (
        select string_agg(coalesce(survey_automation.localized_text(choice->'text'),selected #>> '{}'),', ' order by pos)
        from jsonb_array_elements(b.value) with ordinality selections(selected,pos)
        left join lateral (select v as choice from jsonb_array_elements(
          case when jsonb_typeof(b.question->'choices')='array' then b.question->'choices' else '[]'::jsonb end
        ) v where v->'value'=selected limit 1) found on true)
      else coalesce(survey_automation.localized_text(ch.choice->'text'), b.value #>> '{}') end as content,
      case when b.question->>'type' not in ('file','signaturepad') and (
          b.question @> '{"showOtherItem":true}' or b.question @> '{"showCommentArea":true}'
          or b.question @> '{"hasOther":true}' or b.question @> '{"hasComment":true}')
        and jsonb_typeof(p_data #> c.path)='string'
        and not exists(select from sensitive s where c.path[1:cardinality(s.value_path)]=s.value_path)
        then p_data #>> c.path end as comment
    from bindings b
    cross join lateral (select b.value_path[1:cardinality(b.value_path)-1] ||
      (b.value_path[cardinality(b.value_path)]||coalesce(nullif(p_schema->>'commentSuffix',''),'-Comment')) as path) c
    left join public.education_organizations o on b.question->>'type'='organization' and o.id=case
      when b.value #>> '{}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (b.value #>> '{}')::uuid end
    left join lateral (select v as choice from jsonb_array_elements(
      case when jsonb_typeof(b.question->'choices')='array' then b.question->'choices' else '[]'::jsonb end
    ) v where v->'value'=b.value limit 1) ch on true
    where b.value is not null and b.value<>'null'::jsonb
      and b.question->>'type' not in ('paneldynamic','matrixdynamic','matrixdropdown')
      and (b.question->>'type' in ('file','signaturepad') or not exists (
        select from sensitive s where b.value_path[1:cardinality(s.value_path)]=s.value_path
          or s.value_path[1:cardinality(b.value_path)]=b.value_path))
  )
  select string_agg(label||': '||coalesce(content,'')||coalesce(E'\nКомментарий: '||comment,''),E'\n' order by ord)
  from printable;
$$;

create or replace function survey_automation.dispatch_email(
  p_run public.automation_runs,p_form public.forms,p_origin text,p_snapshot jsonb
)
returns void language plpgsql set search_path = '' as $$
declare
  action jsonb;
  response_data jsonb;
  recipients text[];
  org_value jsonb;
  directory_email text;
  marker text := '{{sent_at:'||p_run.id||'}}';
  marker_start integer;
  usage_hour timestamptz := date_trunc('hour',clock_timestamp(),'UTC');
  field_error text;
  respondent text;
  form_link text;
  response_link text;
  subject_text text;
  body_text text;
  details text;
  data_values jsonb;
begin
  if p_origin is null or p_origin !~ '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' or length(p_origin)>300
    or coalesce(substring(p_origin from ':([0-9]{1,5})$')::integer,0)>65535 then
    raise exception 'Для ссылок в письмах задайте PUBLIC_APP_URL' using errcode='P0001';
  end if;
  if not exists(select from public.mail_settings where id=1 and enabled) then
    raise exception 'Отправка почты отключена в администрировании' using errcode='P0001';
  end if;
  action:=p_snapshot->'action';
  response_data:=p_snapshot->'response';
  recipients:=array(select jsonb_array_elements_text(action->'recipients'));
  if action ? 'recipientPath' then
    if not survey_automation.allowed_recipient_path(p_form.schema,action) then
      raise exception 'В настройках письма указан недоступный получатель или формат' using errcode='P0001';
    end if;
    org_value:=response_data->(action->'recipientPath'->>0);
    select survey_automation.email_address(o.email) into directory_email
      from public.education_organizations o
      where jsonb_typeof(org_value)='string' and o.id=case
        when org_value #>> '{}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (org_value #>> '{}')::uuid end
        and not o.is_archived and o.organization_type=any(p_form.organization_types);
    if directory_email is null then field_error:='В выбранном вопросе нет доступного адреса организации';
    elsif not (directory_email=any(recipients)) then recipients:=array_append(recipients,directory_email);
    end if;
  end if;
  if cardinality(recipients)=0 then raise exception '%',field_error using errcode='P0001'; end if;
  if cardinality(recipients)>50 then raise exception 'Для одного письма доступно до 50 получателей' using errcode='P0001'; end if;

  select nullif(btrim(p.name),'') into respondent from public.profiles p where p.id=(p_snapshot->>'respondentId')::uuid;
  if respondent is null and p_run.response_id is not null then
    select o.alias into respondent from public.survey_organization_values(p_form.schema,response_data) v
    join public.education_organizations o on o.id=case
      when v #>> '{}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (v #>> '{}')::uuid end
    order by o.id limit 1;
  end if;
  form_link:=p_origin||'/dashboard/forms/'||p_run.form_id||'/responses';
  response_link:=case when p_run.response_id is null then form_link else form_link||'?response='||p_run.response_id end;
  data_values:=jsonb_build_object('form_title',p_run.form_title,'form_link',form_link,'response_link',response_link,
    'respondent',coalesce(respondent,'Не указан'),
    'response_time',coalesce(to_char((p_snapshot->>'responseTime')::timestamptz at time zone 'Europe/Moscow','DD.MM.YYYY HH24:MI "МСК"'),'—'),
    'sent_at','{{sent_at:'||p_run.id||'}}',
    'answer_count',p_snapshot->>'answerCount','matching_count',coalesce(p_snapshot->>'matchingCount','—'),
    'matching_percent',case when (p_snapshot->>'answerCount')::integer>0 and p_snapshot->>'matchingCount' is not null
      then round((p_snapshot->>'matchingCount')::numeric*100/(p_snapshot->>'answerCount')::integer,2)::text||'%' else '—' end);
  subject_text:=btrim(regexp_replace(survey_automation.render_template(action->>'subject',data_values),'[[:cntrl:]]+',' ','g'));
  if char_length(subject_text)>500 then
    -- Never leave half an SMTP-time placeholder at the subject boundary.
    marker_start:=strpos(substr(subject_text,502-length(marker),2*length(marker)-2),marker);
    if marker_start between 1 and length(marker)-1 then
      subject_text:=left(subject_text,500-length(marker)+marker_start);
    else
      subject_text:=left(subject_text,500);
    end if;
  end if;
  body_text:=survey_automation.render_template(action->>'body',data_values);
  if strpos(body_text,response_link)=0 then body_text:=body_text||E'\n\n'||response_link; end if;
  if action->>'mode'='full' and p_run.response_id is not null then
    details:=survey_automation.response_text(p_form.schema,response_data);
    if details is not null then body_text:=body_text||E'\n\nОтвет:\n'||details; end if;
  end if;
  if char_length(body_text)>512000 then raise exception 'Ответ слишком длинный для письма. Выберите краткое письмо со ссылкой' using errcode='P0001'; end if;

  insert into survey_automation.mail_usage as usage(user_id,hour_start,recipient_count)
    values(p_form.author_id,usage_hour,cardinality(recipients))
    on conflict (user_id) do update set hour_start=excluded.hour_start,
      recipient_count=case when usage.hour_start=excluded.hour_start then usage.recipient_count else 0 end
        +excluded.recipient_count
    where usage.hour_start<excluded.hour_start or (usage.hour_start=excluded.hour_start
      and usage.recipient_count+excluded.recipient_count<=500);
  if not found then
    raise exception 'Достигнут часовой лимит в 500 получателей автоматизаций' using errcode='P0001';
  end if;

  insert into public.mail_batches(id,kind,form_id,created_by,total_count)
    values(p_run.id,'automation',p_form.id,p_form.author_id,cardinality(recipients));
  insert into public.mail_queue(batch_id,form_id,recipient_email,recipient_name,subject,body_text,max_attempts,automation_run_id)
    select p_run.id,p_form.id,address,address,coalesce(nullif(subject_text,''),'Уведомление о форме'),body_text,1,p_run.id
    from unnest(recipients) address;
  update public.automation_runs set status='queued',recipient_count=cardinality(recipients),last_error=field_error where id=p_run.id;
end;
$$;

create or replace function survey_automation.record_delivery()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  updated_run public.automation_runs;
  cancelled boolean := old.status='queued' and new.status='failed';
begin
  update public.automation_runs r set
    sent_count=r.sent_count+(new.status='sent')::integer,
    failed_count=r.failed_count+(new.status='failed' and not cancelled)::integer,
    cancelled_count=r.cancelled_count+cancelled::integer,
    last_error=coalesce(new.last_error,r.last_error),
    status=case when r.sent_count+r.failed_count+r.cancelled_count+1<r.recipient_count then 'queued'
      when (new.status='failed' and not cancelled) or r.failed_count>0 then 'failed'
      when cancelled or r.cancelled_count>0 then 'cancelled'
      when r.last_error is not null then 'failed'
      else 'succeeded' end
    where r.id=new.automation_run_id and r.status='queued' returning * into updated_run;
  if updated_run.status in ('succeeded','failed','cancelled') then perform survey_automation.terminal_notice(updated_run); end if;
  return new;
end;
$$;

create or replace function public.process_automations(p_app_origin text,p_limit integer default 50)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  max_items integer := least(greatest(coalesce(p_limit,50),1),100);
  candidate record;
  run public.automation_runs;
  f public.forms;
  snapshot jsonb;
  completed integer := 0;
  sweep_time timestamptz := clock_timestamp();
begin
  if p_app_origin is null or p_app_origin !~ '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' or length(p_app_origin)>300
    or coalesce(substring(p_app_origin from ':([0-9]{1,5})$')::integer,0)>65535 then
    raise exception 'Для ссылок в письмах задайте PUBLIC_APP_URL' using errcode='P0001';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('survey-automation-worker',0)) then return 0; end if;
  perform survey_automation.process_schedules(sweep_time,max_items);

  -- An expired SMTP lease can represent a successfully accepted message.
  -- Automation jobs are never delivered again after such an uncertain outcome.
  with expired as (
    select q.id from public.mail_queue q
    where q.automation_run_id is not null and (
      (q.status='queued' and not survey_automation.run_is_active(q.automation_run_id))
      or (q.status = 'processing' and q.locked_at<sweep_time-interval '10 minutes'))
    order by q.created_at,q.id limit max_items for update skip locked
  )
  update public.mail_queue q set status='failed',locked_by=null,locked_at=null,
    last_error=case when q.status = 'processing' then 'Не удалось подтвердить отправку письма'
      else 'Правило выключено, изменено или данные больше недоступны' end
    from expired e where q.id=e.id;

  for candidate in select id,form_id from public.automation_runs where status='pending'
    order by created_at,id limit max_items
  loop
    -- Take locks in the same order as the form deletion path.
    select * into f from public.forms where id=candidate.form_id for key share skip locked;
    if not found and exists(select from public.forms where id=candidate.form_id) then continue; end if;
    select * into run from public.automation_runs where id=candidate.id and status='pending' for no key update skip locked;
    if not found then continue; end if;

    if f.id is not null and survey_automation.run_is_active(run.id) then
      begin
        select payload into strict snapshot from survey_automation.payloads where run_id=run.id;
        case snapshot->>'actionType'
          when 'email' then perform survey_automation.dispatch_email(run,f,p_app_origin,snapshot);
          else raise exception 'Действие правила недоступно' using errcode='P0001';
        end case;
      exception
        when raise_exception then
          update public.automation_runs set status='failed',last_error=SQLERRM where id=run.id returning * into run;
          perform survey_automation.terminal_notice(run);
        when data_exception or integrity_constraint_violation or no_data_found then
          raise log 'Automation run % could not prepare an email (%)',run.id,SQLSTATE;
          update public.automation_runs set status='failed',last_error='Не удалось подготовить письмо'
            where id=run.id returning * into run;
          perform survey_automation.terminal_notice(run);
      end;
    else
      update public.automation_runs set status='cancelled',last_error='Правило выключено, изменено или данные больше недоступны'
        where id=run.id returning * into run;
      perform survey_automation.terminal_notice(run);
    end if;
    delete from survey_automation.payloads where run_id=run.id;
    completed:=completed+1;
  end loop;
  perform survey_automation.process_threshold_checks(max_items);
  return completed;
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
    select d.* from survey_automation.form_deadlines d where due_at<=p_now
    order by due_at,form_id limit p_limit for update skip locked
  loop
    select * into f from public.forms where id=deadline.form_id;
    if found and f.is_public and f.form_type<>'template' and f.deadline_at=deadline.due_at then
      perform survey_automation.notify(f.author_id,'form_status',
        'deadline-reached:'||f.id||':'||extract(epoch from deadline.due_at)::text,'Срок приёма истёк',f.title,f.id);
    end if;
    delete from survey_automation.form_deadlines where form_id=deadline.form_id;
  end loop;
end;
$$;

revoke all on function survey_automation.localized_text(jsonb),
  survey_automation.allowed_recipient_path(jsonb,jsonb),
  survey_automation.resume_targets(public.automation_rules) from public, anon, authenticated;

-- Upgrade only: active legacy queue entries lost their action/response snapshots on dispatch.
-- Preserve recorded outcomes and in-flight SMTP claims. Never readdress or resend a queued message.
update public.mail_queue set status='failed',last_error='Отправка отменена после обновления правил получателей и защиты вложений'
where automation_run_id is not null and status='queued';

update public.automation_rules a set enabled=false,updated_at=now(),delivery_version=delivery_version+1
where a.enabled and ((a.event_type='recurring' and a.interval_minutes<15)
  or (a.action_config ? 'recipientPath' and not survey_automation.allowed_recipient_path(
    (select f.schema from public.forms f where f.id=a.form_id),a.action_config)));
-- End upgrade-only adjustments.

notify pgrst,'reload schema';
commit;
