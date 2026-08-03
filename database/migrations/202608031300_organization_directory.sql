begin;

create table if not exists public.education_organizations (
  id uuid primary key default gen_random_uuid(),
  organization_type text not null check (organization_type in ('school', 'kindergarten', 'odo', 'udod')),
  number text,
  alias text not null,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint education_organizations_alias_length check (length(btrim(alias)) between 1 and 200),
  constraint education_organizations_email_length check (length(btrim(email)) between 3 and 320),
  constraint education_organizations_number_rules check (
    (organization_type = 'udod' and number is null)
    or (
      organization_type <> 'udod'
      and number is not null
      and length(btrim(number)) between 1 and 40
    )
  ),
  unique nulls not distinct (organization_type, number, alias)
);

alter table public.forms
add column if not exists organization_types text[] not null default array['school', 'kindergarten']::text[];

alter table public.forms
drop constraint if exists forms_organization_types_valid;

alter table public.forms
add constraint forms_organization_types_valid check (
  cardinality(organization_types) between 1 and 4
  and organization_types <@ array['school', 'kindergarten', 'odo', 'udod']::text[]
  and array_position(organization_types, null) is null
);

create or replace function public.set_education_organization_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.alias = btrim(new.alias);
  new.email = lower(btrim(new.email));
  new.number = case when new.organization_type = 'udod' then null else btrim(new.number) end;
  return new;
end;
$$;

drop trigger if exists education_organizations_set_updated_at on public.education_organizations;
create trigger education_organizations_set_updated_at
before insert or update on public.education_organizations
for each row execute procedure public.set_education_organization_updated_at();

alter table public.education_organizations enable row level security;

drop policy if exists "education_organizations_select" on public.education_organizations;
create policy "education_organizations_select"
on public.education_organizations
for select
to authenticated
using ((select public.request_is_enabled()));

drop policy if exists "education_organizations_admin_write" on public.education_organizations;
create policy "education_organizations_admin_write"
on public.education_organizations
for all
to authenticated
using (
  (select public.request_is_enabled())
  and (select public.request_role()) = 'admin'
)
with check (
  (select public.request_is_enabled())
  and (select public.request_role()) = 'admin'
);

grant select, insert, update, delete on table public.education_organizations to authenticated;
grant select, insert, update, delete on table public.education_organizations to service_role;

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
  where o.organization_type = any(f.organization_types)
    and jsonb_path_exists(f.schema, '$.** ? (@.type == "organization")', '{}'::jsonb, true)
    and (
      public.is_public_active_form(f.id)
      or (
        auth.uid() is not null
        and public.request_is_enabled()
        and (f.author_id = auth.uid() or public.request_role() = 'admin')
      )
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

revoke all on function public.list_form_organizations(uuid) from public;
grant execute on function public.list_form_organizations(uuid) to anon, authenticated, service_role;

create or replace function public.prevent_answered_form_schema_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.responses_count > 0
    and (
      new.schema is distinct from old.schema
      or new.organization_types is distinct from old.organization_types
    )
  then
    raise exception 'У формы уже есть ответы. Создайте её копию, чтобы не нарушить существующие данные.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists forms_prevent_answered_schema_update on public.forms;
create trigger forms_prevent_answered_schema_update
before update of schema, organization_types on public.forms
for each row execute procedure public.prevent_answered_form_schema_update();

revoke insert on table public.forms from authenticated;
grant insert (
  id, title, schema, theme, form_type, form_reason, is_public, deadline_at,
  max_responses, allow_response_editing, organization_types, author_id
) on table public.forms to authenticated;

revoke update on table public.forms from authenticated;
grant update (
  title, schema, theme, form_type, form_reason, is_public, deadline_at,
  max_responses, allow_response_editing, organization_types
) on table public.forms to authenticated;

commit;
