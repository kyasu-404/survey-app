begin;

create index notifications_response_group_items
on public.notifications (user_id, category, form_id, created_at desc, id desc)
where deleted_at is null and form_id is not null and category in ('response_received', 'response_updated');

create function survey_automation.notification_timezone(p_timezone text)
returns text language sql stable set search_path = '' as $$
  select coalesce((
    select z.name from pg_catalog.pg_timezone_names z where z.name = p_timezone limit 1
  ), 'UTC');
$$;

revoke all on function survey_automation.notification_timezone(text) from public, anon, authenticated, service_role;

create function public.list_notification_feed(
  p_category text, p_read text, p_before_at timestamptz, p_before_id uuid, p_limit integer, p_timezone text
)
returns table (
  id uuid, category text, title text, message text, form_id uuid, response_id uuid, rule_id uuid,
  created_at timestamptz, read_at timestamptz, announcement jsonb, response_group jsonb
)
language plpgsql stable security definer set search_path = '' as $$
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
  -- Rank all matching responses before applying the cursor so a group cannot split across pages.
  with matching_responses as (
    select n.id, n.category, n.form_id, n.created_at, n.read_at, (n.created_at at time zone local_zone)::date as local_day
    from public.notifications n
    where local_zone is not null and n.user_id = actor and n.deleted_at is null and n.form_id is not null
      and n.category in ('response_received', 'response_updated')
      and (p_category is null or n.category = p_category)
      and (p_read = 'all' or (p_read = 'unread' and n.read_at is null) or (p_read = 'read' and n.read_at is not null))
  ), ranked_responses as (
    select m.id, m.created_at, m.local_day,
      row_number() over (calendar_group order by m.created_at desc, m.id desc) as position,
      count(*) over calendar_group as event_count,
      count(*) filter (where m.read_at is null) over calendar_group as unread_count
    from matching_responses m
    window calendar_group as (partition by m.form_id, m.category, m.local_day)
  ), personal_candidates as (
    select r.id, r.created_at,
      jsonb_build_object(
        'day', to_char(r.local_day, 'YYYY-MM-DD'), 'count', r.event_count, 'unread_count', r.unread_count
      ) as response_group
    from ranked_responses r
    where r.position = 1 and (p_before_at is null or (r.created_at, r.id) < (p_before_at, p_before_id))
    union all
    (select n.id, n.created_at, null::jsonb as response_group
     from public.notifications n
     where n.user_id = actor and n.deleted_at is null
       and n.category not in ('automation_triggered', 'automation_succeeded')
       and not (n.category in ('response_received', 'response_updated') and n.form_id is not null)
       and (p_category is null or n.category = p_category)
       and (p_read = 'all' or (p_read = 'unread' and n.read_at is null) or (p_read = 'read' and n.read_at is not null))
       and (p_before_at is null or (n.created_at, n.id) < (p_before_at, p_before_id))
     order by n.created_at desc, n.id desc limit page_size)
  ), personal_page as (
    select c.id, c.response_group
    from personal_candidates c order by c.created_at desc, c.id desc limit page_size
  ), combined as (
    select n.id, n.category, n.title, n.message, n.form_id, n.response_id, n.rule_id,
      n.created_at, n.read_at, null::jsonb as announcement, p.response_group
    from personal_page p join public.notifications n on n.id = p.id
    union all
    select a.*, null::jsonb as response_group
    from public.list_notification_feed('announcement', p_read, p_before_at, p_before_id, page_size) a
    where p_category is null or p_category = 'announcement'
  )
  select c.* from combined c order by c.created_at desc, c.id desc limit page_size;
end;
$$;

create function public.list_notification_group_items(
  p_category text, p_form_id uuid, p_day date, p_read text, p_timezone text,
  p_before_at timestamptz, p_before_id uuid, p_limit integer
)
returns table (
  id uuid, category text, title text, message text, form_id uuid, response_id uuid, rule_id uuid,
  created_at timestamptz, read_at timestamptz, announcement jsonb
)
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  local_zone text;
  start_at timestamptz;
  end_at timestamptz;
begin
  if (p_before_at is null) <> (p_before_id is null) then
    raise exception 'Укажите дату и идентификатор для следующей страницы' using errcode = '22023';
  end if;
  if not public.request_is_enabled()
    or p_category is null or p_category not in ('response_received', 'response_updated')
    or p_form_id is null or p_day is null or not isfinite(p_day)
    or p_read is null or p_read not in ('all', 'unread', 'read') then
    return;
  end if;

  -- Bound the index scan in UTC. The local-date check also handles repeated or skipped midnights.
  begin
    start_at := (p_day::timestamp at time zone 'UTC') - interval '24 hours';
    end_at := (p_day::timestamp at time zone 'UTC') + interval '48 hours';
  exception when datetime_field_overflow then return;
  end;
  local_zone := survey_automation.notification_timezone(p_timezone);

  return query
  select n.id, n.category, n.title, n.message, n.form_id, n.response_id, n.rule_id,
    n.created_at, n.read_at, null::jsonb
  from public.notifications n
  where n.user_id = actor and n.deleted_at is null and n.form_id = p_form_id
    and n.category in ('response_received', 'response_updated') and n.category = p_category
    and n.created_at >= start_at and n.created_at < end_at and (n.created_at at time zone local_zone)::date = p_day
    and (p_read = 'all' or (p_read = 'unread' and n.read_at is null) or (p_read = 'read' and n.read_at is not null))
    and (p_before_at is null or (n.created_at, n.id) < (p_before_at, p_before_id))
  order by n.created_at desc, n.id desc limit least(greatest(coalesce(p_limit, 26), 1), 101);
end;
$$;

revoke all on function public.list_notification_feed(text, text, timestamptz, uuid, integer, text),
  public.list_notification_group_items(text, uuid, date, text, text, timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_notification_feed(text, text, timestamptz, uuid, integer, text),
  public.list_notification_group_items(text, uuid, date, text, text, timestamptz, uuid, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
