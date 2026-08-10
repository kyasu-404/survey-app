begin;

create table if not exists public.storage_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_type text not null check (trigger_type in ('scheduled', 'manual')),
  requested_by uuid references public.profiles(id) on delete set null,
  worker_id text not null,
  retention_hours integer not null default 168 check (retention_hours between 168 and 720),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  removed_files integer not null default 0 check (removed_files >= 0),
  removed_assets integer not null default 0 check (removed_assets >= 0),
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint storage_cleanup_runs_worker_length check (length(btrim(worker_id)) between 1 and 200),
  constraint storage_cleanup_runs_error_length check (error is null or length(error) <= 2000),
  constraint storage_cleanup_runs_finished_state check (
    (status = 'running' and finished_at is null)
    or (status in ('succeeded', 'failed') and finished_at is not null)
  )
);

alter table public.storage_cleanup_runs enable row level security;
revoke all on table public.storage_cleanup_runs from anon, authenticated;
grant select, insert, update, delete on table public.storage_cleanup_runs to service_role;

create index if not exists idx_storage_cleanup_runs_started_at
on public.storage_cleanup_runs(started_at desc);

create unique index if not exists idx_storage_cleanup_runs_one_active
on public.storage_cleanup_runs ((true))
where status = 'running';

create or replace function public.confirm_orphan_survey_files(
  cutoff timestamptz,
  object_names text[]
)
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where cardinality(object_names) between 1 and 500
    and o.bucket_id = 'survey-files'
    and o.name = any(object_names)
    and o.created_at < cutoff
    and not exists (
      select 1 from public.response_file_references rf
      where rf.object_path = o.name
    )
  order by o.name;
$$;

create or replace function public.list_orphan_survey_assets(
  cutoff timestamptz default (now() - interval '168 hours'),
  batch_limit integer default 500
)
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'survey-assets'
    and o.created_at < cutoff
    and o.name ~* '^forms/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
    and not exists (
      select 1 from public.forms f
      where f.id = split_part(o.name, '/', 2)::uuid
    )
  order by o.created_at, o.id
  limit least(greatest(batch_limit, 1), 1000);
$$;

create or replace function public.confirm_orphan_survey_assets(
  cutoff timestamptz,
  object_names text[]
)
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where cardinality(object_names) between 1 and 500
    and o.bucket_id = 'survey-assets'
    and o.name = any(object_names)
    and o.created_at < cutoff
    and o.name ~* '^forms/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
    and not exists (
      select 1 from public.forms f
      where f.id = split_part(o.name, '/', 2)::uuid
    )
  order by o.name;
$$;

create or replace function public.begin_storage_cleanup_run(
  p_trigger_type text,
  p_worker_id text,
  p_retention_hours integer default 168,
  p_requested_by uuid default null,
  p_min_interval_hours integer default 0
)
returns setof public.storage_cleanup_runs
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_trigger_type is null
    or p_trigger_type not in ('scheduled', 'manual')
    or p_worker_id is null
    or length(btrim(p_worker_id)) not between 1 and 200
    or p_retention_hours is null
    or p_retention_hours not between 168 and 720
    or p_min_interval_hours is null
    or p_min_interval_hours not between 0 and 168
  then
    raise exception 'Invalid storage cleanup run' using errcode = '22023';
  end if;

  if p_trigger_type = 'manual' and not exists (
    select 1
    from public.profiles p
    where p.id = p_requested_by
      and p.role = 'admin'
      and p.is_disabled = false
  ) then
    raise exception 'Storage cleanup requires an enabled administrator' using errcode = '42501';
  end if;

  if p_trigger_type = 'scheduled' and p_requested_by is not null then
    raise exception 'Scheduled cleanup cannot have a requester' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('storage-cleanup-run', 0)
  );

  update public.storage_cleanup_runs run
  set status = 'failed',
      error = 'Предыдущая очистка была прервана',
      finished_at = now()
  where run.status = 'running'
    and run.started_at < now() - interval '1 hour';

  if exists (
    select 1 from public.storage_cleanup_runs run where run.status = 'running'
  ) then
    return;
  end if;

  if p_trigger_type = 'scheduled' and p_min_interval_hours > 0 and exists (
    select 1
    from public.storage_cleanup_runs run
    where run.status = 'succeeded'
      and run.finished_at > now() - make_interval(hours => p_min_interval_hours)
  ) then
    return;
  end if;

  return query
  insert into public.storage_cleanup_runs (
    trigger_type,
    requested_by,
    worker_id,
    retention_hours
  ) values (
    p_trigger_type,
    p_requested_by,
    btrim(p_worker_id),
    p_retention_hours
  )
  returning *;
end;
$$;

create or replace function public.finish_storage_cleanup_run(
  p_run_id uuid,
  p_worker_id text,
  p_success boolean,
  p_removed_files integer,
  p_removed_assets integer,
  p_error text default null
)
returns setof public.storage_cleanup_runs
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_run_id is null
    or p_worker_id is null
    or length(btrim(p_worker_id)) not between 1 and 200
    or p_success is null
    or p_removed_files is null
    or p_removed_files < 0
    or p_removed_assets is null
    or p_removed_assets < 0
  then
    raise exception 'Invalid storage cleanup result' using errcode = '22023';
  end if;

  return query
  update public.storage_cleanup_runs run
  set status = case when p_success then 'succeeded' else 'failed' end,
      removed_files = p_removed_files,
      removed_assets = p_removed_assets,
      error = case
        when p_success then null
        else left(coalesce(nullif(btrim(p_error), ''), 'Неизвестная ошибка очистки'), 2000)
      end,
      finished_at = now()
  where run.id = p_run_id
    and run.status = 'running'
    and run.worker_id = btrim(p_worker_id)
  returning run.*;
end;
$$;

revoke all on function public.confirm_orphan_survey_files(timestamptz, text[]) from public;
revoke all on function public.list_orphan_survey_assets(timestamptz, integer) from public;
revoke all on function public.confirm_orphan_survey_assets(timestamptz, text[]) from public;
revoke all on function public.begin_storage_cleanup_run(text, text, integer, uuid, integer) from public;
revoke all on function public.finish_storage_cleanup_run(uuid, text, boolean, integer, integer, text) from public;

grant execute on function public.confirm_orphan_survey_files(timestamptz, text[]) to service_role;
grant execute on function public.list_orphan_survey_assets(timestamptz, integer) to service_role;
grant execute on function public.confirm_orphan_survey_assets(timestamptz, text[]) to service_role;
grant execute on function public.begin_storage_cleanup_run(text, text, integer, uuid, integer) to service_role;
grant execute on function public.finish_storage_cleanup_run(uuid, text, boolean, integer, integer, text) to service_role;

commit;
