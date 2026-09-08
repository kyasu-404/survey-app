begin;

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

notify pgrst, 'reload schema';

commit;
