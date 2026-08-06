begin;

drop trigger if exists forms_prevent_answered_schema_update on public.forms;
drop function if exists public.prevent_answered_form_schema_update();

-- Schema updates are compatibility-checked by the authenticated form-admin
-- Edge Function. Authenticated PostgREST clients must not bypass that check.
revoke update (schema, organization_types) on table public.forms from authenticated;

commit;
