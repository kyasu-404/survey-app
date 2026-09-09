begin;

set local lock_timeout = '5s';

set local statement_timeout = '60s';

-- Account suspension restricts the actor, not the forms they authored.
-- Staff share read access; author/admin management and browser edit tokens remain unchanged.

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

alter policy "forms_select" on public.forms
using ((select public.request_is_enabled()));

drop policy if exists "responses_select_author_or_admin" on public.responses;

drop policy if exists "responses_select_enabled_staff" on public.responses;

create policy "responses_select_enabled_staff"
on public.responses
for select
to authenticated
using ((select public.request_is_enabled()));

notify pgrst, 'reload schema';

commit;
