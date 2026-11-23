begin;

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
  if p_id is null then
    if (select count(*) from public.automation_rules where user_id=actor)>=50 then
      raise exception 'На одну учётную запись доступно до 50 правил' using errcode='22023';
    end if;
    insert into public.automation_rules(user_id,form_id,name,description,enabled,event_type,threshold,interval_minutes,
        scheduled_at,match_mode,conditions,action_config)
      values(actor,p_form_id,btrim(p_name),p_description,p_enabled,p_event_type,p_threshold,p_interval_minutes,
        p_scheduled_at,p_match_mode,p_conditions,p_action)
      returning * into saved;
    event_changed:=true;
  else
    select * into previous from public.automation_rules where id=p_id and user_id=actor for no key update;
    if not found then raise exception 'Правило не найдено' using errcode='42501'; end if;
    event_changed:=row(previous.form_id,previous.event_type,previous.threshold,previous.interval_minutes,
      previous.scheduled_at,previous.match_mode,previous.conditions) is distinct from
      row(p_form_id,p_event_type,p_threshold,p_interval_minutes,p_scheduled_at,p_match_mode,p_conditions);
    update public.automation_rules set form_id=p_form_id,name=btrim(p_name),description=p_description,
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
    or coalesce(substring(p_origin from ':([0-9]{1,5})$')::integer,1) not between 1 and 65535 then
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
    or coalesce(substring(p_app_origin from ':([0-9]{1,5})$')::integer,1) not between 1 and 65535 then
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

create or replace function survey_announcements.valid_action_url(p_url text)
returns boolean language plpgsql immutable strict set search_path = '' as $$
declare
  url_parts text[];
begin
  if char_length(p_url) > 2048 or p_url ~ '[[:space:][:cntrl:]]' or strpos(p_url, chr(92)) > 0 then
    return false;
  end if;
  if left(p_url, 1) = '/' then
    -- Absolute paths are stored after the client normalizes dot segments.
    return left(p_url, 2) <> '//'
      and split_part(split_part(p_url, '?', 1), '#', 1) !~* '/(?:\.|%2e){1,2}(?:/|$)';
  end if;

  url_parts := regexp_match(p_url,
    '^https?://(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.?)(?::([0-9]{1,5}))?(?:[/?#]|$)',
    'i');
  if url_parts is null or coalesce(url_parts[2]::integer, 1) not between 1 and 65535 then
    return false;
  end if;
  if left(url_parts[1], 1) = '[' then
    return family(substr(url_parts[1], 2, length(url_parts[1]) - 2)::inet) = 6;
  end if;
  return true;
exception when invalid_text_representation then
  return false;
end;
$$;

notify pgrst, 'reload schema';
commit;
