begin;

-- Preserve historical rows while keeping service events out of the personal feed.
alter policy notifications_owner on public.notifications
  using (user_id=(select auth.uid()) and (select public.request_is_enabled())
    and category not in ('automation_triggered', 'automation_succeeded'));

update public.notification_preferences
set muted_categories = array_remove(array_remove(muted_categories,'automation_triggered'),'automation_succeeded')
where muted_categories && array['automation_triggered','automation_succeeded'];

create or replace function survey_automation.stage_run(
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
end;
$$;

create or replace function survey_automation.terminal_notice(p_run public.automation_runs)
returns void language sql set search_path = '' as $$
  select survey_automation.notify(a.user_id,
    'automation_failed',
    p_run.id::text||':finished',
    case when p_run.status='cancelled' then 'Выполнение правила отменено' else 'Ошибка автоматизации' end,
    a.name||' · '||p_run.form_title||coalesce(' — '||p_run.last_error,''),
    p_run.form_id,p_run.response_id,p_run.rule_id)
  from public.automation_rules a where a.id=p_run.rule_id and p_run.status in ('failed', 'cancelled');
$$;

create or replace function public.save_notification_preferences(p_muted_categories text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Ignore retired categories submitted by a tab opened before the update.
  p_muted_categories := array_remove(array_remove(p_muted_categories,'automation_triggered'),'automation_succeeded');
  if p_muted_categories is null or cardinality(p_muted_categories)>4 or array_position(p_muted_categories,null) is not null
    or not p_muted_categories <@ array['response_received','response_updated','automation_failed','form_status'] then
    raise exception 'Неизвестный тип уведомлений' using errcode='22023';
  end if;
  if not public.request_is_enabled() then raise exception 'Нет доступа' using errcode='42501'; end if;
  insert into public.notification_preferences(user_id,muted_categories) values(auth.uid(),p_muted_categories)
  on conflict (user_id) do update set muted_categories=excluded.muted_categories;
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
language sql stable security definer set search_path = '' as $$
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
$$;

create or replace function public.notification_unread_count()
returns bigint language sql stable security definer set search_path = '' as $$
  with viewer as (select auth.uid() as user_id, public.request_role() as role_name)
  select
    (select count(*) from viewer v join public.notifications n on n.user_id = v.user_id
     where v.role_name is not null and n.category not in ('automation_triggered', 'automation_succeeded') and n.read_at is null)
    +
    (select count(*) from viewer v cross join survey_announcements.announcements a
     left join survey_announcements.recipient_state s on s.announcement_id = a.id and s.user_id = v.user_id
     where a.status = 'published'
       and survey_announcements.is_visible(a.status, a.publish_at, a.expires_at, a.audience, v.role_name)
       and s.read_at is null);
$$;

create or replace function public.mark_notifications_read(p_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  actor_role text := public.request_role();
  personal_count integer;
  announcement_count integer;
begin
  if actor_role is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  update public.notifications set read_at = now()
  where user_id = actor and category not in ('automation_triggered', 'automation_succeeded')
    and read_at is null and (p_id is null or id = p_id);
  get diagnostics personal_count = row_count;

  insert into survey_announcements.recipient_state as s (announcement_id, user_id, read_at)
  select a.id, actor, now() from survey_announcements.announcements a
  left join survey_announcements.recipient_state existing on existing.announcement_id = a.id and existing.user_id = actor
  where (p_id is null or a.id = p_id) and existing.read_at is null and a.status = 'published'
    and survey_announcements.is_visible(a.status, a.publish_at, a.expires_at, a.audience, actor_role)
  order by a.id
  on conflict (announcement_id, user_id) do update set read_at = excluded.read_at where s.read_at is null;
  get diagnostics announcement_count = row_count;
  return personal_count + announcement_count;
end;
$$;

notify pgrst,'reload schema';
commit;
