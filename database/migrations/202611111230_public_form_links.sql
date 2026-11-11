begin;

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
revoke select on table public.forms from anon;
-- A table-level REVOKE does not remove legacy column-level ACLs.
do $$ declare columns text; begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into columns
  from pg_attribute where attrelid = 'public.forms'::regclass and attnum > 0 and not attisdropped;
  execute 'revoke select (' || columns || ') on table public.forms from anon';
end $$;
drop policy if exists "forms_select_anon" on public.forms;
select pg_notify('pgrst', 'reload schema');
commit;
