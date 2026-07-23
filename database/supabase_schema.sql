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
  theme jsonb not null default '{}'::jsonb,
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
  submission_id uuid not null default gen_random_uuid(),
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table public.response_file_references (
  response_id uuid not null references public.responses(id) on delete cascade,
  form_id uuid not null references public.forms(id) on delete cascade,
  object_path text not null check (length(object_path) between 3 and 1024),
  primary key (response_id, object_path)
);

-- =========================
-- VALIDATION
-- =========================

alter table public.forms
add constraint forms_schema_is_object check (jsonb_typeof(schema) = 'object');

alter table public.forms
add constraint forms_schema_size check (pg_column_size(schema) <= 262144);

alter table public.forms
add constraint forms_schema_no_active_urls check (
  not jsonb_path_exists(schema, '$.**.navigateToUrl')
  and not jsonb_path_exists(schema, '$.**.navigateToUrlOnCondition')
  and not jsonb_path_exists(schema, '$.**.choicesByUrl')
);

create or replace function public.survey_schema_has_unsafe_network_assets(value jsonb)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from (
      select jsonb_path_query(value, '$.**.logo', '{}'::jsonb, true) as asset
      union all select jsonb_path_query(value, '$.**.backgroundImage', '{}'::jsonb, true)
      union all select jsonb_path_query(value, '$.**.imageLink', '{}'::jsonb, true)
      union all select jsonb_path_query(value, '$.**.imageUrl', '{}'::jsonb, true)
      union all select jsonb_path_query(value, '$.**.videoLink', '{}'::jsonb, true)
      union all select jsonb_path_query(value, '$.**.source', '{}'::jsonb, true)
      union all select jsonb_path_query(value, '$.**.poster', '{}'::jsonb, true)
    ) assets
    where jsonb_typeof(asset) <> 'string'
      or not (
        btrim(asset #>> '{}') = '__APP_DEFAULT_CARD_LOGO__'
        or btrim(asset #>> '{}') ~* '^data:image/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$'
        or btrim(asset #>> '{}') !~* '^([a-z][a-z0-9+.-]*:|//|\\)'
      )
  ) or jsonb_path_exists(value, '$.**.contentMode ? (@ != "image")', '{}'::jsonb, true);
$$;

revoke all on function public.survey_schema_has_unsafe_network_assets(jsonb) from public;
grant execute on function public.survey_schema_has_unsafe_network_assets(jsonb) to authenticated, service_role;

alter table public.forms
add constraint forms_schema_no_unsafe_network_assets check (
  not public.survey_schema_has_unsafe_network_assets(schema)
);

create or replace function public.survey_theme_is_safe(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'object'
    and pg_column_size(value) <= 131072
    and (
      not (value ? 'cssVariables')
      or (
        jsonb_typeof(value -> 'cssVariables') = 'object'
        and not exists (
          select 1
          from jsonb_each_text(
            case when jsonb_typeof(value -> 'cssVariables') = 'object'
              then value -> 'cssVariables'
              else '{}'::jsonb
            end
          ) css(name, setting)
          where name !~ '^--[a-zA-Z0-9_-]{1,120}$'
            or length(setting) > 512
            or setting ~ '[[:cntrl:]]'
            or setting ~* '(url[[:space:]]*\(|expression[[:space:]]*\(|@import|javascript:)'
        )
      )
    )
    and not exists (
      select 1
      from (
        select value -> 'backgroundImage' as asset where value ? 'backgroundImage'
        union all
        select value -> 'header' -> 'backgroundImage' as asset
        where jsonb_typeof(value -> 'header') = 'object' and (value -> 'header') ? 'backgroundImage'
      ) assets
      where jsonb_typeof(asset) <> 'string'
        or not (
          btrim(asset #>> '{}') = ''
          or btrim(asset #>> '{}') ~ '^/[^/\\]'
          or btrim(asset #>> '{}') ~* '^https://[^[:space:]]+$'
          or btrim(asset #>> '{}') ~* '^http://(localhost|127\.0\.0\.1|10\.[0-9.]+|192\.168\.[0-9.]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9.]+|\[::1\])(:[0-9]+)?/[^[:space:]]*$'
        )
    );
$$;

revoke all on function public.survey_theme_is_safe(jsonb) from public;
grant execute on function public.survey_theme_is_safe(jsonb) to authenticated, service_role;

alter table public.forms
add constraint forms_theme_is_safe check (public.survey_theme_is_safe(theme));

alter table public.forms
add constraint forms_max_responses_positive check (max_responses is null or max_responses > 0);

alter table public.forms
add constraint forms_max_responses_hard_cap check (max_responses is null or max_responses <= 100000);

alter table public.forms
add constraint forms_responses_count_nonnegative check (responses_count >= 0);

alter table public.responses
add constraint responses_data_is_object check (jsonb_typeof(data) = 'object');

alter table public.responses
add constraint responses_data_size check (pg_column_size(data) <= 262144);

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

create or replace function public.request_is_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_disabled = false
  );
$$;

revoke all on function public.request_is_enabled() from public;
grant execute on function public.request_is_enabled() to authenticated, service_role;

create or replace function public.request_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid() and p.is_disabled = false;
$$;

revoke all on function public.request_role() from public;
grant execute on function public.request_role() to authenticated, service_role;

create or replace function public.is_existing_response_submission(
  target_form_id uuid,
  target_submission_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.responses r
    where r.form_id = target_form_id
      and r.submission_id = target_submission_id
      and r.user_id is not distinct from target_user_id
  );
$$;

revoke all on function public.is_existing_response_submission(uuid, uuid, uuid) from public;
grant execute on function public.is_existing_response_submission(uuid, uuid, uuid) to anon, authenticated, service_role;

create or replace function public.is_public_active_form(target_form_id uuid)
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
      and p.is_disabled = false
  );
$$;

revoke all on function public.is_public_active_form(uuid) from public;
grant execute on function public.is_public_active_form(uuid) to anon, authenticated, service_role;

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
declare
  effective_limit integer := least(coalesce(new.max_responses, 100000), 100000);
begin
  if new.max_responses is not null and new.max_responses < new.responses_count then
    raise exception 'Лимит ответов не может быть меньше количества уже полученных ответов' using errcode = '23514';
  end if;

  if new.responses_count >= effective_limit then
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
begin
  if exists (
    select 1 from public.responses r
    where r.form_id = new.form_id and r.submission_id = new.submission_id
  ) then
    return new;
  end if;

  update public.forms f
  set responses_count = f.responses_count + 1
  where f.id = new.form_id
    and f.responses_count < least(coalesce(f.max_responses, 100000), 100000);

  if found then
    return new;
  end if;

  if exists (select 1 from public.forms f where f.id = new.form_id) then
    raise exception 'Достигнут лимит ответов для формы' using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace trigger responses_form_limit
before insert on public.responses
for each row execute procedure public.ensure_form_response_limit();

create or replace function public.increment_form_response_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.forms f
  set is_public = false
  where f.id = new.form_id
    and f.responses_count >= least(coalesce(f.max_responses, 100000), 100000);

  return new;
end;
$$;

create or replace trigger responses_form_count_increment
after insert on public.responses
for each row execute procedure public.increment_form_response_count();

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

create or replace function public.sync_response_file_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_path text;
begin
  if tg_op = 'UPDATE' then
    delete from public.response_file_references where response_id = new.id;
  end if;

  for candidate_path in
    select distinct scalar #>> '{}'
    from jsonb_path_query(new.data, '$.** ? (@.type() == "string")', '{}'::jsonb, true) scalar
  loop
    if length(candidate_path) <= 1024
      and split_part(candidate_path, '/', 2) = new.form_id::text
      and candidate_path ~* '^(public|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
    then
      insert into public.response_file_references (response_id, form_id, object_path)
      values (new.id, new.form_id, candidate_path)
      on conflict do nothing;
    end if;
  end loop;

  return new;
end;
$$;

create trigger responses_sync_file_references
after insert or update of data, form_id on public.responses
for each row execute procedure public.sync_response_file_references();

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
      and p.is_disabled = false
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
grant select on table public.forms to authenticated;
grant insert (id, title, schema, theme, form_type, form_reason, is_public, deadline_at, max_responses, author_id)
  on table public.forms to authenticated;
revoke delete on table public.forms from authenticated;
revoke update on table public.forms from authenticated;
grant update (title, schema, theme, form_type, form_reason, is_public, deadline_at, max_responses) on table public.forms to authenticated;
grant insert (form_id, submission_id, data) on table public.responses to anon;
grant select on table public.responses to authenticated;
grant insert (form_id, submission_id, data) on table public.responses to authenticated;
grant select, insert, update, delete on table public.profiles, public.forms, public.responses to service_role;
revoke all on table public.response_file_references from anon, authenticated;
grant select, insert, update, delete on table public.response_file_references to service_role;

-- =========================
-- PROFILES (БЕЗ RECURSION)
-- =========================

create policy "profiles_select"
on public.profiles
for select
to authenticated
using (
  (select public.request_is_enabled())
  and (id = (select auth.uid()) OR (select public.request_role()) = 'admin')
);

create policy "profiles_update_own_or_admin"
on public.profiles
for update
to authenticated
using (
  (select public.request_is_enabled())
  and (id = (select auth.uid()) or (select public.request_role()) = 'admin')
)
with check (
  (select public.request_is_enabled())
  and (id = (select auth.uid()) or (select public.request_role()) = 'admin')
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
  (select public.request_is_enabled())
  and (
    author_id = (select auth.uid())
    or (select public.request_role()) = 'admin'
    or public.is_public_active_form(id)
  )
);

create policy "forms_select_anon"
on public.forms
for select
to anon
using (
  public.is_public_active_form(id)
);

create policy "forms_insert"
on public.forms
for insert
to authenticated
with check ((select public.request_is_enabled()) and author_id = (select auth.uid()));

create policy "forms_update"
on public.forms
for update
to authenticated
using (
  (select public.request_is_enabled())
  and (author_id = (select auth.uid()) OR (select public.request_role()) = 'admin')
)
with check (
  (select public.request_is_enabled())
  and (author_id = (select auth.uid()) OR (select public.request_role()) = 'admin')
);

-- =========================
-- RESPONSES
-- =========================

create policy "responses_select_author_or_admin"
on public.responses
for select
to authenticated
using (
  (select public.request_is_enabled())
  and (
    (select public.request_role()) = 'admin'
    OR exists (
      select 1
      from public.forms f
      where f.id = form_id
        and f.author_id = (select auth.uid())
    )
    OR public.is_public_active_admin_authored_form(form_id)
  )
);

create policy "responses_insert"
on public.responses
for insert
to authenticated, anon
with check (
  ((select auth.uid()) is null or (select public.request_is_enabled()))
  and (
    user_id is null
    or user_id = (select auth.uid())
  )
  and (
    public.is_public_active_form(form_id)
    or public.is_existing_response_submission(form_id, submission_id, (select auth.uid()))
  )
);

-- =========================
-- PRIVATE SURVEY FILES
-- =========================

create or replace function public.can_upload_survey_file(
  object_name text,
  anonymous_request boolean,
  object_size bigint
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  path_parts text[] := string_to_array(object_name, '/');
  target_form_id uuid;
  existing_count bigint;
  existing_bytes bigint;
begin
  if array_length(path_parts, 1) <> 3
    or length(path_parts[3]) > 512
    or object_size < 0
    or object_size > 10485760
  then
    return false;
  end if;

  if anonymous_request then
    if auth.uid() is not null or path_parts[1] <> 'public' then return false; end if;
  else
    if not public.request_is_enabled() or path_parts[1] <> auth.uid()::text then return false; end if;
  end if;

  begin
    target_form_id := path_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if not exists (
    select 1 from public.forms f
    where f.id = target_form_id
      and (
        public.is_public_active_form(f.id)
        or (not anonymous_request and (f.author_id = auth.uid() or public.request_role() = 'admin'))
      )
  ) then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('survey-files/' || target_form_id::text, 0));

  select count(*), coalesce(sum(
    case
      when coalesce(o.metadata ->> 'size', '') ~ '^[0-9]{1,20}$'
        then least((o.metadata ->> 'size')::numeric, 10485760)::bigint
      else 10485760
    end
  ), 0)
  into existing_count, existing_bytes
  from storage.objects o
  where o.bucket_id = 'survey-files'
    and split_part(o.name, '/', 2) = target_form_id::text;

  return existing_count < 2000
    and existing_bytes + object_size <= 2147483648;
end;
$$;

create or replace function public.can_read_survey_file(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  path_parts text[] := string_to_array(object_name, '/');
  target_form_id uuid;
begin
  if not public.request_is_enabled() or array_length(path_parts, 1) <> 3 then return false; end if;
  if path_parts[1] = auth.uid()::text then return true; end if;

  begin
    target_form_id := path_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return exists (
    select 1 from public.forms f
    where f.id = target_form_id
      and (
        f.author_id = auth.uid()
        or public.request_role() = 'admin'
        or (
          public.is_public_active_admin_authored_form(f.id)
          and exists (
            select 1 from public.response_file_references rf
            where rf.form_id = f.id and rf.object_path = object_name
          )
        )
      )
  );
end;
$$;

create or replace function public.can_delete_survey_file(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  path_parts text[] := string_to_array(object_name, '/');
begin
  if not public.request_is_enabled()
    or array_length(path_parts, 1) <> 3
    or path_parts[1] <> auth.uid()::text
  then
    return false;
  end if;

  return not exists (
    select 1 from public.response_file_references rf
    where rf.object_path = object_name
  );
end;
$$;

create or replace function public.is_survey_file_referenced(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.response_file_references rf
    where rf.object_path = object_name
  );
$$;

revoke all on function public.is_survey_file_referenced(text) from public;
grant execute on function public.is_survey_file_referenced(text) to service_role;

create or replace function public.list_orphan_survey_files(
  cutoff timestamptz default (now() - interval '24 hours'),
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
  where o.bucket_id = 'survey-files'
    and o.name like 'public/%'
    and o.created_at < cutoff
    and not exists (
      select 1 from public.response_file_references rf
      where rf.object_path = o.name
    )
  order by o.created_at, o.id
  limit least(greatest(batch_limit, 1), 1000);
$$;

revoke all on function public.can_upload_survey_file(text, boolean, bigint) from public;
revoke all on function public.can_read_survey_file(text) from public;
revoke all on function public.can_delete_survey_file(text) from public;
revoke all on function public.is_survey_file_referenced(text) from public;
revoke all on function public.list_orphan_survey_files(timestamptz, integer) from public;
grant execute on function public.can_upload_survey_file(text, boolean, bigint) to anon, authenticated, service_role;
grant execute on function public.can_read_survey_file(text) to authenticated, service_role;
grant execute on function public.can_delete_survey_file(text) to authenticated, service_role;
grant execute on function public.is_survey_file_referenced(text) to service_role;
grant execute on function public.list_orphan_survey_files(timestamptz, integer) to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('survey-files', 'survey-files', false, 10485760)
on conflict (id) do update
set public = excluded.public, file_size_limit = excluded.file_size_limit;

create policy "survey_files_authenticated_upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'survey-files'
  and public.can_upload_survey_file(
    name,
    false,
    case when coalesce(metadata ->> 'size', '') ~ '^[0-9]{1,20}$'
      then least((metadata ->> 'size')::numeric, 10485760)::bigint
      else 0
    end
  )
);

create policy "survey_files_public_upload" on storage.objects
for insert to anon
with check (
  bucket_id = 'survey-files'
  and public.can_upload_survey_file(
    name,
    true,
    case when coalesce(metadata ->> 'size', '') ~ '^[0-9]{1,20}$'
      then least((metadata ->> 'size')::numeric, 10485760)::bigint
      else 0
    end
  )
);

create policy "survey_files_authenticated_read" on storage.objects
for select to authenticated
using (bucket_id = 'survey-files' and public.can_read_survey_file(name));

create policy "survey_files_authenticated_delete" on storage.objects
for delete to authenticated
using (bucket_id = 'survey-files' and public.can_delete_survey_file(name));

create or replace function public.can_manage_survey_asset(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  path_parts text[] := string_to_array(object_name, '/');
  target_form_id uuid;
begin
  if not public.request_is_enabled()
    or array_length(path_parts, 1) <> 4
    or path_parts[1] <> 'forms'
    or (path_parts[3] <> auth.uid()::text and public.request_role() <> 'admin')
    or path_parts[4] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
  then
    return false;
  end if;

  begin
    target_form_id := path_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return path_parts[3] = auth.uid()::text
    or public.request_role() = 'admin'
    or exists (
      select 1 from public.forms f
      where f.id = target_form_id and f.author_id = auth.uid()
    );
end;
$$;

revoke all on function public.can_manage_survey_asset(text) from public;
grant execute on function public.can_manage_survey_asset(text) to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'survey-assets',
  'survey-assets',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "survey_assets_authenticated_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'survey-assets'
  and (name like 'gallery/%' or public.can_manage_survey_asset(name))
);

create policy "survey_assets_authenticated_upload" on storage.objects
for insert to authenticated
with check (bucket_id = 'survey-assets' and public.can_manage_survey_asset(name));

create policy "survey_assets_authenticated_delete" on storage.objects
for delete to authenticated
using (bucket_id = 'survey-assets' and public.can_manage_survey_asset(name));

-- =========================
-- INDEXES
-- =========================

create index idx_forms_author_id on public.forms(author_id);
create index idx_forms_created_at_id on public.forms(created_at desc, id desc);
create index idx_forms_author_created_at_id on public.forms(author_id, created_at desc, id desc);
create index idx_responses_form_id on public.responses(form_id);
create index idx_responses_form_created_at_id on public.responses(form_id, created_at desc, id desc);
create unique index idx_responses_form_submission_id on public.responses(form_id, submission_id);
create index idx_response_file_references_object_form on public.response_file_references(object_path, form_id);
create index idx_forms_title_trgm on public.forms using gin (title extensions.gin_trgm_ops);
create index idx_forms_author_name_trgm on public.forms using gin (author_name extensions.gin_trgm_ops);

alter publication supabase_realtime add table public.forms;
alter publication supabase_realtime add table public.responses;

commit;
