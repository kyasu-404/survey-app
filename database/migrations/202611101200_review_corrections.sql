begin;

-- Atomic deletion, employee Auth/profile state, and effective activity filters.
-- Existing forms/responses are not rewritten.

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

revoke all on function public.get_dashboard_forms_stats(text, timestamptz, timestamptz, uuid, text, text, boolean) from public;
grant execute on function public.get_dashboard_forms_stats(text, timestamptz, timestamptz, uuid, text, text, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
