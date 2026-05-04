-- Baseline schema for a new/empty Supabase project.
-- Production changes must be applied as reviewed migrations, not by resetting
-- existing tables from this file.
begin;

-- =========================
-- EXTENSIONS
-- =========================
create schema if not exists extensions;
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm" with schema extensions;
alter extension "pg_trgm" set schema extensions;

-- =========================
-- TABLES
-- =========================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null,
  role text not null default 'user' check (role in ('admin', 'user')),
  is_disabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.forms (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  form_type text not null,
  form_reason text not null,
  schema jsonb not null,
  is_public boolean not null default true,
  deadline_at timestamptz,
  max_responses integer,
  responses_count integer not null default 0,
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null default '',
  created_at timestamptz not null default now()
);

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

-- =========================
-- VALIDATION
-- =========================

alter table public.forms
add constraint forms_schema_is_object check (jsonb_typeof(schema) = 'object');

alter table public.forms
add constraint forms_max_responses_positive check (max_responses is null or max_responses > 0);

alter table public.forms
add constraint forms_responses_count_nonnegative check (responses_count >= 0);

alter table public.responses
add constraint responses_data_is_object check (jsonb_typeof(data) = 'object');

-- =========================
-- TRIGGER (profiles)
-- =========================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    'user'
  )
  on conflict (id) do update
    set name = excluded.name,
        email = excluded.email;

  return new;
end;
$$;

create or replace function public.request_role()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile_role text;
begin
  select p.role
  into profile_role
  from public.profiles p
  where p.id = auth.uid();

  return coalesce(profile_role, 'user');
end;
$$;

create or replace trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.set_form_author_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select coalesce(nullif(btrim(p.name), ''), split_part(p.email, '@', 1), new.author_id::text)
  into new.author_name
  from public.profiles p
  where p.id = new.author_id;

  if new.author_name is null then
    raise exception 'Профиль автора формы не найден' using errcode = '23503';
  end if;

  return new;
end;
$$;

create or replace trigger forms_set_author_name
before insert or update of author_id on public.forms
for each row execute procedure public.set_form_author_name();

create or replace function public.sync_profile_name_to_forms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.forms f
  set author_name = coalesce(nullif(btrim(new.name), ''), split_part(new.email, '@', 1), new.id::text)
  where f.author_id = new.id;

  return new;
end;
$$;

create or replace trigger profiles_sync_name_to_forms
after update of name, email on public.profiles
for each row execute procedure public.sync_profile_name_to_forms();

create or replace function public.enforce_form_response_limit_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.max_responses is not null and new.max_responses < new.responses_count then
    raise exception 'Лимит ответов не может быть меньше количества уже полученных ответов' using errcode = '23514';
  end if;

  if new.max_responses is not null and new.responses_count >= new.max_responses then
    if tg_op = 'UPDATE' then
      if old.is_public = false and new.is_public = true then
        raise exception 'Сначала уберите или повысьте лимит ответов' using errcode = '23514';
      end if;
    end if;

    new.is_public := false;
  end if;

  return new;
end;
$$;

create or replace trigger forms_enforce_response_limit_settings
before insert or update of max_responses, is_public on public.forms
for each row execute procedure public.enforce_form_response_limit_settings();

create or replace function public.ensure_form_response_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  form_exists boolean;
begin
  update public.forms f
  set responses_count = f.responses_count + 1,
      is_public = case
        when f.max_responses is not null and f.responses_count + 1 >= f.max_responses then false
        else f.is_public
      end
  where f.id = new.form_id
    and (
      f.max_responses is null
      or f.responses_count < f.max_responses
    );

  if found then
    return new;
  end if;

  select exists (
    select 1
    from public.forms f
    where f.id = new.form_id
  )
  into form_exists;

  if not form_exists then
    return new;
  end if;

  raise exception 'Достигнут лимит ответов для формы' using errcode = '23514';

  return new;
end;
$$;

create or replace trigger responses_form_limit
before insert on public.responses
for each row execute procedure public.ensure_form_response_limit();

create or replace function public.decrement_form_response_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.forms f
  set responses_count = greatest(f.responses_count - 1, 0)
  where f.id = old.form_id;

  return old;
end;
$$;

create or replace trigger responses_form_count_decrement
after delete on public.responses
for each row execute procedure public.decrement_form_response_count();

create or replace function public.set_response_user_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.user_id := auth.uid();
  return new;
end;
$$;

create or replace trigger responses_set_user_id
before insert on public.responses
for each row execute procedure public.set_response_user_id();

create or replace function public.is_public_active_admin_authored_form(target_form_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.forms f
    join public.profiles p on p.id = f.author_id
    where f.id = target_form_id
      and f.is_public = true
      and (f.deadline_at is null or f.deadline_at > now())
      and p.role = 'admin'
  );
$$;

revoke all on function public.is_public_active_admin_authored_form(uuid) from public;
grant execute on function public.is_public_active_admin_authored_form(uuid) to authenticated, service_role;

create or replace function public.get_dashboard_forms_stats(
  p_search text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_author_id uuid default null,
  p_form_type text default null,
  p_form_reason text default null,
  p_is_public boolean default null
)
returns table (
  total_count bigint,
  active_count bigint,
  forms_with_deadline_count bigint
)
language sql
stable
set search_path = ''
as $$
  select
    count(*)::bigint as total_count,
    count(*) filter (where f.is_public = true)::bigint as active_count,
    count(*) filter (where f.deadline_at is not null)::bigint as forms_with_deadline_count
  from public.forms f
  where f.form_type <> 'template'
    and (
      p_search is null
      or p_search = ''
      or f.title ilike '%' || p_search || '%'
      or f.author_name ilike '%' || p_search || '%'
    )
    and (p_date_from is null or f.created_at >= p_date_from)
    and (p_date_to is null or f.created_at <= p_date_to)
    and (p_author_id is null or f.author_id = p_author_id)
    and (p_form_type is null or f.form_type = p_form_type)
    and (p_form_reason is null or f.form_reason = p_form_reason)
    and (p_is_public is null or f.is_public = p_is_public);
$$;

revoke all on function public.get_dashboard_forms_stats(text, timestamptz, timestamptz, uuid, text, text, boolean) from public;
grant execute on function public.get_dashboard_forms_stats(text, timestamptz, timestamptz, uuid, text, text, boolean) to authenticated, service_role;

-- =========================
-- ENABLE RLS
-- =========================

alter table public.profiles enable row level security;
alter table public.forms enable row level security;
alter table public.responses enable row level security;

-- =========================
-- API PRIVILEGES
-- =========================

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

grant select on table public.profiles to authenticated;
grant select on table public.forms to anon;
grant select, insert on table public.forms to authenticated;
revoke delete on table public.forms from authenticated;
revoke update on table public.forms from authenticated;
grant update (title, schema, form_type, form_reason, is_public, deadline_at, max_responses) on table public.forms to authenticated;
grant insert on table public.responses to anon;
grant select, insert on table public.responses to authenticated;
grant select, insert, update, delete on table public.profiles, public.forms, public.responses to service_role;

-- =========================
-- PROFILES (БЕЗ RECURSION)
-- =========================

create policy "profiles_select"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  OR (select public.request_role()) = 'admin'
);

create policy "profiles_update_own_or_admin"
on public.profiles
for update
to authenticated
using (
  id = (select auth.uid())
  or (select public.request_role()) = 'admin'
)
with check (
  id = (select auth.uid())
  or
  (select public.request_role()) = 'admin'
);

revoke update on table public.profiles from authenticated;
grant update (name) on table public.profiles to authenticated;

-- =========================
-- FORMS
-- =========================

create policy "forms_select"
on public.forms
for select
to authenticated
using (true);

create policy "forms_select_anon"
on public.forms
for select
to anon
using (
  is_public = true
  and (deadline_at is null or deadline_at > now())
);

create policy "forms_insert"
on public.forms
for insert
to authenticated
with check (author_id = (select auth.uid()));

create policy "forms_update"
on public.forms
for update
to authenticated
using (
  author_id = (select auth.uid())
  OR (select public.request_role()) = 'admin'
)
with check (
  author_id = (select auth.uid())
  OR (select public.request_role()) = 'admin'
);

-- =========================
-- RESPONSES
-- =========================

create policy "responses_select_author_or_admin"
on public.responses
for select
to authenticated
using (
  (select public.request_role()) = 'admin'
  OR exists (
    select 1
    from public.forms f
    where f.id = form_id
      and f.author_id = (select auth.uid())
  )
  OR public.is_public_active_admin_authored_form(form_id)
);

create policy "responses_insert"
on public.responses
for insert
to authenticated, anon
with check (
  (
    user_id is null
    or user_id = (select auth.uid())
  )
  and exists (
    select 1
    from public.forms f
    where f.id = form_id
      and f.is_public = true
      and (f.deadline_at is null or f.deadline_at > now())
  )
);

-- =========================
-- INDEXES
-- =========================

create index idx_forms_author_id on public.forms(author_id);
create index idx_forms_created_at_id on public.forms(created_at desc, id desc);
create index idx_forms_author_created_at_id on public.forms(author_id, created_at desc, id desc);
create index idx_responses_form_id on public.responses(form_id);
create index idx_responses_form_created_at_id on public.responses(form_id, created_at desc, id desc);
create index idx_forms_title_trgm on public.forms using gin (title extensions.gin_trgm_ops);
create index idx_forms_author_name_trgm on public.forms using gin (author_name extensions.gin_trgm_ops);

alter publication supabase_realtime add table public.forms;
alter publication supabase_realtime add table public.responses;

commit;
