begin;

revoke update on table public.forms from authenticated;
grant update (title, schema, form_type, form_reason, is_public, deadline_at, max_responses) on table public.forms to authenticated;

commit;
