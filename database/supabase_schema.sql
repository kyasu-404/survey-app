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

create table public.app_branding (
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
values (1, null);

create table public.education_organizations (
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
  allow_response_editing boolean not null default false,
  organization_types text[] not null default array['school', 'kindergarten']::text[],
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null default '',
  revision bigint not null default 0,
  created_at timestamptz not null default now()
);

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  submission_id uuid not null default gen_random_uuid(),
  browser_id uuid,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.response_file_references (
  response_id uuid not null references public.responses(id) on delete cascade,
  form_id uuid not null references public.forms(id) on delete cascade,
  object_path text not null check (length(object_path) between 3 and 1024),
  primary key (response_id, object_path)
);

create table public.storage_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_type text not null check (trigger_type in ('scheduled', 'manual')),
  requested_by uuid references public.profiles(id) on delete set null,
  worker_id text not null,
  retention_hours integer not null default 168 check (retention_hours between 168 and 720),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  removed_files integer not null default 0 check (removed_files >= 0),
  removed_assets integer not null default 0 check (removed_assets >= 0),
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint storage_cleanup_runs_worker_length check (length(btrim(worker_id)) between 1 and 200),
  constraint storage_cleanup_runs_error_length check (error is null or length(error) <= 2000),
  constraint storage_cleanup_runs_finished_state check (
    (status = 'running' and finished_at is null)
    or (status in ('succeeded', 'failed') and finished_at is not null)
  )
);

create table public.mail_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  host text not null,
  port integer not null check (port between 1 and 65535),
  ssl_mode text not null default 'tls' check (ssl_mode in ('tls', 'starttls', 'none')),
  username text not null,
  password_encrypted text not null,
  from_email text not null,
  from_name text not null,
  reply_to text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint mail_settings_host_length check (length(btrim(host)) between 1 and 253),
  constraint mail_settings_username_length check (length(btrim(username)) between 1 and 320),
  constraint mail_settings_password_length check (length(password_encrypted) between 20 and 8192),
  constraint mail_settings_from_email_length check (length(btrim(from_email)) between 3 and 320),
  constraint mail_settings_from_name_length check (length(btrim(from_name)) between 1 and 200),
  constraint mail_settings_reply_to_length check (reply_to is null or length(btrim(reply_to)) between 3 and 320)
);

create table public.mail_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('reminder', 'test')),
  form_id uuid references public.forms(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  total_count integer not null check (total_count between 1 and 5000),
  created_at timestamptz not null default now(),
  constraint mail_batches_form_kind check (
    (kind = 'reminder' and form_id is not null)
    or (kind = 'test' and form_id is null)
  )
);

create table public.mail_queue (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.mail_batches(id) on delete cascade,
  form_id uuid references public.forms(id) on delete cascade,
  organization_id uuid references public.education_organizations(id) on delete set null,
  recipient_email text not null,
  recipient_name text not null,
  subject text not null,
  body_text text not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mail_queue_recipient_email_length check (length(btrim(recipient_email)) between 3 and 320),
  constraint mail_queue_recipient_name_length check (length(btrim(recipient_name)) between 1 and 300),
  constraint mail_queue_subject_length check (length(subject) between 1 and 500),
  constraint mail_queue_body_length check (length(body_text) between 1 and 20000),
  constraint mail_queue_error_length check (last_error is null or length(last_error) <= 1000),
  unique nulls not distinct (batch_id, organization_id, recipient_email)
);

-- =========================
-- VALIDATION
-- =========================

alter table public.forms
add constraint forms_schema_is_object check (jsonb_typeof(schema) = 'object');

alter table public.forms
add constraint forms_title_length check (length(btrim(title)) between 1 and 500);

alter table public.forms
add constraint forms_type_valid check (
  form_type in ('template', 'anketa', 'voting', 'request', 'monitoring', 'survey', 'sample', 'other')
);

alter table public.forms
add constraint forms_reason_valid check (
  form_reason in ('request', 'plan', 'order', 'directive', 'other')
);

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
          or btrim(asset #>> '{}') ~* '^__APP_SURVEY_ASSET__/(gallery/[a-z0-9._-]{1,255}|forms/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpe?g|png|webp))$'
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

alter table public.forms
add constraint forms_organization_types_valid check (
  cardinality(organization_types) between 1 and 4
  and organization_types <@ array['school', 'kindergarten', 'odo', 'udod']::text[]
  and array_position(organization_types, null) is null
);

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

create trigger education_organizations_set_updated_at
before insert or update on public.education_organizations
for each row execute procedure public.set_education_organization_updated_at();

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

create or replace function public.browser_capability_hash(value uuid)
returns uuid
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select md5(value::text)::uuid;
$$;

revoke all on function public.browser_capability_hash(uuid) from public;
grant execute on function public.browser_capability_hash(uuid) to service_role;

create or replace function public.get_form_response_status(
  p_form_id uuid,
  p_browser_id uuid
)
returns table (
  response_id uuid,
  response_data jsonb,
  response_editable boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_form public.forms%rowtype;
  existing_response public.responses%rowtype;
begin
  if auth.uid() is not null and not public.request_is_enabled() then
    raise exception 'Пользователь отключён' using errcode = '42501';
  end if;

  if p_form_id is null or p_browser_id is null then
    raise exception 'Некорректный идентификатор ответа' using errcode = '22023';
  end if;

  select f.*
  into target_form
  from public.forms f
  join public.profiles p on p.id = f.author_id
  where f.id = p_form_id
    and p.is_disabled = false;

  if target_form.id is null then
    return;
  end if;

  select r.*
  into existing_response
  from public.responses r
  where r.form_id = p_form_id
    and r.browser_id = public.browser_capability_hash(p_browser_id);

  if existing_response.id is null then
    return;
  end if;

  return query select
    existing_response.id,
    existing_response.data,
    target_form.allow_response_editing
      and target_form.is_public
      and (target_form.deadline_at is null or target_form.deadline_at > now());
end;
$$;

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
  question jsonb;
  question_name text;
  organization_id uuid;
begin
  if jsonb_typeof(response_data) <> 'object' or pg_column_size(response_data) > 262144 then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_object_keys(response_data) response_key
    where not exists (
      select 1
      from jsonb_path_query(form_schema, '$.** ? (@.type() == "object")', '{}'::jsonb, true) element
      where jsonb_typeof(element -> 'name') = 'string'
        and element ->> 'name' = response_key
    )
  ) then
    return false;
  end if;

  for question in
    select element
    from jsonb_path_query(form_schema, '$.** ? (@.type() == "object")', '{}'::jsonb, true) element
    where element ->> 'type' = 'organization'
      and jsonb_typeof(element -> 'name') = 'string'
  loop
    question_name := question ->> 'name';
    if response_data ? question_name then
      begin
        organization_id := (response_data ->> question_name)::uuid;
      exception when invalid_text_representation then
        return false;
      end;

      if not exists (
        select 1
        from public.education_organizations organization
        where organization.id = organization_id
          and organization.organization_type = any(allowed_organization_types)
      ) then
        return false;
      end if;
    end if;
  end loop;

  return true;
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
begin
  select f.* into target_form from public.forms f where f.id = new.form_id;
  if target_form.id is null
    or not public.response_data_matches_form(target_form.schema, target_form.organization_types, new.data)
  then
    raise exception 'Ответ не соответствует структуре формы' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger responses_validate_payload
before insert or update of form_id, data on public.responses
for each row execute procedure public.validate_response_payload();

revoke all on function public.validate_response_payload() from public;

create or replace function public.submit_form_response(
  p_form_id uuid,
  p_browser_id uuid,
  p_submission_id uuid,
  p_data jsonb
)
returns table (
  status text,
  response_id uuid,
  response_data jsonb,
  response_editable boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_form public.forms%rowtype;
  existing_response public.responses%rowtype;
  inserted_response public.responses%rowtype;
begin
  if auth.uid() is not null and not public.request_is_enabled() then
    raise exception 'Пользователь отключён' using errcode = '42501';
  end if;

  if p_browser_id is null or p_submission_id is null then
    raise exception 'Некорректный идентификатор отправки' using errcode = '22023';
  end if;

  if jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 262144 then
    raise exception 'Некорректные данные ответа' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('survey-response/' || p_form_id::text || '/' || p_browser_id::text, 0)
  );

  select f.*
  into target_form
  from public.forms f
  join public.profiles p on p.id = f.author_id
  where f.id = p_form_id
    and p.is_disabled = false;

  if target_form.id is null then
    raise exception 'Форма не найдена или недоступна' using errcode = 'P0002';
  end if;

  if not public.response_data_matches_form(target_form.schema, target_form.organization_types, p_data) then
    raise exception 'Ответ не соответствует структуре формы' using errcode = '22023';
  end if;

  select r.*
  into existing_response
  from public.responses r
  where r.form_id = p_form_id
    and r.browser_id = public.browser_capability_hash(p_browser_id);

  if existing_response.id is not null then
    return query select
      'already_submitted'::text,
      existing_response.id,
      existing_response.data,
      target_form.allow_response_editing
        and target_form.is_public
        and (target_form.deadline_at is null or target_form.deadline_at > now());
    return;
  end if;

  if not target_form.is_public
    or (target_form.deadline_at is not null and target_form.deadline_at <= now())
  then
    raise exception 'Форма закрыта для ответов' using errcode = '42501';
  end if;

  insert into public.responses (form_id, browser_id, submission_id, data)
  values (p_form_id, public.browser_capability_hash(p_browser_id), p_submission_id, p_data)
  returning * into inserted_response;

  return query select
    'submitted'::text,
    inserted_response.id,
    inserted_response.data,
    target_form.allow_response_editing
      and target_form.is_public
      and (target_form.deadline_at is null or target_form.deadline_at > now());
end;
$$;

create or replace function public.update_form_response(
  p_form_id uuid,
  p_browser_id uuid,
  p_response_id uuid,
  p_data jsonb
)
returns table (
  response_id uuid,
  response_data jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_form public.forms%rowtype;
  updated_response public.responses%rowtype;
begin
  if auth.uid() is not null and not public.request_is_enabled() then
    raise exception 'Пользователь отключён' using errcode = '42501';
  end if;

  if p_browser_id is null or p_response_id is null then
    raise exception 'Некорректный идентификатор ответа' using errcode = '22023';
  end if;

  if jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 262144 then
    raise exception 'Некорректные данные ответа' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('survey-response/' || p_form_id::text || '/' || p_browser_id::text, 0)
  );

  select f.*
  into target_form
  from public.forms f
  join public.profiles p on p.id = f.author_id
  where f.id = p_form_id
    and p.is_disabled = false;

  if target_form.id is null then
    raise exception 'Форма не найдена или недоступна' using errcode = 'P0002';
  end if;

  if not public.response_data_matches_form(target_form.schema, target_form.organization_types, p_data) then
    raise exception 'Ответ не соответствует структуре формы' using errcode = '22023';
  end if;

  if not target_form.allow_response_editing then
    raise exception 'Редактирование ответов отключено' using errcode = '42501';
  end if;

  if not target_form.is_public
    or (target_form.deadline_at is not null and target_form.deadline_at <= now())
  then
    raise exception 'Форма закрыта для редактирования ответов' using errcode = '42501';
  end if;

  update public.responses r
  set data = p_data,
      updated_at = now()
  where r.id = p_response_id
    and r.form_id = p_form_id
    and r.browser_id = public.browser_capability_hash(p_browser_id)
  returning r.* into updated_response;

  if updated_response.id is null then
    raise exception 'Ответ не найден' using errcode = 'P0002';
  end if;

  return query select updated_response.id, updated_response.data;
end;
$$;

revoke all on function public.get_form_response_status(uuid, uuid) from public;
revoke all on function public.submit_form_response(uuid, uuid, uuid, jsonb) from public;
revoke all on function public.update_form_response(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.get_form_response_status(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.submit_form_response(uuid, uuid, uuid, jsonb) to anon, authenticated, service_role;
grant execute on function public.update_form_response(uuid, uuid, uuid, jsonb) to anon, authenticated, service_role;

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
    count(*) filter (
      where f.is_public = true
        and (f.deadline_at is null or f.deadline_at > now())
    )::bigint as active_count,
    count(*) filter (where f.deadline_at > now())::bigint as forms_with_deadline_count
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
    and (
      p_is_public is null
      or (
        f.is_public = true
        and (f.deadline_at is null or f.deadline_at > now())
      ) = p_is_public
    );
$$;

create or replace function public.increment_form_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;

create trigger forms_increment_revision
before update on public.forms
for each row execute procedure public.increment_form_revision();

revoke all on function public.get_dashboard_forms_stats(text, timestamptz, timestamptz, uuid, text, text, boolean) from public;
grant execute on function public.get_dashboard_forms_stats(text, timestamptz, timestamptz, uuid, text, text, boolean) to authenticated, service_role;

create or replace function public.set_mail_record_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger mail_settings_set_updated_at
before update on public.mail_settings
for each row execute procedure public.set_mail_record_updated_at();

create trigger mail_queue_set_updated_at
before update on public.mail_queue
for each row execute procedure public.set_mail_record_updated_at();

create or replace function public.can_read_mail_batch(target_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.request_is_enabled()
    and exists (
      select 1
      from public.mail_batches b
      left join public.forms f on f.id = b.form_id
      where b.id = target_batch_id
        and (
          b.created_by = auth.uid()
          or f.author_id = auth.uid()
          or public.request_role() = 'admin'
        )
    );
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
  where exists (select 1 from question_names)
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

create or replace function public.enqueue_mail_reminder_batch(
  p_batch_id uuid,
  p_form_id uuid,
  p_created_by uuid,
  p_jobs jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  job_count integer;
begin
  if p_batch_id is null or p_form_id is null or p_created_by is null or jsonb_typeof(p_jobs) <> 'array' then
    raise exception 'Invalid reminder batch' using errcode = '22023';
  end if;

  job_count := jsonb_array_length(p_jobs);
  if job_count not between 1 and 5000
    or exists (select 1 from jsonb_array_elements(p_jobs) job where jsonb_typeof(job) <> 'object')
  then
    raise exception 'Invalid reminder jobs' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mail-reminder/' || p_form_id::text, 0)
  );

  if exists (
    select 1
    from public.mail_queue q
    where q.form_id = p_form_id
      and q.status in ('queued', 'processing')
  ) then
    raise exception 'Previous reminder run is still active' using errcode = '55000';
  end if;

  insert into public.mail_batches (id, kind, form_id, created_by, total_count)
  values (p_batch_id, 'reminder', p_form_id, p_created_by, job_count);

  insert into public.mail_queue (
    batch_id,
    form_id,
    organization_id,
    recipient_email,
    recipient_name,
    subject,
    body_text
  )
  select
    p_batch_id,
    p_form_id,
    (job ->> 'organization_id')::uuid,
    lower(btrim(job ->> 'recipient_email')),
    btrim(job ->> 'recipient_name'),
    job ->> 'subject',
    job ->> 'body_text'
  from jsonb_array_elements(p_jobs) job;

  return job_count;
end;
$$;

create or replace function public.claim_mail_jobs(
  p_worker_id text,
  p_limit integer default 20
)
returns setof public.mail_queue
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(btrim(p_worker_id)) not between 1 and 200 then
    raise exception 'Invalid worker id' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select q.id
    from public.mail_queue q
    where (
      (q.status = 'queued' and q.next_attempt_at <= now())
      or (q.status = 'processing' and q.locked_at < now() - interval '10 minutes')
    )
    order by q.next_attempt_at, q.created_at, q.id
    for update skip locked
    limit least(greatest(p_limit, 1), 100)
  )
  update public.mail_queue q
  set status = 'processing',
      attempts = q.attempts + 1,
      locked_at = now(),
      locked_by = btrim(p_worker_id),
      last_error = null
  from candidates c
  where q.id = c.id
  returning q.*;
end;
$$;

create or replace function public.finish_mail_job(
  p_job_id uuid,
  p_worker_id text,
  p_success boolean,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  final_status text;
begin
  update public.mail_queue q
  set status = case
        when p_success then 'sent'
        when q.attempts >= q.max_attempts then 'failed'
        else 'queued'
      end,
      sent_at = case when p_success then now() else null end,
      next_attempt_at = case
        when p_success or q.attempts >= q.max_attempts then q.next_attempt_at
        else now() + make_interval(secs => least(1800, 30 * power(2, least(q.attempts, 6))::integer))
      end,
      last_error = case when p_success then null else left(coalesce(nullif(btrim(p_error), ''), 'Неизвестная ошибка отправки'), 1000) end,
      locked_at = null,
      locked_by = null
  where q.id = p_job_id
    and q.status = 'processing'
    and q.locked_by = btrim(p_worker_id)
  returning q.status into final_status;

  return final_status;
end;
$$;

revoke all on function public.can_read_mail_batch(uuid) from public;
revoke all on function public.list_missing_form_organizations(uuid) from public;
revoke all on function public.enqueue_mail_reminder_batch(uuid, uuid, uuid, jsonb) from public;
revoke all on function public.claim_mail_jobs(text, integer) from public;
revoke all on function public.finish_mail_job(uuid, text, boolean, text) from public;
grant execute on function public.can_read_mail_batch(uuid) to authenticated, service_role;
grant execute on function public.list_missing_form_organizations(uuid) to service_role;
grant execute on function public.enqueue_mail_reminder_batch(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.claim_mail_jobs(text, integer) to service_role;
grant execute on function public.finish_mail_job(uuid, text, boolean, text) to service_role;

-- =========================
-- ENABLE RLS
-- =========================

alter table public.profiles enable row level security;
alter table public.app_branding enable row level security;
alter table public.education_organizations enable row level security;
alter table public.forms enable row level security;
alter table public.responses enable row level security;
alter table public.storage_cleanup_runs enable row level security;
alter table public.mail_settings enable row level security;
alter table public.mail_batches enable row level security;
alter table public.mail_queue enable row level security;

-- =========================
-- API PRIVILEGES
-- =========================

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

grant select on table public.profiles to authenticated;
revoke all on table public.app_branding from anon, authenticated;
grant select on table public.app_branding to authenticated;
grant select, insert, update, delete on table public.app_branding to service_role;
grant select, insert, update, delete on table public.education_organizations to authenticated;
grant select on table public.forms to anon;
grant select on table public.forms to authenticated;
grant insert (id, title, schema, theme, form_type, form_reason, is_public, deadline_at, max_responses, allow_response_editing, organization_types, author_id)
  on table public.forms to authenticated;
revoke delete on table public.forms from authenticated;
revoke update on table public.forms from authenticated;
grant update (title, theme, form_type, form_reason, is_public, deadline_at, max_responses, allow_response_editing) on table public.forms to authenticated;
revoke insert on table public.responses from anon;
revoke select on table public.responses from authenticated;
grant select (id, form_id, data, created_at, updated_at) on table public.responses to authenticated;
revoke insert on table public.responses from authenticated;
grant select, insert, update, delete on table public.profiles, public.education_organizations, public.forms, public.responses to service_role;
revoke all on table public.response_file_references from anon, authenticated;
grant select, insert, update, delete on table public.response_file_references to service_role;
revoke all on table public.storage_cleanup_runs from anon, authenticated;
grant select, insert, update, delete on table public.storage_cleanup_runs to service_role;
revoke all on table public.mail_settings, public.mail_batches, public.mail_queue from anon, authenticated;
grant select on table public.mail_batches, public.mail_queue to authenticated;
grant select, insert, update, delete on table public.mail_settings, public.mail_batches, public.mail_queue to service_role;

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
-- APPLICATION BRANDING
-- =========================

create policy "app_branding_select"
on public.app_branding
for select
to authenticated
using ((select public.request_is_enabled()));

-- =========================
-- EDUCATION ORGANIZATIONS
-- =========================

create policy "education_organizations_select"
on public.education_organizations
for select
to authenticated
using ((select public.request_is_enabled()));

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

-- =========================
-- MAIL DELIVERY STATUS
-- =========================

create policy "mail_batches_select"
on public.mail_batches
for select
to authenticated
using (public.can_read_mail_batch(id));

create policy "mail_queue_select"
on public.mail_queue
for select
to authenticated
using (public.can_read_mail_batch(batch_id));

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
  orphan_count bigint := 0;
  orphan_bytes bigint := 0;
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

  if anonymous_request then
    select count(*), coalesce(sum(
      case
        when coalesce(o.metadata ->> 'size', '') ~ '^[0-9]{1,20}$'
          then least((o.metadata ->> 'size')::numeric, 10485760)::bigint
        else 10485760
      end
    ), 0)
    into orphan_count, orphan_bytes
    from storage.objects o
    left join public.response_file_references reference on reference.object_path = o.name
    where o.bucket_id = 'survey-files'
      and split_part(o.name, '/', 1) = 'public'
      and split_part(o.name, '/', 2) = target_form_id::text
      and reference.object_path is null;
  end if;

  return existing_count < 2000
    and existing_bytes + object_size <= 2147483648
    and (
      not anonymous_request
      or (orphan_count < 20 and orphan_bytes + object_size <= 104857600)
    );
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
    and o.created_at < cutoff
    and not exists (
      select 1 from public.response_file_references rf
      where rf.object_path = o.name
    )
  order by o.created_at, o.id
  limit least(greatest(batch_limit, 1), 1000);
$$;

create or replace function public.confirm_orphan_survey_files(
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
    and o.bucket_id = 'survey-files'
    and o.name = any(object_names)
    and o.created_at < cutoff
    and not exists (
      select 1 from public.response_file_references rf
      where rf.object_path = o.name
    )
  order by o.name;
$$;

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

create or replace function public.begin_storage_cleanup_run(
  p_trigger_type text,
  p_worker_id text,
  p_retention_hours integer default 168,
  p_requested_by uuid default null,
  p_min_interval_hours integer default 0
)
returns setof public.storage_cleanup_runs
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_trigger_type is null
    or p_trigger_type not in ('scheduled', 'manual')
    or p_worker_id is null
    or length(btrim(p_worker_id)) not between 1 and 200
    or p_retention_hours is null
    or p_retention_hours not between 168 and 720
    or p_min_interval_hours is null
    or p_min_interval_hours not between 0 and 168
  then
    raise exception 'Invalid storage cleanup run' using errcode = '22023';
  end if;

  if p_trigger_type = 'manual' and not exists (
    select 1
    from public.profiles p
    where p.id = p_requested_by
      and p.role = 'admin'
      and p.is_disabled = false
  ) then
    raise exception 'Storage cleanup requires an enabled administrator' using errcode = '42501';
  end if;

  if p_trigger_type = 'scheduled' and p_requested_by is not null then
    raise exception 'Scheduled cleanup cannot have a requester' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('storage-cleanup-run', 0)
  );

  update public.storage_cleanup_runs run
  set status = 'failed',
      error = 'Предыдущая очистка была прервана',
      finished_at = now()
  where run.status = 'running'
    and run.started_at < now() - interval '1 hour';

  if exists (
    select 1 from public.storage_cleanup_runs run where run.status = 'running'
  ) then
    return;
  end if;

  if p_trigger_type = 'scheduled' and p_min_interval_hours > 0 and exists (
    select 1
    from public.storage_cleanup_runs run
    where run.status = 'succeeded'
      and run.finished_at > now() - make_interval(hours => p_min_interval_hours)
  ) then
    return;
  end if;

  return query
  insert into public.storage_cleanup_runs (
    trigger_type,
    requested_by,
    worker_id,
    retention_hours
  ) values (
    p_trigger_type,
    p_requested_by,
    btrim(p_worker_id),
    p_retention_hours
  )
  returning *;
end;
$$;

create or replace function public.finish_storage_cleanup_run(
  p_run_id uuid,
  p_worker_id text,
  p_success boolean,
  p_removed_files integer,
  p_removed_assets integer,
  p_error text default null
)
returns setof public.storage_cleanup_runs
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_run_id is null
    or p_worker_id is null
    or length(btrim(p_worker_id)) not between 1 and 200
    or p_success is null
    or p_removed_files is null
    or p_removed_files < 0
    or p_removed_assets is null
    or p_removed_assets < 0
  then
    raise exception 'Invalid storage cleanup result' using errcode = '22023';
  end if;

  return query
  update public.storage_cleanup_runs run
  set status = case when p_success then 'succeeded' else 'failed' end,
      removed_files = p_removed_files,
      removed_assets = p_removed_assets,
      error = case
        when p_success then null
        else left(coalesce(nullif(btrim(p_error), ''), 'Неизвестная ошибка очистки'), 2000)
      end,
      finished_at = now()
  where run.id = p_run_id
    and run.status = 'running'
    and run.worker_id = btrim(p_worker_id)
  returning run.*;
end;
$$;

revoke all on function public.can_upload_survey_file(text, boolean, bigint) from public;
revoke all on function public.can_read_survey_file(text) from public;
revoke all on function public.can_delete_survey_file(text) from public;
revoke all on function public.is_survey_file_referenced(text) from public;
revoke all on function public.list_orphan_survey_files(timestamptz, integer) from public;
revoke all on function public.confirm_orphan_survey_files(timestamptz, text[]) from public;
revoke all on function public.list_orphan_survey_assets(timestamptz, integer) from public;
revoke all on function public.confirm_orphan_survey_assets(timestamptz, text[]) from public;
revoke all on function public.begin_storage_cleanup_run(text, text, integer, uuid, integer) from public;
revoke all on function public.finish_storage_cleanup_run(uuid, text, boolean, integer, integer, text) from public;
grant execute on function public.can_upload_survey_file(text, boolean, bigint) to anon, authenticated, service_role;
grant execute on function public.can_read_survey_file(text) to authenticated, service_role;
grant execute on function public.can_delete_survey_file(text) to authenticated, service_role;
grant execute on function public.is_survey_file_referenced(text) to service_role;
grant execute on function public.list_orphan_survey_files(timestamptz, integer) to service_role;
grant execute on function public.confirm_orphan_survey_files(timestamptz, text[]) to service_role;
grant execute on function public.list_orphan_survey_assets(timestamptz, integer) to service_role;
grant execute on function public.confirm_orphan_survey_assets(timestamptz, text[]) to service_role;
grant execute on function public.begin_storage_cleanup_run(text, text, integer, uuid, integer) to service_role;
grant execute on function public.finish_storage_cleanup_run(uuid, text, boolean, integer, integer, text) to service_role;

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

create policy "survey_assets_branding_read" on storage.objects
for select to authenticated
using (bucket_id = 'survey-assets' and name like 'app-branding/%');

create policy "survey_assets_branding_upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'survey-assets'
  and public.can_manage_app_branding_asset(name)
);

create policy "survey_assets_branding_delete" on storage.objects
for delete to authenticated
using (bucket_id = 'survey-assets' and public.can_manage_app_branding_asset(name));

-- =========================
-- INDEXES
-- =========================

create index idx_forms_author_id on public.forms(author_id);
create index idx_forms_created_at_id on public.forms(created_at desc, id desc);
create index idx_forms_author_created_at_id on public.forms(author_id, created_at desc, id desc);
create index idx_responses_form_id on public.responses(form_id);
create index idx_responses_form_created_at_id on public.responses(form_id, created_at desc, id desc);
create unique index idx_responses_form_submission_id on public.responses(form_id, submission_id);
create unique index idx_responses_form_browser_id on public.responses(form_id, browser_id) where browser_id is not null;
create index idx_response_file_references_object_form on public.response_file_references(object_path, form_id);
create index idx_storage_cleanup_runs_started_at on public.storage_cleanup_runs(started_at desc);
create unique index idx_storage_cleanup_runs_one_active
on public.storage_cleanup_runs ((true))
where status = 'running';
create index idx_forms_title_trgm on public.forms using gin (title extensions.gin_trgm_ops);
create index idx_forms_author_name_trgm on public.forms using gin (author_name extensions.gin_trgm_ops);
create index idx_mail_batches_form_created_at on public.mail_batches(form_id, created_at desc);
create index idx_mail_queue_claim on public.mail_queue(status, next_attempt_at, created_at);
create index idx_mail_queue_batch_created_at on public.mail_queue(batch_id, created_at, id);
create index idx_mail_queue_form_created_at on public.mail_queue(form_id, created_at desc);

alter publication supabase_realtime add table public.forms;
alter publication supabase_realtime add table public.responses;
alter publication supabase_realtime add table public.mail_queue;

commit;
