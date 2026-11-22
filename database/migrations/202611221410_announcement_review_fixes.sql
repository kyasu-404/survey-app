begin;

create function survey_announcements.valid_action_url(p_url text)
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
  if url_parts is null or coalesce(url_parts[2]::integer, 0) > 65535 then
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

revoke all on function survey_announcements.valid_action_url(text) from public, anon, authenticated;

create or replace function public.save_announcement(
  p_id uuid, p_expected_updated_at timestamptz, p_fields jsonb, p_publication text, p_publish_at timestamptz
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target survey_announcements.announcements%rowtype;
  title_value text := regexp_replace(p_fields->>'title', '^[[:space:]]+|[[:space:]]+$', '', 'g');
  message_value text := regexp_replace(p_fields->>'message', '^[[:space:]]+|[[:space:]]+$', '', 'g');
  audience_value text := p_fields->>'audience';
  display_value text := p_fields->>'display_mode';
  label_value text := nullif(regexp_replace(p_fields->>'action_label', '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  url_value text := nullif(regexp_replace(p_fields->>'action_url', '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  expires_value timestamptz;
  status_value text := 'draft';
  current_status text;
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

notify pgrst, 'reload schema';
commit;
