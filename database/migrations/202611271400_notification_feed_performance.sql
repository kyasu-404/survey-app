begin;

alter table survey_automation.notification_cleanup_runs
  add column id bigint generated always as identity;
alter table survey_automation.notification_cleanup_runs
  drop constraint notification_cleanup_runs_pkey,
  add primary key (id);
create index notification_cleanup_runs_completed_at
on survey_automation.notification_cleanup_runs (ran_at desc) where completed;

-- Event producers can replay the same event after the notification's retention window.
-- Keep only the per-account identity until the account is removed.
comment on table survey_automation.notification_event_keys is
  'Permanent per-account event deduplication; keys outlive the notification and cascade on account deletion.';

create index notifications_user_read on public.notifications (user_id, created_at desc, id desc)
where deleted_at is null and read_at is not null and category not in ('automation_triggered', 'automation_succeeded');

create or replace function public.list_notification_feed(
  p_category text, p_read text, p_before_at timestamptz, p_before_id uuid, p_limit integer, p_timezone text
)
returns table (
  id uuid, category text, title text, message text, form_id uuid, response_id uuid, rule_id uuid,
  created_at timestamptz, read_at timestamptz, announcement jsonb, response_group jsonb
)
language plpgsql stable security definer set search_path = '' set plan_cache_mode = force_custom_plan as $$
declare
  actor uuid := auth.uid();
  local_zone text;
  page_size integer := least(greatest(coalesce(p_limit, 26), 1), 101);
begin
  if (p_before_at is null) <> (p_before_id is null) then
    raise exception 'Укажите дату и идентификатор для следующей страницы' using errcode = '22023';
  end if;
  if not public.request_is_enabled() or p_read is null or p_read not in ('all', 'unread', 'read') then return; end if;

  if p_category is null or p_category in ('response_received', 'response_updated') then
    local_zone := survey_automation.notification_timezone(p_timezone);
  end if;

  return query
  with personal_page as (
    select n.id, n.category, n.title, n.message, n.form_id, n.response_id, n.rule_id,
      n.created_at, n.read_at, null::jsonb as announcement, d.local_day
    from public.notifications n
    cross join lateral (
      select case when n.category in ('response_received', 'response_updated') and n.form_id is not null
        then (n.created_at at time zone local_zone)::date end as local_day
    ) d
    where n.user_id = actor and n.deleted_at is null
      and n.category not in ('automation_triggered', 'automation_succeeded')
      and (p_category is null or n.category = p_category)
      and (p_read = 'all' or (p_read = 'unread' and n.read_at is null) or (p_read = 'read' and n.read_at is not null))
      and (p_before_at is null or (n.created_at, n.id) < (p_before_at, p_before_id))
      -- The existence check sees matching rows above the cursor so a group cannot repeat on another page.
      and case when d.local_day is null then true else not exists (
        select 1 from public.notifications newer
        where newer.user_id = actor and newer.deleted_at is null and newer.form_id = n.form_id
          and newer.category in ('response_received', 'response_updated') and newer.category = n.category
          and (newer.created_at, newer.id) > (n.created_at, n.id)
          and newer.created_at < (d.local_day::timestamp at time zone 'UTC') + interval '48 hours'
          and (newer.created_at at time zone local_zone)::date = d.local_day
          and (p_read = 'all' or (p_read = 'unread' and newer.read_at is null) or (p_read = 'read' and newer.read_at is not null))
      ) end
    order by n.created_at desc, n.id desc limit page_size
  ), candidates as (
    select p.* from personal_page p
    union all
    select a.*, null::date as local_day
    from public.list_notification_feed('announcement', p_read, p_before_at, p_before_id, page_size) a
    where p_category is null or p_category = 'announcement'
  ), page as materialized (
    select c.* from candidates c order by c.created_at desc, c.id desc limit page_size
  )
  select p.id, p.category, p.title, p.message, p.form_id, p.response_id, p.rule_id,
    p.created_at, p.read_at, p.announcement,
    case when p.local_day is not null then jsonb_build_object(
      'day', to_char(p.local_day, 'YYYY-MM-DD'), 'count', totals.event_count, 'unread_count', totals.unread_count
    ) end as response_group
  from page p
  left join lateral (
    select count(*) as event_count, count(*) filter (where n.read_at is null) as unread_count
    from public.notifications n
    where p.local_day is not null
      and n.user_id = actor and n.deleted_at is null and n.form_id = p.form_id
      and n.category in ('response_received', 'response_updated') and n.category = p.category
      and n.created_at >= (p.local_day::timestamp at time zone 'UTC') - interval '24 hours'
      and n.created_at < (p.local_day::timestamp at time zone 'UTC') + interval '48 hours'
      and (n.created_at at time zone local_zone)::date = p.local_day
      and (p_read = 'all' or (p_read = 'unread' and n.read_at is null) or (p_read = 'read' and n.read_at is not null))
  ) totals on p.local_day is not null
  order by p.created_at desc, p.id desc;
end;
$$;

notify pgrst, 'reload schema';
commit;
