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
  is_archived boolean not null default false,
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
  personal_links_enabled boolean not null default false,
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
  removed_documents integer not null default 0 check (removed_documents >= 0),
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
  allow_invalid_certificate boolean not null default false,
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
    where f.id = target_form_id
      and f.is_public = true
      and (f.deadline_at is null or f.deadline_at > now())
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
  where f.id = p_form_id;

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

create table public.survey_file_deletion_claims (
  object_path text primary key check (length(object_path) between 3 and 1024),
  claimed_at timestamptz not null default clock_timestamp()
);
alter table public.survey_file_deletion_claims enable row level security;
revoke all on public.survey_file_deletion_claims from anon, authenticated;
grant all on public.survey_file_deletion_claims to service_role;


create or replace function public.survey_file_path(value text, form_id uuid)
returns text language plpgsql immutable set search_path = '' as $$
declare path text := value; encoded text;
begin
  -- URL hosts never confer authority and are never fetched. Only the normalized
  -- local object path is stored, then checked against its upload capability.
  if value ~* '^https?://' then
    encoded := substring(value from '^https?://[^/?#]+(?:/[^?#]*)?/storage/v1/object/(?:public|sign)/survey-files/([^?#]+)');
    if encoded is null then raise exception 'Некорректная ссылка на файл' using errcode='22023'; end if;
    if length(encoded)>8192 or encoded ~ '%(?![0-9a-fA-F]{2})' then
      raise exception 'Некорректная ссылка на файл' using errcode='22023';
    end if;
    begin
      select convert_from(decode(string_agg(case when m[1] is not null then m[1]
        else encode(convert_to(m[2],'UTF8'),'hex') end,''),'hex'),'UTF8') into path
      from regexp_matches(encoded,'%([0-9a-fA-F]{2})|([^%])','g') m;
    exception when others then raise exception 'Некорректная ссылка на файл' using errcode='22023'; end;
  end if;
  if path is null or length(path)>1024
    or path !~* '^(public|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
    or split_part(path,'/',2) <> form_id::text or length(split_part(path,'/',3))>512
    or split_part(path,'/',3) in ('.','..')
  then raise exception 'Файл должен принадлежать этой форме' using errcode='22023'; end if;
  return path;
end;
$$;

create or replace function public.normalize_survey_file_value(value jsonb, form_id uuid, depth integer default 0)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare result jsonb := value; item jsonb; key text; path text; next_path text; present boolean := false;
begin
  if depth>32 then raise exception 'Слишком сложное значение файла' using errcode='22023'; end if;
  if value is null or value='null'::jsonb or value='""'::jsonb then return value; end if;
  if jsonb_typeof(value)='array' then
    result := '[]'::jsonb;
    for item in select * from jsonb_array_elements(value) loop
      result := result || jsonb_build_array(public.normalize_survey_file_value(item,form_id,depth+1));
    end loop;
    return result;
  elsif jsonb_typeof(value)='string' then
    return to_jsonb(public.survey_file_path(value #>> '{}',form_id));
  elsif jsonb_typeof(value)='object' then
    foreach key in array array['storagePath','path','content'] loop
      if value ? key then
        if jsonb_typeof(value->key) <> 'string' then
          raise exception 'Некорректное значение файла' using errcode='22023';
        end if;
        next_path := public.survey_file_path(value->>key,form_id);
        if present and path<>next_path then raise exception 'Противоречивые ссылки на файл' using errcode='22023'; end if;
        path := next_path; present := true;
        result := jsonb_set(result,array[key],to_jsonb(path));
      end if;
    end loop;
    if present then return result; end if;
  end if;
  raise exception 'Некорректное значение файла. Прикрепите файл заново.' using errcode='22023';
end;
$$;

create or replace function public.survey_response_value_is_valid(question jsonb, value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select value is null or value='null'::jsonb or case
    when question->>'type'='signaturepad' then jsonb_typeof(value)='string'
    when question->>'type' in ('text','comment','rating','integer','float','number','date','datetime','time','email','phone')
      then jsonb_typeof(value) in ('string','number','boolean')
    when question->>'type'='boolean' then jsonb_typeof(value)='boolean'
      or value=question->'valueTrue' or value=question->'valueFalse'
    when question->>'type' in ('checkbox','tagbox','ranking','paneldynamic','matrixdynamic')
      or (question->>'type'='imagepicker' and question->>'multiSelect'='true')
      then jsonb_typeof(value)='array'
    when question->>'type' in ('matrix','matrixdropdown','multipletext') then jsonb_typeof(value)='object'
    else true end;
$$;

create or replace function public.prepare_response_files()
returns trigger language plpgsql security definer set search_path = '' as $$
declare form_schema jsonb; binding record; path text; previous_paths text[] := '{}'::text[];
begin
  select schema into form_schema from public.forms where id=new.form_id;
  for binding in select * from public.survey_response_bindings(form_schema,new.data) loop
    if not coalesce(public.survey_response_value_is_valid(binding.question,binding.value),false) then
      raise exception 'Некорректный тип значения ответа' using errcode='22023';
    end if;
    if binding.question->>'type'='file' and binding.value is not null then
      new.data := jsonb_set(new.data,binding.value_path,public.normalize_survey_file_value(binding.value,new.form_id));
    end if;
  end loop;
  if tg_op='UPDATE' and old.form_id=new.form_id and old.browser_id is not distinct from new.browser_id then
    select coalesce(array_agg(object_path),'{}'::text[]) into previous_paths
    from public.response_file_references where response_id=old.id;
  end if;
  for path in select distinct scalar #>> '{}' from jsonb_path_query(new.data,'$.** ? (@.type() == "string")','{}'::jsonb,true) scalar
    where split_part(scalar #>> '{}','/',2)=new.form_id::text and (scalar #>> '{}') ~* '^(public|[0-9a-f-]{36})/[0-9a-f-]{36}/[^/]+$' order by 1
  loop
    path := public.survey_file_path(path,new.form_id);
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('survey-file/'||path,0));
    if exists(select 1 from public.survey_file_deletion_claims where object_path=path)
      or (not(path=any(previous_paths)) and not exists(
        select 1 from storage.objects where bucket_id='survey-files' and name=path))
    then raise exception 'Файл недоступен. Прикрепите файл заново.' using errcode='22023'; end if;
    -- The existing AFTER trigger enforces browser/employee ownership and writes
    -- references under the same transaction and the object lock retained here.
  end loop;
  return new;
end;
$$;

create or replace function public.claim_survey_file_deletions(p_paths text[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare path text; result text[] := '{}'::text[];
begin
  if p_paths is null then raise exception 'Некорректный список файлов' using errcode='22023'; end if;
  for path in select distinct p from unnest(p_paths) p where p is not null order by p loop
    if length(path)>1024 then raise exception 'Некорректный путь файла' using errcode='22023'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('survey-file/'||path,0));
    if not exists(select 1 from public.response_file_references where object_path=path) then
      insert into public.survey_file_deletion_claims(object_path) values(path) on conflict do nothing;
      result := array_append(result,path);
    end if;
  end loop;
  return to_jsonb(result);
end;
$$;

create or replace function public.delete_form_responses_with_files(p_form_id uuid,p_response_ids uuid[],p_actor_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare author uuid; paths text[]; removed integer;
begin
  if p_response_ids is null or cardinality(p_response_ids) not between 1 and 100
    or array_position(p_response_ids,null) is not null then raise exception 'Некорректный список ответов' using errcode='22023'; end if;
  select author_id into author from public.forms where id=p_form_id for update;
  if not found then raise exception 'Форма не найдена' using errcode='P0002'; end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and not is_disabled
    and (id=author or role='admin')) then raise exception 'Нет прав на удаление ответов' using errcode='42501'; end if;
  select coalesce(array_agg(distinct object_path),'{}'::text[]) into paths from public.response_file_references
    where form_id=p_form_id and response_id=any(p_response_ids);
  delete from public.responses where form_id=p_form_id and id=any(p_response_ids);
  get diagnostics removed=row_count;
  return jsonb_build_object('deletedResponses',removed,'objectPaths',public.claim_survey_file_deletions(paths));
end;
$$;

create or replace function public.delete_form_with_files(p_form_id uuid, p_actor_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare author uuid; paths text[];
begin
  select author_id into author from public.forms where id = p_form_id for update;
  if not found then raise exception 'Форма не найдена' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.profiles where id = p_actor_id and not is_disabled
    and (id = author or role = 'admin')) then
    raise exception 'Нет прав на удаление формы' using errcode = '42501';
  end if;
  -- Inserts serialize on the form's response counter. Lock existing responses
  -- before reading their references so an edit cannot change the captured set.
  perform 1 from public.responses where form_id = p_form_id order by id for update;
  select coalesce(array_agg(distinct object_path), '{}'::text[]) into paths
  from public.response_file_references where form_id = p_form_id;
  delete from public.forms where id = p_form_id;
  -- Office objects retain their existing durable delayed-cleanup lifecycle.
  return jsonb_build_object('objectPaths', public.claim_survey_file_deletions(paths));
end;
$$;
revoke all on function public.delete_form_with_files(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_form_with_files(uuid, uuid) to service_role;

-- GoTrue's Ban operation only writes auth.users.banned_until. Keep that write
-- and the profile authority for existing JWTs in one serialized transaction.
create or replace function public.set_employee_disabled(p_user_id uuid, p_disabled boolean, p_actor_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_disabled is null or p_user_id is null then
    raise exception 'Некорректный статус пользователя' using errcode = '22023';
  end if;
  if p_user_id = p_actor_id then
    raise exception 'Нельзя изменить собственную блокировку' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = p_actor_id and role = 'admin' and not is_disabled for share;
  if not found then raise exception 'Требуются права администратора' using errcode = '42501'; end if;
  perform 1 from auth.users where id = p_user_id for update;
  if not found then raise exception 'Пользователь не найден' using errcode = 'P0002'; end if;
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Профиль пользователя не найден' using errcode = 'P0002'; end if;
  update auth.users set banned_until = case when p_disabled then clock_timestamp() + interval '876000 hours' else null end
    where id = p_user_id;
  update public.profiles set is_disabled = p_disabled where id = p_user_id;
  return true;
end;
$$;
revoke all on function public.set_employee_disabled(uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.set_employee_disabled(uuid, boolean, uuid) to service_role;

-- Bind each question to its actual answer path, including dynamic panel entries.
create or replace function public.survey_response_bindings(
  p_schema jsonb, p_data jsonb, p_path text[] default '{}'::text[], p_depth integer default 0
)
returns table (question jsonb, value jsonb, value_path text[])
language plpgsql immutable set search_path = '' as $$
declare child jsonb; entry record; answer_path text[]; answer_value jsonb; row_schema jsonb;
begin
  if p_depth>32 then raise exception 'Структура формы превышает допустимую глубину' using errcode='22023'; end if;
  if jsonb_typeof(p_schema->'type')='string' and p_schema->>'type'<>'panel'
    and jsonb_typeof(p_schema->'name')='string' then
    answer_path := p_path || coalesce(nullif(p_schema->>'valueName',''),p_schema->>'name');
    answer_value := p_data -> coalesce(nullif(p_schema->>'valueName',''),p_schema->>'name');
    return query select p_schema,answer_value,answer_path;
    if p_schema->>'type'='paneldynamic' and jsonb_typeof(answer_value)='array' then
      for entry in select item,ordinality from jsonb_array_elements(answer_value) with ordinality a(item,ordinality) loop
        return query select * from public.survey_response_bindings(
          jsonb_build_object('elements',case when jsonb_typeof(p_schema->'templateElements')='array' then p_schema->'templateElements' else '[]'::jsonb end),
          entry.item,answer_path || (entry.ordinality-1)::text,p_depth+1);
      end loop;
    elsif p_schema->>'type' in ('matrixdynamic','matrixdropdown') then
      select jsonb_build_object('elements',coalesce(jsonb_agg(
        c || jsonb_build_object('type',coalesce(nullif(c->>'cellType','default'),p_schema->>'cellType','dropdown'))
      ),'[]'::jsonb) || case when jsonb_typeof(p_schema->'detailElements')='array' then p_schema->'detailElements' else '[]'::jsonb end)
      into row_schema from jsonb_array_elements(case when jsonb_typeof(p_schema->'columns')='array' then p_schema->'columns' else '[]'::jsonb end) c;
      if jsonb_typeof(answer_value)='array' then
        for entry in select item,ordinality from jsonb_array_elements(answer_value) with ordinality a(item,ordinality) loop
          return query select * from public.survey_response_bindings(row_schema,entry.item,answer_path || (entry.ordinality-1)::text,p_depth+1);
        end loop;
      elsif jsonb_typeof(answer_value)='object' then
        for entry in select key,item from jsonb_each(answer_value) a(key,item) loop
          return query select * from public.survey_response_bindings(row_schema,entry.item,answer_path || entry.key,p_depth+1);
        end loop;
      end if;
    end if;
    return;
  end if;
  for child in
    select item from jsonb_array_elements(case when jsonb_typeof(p_schema->'pages')='array' then p_schema->'pages' else '[]'::jsonb end) a(item)
    union all select item from jsonb_array_elements(case when jsonb_typeof(p_schema->'elements')='array' then p_schema->'elements' else '[]'::jsonb end) a(item)
  loop return query select * from public.survey_response_bindings(child,p_data,p_path,p_depth+1); end loop;
end;
$$;
revoke all on function public.survey_response_bindings(jsonb, jsonb, text[], integer) from public, anon, authenticated;

-- Missing values stay SQL NULL so a valid sibling cannot hide an incomplete entry.
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
    if not coalesce(public.survey_response_value_is_valid(binding.question, binding.value), false) then return false; end if;
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
  where f.id = p_form_id;

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

  -- AFTER INSERT may close the form when this response reaches max_responses.
  select f.* into target_form from public.forms f where f.id = p_form_id;

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
  where f.id = p_form_id;

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
  previous_paths text[] := '{}'::text[];
begin
  if tg_op = 'UPDATE' then
    if old.form_id = new.form_id and old.browser_id is not distinct from new.browser_id then
      select coalesce(array_agg(object_path), '{}'::text[]) into previous_paths
      from public.response_file_references where response_id = old.id and form_id = new.form_id;
    end if;
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
      if split_part(candidate_path, '/', 1) = 'public' then
        -- Keep exact existing attachments after old reservations are pruned.
        -- New paths require a browser capability, including personal responses.
        if not (candidate_path = any(previous_paths)) or exists (
          select 1 from public.survey_upload_reservations r where r.object_path = candidate_path
        ) then
          -- Serialize attachment against the cleanup worker's row update.
          update public.survey_upload_reservations r set attached = true
          where r.object_path = candidate_path and r.form_id = new.form_id and not r.cleanup_claimed
            and (r.browser_hash = new.browser_id or r.response_browser_hash = new.browser_id
              or candidate_path = any(previous_paths))
            and (r.expires_at > clock_timestamp() or candidate_path = any(previous_paths));
          if not found then
            raise exception 'Файл недоступен. Прикрепите файл заново.' using errcode = '22023';
          end if;
        end if;
      elsif not (candidate_path = any(previous_paths)) and (
        auth.uid() is null or not public.request_is_enabled()
        or split_part(candidate_path, '/', 1)::uuid <> auth.uid()
      ) then
        raise exception 'Файл недоступен. Прикрепите файл заново.' using errcode = '22023';
      end if;
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
  );
$$;

revoke all on function public.is_public_active_admin_authored_form(uuid) from public;
grant execute on function public.is_public_active_admin_authored_form(uuid) to authenticated, service_role;

-- Keep this SQL function inlineable: SECURITY INVOKER and no SET clauses.
-- PostgREST pushes selection, filters, ordering and LIMIT into the index scan.
-- All relation names are qualified; RLS is evaluated as the calling user.
create or replace function public.list_forms_keyset(
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  title text,
  form_type text,
  form_reason text,
  is_public boolean,
  deadline_at timestamptz,
  max_responses integer,
  author_id uuid,
  author_name text,
  created_at timestamptz,
  responses_count integer
)
language sql
stable
security invoker
as $$
  select f.id, f.title, f.form_type, f.form_reason, f.is_public,
    f.deadline_at, f.max_responses, f.author_id, f.author_name,
    f.created_at, f.responses_count
  from public.forms f
  where (p_before_created_at is null and p_before_id is null)
    or (p_before_created_at is not null and p_before_id is not null
      and (f.created_at, f.id) < (p_before_created_at, p_before_id));
$$;

revoke all on function public.list_forms_keyset(timestamptz, uuid) from public, anon;
grant execute on function public.list_forms_keyset(timestamptz, uuid) to authenticated, service_role;

-- Inlineable alternative for effective status filtering before PostgREST LIMIT.
create or replace function public.list_forms_by_activity(
  p_is_public boolean,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns setof public.forms
language sql stable security invoker
as $$
  select f.* from public.forms f
  where (f.is_public and (f.deadline_at is null or f.deadline_at > now())
    and (f.max_responses is null or f.responses_count < f.max_responses)) = p_is_public
    and ((p_before_created_at is null and p_before_id is null)
      or (p_before_created_at is not null and p_before_id is not null
        and (f.created_at, f.id) < (p_before_created_at, p_before_id)));
$$;
revoke all on function public.list_forms_by_activity(boolean, timestamptz, uuid) from public, anon;
grant execute on function public.list_forms_by_activity(boolean, timestamptz, uuid) to authenticated, service_role;

-- Escape user input as a literal substring for ILIKE (the surrounding % are added by callers).
create or replace function public.escape_forms_search(search_text text)
returns text
language sql immutable strict parallel safe
set search_path = ''
as $$
  select replace(replace(replace(search_text, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');
$$;
revoke all on function public.escape_forms_search(text) from public;
grant execute on function public.escape_forms_search(text) to authenticated, service_role;

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
        and (f.max_responses is null or f.responses_count < f.max_responses)
    )::bigint as active_count,
    count(*) filter (where f.deadline_at > now())::bigint as forms_with_deadline_count
  from public.forms f
  where f.form_type <> 'template'
    and (
      p_search is null
      or p_search = ''
      or f.title ilike '%' || public.escape_forms_search(p_search) || '%'
      or f.author_name ilike '%' || public.escape_forms_search(p_search) || '%'
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
        and (f.max_responses is null or f.responses_count < f.max_responses)
      ) = p_is_public
    );
$$;

create or replace function public.increment_form_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Response arrivals are checked separately by update-schema's count CAS.
  -- The column-filtered trigger skips this full-row comparison for counters.
  if (to_jsonb(new) - array['responses_count','revision']) is distinct from
     (to_jsonb(old) - array['responses_count','revision']) then
    new.revision := old.revision + 1;
  else new.revision := old.revision;
  end if;
  return new;
end;
$$;

create trigger forms_increment_revision
before update of id, title, form_type, form_reason, schema, theme, is_public,
  deadline_at, max_responses, allow_response_editing, personal_links_enabled,
  organization_types, author_id, author_name, revision, created_at on public.forms
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
returns boolean language sql stable security definer set search_path = '' as $$
  select public.request_is_enabled() and exists (
    select from public.mail_batches b left join public.forms f on f.id=b.form_id
    where b.id=target_batch_id
      and (f.author_id=auth.uid() or (b.form_id is null and b.created_by=auth.uid()))
      and (b.kind<>'automation' or b.created_by=auth.uid())
  );
$$;


create or replace function public.claim_mail_jobs(p_worker_id text,p_limit integer default 20)
returns setof public.mail_queue language plpgsql security definer set search_path = '' as $$
begin
  if length(btrim(p_worker_id)) not between 1 and 200 then
    raise exception 'Invalid worker id' using errcode='22023';
  end if;
  return query
  with candidates as (
    select q.id from public.mail_queue q
    where (
      (q.status='queued' and q.next_attempt_at<=now()
        and (q.automation_run_id is null or survey_automation.run_is_active(q.automation_run_id)))
      or (q.automation_run_id is null and q.status = 'processing' and q.locked_at<now()-interval '10 minutes')
    )
    order by q.next_attempt_at,q.created_at,q.id for update skip locked
    limit least(greatest(p_limit,1),100)
  )
  update public.mail_queue q set status='processing',attempts=q.attempts+1,locked_at=now(),
    locked_by=btrim(p_worker_id),last_error=null
    from candidates c where q.id=c.id returning q.*;
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
revoke all on function public.claim_mail_jobs(text, integer) from public;
revoke all on function public.finish_mail_job(uuid, text, boolean, text) from public;
grant execute on function public.can_read_mail_batch(uuid) to authenticated, service_role;
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
revoke select on table public.forms from anon;
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
using ((select public.request_is_enabled()));


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

create policy "responses_select_enabled_staff"
on public.responses
for select
to authenticated
using ((select public.request_is_enabled()));

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

create table public.survey_upload_reservations (
  object_path text primary key,
  form_id uuid not null references public.forms(id) on delete cascade,
  browser_hash uuid not null,
  response_browser_hash uuid,
  client_hash text not null check (client_hash ~ '^[a-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes between 0 and 52428800),
  attached boolean not null default false,
  cleanup_claimed boolean not null default false,
  cleanup_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '8 hours')
);
alter table public.survey_upload_reservations enable row level security;
revoke all on table public.survey_upload_reservations from anon, authenticated;
grant all on table public.survey_upload_reservations to service_role, postgres;
create index survey_upload_reservations_browser on public.survey_upload_reservations(form_id, browser_hash, expires_at);
create index survey_upload_reservations_client on public.survey_upload_reservations(client_hash, created_at);
create index survey_upload_reservations_expiry on public.survey_upload_reservations(expires_at);
create index survey_files_form_quota on storage.objects ((split_part(name, '/', 2))) where bucket_id = 'survey-files';

create or replace function public.reserve_survey_upload(p_form_id uuid, p_browser_id uuid, p_client_hash text, p_size bigint, p_extension text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  object_path text;
  pending_count bigint;
  pending_bytes bigint;
  total_count bigint;
  total_bytes bigint;
begin
  if p_browser_id is null or p_client_hash is null or p_client_hash !~ '^[a-f0-9]{64}$'
    or p_size is null or p_size not between 0 and 52428800
    or p_extension is null or p_extension !~ '^([.][a-zA-Z0-9]{1,16})?$'
  then raise exception 'Некорректные параметры файла' using errcode = '22023'; end if;
  if not public.is_public_active_form(p_form_id) then
    raise exception 'Форма закрыта для загрузки' using errcode = '42501';
  end if;
  -- Always take locks in this order. The client budget spans forms and browsers.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('survey-upload-client/' || p_client_hash, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('survey-files/' || p_form_id::text, 0));
  select count(*), coalesce(sum(r.size_bytes), 0) into pending_count, pending_bytes
  from public.survey_upload_reservations r
  where r.client_hash = p_client_hash and r.created_at > now() - interval '8 hours';
  if pending_count >= 500 or pending_bytes + p_size > 104857600 then
    raise exception 'Лимит загрузок с вашего адреса исчерпан. Повторите позже.' using errcode = '54000';
  end if;
  select count(*), coalesce(sum(r.size_bytes), 0) into pending_count, pending_bytes
  from public.survey_upload_reservations r
  where r.form_id = p_form_id and r.browser_hash = public.browser_capability_hash(p_browser_id)
    and r.expires_at > now()
    and not exists (select 1 from public.response_file_references rf where rf.object_path = r.object_path);
  if pending_count >= 20 or pending_bytes + p_size > 104857600 then
    raise exception 'Сначала отправьте ответ или удалите ненужные файлы.' using errcode = '54000';
  end if;
  -- A Storage placeholder may have only a reservation; keep the legacy estimate
  -- for objects with neither an actual nor a reserved size.
  select count(*), coalesce(sum(coalesce((o.metadata->>'size')::bigint, r.size_bytes, 10485760)), 0)
    into total_count, total_bytes from storage.objects o
    left join public.survey_upload_reservations r on r.object_path = o.name
    where o.bucket_id = 'survey-files' and split_part(o.name, '/', 2) = p_form_id::text;
  select count(*), coalesce(sum(r.size_bytes), 0) into pending_count, pending_bytes
    from public.survey_upload_reservations r
    where r.form_id = p_form_id and r.expires_at > now()
      and not exists (select 1 from storage.objects o where o.bucket_id = 'survey-files' and o.name = r.object_path);
  if total_count + pending_count >= 2000 or total_bytes + pending_bytes + p_size > 2147483648 then
    raise exception 'Хранилище формы заполнено. Обратитесь к автору формы.' using errcode = '54000';
  end if;
  object_path := 'public/' || p_form_id::text || '/' || gen_random_uuid()::text || lower(p_extension);
  insert into public.survey_upload_reservations(object_path, form_id, browser_hash, client_hash, size_bytes)
    values (object_path, p_form_id, public.browser_capability_hash(p_browser_id), p_client_hash, p_size);
  return object_path;
end;
$$;
revoke all on function public.reserve_survey_upload(uuid,uuid,text,bigint,text) from public, anon, authenticated;
grant execute on function public.reserve_survey_upload(uuid,uuid,text,bigint,text) to service_role;
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
  reserved_count bigint := 0;
  reserved_bytes bigint := 0;
begin
  if array_length(path_parts, 1) <> 3
    or length(path_parts[3]) > 512
    or object_size < 0
    or object_size > 52428800
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
        then least((o.metadata ->> 'size')::numeric, 52428800)::bigint
      else coalesce(r.size_bytes, 10485760)
    end
  ), 0)
  into existing_count, existing_bytes
  from storage.objects o
  left join public.survey_upload_reservations r on r.object_path = o.name
  where o.bucket_id = 'survey-files'
    and split_part(o.name, '/', 2) = target_form_id::text;

  -- New anonymous objects must hold an opaque reservation minted by the server.
  -- Reading/deleting already attached legacy objects keeps its existing policy.
  if anonymous_request and not exists (
    select 1 from public.survey_upload_reservations r where r.object_path = object_name
      and r.form_id = target_form_id and r.expires_at > now() and object_size <= r.size_bytes
  ) then return false; end if;
  select count(*), coalesce(sum(r.size_bytes), 0) into reserved_count, reserved_bytes
  from public.survey_upload_reservations r
  where r.form_id = target_form_id and r.expires_at > now() and r.object_path <> object_name
    and not exists (select 1 from storage.objects o where o.bucket_id = 'survey-files' and o.name = r.object_path);
  return existing_count + reserved_count < 2000
    and existing_bytes + reserved_bytes + object_size <= 2147483648;
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
        or exists (
          select 1 from public.response_file_references rf
          where rf.form_id = f.id and rf.object_path = object_name
        )
      )
  );
end;
$$;

create or replace function public.can_delete_survey_file(object_name text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.request_is_enabled() or split_part(object_name,'/',1)<>auth.uid()::text
    or cardinality(string_to_array(object_name,'/'))<>3
    or not exists(select 1 from storage.objects where bucket_id='survey-files' and name=object_name) then return false; end if;
  return public.claim_survey_file_deletions(array[object_name]) ? object_name;
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

create or replace function public.confirm_orphan_survey_files(cutoff timestamptz,object_names text[])
returns table(name text) language plpgsql volatile security definer set search_path = '' as $$
declare paths text[];
begin
  select coalesce(array_agg(o.name),'{}'::text[]) into paths from storage.objects o
  where cardinality(object_names) between 1 and 500 and o.bucket_id='survey-files'
    and o.name=any(object_names) and o.created_at<cutoff;
  return query select jsonb_array_elements_text(public.claim_survey_file_deletions(paths));
end;
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
  p_error text default null,
  p_removed_documents integer default 0
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
    or p_removed_documents is null
    or p_removed_documents < 0
  then
    raise exception 'Invalid storage cleanup result' using errcode = '22023';
  end if;

  return query
  update public.storage_cleanup_runs run
  set status = case when p_success then 'succeeded' else 'failed' end,
      removed_files = p_removed_files,
      removed_assets = p_removed_assets,
      removed_documents = p_removed_documents,
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
revoke all on function public.finish_storage_cleanup_run(uuid, text, boolean, integer, integer, text, integer) from public;
grant execute on function public.can_upload_survey_file(text, boolean, bigint) to anon, authenticated, service_role;
grant execute on function public.can_read_survey_file(text) to authenticated, service_role;
grant execute on function public.can_delete_survey_file(text) to authenticated, service_role;
grant execute on function public.is_survey_file_referenced(text) to service_role;
grant execute on function public.list_orphan_survey_files(timestamptz, integer) to service_role;
grant execute on function public.confirm_orphan_survey_files(timestamptz, text[]) to service_role;
grant execute on function public.list_orphan_survey_assets(timestamptz, integer) to service_role;
grant execute on function public.confirm_orphan_survey_assets(timestamptz, text[]) to service_role;
grant execute on function public.begin_storage_cleanup_run(text, text, integer, uuid, integer) to service_role;
grant execute on function public.finish_storage_cleanup_run(uuid, text, boolean, integer, integer, text, integer) to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('survey-files', 'survey-files', false, 52428800)
on conflict (id) do update
set public = excluded.public, file_size_limit = excluded.file_size_limit;

-- Saturate at one byte above the cap so can_upload_survey_file rejects it.
create policy "survey_files_authenticated_upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'survey-files'
  and public.can_upload_survey_file(
    name,
    false,
    case when coalesce(metadata ->> 'size', '') ~ '^[0-9]{1,20}$'
      then least((metadata ->> 'size')::numeric, 52428801)::bigint
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
      then least((metadata ->> 'size')::numeric, 52428801)::bigint
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


-- ONLYOFFICE documents


-- Question names are immutable in the builder. Preserve the previous ID on updates
-- (including saves from old browser tabs); every newly inserted form gets new IDs.
create or replace function public.office_assign_question_ids(node jsonb, previous jsonb default '{}')
returns jsonb language plpgsql set search_path = '' as $$
declare result jsonb := node; field text; children jsonb; child jsonb; stable_id text;
begin
  if jsonb_typeof(node) <> 'object' then return node; end if;
  if node ? 'type' and node ? 'name' and node->>'type' not in ('panel', 'sectiontitle', 'html') then
    stable_id := previous->>(node->>'name');
    result := jsonb_set(result, '{integrationId}', to_jsonb(coalesce(stable_id, gen_random_uuid()::text)));
  end if;
  foreach field in array array['pages','elements','templateElements'] loop
    if jsonb_typeof(node->field) = 'array' then
      children := '[]'::jsonb;
      for child in select value from jsonb_array_elements(node->field) loop
        children := children || jsonb_build_array(public.office_assign_question_ids(child, previous));
      end loop;
      result := jsonb_set(result, array[field], children);
    end if;
  end loop;
  return result;
end $$;

create or replace function public.office_preserve_question_ids()
returns trigger language plpgsql security definer set search_path = '' as $$
declare previous jsonb := '{}';
begin
  if TG_OP = 'UPDATE' then
    select coalesce(jsonb_object_agg(q->>'name', q->>'integrationId'), '{}') into previous
    from jsonb_path_query(old.schema, 'strict $.** ? (exists(@.integrationId) && exists(@.name))') q;
  end if;
  new.schema := public.office_assign_question_ids(new.schema, previous);
  return new;
end $$;

create trigger forms_office_question_ids before insert or update of schema on public.forms
for each row execute function public.office_preserve_question_ids();
revoke all on function public.office_assign_question_ids(jsonb,jsonb), public.office_preserve_question_ids() from public;

create table public.onlyoffice_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  public_url text not null default '',
  internal_url text not null default '',
  storage_url_override text not null default '',
  jwt_secret_encrypted text not null default '',
  jwt_header text not null default 'Authorization',
  jwt_prefix text not null default 'Bearer ',
  max_file_mb integer not null default 25 check (max_file_mb between 1 and 100),
  max_table_rows integer not null default 1000 check (max_table_rows between 1 and 5000),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.onlyoffice_settings (id) values (1);

create table public.office_documents (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  name text not null check (length(name) between 6 and 200 and name ~* '\.(docx|xlsx)$'),
  storage_path text not null unique,
  size_bytes bigint not null default 0,
  version integer not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_opened_at timestamptz,
  last_callback_at timestamptz,
  last_save_error text,
  last_save_error_at timestamptz,
  last_force_save_at bigint not null default 0
,
  file_type text not null default 'docx' check(file_type in ('docx','xlsx')),
  template_field_count integer not null default 0
);
create index office_documents_form_idx on public.office_documents(form_id, updated_at desc);
create table public.office_document_bindings (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.office_documents(id) on delete cascade,
  binding_type text not null check (binding_type in ('form_field','metric','responses_table','non_respondents')),
  label text not null check (length(label) between 1 and 300),
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 32768),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index office_document_bindings_document_idx on public.office_document_bindings(document_id);
create table public.office_storage_cleanup (
  storage_path text primary key,
  created_at timestamptz not null default now()
);
create or replace function public.office_queue_storage_cleanup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'DELETE' or old.storage_path is distinct from new.storage_path then
    insert into public.office_storage_cleanup(storage_path) values(old.storage_path) on conflict do nothing;
  end if;
  return null;
end $$;
create trigger office_documents_cleanup after delete or update of storage_path on public.office_documents
for each row execute function public.office_queue_storage_cleanup();
revoke all on function public.office_queue_storage_cleanup() from public;

alter table public.onlyoffice_settings enable row level security;
alter table public.office_documents enable row level security;
alter table public.office_document_bindings enable row level security;
alter table public.office_storage_cleanup enable row level security;
revoke all on public.onlyoffice_settings, public.office_documents, public.office_document_bindings, public.office_storage_cleanup from anon, authenticated;
grant select on public.office_documents, public.office_document_bindings to authenticated;
grant all on public.onlyoffice_settings, public.office_documents, public.office_document_bindings, public.office_storage_cleanup to service_role;
create policy office_documents_read on public.office_documents for select to authenticated
using ((select public.request_is_enabled()) and exists(select 1 from public.forms f where f.id = form_id));
create policy office_bindings_read on public.office_document_bindings for select to authenticated
using (exists(select 1 from public.office_documents d where d.id = document_id));
-- Writes/downloads go through Office API with verified active employee identity.
-- No anonymous or authenticated Storage policies are created for this bucket.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('survey-documents','survey-documents',false,104857600,array['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);


-- Persist individual document generations in private Storage.
create table public.office_generation_results (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  template_id uuid references public.office_documents(id) on delete set null,
  name text not null,
  file_type text not null check(file_type in ('docx','xlsx')),
  storage_path text not null unique,
  files jsonb not null check(jsonb_typeof(files)='array' and jsonb_array_length(files) between 1 and 500),
  size_bytes bigint not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index office_results_form_idx on public.office_generation_results(form_id,created_at desc);
alter table public.office_generation_results enable row level security;
revoke all on public.office_generation_results from anon,authenticated;
grant all on public.office_generation_results to service_role;
create trigger office_results_cleanup after delete on public.office_generation_results
for each row execute function public.office_queue_storage_cleanup();
update storage.buckets set allowed_mime_types=array['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/zip'] where id='survey-documents';


-- Preserve directory references in historical responses.
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

create trigger education_organizations_archive_on_delete
before delete on public.education_organizations
for each row execute procedure public.archive_education_organization();

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

create index if not exists forms_title_keyset_idx on public.forms (lower(title), id) where form_type <> 'template';
create index if not exists forms_author_name_keyset_idx on public.forms (lower(coalesce(nullif(author_name, ''), author_id::text)), id) where form_type <> 'template';
create index if not exists forms_responses_keyset_idx on public.forms ((coalesce(responses_count, 0)), id) where form_type <> 'template';

create or replace function public.list_forms_sorted(
  p_sort_field text default 'created_at',
  p_sort_direction text default 'desc',
  p_page_size integer default 20,
  p_after_id uuid default null,
  p_after_value text default null,
  p_reference_time timestamptz default null,
  p_search text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_author_id uuid default null,
  p_form_type text default null,
  p_form_reason text default null,
  p_is_public boolean default null
)
returns table (
  id uuid, title text, form_type text, form_reason text, is_public boolean,
  deadline_at timestamptz, max_responses integer, author_id uuid, author_name text,
  created_at timestamptz, responses_count integer,
  sort_value text, sort_reference_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  sort_expression text;
  sort_type text;
  comparison text;
  reference_time timestamptz := coalesce(p_reference_time, statement_timestamp());
begin
  if p_sort_direction is null or p_sort_direction not in ('asc', 'desc')
    or p_page_size is null or p_page_size < 1 or p_page_size > 999
    or (p_after_id is null) <> (p_after_value is null)
    or (p_after_id is not null and p_reference_time is null)
  then
    raise exception 'Некорректные параметры сортировки или страницы' using errcode = '22023';
  end if;

  -- Only these fixed expressions and directions enter SQL; user values remain bound parameters.
  case p_sort_field
    when 'created_at' then sort_expression := 'f.created_at'; sort_type := 'timestamptz';
    when 'title' then sort_expression := 'lower(f.title)'; sort_type := 'text';
    when 'author_name' then
      sort_expression := 'lower(coalesce(nullif(f.author_name, ''''), f.author_id::text))'; sort_type := 'text';
    when 'responses_count' then sort_expression := 'coalesce(f.responses_count, 0)'; sort_type := 'integer';
    when 'status' then
      -- Match the displayed deadline state. Freeze the clock across a cursor chain.
      sort_expression := '(f.is_public and (f.deadline_at is null or f.deadline_at > $1) and (f.max_responses is null or f.responses_count < f.max_responses))';
      sort_type := 'boolean';
    when 'classification' then
      sort_expression := $expr$(case f.form_type
        when 'anketa' then 'Анкетирование' when 'voting' then 'Голосование'
        when 'request' then 'Запрос' when 'monitoring' then 'Мониторинг'
        when 'survey' then 'Опрос' when 'sample' then 'Проба' when 'other' then 'Другое'
        else f.form_type end || ' • ' || case f.form_reason
        when 'request' then 'Запрос' when 'plan' then 'План работ'
        when 'order' then 'Приказ' when 'directive' then 'Распоряжение'
        when 'other' then 'Иное' else f.form_reason end)$expr$;
      sort_type := 'text';
    else raise exception 'Неизвестная колонка сортировки' using errcode = '22023';
  end case;
  comparison := case when p_sort_direction = 'asc' then '>' else '<' end;

  return query execute format($query$
    select f.id, f.title, f.form_type, f.form_reason, f.is_public,
      f.deadline_at, f.max_responses, f.author_id, f.author_name,
      f.created_at, f.responses_count, (%1$s)::text, $1
    from public.forms f
    where f.form_type <> 'template'
      and ($2 is null or $2 = '' or f.title ilike '%%' || $2 || '%%' or f.author_name ilike '%%' || $2 || '%%')
      and ($3 is null or f.created_at >= $3)
      and ($4 is null or f.created_at <= $4)
      and ($5 is null or f.author_id = $5)
      and ($6 is null or f.form_type = $6)
      and ($7 is null or f.form_reason = $7)
      and ($8 is null or (f.is_public and (f.deadline_at is null or f.deadline_at > now())
        and (f.max_responses is null or f.responses_count < f.max_responses)) = $8)
      and ($9 is null or ((%1$s), f.id) %2$s (($10)::%3$s, $9))
    order by %1$s %4$s, f.id %4$s
    limit $11
  $query$, sort_expression, comparison, sort_type, p_sort_direction)
  using reference_time, public.escape_forms_search(p_search), p_date_from, p_date_to, p_author_id,
    p_form_type, p_form_reason, p_is_public, p_after_id, p_after_value, p_page_size + 1;
end;
$$;

revoke all on function public.list_forms_sorted(text, text, integer, uuid, text, timestamptz, text, timestamptz, timestamptz, uuid, text, text, boolean) from public, anon;
grant execute on function public.list_forms_sorted(text, text, integer, uuid, text, timestamptz, text, timestamptz, timestamptz, uuid, text, text, boolean) to authenticated, service_role;

-- A scalar JSON result is not truncated by PostgREST db-max-rows. STABLE uses
-- one MVCC snapshot for size checks and payload, including concurrent deletes.
create or replace function public.export_form_responses(p_form_id uuid, p_response_ids uuid[] default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  row_count bigint;
  byte_count bigint;
  result jsonb;
begin
  if not public.request_is_enabled() then
    raise exception 'Требуется действующая учётная запись' using errcode = '42501';
  end if;
  if p_response_ids is not null and cardinality(p_response_ids) not between 1 and 10000 then
    raise exception 'Выберите от 1 до 10000 ответов' using errcode = '22023';
  end if;
  select count(*), coalesce(sum(octet_length(r.data::text) + 256), 0)
  into row_count, byte_count
  from public.responses r where r.form_id = p_form_id
    and (p_response_ids is null or r.id = any(p_response_ids));
  if row_count > 10000 or byte_count > 33554432 then
    raise exception 'Слишком большая выгрузка. Выберите до 10000 ответов общим объёмом до 32 МБ.' using errcode = '54000';
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc), '[]'::jsonb)
  into result
  from (select id, form_id, data, created_at, updated_at from public.responses
    where form_id = p_form_id and (p_response_ids is null or id = any(p_response_ids))) r;
  return result;
end;
$$;
revoke all on function public.export_form_responses(uuid,uuid[]) from public, anon;
grant execute on function public.export_form_responses(uuid,uuid[]) to authenticated, service_role;



create or replace function public.list_expired_survey_uploads(batch_limit integer default 100)
returns table(name text) language plpgsql volatile security definer set search_path = '' as $$
declare candidate record;
begin
  for candidate in
    select r.object_path from public.survey_upload_reservations r
    where r.expires_at<now() and not r.attached
      and (not r.cleanup_claimed or r.cleanup_claimed_at is null or r.cleanup_claimed_at<now()-interval '10 minutes')
      and exists(select 1 from storage.objects o where o.bucket_id='survey-files' and o.name=r.object_path)
      and not exists(select 1 from public.response_file_references rf where rf.object_path=r.object_path)
    order by r.object_path limit least(greatest(batch_limit,1),500) for update skip locked
  loop
    -- Reservation rows are locked first here. Do not wait for an attacher which
    -- already owns the path lock and may itself need the reservation row.
    if pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('survey-file/'||candidate.object_path,0))
      and public.claim_survey_file_deletions(array[candidate.object_path]) ? candidate.object_path then
      update public.survey_upload_reservations set cleanup_claimed=true,cleanup_claimed_at=now()
        where object_path=candidate.object_path;
      return query select candidate.object_path;
    end if;
  end loop;
end;
$$;
revoke all on function public.list_expired_survey_uploads(integer) from public, anon, authenticated;
grant execute on function public.list_expired_survey_uploads(integer) to service_role;


create table public.office_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  template_id uuid references public.office_documents(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  name text not null,
  file_type text not null check(file_type in ('docx','xlsx')),
  storage_path text not null,
  state text not null default 'queued' check(state in ('queued','running','succeeded','failed')),
  payload jsonb,
  payload_bytes integer not null check(payload_bytes between 0 and 8388608),
  attempts integer not null default 0,
  attempt_token uuid,
  available_at timestamptz not null default now(),
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index office_jobs_pending on public.office_generation_jobs(created_at,id) where state in ('queued','running');
create index office_jobs_storage on public.office_generation_jobs(storage_path) where state in ('queued','running');
create index office_jobs_form on public.office_generation_jobs(form_id,created_at desc);
alter table public.office_generation_jobs enable row level security;
revoke all on public.office_generation_jobs from anon,authenticated;
grant all on public.office_generation_jobs to service_role, postgres;
create or replace function public.list_orphan_office_documents(
  cutoff timestamptz default (now() - interval '168 hours'), batch_limit integer default 500
)
returns table (name text) language sql stable security definer set search_path = '' as $$
  select o.name from storage.objects o where o.bucket_id='survey-documents'
    and o.created_at < least(cutoff, now() - interval '168 hours')
    and o.name ~ '^forms/[0-9a-f-]{36}/(documents/[0-9a-f-]{36}/[0-9a-f-]{36}\.(docx|xlsx)|results/[0-9a-f-]{36}\.zip)$'
    and not exists (select 1 from public.office_documents d where d.storage_path=o.name)
    and not exists (select 1 from public.office_generation_results r where r.storage_path=o.name)
    and not exists (select 1 from public.office_generation_jobs j where j.storage_path=o.name and j.state in ('queued','running'))
    -- Superseded objects can still be used by a one-hour editor capability.
    and not exists (select 1 from public.office_storage_cleanup q where q.storage_path=o.name and q.created_at>=now()-interval '2 hours')
  order by o.created_at,o.id limit least(greatest(batch_limit,1),500);
$$;
create or replace function public.confirm_orphan_office_documents(cutoff timestamptz, object_names text[])
returns table (name text) language sql stable security definer set search_path = '' as $$
  select o.name from storage.objects o where o.bucket_id='survey-documents'
    and cardinality(object_names) between 1 and 500 and o.name=any(object_names)
    and o.created_at < least(cutoff, now() - interval '168 hours')
    and o.name ~ '^forms/[0-9a-f-]{36}/(documents/[0-9a-f-]{36}/[0-9a-f-]{36}\.(docx|xlsx)|results/[0-9a-f-]{36}\.zip)$'
    and not exists (select 1 from public.office_documents d where d.storage_path=o.name)
    and not exists (select 1 from public.office_generation_results r where r.storage_path=o.name)
    and not exists (select 1 from public.office_generation_jobs j where j.storage_path=o.name and j.state in ('queued','running'))
    -- Superseded objects can still be used by a one-hour editor capability.
    and not exists (select 1 from public.office_storage_cleanup q where q.storage_path=o.name and q.created_at>=now()-interval '2 hours')
  order by o.name;
$$;
revoke all on function public.list_orphan_office_documents(timestamptz,integer) from public;
grant execute on function public.list_orphan_office_documents(timestamptz,integer) to service_role;
revoke all on function public.confirm_orphan_office_documents(timestamptz,text[]) from public;
grant execute on function public.confirm_orphan_office_documents(timestamptz,text[]) to service_role;


-- Storage may first authorize an empty metadata placeholder and write the actual
-- length later as its service role. Enforce the reservation on that final write.
create or replace function public.enforce_survey_upload_size()
returns trigger language plpgsql security definer set search_path = '' as $$
declare reserved_size bigint;
begin
  if new.bucket_id='survey-files' and split_part(new.name,'/',1)='public' then
    select r.size_bytes into reserved_size from public.survey_upload_reservations r where r.object_path=new.name;
    if found and new.metadata ? 'size' and
      (coalesce(new.metadata->>'size','') !~ '^[0-9]{1,20}$' or (new.metadata->>'size')::numeric>reserved_size) then
      raise exception 'Размер файла превышает разрешённый для этой загрузки' using errcode='22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_survey_upload_size() from public,anon,authenticated;
create trigger survey_upload_reserved_size before insert or update of metadata,name,bucket_id on storage.objects
for each row execute function public.enforce_survey_upload_size();

-- Only the browser that reserved a file may reopen it from a response draft.
create or replace function public.can_restore_survey_upload(p_path text,p_browser_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_browser_id is not null
    and exists(select 1 from storage.objects where bucket_id='survey-files' and name=p_path)
    and not exists(select 1 from public.survey_file_deletion_claims where object_path=p_path)
    and (
      exists(select 1 from public.survey_upload_reservations r where r.object_path=p_path
        and r.browser_hash=public.browser_capability_hash(p_browser_id)
        and not r.cleanup_claimed and (r.attached or r.expires_at>now()))
      or exists(select 1 from public.responses r join public.response_file_references ref on ref.response_id=r.id
        where r.browser_id=public.browser_capability_hash(p_browser_id) and ref.object_path=p_path)
    );
$$;
revoke all on function public.can_restore_survey_upload(text,uuid) from public, anon, authenticated;
grant execute on function public.can_restore_survey_upload(text,uuid) to service_role;

-- Personal organization links (202609291800).

alter table public.forms add column if not exists personal_links_enabled boolean not null default false;

-- Tokens are capabilities. Browser credentials used by the existing response API
-- stay server-side, separate from the published token and ordinary browser IDs.
create table if not exists public.form_personal_links (
  form_id uuid not null references public.forms(id) on delete cascade,
  organization_id uuid not null references public.education_organizations(id),
  token uuid not null default gen_random_uuid() unique,
  browser_id uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  primary key (form_id, organization_id)
);
alter table public.form_personal_links enable row level security;
revoke all on public.form_personal_links from anon, authenticated;
grant all on public.form_personal_links to service_role;

create or replace function public.ensure_form_personal_links(p_form_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.form_personal_links(form_id, organization_id)
  select f.id, o.id from public.forms f
  join public.education_organizations o on o.organization_type = any(f.organization_types)
  where f.id = p_form_id and f.personal_links_enabled and not o.is_archived
    and jsonb_path_exists(f.schema, '$.** ? (@.type == "organization")')
  on conflict (form_id, organization_id) do nothing;
end;
$$;
revoke all on function public.ensure_form_personal_links(uuid) from public, anon, authenticated;

create or replace function public.get_form_personal_links(p_form_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f public.forms%rowtype; can_manage boolean; links jsonb;
begin
  if not public.request_is_enabled() then
    raise exception 'Требуется действующая учётная запись' using errcode = '42501';
  end if;
  select * into f from public.forms where id = p_form_id;
  if not found then raise exception 'Форма не найдена' using errcode = 'P0002'; end if;
  can_manage := f.author_id = auth.uid();
  if can_manage then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'organization_type', o.organization_type, 'number', o.number,
      'alias', o.alias, 'email', o.email, 'token', l.token
    ) order by o.organization_type, o.number, o.alias, o.id), '[]'::jsonb) into links
    from public.form_personal_links l
    join public.education_organizations o on o.id = l.organization_id
    where l.form_id = f.id and not o.is_archived and o.organization_type = any(f.organization_types);
  end if;
  return jsonb_build_object('available', jsonb_path_exists(f.schema, '$.** ? (@.type == "organization")'),
    'canManage', can_manage, 'enabled', f.personal_links_enabled, 'links', coalesce(links, '[]'::jsonb));
end;
$$;
revoke all on function public.get_form_personal_links(uuid) from public, anon;
grant execute on function public.get_form_personal_links(uuid) to authenticated;

create or replace function public.set_form_personal_links(p_form_id uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.forms%rowtype;
begin
  if not public.request_is_enabled() then
    raise exception 'Требуется действующая учётная запись' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mail-reminder/' || p_form_id::text, 0));
  select * into f from public.forms where id = p_form_id for update;
  if not found or not (f.author_id = auth.uid()) then
    raise exception 'Нет прав на управление персональными ссылками' using errcode = '42501';
  end if;
  if p_enabled is null then raise exception 'Укажите состояние переключателя' using errcode = '22023'; end if;
  if p_enabled and not jsonb_path_exists(f.schema, '$.** ? (@.type == "organization")') then
    raise exception 'Добавьте в форму вопрос «Организация»' using errcode = '22023';
  end if;
  if p_enabled is distinct from f.personal_links_enabled and exists (
    select 1 from public.mail_queue where form_id = p_form_id and automation_run_id is null and status in ('queued', 'processing')
  ) then
    raise exception 'Дождитесь завершения текущей рассылки по форме' using errcode = '55000';
  end if;
  update public.forms set personal_links_enabled = p_enabled where id = p_form_id;
  if p_enabled then perform public.ensure_form_personal_links(p_form_id); end if;
  return public.get_form_personal_links(p_form_id);
end;
$$;
revoke all on function public.set_form_personal_links(uuid, boolean) from public, anon;
grant execute on function public.set_form_personal_links(uuid, boolean) to authenticated;

create or replace function public.resolve_form_personal_link(p_form_id uuid, p_token uuid)
returns public.form_personal_links language plpgsql stable security definer set search_path = '' as $$
declare link public.form_personal_links%rowtype;
begin
  if auth.uid() is not null and not public.request_is_enabled() then
    raise exception 'Пользователь отключён' using errcode = '42501';
  end if;
  select l.* into link from public.form_personal_links l
  join public.forms f on f.id = l.form_id
  join public.education_organizations o on o.id = l.organization_id
  where l.form_id = p_form_id and l.token = p_token and f.personal_links_enabled
    and public.is_public_active_form(f.id) and not o.is_archived
    and o.organization_type = any(f.organization_types)
    and jsonb_path_exists(f.schema, '$.** ? (@.type == "organization")');
  if not found then
    raise exception 'Персональная ссылка недействительна или форма закрыта' using errcode = '42501';
  end if;
  return link;
end;
$$;
revoke all on function public.resolve_form_personal_link(uuid, uuid) from public, anon, authenticated;

create or replace function public.get_personal_form_context(p_form_id uuid, p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare link public.form_personal_links%rowtype; organization jsonb;
begin
  link := public.resolve_form_personal_link(p_form_id, p_token);
  select jsonb_build_object('id', o.id, 'organization_type', o.organization_type,
    'number', o.number, 'alias', o.alias) into organization
  from public.education_organizations o where o.id = link.organization_id;
  return organization;
end;
$$;
revoke all on function public.get_personal_form_context(uuid, uuid) from public;
grant execute on function public.get_personal_form_context(uuid, uuid) to anon, authenticated;

create or replace function public.check_personal_response_data(p_form_id uuid, p_organization_id uuid, p_data jsonb)
returns void language plpgsql stable security definer set search_path = '' as $$
declare organization_value jsonb; organization_count integer := 0;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Некорректные данные ответа' using errcode = '22023';
  end if;
  for organization_value in
    select v.value from public.forms f
    cross join lateral public.survey_organization_values(f.schema, p_data) v(value)
    where f.id = p_form_id
  loop
    organization_count := organization_count + 1;
    if organization_value is distinct from to_jsonb(p_organization_id::text) then
      raise exception 'Организацию в персональной ссылке изменить нельзя' using errcode = '22023';
    end if;
  end loop;
  if organization_count = 0 then
    raise exception 'Укажите организацию в ответе по персональной ссылке' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.check_personal_response_data(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.get_personal_form_response_status(p_form_id uuid, p_token uuid)
returns table(response_id uuid, response_data jsonb, response_editable boolean)
language plpgsql stable security definer set search_path = '' as $$
declare link public.form_personal_links%rowtype;
begin
  link := public.resolve_form_personal_link(p_form_id, p_token);
  return query select * from public.get_form_response_status(p_form_id, link.browser_id);
end;
$$;
revoke all on function public.get_personal_form_response_status(uuid, uuid) from public;
grant execute on function public.get_personal_form_response_status(uuid, uuid) to anon, authenticated;

create or replace function public.submit_personal_form_response(p_form_id uuid, p_token uuid, p_submission_id uuid, p_data jsonb)
returns table(status text, response_id uuid, response_data jsonb, response_editable boolean)
language plpgsql security definer set search_path = '' as $$
declare link public.form_personal_links%rowtype;
begin
  perform 1 from public.forms where id = p_form_id for update;
  link := public.resolve_form_personal_link(p_form_id, p_token);
  perform public.check_personal_response_data(p_form_id, link.organization_id, p_data);
  return query select * from public.submit_form_response(p_form_id, link.browser_id, p_submission_id, p_data);
end;
$$;
revoke all on function public.submit_personal_form_response(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.submit_personal_form_response(uuid, uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.update_personal_form_response(p_form_id uuid, p_token uuid, p_response_id uuid, p_data jsonb)
returns table(response_id uuid, response_data jsonb)
language plpgsql security definer set search_path = '' as $$
declare link public.form_personal_links%rowtype;
begin
  perform 1 from public.forms where id = p_form_id for update;
  link := public.resolve_form_personal_link(p_form_id, p_token);
  perform public.check_personal_response_data(p_form_id, link.organization_id, p_data);
  return query select * from public.update_form_response(p_form_id, link.browser_id, p_response_id, p_data);
end;
$$;
revoke all on function public.update_personal_form_response(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.update_personal_form_response(uuid, uuid, uuid, jsonb) to anon, authenticated;

-- One JSON snapshot avoids PostgREST's 1000-row truncation. Prepare missing
-- tokens for new directory entries before either invitations or reminders.
create or replace function public.prepare_form_mail_recipients(p_form_id uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.forms%rowtype; recipients jsonb;
begin
  select * into f from public.forms where id = p_form_id for update;
  if not found or not public.is_public_active_form(p_form_id) then
    raise exception 'Форма закрыта для ответов' using errcode = '22023';
  end if;
  if p_kind not in ('invitation', 'reminder') or p_kind is null then
    raise exception 'Некорректный тип рассылки' using errcode = '22023';
  end if;
  if not jsonb_path_exists(f.schema, '$.** ? (@.type == "organization")') then
    raise exception 'Добавьте в форму вопрос «Организация»' using errcode = '22023';
  end if;
  if p_kind = 'invitation' and not f.personal_links_enabled then
    raise exception 'Сначала включите персональные ссылки' using errcode = '22023';
  end if;
  perform public.ensure_form_personal_links(p_form_id);
  select coalesce(jsonb_agg(to_jsonb(recipient)), '[]'::jsonb) into recipients from (
    select o.id, o.organization_type, o.number, o.alias, o.email,
      case when f.personal_links_enabled then l.token else null end as token
    from public.education_organizations o
    left join public.form_personal_links l on l.form_id = f.id and l.organization_id = o.id
    where not o.is_archived and o.organization_type = any(f.organization_types)
      and (p_kind = 'invitation' or not exists (
        select 1 from public.responses r
        cross join lateral public.survey_organization_values(f.schema, r.data) v(value)
        where r.form_id = f.id and v.value = to_jsonb(o.id::text)
      ))
    order by o.organization_type, o.number, o.alias, o.id limit 5001
  ) recipient;
  if jsonb_array_length(recipients) > 5000 then
    raise exception 'За одну рассылку можно поставить в очередь не более 5000 писем' using errcode = '22023';
  end if;
  return jsonb_build_object('personal', f.personal_links_enabled, 'recipients', recipients);
end;
$$;
revoke all on function public.prepare_form_mail_recipients(uuid, text) from public, anon, authenticated;
grant execute on function public.prepare_form_mail_recipients(uuid, text) to service_role;

alter table public.mail_batches drop constraint if exists mail_batches_kind_check;
alter table public.mail_batches add constraint mail_batches_kind_check check (kind in ('reminder', 'invitation', 'test'));
alter table public.mail_batches drop constraint if exists mail_batches_form_kind;
alter table public.mail_batches add constraint mail_batches_form_kind check (
  (kind in ('reminder', 'invitation') and form_id is not null) or (kind = 'test' and form_id is null)
);

create or replace function public.enqueue_form_mail_batch(
  p_batch_id uuid, p_form_id uuid, p_created_by uuid, p_jobs jsonb, p_kind text, p_personal boolean
)
returns integer language plpgsql security definer set search_path = '' as $$
declare job_count integer; f public.forms%rowtype;
begin
  if p_batch_id is null or p_form_id is null or p_created_by is null or p_jobs is null
    or jsonb_typeof(p_jobs) <> 'array' or p_kind is null or p_kind not in ('reminder','invitation') then
    raise exception 'Некорректная рассылка' using errcode = '22023';
  end if;
  job_count := jsonb_array_length(p_jobs);
  if job_count not between 1 and 5000 then raise exception 'Некорректное число писем' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mail-reminder/' || p_form_id::text, 0));
  select * into f from public.forms where id = p_form_id for update;
  if not found or not public.is_public_active_form(p_form_id)
    or f.personal_links_enabled is distinct from p_personal or (p_kind = 'invitation' and not p_personal)
    or not jsonb_path_exists(f.schema, '$.** ? (@.type == "organization")') then
    raise exception 'Настройки формы изменились. Повторите рассылку.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_created_by and not p.is_disabled
    and p.id = f.author_id) then
    raise exception 'Нет прав на рассылку по этой форме' using errcode = '42501';
  end if;
  if exists (select 1 from public.mail_queue q where q.form_id = p_form_id and q.automation_run_id is null and q.status in ('queued','processing')) then
    raise exception 'Previous reminder run is still active' using errcode = '55000';
  end if;
  insert into public.mail_batches(id, kind, form_id, created_by, total_count)
  values (p_batch_id, p_kind, p_form_id, p_created_by, job_count);
  insert into public.mail_queue(batch_id, form_id, organization_id, recipient_email, recipient_name, subject, body_text)
  select p_batch_id, p_form_id, (job ->> 'organization_id')::uuid,
    lower(btrim(job ->> 'recipient_email')), btrim(job ->> 'recipient_name'), job ->> 'subject', job ->> 'body_text'
  from jsonb_array_elements(p_jobs) job;
  return job_count;
end;
$$;
revoke all on function public.enqueue_form_mail_batch(uuid, uuid, uuid, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.enqueue_form_mail_batch(uuid, uuid, uuid, jsonb, text, boolean) to service_role;


-- A personal capability may restore only files already attached to its own
-- response. Unsubmitted drafts continue to require the uploader's browser ID.
create or replace function public.can_restore_personal_upload(p_form_id uuid, p_token uuid, p_path text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare link public.form_personal_links%rowtype;
begin
  link := public.resolve_form_personal_link(p_form_id, p_token);
  return exists (
    select 1 from public.responses r
    join public.response_file_references ref on ref.response_id = r.id and ref.form_id = r.form_id
    where r.form_id = p_form_id and r.browser_id = public.browser_capability_hash(link.browser_id)
      and ref.object_path = p_path
  );
end;
$$;
revoke all on function public.can_restore_personal_upload(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.can_restore_personal_upload(uuid, uuid, text) to service_role;

-- Site settings. All bootstrap DDL stays in the same transaction.

create or replace function public.valid_embedding_origins(origins text[])
returns boolean language plpgsql immutable set search_path = '' as $$
declare origin text; port text;
begin
  if origins is null or cardinality(origins) > 50 then return false; end if;
  foreach origin in array origins loop
    if origin is null or length(origin) > 300 or origin !~ '^https?://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*(:[1-9][0-9]{0,4})?$' then return false; end if;
    port := substring(origin from ':([0-9]+)$');
    if port is not null and port::integer > 65535 then return false; end if;
  end loop;
  return cardinality(origins) = (select count(distinct item) from unnest(origins) item);
end;
$$;
create table if not exists public.form_embedding_settings (
  id smallint primary key default 1 check (id = 1),
  allowed_origins text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint valid_form_embedding_origins check (public.valid_embedding_origins(allowed_origins))
);
insert into public.form_embedding_settings(id) values(1) on conflict do nothing;
alter table public.form_embedding_settings enable row level security;
revoke all on public.form_embedding_settings from anon, authenticated;
grant select on public.form_embedding_settings to authenticated;
grant all on public.form_embedding_settings to service_role;
create policy embedding_settings_admin_read on public.form_embedding_settings for select to authenticated
using ((select public.request_is_enabled()) and (select public.request_role()) = 'admin');

create or replace function public.set_form_embedding_origins(p_origins text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.request_is_enabled() or public.request_role() <> 'admin' then
    raise exception 'Изменять разрешённые сайты может только администратор' using errcode='42501';
  end if;
  if not public.valid_embedding_origins(p_origins) then
    raise exception 'Укажите до 50 уникальных сайтов в формате https://example.ru, без путей и подстановок' using errcode='22023';
  end if;
  update public.form_embedding_settings set allowed_origins=p_origins, updated_at=now(), updated_by=auth.uid() where id=1;
  return (select jsonb_build_object('allowed_origins', allowed_origins, 'updated_at', updated_at) from public.form_embedding_settings where id=1);
end;
$$;
revoke all on function public.set_form_embedding_origins(text[]) from public, anon;
grant execute on function public.set_form_embedding_origins(text[]) to authenticated;

-- Nginx reads this header in an internal auth_request before serving public HTML.
-- No origin/referrer supplied by a visitor influences the policy.
create or replace function public.get_form_embedding_policy()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare origins text[]; policy text;
begin
  select allowed_origins into origins from public.form_embedding_settings where id=1;
  policy := case when coalesce(cardinality(origins),0)=0 then '''none''' else array_to_string(origins,' ') end;
  perform set_config('response.headers',jsonb_build_array(jsonb_build_object('X-Form-Frame-Ancestors',policy),jsonb_build_object('Cache-Control','no-store'))::text,true);
  return jsonb_build_object('frameAncestors',policy);
end;
$$;
revoke all on function public.get_form_embedding_policy() from public;
grant execute on function public.get_form_embedding_policy() to anon, authenticated, service_role;

alter table public.app_branding add column if not exists favicon_path text;
alter table public.app_branding add column if not exists favicon_mime text;
alter table public.app_branding add constraint app_branding_favicon_valid check (
  (favicon_path is null and favicon_mime is null) or
  (favicon_path is not null and favicon_mime is not null and favicon_path ~ '^favicon-[0-9a-f-]{36}\.(png|svg|ico)$' and favicon_mime in ('image/png','image/svg+xml','image/x-icon'))
);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('app-favicons','app-favicons',true,1048576,array['image/png','image/svg+xml','image/x-icon'])
on conflict(id) do update set public=true,file_size_limit=1048576,allowed_mime_types=excluded.allowed_mime_types;
-- Favicon writes use service_role after content validation. No browser upload policy.
create or replace function public.get_app_favicon()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('path',favicon_path,'mime',favicon_mime,'updatedAt',updated_at) from public.app_branding where id=1;
$$;
revoke all on function public.get_app_favicon() from public;
grant execute on function public.get_app_favicon() to anon, authenticated, service_role;
create or replace function public.set_app_favicon(p_path text, p_mime text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare previous text;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and not is_disabled) then
    raise exception 'Только администратор может изменить favicon' using errcode='42501';
  end if;
  select favicon_path into previous from public.app_branding where id=1 for update;
  update public.app_branding set favicon_path=p_path,favicon_mime=p_mime,updated_at=now(),updated_by=p_actor where id=1;
  return public.get_app_favicon() || jsonb_build_object('previousPath',previous);
end;
$$;
revoke all on function public.set_app_favicon(text,text,uuid) from public,anon,authenticated;
grant execute on function public.set_app_favicon(text,text,uuid) to service_role;



notify pgrst, 'reload schema';
-- Preserve the local uploader capability while binding a personal response.
create or replace function public.reserve_personal_survey_upload(
  p_form_id uuid, p_browser_id uuid, p_client_hash text, p_size bigint, p_extension text, p_token uuid
)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  link public.form_personal_links%rowtype;
  reserved_path text;
begin
  link := public.resolve_form_personal_link(p_form_id, p_token);
  reserved_path := public.reserve_survey_upload(p_form_id, p_browser_id, p_client_hash, p_size, p_extension);
  update public.survey_upload_reservations
  set response_browser_hash = public.browser_capability_hash(link.browser_id)
  where object_path = reserved_path;
  return reserved_path;
end;
$$;
revoke all on function public.reserve_personal_survey_upload(uuid,uuid,text,bigint,text,uuid) from public, anon, authenticated;
grant execute on function public.reserve_personal_survey_upload(uuid,uuid,text,bigint,text,uuid) to service_role;

-- Restored drafts from earlier releases need the same association. Both the
-- uploader browser and the personal token must be valid; a path is insufficient.
create or replace function public.bind_personal_survey_upload(
  p_form_id uuid, p_token uuid, p_browser_id uuid, p_path text
)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare link public.form_personal_links%rowtype;
begin
  link := public.resolve_form_personal_link(p_form_id, p_token);
  update public.survey_upload_reservations r
  set response_browser_hash = public.browser_capability_hash(link.browser_id)
  where r.object_path = p_path and r.form_id = p_form_id
    and r.browser_hash = public.browser_capability_hash(p_browser_id)
    and not r.cleanup_claimed and (r.attached or r.expires_at > clock_timestamp());
  return found;
end;
$$;
revoke all on function public.bind_personal_survey_upload(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.bind_personal_survey_upload(uuid,uuid,uuid,text) to service_role;


revoke all on function public.survey_file_path(text,uuid) from public,anon,authenticated;
revoke all on function public.normalize_survey_file_value(jsonb,uuid,integer) from public,anon,authenticated;
revoke all on function public.survey_response_value_is_valid(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.prepare_response_files() from public,anon,authenticated;
revoke all on function public.claim_survey_file_deletions(text[]) from public,anon,authenticated;
grant execute on function public.claim_survey_file_deletions(text[]) to service_role;
revoke all on function public.delete_form_responses_with_files(uuid,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.delete_form_responses_with_files(uuid,uuid[],uuid) to service_role;
create trigger responses_prepare_files before insert or update of data,form_id on public.responses
for each row execute function public.prepare_response_files();
revoke insert(form_id,submission_id,data) on public.responses from anon,authenticated;

-- A known form UUID is required. Never grant anonymous table enumeration.
create or replace function public.get_public_form(p_form_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', f.id, 'title', f.title, 'form_type', f.form_type, 'form_reason', f.form_reason,
    'schema', f.schema, 'theme', f.theme, 'is_public', f.is_public,
    'deadline_at', f.deadline_at, 'max_responses', f.max_responses,
    'responses_count', f.responses_count, 'allow_response_editing', f.allow_response_editing,
    'organization_types', f.organization_types, 'personal_links_enabled', f.personal_links_enabled,
    'revision', f.revision, 'created_at', f.created_at
  )
  from public.forms f
  where f.id = p_form_id and public.is_public_active_form(f.id)
    and f.responses_count < least(coalesce(f.max_responses, 100000), 100000);
$$;
revoke all on function public.get_public_form(uuid) from public;
grant execute on function public.get_public_form(uuid) to anon, authenticated, service_role;

-- These are author-selected SurveyJS rules, not an application-wide allowlist.
-- Keep the built-in categories aligned with survey-core's acceptedFileCategories.
create or replace function public.survey_question_upload_rules(p_question jsonb)
returns text[] language plpgsql immutable set search_path = '' as $$
declare rules text[] := '{}'::text[]; item jsonb; category text; raw_types text;
begin
  if jsonb_typeof(p_question->'acceptedTypes')='array' then
    for item in select * from jsonb_array_elements(p_question->'acceptedTypes') loop
      if jsonb_typeof(item)<>'string' then return array['!invalid']; end if;
      rules:=rules || string_to_array(lower(item #>> '{}'),',');
    end loop;
  elsif jsonb_typeof(p_question->'acceptedTypes')='string' then
    rules:=string_to_array(lower(p_question->>'acceptedTypes'),',');
  elsif p_question ? 'acceptedTypes' and p_question->'acceptedTypes'<>'null'::jsonb then
    return array['!invalid'];
  end if;
  if jsonb_typeof(p_question->'acceptedCategories')='array' then
    for category in select value from jsonb_array_elements_text(p_question->'acceptedCategories') loop
      raw_types:=case category
        when 'image' then '.png,.jpg,.jpeg,.gif,.bmp,.tiff,.svg'
        when 'video' then '.mp4,.avi,.mov,.wmv,.flv,.mkv,.webm'
        when 'audio' then '.mp3,.wav,.aac,.ogg,.wma,.flac'
        when 'document' then '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.rtf,.odt'
        when 'archive' then '.zip,.rar,.7z,.tar,.gz'
        when 'custom' then '' else '!invalid' end;
      rules:=rules || string_to_array(raw_types,',');
    end loop;
  end if;
  return array(select distinct btrim(rule) from unnest(rules) rule where btrim(rule)<>'');
end;
$$;
revoke all on function public.survey_question_upload_rules(jsonb) from public, anon, authenticated;

create or replace function public.survey_question_upload_type_allowed(p_question jsonb, p_file_name text, p_mime_type text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  rules text[]:=public.survey_question_upload_rules(p_question); rule text;
  file_name text:=lower(coalesce(p_file_name,''));
  mime_type text:=lower(btrim(split_part(coalesce(p_mime_type,''),';',1)));
  -- A claimed common MIME must also agree with its filename extension. Types
  -- outside this consistency map still follow the author's exact/wildcard rule;
  -- MIME values are declarations, not content-signature validation.
  known_types jsonb:='{
    "application/pdf":[".pdf"],"text/plain":[".txt",".text",".log"],"text/csv":[".csv"],
    "application/msword":[".doc",".dot"],"application/vnd.ms-excel":[".xls",".xlt"],
    "application/vnd.ms-powerpoint":[".ppt",".pps",".pot"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":[".docx"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":[".xlsx"],
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":[".pptx"],
    "application/vnd.oasis.opendocument.text":[".odt"],"application/vnd.oasis.opendocument.spreadsheet":[".ods"],
    "application/vnd.oasis.opendocument.presentation":[".odp"],"application/rtf":[".rtf"],"text/rtf":[".rtf"],
    "image/png":[".png"],"image/jpeg":[".jpg",".jpeg",".jpe"],"image/gif":[".gif"],
    "image/webp":[".webp"],"image/bmp":[".bmp"],"image/tiff":[".tif",".tiff"],
    "image/svg+xml":[".svg",".svgz"],"image/avif":[".avif"],"image/heic":[".heic"],"image/heif":[".heif"],
    "application/zip":[".zip"],"application/x-zip-compressed":[".zip"],
    "application/x-7z-compressed":[".7z"],"application/vnd.rar":[".rar"],"application/x-rar-compressed":[".rar"],
    "application/gzip":[".gz"],"application/x-gzip":[".gz"],"application/x-tar":[".tar"],
    "audio/mpeg":[".mp3"],"audio/wav":[".wav"],"audio/ogg":[".ogg",".oga"],
    "video/mp4":[".mp4",".m4v"],"video/webm":[".webm"],"video/quicktime":[".mov"],
    "text/html":[".html",".htm"],"application/json":[".json"],"application/xml":[".xml"],"text/xml":[".xml"]
  }';
begin
  if cardinality(rules)=0 then return true; end if;
  foreach rule in array rules loop
    if rule in ('*','*/*') then return true; end if;
    if left(rule,1)='.' and right(file_name,length(rule))=rule then return true; end if;
    if rule=mime_type or (rule ~ '^[a-z0-9!#$&^_.+-]+/\*$' and split_part(rule,'/',1)=split_part(mime_type,'/',1)) then
      if not (known_types ? mime_type) or exists(
        select 1 from jsonb_array_elements_text(known_types->mime_type) extension where right(file_name,length(extension))=extension
      ) then return true; end if;
    end if;
    -- Some browsers omit the type for office documents. A known extension can
    -- establish the MIME only when no more specific type was supplied.
    if mime_type in ('','application/octet-stream') and known_types ? rule and exists(
      select 1 from jsonb_array_elements_text(known_types->rule) extension where right(file_name,length(extension))=extension
    ) then return true; end if;
  end loop;
  return false;
end;
$$;
revoke all on function public.survey_question_upload_type_allowed(jsonb,text,text) from public, anon, authenticated;

-- Traverse only schema containers, including matrix file columns, repeated
-- panel templates and signature questions sharing SurveyJS's upload handler.
-- Runtime names and valueName aliases resolve to stored rules.
create or replace function public.survey_upload_questions(p_schema jsonb, p_depth integer default 0)
returns setof jsonb language plpgsql immutable set search_path = '' as $$
declare child jsonb; container text; cell_type text;
begin
  if p_depth>32 then raise exception 'Структура формы превышает допустимую глубину' using errcode='22023'; end if;
  if p_schema->>'type' in ('file','signaturepad') then return next p_schema; end if;
  foreach container in array array['pages','elements','templateElements','detailElements'] loop
    for child in select * from jsonb_array_elements(case when jsonb_typeof(p_schema->container)='array' then p_schema->container else '[]'::jsonb end) loop
      return query select * from public.survey_upload_questions(child,p_depth+1);
    end loop;
  end loop;
  if p_schema->>'type' in ('matrixdynamic','matrixdropdown') then
    for child in select * from jsonb_array_elements(case when jsonb_typeof(p_schema->'columns')='array' then p_schema->'columns' else '[]'::jsonb end) loop
      cell_type:=coalesce(nullif(child->>'cellType','default'),p_schema->>'cellType','dropdown');
      return query select * from public.survey_upload_questions(child || jsonb_build_object('type',cell_type),p_depth+1);
    end loop;
  end if;
end;
$$;
revoke all on function public.survey_upload_questions(jsonb,integer) from public, anon, authenticated;

create or replace function public.survey_upload_type_allowed(p_form_id uuid, p_question_name text, p_file_name text, p_mime_type text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare form_schema jsonb; question jsonb;
begin
  select schema into form_schema from public.forms where id=p_form_id;
  if not found then return false; end if;
  for question in select * from public.survey_upload_questions(form_schema) loop
    if nullif(p_question_name,'') is null then
      -- Legacy clients may omit the name only when the author has no type
      -- restriction anywhere. They cannot bypass a restricted sibling question.
      if cardinality(public.survey_question_upload_rules(question))>0 then return false; end if;
    elsif p_question_name in (question->>'name',question->>'valueName') then
      -- Separate repeated panels can legitimately share a local file name.
      -- Accept a candidate here; the response trigger checks its exact binding.
      if public.survey_question_upload_type_allowed(question,p_file_name,p_mime_type) then return true; end if;
    end if;
  end loop;
  return nullif(p_question_name,'') is null;
end;
$$;
revoke all on function public.survey_upload_type_allowed(uuid,text,text,text) from public, anon, authenticated;

create or replace function public.assert_survey_upload_type(p_form_id uuid, p_question_name text, p_file_name text, p_mime_type text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.survey_upload_type_allowed(p_form_id,p_question_name,p_file_name,p_mime_type) then
    raise exception 'Тип файла не разрешён автором вопроса' using errcode='22023';
  end if;
  return true;
end;
$$;
revoke all on function public.assert_survey_upload_type(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.assert_survey_upload_type(uuid,text,text,text) to service_role;

-- Canonicalize only the suffix used by the client's opaque Storage path. Keep
-- the complete original filename when evaluating the author's acceptedTypes.
create or replace function public.survey_upload_extension(p_file_name text)
returns text language plpgsql immutable set search_path = '' as $$
declare clean_name text; extension text;
begin
  clean_name:=regexp_replace(coalesce(p_file_name,''),'^.*[\\/]','');
  extension:=regexp_replace(coalesce(substring(clean_name from '[.][^.]*$'),''),'[^a-zA-Z0-9.]','','g');
  return case when extension ~ '^[.][a-zA-Z0-9]{1,12}$' then extension else '' end;
end;
$$;
revoke all on function public.survey_upload_extension(text) from public, anon, authenticated;

create or replace function public.enforce_survey_upload_type()
returns trigger language plpgsql security definer set search_path = '' as $$
declare form_id uuid; file_name text; path_extension text;
begin
  if new.bucket_id<>'survey-files' then return new; end if;
  begin form_id:=split_part(new.name,'/',2)::uuid;
  exception when invalid_text_representation then
    raise exception 'Некорректный путь файла' using errcode='22023';
  end;
  file_name:=coalesce(nullif(new.user_metadata->>'fileName',''),split_part(new.name,'/',3));
  path_extension:=coalesce(substring(lower(split_part(new.name,'/',3)) from '[.][^.]+$'),'');
  if (nullif(new.user_metadata->>'fileName','') is not null and path_extension<>lower(public.survey_upload_extension(file_name)))
    or not public.survey_upload_type_allowed(form_id,new.user_metadata->>'questionName',file_name,
      coalesce(nullif(new.metadata->>'mimetype',''),new.user_metadata->>'mimeType','')) then
    raise exception 'Тип файла не разрешён автором вопроса' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_survey_upload_type() from public, anon, authenticated;
create or replace trigger survey_upload_type_policy before insert or update of metadata,user_metadata,name,bucket_id on storage.objects
for each row execute function public.enforce_survey_upload_type();

-- Upload metadata is supplied by the caller. Validate against the question that
-- actually receives the file as well, so another unrestricted field cannot act
-- as a type-validation bypass. Existing unchanged attachments remain editable.
create or replace function public.enforce_response_upload_types()
returns trigger language plpgsql security definer set search_path = '' as $$
declare form_schema jsonb; binding record; normalized jsonb; previous jsonb; path text; object_record record;
begin
  select schema into form_schema from public.forms where id=new.form_id;
  for binding in select * from public.survey_response_bindings(form_schema,new.data) where question->>'type'='file' loop
    if binding.value is null or binding.value in ('null'::jsonb,'""'::jsonb) then continue; end if;
    normalized:=public.normalize_survey_file_value(binding.value,new.form_id);
    previous:=null;
    if tg_op='UPDATE' and old.form_id=new.form_id and old.browser_id is not distinct from new.browser_id then
      previous:=public.normalize_survey_file_value(old.data #> binding.value_path,old.form_id);
    end if;
    for path in select distinct scalar #>> '{}' from jsonb_path_query(normalized,'$.** ? (@.type() == "string")') scalar
      where (scalar #>> '{}') ~* '^(public|[0-9a-f-]{36})/[0-9a-f-]{36}/[^/]+$'
    loop
      if previous is not null and jsonb_path_exists(previous,'$.** ? (@ == $path)',jsonb_build_object('path',path)) then continue; end if;
      select name,metadata,user_metadata into object_record from storage.objects where bucket_id='survey-files' and name=path;
      if not found or not public.survey_question_upload_type_allowed(binding.question,
        coalesce(nullif(object_record.user_metadata->>'fileName',''),split_part(path,'/',3)),
        coalesce(nullif(object_record.metadata->>'mimetype',''),object_record.user_metadata->>'mimeType','')) then
        raise exception 'Тип файла не разрешён автором вопроса' using errcode='22023';
      end if;
    end loop;
  end loop;
  return new;
end;
$$;
revoke all on function public.enforce_response_upload_types() from public, anon, authenticated;
create or replace trigger responses_upload_type_policy before insert or update of data,form_id,browser_id on public.responses
for each row execute function public.enforce_response_upload_types();

-- Automations and personal notifications
create schema survey_automation;
revoke all on schema survey_automation from public, anon, authenticated;

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  form_id uuid references public.forms(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  enabled boolean not null default true,
  event_type text not null check (event_type in ('response_received','response_updated','response_count',
    'matching_count','matching_share','inactivity','date','recurring')),
  threshold numeric,
  interval_minutes integer,
  scheduled_at timestamptz,
  match_mode text not null check (match_mode in ('all','any')),
  conditions jsonb not null,
  action_type text not null default 'email' check (action_type = 'email'),
  action_config jsonb not null,
  event_version integer not null default 1,
  delivery_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index automation_rules_user_list on public.automation_rules (user_id, created_at desc, id desc);
create index automation_rules_form on public.automation_rules (form_id) where form_id is not null;
create index automation_rules_all_forms on public.automation_rules (user_id) where form_id is null and enabled;

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  form_id uuid not null,
  form_title text not null,
  response_id uuid,
  event_version integer not null,
  delivery_version integer not null,
  event_key text not null,
  status text not null default 'pending' check (status in ('pending','queued','succeeded','failed','cancelled')),
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  unique (rule_id, event_version, form_id, event_key)
);
create index automation_runs_history on public.automation_runs (rule_id, created_at desc, id desc);
create index automation_runs_pending on public.automation_runs (created_at, id) where status='pending';
create index automation_runs_form_active on public.automation_runs (form_id) where status in ('pending','queued');

create table survey_automation.targets (
  rule_id uuid references public.automation_rules(id) on delete cascade,
  form_id uuid references public.forms(id) on delete cascade,
  complete boolean not null default false,
  matching_count integer not null,
  count_ready boolean not null,
  count_cursor_at timestamptz,
  count_cursor_id uuid,
  check_at timestamptz,
  check_response_id uuid,
  last_received_at timestamptz,
  gap_key text not null default 'none',
  next_run_at timestamptz,
  primary key (rule_id, form_id)
);
create index automation_targets_form on survey_automation.targets (form_id, rule_id);
create index automation_targets_due on survey_automation.targets (next_run_at, rule_id, form_id) where next_run_at is not null;
create index automation_targets_check on survey_automation.targets (check_at, rule_id, form_id) where check_at is not null;

alter table survey_automation.targets add column schedule_slot_at timestamptz;
alter table public.automation_runs add column cancelled_count integer not null default 0;

-- One counter per owner survives rule deletion and rolls over without a cleanup job.
create table survey_automation.mail_usage (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  hour_start timestamptz not null,
  recipient_count integer not null check (recipient_count between 1 and 500)
);

revoke all on survey_automation.mail_usage from public, anon, authenticated;

create table survey_automation.payloads (
  run_id uuid primary key references public.automation_runs(id) on delete cascade,
  payload jsonb not null
);

create table survey_automation.form_deadlines (
  form_id uuid primary key references public.forms(id) on delete cascade,
  due_at timestamptz not null
);
create index automation_form_deadlines_due on survey_automation.form_deadlines (due_at, form_id);

create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  muted_categories text[] not null default array['response_received']
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('response_received','response_updated','automation_triggered',
    'automation_succeeded','automation_failed','form_status')),
  event_key text not null,
  title text not null,
  message text not null,
  form_id uuid,
  response_id uuid,
  rule_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  unique (user_id, event_key)
);
create index notifications_user_list on public.notifications (user_id, created_at desc, id desc);
create index notifications_user_category on public.notifications (user_id, category, created_at desc, id desc);
create index notifications_user_unread on public.notifications (user_id, created_at desc, id desc) where read_at is null;

alter table public.automation_rules enable row level security;
alter table public.automation_runs enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;
revoke all on public.automation_rules, public.automation_runs, public.notification_preferences, public.notifications
  from public, anon, authenticated;
grant select on public.automation_rules, public.automation_runs, public.notification_preferences, public.notifications to authenticated;
create policy automation_rules_owner on public.automation_rules for select to authenticated
  using (user_id=(select auth.uid()) and (select public.request_is_enabled()));
create policy automation_runs_owner on public.automation_runs for select to authenticated
  using (exists (select from public.automation_rules r where r.id=rule_id));
create policy notification_preferences_owner on public.notification_preferences for select to authenticated
  using (user_id=(select auth.uid()) and (select public.request_is_enabled()));
create policy notifications_owner on public.notifications for select to authenticated
  using (user_id=(select auth.uid()) and (select public.request_is_enabled())
    and category not in ('automation_triggered', 'automation_succeeded'));

do $$
begin
  if exists (select from pg_publication where pubname='supabase_realtime' and not puballtables) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

create or replace function survey_automation.notify(
  p_user_id uuid, p_category text, p_key text, p_title text, p_message text,
  p_form_id uuid default null, p_response_id uuid default null, p_rule_id uuid default null
)
returns void language sql set search_path = '' as $$
  insert into public.notifications(user_id,category,event_key,title,message,form_id,response_id,rule_id)
  select p_user_id,p_category,p_key,p_title,p_message,p_form_id,p_response_id,p_rule_id
  from public.profiles p left join public.notification_preferences n on n.user_id=p.id
  where p.id=p_user_id and not p.is_disabled
    and not (coalesce(n.muted_categories, array['response_received']) @> array[p_category])
  on conflict (user_id,event_key) do nothing;
$$;

create or replace function public.save_notification_preferences(p_muted_categories text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Ignore retired categories submitted by a tab opened before the update.
  p_muted_categories := array_remove(array_remove(p_muted_categories,'automation_triggered'),'automation_succeeded');
  if p_muted_categories is null or cardinality(p_muted_categories)>4 or array_position(p_muted_categories,null) is not null
    or not p_muted_categories <@ array['response_received','response_updated','automation_failed','form_status'] then
    raise exception 'Неизвестный тип уведомлений' using errcode='22023';
  end if;
  if not public.request_is_enabled() then raise exception 'Нет доступа' using errcode='42501'; end if;
  insert into public.notification_preferences(user_id,muted_categories) values(auth.uid(),p_muted_categories)
  on conflict (user_id) do update set muted_categories=excluded.muted_categories;
end;
$$;

-- Layout panels are transparent. A repeating panel adds a level in response data.
create function survey_automation.localized_text(p_text jsonb)
returns text language sql immutable set search_path = '' as $$
  select case jsonb_typeof(p_text)
    when 'string' then nullif(btrim(p_text #>> '{}'),'')
    when 'object' then coalesce(nullif(btrim(p_text->>'ru'),''),nullif(btrim(p_text->>'default'),''))
  end;
$$;

create or replace function survey_automation.form_fields(p_schema jsonb)
returns table(path text[], label text, question jsonb)
language sql immutable set search_path = '' as $$
  with recursive nodes(node,parent_path,parent_label,depth) as (
    select p_schema,'{}'::text[],''::text,0
    union all
    select children.node,
      case when n.node->>'type'='paneldynamic' then n.parent_path || field.key else n.parent_path end,
      case when n.node->>'type'='paneldynamic' then n.parent_label || field.label || ' / ' else n.parent_label end,
      n.depth+1
    from nodes n
    cross join lateral (select coalesce(nullif(n.node->>'valueName',''),n.node->>'name') as key,
      coalesce(survey_automation.localized_text(n.node->'title'),n.node->>'name') as label) field
    cross join lateral jsonb_array_elements(
      (case when jsonb_typeof(n.node->'pages')='array' then n.node->'pages' else '[]'::jsonb end) ||
      (case when jsonb_typeof(n.node->'elements')='array' then n.node->'elements' else '[]'::jsonb end) ||
      (case when n.node->>'type'='paneldynamic' and jsonb_typeof(n.node->'templateElements')='array'
        then n.node->'templateElements' else '[]'::jsonb end)
    ) children(node)
    where n.depth<32
  )
  select distinct on (1) parent_path || coalesce(nullif(node->>'valueName',''),node->>'name'),
    parent_label || coalesce(survey_automation.localized_text(node->'title'),node->>'name'),node
  from nodes where char_length(node->>'name')>0 and node->>'type' in (
    'text','email','comment','boolean','rating','slider','integer','number','float','date','datetime','time','phone',
    'dropdown','radiogroup','checkbox','tagbox','imagepicker','ranking','organization')
  order by 1,depth,node;
$$;

create function public.automation_form_fields(p_form_id uuid)
returns table(path text[],label text,type text,choices jsonb,input_type text)
language sql stable security definer set search_path = '' as $$
  select q.path,q.label,q.question->>'type',case when q.question->>'type'='boolean' then jsonb_build_array(
    jsonb_build_object('value',coalesce(nullif(q.question->'valueTrue','null'::jsonb),'true'::jsonb),'text',coalesce(q.question->'labelTrue','"Да"'::jsonb)),
    jsonb_build_object('value',coalesce(nullif(q.question->'valueFalse','null'::jsonb),'false'::jsonb),'text',coalesce(q.question->'labelFalse','"Нет"'::jsonb)))
    else q.question->'choices' end,q.question->>'inputType'
  from public.forms f cross join lateral survey_automation.form_fields(f.schema) q
  where f.id=p_form_id and f.author_id=auth.uid() and f.form_type<>'template' and public.request_is_enabled()
  order by q.label,q.path;
$$;

create function survey_automation.answer_values(p_value jsonb,p_path text[])
returns setof jsonb language plpgsql immutable set search_path = '' as $$
begin
  if cardinality(p_path)=0 then
    if p_value is not null and p_value<>'null'::jsonb then return next p_value; end if;
  elsif jsonb_typeof(p_value)='object' then
    return query select * from survey_automation.answer_values(p_value->p_path[1],p_path[2:]);
  elsif jsonb_typeof(p_value)='array' then
    return query select v from jsonb_array_elements(p_value) e cross join lateral survey_automation.answer_values(e,p_path) v;
  end if;
end;
$$;

create function survey_automation.number(p_value jsonb)
returns numeric language plpgsql immutable set search_path = '' as $$
declare value_text text;
begin
  if jsonb_typeof(p_value) not in ('number','string') then return null; end if;
  value_text:=btrim(p_value #>> '{}');
  if value_text ~ '^[+-]?[0-9]{1,30}([.,][0-9]{1,30})?$' then
    return replace(value_text,',','.')::numeric;
  end if;
  return null;
end;
$$;

create function survey_automation.condition_matches(p_answer jsonb,p_condition jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  case p_condition->>'op'
    when 'eq' then
      if jsonb_typeof(p_answer)='array' then
        if jsonb_array_length(p_answer)<>1 then return false; end if;
        p_answer:=p_answer->0;
      end if;
      return jsonb_typeof(p_answer) in ('string','number','boolean') and p_answer #>> '{}' = p_condition->>'value';
    when 'gt' then return survey_automation.number(p_answer)>survey_automation.number(p_condition->'value');
    when 'lt' then return survey_automation.number(p_answer)<survey_automation.number(p_condition->'value');
    when 'contains' then return jsonb_typeof(p_answer)='string' and strpos(lower(p_answer #>> '{}'),lower(p_condition->>'value'))>0;
    when 'any_of' then return exists (
      select from jsonb_array_elements(p_condition->'value') v
      join jsonb_array_elements(case when jsonb_typeof(p_answer)='array' then p_answer else jsonb_build_array(p_answer) end) a
        on a #>> '{}'=v #>> '{}');
    when 'all_of' then return not exists (
      select from jsonb_array_elements(p_condition->'value') v where not exists (
        select from jsonb_array_elements(case when jsonb_typeof(p_answer)='array' then p_answer else jsonb_build_array(p_answer) end) a
        where a #>> '{}'=v #>> '{}'));
    else return false;
  end case;
end;
$$;

create function survey_automation.matches(p_data jsonb,p_conditions jsonb,p_mode text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  condition jsonb;
  matched boolean;
  match_any boolean := p_mode is not distinct from 'any';
begin
  if p_conditions='[]'::jsonb then return true; end if;
  if p_conditions is null then return false; end if;
  for condition in select value from jsonb_array_elements(p_conditions) loop
    select exists (
      select from survey_automation.answer_values(p_data,array(select jsonb_array_elements_text(condition->'path'))) answer
      where survey_automation.condition_matches(answer,condition)
    ) into matched;
    if matched=match_any then return match_any; end if;
  end loop;
  return not match_any;
end;
$$;

create function survey_automation.email_address(p_value text)
returns text language sql immutable set search_path = '' as $$
  select case when char_length(btrim(p_value)) between 3 and 254
    and btrim(p_value) ~ '^[[:alnum:].!#$%&''*+/=?^_{|}~-]+@[[:alnum:]]([[:alnum:]-]*[[:alnum:]])?(\.[[:alnum:]]([[:alnum:]-]*[[:alnum:]])?)+$'
    and split_part(btrim(p_value),'@',1) !~ '(^\.|\.\.|\.$)'
    then lower(btrim(p_value)) end;
$$;

create function survey_automation.schedule_slot(p_start timestamptz,p_interval integer,p_now timestamptz)
returns timestamptz language sql immutable set search_path = '' as $$
  select p_start + greatest(0,floor(extract(epoch from p_now-p_start)/(p_interval*60)))::integer * make_interval(mins=>p_interval);
$$;

create function survey_automation.allowed_recipient_path(p_schema jsonb,p_action jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_action->>'mode'='summary' and jsonb_array_length(p_action->'recipients')<50
    and exists(select from survey_automation.form_fields(p_schema) q
      where cardinality(q.path)=1 and to_jsonb(q.path)=p_action->'recipientPath'
        and q.question->>'type'='organization'),false);
$$;

create or replace function survey_automation.seed_targets(p_rule public.automation_rules,p_only_form uuid default null)
returns void language sql set search_path = '' as $$
  insert into survey_automation.targets(rule_id,form_id,next_run_at,last_received_at,gap_key,matching_count,count_ready)
  select p_rule.id,f.id,
    case p_rule.event_type
      when 'date' then case when p_rule.scheduled_at>=f.created_at then p_rule.scheduled_at end
      when 'recurring' then case when f.created_at<=p_rule.scheduled_at then p_rule.scheduled_at
        else survey_automation.schedule_slot(p_rule.scheduled_at,p_rule.interval_minutes,f.created_at) + make_interval(mins=>p_rule.interval_minutes) end
      when 'inactivity' then greatest(now(),f.created_at,latest.created_at)+make_interval(mins=>p_rule.interval_minutes)
    end,
    latest.created_at,coalesce(latest.id::text,'none'),0,
    p_rule.conditions='[]'::jsonb or p_rule.event_type not in ('response_count','matching_count','matching_share')
  from public.forms f
  left join lateral (
    select r.id,r.created_at from public.responses r
    where p_rule.event_type='inactivity' and r.form_id=f.id order by r.created_at desc,r.id desc limit 1
  ) latest on true
  where p_rule.enabled and f.author_id=p_rule.user_id and f.form_type<>'template'
    and (p_rule.form_id is null or f.id=p_rule.form_id) and (p_only_form is null or f.id=p_only_form)
  on conflict (rule_id,form_id) do update set
    matching_count=excluded.matching_count,
    count_ready=excluded.count_ready,
    count_cursor_at=null,
    count_cursor_id=null,
    schedule_slot_at=null,
    check_at=null,
    check_response_id=null,
    last_received_at=greatest(targets.last_received_at,excluded.last_received_at),
    gap_key=case when targets.last_received_at is null or
      (excluded.last_received_at,excluded.gap_key)>(targets.last_received_at,targets.gap_key)
      then excluded.gap_key else targets.gap_key end,
    next_run_at=case when targets.complete then null
      when p_rule.event_type='inactivity' and targets.next_run_at is null
        and (excluded.last_received_at is null or (excluded.last_received_at,excluded.gap_key)
          <=(targets.last_received_at,targets.gap_key)) then null
      when p_rule.event_type='recurring' then coalesce(targets.next_run_at,excluded.next_run_at)
      else excluded.next_run_at end;
$$;

create function survey_automation.resume_targets(p_rule public.automation_rules)
returns void language plpgsql set search_path = '' as $$
begin
  perform survey_automation.seed_targets(p_rule);
  if p_rule.event_type='recurring' then
    update survey_automation.targets set next_run_at=
      survey_automation.schedule_slot(p_rule.scheduled_at,p_rule.interval_minutes,now())+make_interval(mins=>p_rule.interval_minutes)
    where rule_id=p_rule.id and next_run_at<=now();
  end if;
end;
$$;

create or replace function public.save_automation_rule(
  p_id uuid,p_form_id uuid,p_name text,p_description text,p_enabled boolean,p_event_type text,
  p_threshold numeric,p_interval_minutes integer,p_scheduled_at timestamptz,p_match_mode text,
  p_conditions jsonb,p_action jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  schema_json jsonb;
  previous public.automation_rules;
  saved public.automation_rules;
  event_changed boolean;
  condition jsonb;
  recipients text[];
begin
  if not public.request_is_enabled() then raise exception 'Нет доступа' using errcode='42501'; end if;
  if p_form_id is not null then
    select f.schema into schema_json from public.forms f
    where f.id=p_form_id and f.author_id=actor and f.form_type<>'template';
    if not found then raise exception 'Выберите свою форму' using errcode='42501'; end if;
  end if;

  p_name:=btrim(p_name,E' \t\n\r\f\013');
  p_description:=coalesce(btrim(p_description,E' \t\n\r\f\013'),'');
  if p_enabled is null or coalesce(char_length(btrim(p_name)),0) not between 1 and 120
    or char_length(p_description)>1000 or coalesce(p_event_type,'') not in (
      'response_received','response_updated','response_count','matching_count','matching_share','inactivity','date','recurring')
    or coalesce(p_match_mode,'') not in ('all','any') then
    raise exception 'Проверьте название и настройки события' using errcode='22023';
  end if;
  if (p_event_type in ('response_count','matching_count') and
      (p_threshold is null or p_threshold not between 1 and 100000 or trunc(p_threshold)<>p_threshold))
    or (p_event_type='matching_share' and (p_threshold is null or p_threshold not between 0.01 and 100))
    or (p_event_type in ('inactivity','recurring') and (p_interval_minutes is null or p_interval_minutes not between 1 and 525600))
    or (p_event_type='recurring' and p_interval_minutes<15)
    or (p_event_type in ('date','recurring') and (p_scheduled_at is null or not isfinite(p_scheduled_at)
      or p_scheduled_at not between '2000-01-01 UTC'::timestamptz and '2200-01-01 UTC'::timestamptz)) then
    raise exception 'Проверьте порог, дату или интервал' using errcode='22023';
  end if;
  if p_event_type not in ('response_count','matching_count','matching_share') then p_threshold:=null; end if;
  if p_event_type not in ('inactivity','recurring') then p_interval_minutes:=null; end if;
  if p_event_type not in ('date','recurring') then p_scheduled_at:=null; end if;

  if jsonb_typeof(p_conditions) is distinct from 'array' or octet_length(p_conditions::text)>30000 then
    raise exception 'Некорректные условия' using errcode='22023';
  end if;
  if jsonb_array_length(p_conditions)>12 then raise exception 'Можно добавить до 12 условий' using errcode='22023'; end if;
  for condition in select value from jsonb_array_elements(p_conditions) loop
    if jsonb_typeof(condition) is distinct from 'object' or jsonb_typeof(condition->'path') is distinct from 'array'
      or not exists (select from survey_automation.form_fields(schema_json) q where to_jsonb(q.path)=condition->'path') then
      raise exception 'Выберите вопрос для каждого условия' using errcode='22023';
    end if;
    case condition->>'op'
      when 'eq','contains' then
        if coalesce(jsonb_typeof(condition->'value'),'') not in ('string','number','boolean')
          or char_length(btrim(condition->>'value',E' \t\n\r\f\013')) not between 1 and 2000 then
          raise exception 'Укажите значение для сравнения' using errcode='22023';
        end if;
      when 'gt','lt' then
        if survey_automation.number(condition->'value') is null then raise exception 'Введите число для сравнения' using errcode='22023'; end if;
      when 'any_of','all_of' then
        if jsonb_typeof(condition->'value') is distinct from 'array' then raise exception 'Выберите варианты ответа' using errcode='22023'; end if;
        if jsonb_array_length(condition->'value') not between 1 and 50 or exists (
          select from jsonb_array_elements(condition->'value') v
          where jsonb_typeof(v) not in ('string','number','boolean') or char_length(v #>> '{}') not between 1 and 1000
        ) then raise exception 'Выберите от 1 до 50 вариантов ответа' using errcode='22023'; end if;
      else raise exception 'Неизвестное сравнение' using errcode='22023';
    end case;
  end loop;

  if jsonb_typeof(p_action) is distinct from 'object' or octet_length(p_action::text)>56000 or
    jsonb_typeof(p_action->'recipients') is distinct from 'array' or
    jsonb_typeof(p_action->'subject') is distinct from 'string' or coalesce(char_length(btrim(p_action->>'subject',E' \t\n\r\f\013')),0) not between 1 and 500 or
    jsonb_typeof(p_action->'body') is distinct from 'string' or coalesce(char_length(btrim(p_action->>'body',E' \t\n\r\f\013')),0) not between 1 and 10000 or
    coalesce(p_action->>'mode','') not in ('summary','full') then
    raise exception 'Проверьте параметры письма' using errcode='22023';
  end if;
  if jsonb_array_length(p_action->'recipients')>50 or exists (
    select from jsonb_array_elements(p_action->'recipients') r
    where jsonb_typeof(r)<>'string' or survey_automation.email_address(r #>> '{}') is null
  ) then raise exception 'Укажите до 50 корректных адресов электронной почты' using errcode='22023'; end if;
  select coalesce(array_agg(distinct survey_automation.email_address(r) order by survey_automation.email_address(r)),'{}')
    into recipients from jsonb_array_elements_text(p_action->'recipients') r;
  if p_action ? 'recipientPath' and p_action->'recipientPath'<>'null'::jsonb then
    if not survey_automation.allowed_recipient_path(schema_json,p_action || jsonb_build_object('recipients',recipients)) then
      raise exception 'Выберите один вопрос «Организация» вне повторяющейся панели, краткое письмо и до 49 дополнительных адресов' using errcode='22023';
    end if;
  elsif cardinality(recipients)=0 then raise exception 'Укажите получателя письма' using errcode='22023';
  end if;

  p_action:=jsonb_strip_nulls(jsonb_build_object('recipients',recipients,'subject',btrim(p_action->>'subject',E' \t\n\r\f\013'),
    'body',btrim(p_action->>'body',E' \t\n\r\f\013'),'mode',p_action->>'mode','recipientPath',p_action->'recipientPath'));
  -- Serialize rule changes with new forms so an all-forms rule always gets a target.
  perform pg_advisory_xact_lock(hashtextextended('survey-automation-owner:'||actor::text,0));
  if p_id is null then
    if (select count(*) from public.automation_rules where user_id=actor)>=50 then
      raise exception 'На одну учётную запись доступно до 50 правил' using errcode='22023';
    end if;
    insert into public.automation_rules(user_id,form_id,name,description,enabled,event_type,threshold,interval_minutes,
        scheduled_at,match_mode,conditions,action_config)
      values(actor,p_form_id,btrim(p_name),p_description,p_enabled,p_event_type,p_threshold,p_interval_minutes,
        p_scheduled_at,p_match_mode,p_conditions,p_action)
      returning * into saved;
    event_changed:=true;
  else
    select * into previous from public.automation_rules where id=p_id and user_id=actor for no key update;
    if not found then raise exception 'Правило не найдено' using errcode='42501'; end if;
    event_changed:=row(previous.form_id,previous.event_type,previous.threshold,previous.interval_minutes,
      previous.scheduled_at,previous.match_mode,previous.conditions) is distinct from
      row(p_form_id,p_event_type,p_threshold,p_interval_minutes,p_scheduled_at,p_match_mode,p_conditions);
    update public.automation_rules set form_id=p_form_id,name=btrim(p_name),description=p_description,
      enabled=p_enabled,event_type=p_event_type,threshold=p_threshold,interval_minutes=p_interval_minutes,scheduled_at=p_scheduled_at,
      match_mode=p_match_mode,conditions=p_conditions,action_config=p_action,updated_at=now(),
      event_version=event_version+event_changed::integer,
      delivery_version=delivery_version+(previous.enabled and not p_enabled)::integer
      where id=p_id returning * into saved;
    if event_changed then delete from survey_automation.targets where rule_id=p_id; end if;
  end if;
  if saved.enabled then
    if previous.enabled=false then perform survey_automation.resume_targets(saved);
    elsif event_changed then perform survey_automation.seed_targets(saved);
    end if;
  end if;
  return saved.id;
end;
$$;

create or replace function public.set_automation_rule_enabled(p_id uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare current_rule public.automation_rules;
begin
  if not public.request_is_enabled() or p_enabled is null then raise exception 'Нет доступа' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('survey-automation-owner:'||auth.uid()::text,0));
  select * into current_rule from public.automation_rules where id=p_id and user_id=auth.uid() for no key update;
  if not found then raise exception 'Правило не найдено' using errcode='42501'; end if;
  if p_enabled and current_rule.form_id is not null and not exists (
    select from public.forms where id=current_rule.form_id and author_id=auth.uid() and form_type<>'template'
  ) then raise exception 'Выберите свою форму' using errcode='42501'; end if;
  if p_enabled and ((current_rule.event_type='recurring' and current_rule.interval_minutes<15)
    or (current_rule.action_config ? 'recipientPath' and not survey_automation.allowed_recipient_path(
      (select schema from public.forms where id=current_rule.form_id),current_rule.action_config))) then
    raise exception 'Перед включением обновите настройки получателя или интервала' using errcode='22023';
  end if;
  if p_enabled is distinct from current_rule.enabled then
    update public.automation_rules set enabled=p_enabled,updated_at=now(),delivery_version=delivery_version+(not p_enabled)::integer
      where id=p_id returning * into current_rule;
    if p_enabled then perform survey_automation.resume_targets(current_rule); end if;
  end if;
end;
$$;

create or replace function survey_automation.stage_run(
  p_rule public.automation_rules,p_form public.forms,p_event_key text,p_response public.responses,
  p_matching_count integer default null
)
returns void language plpgsql set search_path = '' as $$
declare run_id uuid;
begin
  insert into public.automation_runs(rule_id,form_id,form_title,response_id,event_version,delivery_version,event_key)
    values(p_rule.id,p_form.id,p_form.title,p_response.id,p_rule.event_version,p_rule.delivery_version,p_event_key)
  on conflict (rule_id,event_version,form_id,event_key) do nothing returning id into run_id;
  if run_id is null then return; end if;

  insert into survey_automation.payloads(run_id,payload) values(
    run_id,jsonb_build_object('actionType',p_rule.action_type,'action',p_rule.action_config,'response',p_response.data,'respondentId',p_response.user_id,
      'responseTime',p_response.created_at,'answerCount',p_form.responses_count,'matchingCount',p_matching_count));
end;
$$;

create function survey_automation.threshold_reached(p_rule public.automation_rules,p_total integer,p_matching integer)
returns boolean language sql immutable set search_path = '' as $$
  select case p_rule.event_type
    when 'response_count' then p_total>=p_rule.threshold and p_matching>0
    when 'matching_count' then p_matching>=p_rule.threshold
    when 'matching_share' then p_total>0 and p_matching*100::numeric>=p_total*p_rule.threshold
    else false end;
$$;

create or replace function survey_automation.process_response_changes(
  p_form_id uuid,p_old jsonb,p_new jsonb,p_event text,p_change_id uuid
)
returns void language plpgsql set search_path = '' as $$
declare
  f public.forms;
  target record;
  r public.responses;
  latest public.responses;
  matching integer;
begin
  -- Serialize changes to each form's aggregate counters. This lock does not
  -- lock the form row, which existing delete RPCs lock before response rows.
  perform pg_advisory_xact_lock(hashtextextended('survey-automation-form:'||p_form_id::text,0));
  select * into f from public.forms where id=p_form_id and form_type<>'template';
  if not found or not exists(select from public.profiles where id=f.author_id and not is_disabled) then return; end if;

  if p_event in ('response_received','response_updated') then
    perform survey_automation.notify(f.author_id,p_event,
      case when p_event='response_received' then 'received:'||entry.id::text else 'updated:'||p_change_id::text||':'||entry.id::text end,
      case when p_event='response_received' then 'Новый ответ' else 'Ответ изменён' end,
      f.title,f.id,entry.id)
    from jsonb_populate_recordset(null::public.responses,p_new) entry;
  end if;

  for target in
    select t.*,a as rule
    from survey_automation.targets t join public.automation_rules a on a.id=t.rule_id
    where t.form_id=f.id and a.user_id=f.author_id and a.enabled and not t.complete
      and (a.event_type=p_event or a.event_type in ('response_count','matching_count','matching_share')
        or (a.event_type='inactivity' and p_event='response_received'))
    order by t.rule_id for update of t
  loop
    if (target.rule).event_type in ('response_received','response_updated') then
      for r in select * from jsonb_populate_recordset(null::public.responses,p_new) entry
        where survey_automation.matches(entry.data,(target.rule).conditions,(target.rule).match_mode)
      loop
        perform survey_automation.stage_run(target.rule,f,
          case when p_event='response_received' then 'received:'||r.id::text
            else 'updated:'||p_change_id::text||':'||r.id::text end,r);
      end loop;
    elsif (target.rule).event_type='inactivity' then
      select * into latest from jsonb_populate_recordset(null::public.responses,p_new)
        order by created_at desc,id desc limit 1;
      update survey_automation.targets
        set next_run_at=clock_timestamp()+make_interval(mins=>(target.rule).interval_minutes),
          last_received_at=greatest(last_received_at,latest.created_at),gap_key=latest.id::text,
          count_cursor_at=null,count_cursor_id=null,schedule_slot_at=null
        where rule_id=target.rule_id and form_id=f.id;
    else
      if (target.rule).conditions='[]'::jsonb then
        matching:=f.responses_count;
      else
        -- While the worker counts history, adjust only the range it has already read.
        matching:=target.matching_count
          + (select count(*) from jsonb_populate_recordset(null::public.responses,p_new) entry
             where (target.count_ready or (entry.created_at,entry.id)<=(target.count_cursor_at,target.count_cursor_id))
               and survey_automation.matches(entry.data,(target.rule).conditions,(target.rule).match_mode))
          - (select count(*) from jsonb_populate_recordset(null::public.responses,p_old) entry
             where (target.count_ready or (entry.created_at,entry.id)<=(target.count_cursor_at,target.count_cursor_id))
               and survey_automation.matches(entry.data,(target.rule).conditions,(target.rule).match_mode));
      end if;
      update survey_automation.targets set matching_count=matching
        where rule_id=target.rule_id and form_id=f.id;

      if not target.count_ready or survey_automation.threshold_reached(target.rule,f.responses_count,matching) then
        select * into latest from jsonb_populate_recordset(null::public.responses,p_new) entry
          where survey_automation.matches(entry.data,(target.rule).conditions,(target.rule).match_mode)
          order by created_at desc,id desc limit 1;
        if latest.id is null and (target.rule).conditions='[]'::jsonb then
          select * into latest from public.responses entry where entry.form_id=f.id
            order by created_at desc,id desc limit 1;
        end if;
        if target.count_ready and latest.id is not null then
          perform survey_automation.stage_run(target.rule,f,'threshold',latest,matching);
          update survey_automation.targets set complete=true,check_at=null,check_response_id=null
            where rule_id=target.rule_id and form_id=f.id;
        else
          update survey_automation.targets set check_at=coalesce(check_at,clock_timestamp()),
            check_response_id=coalesce(latest.id,check_response_id)
            where rule_id=target.rule_id and form_id=f.id;
        end if;
      end if;
    end if;
  end loop;
end;
$$;

create function survey_automation.on_response_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare changes record; operation_id uuid;
begin
  -- Statement transition tables keep bulk changes and the initial count in sync.
  if tg_op='INSERT' then
    for changes in select form_id,jsonb_agg(to_jsonb(n)) as entries from new_responses n group by form_id order by form_id loop
      perform survey_automation.process_response_changes(changes.form_id,'[]',changes.entries,'response_received',null);
    end loop;
  elsif tg_op='UPDATE' then
    operation_id:=gen_random_uuid();
    for changes in
      select n.form_id,jsonb_agg(to_jsonb(o)) as before_entries,jsonb_agg(to_jsonb(n)) as after_entries
      from new_responses n join old_responses o on n.id=o.id and n.form_id=o.form_id
      where n.data is distinct from o.data group by n.form_id order by n.form_id
    loop
      perform survey_automation.process_response_changes(changes.form_id,changes.before_entries,changes.after_entries,
        'response_updated',operation_id);
    end loop;
  else
    -- A form deletion cascades all its responses. Skip that transition table
    -- without collecting full payloads for a form that no longer exists.
    for changes in
      select o.form_id,jsonb_agg(to_jsonb(o)) as entries from old_responses o
      where exists (select from public.forms f where f.id=o.form_id)
      group by o.form_id order by o.form_id
    loop
      perform survey_automation.process_response_changes(changes.form_id,changes.entries,'[]','response_deleted',null);
    end loop;
  end if;
  return null;
end;
$$;

create trigger automation_response_insert after insert on public.responses
  referencing new table as new_responses for each statement execute function survey_automation.on_response_changes();
create trigger automation_response_update after update on public.responses
  referencing old table as old_responses new table as new_responses
  for each statement execute function survey_automation.on_response_changes();
create trigger automation_response_delete after delete on public.responses
  referencing old table as old_responses for each statement execute function survey_automation.on_response_changes();

create function survey_automation.on_form_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  a public.automation_rules;
  owner uuid;
  content text;
begin
  if tg_op='UPDATE' and old.author_id=new.author_id and old.form_type=new.form_type
    and old.deadline_at is not distinct from new.deadline_at and old.is_public=new.is_public then return new;
  end if;
  if tg_op='INSERT' or old.author_id<>new.author_id or old.form_type<>new.form_type then
    for owner in select distinct id from unnest(array[old.author_id,new.author_id]) id where id is not null order by id loop
      perform pg_advisory_xact_lock(hashtextextended('survey-automation-owner:'||owner::text,0));
    end loop;
    if tg_op='UPDATE' then
      delete from survey_automation.targets t using public.automation_rules r
      where t.form_id=new.id and r.id=t.rule_id and (r.user_id<>new.author_id or new.form_type='template');
    end if;
    if new.form_type<>'template' then
      for a in select * from public.automation_rules
        where user_id=new.author_id and enabled and (form_id is null or form_id=new.id) order by id
      loop
        perform survey_automation.seed_targets(a,new.id);
      end loop;
    end if;
  end if;

  if new.form_type<>'template' and new.is_public and new.deadline_at is not null and new.deadline_at>now() then
    insert into survey_automation.form_deadlines(form_id,due_at) values(new.id,new.deadline_at)
    on conflict (form_id) do update set due_at=excluded.due_at;
  else
    delete from survey_automation.form_deadlines where form_id=new.id;
  end if;
  if tg_op='UPDATE' and new.form_type<>'template' then
    if new.is_public is distinct from old.is_public then
      content:=case when new.is_public then 'Открыт приём ответов'
        when new.responses_count>=least(coalesce(new.max_responses,100000),100000) then 'Достигнут лимит ответов'
        else 'Закрыт приём ответов' end;
      perform survey_automation.notify(new.author_id,'form_status','form-status:'||new.id||':'||new.revision,
        content,new.title,new.id);
    end if;
    if new.deadline_at is distinct from old.deadline_at then
      perform survey_automation.notify(new.author_id,'form_status','form-deadline:'||new.id||':'||new.revision,
        case when new.deadline_at is null then 'Срок приёма снят' else 'Срок приёма изменён' end,new.title,new.id);
    end if;
  end if;
  return new;
end;
$$;

create or replace function survey_automation.on_profile_enabled()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.automation_rules;
begin
  perform pg_advisory_xact_lock(hashtextextended('survey-automation-owner:'||new.id::text,0));
  -- Runs captured before the account was disabled must stay inactive after reactivation.
  for a in update public.automation_rules set delivery_version=delivery_version+1
    where user_id=new.id and enabled returning * loop
    perform survey_automation.resume_targets(a);
  end loop;
  return new;
end;
$$;

create trigger automation_profile_enabled after update of is_disabled on public.profiles
  for each row when (old.is_disabled and not new.is_disabled) execute function survey_automation.on_profile_enabled();

create trigger automation_form_insert after insert on public.forms
  for each row execute function survey_automation.on_form_changes();
create trigger automation_form_update after update of is_public,deadline_at,max_responses,author_id,form_type on public.forms
  for each row execute function survey_automation.on_form_changes();
insert into survey_automation.form_deadlines(form_id,due_at)
  select id,deadline_at from public.forms where form_type<>'template' and is_public and deadline_at>now();

create function survey_automation.cancel_deleted_form_runs()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Queue rows are already removed by the form's foreign key cascades.
  with cancelled as (
    update public.automation_runs set status='cancelled',last_error='Форма удалена'
    where form_id=old.id and status in ('pending','queued') returning id
  )
  delete from survey_automation.payloads p using cancelled where p.run_id=cancelled.id;
  return old;
end;
$$;

create trigger automation_form_delete after delete on public.forms
  for each row execute function survey_automation.cancel_deleted_form_runs();

create function survey_automation.process_threshold_checks(p_limit integer)
returns void language plpgsql set search_path = '' as $$
declare
  batch_size constant integer := 1000;
  candidate record;
  target survey_automation.targets;
  rule public.automation_rules;
  f public.forms;
  r public.responses;
  batch record;
  matching integer;
  triggered boolean;
begin
  for candidate in
    select t.rule_id,t.form_id
    from survey_automation.targets t
    join public.automation_rules a on a.id=t.rule_id and a.enabled
    join public.profiles p on p.id=a.user_id and not p.is_disabled
    where t.check_at is not null
    order by t.check_at,t.rule_id,t.form_id limit least(p_limit,4)
  loop
    -- Match the deletion path's lock order and skip a rule being edited.
    select a.* into rule from public.automation_rules a
    join public.forms form on form.id=candidate.form_id and form.author_id=a.user_id and form.form_type<>'template'
    join public.profiles p on p.id=a.user_id and not p.is_disabled
    where a.id=candidate.rule_id and a.enabled
    for key share of form,p skip locked for share of a skip locked;
    if not found then continue; end if;

    select * into target from survey_automation.targets t
    where t.rule_id=rule.id and t.form_id=candidate.form_id and t.check_at is not null and not t.complete
    for no key update skip locked;
    if not found then continue; end if;
    select * into f from public.forms where id=target.form_id;
    if f.author_id is distinct from rule.user_id or f.form_type='template' then continue; end if;

    matching:=target.matching_count;
    if not target.count_ready then
      with page as materialized (
        select entry.id,entry.created_at,entry.data from public.responses entry
        where entry.form_id=f.id and (entry.created_at,entry.id)>=(
          coalesce(target.count_cursor_at,'-infinity'::timestamptz),
          coalesce(target.count_cursor_id,'00000000-0000-0000-0000-000000000000'::uuid))
          and entry.id is distinct from target.count_cursor_id
        order by entry.created_at,entry.id limit batch_size
      )
      select stats.*,tail.created_at,tail.id into batch
      from (select count(*) as entries,count(*) filter (
        where survey_automation.matches(page.data,rule.conditions,rule.match_mode)) as matches from page) stats
      left join lateral (select id,created_at from page order by created_at desc,id desc limit 1) tail on true;
      matching:=matching+batch.matches;
      if batch.entries=batch_size then
        update survey_automation.targets set matching_count=matching,count_cursor_at=batch.created_at,
          count_cursor_id=batch.id,check_at=clock_timestamp() where rule_id=rule.id and form_id=f.id;
        continue;
      end if;
      target.count_cursor_at:=null;
      target.count_cursor_id:=null;
    end if;

    triggered:=survey_automation.threshold_reached(rule,f.responses_count,matching);
    if triggered then
      select * into r from public.responses entry where entry.id=target.check_response_id and entry.form_id=f.id
        and survey_automation.matches(entry.data,rule.conditions,rule.match_mode);
      if not found then
        -- If the change had no eligible answer, look for the latest match in
        -- bounded descending pages. The count cursor is finished at this point.
        with page as materialized (
          select entry.id,entry.created_at,entry.data from public.responses entry
          where entry.form_id=f.id and (entry.created_at,entry.id)<=(
            coalesce(target.count_cursor_at,'infinity'::timestamptz),
            coalesce(target.count_cursor_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
            and entry.id is distinct from target.count_cursor_id
          order by entry.created_at desc,entry.id desc limit batch_size
        )
        select tail.*,best.id as matching_id,(select count(*) from page) as entries into batch
        from (select id,created_at from page order by created_at,id limit 1) tail
        left join lateral (
          select id from page where survey_automation.matches(data,rule.conditions,rule.match_mode)
          order by created_at desc,id desc limit 1
        ) best on true;
        if batch.matching_id is null and batch.entries=batch_size then
          update survey_automation.targets set matching_count=matching,count_ready=true,count_cursor_at=batch.created_at,
            count_cursor_id=batch.id,check_at=clock_timestamp() where rule_id=rule.id and form_id=f.id;
          continue;
        end if;
        select * into r from public.responses where id=batch.matching_id and form_id=f.id;
      end if;
      triggered:=r.id is not null;
      if triggered then perform survey_automation.stage_run(rule,f,'threshold',r,matching); end if;
    end if;
    update survey_automation.targets set complete=triggered,matching_count=matching,count_ready=true,
      count_cursor_at=null,count_cursor_id=null,check_at=null,check_response_id=null
      where rule_id=rule.id and form_id=f.id;
  end loop;
end;
$$;

create or replace function survey_automation.process_schedules(p_now timestamptz,p_limit integer)
returns void language plpgsql set search_path = '' as $$
declare
  candidate record;
  due survey_automation.targets;
  deadline record;
  rule public.automation_rules;
  f public.forms;
  r public.responses;
  page record;
  slot timestamptz;
  next_slot timestamptz;
  key text;
begin
  for candidate in
    select t.rule_id,t.form_id from survey_automation.targets t
    join public.automation_rules a on a.id=t.rule_id and a.enabled
    join public.profiles p on p.id=a.user_id and not p.is_disabled
    join public.forms form on form.id=t.form_id and form.author_id=a.user_id and form.form_type<>'template'
    where t.next_run_at<=p_now order by t.next_run_at,t.rule_id,t.form_id limit least(p_limit,4)
  loop
    -- Acquire parents before the target, following the threshold worker's lock order.
    select a.* into rule from public.automation_rules a
    join public.forms form on form.id=candidate.form_id and form.author_id=a.user_id and form.form_type<>'template'
    join public.profiles p on p.id=a.user_id and not p.is_disabled
    where a.id=candidate.rule_id and a.enabled
    for key share of form,p skip locked for share of a skip locked;
    if not found then continue; end if;
    select * into due from survey_automation.targets t
    where t.rule_id=rule.id and t.form_id=candidate.form_id and t.next_run_at<=p_now and not t.complete
    for no key update skip locked;
    if not found then continue; end if;
    select * into f from public.forms where id=due.form_id;

    next_slot:=null;
    slot:=null;
    case rule.event_type
      when 'date' then key:='date';
      when 'inactivity' then key:='gap:'||due.gap_key;
      when 'recurring' then
        slot:=coalesce(due.schedule_slot_at,survey_automation.schedule_slot(rule.scheduled_at,rule.interval_minutes,p_now));
        key:='slot:'||extract(epoch from slot)::text;
        next_slot:=survey_automation.schedule_slot(rule.scheduled_at,rule.interval_minutes,p_now)
          +make_interval(mins=>rule.interval_minutes);
      else continue;
    end case;
    if rule.conditions='[]'::jsonb then
      select * into r from public.responses entry where entry.form_id=f.id
        order by created_at desc,id desc limit 1;
    else
      -- Each target uses the count cursor for either a threshold or a scheduled search, never both.
      with batch as materialized (
        select entry.id,entry.created_at,entry.data from public.responses entry
        where entry.form_id=f.id and (entry.created_at,entry.id)<(
          coalesce(due.count_cursor_at,'infinity'::timestamptz),
          coalesce(due.count_cursor_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
        order by entry.created_at desc,entry.id desc limit 500
      )
      select (select count(*) from batch) as entries,tail.id,tail.created_at,
        (select b.id from batch b where survey_automation.matches(b.data,rule.conditions,rule.match_mode)
          order by b.created_at desc,b.id desc limit 1) as matching_id into page
      from (select id,created_at from batch order by created_at,id limit 1) tail;
      if page.matching_id is null and page.entries=500 then
        update survey_automation.targets set count_cursor_at=page.created_at,count_cursor_id=page.id,
          schedule_slot_at=slot,next_run_at=clock_timestamp() where rule_id=rule.id and form_id=f.id;
        continue;
      end if;
      select * into r from public.responses where id=page.matching_id and form_id=f.id;
    end if;
    if r.id is not null or rule.conditions='[]'::jsonb then
      perform survey_automation.stage_run(rule,f,key,r);
    end if;
    update survey_automation.targets set next_run_at=next_slot,complete=(rule.event_type='date'),
      count_cursor_at=null,count_cursor_id=null,schedule_slot_at=null where rule_id=rule.id and form_id=f.id;
  end loop;

  for deadline in
    select d.* from survey_automation.form_deadlines d where due_at<=p_now
    order by due_at,form_id limit p_limit for update skip locked
  loop
    select * into f from public.forms where id=deadline.form_id;
    if found and f.is_public and f.form_type<>'template' and f.deadline_at=deadline.due_at then
      perform survey_automation.notify(f.author_id,'form_status',
        'deadline-reached:'||f.id||':'||extract(epoch from deadline.due_at)::text,'Срок приёма истёк',f.title,f.id);
    end if;
    delete from survey_automation.form_deadlines where form_id=deadline.form_id;
  end loop;
end;
$$;

alter table public.mail_batches drop constraint mail_batches_kind_check;
alter table public.mail_batches add constraint mail_batches_kind_check check (kind in ('reminder','invitation','test','automation'));
alter table public.mail_batches drop constraint mail_batches_form_kind;
alter table public.mail_batches add constraint mail_batches_form_kind check (
  (kind in ('reminder','invitation','automation') and form_id is not null) or (kind='test' and form_id is null)
);

alter table public.mail_queue add column automation_run_id uuid references public.automation_runs(id) on delete cascade;
create index mail_queue_automation_run on public.mail_queue (automation_run_id) where automation_run_id is not null;
create index mail_queue_automation_active on public.mail_queue (created_at,id)
  where automation_run_id is not null and status in ('queued','processing');
alter table public.mail_queue drop constraint mail_queue_body_length;
alter table public.mail_queue add constraint mail_queue_body_length
  check (char_length(body_text) between 1 and case when automation_run_id is null then 20000 else 512000 end);

create function survey_automation.run_is_active(p_run_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select from public.automation_runs r join public.automation_rules a on a.id=r.rule_id
    join public.profiles p on p.id=a.user_id
    join public.forms f on f.id=r.form_id and f.author_id=a.user_id
    where r.id=p_run_id and a.enabled and not p.is_disabled and f.form_type<>'template'
      and r.event_version=a.event_version and r.delivery_version=a.delivery_version and (r.response_id is null or exists (
        select from public.responses entry where entry.id=r.response_id and entry.form_id=r.form_id))
  );
$$;

create or replace function survey_automation.terminal_notice(p_run public.automation_runs)
returns void language sql set search_path = '' as $$
  select survey_automation.notify(a.user_id,
    'automation_failed',
    p_run.id::text||':finished',
    case when p_run.status='cancelled' then 'Выполнение правила отменено' else 'Ошибка автоматизации' end,
    a.name||' · '||p_run.form_title||coalesce(' — '||p_run.last_error,''),
    p_run.form_id,p_run.response_id,p_run.rule_id)
  from public.automation_rules a where a.id=p_run.rule_id and p_run.status in ('failed', 'cancelled');
$$;

create function survey_automation.clear_delivered_content()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.subject:='Уведомление о форме';
  new.body_text:='Выполнение завершено';
  return new;
end;
$$;

-- Delivery history only needs the destination and result after the SMTP step.
create trigger automation_clear_mail_content before update of status on public.mail_queue for each row
  when (new.automation_run_id is not null and new.status in ('sent','failed') and new.status is distinct from old.status)
  execute function survey_automation.clear_delivered_content();

create or replace function survey_automation.record_delivery()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  updated_run public.automation_runs;
  cancelled boolean := old.status='queued' and new.status='failed';
begin
  update public.automation_runs r set
    sent_count=r.sent_count+(new.status='sent')::integer,
    failed_count=r.failed_count+(new.status='failed' and not cancelled)::integer,
    cancelled_count=r.cancelled_count+cancelled::integer,
    last_error=coalesce(new.last_error,r.last_error),
    status=case when r.sent_count+r.failed_count+r.cancelled_count+1<r.recipient_count then 'queued'
      when (new.status='failed' and not cancelled) or r.failed_count>0 then 'failed'
      when cancelled or r.cancelled_count>0 then 'cancelled'
      when r.last_error is not null then 'failed'
      else 'succeeded' end
    where r.id=new.automation_run_id and r.status='queued' returning * into updated_run;
  if updated_run.status in ('succeeded','failed','cancelled') then perform survey_automation.terminal_notice(updated_run); end if;
  return new;
end;
$$;

create trigger automation_mail_delivery after update of status on public.mail_queue for each row
  when (new.automation_run_id is not null and new.status in ('sent','failed') and new.status is distinct from old.status)
  execute function survey_automation.record_delivery();

create function survey_automation.render_template(p_template text,p_values jsonb)
returns text language sql immutable set search_path = '' as $$
  -- Substitute each token from the template once, never from submitted data.
  select coalesce(string_agg(
    case when m[1] ~ '^\{\{[a-z_]+\}\}$'
      then coalesce(p_values->>substr(m[1],3,length(m[1])-4),m[1]) else m[1] end,'' order by position),'')
  from regexp_matches(p_template,'\{\{[a-z_]+\}\}|[^{]+|.','gs') with ordinality tokens(m,position);
$$;

create or replace function survey_automation.response_text(p_schema jsonb,p_data jsonb)
returns text language sql set search_path = '' as $$
  with bindings as materialized (
    select b.* from public.survey_response_bindings(p_schema,p_data)
      with ordinality b(question,value,value_path,ord)
  ), sensitive as materialized (
    select distinct value_path from bindings
    where question->>'type' in ('file','signaturepad') and value is not null and value<>'null'::jsonb
  ), printable as (
    select ord,coalesce(survey_automation.localized_text(b.question->'title'),b.question->>'name') as label,
      case when b.question->>'type'='file' then 'Прикреплённый файл'
      when b.question->>'type'='boolean' and b.value=coalesce(nullif(b.question->'valueTrue','null'::jsonb),'true'::jsonb)
        then coalesce(survey_automation.localized_text(b.question->'labelTrue'),'Да')
      when b.question->>'type'='boolean' and b.value=coalesce(nullif(b.question->'valueFalse','null'::jsonb),'false'::jsonb)
        then coalesce(survey_automation.localized_text(b.question->'labelFalse'),'Нет')
      when b.question->>'type'='signaturepad' then 'Подпись доступна в ответе'
      when b.question->>'type'='organization' then coalesce(o.alias,b.value #>> '{}')
      when jsonb_typeof(b.value)='array' and b.question->>'type' in ('checkbox','tagbox','imagepicker','ranking') then (
        select string_agg(coalesce(survey_automation.localized_text(choice->'text'),selected #>> '{}'),', ' order by pos)
        from jsonb_array_elements(b.value) with ordinality selections(selected,pos)
        left join lateral (select v as choice from jsonb_array_elements(
          case when jsonb_typeof(b.question->'choices')='array' then b.question->'choices' else '[]'::jsonb end
        ) v where v->'value'=selected limit 1) found on true)
      else coalesce(survey_automation.localized_text(ch.choice->'text'), b.value #>> '{}') end as content,
      case when b.question->>'type' not in ('file','signaturepad') and (
          b.question @> '{"showOtherItem":true}' or b.question @> '{"showCommentArea":true}'
          or b.question @> '{"hasOther":true}' or b.question @> '{"hasComment":true}')
        and jsonb_typeof(p_data #> c.path)='string'
        and not exists(select from sensitive s where c.path[1:cardinality(s.value_path)]=s.value_path)
        then p_data #>> c.path end as comment
    from bindings b
    cross join lateral (select b.value_path[1:cardinality(b.value_path)-1] ||
      (b.value_path[cardinality(b.value_path)]||coalesce(nullif(p_schema->>'commentSuffix',''),'-Comment')) as path) c
    left join public.education_organizations o on b.question->>'type'='organization' and o.id=case
      when b.value #>> '{}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (b.value #>> '{}')::uuid end
    left join lateral (select v as choice from jsonb_array_elements(
      case when jsonb_typeof(b.question->'choices')='array' then b.question->'choices' else '[]'::jsonb end
    ) v where v->'value'=b.value limit 1) ch on true
    where b.value is not null and b.value<>'null'::jsonb
      and b.question->>'type' not in ('paneldynamic','matrixdynamic','matrixdropdown')
      and (b.question->>'type' in ('file','signaturepad') or not exists (
        select from sensitive s where b.value_path[1:cardinality(s.value_path)]=s.value_path
          or s.value_path[1:cardinality(b.value_path)]=b.value_path))
  )
  select string_agg(label||': '||coalesce(content,'')||coalesce(E'\nКомментарий: '||comment,''),E'\n' order by ord)
  from printable;
$$;

create or replace function survey_automation.dispatch_email(
  p_run public.automation_runs,p_form public.forms,p_origin text,p_snapshot jsonb
)
returns void language plpgsql set search_path = '' as $$
declare
  action jsonb;
  response_data jsonb;
  recipients text[];
  org_value jsonb;
  directory_email text;
  marker text := '{{sent_at:'||p_run.id||'}}';
  marker_start integer;
  usage_hour timestamptz := date_trunc('hour',clock_timestamp(),'UTC');
  field_error text;
  respondent text;
  form_link text;
  response_link text;
  subject_text text;
  body_text text;
  details text;
  data_values jsonb;
begin
  if p_origin is null or p_origin !~ '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' or length(p_origin)>300
    or coalesce(substring(p_origin from ':([0-9]{1,5})$')::integer,1) not between 1 and 65535 then
    raise exception 'Для ссылок в письмах задайте PUBLIC_APP_URL' using errcode='P0001';
  end if;
  if not exists(select from public.mail_settings where id=1 and enabled) then
    raise exception 'Отправка почты отключена в администрировании' using errcode='P0001';
  end if;
  action:=p_snapshot->'action';
  response_data:=p_snapshot->'response';
  recipients:=array(select jsonb_array_elements_text(action->'recipients'));
  if action ? 'recipientPath' then
    if not survey_automation.allowed_recipient_path(p_form.schema,action) then
      raise exception 'В настройках письма указан недоступный получатель или формат' using errcode='P0001';
    end if;
    org_value:=response_data->(action->'recipientPath'->>0);
    select survey_automation.email_address(o.email) into directory_email
      from public.education_organizations o
      where jsonb_typeof(org_value)='string' and o.id=case
        when org_value #>> '{}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (org_value #>> '{}')::uuid end
        and not o.is_archived and o.organization_type=any(p_form.organization_types);
    if directory_email is null then field_error:='В выбранном вопросе нет доступного адреса организации';
    elsif not (directory_email=any(recipients)) then recipients:=array_append(recipients,directory_email);
    end if;
  end if;
  if cardinality(recipients)=0 then raise exception '%',field_error using errcode='P0001'; end if;
  if cardinality(recipients)>50 then raise exception 'Для одного письма доступно до 50 получателей' using errcode='P0001'; end if;

  select nullif(btrim(p.name),'') into respondent from public.profiles p where p.id=(p_snapshot->>'respondentId')::uuid;
  if respondent is null and p_run.response_id is not null then
    select o.alias into respondent from public.survey_organization_values(p_form.schema,response_data) v
    join public.education_organizations o on o.id=case
      when v #>> '{}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (v #>> '{}')::uuid end
    order by o.id limit 1;
  end if;
  form_link:=p_origin||'/dashboard/forms/'||p_run.form_id||'/responses';
  response_link:=case when p_run.response_id is null then form_link else form_link||'?response='||p_run.response_id end;
  data_values:=jsonb_build_object('form_title',p_run.form_title,'form_link',form_link,'response_link',response_link,
    'respondent',coalesce(respondent,'Не указан'),
    'response_time',coalesce(to_char((p_snapshot->>'responseTime')::timestamptz at time zone 'Europe/Moscow','DD.MM.YYYY HH24:MI "МСК"'),'—'),
    'sent_at','{{sent_at:'||p_run.id||'}}',
    'answer_count',p_snapshot->>'answerCount','matching_count',coalesce(p_snapshot->>'matchingCount','—'),
    'matching_percent',case when (p_snapshot->>'answerCount')::integer>0 and p_snapshot->>'matchingCount' is not null
      then round((p_snapshot->>'matchingCount')::numeric*100/(p_snapshot->>'answerCount')::integer,2)::text||'%' else '—' end);
  subject_text:=btrim(regexp_replace(survey_automation.render_template(action->>'subject',data_values),'[[:cntrl:]]+',' ','g'));
  if char_length(subject_text)>500 then
    -- Never leave half an SMTP-time placeholder at the subject boundary.
    marker_start:=strpos(substr(subject_text,502-length(marker),2*length(marker)-2),marker);
    if marker_start between 1 and length(marker)-1 then
      subject_text:=left(subject_text,500-length(marker)+marker_start);
    else
      subject_text:=left(subject_text,500);
    end if;
  end if;
  body_text:=survey_automation.render_template(action->>'body',data_values);
  if strpos(body_text,response_link)=0 then body_text:=body_text||E'\n\n'||response_link; end if;
  if action->>'mode'='full' and p_run.response_id is not null then
    details:=survey_automation.response_text(p_form.schema,response_data);
    if details is not null then body_text:=body_text||E'\n\nОтвет:\n'||details; end if;
  end if;
  if char_length(body_text)>512000 then raise exception 'Ответ слишком длинный для письма. Выберите краткое письмо со ссылкой' using errcode='P0001'; end if;

  insert into survey_automation.mail_usage as usage(user_id,hour_start,recipient_count)
    values(p_form.author_id,usage_hour,cardinality(recipients))
    on conflict (user_id) do update set hour_start=excluded.hour_start,
      recipient_count=case when usage.hour_start=excluded.hour_start then usage.recipient_count else 0 end
        +excluded.recipient_count
    where usage.hour_start<excluded.hour_start or (usage.hour_start=excluded.hour_start
      and usage.recipient_count+excluded.recipient_count<=500);
  if not found then
    raise exception 'Достигнут часовой лимит в 500 получателей автоматизаций' using errcode='P0001';
  end if;

  insert into public.mail_batches(id,kind,form_id,created_by,total_count)
    values(p_run.id,'automation',p_form.id,p_form.author_id,cardinality(recipients));
  insert into public.mail_queue(batch_id,form_id,recipient_email,recipient_name,subject,body_text,max_attempts,automation_run_id)
    select p_run.id,p_form.id,address,address,coalesce(nullif(subject_text,''),'Уведомление о форме'),body_text,1,p_run.id
    from unnest(recipients) address;
  update public.automation_runs set status='queued',recipient_count=cardinality(recipients),last_error=field_error where id=p_run.id;
end;
$$;

create or replace function public.process_automations(p_app_origin text,p_limit integer default 50)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  max_items integer := least(greatest(coalesce(p_limit,50),1),100);
  candidate record;
  run public.automation_runs;
  f public.forms;
  snapshot jsonb;
  completed integer := 0;
  sweep_time timestamptz := clock_timestamp();
begin
  if p_app_origin is null or p_app_origin !~ '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' or length(p_app_origin)>300
    or coalesce(substring(p_app_origin from ':([0-9]{1,5})$')::integer,1) not between 1 and 65535 then
    raise exception 'Для ссылок в письмах задайте PUBLIC_APP_URL' using errcode='P0001';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('survey-automation-worker',0)) then return 0; end if;
  perform survey_automation.process_schedules(sweep_time,max_items);

  -- An expired SMTP lease can represent a successfully accepted message.
  -- Automation jobs are never delivered again after such an uncertain outcome.
  with expired as (
    select q.id from public.mail_queue q
    where q.automation_run_id is not null and (
      (q.status='queued' and not survey_automation.run_is_active(q.automation_run_id))
      or (q.status = 'processing' and q.locked_at<sweep_time-interval '10 minutes'))
    order by q.created_at,q.id limit max_items for update skip locked
  )
  update public.mail_queue q set status='failed',locked_by=null,locked_at=null,
    last_error=case when q.status = 'processing' then 'Не удалось подтвердить отправку письма'
      else 'Правило выключено, изменено или данные больше недоступны' end
    from expired e where q.id=e.id;

  for candidate in select id,form_id from public.automation_runs where status='pending'
    order by created_at,id limit max_items
  loop
    -- Take locks in the same order as the form deletion path.
    select * into f from public.forms where id=candidate.form_id for key share skip locked;
    if not found and exists(select from public.forms where id=candidate.form_id) then continue; end if;
    select * into run from public.automation_runs where id=candidate.id and status='pending' for no key update skip locked;
    if not found then continue; end if;

    if f.id is not null and survey_automation.run_is_active(run.id) then
      begin
        select payload into strict snapshot from survey_automation.payloads where run_id=run.id;
        case snapshot->>'actionType'
          when 'email' then perform survey_automation.dispatch_email(run,f,p_app_origin,snapshot);
          else raise exception 'Действие правила недоступно' using errcode='P0001';
        end case;
      exception
        when raise_exception then
          update public.automation_runs set status='failed',last_error=SQLERRM where id=run.id returning * into run;
          perform survey_automation.terminal_notice(run);
        when data_exception or integrity_constraint_violation or no_data_found then
          raise log 'Automation run % could not prepare an email (%)',run.id,SQLSTATE;
          update public.automation_runs set status='failed',last_error='Не удалось подготовить письмо'
            where id=run.id returning * into run;
          perform survey_automation.terminal_notice(run);
      end;
    else
      update public.automation_runs set status='cancelled',last_error='Правило выключено, изменено или данные больше недоступны'
        where id=run.id returning * into run;
      perform survey_automation.terminal_notice(run);
    end if;
    delete from survey_automation.payloads where run_id=run.id;
    completed:=completed+1;
  end loop;
  perform survey_automation.process_threshold_checks(max_items);
  return completed;
end;
$$;

revoke all on all tables in schema survey_automation from public, anon, authenticated;
revoke all on all functions in schema survey_automation from public, anon, authenticated;
revoke all on function public.save_notification_preferences(text[]),
  public.automation_form_fields(uuid),public.set_automation_rule_enabled(uuid,boolean),
  public.save_automation_rule(uuid,uuid,text,text,boolean,text,numeric,integer,timestamptz,text,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.save_notification_preferences(text[]),
  public.automation_form_fields(uuid),public.set_automation_rule_enabled(uuid,boolean),
  public.save_automation_rule(uuid,uuid,text,text,boolean,text,numeric,integer,timestamptz,text,jsonb,jsonb)
  to authenticated;
revoke all on function public.process_automations(text,integer) from public, anon, authenticated;
grant execute on function public.process_automations(text,integer) to service_role;

-- Administration announcements
create schema survey_announcements;
revoke all on schema survey_announcements from public, anon, authenticated;

create table survey_announcements.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  message text not null check (char_length(message) between 1 and 12000),
  audience text not null check (audience in ('all', 'user', 'admin')),
  display_mode text not null check (display_mode in ('feed', 'banner', 'modal')),
  require_acknowledgement boolean not null default false,
  action_label text check (char_length(action_label) between 1 and 80),
  action_url text check (char_length(action_url) between 1 and 2048),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  publish_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (status <> 'published' or publish_at is not null),
  check (expires_at is null or publish_at is null or expires_at > publish_at),
  check (action_label is null or action_url is not null)
);
create index announcement_publication on survey_announcements.announcements (publish_at desc, id desc)
  where status = 'published';

create table survey_announcements.recipient_state (
  announcement_id uuid not null references survey_announcements.announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  presented_at timestamptz,
  read_at timestamptz,
  acknowledged_at timestamptz,
  primary key (announcement_id, user_id)
);
create index announcement_recipient_user on survey_announcements.recipient_state (user_id);

alter table survey_announcements.announcements enable row level security;
alter table survey_announcements.recipient_state enable row level security;

-- Eligibility is evaluated at read time, including scheduled announcements and newly eligible profiles.
create function survey_announcements.is_visible(
  p_status text, p_publish_at timestamptz, p_expires_at timestamptz, p_audience text, p_role text
)
returns boolean language sql stable set search_path = '' as $$
  select p_role is not null and p_status = 'published' and p_publish_at <= now()
    and (p_expires_at is null or p_expires_at > now()) and p_audience in ('all', p_role);
$$;

create function survey_announcements.effective_status(p_status text, p_publish_at timestamptz, p_expires_at timestamptz)
returns text language sql stable set search_path = '' as $$
  select case
    when p_status <> 'published' then p_status
    when p_expires_at <= now() then 'archived'
    when p_publish_at > now() then 'scheduled'
    else 'published'
  end;
$$;

create function survey_announcements.require_admin()
returns void language plpgsql stable set search_path = '' as $$
begin
  if public.request_role() is distinct from 'admin' then
    raise exception 'Нет доступа к управлению объявлениями' using errcode = '42501';
  end if;
end;
$$;

create function survey_announcements.lock_announcement(p_id uuid, p_expected_updated_at timestamptz)
returns survey_announcements.announcements language plpgsql set search_path = '' as $$
declare
  target survey_announcements.announcements%rowtype;
begin
  select a.* into target from survey_announcements.announcements a where a.id = p_id for update;
  if not found then
    raise exception 'Объявление не найдено' using errcode = '22023';
  end if;
  if target.updated_at is distinct from p_expected_updated_at then
    raise exception 'Объявление уже изменено. Обновите список и откройте его снова.' using errcode = '40001';
  end if;
  return target;
end;
$$;

create function public.list_admin_announcements(
  p_status text, p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 26
)
returns table (
  id uuid, title text, message text, audience text, display_mode text, require_acknowledgement boolean,
  action_label text, action_url text, status text, publish_at timestamptz, expires_at timestamptz,
  created_at timestamptz, updated_at timestamptz, audience_count integer, familiar_count integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform survey_announcements.require_admin();
  if p_status is null or p_status not in ('draft', 'scheduled', 'published', 'archived') then
    raise exception 'Неизвестное состояние объявления' using errcode = '22023';
  end if;

  return query
  with page as (
    select a.* from survey_announcements.announcements a
    where survey_announcements.effective_status(a.status, a.publish_at, a.expires_at) = p_status
      and (p_before_at is null or (a.created_at, a.id) < (p_before_at, p_before_id))
    order by a.created_at desc, a.id desc
    limit least(greatest(coalesce(p_limit, 26), 1), 101)
  ), population as (
    select count(*)::integer as total,
      count(*) filter (where p.role = 'admin')::integer as admins,
      count(*) filter (where p.role = 'user')::integer as users
    from public.profiles p where not p.is_disabled
  )
  select a.id, a.title, a.message, a.audience, a.display_mode, a.require_acknowledgement,
    a.action_label, a.action_url, p_status, a.publish_at, a.expires_at, a.created_at, a.updated_at,
    case a.audience when 'admin' then p.admins when 'user' then p.users else p.total end,
    stats.familiar
  from page a cross join population p
  cross join lateral (
    select count(*)::integer as familiar
    from survey_announcements.recipient_state s join public.profiles recipient on recipient.id = s.user_id
    where s.announcement_id = a.id and not recipient.is_disabled and a.audience in ('all', recipient.role)
      and (case when a.require_acknowledgement then s.acknowledged_at else s.read_at end) is not null
  ) stats
  order by a.created_at desc, a.id desc;
end;
$$;

create or replace function survey_announcements.valid_action_url(p_url text)
returns boolean language plpgsql immutable strict set search_path = '' as $$
declare
  url_parts text[];
begin
  if char_length(p_url) > 2048 or p_url ~ '[[:space:][:cntrl:]]' or strpos(p_url, chr(92)) > 0 then
    return false;
  end if;
  if left(p_url, 1) = '/' then
    -- Absolute paths are stored after the client normalizes dot segments.
    return left(p_url, 2) <> '//'
      and split_part(split_part(p_url, '?', 1), '#', 1) !~* '/(?:\.|%2e){1,2}(?:/|$)';
  end if;

  url_parts := regexp_match(p_url,
    '^https?://(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.?)(?::([0-9]{1,5}))?(?:[/?#]|$)',
    'i');
  if url_parts is null or coalesce(url_parts[2]::integer, 1) not between 1 and 65535 then
    return false;
  end if;
  if left(url_parts[1], 1) = '[' then
    return family(substr(url_parts[1], 2, length(url_parts[1]) - 2)::inet) = 6;
  end if;
  return true;
exception when invalid_text_representation then
  return false;
end;
$$;

revoke all on function survey_announcements.valid_action_url(text) from public, anon, authenticated;

create or replace function public.save_announcement(
  p_id uuid, p_expected_updated_at timestamptz, p_fields jsonb, p_publication text, p_publish_at timestamptz
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target survey_announcements.announcements%rowtype;
  title_value text := regexp_replace(p_fields->>'title', '^[[:space:]]+|[[:space:]]+$', '', 'g');
  message_value text := regexp_replace(p_fields->>'message', '^[[:space:]]+|[[:space:]]+$', '', 'g');
  audience_value text := p_fields->>'audience';
  display_value text := p_fields->>'display_mode';
  label_value text := nullif(regexp_replace(p_fields->>'action_label', '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  url_value text := nullif(regexp_replace(p_fields->>'action_url', '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  expires_value timestamptz;
  status_value text := 'draft';
  current_status text;
  publish_value timestamptz;
begin
  perform survey_announcements.require_admin();
  if jsonb_typeof(p_fields) is distinct from 'object'
    or jsonb_typeof(p_fields->'title') is distinct from 'string'
    or jsonb_typeof(p_fields->'message') is distinct from 'string'
    or jsonb_typeof(p_fields->'require_acknowledgement') is distinct from 'boolean'
    or coalesce(jsonb_typeof(p_fields->'action_label'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_fields->'action_url'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_fields->'expires_at'), 'null') not in ('string', 'null')
    or char_length(title_value) not between 1 and 120
    or char_length(message_value) not between 1 and 12000
    or audience_value is null or audience_value not in ('all', 'user', 'admin')
    or display_value is null or display_value not in ('feed', 'banner', 'modal')
    or p_publication is null or p_publication not in ('keep', 'publish', 'schedule') then
    raise exception 'Проверьте содержание и параметры объявления' using errcode = '22023';
  end if;
  if char_length(label_value) > 80 or (label_value is not null and url_value is null) then
    raise exception 'Укажите ссылку и подпись длиной до 80 символов' using errcode = '22023';
  end if;
  if url_value is not null and not survey_announcements.valid_action_url(url_value) then
    raise exception 'Укажите ссылку HTTP, HTTPS или путь внутри приложения' using errcode = '22023';
  end if;
  begin
    expires_value := (p_fields->>'expires_at')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Некорректная дата окончания' using errcode = '22023';
  end;
  if expires_value is not null and not isfinite(expires_value) then
    raise exception 'Некорректная дата окончания' using errcode = '22023';
  end if;

  if p_id is not null then
    target := survey_announcements.lock_announcement(p_id, p_expected_updated_at);
    status_value := target.status;
    publish_value := target.publish_at;
    current_status := survey_announcements.effective_status(target.status, target.publish_at, target.expires_at);
    if current_status = 'published' and p_publication <> 'keep' then
      raise exception 'Объявление уже опубликовано. Обновите список и откройте его снова.' using errcode = '40001';
    end if;
    if current_status = 'archived' then
      status_value := 'archived';
      if p_publication <> 'keep' then
        raise exception 'Для новой публикации создайте копию архивного объявления' using errcode = '22023';
      end if;
      if expires_value is distinct from target.expires_at then
        raise exception 'Объявление в архиве. Обновите список и откройте его снова.' using errcode = '40001';
      end if;
    end if;
  end if;
  if p_publication = 'publish' then
    status_value := 'published';
    publish_value := now();
  elsif p_publication = 'schedule' then
    if p_publish_at is null or not isfinite(p_publish_at) or p_publish_at <= now() then
      raise exception 'Выберите время публикации в будущем' using errcode = '22023';
    end if;
    status_value := 'published';
    publish_value := p_publish_at;
  end if;

  if expires_value is not null and (
    expires_value <= publish_value or (status_value = 'published' and expires_value <= now())
  ) then
    raise exception 'Окончание должно быть позже времени публикации' using errcode = '22023';
  end if;
  if p_id is null then
    insert into survey_announcements.announcements (
      title, message, audience, display_mode, require_acknowledgement, action_label, action_url, status, publish_at, expires_at
    ) values (
      title_value, message_value, audience_value, display_value, (p_fields->>'require_acknowledgement')::boolean,
      label_value, url_value, status_value, publish_value, expires_value
    ) returning id into p_id;
  else
    update survey_announcements.announcements a set
      title = title_value, message = message_value, audience = audience_value, display_mode = display_value,
      require_acknowledgement = (p_fields->>'require_acknowledgement')::boolean,
      action_label = label_value, action_url = url_value, status = status_value, publish_at = publish_value,
      expires_at = expires_value, updated_at = clock_timestamp()
    where a.id = p_id;
  end if;
  return p_id;
end;
$$;

create function public.change_announcement(p_id uuid, p_expected_updated_at timestamptz, p_action text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target survey_announcements.announcements%rowtype;
  result_id uuid := p_id;
begin
  perform survey_announcements.require_admin();
  target := survey_announcements.lock_announcement(p_id, p_expected_updated_at);
  case p_action
    when 'duplicate' then
      insert into survey_announcements.announcements (
        title, message, audience, display_mode, require_acknowledgement, action_label, action_url
      ) values (
        left(target.title, 112) || ' (копия)', target.message, target.audience, target.display_mode,
        target.require_acknowledgement, target.action_label, target.action_url
      ) returning id into result_id;
    when 'withdraw' then
      if survey_announcements.effective_status(target.status, target.publish_at, target.expires_at)
        not in ('published', 'scheduled') then
        raise exception 'Снять можно только опубликованное или запланированное объявление' using errcode = '22023';
      end if;
      update survey_announcements.announcements set status = 'draft', publish_at = null, updated_at = clock_timestamp()
      where id = p_id;
    when 'archive' then
      update survey_announcements.announcements set
        status = 'archived', publish_at = case when target.publish_at <= now() then target.publish_at end,
        updated_at = clock_timestamp()
      where id = p_id;
    else raise exception 'Неизвестное действие с объявлением' using errcode = '22023';
  end case;
  return result_id;
end;
$$;

create or replace function public.list_notification_feed(
  p_category text default null, p_read text default 'all', p_before_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 26
)
returns table (
  id uuid, category text, title text, message text, form_id uuid, response_id uuid, rule_id uuid,
  created_at timestamptz, read_at timestamptz, announcement jsonb
)
language sql stable security definer set search_path = '' as $$
  with viewer as (
    select auth.uid() as user_id, public.request_role() as role_name
  ), page_size as (
    select least(greatest(coalesce(p_limit, 26), 1), 101) as size
  ), candidates as (
    (select n.id, n.category, n.title, n.message, n.form_id, n.response_id, n.rule_id,
       n.created_at, n.read_at, null::jsonb as announcement
     from viewer v join public.notifications n on n.user_id = v.user_id
     where v.role_name is not null and n.category not in ('automation_triggered', 'automation_succeeded')
       and (p_category is null or n.category = p_category)
       and (p_read = 'all' or (p_read = 'unread' and n.read_at is null) or (p_read = 'read' and n.read_at is not null))
       and (p_before_at is null or (n.created_at, n.id) < (p_before_at, p_before_id))
     order by n.created_at desc, n.id desc limit (select size from page_size))
    union all
    (select a.id, 'announcement'::text, a.title, a.message, null::uuid, null::uuid, null::uuid, a.publish_at, s.read_at,
       jsonb_build_object('display_mode', a.display_mode, 'action_label', a.action_label, 'action_url', a.action_url,
         'require_acknowledgement', a.require_acknowledgement, 'acknowledged_at', s.acknowledged_at)
     from viewer v cross join survey_announcements.announcements a
     left join survey_announcements.recipient_state s on s.announcement_id = a.id and s.user_id = v.user_id
     where (p_category is null or p_category = 'announcement')
       and a.status = 'published'
       and survey_announcements.is_visible(a.status, a.publish_at, a.expires_at, a.audience, v.role_name)
       and (p_read = 'all' or (p_read = 'unread' and s.read_at is null) or (p_read = 'read' and s.read_at is not null))
       and (p_before_at is null or (a.publish_at, a.id) < (p_before_at, p_before_id))
     order by a.publish_at desc, a.id desc limit (select size from page_size))
  )
  select c.* from candidates c order by c.created_at desc, c.id desc limit (select size from page_size);
$$;

create or replace function public.notification_unread_count()
returns bigint language sql stable security definer set search_path = '' as $$
  with viewer as (select auth.uid() as user_id, public.request_role() as role_name)
  select
    (select count(*) from viewer v join public.notifications n on n.user_id = v.user_id
     where v.role_name is not null and n.category not in ('automation_triggered', 'automation_succeeded') and n.read_at is null)
    +
    (select count(*) from viewer v cross join survey_announcements.announcements a
     left join survey_announcements.recipient_state s on s.announcement_id = a.id and s.user_id = v.user_id
     where a.status = 'published'
       and survey_announcements.is_visible(a.status, a.publish_at, a.expires_at, a.audience, v.role_name)
       and s.read_at is null);
$$;

create or replace function public.mark_notifications_read(p_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  actor_role text := public.request_role();
  personal_count integer;
  announcement_count integer;
begin
  if actor_role is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  update public.notifications set read_at = now()
  where user_id = actor and category not in ('automation_triggered', 'automation_succeeded')
    and read_at is null and (p_id is null or id = p_id);
  get diagnostics personal_count = row_count;

  insert into survey_announcements.recipient_state as s (announcement_id, user_id, read_at)
  select a.id, actor, now() from survey_announcements.announcements a
  left join survey_announcements.recipient_state existing on existing.announcement_id = a.id and existing.user_id = actor
  where (p_id is null or a.id = p_id) and existing.read_at is null and a.status = 'published'
    and survey_announcements.is_visible(a.status, a.publish_at, a.expires_at, a.audience, actor_role)
  order by a.id
  on conflict (announcement_id, user_id) do update set read_at = excluded.read_at where s.read_at is null;
  get diagnostics announcement_count = row_count;
  return personal_count + announcement_count;
end;
$$;

-- A replacement retains its previous owner, which can differ from the new tables' owner.
alter function public.mark_notifications_read(uuid) owner to current_user;

create function public.acknowledge_announcement(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform from survey_announcements.announcements a where a.id = p_id and a.require_acknowledgement
    and survey_announcements.is_visible(a.status, a.publish_at, a.expires_at, a.audience, public.request_role())
  for share;
  if not found then raise exception 'Объявление недоступно для подтверждения' using errcode = '42501'; end if;

  insert into survey_announcements.recipient_state as s (announcement_id, user_id, read_at, acknowledged_at)
  values (p_id, auth.uid(), now(), now())
  on conflict (announcement_id, user_id) do update
  set read_at = coalesce(s.read_at, excluded.read_at), acknowledged_at = excluded.acknowledged_at
  where s.acknowledged_at is null;
end;
$$;

create function public.list_announcement_prompts(p_visible_ids uuid[] default '{}'::uuid[])
returns table (
  id uuid, title text, message text, action_label text, action_url text, display_mode text,
  require_acknowledgement boolean, read_at timestamptz, acknowledged_at timestamptz, expires_at timestamptz,
  presented_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  with viewer as (
    select auth.uid() as user_id, public.request_role() as role_name
  ), eligible as (
    select a.*, s.read_at, s.acknowledged_at, s.presented_at
    from viewer v cross join survey_announcements.announcements a
    left join survey_announcements.recipient_state s on s.announcement_id = a.id and s.user_id = v.user_id
    where a.status = 'published' and a.display_mode in ('banner', 'modal')
      and survey_announcements.is_visible(a.status, a.publish_at, a.expires_at, a.audience, v.role_name)
  ), next_by_mode as (
    select distinct on (e.display_mode) e.id from eligible e
    where e.presented_at is null and e.read_at is null
    order by e.display_mode, e.publish_at desc, e.id desc
  )
  select e.id, e.title, e.message, e.action_label, e.action_url, e.display_mode, e.require_acknowledgement,
    e.read_at, e.acknowledged_at, e.expires_at, e.presented_at
  from eligible e
  where e.id in (select n.id from next_by_mode n) or e.id = any(p_visible_ids[1:2])
  order by e.publish_at desc, e.id desc;
$$;

create function public.claim_announcement_prompt(p_id uuid, p_mode text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform from survey_announcements.announcements a
  where a.id = p_id and a.display_mode = p_mode and p_mode in ('banner', 'modal')
    and survey_announcements.is_visible(a.status, a.publish_at, a.expires_at, a.audience, public.request_role())
  for share;
  if not found then return false; end if;

  insert into survey_announcements.recipient_state as s (announcement_id, user_id, presented_at)
  values (p_id, auth.uid(), now())
  on conflict (announcement_id, user_id) do update set presented_at = excluded.presented_at
  where s.presented_at is null and s.read_at is null;
  return found;
end;
$$;

revoke all on all tables in schema survey_announcements from public, anon, authenticated;
revoke all on all functions in schema survey_announcements from public, anon, authenticated;
revoke all on function public.list_admin_announcements(text, timestamptz, uuid, integer),
  public.save_announcement(uuid, timestamptz, jsonb, text, timestamptz), public.change_announcement(uuid, timestamptz, text),
  public.list_notification_feed(text, text, timestamptz, uuid, integer), public.notification_unread_count(),
  public.mark_notifications_read(uuid), public.acknowledge_announcement(uuid),
  public.list_announcement_prompts(uuid[]), public.claim_announcement_prompt(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.list_admin_announcements(text, timestamptz, uuid, integer),
  public.save_announcement(uuid, timestamptz, jsonb, text, timestamptz), public.change_announcement(uuid, timestamptz, text),
  public.list_notification_feed(text, text, timestamptz, uuid, integer), public.notification_unread_count(),
  public.mark_notifications_read(uuid), public.acknowledge_announcement(uuid),
  public.list_announcement_prompts(uuid[]), public.claim_announcement_prompt(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
