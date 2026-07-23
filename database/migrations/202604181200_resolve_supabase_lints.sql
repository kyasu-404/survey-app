begin;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create extension if not exists "pg_trgm" with schema extensions;
alter extension "pg_trgm" set schema extensions;

drop policy if exists "profiles_update_self" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;
drop policy if exists "profiles_update_own_or_admin" on public.profiles;

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
  or (select public.request_role()) = 'admin'
);

commit;
