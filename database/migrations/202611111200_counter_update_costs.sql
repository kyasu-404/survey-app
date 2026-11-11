begin;

-- Counting a response must retain the strict form row lock, but does not
-- require serializing NEW/OLD schema and theme to decide the form revision.
-- Include revision itself to retain the existing protection against direct
-- revision assignments. Keep this list in sync when adding form metadata.
drop trigger if exists forms_increment_revision on public.forms;
create trigger forms_increment_revision
before update of id, title, form_type, form_reason, schema, theme, is_public,
  deadline_at, max_responses, allow_response_editing, personal_links_enabled,
  organization_types, author_id, author_name, revision, created_at on public.forms
for each row execute procedure public.increment_form_revision();

commit;
