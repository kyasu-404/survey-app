begin;

create index if not exists idx_forms_created_at
  on public.forms(created_at desc);

create index if not exists idx_forms_author_created_at
  on public.forms(author_id, created_at desc);

commit;
