begin;

-- Keep UUIDs and all historical references; existing records remain active.
alter table public.education_organizations
  add column if not exists is_archived boolean not null default false;

create or replace function public.archive_education_organization()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.education_organizations
  set is_archived = true
  where id = old.id and not is_archived;
  return null;
end;
$$;

revoke all on function public.archive_education_organization() from public;

drop trigger if exists education_organizations_archive_on_delete on public.education_organizations;
create trigger education_organizations_archive_on_delete
before delete on public.education_organizations
for each row execute procedure public.archive_education_organization();

create or replace function public.list_form_organizations(p_form_id uuid)
returns table (
  id uuid,
  organization_type text,
  number text,
  alias text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.organization_type, o.number, o.alias
  from public.education_organizations o
  join public.forms f on f.id = p_form_id
  where not o.is_archived
    and o.organization_type = any(f.organization_types)
    and jsonb_path_exists(f.schema, '$.** ? (@.type == "organization")', '{}'::jsonb, true)
    and (
      public.is_public_active_form(f.id)
      or public.request_is_enabled()
    )
  order by
    case o.organization_type
      when 'school' then 1
      when 'kindergarten' then 2
      when 'odo' then 3
      else 4
    end,
    o.number nulls last,
    o.alias;
$$;

create or replace function public.list_missing_form_organizations(p_form_id uuid)
returns table (
  id uuid,
  organization_type text,
  number text,
  alias text,
  email text
)
language sql
stable
security definer
set search_path = ''
as $$
  with target_form as (
    select f.id, f.schema, f.organization_types
    from public.forms f
    where f.id = p_form_id
  ),
  question_names as (
    select distinct question_name.value #>> '{}' as name
    from target_form f
    cross join lateral jsonb_path_query(
      f.schema,
      '$.** ? (@.type == "organization").name',
      '{}'::jsonb,
      true
    ) as question_name(value)
  )
  select o.id, o.organization_type, o.number, o.alias, o.email
  from public.education_organizations o
  join target_form f on o.organization_type = any(f.organization_types)
  where not o.is_archived
    and exists (select 1 from question_names)
    and not exists (
      select 1
      from public.responses r
      cross join question_names q
      where r.form_id = f.id
        and r.data ->> q.name = o.id::text
    )
  order by
    case o.organization_type
      when 'school' then 1
      when 'kindergarten' then 2
      when 'odo' then 3
      else 4
    end,
    o.number nulls last,
    o.alias;
$$;

create or replace function public.validate_response_payload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_form public.forms%rowtype;
  question_name text;
  selected_is_archived boolean;
begin
  select f.* into target_form from public.forms f where f.id = new.form_id;
  if target_form.id is null
    or not public.response_data_matches_form(target_form.schema, target_form.organization_types, new.data)
  then
    raise exception 'Ответ не соответствует структуре формы' using errcode = '22023';
  end if;
  -- Lock selected organizations against concurrent archiving until the response commits.
  for question_name in
    select distinct element ->> 'name'
    from jsonb_path_query(target_form.schema, '$.** ? (@.type() == "object")', '{}'::jsonb, true) element
    where element ->> 'type' = 'organization'
      and jsonb_typeof(element -> 'name') = 'string'
    order by 1
  loop
    if new.data ? question_name then
      select o.is_archived into selected_is_archived
      from public.education_organizations o
      where o.id = (new.data ->> question_name)::uuid
      for share;
      if not found then
        raise exception 'Организация не найдена' using errcode = '22023';
      end if;
      if selected_is_archived then
        if tg_op = 'INSERT' then
          raise exception 'Организация удалена из действующего справочника' using errcode = '22023';
        elsif new.form_id is distinct from old.form_id
          or (new.data -> question_name) is distinct from (old.data -> question_name)
        then
          raise exception 'Архивную организацию можно сохранить только в прежнем ответе' using errcode = '22023';
        end if;
      end if;
    end if;
  end loop;
  return new;
end;
$$;

create or replace function public.list_saved_form_organizations(p_form_id uuid, p_browser_id uuid)
returns table (
  id uuid,
  organization_type text,
  number text,
  alias text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.organization_type, o.number, o.alias
  from public.education_organizations o
  where o.is_archived
    and (auth.uid() is null or public.request_is_enabled())
    and exists (
      select 1
      from public.responses r
      join public.forms f on f.id = r.form_id
      cross join lateral jsonb_path_query(
        f.schema, '$.** ? (@.type == "organization").name', '{}'::jsonb, true
      ) q(value)
      where r.form_id = p_form_id
        and r.data ->> (q.value #>> '{}') = o.id::text
        and (
          public.request_is_enabled()
          or r.browser_id = public.browser_capability_hash(p_browser_id)
        )
    )
  order by o.id;
$$;

revoke all on function public.list_saved_form_organizations(uuid, uuid) from public;
grant execute on function public.list_saved_form_organizations(uuid, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
