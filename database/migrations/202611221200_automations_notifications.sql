begin;

create schema survey_automation;
revoke all on schema survey_automation from public, anon, authenticated;

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  form_id uuid references public.forms(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  enabled boolean not null default true,
  event_type text not null check (event_type in ('response_received','response_updated','response_count',
    'matching_count','matching_share','inactivity','date','recurring')),
  threshold numeric,
  interval_minutes integer,
  scheduled_at timestamptz,
  match_mode text not null check (match_mode in ('all','any')),
  conditions jsonb not null,
  action_type text not null default 'email' check (action_type = 'email'),
  action_config jsonb not null,
  event_version integer not null default 1,
  delivery_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index automation_rules_user_list on public.automation_rules (user_id, created_at desc, id desc);
create index automation_rules_form on public.automation_rules (form_id) where form_id is not null;
create index automation_rules_all_forms on public.automation_rules (user_id) where form_id is null and enabled;

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  form_id uuid not null,
  form_title text not null,
  response_id uuid,
  event_version integer not null,
  delivery_version integer not null,
  event_key text not null,
  status text not null default 'pending' check (status in ('pending','queued','succeeded','failed','cancelled')),
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  unique (rule_id, event_version, form_id, event_key)
);
create index automation_runs_history on public.automation_runs (rule_id, created_at desc, id desc);
create index automation_runs_pending on public.automation_runs (created_at, id) where status='pending';
create index automation_runs_form_active on public.automation_runs (form_id) where status in ('pending','queued');

create table survey_automation.targets (
  rule_id uuid references public.automation_rules(id) on delete cascade,
  form_id uuid references public.forms(id) on delete cascade,
  complete boolean not null default false,
  matching_count integer not null,
  count_ready boolean not null,
  count_cursor_at timestamptz,
  count_cursor_id uuid,
  check_at timestamptz,
  check_response_id uuid,
  last_received_at timestamptz,
  gap_key text not null default 'none',
  next_run_at timestamptz,
  primary key (rule_id, form_id)
);
create index automation_targets_form on survey_automation.targets (form_id, rule_id);
create index automation_targets_due on survey_automation.targets (next_run_at, rule_id, form_id) where next_run_at is not null;
create index automation_targets_check on survey_automation.targets (check_at, rule_id, form_id) where check_at is not null;

create table survey_automation.payloads (
  run_id uuid primary key references public.automation_runs(id) on delete cascade,
  payload jsonb not null
);

create table survey_automation.form_deadlines (
  form_id uuid primary key references public.forms(id) on delete cascade,
  due_at timestamptz not null
);
create index automation_form_deadlines_due on survey_automation.form_deadlines (due_at, form_id);

create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  muted_categories text[] not null
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('response_received','response_updated','automation_triggered',
    'automation_succeeded','automation_failed','form_status')),
  event_key text not null,
  title text not null,
  message text not null,
  form_id uuid,
  response_id uuid,
  rule_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  unique (user_id, event_key)
);
create index notifications_user_list on public.notifications (user_id, created_at desc, id desc);
create index notifications_user_category on public.notifications (user_id, category, created_at desc, id desc);
create index notifications_user_unread on public.notifications (user_id, created_at desc, id desc) where read_at is null;

alter table public.automation_rules enable row level security;
alter table public.automation_runs enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;
revoke all on public.automation_rules, public.automation_runs, public.notification_preferences, public.notifications
  from public, anon, authenticated;
grant select on public.automation_rules, public.automation_runs, public.notification_preferences, public.notifications to authenticated;
create policy automation_rules_owner on public.automation_rules for select to authenticated
  using (user_id=(select auth.uid()) and (select public.request_is_enabled()));
create policy automation_runs_owner on public.automation_runs for select to authenticated
  using (exists (select from public.automation_rules r where r.id=rule_id));
create policy notification_preferences_owner on public.notification_preferences for select to authenticated
  using (user_id=(select auth.uid()) and (select public.request_is_enabled()));
create policy notifications_owner on public.notifications for select to authenticated
  using (user_id=(select auth.uid()) and (select public.request_is_enabled()));

do $$
begin
  if exists (select from pg_publication where pubname='supabase_realtime' and not puballtables) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

create function survey_automation.notify(
  p_user_id uuid, p_category text, p_key text, p_title text, p_message text,
  p_form_id uuid default null, p_response_id uuid default null, p_rule_id uuid default null
)
returns void language sql set search_path = '' as $$
  insert into public.notifications(user_id,category,event_key,title,message,form_id,response_id,rule_id)
  select p_user_id,p_category,p_key,p_title,p_message,p_form_id,p_response_id,p_rule_id
  from public.profiles p left join public.notification_preferences n on n.user_id=p.id
  where p.id=p_user_id and not p.is_disabled and not coalesce(p_category=any(n.muted_categories),false)
  on conflict (user_id,event_key) do nothing;
$$;

create function public.mark_notifications_read(p_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if not public.request_is_enabled() then raise exception 'Нет доступа' using errcode='42501'; end if;
  update public.notifications set read_at=now()
    where user_id=auth.uid() and read_at is null and (p_id is null or id=p_id);
  get diagnostics changed = row_count;
  return changed;
end;
$$;

create function public.save_notification_preferences(p_muted_categories text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_muted_categories is null or cardinality(p_muted_categories)>6 or array_position(p_muted_categories,null) is not null
    or not p_muted_categories <@ array['response_received','response_updated','automation_triggered',
      'automation_succeeded','automation_failed','form_status'] then
    raise exception 'Неизвестный тип уведомлений' using errcode='22023';
  end if;
  if not public.request_is_enabled() then raise exception 'Нет доступа' using errcode='42501'; end if;
  insert into public.notification_preferences(user_id,muted_categories) values(auth.uid(),p_muted_categories)
  on conflict (user_id) do update set muted_categories=excluded.muted_categories;
end;
$$;

-- Layout panels are transparent. A repeating panel adds a level in response data.
create function survey_automation.form_fields(p_schema jsonb)
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
      coalesce(nullif(n.node->>'title',''),n.node->>'name') as label) field
    cross join lateral jsonb_array_elements(
      (case when jsonb_typeof(n.node->'pages')='array' then n.node->'pages' else '[]'::jsonb end) ||
      (case when jsonb_typeof(n.node->'elements')='array' then n.node->'elements' else '[]'::jsonb end) ||
      (case when n.node->>'type'='paneldynamic' and jsonb_typeof(n.node->'templateElements')='array'
        then n.node->'templateElements' else '[]'::jsonb end)
    ) children(node)
    where n.depth<32
  )
  select distinct on (1) parent_path || coalesce(nullif(node->>'valueName',''),node->>'name'),
    parent_label || coalesce(nullif(node->>'title',''),node->>'name'),node
  from nodes where char_length(node->>'name')>0 and node->>'type' in (
    'text','email','comment','boolean','rating','slider','integer','number','float','date','datetime','time','phone',
    'dropdown','radiogroup','checkbox','tagbox','imagepicker','ranking','organization')
  order by 1,depth,node;
$$;

create function public.automation_form_fields(p_form_id uuid)
returns table(path text[],label text,type text,choices jsonb,input_type text)
language sql stable security definer set search_path = '' as $$
  select q.path,q.label,q.question->>'type',case when q.question->>'type'='boolean' then jsonb_build_array(
    jsonb_build_object('value',coalesce(nullif(q.question->'valueTrue','null'::jsonb),'true'::jsonb),'text',coalesce(q.question->'labelTrue','"Да"'::jsonb)),
    jsonb_build_object('value',coalesce(nullif(q.question->'valueFalse','null'::jsonb),'false'::jsonb),'text',coalesce(q.question->'labelFalse','"Нет"'::jsonb)))
    else q.question->'choices' end,q.question->>'inputType'
  from public.forms f cross join lateral survey_automation.form_fields(f.schema) q
  where f.id=p_form_id and f.author_id=auth.uid() and f.form_type<>'template' and public.request_is_enabled()
  order by q.label,q.path;
$$;

create function survey_automation.answer_values(p_value jsonb,p_path text[])
returns setof jsonb language plpgsql immutable set search_path = '' as $$
begin
  if cardinality(p_path)=0 then
    if p_value is not null and p_value<>'null'::jsonb then return next p_value; end if;
  elsif jsonb_typeof(p_value)='object' then
    return query select * from survey_automation.answer_values(p_value->p_path[1],p_path[2:]);
  elsif jsonb_typeof(p_value)='array' then
    return query select v from jsonb_array_elements(p_value) e cross join lateral survey_automation.answer_values(e,p_path) v;
  end if;
end;
$$;

create function survey_automation.number(p_value jsonb)
returns numeric language plpgsql immutable set search_path = '' as $$
declare value_text text;
begin
  if jsonb_typeof(p_value) not in ('number','string') then return null; end if;
  value_text:=btrim(p_value #>> '{}');
  if value_text ~ '^[+-]?[0-9]{1,30}([.,][0-9]{1,30})?$' then
    return replace(value_text,',','.')::numeric;
  end if;
  return null;
end;
$$;

create function survey_automation.condition_matches(p_answer jsonb,p_condition jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  case p_condition->>'op'
    when 'eq' then
      if jsonb_typeof(p_answer)='array' then
        if jsonb_array_length(p_answer)<>1 then return false; end if;
        p_answer:=p_answer->0;
      end if;
      return jsonb_typeof(p_answer) in ('string','number','boolean') and p_answer #>> '{}' = p_condition->>'value';
    when 'gt' then return survey_automation.number(p_answer)>survey_automation.number(p_condition->'value');
    when 'lt' then return survey_automation.number(p_answer)<survey_automation.number(p_condition->'value');
    when 'contains' then return jsonb_typeof(p_answer)='string' and strpos(lower(p_answer #>> '{}'),lower(p_condition->>'value'))>0;
    when 'any_of' then return exists (
      select from jsonb_array_elements(p_condition->'value') v
      join jsonb_array_elements(case when jsonb_typeof(p_answer)='array' then p_answer else jsonb_build_array(p_answer) end) a
        on a #>> '{}'=v #>> '{}');
    when 'all_of' then return not exists (
      select from jsonb_array_elements(p_condition->'value') v where not exists (
        select from jsonb_array_elements(case when jsonb_typeof(p_answer)='array' then p_answer else jsonb_build_array(p_answer) end) a
        where a #>> '{}'=v #>> '{}'));
    else return false;
  end case;
end;
$$;

create function survey_automation.matches(p_data jsonb,p_conditions jsonb,p_mode text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  condition jsonb;
  matched boolean;
  match_any boolean := p_mode is not distinct from 'any';
begin
  if p_conditions='[]'::jsonb then return true; end if;
  if p_conditions is null then return false; end if;
  for condition in select value from jsonb_array_elements(p_conditions) loop
    select exists (
      select from survey_automation.answer_values(p_data,array(select jsonb_array_elements_text(condition->'path'))) answer
      where survey_automation.condition_matches(answer,condition)
    ) into matched;
    if matched=match_any then return match_any; end if;
  end loop;
  return not match_any;
end;
$$;

create function survey_automation.email_address(p_value text)
returns text language sql immutable set search_path = '' as $$
  select case when char_length(btrim(p_value)) between 3 and 254
    and btrim(p_value) ~ '^[[:alnum:].!#$%&''*+/=?^_{|}~-]+@[[:alnum:]]([[:alnum:]-]*[[:alnum:]])?(\.[[:alnum:]]([[:alnum:]-]*[[:alnum:]])?)+$'
    and split_part(btrim(p_value),'@',1) !~ '(^\.|\.\.|\.$)'
    then lower(btrim(p_value)) end;
$$;

create function survey_automation.schedule_slot(p_start timestamptz,p_interval integer,p_now timestamptz)
returns timestamptz language sql immutable set search_path = '' as $$
  select p_start + greatest(0,floor(extract(epoch from p_now-p_start)/(p_interval*60)))::integer * make_interval(mins=>p_interval);
$$;

create function survey_automation.seed_targets(p_rule public.automation_rules,p_only_form uuid default null)
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
    check_at=null,
    check_response_id=null,
    last_received_at=greatest(targets.last_received_at,excluded.last_received_at),
    gap_key=case when excluded.last_received_at>targets.last_received_at or targets.last_received_at is null
      then excluded.gap_key else targets.gap_key end,
    next_run_at=case when targets.complete then null
      when p_rule.event_type='inactivity' and targets.next_run_at is null
        and excluded.gap_key=targets.gap_key then null
      when p_rule.event_type='recurring' then coalesce(targets.next_run_at,excluded.next_run_at)
      else excluded.next_run_at end;
$$;

create function public.save_automation_rule(
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
    jsonb_typeof(p_action->'subject') is distinct from 'string' or coalesce(char_length(btrim(p_action->>'subject')),0) not between 1 and 500 or
    jsonb_typeof(p_action->'body') is distinct from 'string' or coalesce(char_length(btrim(p_action->>'body')),0) not between 1 and 10000 or
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
    if not exists (select from survey_automation.form_fields(schema_json) q
      where to_jsonb(q.path)=p_action->'recipientPath' and q.question->>'type' in ('text','email','organization')) then
      raise exception 'Выберите вопрос с адресом или организацией' using errcode='22023';
    end if;
  elsif cardinality(recipients)=0 then raise exception 'Укажите получателя письма' using errcode='22023';
  end if;

  p_action:=jsonb_strip_nulls(jsonb_build_object('recipients',recipients,'subject',btrim(p_action->>'subject'),
    'body',btrim(p_action->>'body'),'mode',p_action->>'mode','recipientPath',p_action->'recipientPath'));
  -- Serialize rule changes with new forms so an all-forms rule always gets a target.
  perform pg_advisory_xact_lock(hashtextextended('survey-automation-owner:'||actor::text,0));
  if p_id is null then
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
  if saved.enabled and (event_changed or not previous.enabled) then perform survey_automation.seed_targets(saved); end if;
  return saved.id;
end;
$$;

create function public.set_automation_rule_enabled(p_id uuid,p_enabled boolean)
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
  if p_enabled is distinct from current_rule.enabled then
    update public.automation_rules set enabled=p_enabled,updated_at=now(),delivery_version=delivery_version+(not p_enabled)::integer
      where id=p_id returning * into current_rule;
    if p_enabled then perform survey_automation.seed_targets(current_rule); end if;
  end if;
end;
$$;

create function survey_automation.stage_run(
  p_rule public.automation_rules,p_form public.forms,p_event_key text,p_response public.responses,
  p_matching_count integer default null
)
returns void language plpgsql set search_path = '' as $$
declare run_id uuid;
begin
  insert into public.automation_runs(rule_id,form_id,form_title,response_id,event_version,delivery_version,event_key)
    values(p_rule.id,p_form.id,p_form.title,p_response.id,p_rule.event_version,p_rule.delivery_version,p_event_key)
  on conflict (rule_id,event_version,form_id,event_key) do nothing returning id into run_id;
  if run_id is null then return; end if;

  insert into survey_automation.payloads(run_id,payload) values(
    run_id,jsonb_build_object('actionType',p_rule.action_type,'action',p_rule.action_config,'response',p_response.data,'respondentId',p_response.user_id,
      'responseTime',p_response.created_at,'answerCount',p_form.responses_count,'matchingCount',p_matching_count));
  perform survey_automation.notify(p_rule.user_id,'automation_triggered',run_id::text||':triggered',
    'Сработало правило «'||p_rule.name||'»',p_form.title,p_form.id,p_response.id,p_rule.id);
end;
$$;

create function survey_automation.threshold_reached(p_rule public.automation_rules,p_total integer,p_matching integer)
returns boolean language sql immutable set search_path = '' as $$
  select case p_rule.event_type
    when 'response_count' then p_total>=p_rule.threshold and p_matching>0
    when 'matching_count' then p_matching>=p_rule.threshold
    when 'matching_share' then p_total>0 and p_matching*100::numeric>=p_total*p_rule.threshold
    else false end;
$$;

create function survey_automation.process_response_changes(
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
          last_received_at=greatest(last_received_at,latest.created_at),gap_key=latest.id::text
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

create function survey_automation.on_response_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare changes record; operation_id uuid;
begin
  -- Statement transition tables keep bulk changes and the initial count in sync.
  if tg_op='INSERT' then
    for changes in select form_id,jsonb_agg(to_jsonb(n)) as entries from new_responses n group by form_id order by form_id loop
      perform survey_automation.process_response_changes(changes.form_id,'[]',changes.entries,'response_received',null);
    end loop;
  elsif tg_op='UPDATE' then
    operation_id:=gen_random_uuid();
    for changes in
      select n.form_id,jsonb_agg(to_jsonb(o)) as before_entries,jsonb_agg(to_jsonb(n)) as after_entries
      from new_responses n join old_responses o on n.id=o.id and n.form_id=o.form_id
      where n.data is distinct from o.data group by n.form_id order by n.form_id
    loop
      perform survey_automation.process_response_changes(changes.form_id,changes.before_entries,changes.after_entries,
        'response_updated',operation_id);
    end loop;
  else
    -- A form deletion cascades all its responses. Skip that transition table
    -- without collecting full payloads for a form that no longer exists.
    for changes in
      select o.form_id,jsonb_agg(to_jsonb(o)) as entries from old_responses o
      where exists (select from public.forms f where f.id=o.form_id)
      group by o.form_id order by o.form_id
    loop
      perform survey_automation.process_response_changes(changes.form_id,changes.entries,'[]','response_deleted',null);
    end loop;
  end if;
  return null;
end;
$$;

create trigger automation_response_insert after insert on public.responses
  referencing new table as new_responses for each statement execute function survey_automation.on_response_changes();
create trigger automation_response_update after update on public.responses
  referencing old table as old_responses new table as new_responses
  for each statement execute function survey_automation.on_response_changes();
create trigger automation_response_delete after delete on public.responses
  referencing old table as old_responses for each statement execute function survey_automation.on_response_changes();

create function survey_automation.on_form_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  a public.automation_rules;
  owner uuid;
  content text;
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

  if new.form_type<>'template' and new.is_public and new.deadline_at is not null and new.deadline_at>now() then
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

create function survey_automation.on_profile_enabled()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.automation_rules;
begin
  perform pg_advisory_xact_lock(hashtextextended('survey-automation-owner:'||new.id::text,0));
  for a in select * from public.automation_rules where user_id=new.id and enabled order by id loop
    perform survey_automation.seed_targets(a);
  end loop;
  return new;
end;
$$;

create trigger automation_profile_enabled after update of is_disabled on public.profiles
  for each row when (old.is_disabled and not new.is_disabled) execute function survey_automation.on_profile_enabled();

create trigger automation_form_insert after insert on public.forms
  for each row execute function survey_automation.on_form_changes();
create trigger automation_form_update after update of is_public,deadline_at,max_responses,author_id,form_type on public.forms
  for each row execute function survey_automation.on_form_changes();
insert into survey_automation.form_deadlines(form_id,due_at)
  select id,deadline_at from public.forms where form_type<>'template' and is_public and deadline_at>now();

create function survey_automation.cancel_deleted_form_runs()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Queue rows are already removed by the form's foreign key cascades.
  with cancelled as (
    update public.automation_runs set status='cancelled',last_error='Форма удалена'
    where form_id=old.id and status in ('pending','queued') returning id
  )
  delete from survey_automation.payloads p using cancelled where p.run_id=cancelled.id;
  return old;
end;
$$;

create trigger automation_form_delete after delete on public.forms
  for each row execute function survey_automation.cancel_deleted_form_runs();

create function survey_automation.process_threshold_checks(p_limit integer)
returns void language plpgsql set search_path = '' as $$
declare
  batch_size constant integer := 1000;
  candidate record;
  target survey_automation.targets;
  rule public.automation_rules;
  f public.forms;
  r public.responses;
  batch record;
  matching integer;
  triggered boolean;
begin
  for candidate in
    select t.rule_id,t.form_id
    from survey_automation.targets t
    join public.automation_rules a on a.id=t.rule_id and a.enabled
    join public.profiles p on p.id=a.user_id and not p.is_disabled
    where t.check_at is not null
    order by t.check_at,t.rule_id,t.form_id limit least(p_limit,4)
  loop
    -- Match the deletion path's lock order and skip a rule being edited.
    select a.* into rule from public.automation_rules a
    join public.forms form on form.id=candidate.form_id and form.author_id=a.user_id and form.form_type<>'template'
    join public.profiles p on p.id=a.user_id and not p.is_disabled
    where a.id=candidate.rule_id and a.enabled
    for key share of form,p skip locked for share of a skip locked;
    if not found then continue; end if;

    select * into target from survey_automation.targets t
    where t.rule_id=rule.id and t.form_id=candidate.form_id and t.check_at is not null and not t.complete
    for no key update skip locked;
    if not found then continue; end if;
    select * into f from public.forms where id=target.form_id;
    if f.author_id is distinct from rule.user_id or f.form_type='template' then continue; end if;

    matching:=target.matching_count;
    if not target.count_ready then
      with page as materialized (
        select entry.id,entry.created_at,entry.data from public.responses entry
        where entry.form_id=f.id and (entry.created_at,entry.id)>=(
          coalesce(target.count_cursor_at,'-infinity'::timestamptz),
          coalesce(target.count_cursor_id,'00000000-0000-0000-0000-000000000000'::uuid))
          and entry.id is distinct from target.count_cursor_id
        order by entry.created_at,entry.id limit batch_size
      )
      select stats.*,tail.created_at,tail.id into batch
      from (select count(*) as entries,count(*) filter (
        where survey_automation.matches(page.data,rule.conditions,rule.match_mode)) as matches from page) stats
      left join lateral (select id,created_at from page order by created_at desc,id desc limit 1) tail on true;
      matching:=matching+batch.matches;
      if batch.entries=batch_size then
        update survey_automation.targets set matching_count=matching,count_cursor_at=batch.created_at,
          count_cursor_id=batch.id,check_at=clock_timestamp() where rule_id=rule.id and form_id=f.id;
        continue;
      end if;
      target.count_cursor_at:=null;
      target.count_cursor_id:=null;
    end if;

    triggered:=survey_automation.threshold_reached(rule,f.responses_count,matching);
    if triggered then
      select * into r from public.responses entry where entry.id=target.check_response_id and entry.form_id=f.id
        and survey_automation.matches(entry.data,rule.conditions,rule.match_mode);
      if not found then
        -- If the change had no eligible answer, look for the latest match in
        -- bounded descending pages. The count cursor is finished at this point.
        with page as materialized (
          select entry.id,entry.created_at,entry.data from public.responses entry
          where entry.form_id=f.id and (entry.created_at,entry.id)<=(
            coalesce(target.count_cursor_at,'infinity'::timestamptz),
            coalesce(target.count_cursor_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
            and entry.id is distinct from target.count_cursor_id
          order by entry.created_at desc,entry.id desc limit batch_size
        )
        select tail.*,best.id as matching_id,(select count(*) from page) as entries into batch
        from (select id,created_at from page order by created_at,id limit 1) tail
        left join lateral (
          select id from page where survey_automation.matches(data,rule.conditions,rule.match_mode)
          order by created_at desc,id desc limit 1
        ) best on true;
        if batch.matching_id is null and batch.entries=batch_size then
          update survey_automation.targets set matching_count=matching,count_ready=true,count_cursor_at=batch.created_at,
            count_cursor_id=batch.id,check_at=clock_timestamp() where rule_id=rule.id and form_id=f.id;
          continue;
        end if;
        select * into r from public.responses where id=batch.matching_id and form_id=f.id;
      end if;
      triggered:=r.id is not null;
      if triggered then perform survey_automation.stage_run(rule,f,'threshold',r,matching); end if;
    end if;
    update survey_automation.targets set complete=triggered,matching_count=matching,count_ready=true,
      count_cursor_at=null,count_cursor_id=null,check_at=null,check_response_id=null
      where rule_id=rule.id and form_id=f.id;
  end loop;
end;
$$;

create function survey_automation.process_schedules(p_now timestamptz,p_limit integer)
returns void language plpgsql set search_path = '' as $$
declare
  due record;
  f public.forms;
  r public.responses;
  slot timestamptz;
  next_slot timestamptz;
  key text;
begin
  for due in
    select t.*,a as rule from survey_automation.targets t
    join public.automation_rules a on a.id=t.rule_id
    join public.forms form on form.id=t.form_id and form.author_id=a.user_id and form.form_type<>'template'
    join public.profiles p on p.id=a.user_id
    where t.next_run_at<=p_now and a.enabled and not p.is_disabled
    order by t.next_run_at,t.rule_id,t.form_id limit p_limit for update of t skip locked
  loop
    select * into f from public.forms where id=due.form_id;
    if f.author_id is distinct from (due.rule).user_id or f.form_type='template' then continue; end if;

    next_slot:=null;
    case (due.rule).event_type
      when 'date' then key:='date';
      when 'inactivity' then key:='gap:'||due.gap_key;
      when 'recurring' then
        slot:=survey_automation.schedule_slot((due.rule).scheduled_at,(due.rule).interval_minutes,p_now);
        key:='slot:'||extract(epoch from slot)::text;
        next_slot:=slot+make_interval(mins=>(due.rule).interval_minutes);
      else continue;
    end case;
    select * into r from public.responses entry where entry.form_id=f.id
      and survey_automation.matches(entry.data,(due.rule).conditions,(due.rule).match_mode)
      order by created_at desc,id desc limit 1;
    if r.id is not null or (due.rule).conditions='[]'::jsonb then
      perform survey_automation.stage_run(due.rule,f,key,r);
    end if;
    update survey_automation.targets set next_run_at=next_slot,complete=((due.rule).event_type='date')
      where rule_id=due.rule_id and form_id=f.id;
  end loop;

  for due in
    select d.* from survey_automation.form_deadlines d where due_at<=p_now
    order by due_at,form_id limit p_limit for update skip locked
  loop
    select * into f from public.forms where id=due.form_id;
    if found and f.is_public and f.form_type<>'template' and f.deadline_at=due.due_at then
      perform survey_automation.notify(f.author_id,'form_status',
        'deadline-reached:'||f.id||':'||extract(epoch from due.due_at)::text,'Срок приёма истёк',f.title,f.id);
    end if;
    delete from survey_automation.form_deadlines where form_id=due.form_id;
  end loop;
end;
$$;

alter table public.mail_batches drop constraint mail_batches_kind_check;
alter table public.mail_batches add constraint mail_batches_kind_check check (kind in ('reminder','invitation','test','automation'));
alter table public.mail_batches drop constraint mail_batches_form_kind;
alter table public.mail_batches add constraint mail_batches_form_kind check (
  (kind in ('reminder','invitation','automation') and form_id is not null) or (kind='test' and form_id is null)
);

alter table public.mail_queue add column automation_run_id uuid references public.automation_runs(id) on delete cascade;
create index mail_queue_automation_run on public.mail_queue (automation_run_id) where automation_run_id is not null;
create index mail_queue_automation_active on public.mail_queue (created_at,id)
  where automation_run_id is not null and status in ('queued','processing');
alter table public.mail_queue drop constraint mail_queue_body_length;
alter table public.mail_queue add constraint mail_queue_body_length
  check (char_length(body_text) between 1 and case when automation_run_id is null then 20000 else 512000 end);

create function survey_automation.run_is_active(p_run_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select from public.automation_runs r join public.automation_rules a on a.id=r.rule_id
    join public.profiles p on p.id=a.user_id
    join public.forms f on f.id=r.form_id and f.author_id=a.user_id
    where r.id=p_run_id and a.enabled and not p.is_disabled and f.form_type<>'template'
      and r.event_version=a.event_version and r.delivery_version=a.delivery_version and (r.response_id is null or exists (
        select from public.responses entry where entry.id=r.response_id and entry.form_id=r.form_id))
  );
$$;

create function survey_automation.terminal_notice(p_run public.automation_runs)
returns void language sql set search_path = '' as $$
  select survey_automation.notify(a.user_id,
    case when p_run.status='succeeded' then 'automation_succeeded' else 'automation_failed' end,
    p_run.id::text||':finished',
    case when p_run.status='succeeded' then 'Письма отправлены'
      when p_run.status='cancelled' then 'Выполнение правила отменено' else 'Ошибка автоматизации' end,
    a.name||' · '||p_run.form_title||coalesce(' — '||p_run.last_error,''),
    p_run.form_id,p_run.response_id,p_run.rule_id)
  from public.automation_rules a where a.id=p_run.rule_id;
$$;

create function survey_automation.clear_delivered_content()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.subject:='Уведомление о форме';
  new.body_text:='Выполнение завершено';
  return new;
end;
$$;

-- Delivery history only needs the destination and result after the SMTP step.
create trigger automation_clear_mail_content before update of status on public.mail_queue for each row
  when (new.automation_run_id is not null and new.status in ('sent','failed') and new.status is distinct from old.status)
  execute function survey_automation.clear_delivered_content();

create function survey_automation.record_delivery()
returns trigger language plpgsql security definer set search_path = '' as $$
declare updated_run public.automation_runs;
begin
  update public.automation_runs r set
    sent_count=r.sent_count+(new.status='sent')::integer,
    failed_count=r.failed_count+(new.status='failed')::integer,
    last_error=coalesce(new.last_error,r.last_error),
    status=case when r.sent_count+r.failed_count+1<r.recipient_count then 'queued'
      when new.status='failed' or r.failed_count>0 or r.last_error is not null then 'failed'
      else 'succeeded' end
    where r.id=new.automation_run_id and r.status='queued' returning * into updated_run;
  if updated_run.status in ('succeeded','failed') then perform survey_automation.terminal_notice(updated_run); end if;
  return new;
end;
$$;

create trigger automation_mail_delivery after update of status on public.mail_queue for each row
  when (new.automation_run_id is not null and new.status in ('sent','failed') and new.status is distinct from old.status)
  execute function survey_automation.record_delivery();

create function survey_automation.render_template(p_template text,p_values jsonb)
returns text language sql immutable set search_path = '' as $$
  -- Substitute each token from the template once, never from submitted data.
  select coalesce(string_agg(
    case when m[1] ~ '^\{\{[a-z_]+\}\}$'
      then coalesce(p_values->>substr(m[1],3,length(m[1])-4),m[1]) else m[1] end,'' order by position),'')
  from regexp_matches(p_template,'\{\{[a-z_]+\}\}|[^{]+|.','gs') with ordinality tokens(m,position);
$$;

create function survey_automation.response_text(p_schema jsonb,p_data jsonb)
returns text language sql set search_path = '' as $$
  with bindings as (
    select b.* from public.survey_response_bindings(p_schema,p_data)
      with ordinality b(question,value,value_path,ord)
  ), printable as (
    select ord,coalesce(nullif(b.question->>'title',''),b.question->>'name') as label,
      case when b.question->>'type'='file' and jsonb_typeof(b.value)='array' then (
        select string_agg(coalesce(nullif(file->>'name',''),'Прикреплённый файл'),', ' order by pos)
        from jsonb_array_elements(b.value) with ordinality files(file,pos))
      when b.question->>'type'='signaturepad' then 'Подпись доступна в ответе'
      when b.question->>'type'='organization' then coalesce(o.alias,b.value #>> '{}')
      when jsonb_typeof(b.value)='array' and b.question->>'type' in ('checkbox','tagbox','imagepicker','ranking') then (
        select string_agg(coalesce(choice->>'text',selected #>> '{}'),', ' order by pos)
        from jsonb_array_elements(b.value) with ordinality selections(selected,pos)
        left join lateral (select v as choice from jsonb_array_elements(
          case when jsonb_typeof(b.question->'choices')='array' then b.question->'choices' else '[]'::jsonb end
        ) v where v->'value'=selected limit 1) found on true)
      else coalesce(ch.choice->>'text', b.value #>> '{}') end as content,
      p_data #>> (b.value_path[1:cardinality(b.value_path)-1] ||
        (b.value_path[cardinality(b.value_path)]||coalesce(nullif(p_schema->>'commentSuffix',''),'-Comment'))) as comment
    from bindings b
    left join public.education_organizations o on b.question->>'type'='organization' and o.id=case
      when b.value #>> '{}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (b.value #>> '{}')::uuid end
    left join lateral (select v as choice from jsonb_array_elements(
      case when jsonb_typeof(b.question->'choices')='array' then b.question->'choices' else '[]'::jsonb end
    ) v where v->'value'=b.value limit 1) ch on true
    where b.value is not null and b.value<>'null'::jsonb
      and b.question->>'type' not in ('paneldynamic','matrixdynamic','matrixdropdown')
  )
  select string_agg(label||': '||coalesce(content,'')||coalesce(E'\nКомментарий: '||comment,''),E'\n' order by ord)
  from printable;
$$;

create function survey_automation.dispatch_email(
  p_run public.automation_runs,p_form public.forms,p_origin text,p_snapshot jsonb
)
returns void language plpgsql set search_path = '' as $$
declare
  action jsonb;
  response_data jsonb;
  recipients text[];
  field_type text;
  dynamic_recipients text[];
  field_error text;
  respondent text;
  form_link text;
  response_link text;
  subject_text text;
  body_text text;
  details text;
  data_values jsonb;
begin
  if p_origin is null or p_origin !~ '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' or length(p_origin)>300 then
    raise exception 'Для ссылок в письмах задайте PUBLIC_APP_URL' using errcode='P0001';
  end if;
  if not exists(select from public.mail_settings where id=1 and enabled) then
    raise exception 'Отправка почты отключена в администрировании' using errcode='P0001';
  end if;
  action:=p_snapshot->'action';
  response_data:=p_snapshot->'response';
  recipients:=array(select jsonb_array_elements_text(action->'recipients'));
  if action ? 'recipientPath' then
    select q.question->>'type' into field_type from survey_automation.form_fields(p_form.schema) q
      where to_jsonb(q.path)=action->'recipientPath';
    if field_type in ('text','email','organization') then
      select array_agg(distinct email order by email) into dynamic_recipients
      from (
        select survey_automation.email_address(case when field_type='organization' then o.email else v #>> '{}' end) email
        from survey_automation.answer_values(response_data,array(select jsonb_array_elements_text(action->'recipientPath'))) v
        left join public.education_organizations o on field_type='organization' and o.id=case
          when v #>> '{}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (v #>> '{}')::uuid end
        where jsonb_typeof(v)='string'
      ) addresses where email is not null;
    end if;
    if dynamic_recipients is null then field_error:='В выбранном вопросе нет корректного адреса получателя'; end if;
    recipients:=array(select distinct address from unnest(recipients||dynamic_recipients) address order by address);
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
  subject_text:=left(btrim(regexp_replace(survey_automation.render_template(action->>'subject',data_values),'[[:cntrl:]]+',' ','g')),500);
  body_text:=survey_automation.render_template(action->>'body',data_values);
  if strpos(body_text,response_link)=0 then body_text:=body_text||E'\n\n'||response_link; end if;
  if action->>'mode'='full' and p_run.response_id is not null then
    details:=survey_automation.response_text(p_form.schema,response_data);
    if details is not null then body_text:=body_text||E'\n\nОтвет:\n'||details; end if;
  end if;
  if char_length(body_text)>512000 then raise exception 'Ответ слишком длинный для письма. Выберите краткое письмо со ссылкой' using errcode='P0001'; end if;

  insert into public.mail_batches(id,kind,form_id,created_by,total_count)
    values(p_run.id,'automation',p_form.id,p_form.author_id,cardinality(recipients));
  insert into public.mail_queue(batch_id,form_id,recipient_email,recipient_name,subject,body_text,max_attempts,automation_run_id)
    select p_run.id,p_form.id,address,address,coalesce(nullif(subject_text,''),'Уведомление о форме'),body_text,1,p_run.id
    from unnest(recipients) address;
  update public.automation_runs set status='queued',recipient_count=cardinality(recipients),last_error=field_error where id=p_run.id;
end;
$$;

create or replace function public.can_read_mail_batch(target_batch_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.request_is_enabled() and exists (
    select from public.mail_batches b left join public.forms f on f.id=b.form_id
    where b.id=target_batch_id
      and (f.author_id=auth.uid() or (b.form_id is null and b.created_by=auth.uid()))
      and (b.kind<>'automation' or b.created_by=auth.uid())
  );
$$;

create or replace function public.claim_mail_jobs(p_worker_id text,p_limit integer default 20)
returns setof public.mail_queue language plpgsql security definer set search_path = '' as $$
begin
  if length(btrim(p_worker_id)) not between 1 and 200 then
    raise exception 'Invalid worker id' using errcode='22023';
  end if;
  return query
  with candidates as (
    select q.id from public.mail_queue q
    where (
      (q.status='queued' and q.next_attempt_at<=now()
        and (q.automation_run_id is null or survey_automation.run_is_active(q.automation_run_id)))
      or (q.automation_run_id is null and q.status = 'processing' and q.locked_at<now()-interval '10 minutes')
    )
    order by q.next_attempt_at,q.created_at,q.id for update skip locked
    limit least(greatest(p_limit,1),100)
  )
  update public.mail_queue q set status='processing',attempts=q.attempts+1,locked_at=now(),
    locked_by=btrim(p_worker_id),last_error=null
    from candidates c where q.id=c.id returning q.*;
end;
$$;

create function public.process_automations(p_app_origin text,p_limit integer default 50)
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

revoke all on all tables in schema survey_automation from public, anon, authenticated;
revoke all on all functions in schema survey_automation from public, anon, authenticated;
revoke all on function public.mark_notifications_read(uuid),public.save_notification_preferences(text[]),
  public.automation_form_fields(uuid),public.set_automation_rule_enabled(uuid,boolean),
  public.save_automation_rule(uuid,uuid,text,text,boolean,text,numeric,integer,timestamptz,text,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.mark_notifications_read(uuid),public.save_notification_preferences(text[]),
  public.automation_form_fields(uuid),public.set_automation_rule_enabled(uuid,boolean),
  public.save_automation_rule(uuid,uuid,text,text,boolean,text,numeric,integer,timestamptz,text,jsonb,jsonb)
  to authenticated;
revoke all on function public.process_automations(text,integer) from public, anon, authenticated;
grant execute on function public.process_automations(text,integer) to service_role;

notify pgrst,'reload schema';
commit;
