begin;
alter table public.storage_cleanup_runs add column removed_documents integer not null default 0 check (removed_documents>=0);
create or replace function public.list_orphan_office_documents(
  cutoff timestamptz default (now() - interval '168 hours'), batch_limit integer default 500
)
returns table (name text) language sql stable security definer set search_path = '' as $$
  select o.name from storage.objects o where o.bucket_id='survey-documents'
    and o.created_at < least(cutoff, now() - interval '168 hours')
    and o.name ~ '^forms/[0-9a-f-]{36}/(documents/[0-9a-f-]{36}/[0-9a-f-]{36}\.(docx|xlsx)|results/[0-9a-f-]{36}\.zip)$'
    and not exists (select 1 from public.office_documents d where d.storage_path=o.name)
    and not exists (select 1 from public.office_generation_results r where r.storage_path=o.name)
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
    -- Superseded objects can still be used by a one-hour editor capability.
    and not exists (select 1 from public.office_storage_cleanup q where q.storage_path=o.name and q.created_at>=now()-interval '2 hours')
  order by o.name;
$$;
revoke all on function public.list_orphan_office_documents(timestamptz,integer) from public;
revoke all on function public.confirm_orphan_office_documents(timestamptz,text[]) from public;
grant execute on function public.list_orphan_office_documents(timestamptz,integer) to service_role;
grant execute on function public.confirm_orphan_office_documents(timestamptz,text[]) to service_role;

-- Keep old callers working through the new optional final parameter.
drop function public.finish_storage_cleanup_run(uuid,text,boolean,integer,integer,text);
create or replace function public.finish_storage_cleanup_run(
  p_run_id uuid,
  p_worker_id text,
  p_success boolean,
  p_removed_files integer,
  p_removed_assets integer,
  p_error text default null,
  p_removed_documents integer default 0
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
    or p_removed_documents is null
    or p_removed_documents < 0
  then
    raise exception 'Invalid storage cleanup result' using errcode = '22023';
  end if;

  return query
  update public.storage_cleanup_runs run
  set status = case when p_success then 'succeeded' else 'failed' end,
      removed_files = p_removed_files,
      removed_assets = p_removed_assets,
      removed_documents = p_removed_documents,
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

revoke all on function public.finish_storage_cleanup_run(uuid,text,boolean,integer,integer,text,integer) from public;
grant execute on function public.finish_storage_cleanup_run(uuid,text,boolean,integer,integer,text,integer) to service_role;
notify pgrst, 'reload schema';
commit;
