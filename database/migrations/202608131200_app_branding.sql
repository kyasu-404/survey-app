begin;

-- Run this migration as one complete script, from BEGIN through COMMIT.
-- A fragment starting with END; / $$; is only the tail of a function and is not valid SQL by itself.

create table if not exists public.app_branding (
  id smallint primary key default 1 check (id = 1),
  sidebar_logo_path text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint app_branding_sidebar_logo_path check (
    sidebar_logo_path is null
    or sidebar_logo_path ~* '^app-branding/sidebar-logo-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
  )
);

insert into public.app_branding (id, sidebar_logo_path)
values (1, null)
on conflict (id) do nothing;

alter table public.app_branding enable row level security;

revoke all on table public.app_branding from anon, authenticated;
grant select on table public.app_branding to authenticated;
grant select, insert, update, delete on table public.app_branding to service_role;

create or replace function public.set_sidebar_logo_path(p_sidebar_logo_path text)
returns table (
  sidebar_logo_path text,
  previous_sidebar_logo_path text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_logo_path text;
begin
  if not public.request_is_enabled() or public.request_role() <> 'admin' then
    raise exception 'Only enabled administrators can change application branding'
      using errcode = '42501';
  end if;

  if p_sidebar_logo_path is not null and btrim(p_sidebar_logo_path) !~*
    '^app-branding/sidebar-logo-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
  then
    raise exception 'Invalid sidebar logo path' using errcode = '22023';
  end if;

  select branding.sidebar_logo_path
  into old_logo_path
  from public.app_branding branding
  where branding.id = 1
  for update;

  insert into public.app_branding (id, sidebar_logo_path, updated_by, updated_at)
  values (1, nullif(btrim(p_sidebar_logo_path), ''), auth.uid(), now())
  on conflict (id) do update
  set sidebar_logo_path = excluded.sidebar_logo_path,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;

  return query
  select branding.sidebar_logo_path, old_logo_path, branding.updated_at
  from public.app_branding branding
  where branding.id = 1;
end;
$$;

revoke all on function public.set_sidebar_logo_path(text) from public;
grant execute on function public.set_sidebar_logo_path(text) to authenticated, service_role;

drop policy if exists "app_branding_select" on public.app_branding;
create policy "app_branding_select"
on public.app_branding
for select
to authenticated
using ((select public.request_is_enabled()));

create or replace function public.can_manage_app_branding_asset(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.request_is_enabled()
    and public.request_role() = 'admin'
    and object_name ~* '^app-branding/sidebar-logo-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$';
$$;

revoke all on function public.can_manage_app_branding_asset(text) from public;
grant execute on function public.can_manage_app_branding_asset(text) to authenticated, service_role;

drop policy if exists "survey_assets_branding_read" on storage.objects;
drop policy if exists "survey_assets_branding_upload" on storage.objects;
drop policy if exists "survey_assets_branding_delete" on storage.objects;

create policy "survey_assets_branding_read" on storage.objects
for select to authenticated
using (bucket_id = 'survey-assets' and name like 'app-branding/%');

create policy "survey_assets_branding_upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'survey-assets'
  and public.can_manage_app_branding_asset(name)
  and case
    when coalesce(metadata ->> 'size', '') ~ '^[0-9]{1,20}$'
      then (metadata ->> 'size')::numeric between 1 and 2097152
    else false
  end
);

create policy "survey_assets_branding_delete" on storage.objects
for delete to authenticated
using (bucket_id = 'survey-assets' and public.can_manage_app_branding_asset(name));

create or replace function public.list_orphan_survey_assets(
  cutoff timestamptz default (now() - interval '168 hours'),
  batch_limit integer default 500
)
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'survey-assets'
    and o.created_at < cutoff
    and (
      (
        o.name ~* '^forms/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
        and not exists (
          select 1 from public.forms f
          where f.id::text = split_part(o.name, '/', 2)
        )
      )
      or (
        o.name ~* '^app-branding/sidebar-logo-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
        and not exists (
          select 1 from public.app_branding branding
          where branding.sidebar_logo_path = o.name
        )
      )
    )
  order by o.created_at, o.id
  limit least(greatest(batch_limit, 1), 1000);
$$;

create or replace function public.confirm_orphan_survey_assets(
  cutoff timestamptz,
  object_names text[]
)
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where cardinality(object_names) between 1 and 500
    and o.bucket_id = 'survey-assets'
    and o.name = any(object_names)
    and o.created_at < cutoff
    and (
      (
        o.name ~* '^forms/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
        and not exists (
          select 1 from public.forms f
          where f.id::text = split_part(o.name, '/', 2)
        )
      )
      or (
        o.name ~* '^app-branding/sidebar-logo-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
        and not exists (
          select 1 from public.app_branding branding
          where branding.sidebar_logo_path = o.name
        )
      )
    )
  order by o.name;
$$;

revoke all on function public.list_orphan_survey_assets(timestamptz, integer) from public;
revoke all on function public.confirm_orphan_survey_assets(timestamptz, text[]) from public;
grant execute on function public.list_orphan_survey_assets(timestamptz, integer) to service_role;
grant execute on function public.confirm_orphan_survey_assets(timestamptz, text[]) to service_role;

notify pgrst, 'reload schema';

commit;
