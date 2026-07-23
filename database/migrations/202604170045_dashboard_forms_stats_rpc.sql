begin;

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

commit;
