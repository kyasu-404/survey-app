-- =========================
-- EXTENSIONS
-- =========================
create extension if not exists "pgcrypto";

-- =========================
-- CLEAN
-- =========================
drop table if exists public.responses cascade;
drop table if exists public.forms cascade;
drop table if exists public.profiles cascade;

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
  author_id uuid not null references public.profiles(id) on delete cascade,
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

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.ensure_form_response_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_limit integer;
  current_count integer;
begin
  select f.max_responses
  into current_limit
  from public.forms f
  where f.id = new.form_id
  for update;

  if current_limit is null then
    return new;
  end if;

  select count(*)
  into current_count
  from public.responses r
  where r.form_id = new.form_id;

  if current_count >= current_limit then
    raise exception 'Достигнут лимит ответов для формы' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists responses_form_limit on public.responses;

create trigger responses_form_limit
before insert on public.responses
for each row execute procedure public.ensure_form_response_limit();

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

drop trigger if exists responses_set_user_id on public.responses;

create trigger responses_set_user_id
before insert on public.responses
for each row execute procedure public.set_response_user_id();

-- =========================
-- ENABLE RLS
-- =========================

alter table public.profiles enable row level security;
alter table public.forms enable row level security;
alter table public.responses enable row level security;

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

create policy "profiles_update_self"
on public.profiles
for update
to authenticated
using (
  id = (select auth.uid())
)
with check (
  id = (select auth.uid())
);

create policy "profiles_update_admin"
on public.profiles
for update
to authenticated
using (
  (select public.request_role()) = 'admin'
)
with check (
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
using (
  (
    is_public = true
    and (deadline_at is null or deadline_at > now())
  )
  OR author_id = (select auth.uid())
  OR (select public.request_role()) = 'admin'
);

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

create policy "forms_delete"
on public.forms
for delete
to authenticated
using (
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
create index idx_responses_form_id on public.responses(form_id);
