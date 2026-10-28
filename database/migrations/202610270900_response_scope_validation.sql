begin;
set local lock_timeout = '5s';

-- Bind each declared question to its actual answer path. Static panels share
-- their parent's object; dynamic panels introduce an object for each entry.
create or replace function public.survey_response_bindings(
  p_schema jsonb, p_data jsonb, p_path text[] default '{}'::text[], p_depth integer default 0
)
returns table (question jsonb, value jsonb, value_path text[])
language plpgsql immutable set search_path = ''
as $$
declare
  child jsonb;
  entry record;
  answer_path text[];
  answer_value jsonb;
begin
  if p_depth > 32 then
    raise exception 'Структура формы превышает допустимую глубину' using errcode = '22023';
  end if;
  if jsonb_typeof(p_schema -> 'type') = 'string' and p_schema ->> 'type' <> 'panel'
    and jsonb_typeof(p_schema -> 'name') = 'string'
  then
    answer_path := p_path || coalesce(nullif(p_schema ->> 'valueName', ''), p_schema ->> 'name');
    answer_value := p_data -> coalesce(nullif(p_schema ->> 'valueName', ''), p_schema ->> 'name');
    return query select p_schema, answer_value, answer_path;
    if p_schema ->> 'type' = 'paneldynamic' and jsonb_typeof(answer_value) = 'array' then
      for entry in select item, ordinality from jsonb_array_elements(answer_value) with ordinality a(item, ordinality)
      loop
        return query select * from public.survey_response_bindings(
          jsonb_build_object('elements', coalesce(p_schema -> 'templateElements', '[]'::jsonb)), entry.item,
          answer_path || (entry.ordinality - 1)::text, p_depth + 1);
      end loop;
    end if;
    return;
  end if;
  for child in
    select item from jsonb_array_elements(coalesce(p_schema -> 'pages', '[]'::jsonb)) a(item)
    union all
    select item from jsonb_array_elements(coalesce(p_schema -> 'elements', '[]'::jsonb)) a(item)
  loop
    return query select * from public.survey_response_bindings(child, p_data, p_path, p_depth + 1);
  end loop;
end;
$$;
revoke all on function public.survey_response_bindings(jsonb, jsonb, text[], integer) from public, anon, authenticated;

create or replace function public.survey_organization_values(p_schema jsonb, p_data jsonb, p_depth integer default 0)
returns setof jsonb language sql immutable set search_path = '' as $$
  select b.value from public.survey_response_bindings(p_schema, p_data, '{}'::text[], p_depth) b
  where b.question ->> 'type' = 'organization';
$$;
revoke all on function public.survey_organization_values(jsonb, jsonb, integer) from public, anon, authenticated;

create or replace function public.response_data_matches_form(
  form_schema jsonb,
  allowed_organization_types text[],
  response_data jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  binding record;
  organization_id uuid;
  comment_suffix text := coalesce(nullif(form_schema ->> 'commentSuffix', ''), '-Comment');
begin
  if jsonb_typeof(response_data) is distinct from 'object' or pg_column_size(response_data) > 262144 then
    return false;
  end if;
  for binding in select * from public.survey_response_bindings(form_schema, response_data)
  loop
    if binding.question ->> 'type' = 'paneldynamic' and binding.value is not null then
      if jsonb_typeof(binding.value) <> 'array' then return false; end if;
      if exists (select 1 from jsonb_array_elements(binding.value) e where jsonb_typeof(e) <> 'object') then
        return false;
      end if;
    elsif binding.question ->> 'type' = 'organization' and binding.value is not null then
      if jsonb_typeof(binding.value) <> 'string' then return false; end if;
      begin
        organization_id := (binding.value #>> '{}')::uuid;
      exception when invalid_text_representation then
        return false;
      end;
      if not exists (
        select 1 from public.education_organizations organization
        where organization.id = organization_id
          and organization.organization_type = any(allowed_organization_types)
      ) then
        return false;
      end if;
    end if;
  end loop;

  return not exists (
    with bindings as materialized (
      select * from public.survey_response_bindings(form_schema, response_data)
    ), scopes as (
      select '{}'::text[] as path, response_data as data
      union all
      select b.value_path || (e.ordinality - 1)::text, e.item
      from bindings b
      cross join lateral jsonb_array_elements(
        case when b.question ->> 'type' = 'paneldynamic' and jsonb_typeof(b.value) = 'array'
          then b.value else '[]'::jsonb end
      ) with ordinality e(item, ordinality)
    ), allowed_paths as (
      select value_path as path from bindings
      union all
      select value_path[1:cardinality(value_path)-1]
        || (value_path[cardinality(value_path)] || comment_suffix)
      from bindings
      where (question @> '{"showOtherItem":true}' or question @> '{"showCommentArea":true}'
        or question @> '{"hasOther":true}' or question @> '{"hasComment":true}')
        and jsonb_typeof(response_data #> (value_path[1:cardinality(value_path)-1]
          || (value_path[cardinality(value_path)] || comment_suffix))) = 'string'
    )
    select 1 from scopes s cross join lateral jsonb_object_keys(s.data) k(name)
    where not exists (select 1 from allowed_paths a where a.path = s.path || k.name)
  );
end;
$$;
revoke all on function public.response_data_matches_form(jsonb, text[], jsonb) from public;
grant execute on function public.response_data_matches_form(jsonb, text[], jsonb) to service_role;

create or replace function public.validate_response_payload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_form public.forms%rowtype;
  binding record;
  selected_is_archived boolean;
begin
  select f.* into target_form from public.forms f where f.id = new.form_id;
  if target_form.id is null
    or not public.response_data_matches_form(target_form.schema, target_form.organization_types, new.data)
  then
    raise exception 'Ответ не соответствует структуре формы' using errcode = '22023';
  end if;
  -- Lock in UUID order so concurrent submissions acquire organization locks consistently.
  for binding in
    select b.value_path, (b.value #>> '{}')::uuid as organization_id
    from public.survey_response_bindings(target_form.schema, new.data) b
    where b.question ->> 'type' = 'organization' and b.value is not null
    order by 2, 1
  loop
    select o.is_archived into selected_is_archived
    from public.education_organizations o where o.id = binding.organization_id for share;
    if not found then
      raise exception 'Организация не найдена' using errcode = '22023';
    end if;
    if selected_is_archived then
      if tg_op = 'INSERT' then
        raise exception 'Организация удалена из действующего справочника' using errcode = '22023';
      elsif new.form_id is distinct from old.form_id
        or (new.data #> binding.value_path) is distinct from (old.data #> binding.value_path)
      then
        raise exception 'Архивную организацию можно сохранить только в прежнем ответе' using errcode = '22023';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.validate_response_payload() from public;

create or replace function public.list_saved_form_organizations(p_form_id uuid, p_browser_id uuid)
returns table (id uuid, organization_type text, number text, alias text)
language sql stable security definer set search_path = ''
as $$
  select o.id, o.organization_type, o.number, o.alias
  from public.education_organizations o
  where o.is_archived
    and (auth.uid() is null or public.request_is_enabled())
    and exists (
      select 1 from public.responses r
      join public.forms f on f.id = r.form_id
      cross join lateral public.survey_organization_values(f.schema, r.data) v(value)
      where r.form_id = p_form_id and v.value = to_jsonb(o.id::text)
        and (public.request_is_enabled() or r.browser_id = public.browser_capability_hash(p_browser_id))
    )
  order by o.id;
$$;
revoke all on function public.list_saved_form_organizations(uuid, uuid) from public;
grant execute on function public.list_saved_form_organizations(uuid, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
