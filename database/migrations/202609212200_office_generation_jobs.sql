begin;
create table public.office_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  template_id uuid references public.office_documents(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  name text not null,
  file_type text not null check(file_type in ('docx','xlsx')),
  storage_path text not null,
  state text not null default 'queued' check(state in ('queued','running','succeeded','failed')),
  payload jsonb,
  payload_bytes integer not null check(payload_bytes between 0 and 8388608),
  attempts integer not null default 0,
  attempt_token uuid,
  available_at timestamptz not null default now(),
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index office_jobs_pending on public.office_generation_jobs(created_at,id) where state in ('queued','running');
create index office_jobs_storage on public.office_generation_jobs(storage_path) where state in ('queued','running');
create index office_jobs_form on public.office_generation_jobs(form_id,created_at desc);
alter table public.office_generation_jobs enable row level security;
revoke all on public.office_generation_jobs from anon,authenticated;
grant all on public.office_generation_jobs to service_role, postgres;
create or replace function public.list_orphan_office_documents(
  cutoff timestamptz default (now() - interval '168 hours'), batch_limit integer default 500
)
returns table (name text) language sql stable security definer set search_path = '' as $$
  select o.name from storage.objects o where o.bucket_id='survey-documents'
    and o.created_at < least(cutoff, now() - interval '168 hours')
    and o.name ~ '^forms/[0-9a-f-]{36}/(documents/[0-9a-f-]{36}/[0-9a-f-]{36}\.(docx|xlsx)|results/[0-9a-f-]{36}\.zip)$'
    and not exists (select 1 from public.office_documents d where d.storage_path=o.name)
    and not exists (select 1 from public.office_generation_results r where r.storage_path=o.name)
    and not exists (select 1 from public.office_generation_jobs j where j.storage_path=o.name and j.state in ('queued','running'))
    -- Superseded objects can still be used by a one-hour editor capability.
    and not exists (select 1 from public.office_storage_cleanup q where q.storage_path=o.name and q.created_at>=now()-interval '2 hours')
  order by o.created_at,o.id limit least(greatest(batch_limit,1),500);
$$;
create or replace function public.confirm_orphan_office_documents(cutoff timestamptz, object_names text[])
returns table (name text) language sql stable security definer set search_path = '' as $$
  select o.name from storage.objects o where o.bucket_id='survey-documents'
    and cardinality(object_names) between 1 and 500 and o.name=any(object_names)
    and o.created_at < least(cutoff, now() - interval '168 hours')
    and o.name ~ '^forms/[0-9a-f-]{36}/(documents/[0-9a-f-]{36}/[0-9a-f-]{36}\.(docx|xlsx)|results/[0-9a-f-]{36}\.zip)$'
    and not exists (select 1 from public.office_documents d where d.storage_path=o.name)
    and not exists (select 1 from public.office_generation_results r where r.storage_path=o.name)
    and not exists (select 1 from public.office_generation_jobs j where j.storage_path=o.name and j.state in ('queued','running'))
    -- Superseded objects can still be used by a one-hour editor capability.
    and not exists (select 1 from public.office_storage_cleanup q where q.storage_path=o.name and q.created_at>=now()-interval '2 hours')
  order by o.name;
$$;

commit;
