begin;

-- A disabled account must lose access immediately, including when it keeps an
-- otherwise valid JWT issued before the account was disabled.
create or replace function public.request_is_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_disabled = false
  );
$$;

revoke all on function public.request_is_enabled() from public;
grant execute on function public.request_is_enabled() to authenticated, service_role;

create or replace function public.request_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.is_disabled = false;
$$;

revoke all on function public.request_role() from public;
grant execute on function public.request_role() to authenticated, service_role;

create or replace function public.is_existing_response_submission(
  target_form_id uuid,
  target_submission_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.responses r
    where r.form_id = target_form_id
      and r.submission_id = target_submission_id
      and r.user_id is not distinct from target_user_id
  );
$$;

revoke all on function public.is_existing_response_submission(uuid, uuid, uuid) from public;
grant execute on function public.is_existing_response_submission(uuid, uuid, uuid) to anon, authenticated, service_role;

create or replace function public.is_public_active_admin_authored_form(target_form_id uuid)
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
      and p.role = 'admin'
      and p.is_disabled = false
  );
$$;

-- Bound stored data before it reaches SurveyJS or response export code.
alter table public.forms drop constraint if exists forms_schema_size;
alter table public.forms
  add constraint forms_schema_size check (pg_column_size(schema) <= 262144);

alter table public.forms drop constraint if exists forms_schema_no_active_urls;
alter table public.forms
  add constraint forms_schema_no_active_urls check (
    not jsonb_path_exists(schema, '$.**.navigateToUrl')
    and not jsonb_path_exists(schema, '$.**.navigateToUrlOnCondition')
    and not jsonb_path_exists(schema, '$.**.choicesByUrl')
  );

alter table public.forms drop constraint if exists forms_max_responses_hard_cap;
alter table public.forms
  add constraint forms_max_responses_hard_cap check (max_responses is null or max_responses <= 100000);

alter table public.responses drop constraint if exists responses_data_size;
alter table public.responses
  add constraint responses_data_size check (pg_column_size(data) <= 262144);

alter table public.responses
  add column if not exists submission_id uuid default gen_random_uuid();
update public.responses set submission_id = gen_random_uuid() where submission_id is null;
alter table public.responses alter column submission_id set default gen_random_uuid();
alter table public.responses alter column submission_id set not null;
create unique index if not exists idx_responses_form_submission_id
  on public.responses(form_id, submission_id);

-- Lock the form row before insertion. The count is changed only AFTER the
-- response passes RLS, so the final allowed insert is not rejected because the
-- form became private during the BEFORE trigger.
create or replace function public.ensure_form_response_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
  configured_limit integer;
begin
  if exists (
    select 1 from public.responses r
    where r.form_id = new.form_id and r.submission_id = new.submission_id
  ) then
    return new;
  end if;

  select f.responses_count, least(coalesce(f.max_responses, 100000), 100000)
  into current_count, configured_limit
  from public.forms f
  where f.id = new.form_id
  for update;

  if not found then
    return new;
  end if;

  if current_count >= configured_limit then
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
  set responses_count = f.responses_count + 1,
      is_public = case
        when f.responses_count + 1 >= least(coalesce(f.max_responses, 100000), 100000) then false
        else f.is_public
      end
  where f.id = new.form_id;

  return new;
end;
$$;

drop trigger if exists responses_form_count_increment on public.responses;
create trigger responses_form_count_increment
after insert on public.responses
for each row execute procedure public.increment_form_response_count();

create or replace function public.enforce_form_response_limit_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_limit integer := least(coalesce(new.max_responses, 100000), 100000);
begin
  if new.max_responses is not null and new.max_responses < new.responses_count then
    raise exception 'Лимит ответов не может быть меньше количества уже полученных ответов' using errcode = '23514';
  end if;

  if new.responses_count >= effective_limit then
    if tg_op = 'UPDATE' and old.is_public = false and new.is_public = true then
      raise exception 'Сначала уберите или повысьте лимит ответов' using errcode = '23514';
    end if;
    new.is_public := false;
  end if;

  return new;
end;
$$;

drop trigger if exists forms_enforce_response_limit_settings on public.forms;
create trigger forms_enforce_response_limit_settings
before insert or update of responses_count, max_responses, is_public on public.forms
for each row execute procedure public.enforce_form_response_limit_settings();

-- Clients may only provide business fields. Counters, cached author names and
-- server-owned identifiers must always come from defaults/triggers.
revoke insert on table public.forms from authenticated;
grant insert (title, schema, form_type, form_reason, is_public, deadline_at, max_responses, author_id)
  on table public.forms to authenticated;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
for select to authenticated
using (
  (select public.request_is_enabled())
  and (id = (select auth.uid()) or (select public.request_role()) = 'admin')
);

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin" on public.profiles
for update to authenticated
using (
  (select public.request_is_enabled())
  and (id = (select auth.uid()) or (select public.request_role()) = 'admin')
)
with check (
  (select public.request_is_enabled())
  and (id = (select auth.uid()) or (select public.request_role()) = 'admin')
);

drop policy if exists "forms_select" on public.forms;
create policy "forms_select" on public.forms
for select to authenticated
using ((select public.request_is_enabled()));

drop policy if exists "forms_insert" on public.forms;
create policy "forms_insert" on public.forms
for insert to authenticated
with check ((select public.request_is_enabled()) and author_id = (select auth.uid()));

drop policy if exists "forms_update" on public.forms;
create policy "forms_update" on public.forms
for update to authenticated
using (
  (select public.request_is_enabled())
  and (author_id = (select auth.uid()) or (select public.request_role()) = 'admin')
)
with check (
  (select public.request_is_enabled())
  and (author_id = (select auth.uid()) or (select public.request_role()) = 'admin')
);

drop policy if exists "responses_select_author_or_admin" on public.responses;
create policy "responses_select_author_or_admin" on public.responses
for select to authenticated
using (
  (select public.request_is_enabled())
  and (
    (select public.request_role()) = 'admin'
    or exists (
      select 1 from public.forms f
      where f.id = form_id and f.author_id = (select auth.uid())
    )
    or public.is_public_active_admin_authored_form(form_id)
  )
);

drop policy if exists "responses_insert" on public.responses;
create policy "responses_insert" on public.responses
for insert to authenticated, anon
with check (
  ((select auth.uid()) is null or (select public.request_is_enabled()))
  and (user_id is null or user_id = (select auth.uid()))
  and (
    exists (
      select 1 from public.forms f
      where f.id = form_id
        and f.is_public = true
        and (f.deadline_at is null or f.deadline_at > now())
    )
    or public.is_existing_response_submission(form_id, submission_id, (select auth.uid()))
  )
);

-- Storage paths are capabilities. Anonymous users can upload/delete a random
-- path for an active public form, but cannot enumerate or download objects.
create or replace function public.can_upload_survey_file(object_name text, anonymous_request boolean)
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
  if array_length(path_parts, 1) < 3 then
    return false;
  end if;

  if anonymous_request then
    if auth.uid() is not null or path_parts[1] <> 'public' then
      return false;
    end if;
  else
    if not public.request_is_enabled() or path_parts[1] <> auth.uid()::text then
      return false;
    end if;
  end if;

  begin
    target_form_id := path_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return exists (
    select 1 from public.forms f
    where f.id = target_form_id
      and (
        (f.is_public = true and (f.deadline_at is null or f.deadline_at > now()))
        or (not anonymous_request and (f.author_id = auth.uid() or public.request_role() = 'admin'))
      )
  );
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
  if not public.request_is_enabled() or array_length(path_parts, 1) < 3 then
    return false;
  end if;

  if path_parts[1] = auth.uid()::text then
    return true;
  end if;

  begin
    target_form_id := path_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return exists (
    select 1
    from public.forms f
    where f.id = target_form_id
      and (
        f.author_id = auth.uid()
        or public.request_role() = 'admin'
        or (
          public.is_public_active_admin_authored_form(f.id)
          and exists (
            select 1 from public.responses r
            where r.form_id = f.id
              and jsonb_path_exists(
                r.data,
                '$.** ? (@ == $needle)',
                jsonb_build_object('needle', object_name),
                true
              )
          )
        )
      )
  );
end;
$$;

revoke all on function public.can_upload_survey_file(text, boolean) from public;
revoke all on function public.can_read_survey_file(text) from public;
grant execute on function public.can_upload_survey_file(text, boolean) to anon, authenticated, service_role;
grant execute on function public.can_read_survey_file(text) to authenticated, service_role;

create or replace function public.is_survey_file_referenced(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.responses r
    where jsonb_path_exists(
      r.data,
      '$.** ? (@ == $needle)',
      jsonb_build_object('needle', object_name),
      true
    )
  );
$$;

revoke all on function public.is_survey_file_referenced(text) from public;
grant execute on function public.is_survey_file_referenced(text) to service_role;

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
      select 1 from public.responses r
      where jsonb_path_exists(
        r.data,
        '$.** ? (@ == $needle)',
        jsonb_build_object('needle', o.name),
        true
      )
    )
  order by o.created_at, o.id
  limit least(greatest(batch_limit, 1), 1000);
$$;

revoke all on function public.list_orphan_survey_files(timestamptz, integer) from public;
grant execute on function public.list_orphan_survey_files(timestamptz, integer) to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('survey-files', 'survey-files', false, 10485760)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "survey_files_authenticated_upload" on storage.objects;
drop policy if exists "survey_files_public_upload" on storage.objects;
drop policy if exists "survey_files_authenticated_read" on storage.objects;
drop policy if exists "survey_files_public_read" on storage.objects;
drop policy if exists "survey_files_authenticated_delete" on storage.objects;
drop policy if exists "survey_files_public_delete" on storage.objects;

create policy "survey_files_authenticated_upload" on storage.objects
for insert to authenticated
with check (bucket_id = 'survey-files' and public.can_upload_survey_file(name, false));

create policy "survey_files_public_upload" on storage.objects
for insert to anon
with check (bucket_id = 'survey-files' and public.can_upload_survey_file(name, true));

create policy "survey_files_authenticated_read" on storage.objects
for select to authenticated
using (bucket_id = 'survey-files' and public.can_read_survey_file(name));

create policy "survey_files_authenticated_delete" on storage.objects
for delete to authenticated
using (bucket_id = 'survey-files' and public.can_read_survey_file(name));

notify pgrst, 'reload schema';

commit;
