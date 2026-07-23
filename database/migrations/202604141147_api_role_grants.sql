begin;

grant usage on schema public to anon, authenticated, service_role;

grant select on table public.profiles to authenticated;
revoke update on table public.profiles from authenticated;
grant update (name) on table public.profiles to authenticated;

grant select on table public.forms to anon;
grant select, insert, delete on table public.forms to authenticated;
revoke update on table public.forms from authenticated;
grant update (title, schema, form_type, form_reason, is_public, deadline_at, max_responses) on table public.forms to authenticated;

grant insert on table public.responses to anon;
grant select, insert on table public.responses to authenticated;

grant select, insert, update, delete on table public.profiles, public.forms, public.responses to service_role;

commit;
