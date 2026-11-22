begin;

create schema survey_announcements;
revoke all on schema survey_announcements from public, anon, authenticated;

create table survey_announcements.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  message text not null check (char_length(message) between 1 and 12000),
  audience text not null check (audience in ('all', 'user', 'admin')),
  display_mode text not null check (display_mode in ('feed', 'banner', 'modal')),
  require_acknowledgement boolean not null default false,
  action_label text check (char_length(action_label) between 1 and 80),
  action_url text check (char_length(action_url) between 1 and 2048),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  publish_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (status <> 'published' or publish_at is not null),
  check (expires_at is null or publish_at is null or expires_at > publish_at),
  check (action_label is null or action_url is not null)
);
create index announcement_publication on survey_announcements.announcements (publish_at desc, id desc)
  where status = 'published';

create table survey_announcements.recipient_state (
  announcement_id uuid not null references survey_announcements.announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  presented_at timestamptz,
  read_at timestamptz,
  acknowledged_at timestamptz,
  primary key (announcement_id, user_id)
);
create index announcement_recipient_user on survey_announcements.recipient_state (user_id);

alter table survey_announcements.announcements enable row level security;
alter table survey_announcements.recipient_state enable row level security;

-- Eligibility is evaluated at read time, including scheduled announcements and newly eligible profiles.
create function survey_announcements.is_visible(
  p_status text, p_publish_at timestamptz, p_expires_at timestamptz, p_audience text, p_role text
)
returns boolean language sql stable set search_path = '' as $$
  select p_role is not null and p_status = 'published' and p_publish_at <= now()
    and (p_expires_at is null or p_expires_at > now()) and p_audience in ('all', p_role);
$$;

create function survey_announcements.effective_status(p_status text, p_publish_at timestamptz, p_expires_at timestamptz)
returns text language sql stable set search_path = '' as $$
  select case
    when p_status <> 'published' then p_status
    when p_expires_at <= now() then 'archived'
    when p_publish_at > now() then 'scheduled'
    else 'published'
  end;
$$;

create function survey_announcements.require_admin()
returns void language plpgsql stable set search_path = '' as $$
begin
  if public.request_role() is distinct from 'admin' then
    raise exception 'Нет доступа к управлению объявлениями' using errcode = '42501';
  end if;
end;
$$;

create function survey_announcements.lock_announcement(p_id uuid, p_expected_updated_at timestamptz)
returns survey_announcements.announcements language plpgsql set search_path = '' as $$
declare
  target survey_announcements.announcements%rowtype;
begin
  select a.* into target from survey_announcements.announcements a where a.id = p_id for update;
  if not found then
    raise exception 'Объявление не найдено' using errcode = '22023';
  end if;
  if target.updated_at is distinct from p_expected_updated_at then
    raise exception 'Объявление уже изменено. Обновите список и откройте его снова.' using errcode = '40001';
  end if;
  return target;
end;
$$;

create function public.list_admin_announcements(
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

create function public.save_announcement(
  p_id uuid, p_expected_updated_at timestamptz, p_fields jsonb, p_publication text, p_publish_at timestamptz
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target survey_announcements.announcements%rowtype;
  title_value text := btrim(p_fields->>'title');
  message_value text := btrim(p_fields->>'message', E' \t\r\n');
  audience_value text := p_fields->>'audience';
  display_value text := p_fields->>'display_mode';
  label_value text := nullif(btrim(p_fields->>'action_label'), '');
  url_value text := nullif(btrim(p_fields->>'action_url'), '');
  expires_value timestamptz;
  status_value text := 'draft';
  publish_value timestamptz;
begin
  perform survey_announcements.require_admin();
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
  if url_value is not null and (
    char_length(url_value) > 2048 or url_value ~ '[[:space:][:cntrl:]]' or strpos(url_value, chr(92)) > 0
    or not (left(url_value, 1) = '/' and left(url_value, 2) <> '//'
      or url_value ~* '^https?://[^/?#]+')
  ) then
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
    if survey_announcements.effective_status(target.status, target.publish_at, target.expires_at) = 'archived' then
      status_value := 'archived';
      if p_publication <> 'keep' then
        raise exception 'Для новой публикации создайте копию архивного объявления' using errcode = '22023';
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

create function public.change_announcement(p_id uuid, p_expected_updated_at timestamptz, p_action text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target survey_announcements.announcements%rowtype;
  result_id uuid := p_id;
begin
  perform survey_announcements.require_admin();
  target := survey_announcements.lock_announcement(p_id, p_expected_updated_at);
  case p_action
    when 'duplicate' then
      insert into survey_announcements.announcements (
        title, message, audience, display_mode, require_acknowledgement, action_label, action_url
      ) values (
        left(target.title, 112) || ' (копия)', target.message, target.audience, target.display_mode,
        target.require_acknowledgement, target.action_label, target.action_url
      ) returning id into result_id;
    when 'withdraw' then
      if survey_announcements.effective_status(target.status, target.publish_at, target.expires_at)
        not in ('published', 'scheduled') then
        raise exception 'Снять можно только опубликованное или запланированное объявление' using errcode = '22023';
      end if;
      update survey_announcements.announcements set status = 'draft', publish_at = null, updated_at = clock_timestamp()
      where id = p_id;
    when 'archive' then
      update survey_announcements.announcements set
        status = 'archived', publish_at = case when target.publish_at <= now() then target.publish_at end,
        updated_at = clock_timestamp()
      where id = p_id;
    else raise exception 'Неизвестное действие с объявлением' using errcode = '22023';
  end case;
  return result_id;
end;
$$;

create function public.list_notification_feed(
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
     where v.role_name is not null and (p_category is null or n.category = p_category)
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

create function public.notification_unread_count()
returns bigint language sql stable security definer set search_path = '' as $$
  with viewer as (select auth.uid() as user_id, public.request_role() as role_name)
  select
    (select count(*) from viewer v join public.notifications n on n.user_id = v.user_id
     where v.role_name is not null and n.read_at is null)
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
  where user_id = actor and read_at is null and (p_id is null or id = p_id);
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

-- A replacement retains its previous owner, which can differ from the new tables' owner.
alter function public.mark_notifications_read(uuid) owner to current_user;

create function public.acknowledge_announcement(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform from survey_announcements.announcements a where a.id = p_id and a.require_acknowledgement
    and survey_announcements.is_visible(a.status, a.publish_at, a.expires_at, a.audience, public.request_role())
  for share;
  if not found then raise exception 'Объявление недоступно для подтверждения' using errcode = '42501'; end if;

  insert into survey_announcements.recipient_state as s (announcement_id, user_id, read_at, acknowledged_at)
  values (p_id, auth.uid(), now(), now())
  on conflict (announcement_id, user_id) do update
  set read_at = coalesce(s.read_at, excluded.read_at), acknowledged_at = excluded.acknowledged_at
  where s.acknowledged_at is null;
end;
$$;

create function public.list_announcement_prompts(p_visible_ids uuid[] default '{}'::uuid[])
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
    where a.status = 'published' and a.display_mode in ('banner', 'modal')
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

create function public.claim_announcement_prompt(p_id uuid, p_mode text)
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
  where s.presented_at is null and s.read_at is null;
  return found;
end;
$$;

revoke all on all tables in schema survey_announcements from public, anon, authenticated;
revoke all on all functions in schema survey_announcements from public, anon, authenticated;
revoke all on function public.list_admin_announcements(text, timestamptz, uuid, integer),
  public.save_announcement(uuid, timestamptz, jsonb, text, timestamptz), public.change_announcement(uuid, timestamptz, text),
  public.list_notification_feed(text, text, timestamptz, uuid, integer), public.notification_unread_count(),
  public.mark_notifications_read(uuid), public.acknowledge_announcement(uuid),
  public.list_announcement_prompts(uuid[]), public.claim_announcement_prompt(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.list_admin_announcements(text, timestamptz, uuid, integer),
  public.save_announcement(uuid, timestamptz, jsonb, text, timestamptz), public.change_announcement(uuid, timestamptz, text),
  public.list_notification_feed(text, text, timestamptz, uuid, integer), public.notification_unread_count(),
  public.mark_notifications_read(uuid), public.acknowledge_announcement(uuid),
  public.list_announcement_prompts(uuid[]), public.claim_announcement_prompt(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
