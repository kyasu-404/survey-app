begin;

update storage.buckets set file_size_limit = 52428800 where id = 'survey-files';

alter table public.survey_upload_reservations
  drop constraint survey_upload_reservations_size_bytes_check,
  add constraint survey_upload_reservations_size_bytes_check
    check (size_bytes between 0 and 52428800);

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
    or p_size is null or p_size not between 0 and 52428800
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
  -- A Storage placeholder may have only a reservation; keep the legacy estimate
  -- for objects with neither an actual nor a reserved size.
  select count(*), coalesce(sum(coalesce((o.metadata->>'size')::bigint, r.size_bytes, 10485760)), 0)
    into total_count, total_bytes from storage.objects o
    left join public.survey_upload_reservations r on r.object_path = o.name
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
    or object_size > 52428800
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
        then least((o.metadata ->> 'size')::numeric, 52428800)::bigint
      else coalesce(r.size_bytes, 10485760)
    end
  ), 0)
  into existing_count, existing_bytes
  from storage.objects o
  left join public.survey_upload_reservations r on r.object_path = o.name
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

-- Saturate at one byte above the cap so oversized metadata reaches the
-- rejection in can_upload_survey_file without overflowing a bigint cast.
alter policy "survey_files_authenticated_upload" on storage.objects
with check (
  bucket_id = 'survey-files'
  and public.can_upload_survey_file(
    name,
    false,
    case when coalesce(metadata ->> 'size', '') ~ '^[0-9]{1,20}$'
      then least((metadata ->> 'size')::numeric, 52428801)::bigint
      else 0
    end
  )
);

alter policy "survey_files_public_upload" on storage.objects
with check (
  bucket_id = 'survey-files'
  and public.can_upload_survey_file(
    name,
    true,
    case when coalesce(metadata ->> 'size', '') ~ '^[0-9]{1,20}$'
      then least((metadata ->> 'size')::numeric, 52428801)::bigint
      else 0
    end
  )
);

commit;
