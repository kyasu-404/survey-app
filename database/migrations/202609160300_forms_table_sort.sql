begin;

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
      sort_expression := '(case when f.max_responses > 0 and f.responses_count >= f.max_responses then false when f.deadline_at is not null then f.deadline_at > $1 else f.is_public end)';
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
      and ($8 is null or f.is_public = $8)
      and ($9 is null or ((%1$s), f.id) %2$s (($10)::%3$s, $9))
    order by %1$s %4$s, f.id %4$s
    limit $11
  $query$, sort_expression, comparison, sort_type, p_sort_direction)
  using reference_time, p_search, p_date_from, p_date_to, p_author_id,
    p_form_type, p_form_reason, p_is_public, p_after_id, p_after_value, p_page_size + 1;
end;
$$;

revoke all on function public.list_forms_sorted(text, text, integer, uuid, text, timestamptz, text, timestamptz, timestamptz, uuid, text, text, boolean) from public, anon;
grant execute on function public.list_forms_sorted(text, text, integer, uuid, text, timestamptz, text, timestamptz, timestamptz, uuid, text, text, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
