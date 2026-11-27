begin;

alter table public.notifications
  add column deleted_at timestamptz,
  add column undoable boolean not null default false check (not undoable or deleted_at is not null);
alter table survey_announcements.recipient_state add column hidden_at timestamptz;

create function survey_announcements.reset_unacknowledged_hides()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update survey_announcements.recipient_state
  set hidden_at = null
  where announcement_id = new.id and hidden_at is not null and acknowledged_at is null;
  return new;
end;
$$;

revoke all on function survey_announcements.reset_unacknowledged_hides() from public, anon, authenticated, service_role;
create trigger announcements_reset_unacknowledged_hides
after update of require_acknowledgement on survey_announcements.announcements
for each row when (new.require_acknowledgement and not old.require_acknowledgement)
execute function survey_announcements.reset_unacknowledged_hides();

-- Keep an identity after retention removes the notification content.
create table survey_automation.notification_event_keys (
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_key text not null,
  primary key (user_id, event_key)
);

create table survey_automation.notification_cleanup_runs (
  ran_at timestamptz primary key,
  removed_count integer not null,
  completed boolean not null
);

alter table survey_automation.notification_event_keys enable row level security;
alter table survey_automation.notification_cleanup_runs enable row level security;
revoke all on survey_automation.notification_event_keys, survey_automation.notification_cleanup_runs
  from public, anon, authenticated, service_role;

insert into survey_automation.notification_event_keys (user_id, event_key)
select user_id, event_key from public.notifications;

-- The unique claim covers all insert paths, including producers running as service_role.
create function survey_automation.claim_notification_event_key()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into survey_automation.notification_event_keys (user_id, event_key)
  values (new.user_id, new.event_key)
  on conflict (user_id, event_key) do nothing;
  if found then return new; end if;
  return null;
end;
$$;

revoke all on function survey_automation.claim_notification_event_key() from public, anon, authenticated, service_role;
create trigger notifications_claim_event_key before insert on public.notifications
for each row execute function survey_automation.claim_notification_event_key();

-- Keep owner SELECT access for Realtime UPDATE delivery. The feed filters deleted rows.
drop index public.notifications_user_list, public.notifications_user_category, public.notifications_user_unread;
create index notifications_user_list on public.notifications (user_id, created_at desc, id desc)
  where deleted_at is null;
create index notifications_user_category on public.notifications (user_id, category, created_at desc, id desc)
  where deleted_at is null;
create index notifications_user_unread on public.notifications (user_id, created_at desc, id desc)
  where read_at is null and deleted_at is null and category not in ('automation_triggered', 'automation_succeeded');
create index notifications_cleanup_deleted on public.notifications (deleted_at, id)
  where deleted_at is not null;
create index notifications_cleanup_read on public.notifications (read_at, id)
  where deleted_at is null and read_at is not null;

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
     where v.role_name is not null and n.deleted_at is null
       and n.category not in ('automation_triggered', 'automation_succeeded')
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
       and a.publish_at <= now() and coalesce(a.expires_at, 'infinity'::timestamptz) > now()
       and survey_announcements.is_visible(a.status, a.publish_at, a.expires_at, a.audience, v.role_name)
       and s.hidden_at is null
       and (p_read = 'all' or (p_read = 'unread' and s.read_at is null) or (p_read = 'read' and s.read_at is not null))
       and (p_before_at is null or (a.publish_at, a.id) < (p_before_at, p_before_id))
     order by a.publish_at desc, a.id desc limit (select size from page_size))
  )
  select c.* from candidates c order by c.created_at desc, c.id desc limit (select size from page_size);
end;
$$;

create or replace function public.notification_unread_count()
returns bigint language sql stable security definer set search_path = '' as $$
  with viewer as (select auth.uid() as user_id, public.request_role() as role_name)
  select
    (select count(*) from viewer v join public.notifications n on n.user_id = v.user_id
     where v.role_name is not null and n.deleted_at is null
       and n.category not in ('automation_triggered', 'automation_succeeded') and n.read_at is null)
    +
    (select count(*) from viewer v cross join survey_announcements.announcements a
     left join survey_announcements.recipient_state s on s.announcement_id = a.id and s.user_id = v.user_id
     where a.status = 'published'
       and a.publish_at <= now() and coalesce(a.expires_at, 'infinity'::timestamptz) > now()
       and survey_announcements.is_visible(a.status, a.publish_at, a.expires_at, a.audience, v.role_name)
       and s.hidden_at is null
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
    and deleted_at is null and read_at is null and (p_id is null or id = p_id);
  get diagnostics personal_count = row_count;

  insert into survey_announcements.recipient_state as s (announcement_id, user_id, read_at)
  select a.id, actor, now() from survey_announcements.announcements a
  left join survey_announcements.recipient_state existing on existing.announcement_id = a.id and existing.user_id = actor
  where (p_id is null or a.id = p_id) and existing.read_at is null and existing.hidden_at is null and a.status = 'published'
    and survey_announcements.is_visible(a.status, a.publish_at, a.expires_at, a.audience, actor_role)
  order by a.id
  on conflict (announcement_id, user_id) do update set read_at = excluded.read_at where s.read_at is null and s.hidden_at is null;
  get diagnostics announcement_count = row_count;
  return personal_count + announcement_count;
end;
$$;

create or replace function public.list_announcement_prompts(p_visible_ids uuid[] default '{}'::uuid[])
returns table (
  id uuid, title text, message text, action_label text, action_url text, display_mode text,
  require_acknowledgement boolean, read_at timestamptz, acknowledged_at timestamptz, expires_at timestamptz,
  presented_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  with viewer as (
    select auth.uid() as user_id, public.request_role() as role_name
  ), eligible as (
    select a.*, s.read_at, s.acknowledged_at, s.presented_at
    from viewer v cross join survey_announcements.announcements a
    left join survey_announcements.recipient_state s on s.announcement_id = a.id and s.user_id = v.user_id
    where a.status = 'published' and a.display_mode in ('banner', 'modal') and s.hidden_at is null
      and survey_announcements.is_visible(a.status, a.publish_at, a.expires_at, a.audience, v.role_name)
  ), next_by_mode as (
    select distinct on (e.display_mode) e.id from eligible e
    where e.presented_at is null and e.read_at is null
    order by e.display_mode, e.publish_at desc, e.id desc
  )
  select e.id, e.title, e.message, e.action_label, e.action_url, e.display_mode, e.require_acknowledgement,
    e.read_at, e.acknowledged_at, e.expires_at, e.presented_at
  from eligible e
  where e.id in (select n.id from next_by_mode n) or e.id = any(p_visible_ids[1:2])
  order by e.publish_at desc, e.id desc;
$$;

create or replace function public.claim_announcement_prompt(p_id uuid, p_mode text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform from survey_announcements.announcements a
  where a.id = p_id and a.display_mode = p_mode and p_mode in ('banner', 'modal')
    and survey_announcements.is_visible(a.status, a.publish_at, a.expires_at, a.audience, public.request_role())
  for share;
  if not found then return false; end if;

  insert into survey_announcements.recipient_state as s (announcement_id, user_id, presented_at)
  values (p_id, auth.uid(), now())
  on conflict (announcement_id, user_id) do update set presented_at = excluded.presented_at
  where s.presented_at is null and s.read_at is null and s.hidden_at is null;
  return found;
end;
$$;

create function public.delete_notification(p_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare deletion_time timestamptz;
begin
  if not public.request_is_enabled() then raise exception 'Нет доступа' using errcode = '42501'; end if;

  update public.notifications set deleted_at = clock_timestamp(), undoable = true
  where id = p_id and user_id = auth.uid() and deleted_at is null
    and category not in ('automation_triggered', 'automation_succeeded')
  returning deleted_at into deletion_time;
  return deletion_time;
end;
$$;

create function public.restore_notification(p_id uuid, p_deleted_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.request_is_enabled() then raise exception 'Нет доступа' using errcode = '42501'; end if;

  update public.notifications set deleted_at = null, undoable = false
  where id = p_id and user_id = auth.uid() and deleted_at = p_deleted_at and undoable
    and category not in ('automation_triggered', 'automation_succeeded')
    and deleted_at >= clock_timestamp() - interval '20 seconds';
  return found;
end;
$$;

create function public.delete_read_notifications(p_category text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  if not public.request_is_enabled() then raise exception 'Нет доступа' using errcode = '42501'; end if;

  update public.notifications set deleted_at = statement_timestamp()
  where user_id = auth.uid() and deleted_at is null and read_at is not null
    and category not in ('automation_triggered', 'automation_succeeded')
    and (p_category is null or category = p_category);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

create function public.hide_announcement(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  actor_role text := public.request_role();
  requires_ack boolean;
begin
  if actor_role is null then raise exception 'Нет доступа' using errcode = '42501'; end if;

  select a.require_acknowledgement into requires_ack
  from survey_announcements.announcements a
  where a.id = p_id and survey_announcements.is_visible(a.status, a.publish_at, a.expires_at, a.audience, actor_role)
  for share;
  if not found then return false; end if;

  if requires_ack then
    update survey_announcements.recipient_state
    set hidden_at = now()
    where announcement_id = p_id and user_id = actor and hidden_at is null and acknowledged_at is not null;
  else
    insert into survey_announcements.recipient_state as s (announcement_id, user_id, hidden_at)
    values (p_id, actor, now())
    on conflict (announcement_id, user_id) do update set hidden_at = excluded.hidden_at
    where s.hidden_at is null;
  end if;
  return found;
end;
$$;

create function public.run_notification_cleanup()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  run_time timestamptz;
  batch_size_per_group constant integer := 2500;
  deleted_items integer;
  read_items integer;
  sweep_complete boolean;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('survey_automation.run_notification_cleanup', 0)) then
    return null;
  end if;

  run_time := clock_timestamp();
  if exists (select from survey_automation.notification_cleanup_runs
    where completed and ran_at > run_time - interval '24 hours') then
    return null;
  end if;

  with candidates as (
    select id from public.notifications
    where deleted_at <= run_time - interval '7 days'
    order by deleted_at, id
    limit batch_size_per_group for update skip locked
  )
  delete from public.notifications n using candidates c where n.id = c.id;
  get diagnostics deleted_items = row_count;

  with candidates as (
    select id from public.notifications
    where deleted_at is null and read_at <= run_time - interval '90 days'
    order by read_at, id
    limit batch_size_per_group for update skip locked
  )
  delete from public.notifications n using candidates c where n.id = c.id;
  get diagnostics read_items = row_count;

  sweep_complete := not exists (
    select from public.notifications where deleted_at <= run_time - interval '7 days'
  ) and not exists (
    select from public.notifications where deleted_at is null and read_at <= run_time - interval '90 days'
  );
  insert into survey_automation.notification_cleanup_runs (ran_at, removed_count, completed)
  values (run_time, deleted_items + read_items, sweep_complete);
  return deleted_items + read_items;
end;
$$;

revoke all on function public.delete_notification(uuid), public.restore_notification(uuid, timestamptz),
  public.delete_read_notifications(text), public.hide_announcement(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_notification(uuid), public.restore_notification(uuid, timestamptz),
  public.delete_read_notifications(text), public.hide_announcement(uuid) to authenticated;

revoke all on function public.run_notification_cleanup() from public, anon, authenticated, service_role;
grant execute on function public.run_notification_cleanup() to service_role;

notify pgrst, 'reload schema';
commit;
