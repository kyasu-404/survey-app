begin;

create table public.survey_upload_reservations (
  object_path text primary key,
  form_id uuid not null references public.forms(id) on delete cascade,
  browser_hash uuid not null,
  client_hash text not null check (client_hash ~ '^[a-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes between 0 and 10485760),
  attached boolean not null default false,
  cleanup_claimed boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '8 hours')
);
alter table public.survey_upload_reservations enable row level security;
revoke all on table public.survey_upload_reservations from anon, authenticated;
grant all on table public.survey_upload_reservations to service_role, postgres;
create index survey_upload_reservations_browser on public.survey_upload_reservations(form_id, browser_hash, expires_at);
create index survey_upload_reservations_client on public.survey_upload_reservations(client_hash, created_at);
create index survey_upload_reservations_expiry on public.survey_upload_reservations(expires_at);
create index survey_files_form_quota on storage.objects ((split_part(name, '/', 2))) where bucket_id = 'survey-files';

create or replace function public.reserve_survey_upload(p_form_id uuid, p_browser_id uuid, p_client_hash text, p_size bigint, p_extension text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  object_path text;
  pending_count bigint;
  pending_bytes bigint;
  total_count bigint;
  total_bytes bigint;
begin
  if p_browser_id is null or p_client_hash is null or p_client_hash !~ '^[a-f0-9]{64}$'
    or p_size is null or p_size not between 0 and 10485760
    or p_extension is null or p_extension !~ '^([.][a-zA-Z0-9]{1,16})?$'
  then raise exception 'Некорректные параметры файла' using errcode = '22023'; end if;
  if not public.is_public_active_form(p_form_id) then
    raise exception 'Форма закрыта для загрузки' using errcode = '42501';
  end if;
  -- Always take locks in this order. The client budget spans forms and browsers.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('survey-upload-client/' || p_client_hash, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('survey-files/' || p_form_id::text, 0));
  select count(*), coalesce(sum(r.size_bytes), 0) into pending_count, pending_bytes
  from public.survey_upload_reservations r
  where r.client_hash = p_client_hash and r.created_at > now() - interval '8 hours';
  if pending_count >= 500 or pending_bytes + p_size > 104857600 then
    raise exception 'Лимит загрузок с вашего адреса исчерпан. Повторите позже.' using errcode = '54000';
  end if;
  select count(*), coalesce(sum(r.size_bytes), 0) into pending_count, pending_bytes
  from public.survey_upload_reservations r
  where r.form_id = p_form_id and r.browser_hash = public.browser_capability_hash(p_browser_id)
    and r.expires_at > now()
    and not exists (select 1 from public.response_file_references rf where rf.object_path = r.object_path);
  if pending_count >= 20 or pending_bytes + p_size > 104857600 then
    raise exception 'Сначала отправьте ответ или удалите ненужные файлы.' using errcode = '54000';
  end if;
  select count(*), coalesce(sum(coalesce((o.metadata->>'size')::bigint, 10485760)), 0)
    into total_count, total_bytes from storage.objects o
    where o.bucket_id = 'survey-files' and split_part(o.name, '/', 2) = p_form_id::text;
  select count(*), coalesce(sum(r.size_bytes), 0) into pending_count, pending_bytes
    from public.survey_upload_reservations r
    where r.form_id = p_form_id and r.expires_at > now()
      and not exists (select 1 from storage.objects o where o.bucket_id = 'survey-files' and o.name = r.object_path);
  if total_count + pending_count >= 2000 or total_bytes + pending_bytes + p_size > 2147483648 then
    raise exception 'Хранилище формы заполнено. Обратитесь к автору формы.' using errcode = '54000';
  end if;
  object_path := 'public/' || p_form_id::text || '/' || gen_random_uuid()::text || lower(p_extension);
  insert into public.survey_upload_reservations(object_path, form_id, browser_hash, client_hash, size_bytes)
    values (object_path, p_form_id, public.browser_capability_hash(p_browser_id), p_client_hash, p_size);
  return object_path;
end;
$$;
revoke all on function public.reserve_survey_upload(uuid,uuid,text,bigint,text) from public, anon, authenticated;
grant execute on function public.reserve_survey_upload(uuid,uuid,text,bigint,text) to service_role;

create or replace function public.can_upload_survey_file(
  object_name text,
  anonymous_request boolean,
  object_size bigint
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  path_parts text[] := string_to_array(object_name, '/');
  target_form_id uuid;
  existing_count bigint;
  existing_bytes bigint;
  reserved_count bigint := 0;
  reserved_bytes bigint := 0;
begin
  if array_length(path_parts, 1) <> 3
    or length(path_parts[3]) > 512
    or object_size < 0
    or object_size > 10485760
  then
    return false;
  end if;

  if anonymous_request then
    if auth.uid() is not null or path_parts[1] <> 'public' then return false; end if;
  else
    if not public.request_is_enabled() or path_parts[1] <> auth.uid()::text then return false; end if;
  end if;

  begin
    target_form_id := path_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if not exists (
    select 1 from public.forms f
    where f.id = target_form_id
      and (
        public.is_public_active_form(f.id)
        or (not anonymous_request and (f.author_id = auth.uid() or public.request_role() = 'admin'))
      )
  ) then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('survey-files/' || target_form_id::text, 0));

  select count(*), coalesce(sum(
    case
      when coalesce(o.metadata ->> 'size', '') ~ '^[0-9]{1,20}$'
        then least((o.metadata ->> 'size')::numeric, 10485760)::bigint
      else 10485760
    end
  ), 0)
  into existing_count, existing_bytes
  from storage.objects o
  where o.bucket_id = 'survey-files'
    and split_part(o.name, '/', 2) = target_form_id::text;

  -- New anonymous objects must hold an opaque reservation minted by the server.
  -- Reading/deleting already attached legacy objects keeps its existing policy.
  if anonymous_request and not exists (
    select 1 from public.survey_upload_reservations r where r.object_path = object_name
      and r.form_id = target_form_id and r.expires_at > now() and object_size <= r.size_bytes
  ) then return false; end if;
  select count(*), coalesce(sum(r.size_bytes), 0) into reserved_count, reserved_bytes
  from public.survey_upload_reservations r
  where r.form_id = target_form_id and r.expires_at > now() and r.object_path <> object_name
    and not exists (select 1 from storage.objects o where o.bucket_id = 'survey-files' and o.name = r.object_path);
  return existing_count + reserved_count < 2000
    and existing_bytes + reserved_bytes + object_size <= 2147483648;
end;
$$;

create or replace function public.list_expired_survey_uploads(batch_limit integer default 100)
returns table (name text)
language sql volatile security definer set search_path = ''
as $$
  with candidates as (
    select r.object_path from public.survey_upload_reservations r
    where r.expires_at < now() and not r.attached
      and exists (select 1 from storage.objects o where o.bucket_id = 'survey-files' and o.name = r.object_path)
      and not exists (select 1 from public.response_file_references rf where rf.object_path = r.object_path)
    order by r.expires_at, r.object_path limit least(greatest(batch_limit, 1), 500)
    for update skip locked
  )
  update public.survey_upload_reservations r set cleanup_claimed = true
  from candidates c where r.object_path = c.object_path and not r.attached
  returning r.object_path;
$$;
revoke all on function public.list_expired_survey_uploads(integer) from public, anon, authenticated;
grant execute on function public.list_expired_survey_uploads(integer) to service_role;

create or replace function public.sync_response_file_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_path text;
begin
  if tg_op = 'UPDATE' then
    delete from public.response_file_references where response_id = new.id;
  end if;

  for candidate_path in
    select distinct scalar #>> '{}'
    from jsonb_path_query(new.data, '$.** ? (@.type() == "string")', '{}'::jsonb, true) scalar
  loop
    if length(candidate_path) <= 1024
      and split_part(candidate_path, '/', 2) = new.form_id::text
      and candidate_path ~* '^(public|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
    then
      if exists (select 1 from public.survey_upload_reservations r where r.object_path = candidate_path) then
        -- Row update serializes attachment against the cleanup claim. Either
        -- attachment wins and cleanup skips it, or submission rejects the file.
        update public.survey_upload_reservations r set attached = true
        where r.object_path = candidate_path and not r.cleanup_claimed
          and (r.expires_at > clock_timestamp() or (tg_op = 'UPDATE' and
            jsonb_path_exists(old.data, '$.** ? (@ == $path)', jsonb_build_object('path', candidate_path))));
        if not found then raise exception 'Срок загрузки файла истёк. Прикрепите файл заново.' using errcode = '22023'; end if;
      end if;
      insert into public.response_file_references (response_id, form_id, object_path)
      values (new.id, new.form_id, candidate_path)
      on conflict do nothing;
    end if;
  end loop;

  return new;
end;
$$;


-- Storage may first authorize an empty metadata placeholder and write the actual
-- length later as its service role. Enforce the reservation on that final write.
create or replace function public.enforce_survey_upload_size()
returns trigger language plpgsql security definer set search_path = '' as $$
declare reserved_size bigint;
begin
  if new.bucket_id='survey-files' and split_part(new.name,'/',1)='public' then
    select r.size_bytes into reserved_size from public.survey_upload_reservations r where r.object_path=new.name;
    if found and new.metadata ? 'size' and
      (coalesce(new.metadata->>'size','') !~ '^[0-9]{1,20}$' or (new.metadata->>'size')::numeric>reserved_size) then
      raise exception 'Размер файла превышает разрешённый для этой загрузки' using errcode='22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_survey_upload_size() from public,anon,authenticated;
create trigger survey_upload_reserved_size before insert or update of metadata,name,bucket_id on storage.objects
for each row execute function public.enforce_survey_upload_size();

commit;
