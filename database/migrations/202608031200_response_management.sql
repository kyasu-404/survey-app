begin;

alter table public.forms
add column if not exists allow_response_editing boolean not null default false;

alter table public.responses
add column if not exists browser_id uuid;

alter table public.responses
add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_responses_form_browser_id
on public.responses(form_id, browser_id)
where browser_id is not null;

create or replace function public.prevent_answered_form_schema_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.responses_count > 0 and new.schema is distinct from old.schema then
    raise exception 'У формы уже есть ответы. Создайте её копию, чтобы не нарушить существующие данные.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists forms_prevent_answered_schema_update on public.forms;
create trigger forms_prevent_answered_schema_update
before update of schema on public.forms
for each row execute procedure public.prevent_answered_form_schema_update();

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

  select r.*
  into existing_response
  from public.responses r
  where r.form_id = p_form_id
    and r.browser_id = p_browser_id;

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
  values (p_form_id, p_browser_id, p_submission_id, p_data)
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
    and r.browser_id = p_browser_id
  returning r.* into updated_response;

  if updated_response.id is null then
    raise exception 'Ответ не найден' using errcode = 'P0002';
  end if;

  return query select updated_response.id, updated_response.data;
end;
$$;

revoke all on function public.submit_form_response(uuid, uuid, uuid, jsonb) from public;
revoke all on function public.update_form_response(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.submit_form_response(uuid, uuid, uuid, jsonb) to anon, authenticated, service_role;
grant execute on function public.update_form_response(uuid, uuid, uuid, jsonb) to anon, authenticated, service_role;

revoke insert on table public.responses from anon, authenticated;

revoke insert on table public.forms from authenticated;
grant insert (
  id, title, schema, theme, form_type, form_reason, is_public, deadline_at,
  max_responses, allow_response_editing, author_id
) on table public.forms to authenticated;

revoke update on table public.forms from authenticated;
grant update (
  title, schema, theme, form_type, form_reason, is_public, deadline_at,
  max_responses, allow_response_editing
) on table public.forms to authenticated;

commit;
