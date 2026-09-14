begin;
create table public.office_generation_results (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  template_id uuid references public.office_documents(id) on delete set null,
  name text not null,
  file_type text not null check(file_type in ('docx','xlsx')),
  storage_path text not null unique,
  files jsonb not null check(jsonb_typeof(files)='array' and jsonb_array_length(files) between 1 and 500),
  size_bytes bigint not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index office_results_form_idx on public.office_generation_results(form_id,created_at desc);
alter table public.office_generation_results enable row level security;
revoke all on public.office_generation_results from anon,authenticated;
grant all on public.office_generation_results to service_role;
create trigger office_results_cleanup after delete on public.office_generation_results
for each row execute function public.office_queue_storage_cleanup();
update storage.buckets set allowed_mime_types=array['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/zip'] where id='survey-documents';
commit;
