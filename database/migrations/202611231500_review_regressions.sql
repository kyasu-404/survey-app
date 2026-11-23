begin;

alter table public.automation_rules
  add column archived_at timestamptz,
  add constraint automation_rules_archive_state check (archived_at is null or not enabled);

create index automation_rules_active_list on public.automation_rules (user_id, created_at desc, id desc)
  where archived_at is null;

create index automation_runs_succeeded on public.automation_runs (rule_id) where status='succeeded';

create index mail_queue_ordinary_exhausted on public.mail_queue (next_attempt_at, created_at, id)
  where automation_run_id is null and status in ('queued','processing') and attempts>=max_attempts;

drop index public.notifications_user_unread;

create index notifications_user_unread on public.notifications (user_id, created_at desc, id desc)
  where read_at is null and category not in ('automation_triggered', 'automation_succeeded');

create or replace function public.claim_mail_jobs(p_worker_id text,p_limit integer default 20)
returns setof public.mail_queue language plpgsql security definer set search_path = '' as $$
begin
  if length(btrim(p_worker_id)) not between 1 and 200 then
    raise exception 'Invalid worker id' using errcode='22023';
  end if;

  -- A worker can lose its last lease before recording a result. Finalize those
  -- jobs without holding up other workers or increasing their attempt count.
  with exhausted as (
    select q.id from public.mail_queue q
    where q.automation_run_id is null and q.attempts>=q.max_attempts
      and (q.status='queued' or (q.status='processing' and q.locked_at<now()-interval '10 minutes'))
    order by q.next_attempt_at,q.created_at,q.id
    limit least(greatest(p_limit,1),100) for update skip locked
  )
  update public.mail_queue q set status='failed',locked_at=null,locked_by=null,
    last_error=coalesce(q.last_error,'Не удалось подтвердить отправку письма')
    from exhausted e where q.id=e.id;

  return query
  with candidates as (
    select q.id from public.mail_queue q
    where q.attempts<q.max_attempts and (
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
    cross join lateral (select coalesce(nullif(n.node->>'valueName',''),nullif(n.node->>'name','')) as key,
      coalesce(survey_automation.localized_text(n.node->'title'),nullif(n.node->>'name',''),
        nullif(n.node->>'valueName','')) as label) field
    cross join lateral jsonb_array_elements(
      (case when jsonb_typeof(n.node->'pages')='array' then n.node->'pages' else '[]'::jsonb end) ||
      (case when jsonb_typeof(n.node->'elements')='array' then n.node->'elements' else '[]'::jsonb end) ||
      (case when n.node->>'type'='paneldynamic' and jsonb_typeof(n.node->'templateElements')='array'
        then n.node->'templateElements' else '[]'::jsonb end)
    ) children(node)
    where n.depth<32 and (n.node->>'type' is distinct from 'paneldynamic' or field.key is not null)
  )
  select distinct on (1) parent_path || coalesce(nullif(node->>'valueName',''),node->>'name'),
    parent_label || coalesce(survey_automation.localized_text(node->'title'),node->>'name'),node
  from nodes where char_length(node->>'name')>0 and node->>'type' in (
    'text','email','comment','boolean','rating','slider','integer','number','float','date','datetime','time','phone',
    'dropdown','radiogroup','checkbox','tagbox','imagepicker','ranking','organization')
  order by 1,depth,node;
$$;

create or replace function survey_automation.condition_matches(p_answer jsonb,p_condition jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  case p_condition->>'op'
    when 'eq' then
      if jsonb_typeof(p_answer)='array' then
        if jsonb_array_length(p_answer)<>1 then return false; end if;
        p_answer:=p_answer->0;
      end if;
      return jsonb_typeof(p_answer) in ('string','number','boolean') and (
        p_answer #>> '{}' = p_condition->>'value' or
        ((jsonb_typeof(p_answer)='number' or jsonb_typeof(p_condition->'value')='number') and
          coalesce(survey_automation.number(p_answer)=survey_automation.number(p_condition->'value'),false))
      );
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

create or replace function public.set_automation_rule_enabled(p_id uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare current_rule public.automation_rules;
begin
  if not public.request_is_enabled() or p_enabled is null then raise exception 'Нет доступа' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('survey-automation-owner:'||auth.uid()::text,0));
  select * into current_rule from public.automation_rules where id=p_id and user_id=auth.uid();
  if not found then raise exception 'Правило не найдено' using errcode='42501'; end if;
  if current_rule.archived_at is not null then raise exception 'Правило в архиве' using errcode='42501'; end if;
  perform from public.forms f
  where f.id=current_rule.form_id
    or (p_enabled and not current_rule.enabled and current_rule.form_id is null
      and f.author_id=current_rule.user_id and f.form_type<>'template')
  order by f.id for key share;
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
      where id=p_id and user_id=current_rule.user_id returning * into current_rule;
    if not found then raise exception 'Правило не найдено' using errcode='42501'; end if;
    if p_enabled then perform survey_automation.resume_targets(current_rule); end if;
  end if;
end;
$$;

create or replace function public.archive_automation_rule(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  current_rule public.automation_rules;
begin
  if not public.request_is_enabled() then raise exception 'Нет доступа' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('survey-automation-owner:'||actor::text,0));
  select * into current_rule from public.automation_rules where id=p_id and user_id=actor;
  if not found then raise exception 'Правило не найдено' using errcode='42501'; end if;
  if current_rule.archived_at is not null then return; end if;

  perform from public.forms where id=current_rule.form_id for key share;
  update public.automation_rules set enabled=false,archived_at=now(),updated_at=now(),delivery_version=delivery_version+1
  where id=p_id and user_id=actor;
  if not found then raise exception 'Правило не найдено' using errcode='42501'; end if;
  delete from survey_automation.targets where rule_id=p_id;
end;
$$;

create or replace function survey_automation.on_profile_enabled()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.automation_rules;
begin
  perform pg_advisory_xact_lock(hashtextextended('survey-automation-owner:'||new.id::text,0));
  perform from public.forms f
  where exists (select from public.automation_rules r where r.user_id=new.id and r.enabled
    and (r.form_id=f.id or (r.form_id is null and f.author_id=new.id and f.form_type<>'template')))
  order by f.id for key share;
  -- Runs captured before the account was disabled must stay inactive after reactivation.
  for a in update public.automation_rules set delivery_version=delivery_version+1
    where user_id=new.id and enabled returning * loop
    perform survey_automation.resume_targets(a);
  end loop;
  return new;
end;
$$;

create or replace function survey_automation.process_threshold_checks(p_limit integer)
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
    join public.forms form on form.id=t.form_id and form.author_id=a.user_id and form.form_type<>'template'
    where t.check_at is not null and not t.complete
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

create or replace function public.save_notification_preferences(p_muted_categories text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.request_is_enabled() then raise exception 'Нет доступа' using errcode='42501'; end if;
  if p_muted_categories is null or coalesce(array_ndims(p_muted_categories),1)<>1 or exists (
    select from unnest(p_muted_categories) category where category is null or category not in (
      'response_received','response_updated','automation_failed','form_status','automation_triggered','automation_succeeded')
  ) then
    raise exception 'Неизвестный тип уведомлений' using errcode='22023';
  end if;
  -- Ignore retired categories submitted by a tab opened before the update.
  select coalesce(array_agg(distinct category order by category),'{}') into p_muted_categories
  from unnest(p_muted_categories) category where category not in ('automation_triggered','automation_succeeded');
  insert into public.notification_preferences(user_id,muted_categories) values(auth.uid(),p_muted_categories)
  on conflict (user_id) do update set muted_categories=excluded.muted_categories;
end;
$$;

create or replace function public.list_admin_announcements(
  p_status text, p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 26
)
returns table (
  id uuid, title text, message text, audience text, display_mode text, require_acknowledgement boolean,
  action_label text, action_url text, status text, publish_at timestamptz, expires_at timestamptz,
  created_at timestamptz, updated_at timestamptz, audience_count integer, familiar_count integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform survey_announcements.require_admin();
  if p_status is null or p_status not in ('draft', 'scheduled', 'published', 'archived') then
    raise exception 'Неизвестное состояние объявления' using errcode = '22023';
  end if;
  if (p_before_at is null) <> (p_before_id is null) then
    raise exception 'Укажите дату и идентификатор для следующей страницы' using errcode = '22023';
  end if;

  return query
  with page as (
    select a.* from survey_announcements.announcements a
    where survey_announcements.effective_status(a.status, a.publish_at, a.expires_at) = p_status
      and (p_before_at is null or (a.created_at, a.id) < (p_before_at, p_before_id))
    order by a.created_at desc, a.id desc
    limit least(greatest(coalesce(p_limit, 26), 1), 101)
  ), population as (
    select count(*)::integer as total,
      count(*) filter (where p.role = 'admin')::integer as admins,
      count(*) filter (where p.role = 'user')::integer as users
    from public.profiles p where not p.is_disabled
  )
  select a.id, a.title, a.message, a.audience, a.display_mode, a.require_acknowledgement,
    a.action_label, a.action_url, p_status, a.publish_at, a.expires_at, a.created_at, a.updated_at,
    case a.audience when 'admin' then p.admins when 'user' then p.users else p.total end,
    stats.familiar
  from page a cross join population p
  cross join lateral (
    select count(*)::integer as familiar
    from survey_announcements.recipient_state s join public.profiles recipient on recipient.id = s.user_id
    where s.announcement_id = a.id and not recipient.is_disabled and a.audience in ('all', recipient.role)
      and (case when a.require_acknowledgement then s.acknowledged_at else s.read_at end) is not null
  ) stats
  order by a.created_at desc, a.id desc;
end;
$$;

create or replace function public.save_announcement(
  p_id uuid, p_expected_updated_at timestamptz, p_fields jsonb, p_publication text, p_publish_at timestamptz
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target survey_announcements.announcements%rowtype;
  title_value text;
  message_value text;
  audience_value text;
  display_value text;
  label_value text;
  url_value text;
  expires_value timestamptz;
  status_value text := 'draft';
  current_status text;
  publish_value timestamptz;
begin
  perform survey_announcements.require_admin();
  title_value := regexp_replace(p_fields->>'title', '^[[:space:]]+|[[:space:]]+$', '', 'g');
  message_value := regexp_replace(p_fields->>'message', '^[[:space:]]+|[[:space:]]+$', '', 'g');
  audience_value := p_fields->>'audience';
  display_value := p_fields->>'display_mode';
  label_value := nullif(regexp_replace(p_fields->>'action_label', '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  url_value := nullif(regexp_replace(p_fields->>'action_url', '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  if jsonb_typeof(p_fields) is distinct from 'object'
    or jsonb_typeof(p_fields->'title') is distinct from 'string'
    or jsonb_typeof(p_fields->'message') is distinct from 'string'
    or jsonb_typeof(p_fields->'require_acknowledgement') is distinct from 'boolean'
    or coalesce(jsonb_typeof(p_fields->'action_label'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_fields->'action_url'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_fields->'expires_at'), 'null') not in ('string', 'null')
    or char_length(title_value) not between 1 and 120
    or char_length(message_value) not between 1 and 12000
    or audience_value is null or audience_value not in ('all', 'user', 'admin')
    or display_value is null or display_value not in ('feed', 'banner', 'modal')
    or p_publication is null or p_publication not in ('keep', 'publish', 'schedule') then
    raise exception 'Проверьте содержание и параметры объявления' using errcode = '22023';
  end if;
  if char_length(label_value) > 80 or (label_value is not null and url_value is null) then
    raise exception 'Укажите ссылку и подпись длиной до 80 символов' using errcode = '22023';
  end if;
  if url_value is not null and not survey_announcements.valid_action_url(url_value) then
    raise exception 'Укажите ссылку HTTP, HTTPS или путь внутри приложения' using errcode = '22023';
  end if;
  begin
    expires_value := (p_fields->>'expires_at')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Некорректная дата окончания' using errcode = '22023';
  end;
  if expires_value is not null and not isfinite(expires_value) then
    raise exception 'Некорректная дата окончания' using errcode = '22023';
  end if;

  if p_id is not null then
    target := survey_announcements.lock_announcement(p_id, p_expected_updated_at);
    status_value := target.status;
    publish_value := target.publish_at;
    current_status := survey_announcements.effective_status(target.status, target.publish_at, target.expires_at);
    if current_status = 'published' and p_publication <> 'keep' then
      raise exception 'Объявление уже опубликовано. Обновите список и откройте его снова.' using errcode = '40001';
    end if;
    if current_status = 'archived' then
      status_value := 'archived';
      if p_publication <> 'keep' then
        raise exception 'Для новой публикации создайте копию архивного объявления' using errcode = '22023';
      end if;
      if expires_value is distinct from target.expires_at then
        raise exception 'Объявление в архиве. Обновите список и откройте его снова.' using errcode = '40001';
      end if;
    end if;
  end if;
  if p_publication = 'publish' then
    status_value := 'published';
    publish_value := now();
  elsif p_publication = 'schedule' then
    if p_publish_at is null or not isfinite(p_publish_at) or p_publish_at <= now() then
      raise exception 'Выберите время публикации в будущем' using errcode = '22023';
    end if;
    status_value := 'published';
    publish_value := p_publish_at;
  end if;

  if expires_value is not null and (
    expires_value <= publish_value or (status_value = 'published' and expires_value <= now())
  ) then
    raise exception 'Окончание должно быть позже времени публикации' using errcode = '22023';
  end if;
  if p_id is null then
    insert into survey_announcements.announcements (
      title, message, audience, display_mode, require_acknowledgement, action_label, action_url, status, publish_at, expires_at
    ) values (
      title_value, message_value, audience_value, display_value, (p_fields->>'require_acknowledgement')::boolean,
      label_value, url_value, status_value, publish_value, expires_value
    ) returning id into p_id;
  else
    update survey_announcements.announcements a set
      title = title_value, message = message_value, audience = audience_value, display_mode = display_value,
      require_acknowledgement = (p_fields->>'require_acknowledgement')::boolean,
      action_label = label_value, action_url = url_value, status = status_value, publish_at = publish_value,
      expires_at = expires_value, updated_at = clock_timestamp()
    where a.id = p_id;
  end if;
  return p_id;
end;
$$;

create or replace function public.list_notification_feed(
  p_category text default null, p_read text default 'all', p_before_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 26
)
returns table (
  id uuid, category text, title text, message text, form_id uuid, response_id uuid, rule_id uuid,
  created_at timestamptz, read_at timestamptz, announcement jsonb
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (p_before_at is null) <> (p_before_id is null) then
    raise exception 'Укажите дату и идентификатор для следующей страницы' using errcode = '22023';
  end if;
  return query
  with viewer as (
    select auth.uid() as user_id, public.request_role() as role_name
  ), page_size as (
    select least(greatest(coalesce(p_limit, 26), 1), 101) as size
  ), candidates as (
    (select n.id, n.category, n.title, n.message, n.form_id, n.response_id, n.rule_id,
       n.created_at, n.read_at, null::jsonb as announcement
     from viewer v join public.notifications n on n.user_id = v.user_id
     where v.role_name is not null and n.category not in ('automation_triggered', 'automation_succeeded')
       and (p_category is null or n.category = p_category)
       and (p_read = 'all' or (p_read = 'unread' and n.read_at is null) or (p_read = 'read' and n.read_at is not null))
       and (p_before_at is null or (n.created_at, n.id) < (p_before_at, p_before_id))
     order by n.created_at desc, n.id desc limit (select size from page_size))
    union all
    (select a.id, 'announcement'::text, a.title, a.message, null::uuid, null::uuid, null::uuid, a.publish_at, s.read_at,
       jsonb_build_object('display_mode', a.display_mode, 'action_label', a.action_label, 'action_url', a.action_url,
         'require_acknowledgement', a.require_acknowledgement, 'acknowledged_at', s.acknowledged_at)
     from viewer v cross join survey_announcements.announcements a
     left join survey_announcements.recipient_state s on s.announcement_id = a.id and s.user_id = v.user_id
     where (p_category is null or p_category = 'announcement')
       and a.status = 'published'
       and survey_announcements.is_visible(a.status, a.publish_at, a.expires_at, a.audience, v.role_name)
       and (p_read = 'all' or (p_read = 'unread' and s.read_at is null) or (p_read = 'read' and s.read_at is not null))
       and (p_before_at is null or (a.publish_at, a.id) < (p_before_at, p_before_id))
     order by a.publish_at desc, a.id desc limit (select size from page_size))
  )
  select c.* from candidates c order by c.created_at desc, c.id desc limit (select size from page_size);
end;
$$;

revoke all on function public.archive_automation_rule(uuid) from public, anon, authenticated;
grant execute on function public.archive_automation_rule(uuid) to authenticated;

-- Recount affected threshold targets in batches when their next check runs.
-- Existing completed targets and scheduled checks retain their state.
update survey_automation.targets t set matching_count=0,count_ready=false,count_cursor_at=null,count_cursor_id=null
from public.automation_rules a
where a.id=t.rule_id and a.event_type in ('response_count','matching_count','matching_share')
  and not t.complete and a.conditions @> '[{"op":"eq"}]'::jsonb;

notify pgrst,'reload schema';
commit;
