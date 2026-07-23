begin;

-- Stored SurveyJS media URLs must not cause an administrator's browser to
-- contact an author-controlled origin when a form or response is reviewed.
create or replace function public.survey_schema_has_unsafe_network_assets(value jsonb)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from (
      select jsonb_path_query(value, '$.**.logo', '{}'::jsonb, true) as asset
      union all select jsonb_path_query(value, '$.**.backgroundImage', '{}'::jsonb, true)
      union all select jsonb_path_query(value, '$.**.imageLink', '{}'::jsonb, true)
      union all select jsonb_path_query(value, '$.**.imageUrl', '{}'::jsonb, true)
      union all select jsonb_path_query(value, '$.**.videoLink', '{}'::jsonb, true)
      union all select jsonb_path_query(value, '$.**.source', '{}'::jsonb, true)
      union all select jsonb_path_query(value, '$.**.poster', '{}'::jsonb, true)
    ) assets
    where jsonb_typeof(asset) <> 'string'
      or not (
        btrim(asset #>> '{}') = '__APP_DEFAULT_CARD_LOGO__'
        or btrim(asset #>> '{}') ~* '^data:image/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$'
        or btrim(asset #>> '{}') !~* '^([a-z][a-z0-9+.-]*:|//|\\)'
      )
  ) or jsonb_path_exists(value, '$.**.contentMode ? (@ != "image")', '{}'::jsonb, true);
$$;

revoke all on function public.survey_schema_has_unsafe_network_assets(jsonb) from public;
grant execute on function public.survey_schema_has_unsafe_network_assets(jsonb) to authenticated, service_role;

alter table public.forms drop constraint if exists forms_schema_no_unsafe_network_assets;
alter table public.forms
  add constraint forms_schema_no_unsafe_network_assets
  check (not public.survey_schema_has_unsafe_network_assets(schema)) not valid;

create or replace function public.is_public_active_form(target_form_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.forms f
    join public.profiles p on p.id = f.author_id
    where f.id = target_form_id
      and f.is_public = true
      and (f.deadline_at is null or f.deadline_at > now())
      and p.is_disabled = false
  );
$$;

revoke all on function public.is_public_active_form(uuid) from public;
grant execute on function public.is_public_active_form(uuid) to anon, authenticated, service_role;

-- Enabled users can read their own forms, administrators can manage all forms,
-- and everyone can retain the explicitly intended visibility of active forms.
-- Private drafts owned by other non-admin users are not exposed.
drop policy if exists "forms_select" on public.forms;
create policy "forms_select" on public.forms
for select to authenticated
using (
  (select public.request_is_enabled())
  and (
    author_id = (select auth.uid())
    or (select public.request_role()) = 'admin'
    or public.is_public_active_form(id)
  )
);

drop policy if exists "forms_select_anon" on public.forms;
create policy "forms_select_anon" on public.forms
for select to anon
using (public.is_public_active_form(id));

drop policy if exists "responses_insert" on public.responses;
create policy "responses_insert" on public.responses
for insert to authenticated, anon
with check (
  ((select auth.uid()) is null or (select public.request_is_enabled()))
  and (user_id is null or user_id = (select auth.uid()))
  and (
    public.is_public_active_form(form_id)
    or public.is_existing_response_submission(form_id, submission_id, (select auth.uid()))
  )
);

-- Reserve the response slot in the BEFORE trigger. The form remains public
-- until the AFTER trigger, so the final permitted row still passes RLS, while
-- every later row in the same bulk statement observes the reserved count.
create or replace function public.ensure_form_response_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.responses r
    where r.form_id = new.form_id and r.submission_id = new.submission_id
  ) then
    return new;
  end if;

  update public.forms f
  set responses_count = f.responses_count + 1
  where f.id = new.form_id
    and f.responses_count < least(coalesce(f.max_responses, 100000), 100000);

  if found then
    return new;
  end if;

  if exists (select 1 from public.forms f where f.id = new.form_id) then
    raise exception 'Достигнут лимит ответов для формы' using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.increment_form_response_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.forms f
  set is_public = false
  where f.id = new.form_id
    and f.responses_count >= least(coalesce(f.max_responses, 100000), 100000);

  return new;
end;
$$;

drop trigger if exists forms_enforce_response_limit_settings on public.forms;
create trigger forms_enforce_response_limit_settings
before insert or update of max_responses, is_public on public.forms
for each row execute procedure public.enforce_form_response_limit_settings();

revoke insert on table public.responses from anon, authenticated;
grant insert (form_id, submission_id, data) on table public.responses to anon, authenticated;

-- Keep an indexed, normalized reference set. This turns anonymous capability
-- deletion checks and signed-URL authorization into exact indexed lookups
-- instead of recursively scanning every stored response.
create table if not exists public.response_file_references (
  response_id uuid not null references public.responses(id) on delete cascade,
  form_id uuid not null references public.forms(id) on delete cascade,
  object_path text not null check (length(object_path) between 3 and 1024),
  primary key (response_id, object_path)
);

create index if not exists idx_response_file_references_object_form
  on public.response_file_references(object_path, form_id);

revoke all on table public.response_file_references from anon, authenticated;
grant select, insert, update, delete on table public.response_file_references to service_role;

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
      insert into public.response_file_references (response_id, form_id, object_path)
      values (new.id, new.form_id, candidate_path)
      on conflict do nothing;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists responses_sync_file_references on public.responses;
create trigger responses_sync_file_references
after insert or update of data, form_id on public.responses
for each row execute procedure public.sync_response_file_references();

insert into public.response_file_references (response_id, form_id, object_path)
select distinct r.id, r.form_id, scalar #>> '{}'
from public.responses r
cross join lateral jsonb_path_query(r.data, '$.** ? (@.type() == "string")', '{}'::jsonb, true) scalar
where length(scalar #>> '{}') <= 1024
  and split_part(scalar #>> '{}', '/', 2) = r.form_id::text
  and (scalar #>> '{}') ~* '^(public|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
on conflict do nothing;

-- Remove every historical policy name before recreating the final set.
drop policy if exists "survey files upload authenticated" on storage.objects;
drop policy if exists "survey files upload anon" on storage.objects;
drop policy if exists "survey files read authenticated" on storage.objects;
drop policy if exists "survey files read anon" on storage.objects;
drop policy if exists "survey files delete authenticated" on storage.objects;
drop policy if exists "survey files delete anon" on storage.objects;
drop policy if exists "survey_files_authenticated_upload" on storage.objects;
drop policy if exists "survey_files_public_upload" on storage.objects;
drop policy if exists "survey_files_authenticated_read" on storage.objects;
drop policy if exists "survey_files_public_read" on storage.objects;
drop policy if exists "survey_files_authenticated_delete" on storage.objects;
drop policy if exists "survey_files_public_delete" on storage.objects;

drop function if exists public.can_upload_survey_file(text, boolean);

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

  return existing_count < 2000
    and existing_bytes + object_size <= 2147483648;
end;
$$;

create or replace function public.can_read_survey_file(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  path_parts text[] := string_to_array(object_name, '/');
  target_form_id uuid;
begin
  if not public.request_is_enabled() or array_length(path_parts, 1) <> 3 then return false; end if;
  if path_parts[1] = auth.uid()::text then return true; end if;

  begin
    target_form_id := path_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return exists (
    select 1 from public.forms f
    where f.id = target_form_id
      and (
        f.author_id = auth.uid()
        or public.request_role() = 'admin'
        or (
          public.is_public_active_admin_authored_form(f.id)
          and exists (
            select 1 from public.response_file_references rf
            where rf.form_id = f.id and rf.object_path = object_name
          )
        )
      )
  );
end;
$$;

create or replace function public.can_delete_survey_file(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  path_parts text[] := string_to_array(object_name, '/');
begin
  if not public.request_is_enabled()
    or array_length(path_parts, 1) <> 3
    or path_parts[1] <> auth.uid()::text
  then
    return false;
  end if;

  return not exists (
    select 1 from public.response_file_references rf
    where rf.object_path = object_name
  );
end;
$$;

create or replace function public.is_survey_file_referenced(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.response_file_references rf
    where rf.object_path = object_name
  );
$$;

create or replace function public.list_orphan_survey_files(
  cutoff timestamptz default (now() - interval '24 hours'),
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
  where o.bucket_id = 'survey-files'
    and o.name like 'public/%'
    and o.created_at < cutoff
    and not exists (
      select 1 from public.response_file_references rf
      where rf.object_path = o.name
    )
  order by o.created_at, o.id
  limit least(greatest(batch_limit, 1), 1000);
$$;

revoke all on function public.can_upload_survey_file(text, boolean, bigint) from public;
revoke all on function public.can_read_survey_file(text) from public;
revoke all on function public.can_delete_survey_file(text) from public;
revoke all on function public.is_survey_file_referenced(text) from public;
revoke all on function public.list_orphan_survey_files(timestamptz, integer) from public;
grant execute on function public.can_upload_survey_file(text, boolean, bigint) to anon, authenticated, service_role;
grant execute on function public.can_read_survey_file(text) to authenticated, service_role;
grant execute on function public.can_delete_survey_file(text) to authenticated, service_role;
grant execute on function public.is_survey_file_referenced(text) to service_role;
grant execute on function public.list_orphan_survey_files(timestamptz, integer) to service_role;

create policy "survey_files_authenticated_upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'survey-files'
  and public.can_upload_survey_file(
    name,
    false,
    case when coalesce(metadata ->> 'size', '') ~ '^[0-9]{1,20}$'
      then least((metadata ->> 'size')::numeric, 10485760)::bigint
      else 0
    end
  )
);

create policy "survey_files_public_upload" on storage.objects
for insert to anon
with check (
  bucket_id = 'survey-files'
  and public.can_upload_survey_file(
    name,
    true,
    case when coalesce(metadata ->> 'size', '') ~ '^[0-9]{1,20}$'
      then least((metadata ->> 'size')::numeric, 10485760)::bigint
      else 0
    end
  )
);

create policy "survey_files_authenticated_read" on storage.objects
for select to authenticated
using (bucket_id = 'survey-files' and public.can_read_survey_file(name));

create policy "survey_files_authenticated_delete" on storage.objects
for delete to authenticated
using (bucket_id = 'survey-files' and public.can_delete_survey_file(name));

notify pgrst, 'reload schema';

commit;
