begin;
set local lock_timeout = '5s';

-- Follow schema scopes: static panels keep the current object; dynamic panels
-- store one object per entry under their name/valueName. Missing organization
-- fields return SQL NULL so a valid sibling cannot hide an incomplete entry.
create or replace function public.survey_organization_values(p_schema jsonb, p_data jsonb, p_depth integer default 0)
returns setof jsonb language plpgsql immutable set search_path = '' as $$
declare child jsonb; entry jsonb; entries jsonb;
begin
  if p_depth > 32 then
    raise exception 'Структура формы превышает допустимую глубину' using errcode = '22023';
  end if;
  if p_schema ->> 'type' = 'organization' then
    return next p_data -> coalesce(nullif(p_schema ->> 'valueName', ''), p_schema ->> 'name');
    return;
  end if;
  if p_schema ->> 'type' = 'paneldynamic' then
    if not jsonb_path_exists(p_schema, '$.** ? (@.type == "organization")') then return; end if;
    entries := p_data -> coalesce(nullif(p_schema ->> 'valueName', ''), p_schema ->> 'name');
    if entries is null or entries = 'null'::jsonb then return; end if;
    if jsonb_typeof(entries) <> 'array' then
      return next null::jsonb;
      return;
    end if;
    for entry in select value from jsonb_array_elements(entries) loop
      return query select * from public.survey_organization_values(
        jsonb_build_object('elements', p_schema -> 'templateElements'), entry, p_depth + 1);
    end loop;
    return;
  end if;
  for child in
    select value from jsonb_array_elements(coalesce(p_schema -> 'pages', '[]'::jsonb))
    union all
    select value from jsonb_array_elements(coalesce(p_schema -> 'elements', '[]'::jsonb))
  loop
    return query select * from public.survey_organization_values(child, p_data, p_depth + 1);
  end loop;
end;
$$;
revoke all on function public.survey_organization_values(jsonb, jsonb, integer) from public, anon, authenticated;

create or replace function public.check_personal_response_data(p_form_id uuid, p_organization_id uuid, p_data jsonb)
returns void language plpgsql stable security definer set search_path = '' as $$
declare organization_value jsonb; organization_count integer := 0;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Некорректные данные ответа' using errcode = '22023';
  end if;
  for organization_value in
    select v.value from public.forms f
    cross join lateral public.survey_organization_values(f.schema, p_data) v(value)
    where f.id = p_form_id
  loop
    organization_count := organization_count + 1;
    if organization_value is distinct from to_jsonb(p_organization_id::text) then
      raise exception 'Организацию в персональной ссылке изменить нельзя' using errcode = '22023';
    end if;
  end loop;
  if organization_count = 0 then
    raise exception 'Укажите организацию в ответе по персональной ссылке' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.check_personal_response_data(uuid, uuid, jsonb) from public, anon, authenticated;

-- Use the same scopes for reminders, including forms without personal links.
create or replace function public.prepare_form_mail_recipients(p_form_id uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.forms%rowtype; recipients jsonb;
begin
  select * into f from public.forms where id = p_form_id for update;
  if not found or not public.is_public_active_form(p_form_id) then
    raise exception 'Форма закрыта для ответов' using errcode = '22023';
  end if;
  if p_kind not in ('invitation', 'reminder') or p_kind is null then
    raise exception 'Некорректный тип рассылки' using errcode = '22023';
  end if;
  if not jsonb_path_exists(f.schema, '$.** ? (@.type == "organization")') then
    raise exception 'Добавьте в форму вопрос «Организация»' using errcode = '22023';
  end if;
  if p_kind = 'invitation' and not f.personal_links_enabled then
    raise exception 'Сначала включите персональные ссылки' using errcode = '22023';
  end if;
  perform public.ensure_form_personal_links(p_form_id);
  select coalesce(jsonb_agg(to_jsonb(recipient)), '[]'::jsonb) into recipients from (
    select o.id, o.organization_type, o.number, o.alias, o.email,
      case when f.personal_links_enabled then l.token else null end as token
    from public.education_organizations o
    left join public.form_personal_links l on l.form_id = f.id and l.organization_id = o.id
    where not o.is_archived and o.organization_type = any(f.organization_types)
      and (p_kind = 'invitation' or not exists (
        select 1 from public.responses r
        cross join lateral public.survey_organization_values(f.schema, r.data) v(value)
        where r.form_id = f.id and v.value = to_jsonb(o.id::text)
      ))
    order by o.organization_type, o.number, o.alias, o.id limit 5001
  ) recipient;
  if jsonb_array_length(recipients) > 5000 then
    raise exception 'За одну рассылку можно поставить в очередь не более 5000 писем' using errcode = '22023';
  end if;
  return jsonb_build_object('personal', f.personal_links_enabled, 'recipients', recipients);
end;
$$;
revoke all on function public.prepare_form_mail_recipients(uuid, text) from public, anon, authenticated;
grant execute on function public.prepare_form_mail_recipients(uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
