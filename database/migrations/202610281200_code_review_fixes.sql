begin;

-- Additive bookkeeping: lease failed cleanup attempts and distinguish new save errors.
alter table public.survey_upload_reservations add column if not exists cleanup_claimed_at timestamptz;
alter table public.office_documents add column if not exists last_save_error_at timestamptz;

create or replace function public.escape_forms_search(search_text text)
returns text
language sql immutable strict parallel safe
set search_path = ''
as $$
  select replace(replace(replace(search_text, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');
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
      ) = p_is_public
    );
$$;

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
      and ($8 is null or (f.is_public and (f.deadline_at is null or f.deadline_at > now())) = $8)
      and ($9 is null or ((%1$s), f.id) %2$s (($10)::%3$s, $9))
    order by %1$s %4$s, f.id %4$s
    limit $11
  $query$, sort_expression, comparison, sort_type, p_sort_direction)
  using reference_time, public.escape_forms_search(p_search), p_date_from, p_date_to, p_author_id,
    p_form_type, p_form_reason, p_is_public, p_after_id, p_after_value, p_page_size + 1;
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

create or replace function public.list_expired_survey_uploads(batch_limit integer default 100)
returns table (name text)
language sql volatile security definer set search_path = ''
as $$
  with candidates as (
    select r.object_path from public.survey_upload_reservations r
    where r.expires_at < now() and not r.attached
      and (not r.cleanup_claimed or r.cleanup_claimed_at is null
        or r.cleanup_claimed_at < now() - interval '10 minutes')
      and exists (select 1 from storage.objects o where o.bucket_id = 'survey-files' and o.name = r.object_path)
      and not exists (select 1 from public.response_file_references rf where rf.object_path = r.object_path)
    order by r.expires_at, r.object_path limit least(greatest(batch_limit, 1), 500)
    for update skip locked
  )
  update public.survey_upload_reservations r set cleanup_claimed = true, cleanup_claimed_at = now()
  from candidates c where r.object_path = c.object_path and not r.attached
  returning r.object_path;
$$;

revoke all on function public.escape_forms_search(text) from public;
grant execute on function public.escape_forms_search(text) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
