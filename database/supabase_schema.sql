create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null,
  role text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists name text not null default '';

create table if not exists public.forms (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  form_type text not null,
  form_reason text not null,
  schema jsonb not null,
  is_public boolean not null default true,
  author_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.responses (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  user_id uuid null references public.profiles(id) on delete set null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.forms
  drop constraint if exists forms_schema_is_object,
  add constraint forms_schema_is_object check (jsonb_typeof(schema) = 'object');

alter table public.responses
  drop constraint if exists responses_data_is_object,
  add constraint responses_data_is_object check (jsonb_typeof(data) = 'object');

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1), ''),
    coalesce(new.email, '')
  )
  on conflict (id) do update
    set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.forms enable row level security;
alter table public.responses enable row level security;

drop policy if exists "profiles_select_self" on public.profiles;
drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin" on public.profiles
for select to authenticated
using (
  auth.uid() = id
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "profiles_insert_admin" on public.profiles;
create policy "profiles_insert_admin" on public.profiles
for insert to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
for insert to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_update_self" on public.profiles;
drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin" on public.profiles
for update to authenticated
using (
  auth.uid() = id
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
)
with check (
  auth.uid() = id
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "forms_select_all" on public.forms;
drop policy if exists "forms_select_public_or_author_or_admin" on public.forms;
create policy "forms_select_public_or_author_or_admin" on public.forms
for select to authenticated
using (
  is_public = true
  or author_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "forms_select_public_anon" on public.forms;
create policy "forms_select_public_anon" on public.forms
for select to anon
using (is_public = true);

drop policy if exists "forms_insert_authenticated" on public.forms;
create policy "forms_insert_authenticated" on public.forms
for insert to authenticated
with check (auth.uid() = author_id);

drop policy if exists "forms_update_author_or_admin" on public.forms;
create policy "forms_update_author_or_admin" on public.forms
for update to authenticated
using (
  author_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
)
with check (
  author_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "responses_select_author_or_admin" on public.responses;
create policy "responses_select_author_or_admin" on public.responses
for select to authenticated
using (
  exists (
    select 1
    from public.forms f
    where f.id = responses.form_id and f.author_id = auth.uid()
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "responses_insert_any" on public.responses;
create policy "responses_insert_any" on public.responses
for insert to authenticated, anon
with check (
  exists (
    select 1
    from public.forms f
    where f.id = responses.form_id and f.is_public = true
  )
  or auth.role() = 'authenticated'
);

create index if not exists idx_forms_author_id on public.forms(author_id);
create index if not exists idx_responses_form_id on public.responses(form_id);
