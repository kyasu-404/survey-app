begin;

create extension if not exists "pg_trgm";

create index if not exists idx_forms_created_at_id
  on public.forms(created_at desc, id desc);

create index if not exists idx_forms_author_created_at_id
  on public.forms(author_id, created_at desc, id desc);

create index if not exists idx_responses_form_created_at_id
  on public.responses(form_id, created_at desc, id desc);

create index if not exists idx_forms_title_trgm
  on public.forms using gin (title gin_trgm_ops);

create index if not exists idx_forms_author_name_trgm
  on public.forms using gin (author_name gin_trgm_ops);

commit;
