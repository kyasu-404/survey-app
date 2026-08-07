begin;

alter table public.forms
  add column if not exists revision bigint not null default 0;

alter table public.forms
  add constraint forms_title_length check (length(btrim(title)) between 1 and 500) not valid;
alter table public.forms
  add constraint forms_type_valid check (
    form_type in ('template', 'anketa', 'voting', 'request', 'monitoring', 'survey', 'sample', 'other')
  ) not valid;
alter table public.forms
  add constraint forms_reason_valid check (
    form_reason in ('request', 'plan', 'order', 'directive', 'other')
  ) not valid;

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

drop trigger if exists forms_increment_revision on public.forms;
create trigger forms_increment_revision
before update on public.forms
for each row execute procedure public.increment_form_revision();

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

drop trigger if exists responses_validate_payload on public.responses;
create trigger responses_validate_payload
before insert or update of form_id, data on public.responses
for each row execute procedure public.validate_response_payload();

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

-- Existing raw browser capabilities must not remain observable through
-- replication/WAL payloads. RPCs below hash every caller-provided value again.
update public.responses
set browser_id = public.browser_capability_hash(browser_id)
where browser_id is not null;

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

  select f.* into target_form
  from public.forms f
  join public.profiles p on p.id = f.author_id
  where f.id = p_form_id and p.is_disabled = false;
  if target_form.id is null then return; end if;

  select r.* into existing_response
  from public.responses r
  where r.form_id = p_form_id
    and r.browser_id = public.browser_capability_hash(p_browser_id);
  if existing_response.id is null then return; end if;

  return query select
    existing_response.id,
    existing_response.data,
    target_form.allow_response_editing
      and target_form.is_public
      and (target_form.deadline_at is null or target_form.deadline_at > now());
end;
$$;

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
  select f.* into target_form
  from public.forms f
  join public.profiles p on p.id = f.author_id
  where f.id = p_form_id and p.is_disabled = false;
  if target_form.id is null then
    raise exception 'Форма не найдена или недоступна' using errcode = 'P0002';
  end if;
  if not public.response_data_matches_form(target_form.schema, target_form.organization_types, p_data) then
    raise exception 'Ответ не соответствует структуре формы' using errcode = '22023';
  end if;

  select r.* into existing_response
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
  if not target_form.is_public or (target_form.deadline_at is not null and target_form.deadline_at <= now()) then
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
returns table (response_id uuid, response_data jsonb)
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
  select f.* into target_form
  from public.forms f
  join public.profiles p on p.id = f.author_id
  where f.id = p_form_id and p.is_disabled = false;
  if target_form.id is null then
    raise exception 'Форма не найдена или недоступна' using errcode = 'P0002';
  end if;
  if not public.response_data_matches_form(target_form.schema, target_form.organization_types, p_data) then
    raise exception 'Ответ не соответствует структуре формы' using errcode = '22023';
  end if;
  if not target_form.allow_response_editing then
    raise exception 'Редактирование ответов отключено' using errcode = '42501';
  end if;
  if not target_form.is_public or (target_form.deadline_at is not null and target_form.deadline_at <= now()) then
    raise exception 'Форма закрыта для редактирования ответов' using errcode = '42501';
  end if;

  update public.responses r
  set data = p_data, updated_at = now()
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

revoke all on function public.response_data_matches_form(jsonb, text[], jsonb) from public;
revoke all on function public.validate_response_payload() from public;
revoke all on function public.browser_capability_hash(uuid) from public;
grant execute on function public.browser_capability_hash(uuid) to service_role;
grant execute on function public.response_data_matches_form(jsonb, text[], jsonb) to service_role;

revoke select on table public.responses from authenticated;
grant select (id, form_id, data, created_at, updated_at) on table public.responses to authenticated;

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
    count(*)::bigint,
    count(*) filter (
      where f.is_public = true
        and (f.deadline_at is null or f.deadline_at > now())
    )::bigint,
    count(*) filter (where f.deadline_at > now())::bigint
  from public.forms f
  where f.form_type <> 'template'
    and (p_search is null or p_search = '' or f.title ilike '%' || p_search || '%' or f.author_name ilike '%' || p_search || '%')
    and (p_date_from is null or f.created_at >= p_date_from)
    and (p_date_to is null or f.created_at <= p_date_to)
    and (p_author_id is null or f.author_id = p_author_id)
    and (p_form_type is null or f.form_type = p_form_type)
    and (p_form_reason is null or f.form_reason = p_form_reason)
    and (
      p_is_public is null
      or (f.is_public = true and (f.deadline_at is null or f.deadline_at > now())) = p_is_public
    );
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mail-reminder/' || p_form_id::text, 0));
  if exists (
    select 1 from public.mail_queue q
    where q.form_id = p_form_id and q.status in ('queued', 'processing')
  ) then
    raise exception 'Previous reminder run is still active' using errcode = '55000';
  end if;

  insert into public.mail_batches (id, kind, form_id, created_by, total_count)
  values (p_batch_id, 'reminder', p_form_id, p_created_by, job_count);

  insert into public.mail_queue (
    batch_id, form_id, organization_id, recipient_email, recipient_name, subject, body_text
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

revoke all on function public.enqueue_mail_reminder_batch(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.enqueue_mail_reminder_batch(uuid, uuid, uuid, jsonb) to service_role;

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
      select 1 from public.response_file_references reference
      where reference.object_path = o.name
    )
  order by o.created_at, o.id
  limit least(greatest(batch_limit, 1), 1000);
$$;

commit;
