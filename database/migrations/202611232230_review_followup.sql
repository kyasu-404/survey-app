begin;

set local lock_timeout = '5s';

revoke execute on function public.assert_can_delete_employee(uuid, uuid) from service_role;

create or replace function public.delete_employee(p_user_id uuid, p_actor_id uuid)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  -- Serialize role mutations and take form locks before profile locks, as
  -- the automation worker can hold a form lock while it records a notification.
  perform pg_advisory_xact_lock(hashtextextended('survey-admin-role-mutation', 0));
  perform 1 from public.forms where author_id = p_user_id order by id for update;
  perform public.assert_can_delete_employee(p_user_id, p_actor_id);
  delete from auth.users where id = p_user_id;
  if not found then
    raise exception 'Пользователь не найден' using errcode = 'P0002';
  end if;

  -- Installed Supabase Auth records admin mutations in this table. A minimal
  -- schema used to exercise the application database can omit Auth audit.
  if to_regclass('auth.audit_log_entries') is not null then
    insert into auth.audit_log_entries(instance_id, id, payload, created_at, ip_address)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), jsonb_build_object(
      'action', 'user_deleted', 'actor_id', p_actor_id, 'log_type', 'team',
      'traits', jsonb_build_object('user_id', p_user_id)
    ), clock_timestamp(), '');
  end if;
  return true;
end;
$$;

revoke all on function public.delete_employee(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_employee(uuid, uuid) to service_role;

create or replace function public.survey_response_bindings(
  p_schema jsonb, p_data jsonb, p_path text[] default '{}'::text[], p_depth integer default 0
)
returns table (question jsonb, value jsonb, value_path text[])
language plpgsql immutable set search_path = '' as $$
declare child jsonb; entry record; answer_path text[]; answer_value jsonb; row_schema jsonb;
begin
  if p_depth>32 then raise exception 'Структура формы превышает допустимую глубину' using errcode='22023'; end if;
  if jsonb_typeof(p_schema->'type')='string' and p_schema->>'type'<>'panel'
    and jsonb_typeof(p_schema->'name')='string' then
    answer_path := p_path || coalesce(nullif(p_schema->>'valueName',''),p_schema->>'name');
    answer_value := p_data -> coalesce(nullif(p_schema->>'valueName',''),p_schema->>'name');
    return query select p_schema,answer_value,answer_path;
    if p_schema->>'type'='paneldynamic' and jsonb_typeof(answer_value)='array' then
      for entry in select item,ordinality from jsonb_array_elements(answer_value) with ordinality a(item,ordinality) loop
        return query select * from public.survey_response_bindings(
          jsonb_build_object('elements',case when jsonb_typeof(p_schema->'templateElements')='array' then p_schema->'templateElements'
            when jsonb_typeof(p_schema->'questions')='array' then p_schema->'questions' else '[]'::jsonb end),
          entry.item,answer_path || (entry.ordinality-1)::text,p_depth+1);
      end loop;
    elsif p_schema->>'type' in ('matrixdynamic','matrixdropdown') then
      select jsonb_build_object('elements',coalesce(jsonb_agg(
        c || jsonb_build_object('type',coalesce(nullif(c->>'cellType','default'),p_schema->>'cellType','dropdown'))
      ),'[]'::jsonb) || case when jsonb_typeof(p_schema->'detailElements')='array' then p_schema->'detailElements' else '[]'::jsonb end)
      into row_schema from jsonb_array_elements(case when jsonb_typeof(p_schema->'columns')='array' then p_schema->'columns' else '[]'::jsonb end) c;
      if jsonb_typeof(answer_value)='array' then
        for entry in select item,ordinality from jsonb_array_elements(answer_value) with ordinality a(item,ordinality) loop
          return query select * from public.survey_response_bindings(row_schema,entry.item,answer_path || (entry.ordinality-1)::text,p_depth+1);
        end loop;
      elsif jsonb_typeof(answer_value)='object' then
        for entry in select key,item from jsonb_each(answer_value) a(key,item) loop
          return query select * from public.survey_response_bindings(row_schema,entry.item,answer_path || entry.key,p_depth+1);
        end loop;
      end if;
    end if;
    -- Choice elements write to the same scope as the choice question.
    for child in
      select e.item
      from jsonb_array_elements(case when jsonb_typeof(p_schema->'choices')='array'
        then p_schema->'choices' else '[]'::jsonb end) c(choice)
      cross join lateral jsonb_array_elements(case when jsonb_typeof(c.choice->'elements')='array'
        then c.choice->'elements' else '[]'::jsonb end) e(item)
    loop
      return query select * from public.survey_response_bindings(child,p_data,p_path,p_depth+1);
    end loop;
    return;
  end if;
  for child in
    select item from jsonb_array_elements(case when jsonb_typeof(p_schema->'pages')='array' then p_schema->'pages' else '[]'::jsonb end) a(item)
    union all select item from jsonb_array_elements(case when jsonb_typeof(p_schema->'elements')='array' then p_schema->'elements' else '[]'::jsonb end) a(item)
    union all select item from jsonb_array_elements(case
      when jsonb_typeof(p_schema->'elements') is distinct from 'array' and jsonb_typeof(p_schema->'questions')='array'
        then p_schema->'questions' else '[]'::jsonb end) a(item)
  loop return query select * from public.survey_response_bindings(child,p_data,p_path,p_depth+1); end loop;
end;
$$;

create or replace function public.response_data_matches_form(
  form_schema jsonb,
  allowed_organization_types text[],
  response_data jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  comment_suffix text := coalesce(nullif(form_schema ->> 'commentSuffix', ''), '-Comment');
  is_valid boolean;
begin
  if jsonb_typeof(response_data) is distinct from 'object' or pg_column_size(response_data) > 262144 then
    return false;
  end if;

  with bindings as materialized (
    select * from public.survey_response_bindings(form_schema, response_data)
  ), bad_bindings as (
    select 1
    from bindings b
    where not coalesce(public.survey_response_value_is_valid(b.question, b.value), false)
      or (
        b.question ->> 'type' in ('paneldynamic', 'matrixdynamic')
        and b.value is not null
        and (
          jsonb_typeof(b.value) <> 'array'
          or exists (select 1 from jsonb_array_elements(b.value) e where jsonb_typeof(e) <> 'object')
        )
      )
      or (
        b.question ->> 'type' = 'matrixdropdown'
        and b.value is not null
        and (
          jsonb_typeof(b.value) <> 'object'
          or exists (
            select 1 from jsonb_each(case when jsonb_typeof(b.value) = 'object' then b.value else '{}'::jsonb end) e
            where jsonb_typeof(e.value) <> 'object'
              or (jsonb_typeof(b.question -> 'rows') = 'array' and not exists (
                select 1 from jsonb_array_elements(b.question -> 'rows') r(row_item)
                where e.key = case when jsonb_typeof(r.row_item) = 'object'
                  then r.row_item ->> 'value' else r.row_item #>> '{}' end
              ))
          )
        )
      )
      or (
        b.question ->> 'type' = 'organization'
        and b.value is not null
        and (
          jsonb_typeof(b.value) <> 'string'
          or (b.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or not exists (
            select 1 from public.education_organizations organization
            where organization.id = (b.value #>> '{}')::uuid
              and organization.organization_type = any(allowed_organization_types)
          )
        )
      )
  ), scopes as (
    select '{}'::text[] as path, response_data as data
    union all
    select b.value_path || (e.ordinality - 1)::text, e.item
    from bindings b
    cross join lateral jsonb_array_elements(
      case when b.question ->> 'type' in ('paneldynamic', 'matrixdynamic') and jsonb_typeof(b.value) = 'array'
        then b.value else '[]'::jsonb end
    ) with ordinality e(item, ordinality)
    where jsonb_typeof(e.item) = 'object'
    union all
    select b.value_path || e.key, e.value
    from bindings b
    cross join lateral jsonb_each(
      case when b.question ->> 'type' = 'matrixdropdown' and jsonb_typeof(b.value) = 'object'
        then b.value else '{}'::jsonb end
    ) e(key, value)
    where jsonb_typeof(e.value) = 'object'
  ), allowed_paths as (
    select value_path as path from bindings
    union all
    select value_path[1:cardinality(value_path)-1]
      || (value_path[cardinality(value_path)] || comment_suffix)
    from bindings
    where (question @> '{"showOtherItem":true}' or question @> '{"showCommentArea":true}'
      or question @> '{"hasOther":true}' or question @> '{"hasComment":true}')
      and jsonb_typeof(response_data #> (value_path[1:cardinality(value_path)-1]
        || (value_path[cardinality(value_path)] || comment_suffix))) = 'string'
  ), bad_keys as (
    select 1 from scopes s cross join lateral jsonb_object_keys(s.data) k(name)
    where not exists (select 1 from allowed_paths a where a.path = s.path || k.name)
  )
  select not exists (select 1 from bad_bindings) and not exists (select 1 from bad_keys)
  into is_valid;

  return coalesce(is_valid, false);
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

  -- Reject unreserved anonymous probes before acquiring the per-form lock or scanning Storage.
  if anonymous_request and not exists (
    select 1 from public.survey_upload_reservations r
    where r.object_path = object_name
      and r.form_id = target_form_id
      and r.expires_at > now()
      and object_size <= r.size_bytes
  ) then
    return false;
  end if;

  if not exists (
    select 1 from public.forms f
    where f.id = target_form_id
      and f.form_type <> 'template'
      and (
        public.is_public_active_form(f.id)
        or (not anonymous_request and (f.author_id = auth.uid() or public.request_role() = 'admin'))
      )
      and exists (select 1 from public.survey_upload_questions(f.schema))
  ) then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('survey-files/' || target_form_id::text, 0));

  -- Recheck reservation under the per-form lock before computing quotas.
  if anonymous_request and not exists (
    select 1 from public.survey_upload_reservations r
    where r.object_path = object_name
      and r.form_id = target_form_id
      and r.expires_at > now()
      and object_size <= r.size_bytes
  ) then
    return false;
  end if;

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

  select count(*), coalesce(sum(r.size_bytes), 0) into reserved_count, reserved_bytes
  from public.survey_upload_reservations r
  where r.form_id = target_form_id and r.expires_at > now() and r.object_path <> object_name
    and not exists (select 1 from storage.objects o where o.bucket_id = 'survey-files' and o.name = r.object_path);
  return existing_count + reserved_count < 2000
    and existing_bytes + reserved_bytes + object_size <= 2147483648;
end;
$$;

create or replace function public.validate_response_schema()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  form_schema jsonb;
  organization_types text[];
begin
  select f.schema, f.organization_types into form_schema, organization_types
  from public.forms f where f.id = new.form_id;
  if not found or not public.response_data_matches_form(form_schema, organization_types, new.data) then
    raise exception 'Ответ не соответствует структуре формы' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_response_schema() from public, anon, authenticated;

create or replace trigger responses_00_validate_schema
before insert or update of form_id, data on public.responses
for each row execute function public.validate_response_schema();

create or replace function public.validate_response_payload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_form public.forms%rowtype;
  binding record;
  selected_is_archived boolean;
begin
  select f.* into target_form from public.forms f where f.id = new.form_id;
  if not jsonb_path_exists(target_form.schema, '$.** ? (@.type == "organization")') then
    return new;
  end if;
  -- Lock in UUID order so concurrent submissions acquire organization locks consistently.
  for binding in
    select b.value_path, (b.value #>> '{}')::uuid as organization_id
    from public.survey_response_bindings(target_form.schema, new.data) b
    where b.question ->> 'type' = 'organization' and b.value is not null
    order by 2, 1
  loop
    select o.is_archived into selected_is_archived
    from public.education_organizations o where o.id = binding.organization_id for share;
    if not found then
      raise exception 'Организация не найдена' using errcode = '22023';
    end if;
    if selected_is_archived then
      if tg_op = 'INSERT' then
        raise exception 'Организация удалена из действующего справочника' using errcode = '22023';
      elsif new.form_id is distinct from old.form_id
        or (new.data #> binding.value_path) is distinct from (old.data #> binding.value_path)
      then
        raise exception 'Архивную организацию можно сохранить только в прежнем ответе' using errcode = '22023';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

create or replace function public.submit_form_response(
  p_form_id uuid,
  p_browser_id uuid,
  p_submission_id uuid,
  p_data jsonb
)
returns table (
  status text,
  response_id uuid,
  response_data jsonb,
  response_editable boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_form public.forms%rowtype;
  existing_response public.responses%rowtype;
  inserted_response public.responses%rowtype;
begin
  if auth.uid() is not null and not public.request_is_enabled() then
    raise exception 'Пользователь отключён' using errcode = '42501';
  end if;

  if p_browser_id is null or p_submission_id is null then
    raise exception 'Некорректный идентификатор отправки' using errcode = '22023';
  end if;

  if jsonb_typeof(p_data) is distinct from 'object' or pg_column_size(p_data) > 262144 then
    raise exception 'Некорректные данные ответа' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('survey-response/' || p_form_id::text || '/' || p_browser_id::text, 0)
  );

  select f.*
  into target_form
  from public.forms f
  where f.id = p_form_id;

  if target_form.id is null or target_form.form_type = 'template' then
    raise exception 'Форма не найдена или недоступна' using errcode = 'P0002';
  end if;

  select r.*
  into existing_response
  from public.responses r
  where r.form_id = p_form_id
    and r.browser_id = public.browser_capability_hash(p_browser_id);

  if existing_response.id is not null then
    return query select
      'already_submitted'::text,
      existing_response.id,
      existing_response.data,
      target_form.allow_response_editing
        and target_form.is_public
        and (target_form.deadline_at is null or target_form.deadline_at > now());
    return;
  end if;

  if not target_form.is_public
    or (target_form.deadline_at is not null and target_form.deadline_at <= now())
  then
    raise exception 'Форма закрыта для ответов' using errcode = '42501';
  end if;

  insert into public.responses (form_id, browser_id, submission_id, data)
  values (p_form_id, public.browser_capability_hash(p_browser_id), p_submission_id, p_data)
  returning * into inserted_response;

  -- AFTER INSERT may close the form when this response reaches max_responses.
  select f.* into target_form from public.forms f where f.id = p_form_id;

  return query select
    'submitted'::text,
    inserted_response.id,
    inserted_response.data,
    target_form.allow_response_editing
      and target_form.is_public
      and (target_form.deadline_at is null or target_form.deadline_at > now());
end;
$$;

create or replace function public.update_form_response(
  p_form_id uuid,
  p_browser_id uuid,
  p_response_id uuid,
  p_data jsonb
)
returns table (
  response_id uuid,
  response_data jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_form public.forms%rowtype;
  updated_response public.responses%rowtype;
begin
  if auth.uid() is not null and not public.request_is_enabled() then
    raise exception 'Пользователь отключён' using errcode = '42501';
  end if;

  if p_browser_id is null or p_response_id is null then
    raise exception 'Некорректный идентификатор ответа' using errcode = '22023';
  end if;

  if jsonb_typeof(p_data) is distinct from 'object' or pg_column_size(p_data) > 262144 then
    raise exception 'Некорректные данные ответа' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('survey-response/' || p_form_id::text || '/' || p_browser_id::text, 0)
  );

  select f.*
  into target_form
  from public.forms f
  where f.id = p_form_id;

  if target_form.id is null or target_form.form_type = 'template' then
    raise exception 'Форма не найдена или недоступна' using errcode = 'P0002';
  end if;

  if not target_form.allow_response_editing then
    raise exception 'Редактирование ответов отключено' using errcode = '42501';
  end if;

  if not target_form.is_public
    or (target_form.deadline_at is not null and target_form.deadline_at <= now())
  then
    raise exception 'Форма закрыта для редактирования ответов' using errcode = '42501';
  end if;

  update public.responses r
  set data = p_data,
      updated_at = now()
  where r.id = p_response_id
    and r.form_id = p_form_id
    and r.browser_id = public.browser_capability_hash(p_browser_id)
  returning r.* into updated_response;

  if updated_response.id is null then
    raise exception 'Ответ не найден' using errcode = 'P0002';
  end if;

  return query select updated_response.id, updated_response.data;
end;
$$;

create or replace function public.prepare_response_files()
returns trigger language plpgsql security definer set search_path = '' as $$
declare form_schema jsonb; binding record; path text; previous_paths text[] := '{}'::text[];
begin
  select schema into form_schema from public.forms where id=new.form_id;
  for binding in select * from public.survey_response_bindings(form_schema,new.data)
    where question ->> 'type' in ('file', 'signaturepad')
  loop
    if binding.question->>'type'='file' and binding.value is not null then
      new.data := jsonb_set(new.data,binding.value_path,public.normalize_survey_file_value(binding.value,new.form_id));
    elsif binding.question->>'type'='signaturepad'
      and binding.value is not null
      and jsonb_typeof(binding.value)='string'
      and nullif(binding.value #>> '{}','') is not null
      and (binding.value #>> '{}') !~* '^data:'
    then
      new.data := jsonb_set(new.data,binding.value_path,public.normalize_survey_file_value(binding.value,new.form_id));
    end if;
  end loop;
  if tg_op='UPDATE' and old.form_id=new.form_id and old.browser_id is not distinct from new.browser_id then
    select coalesce(array_agg(object_path),'{}'::text[]) into previous_paths
    from public.response_file_references where response_id=old.id;
  end if;
  for path in select distinct scalar #>> '{}' from jsonb_path_query(new.data,'$.** ? (@.type() == "string")','{}'::jsonb,true) scalar
    where split_part(scalar #>> '{}','/',2)=new.form_id::text and (scalar #>> '{}') ~* '^(public|[0-9a-f-]{36})/[0-9a-f-]{36}/[^/]+$' order by 1
  loop
    path := public.survey_file_path(path,new.form_id);
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('survey-file/'||path,0));
    if exists(select 1 from public.survey_file_deletion_claims where object_path=path)
      or (not(path=any(previous_paths)) and not exists(
        select 1 from storage.objects where bucket_id='survey-files' and name=path))
    then raise exception 'Файл недоступен. Прикрепите файл заново.' using errcode='22023'; end if;
    -- The existing AFTER trigger enforces browser/employee ownership and writes
    -- references under the same transaction and the object lock retained here.
  end loop;
  return new;
end;
$$;

create or replace function public.survey_theme_is_safe(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'object'
    and pg_column_size(value) <= 131072
    and (
      not (value ? 'cssVariables')
      or (
        jsonb_typeof(value -> 'cssVariables') = 'object'
        and not exists (
          select 1
          from jsonb_each_text(
            case when jsonb_typeof(value -> 'cssVariables') = 'object'
              then value -> 'cssVariables'
              else '{}'::jsonb
            end
          ) css(name, setting)
          where name !~ '^--[a-zA-Z0-9_-]{1,120}$'
            or length(setting) > 512
            or setting ~ '[[:cntrl:]\\]'
            or setting ~ '/\*'
            or setting ~* '(url[[:space:]]*\(|image-set[[:space:]]*\(|image[[:space:]]*\(|cross-fade[[:space:]]*\(|expression[[:space:]]*\(|@import|javascript:)'
        )
      )
    )
    and not exists (
      select 1
      from (
        select value -> 'backgroundImage' as asset where value ? 'backgroundImage'
        union all
        select value -> 'header' -> 'backgroundImage' as asset
        where jsonb_typeof(value -> 'header') = 'object' and (value -> 'header') ? 'backgroundImage'
      ) assets
      where jsonb_typeof(asset) <> 'string'
        or (asset #>> '{}') ~ '[[:cntrl:]]'
        or not (
          regexp_replace(asset #>> '{}', '^[[:space:]]+|[[:space:]]+$', '', 'g') = ''
          or regexp_replace(asset #>> '{}', '^[[:space:]]+|[[:space:]]+$', '', 'g') ~ '^/[A-Za-z0-9._%-][A-Za-z0-9._/%-]*$'
          or regexp_replace(asset #>> '{}', '^[[:space:]]+|[[:space:]]+$', '', 'g') ~* '^__APP_SURVEY_ASSET__/(gallery/[a-z0-9._-]{1,255}|forms/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpe?g|png|webp))$'
        )
    );
$$;

alter table public.forms drop constraint if exists forms_theme_is_safe;

-- Old databases may have a theme saved before the stricter URL policy.
-- Validate theme writes without blocking operations such as counting answers
-- on forms that have not had their legacy theme re-saved yet.
create or replace function public.enforce_survey_theme()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.theme is not distinct from old.theme then return new; end if;
  if public.survey_theme_is_safe(new.theme) is distinct from true then
    raise exception 'Тема формы содержит недопустимые значения' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_survey_theme() from public, anon, authenticated;

create or replace trigger forms_enforce_theme
before insert or update of theme on public.forms
for each row execute function public.enforce_survey_theme();

-- User uploads have one path namespace per account, including unsaved drafts.
create index if not exists idx_survey_assets_uploader
on storage.objects ((split_part(name, '/', 3)))
where bucket_id = 'survey-assets' and name like 'forms/%';

create or replace function public.enforce_survey_asset_quota()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if new.bucket_id <> 'survey-assets' or new.name not like 'forms/%' or actor is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and (old.bucket_id, old.name) = (new.bucket_id, new.name) then
    return new;
  end if;
  if split_part(new.name, '/', 3) <> actor::text then
    raise exception 'Загрузите изображение от своего имени' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('survey-assets/' || actor::text, 0));
  if not exists (
    select 1 from storage.objects o where o.bucket_id = new.bucket_id and o.name = new.name
  ) and (
    select count(*) from storage.objects o
    where o.bucket_id = 'survey-assets' and o.name like 'forms/%' and split_part(o.name, '/', 3) = actor::text
  ) >= 500 then
    raise exception 'Достигнут лимит изображений оформления. Удалите неиспользуемые изображения.' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_survey_asset_quota() from public, anon, authenticated;

create or replace trigger survey_asset_upload_quota
before insert or update of bucket_id, name on storage.objects
for each row execute function public.enforce_survey_asset_quota();

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
    and (
      (
        o.name ~* '^forms/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
        and not exists (
          select 1 from public.forms f
          where (f.id::text = split_part(o.name, '/', 2)
                 and o.user_metadata ->> 'surveyThemeCopy' is distinct from 'true')
            or strpos(f.theme::text, o.name) > 0
            or strpos(f.schema::text, o.name) > 0
        )
      )
      or (
        o.name ~* '^app-branding/sidebar-logo-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
        and not exists (
          select 1 from public.app_branding branding
          where branding.sidebar_logo_path = o.name
        )
      )
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
    and (
      (
        o.name ~* '^forms/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
        and not exists (
          select 1 from public.forms f
          where (f.id::text = split_part(o.name, '/', 2)
                 and o.user_metadata ->> 'surveyThemeCopy' is distinct from 'true')
            or strpos(f.theme::text, o.name) > 0
            or strpos(f.schema::text, o.name) > 0
        )
      )
      or (
        o.name ~* '^app-branding/sidebar-logo-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
        and not exists (
          select 1 from public.app_branding branding
          where branding.sidebar_logo_path = o.name
        )
      )
    )
  order by o.name;
$$;

-- Keep deletion markers through storage/upload retries. Only absent,
-- unreserved paths can age out.
create index if not exists idx_survey_file_deletion_claims_age
on public.survey_file_deletion_claims (claimed_at, object_path);

create index if not exists idx_storage_objects_bucket_created
on storage.objects (bucket_id, created_at, id);

create or replace function public.prune_survey_file_deletion_claims(p_limit integer default 500)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  removed integer;
begin
  with candidates as (
    select c.object_path from public.survey_file_deletion_claims c
    where c.claimed_at < now() - interval '30 days'
      and not exists (
        select 1 from storage.objects o where o.bucket_id = 'survey-files' and o.name = c.object_path
      )
      and not exists (
        select 1 from public.survey_upload_reservations r where r.object_path = c.object_path
      )
      and not exists (
        select 1 from public.response_file_references r where r.object_path = c.object_path
      )
    order by c.claimed_at, c.object_path
    limit least(greatest(coalesce(p_limit, 500), 1), 1000)
    for update skip locked
  )
  delete from public.survey_file_deletion_claims c using candidates p
  where c.object_path = p.object_path;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.prune_survey_file_deletion_claims(integer) from public, anon, authenticated;
grant execute on function public.prune_survey_file_deletion_claims(integer) to service_role;

drop index if exists public.idx_mail_queue_claim;

create index if not exists idx_announcements_active_until
on survey_announcements.announcements (coalesce(expires_at, 'infinity'::timestamptz))
where status = 'published';

create or replace function public.list_notification_feed(
  p_category text default null, p_read text default 'all', p_before_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 26
)
returns table (
  id uuid, category text, title text, message text, form_id uuid, response_id uuid, rule_id uuid,
  created_at timestamptz, read_at timestamptz, announcement jsonb
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (p_before_at is null) <> (p_before_id is null) then
    raise exception 'Укажите дату и идентификатор для следующей страницы' using errcode = '22023';
  end if;
  return query
  with viewer as (
    select auth.uid() as user_id, public.request_role() as role_name
  ), page_size as (
    select least(greatest(coalesce(p_limit, 26), 1), 101) as size
  ), candidates as (
    (select n.id, n.category, n.title, n.message, n.form_id, n.response_id, n.rule_id,
       n.created_at, n.read_at, null::jsonb as announcement
     from viewer v join public.notifications n on n.user_id = v.user_id
     where v.role_name is not null and n.category not in ('automation_triggered', 'automation_succeeded')
       and (p_category is null or n.category = p_category)
       and (p_read = 'all' or (p_read = 'unread' and n.read_at is null) or (p_read = 'read' and n.read_at is not null))
       and (p_before_at is null or (n.created_at, n.id) < (p_before_at, p_before_id))
     order by n.created_at desc, n.id desc limit (select size from page_size))
    union all
    (select a.id, 'announcement'::text, a.title, a.message, null::uuid, null::uuid, null::uuid, a.publish_at, s.read_at,
       jsonb_build_object('display_mode', a.display_mode, 'action_label', a.action_label, 'action_url', a.action_url,
         'require_acknowledgement', a.require_acknowledgement, 'acknowledged_at', s.acknowledged_at)
     from viewer v cross join survey_announcements.announcements a
     left join survey_announcements.recipient_state s on s.announcement_id = a.id and s.user_id = v.user_id
     where (p_category is null or p_category = 'announcement')
       and a.status = 'published'
       and a.publish_at <= now() and coalesce(a.expires_at, 'infinity'::timestamptz) > now()
       and survey_announcements.is_visible(a.status, a.publish_at, a.expires_at, a.audience, v.role_name)
       and (p_read = 'all' or (p_read = 'unread' and s.read_at is null) or (p_read = 'read' and s.read_at is not null))
       and (p_before_at is null or (a.publish_at, a.id) < (p_before_at, p_before_id))
     order by a.publish_at desc, a.id desc limit (select size from page_size))
  )
  select c.* from candidates c order by c.created_at desc, c.id desc limit (select size from page_size);
end;
$$;

create or replace function public.notification_unread_count()
returns bigint language sql stable security definer set search_path = '' as $$
  with viewer as (select auth.uid() as user_id, public.request_role() as role_name)
  select
    (select count(*) from viewer v join public.notifications n on n.user_id = v.user_id
     where v.role_name is not null and n.category not in ('automation_triggered', 'automation_succeeded') and n.read_at is null)
    +
    (select count(*) from viewer v cross join survey_announcements.announcements a
     left join survey_announcements.recipient_state s on s.announcement_id = a.id and s.user_id = v.user_id
     where a.status = 'published'
       and a.publish_at <= now() and coalesce(a.expires_at, 'infinity'::timestamptz) > now()
       and survey_announcements.is_visible(a.status, a.publish_at, a.expires_at, a.audience, v.role_name)
       and s.read_at is null);
$$;

create or replace function survey_automation.on_form_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  a public.automation_rules;
  owner uuid;
  content text;
  changed_at timestamptz;
begin
  if tg_op='UPDATE' and old.author_id=new.author_id and old.form_type=new.form_type
    and old.deadline_at is not distinct from new.deadline_at and old.is_public=new.is_public then return new;
  end if;
  if tg_op='INSERT' or old.author_id<>new.author_id or old.form_type<>new.form_type then
    for owner in select distinct id from unnest(array[old.author_id,new.author_id]) id where id is not null order by id loop
      -- This trigger already holds the form lock. A rule edit may hold the
      -- owner lock while it waits for the form, so yield with a retryable error.
      if not pg_try_advisory_xact_lock(hashtextextended('survey-automation-owner:'||owner::text,0)) then
        raise exception 'Правила формы сейчас изменяются. Повторите сохранение.' using errcode = '40001';
      end if;
    end loop;
    if tg_op='UPDATE' then
      delete from survey_automation.targets t using public.automation_rules r
      where t.form_id=new.id and r.id=t.rule_id and (r.user_id<>new.author_id or new.form_type='template');
    end if;
    if new.form_type<>'template' then
      for a in select * from public.automation_rules
        where user_id=new.author_id and enabled and (form_id is null or form_id=new.id) order by id
      loop
        perform survey_automation.seed_targets(a,new.id);
      end loop;
    end if;
  end if;

  changed_at:=clock_timestamp();
  if tg_op='UPDATE' and old.form_type<>'template' and new.form_type<>'template'
    and old.author_id=new.author_id and old.is_public then
    if old.deadline_at<=changed_at then
      -- Preserve expiry when the deadline or publication is edited before the
      -- worker has consumed its deadline row. The row is always guarded by the form lock.
      if exists (select from survey_automation.form_deadlines d where d.form_id=old.id and d.due_at=old.deadline_at) then
        perform survey_automation.notify(old.author_id,'form_status',
          'deadline-reached:'||old.id||':'||extract(epoch from old.deadline_at)::text,'Срок приёма истёк',old.title,old.id);
        perform survey_automation.stage_form_closed(old,
          'closed:deadline:'||extract(epoch from old.deadline_at)::text,old.deadline_at);
      end if;
    elsif not new.is_public then
      perform survey_automation.stage_form_closed(new,case
        when new.responses_count>=least(coalesce(new.max_responses,100000),100000) then 'closed:limit:'
        else 'closed:manual:' end||new.revision,changed_at);
    elsif new.deadline_at<=changed_at then
      perform survey_automation.stage_form_closed(new,'closed:deadline:'||new.revision,changed_at);
    end if;
  end if;

  if new.form_type<>'template' and new.is_public and new.deadline_at>changed_at then
    insert into survey_automation.form_deadlines(form_id,due_at) values(new.id,new.deadline_at)
    on conflict (form_id) do update set due_at=excluded.due_at;
  else
    delete from survey_automation.form_deadlines where form_id=new.id;
  end if;
  if tg_op='UPDATE' and new.form_type<>'template' then
    if new.is_public is distinct from old.is_public then
      content:=case when new.is_public then 'Открыт приём ответов'
        when new.responses_count>=least(coalesce(new.max_responses,100000),100000) then 'Достигнут лимит ответов'
        else 'Закрыт приём ответов' end;
      perform survey_automation.notify(new.author_id,'form_status','form-status:'||new.id||':'||new.revision,
        content,new.title,new.id);
    end if;
    if new.deadline_at is distinct from old.deadline_at then
      perform survey_automation.notify(new.author_id,'form_status','form-deadline:'||new.id||':'||new.revision,
        case when new.deadline_at is null then 'Срок приёма снят' else 'Срок приёма изменён' end,new.title,new.id);
    end if;
  end if;
  return new;
end;
$$;

drop function survey_automation.process_threshold_checks(integer);

drop function survey_automation.process_schedules(timestamptz, integer);

create or replace function survey_automation.process_threshold_checks(p_limit integer)
returns integer language plpgsql set search_path = '' as $$
declare
  processed integer := 0;
  batch_size constant integer := 1000;
  candidate record;
  target survey_automation.targets;
  rule public.automation_rules;
  f public.forms;
  r public.responses;
  batch record;
  matching integer;
  triggered boolean;
begin
  for candidate in
    select t.rule_id,t.form_id
    from survey_automation.targets t
    join public.automation_rules a on a.id=t.rule_id and a.enabled
    join public.profiles p on p.id=a.user_id and not p.is_disabled
    join public.forms form on form.id=t.form_id and form.author_id=a.user_id and form.form_type<>'template'
    where t.check_at is not null and not t.complete
    order by t.check_at,t.rule_id,t.form_id limit least(p_limit,4)
  loop
    -- Match the deletion path's lock order and skip a rule being edited.
    select a.* into rule from public.automation_rules a
    join public.forms form on form.id=candidate.form_id and form.author_id=a.user_id and form.form_type<>'template'
    join public.profiles p on p.id=a.user_id and not p.is_disabled
    where a.id=candidate.rule_id and a.enabled
    for key share of form,p skip locked for share of a skip locked;
    if not found then continue; end if;

    select * into target from survey_automation.targets t
    where t.rule_id=rule.id and t.form_id=candidate.form_id and t.check_at is not null and not t.complete
    for no key update skip locked;
    if not found then continue; end if;
    select * into f from public.forms where id=target.form_id;
    if f.author_id is distinct from rule.user_id or f.form_type='template' then continue; end if;
    processed := processed + 1;

    matching:=target.matching_count;
    if not target.count_ready then
      with page as materialized (
        select entry.id,entry.created_at,entry.data from public.responses entry
        where entry.form_id=f.id and (entry.created_at,entry.id)>=(
          coalesce(target.count_cursor_at,'-infinity'::timestamptz),
          coalesce(target.count_cursor_id,'00000000-0000-0000-0000-000000000000'::uuid))
          and entry.id is distinct from target.count_cursor_id
        order by entry.created_at,entry.id limit batch_size
      )
      select stats.*,tail.created_at,tail.id into batch
      from (select count(*) as entries,count(*) filter (
        where survey_automation.matches(page.data,rule.conditions,rule.match_mode)) as matches from page) stats
      left join lateral (select id,created_at from page order by created_at desc,id desc limit 1) tail on true;
      matching:=matching+batch.matches;
      if batch.entries=batch_size then
        update survey_automation.targets set matching_count=matching,count_cursor_at=batch.created_at,
          count_cursor_id=batch.id,check_at=clock_timestamp() where rule_id=rule.id and form_id=f.id;
        continue;
      end if;
      target.count_cursor_at:=null;
      target.count_cursor_id:=null;
    end if;

    triggered:=survey_automation.threshold_reached(rule,f.responses_count,matching);
    if triggered then
      select * into r from public.responses entry where entry.id=target.check_response_id and entry.form_id=f.id
        and survey_automation.matches(entry.data,rule.conditions,rule.match_mode);
      if not found then
        -- If the change had no eligible answer, look for the latest match in
        -- bounded descending pages. The count cursor is finished at this point.
        with page as materialized (
          select entry.id,entry.created_at,entry.data from public.responses entry
          where entry.form_id=f.id and (entry.created_at,entry.id)<=(
            coalesce(target.count_cursor_at,'infinity'::timestamptz),
            coalesce(target.count_cursor_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
            and entry.id is distinct from target.count_cursor_id
          order by entry.created_at desc,entry.id desc limit batch_size
        )
        select tail.*,best.id as matching_id,(select count(*) from page) as entries into batch
        from (select id,created_at from page order by created_at,id limit 1) tail
        left join lateral (
          select id from page where survey_automation.matches(data,rule.conditions,rule.match_mode)
          order by created_at desc,id desc limit 1
        ) best on true;
        if batch.matching_id is null and batch.entries=batch_size then
          update survey_automation.targets set matching_count=matching,count_ready=true,count_cursor_at=batch.created_at,
            count_cursor_id=batch.id,check_at=clock_timestamp() where rule_id=rule.id and form_id=f.id;
          continue;
        end if;
        select * into r from public.responses where id=batch.matching_id and form_id=f.id;
      end if;
      triggered:=r.id is not null;
      if triggered then perform survey_automation.stage_run(rule,f,'threshold',r,matching); end if;
    end if;
    update survey_automation.targets set complete=triggered,matching_count=matching,count_ready=true,
      count_cursor_at=null,count_cursor_id=null,check_at=null,check_response_id=null
      where rule_id=rule.id and form_id=f.id;
  end loop;
  return processed;
end;
$$;

create or replace function survey_automation.process_schedules(p_now timestamptz,p_limit integer)
returns integer language plpgsql set search_path = '' as $$
declare
  processed integer := 0;
  candidate record;
  due survey_automation.targets;
  deadline record;
  rule public.automation_rules;
  f public.forms;
  r public.responses;
  page record;
  slot timestamptz;
  next_slot timestamptz;
  key text;
begin
  for candidate in
    select t.rule_id,t.form_id from survey_automation.targets t
    join public.automation_rules a on a.id=t.rule_id and a.enabled
    join public.profiles p on p.id=a.user_id and not p.is_disabled
    join public.forms form on form.id=t.form_id and form.author_id=a.user_id and form.form_type<>'template'
    where t.next_run_at<=p_now order by t.next_run_at,t.rule_id,t.form_id limit least(p_limit,4)
  loop
    -- Acquire parents before the target, following the threshold worker's lock order.
    select a.* into rule from public.automation_rules a
    join public.forms form on form.id=candidate.form_id and form.author_id=a.user_id and form.form_type<>'template'
    join public.profiles p on p.id=a.user_id and not p.is_disabled
    where a.id=candidate.rule_id and a.enabled
    for key share of form,p skip locked for share of a skip locked;
    if not found then continue; end if;
    select * into due from survey_automation.targets t
    where t.rule_id=rule.id and t.form_id=candidate.form_id and t.next_run_at<=p_now and not t.complete
    for no key update skip locked;
    if not found then continue; end if;
    select * into f from public.forms where id=due.form_id;

    next_slot:=null;
    slot:=null;
    case rule.event_type
      when 'date' then key:='date';
      when 'inactivity' then key:='gap:'||due.gap_key;
      when 'recurring' then
        slot:=coalesce(due.schedule_slot_at,survey_automation.schedule_slot(rule.scheduled_at,rule.interval_minutes,p_now));
        key:='slot:'||extract(epoch from slot)::text;
        next_slot:=survey_automation.schedule_slot(rule.scheduled_at,rule.interval_minutes,p_now)
          +make_interval(mins=>rule.interval_minutes);
      else continue;
    end case;
    processed := processed + 1;
    if rule.conditions='[]'::jsonb then
      select * into r from public.responses entry where entry.form_id=f.id
        order by created_at desc,id desc limit 1;
    else
      -- Each target uses the count cursor for either a threshold or a scheduled search, never both.
      with batch as materialized (
        select entry.id,entry.created_at,entry.data from public.responses entry
        where entry.form_id=f.id and (entry.created_at,entry.id)<(
          coalesce(due.count_cursor_at,'infinity'::timestamptz),
          coalesce(due.count_cursor_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
        order by entry.created_at desc,entry.id desc limit 500
      )
      select (select count(*) from batch) as entries,tail.id,tail.created_at,
        (select b.id from batch b where survey_automation.matches(b.data,rule.conditions,rule.match_mode)
          order by b.created_at desc,b.id desc limit 1) as matching_id into page
      from (select id,created_at from batch order by created_at,id limit 1) tail;
      if page.matching_id is null and page.entries=500 then
        update survey_automation.targets set count_cursor_at=page.created_at,count_cursor_id=page.id,
          schedule_slot_at=slot,next_run_at=clock_timestamp() where rule_id=rule.id and form_id=f.id;
        continue;
      end if;
      select * into r from public.responses where id=page.matching_id and form_id=f.id;
    end if;
    if r.id is not null or rule.conditions='[]'::jsonb then
      perform survey_automation.stage_run(rule,f,key,r);
    end if;
    update survey_automation.targets set next_run_at=next_slot,complete=(rule.event_type='date'),
      count_cursor_at=null,count_cursor_id=null,schedule_slot_at=null where rule_id=rule.id and form_id=f.id;
  end loop;

  for deadline in
    -- Updates to a form can replace or consume its deadline. Both paths take
    -- the form lock before touching the deadline row.
    select d.* from survey_automation.form_deadlines d
    join public.forms form on form.id=d.form_id
    where d.due_at<=p_now
    order by d.due_at,d.form_id limit p_limit for no key update of form skip locked
  loop
    select * into f from public.forms where id=deadline.form_id;
    if found and f.is_public and f.form_type<>'template' and f.deadline_at=deadline.due_at then
      perform survey_automation.notify(f.author_id,'form_status',
        'deadline-reached:'||f.id||':'||extract(epoch from deadline.due_at)::text,'Срок приёма истёк',f.title,f.id);
      perform survey_automation.stage_form_closed(f,
        'closed:deadline:'||extract(epoch from deadline.due_at)::text,deadline.due_at);
    end if;
    delete from survey_automation.form_deadlines where form_id=deadline.form_id and due_at=deadline.due_at;
    if found then processed := processed + 1; end if;
  end loop;
  return processed;
end;
$$;

create or replace function public.process_automations(p_app_origin text,p_limit integer default 50)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  max_items integer := least(greatest(coalesce(p_limit,50),1),100);
  candidate record;
  run public.automation_runs;
  f public.forms;
  snapshot jsonb;
  completed integer := 0;
  sweep_time timestamptz := clock_timestamp();
begin
  if p_app_origin is null or p_app_origin !~ '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' or length(p_app_origin)>300
    or coalesce(substring(p_app_origin from ':([0-9]{1,5})$')::integer,1) not between 1 and 65535 then
    raise exception 'Для ссылок в письмах задайте PUBLIC_APP_URL' using errcode='P0001';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('survey-automation-worker',0)) then return 0; end if;
  completed := survey_automation.process_schedules(sweep_time,max_items)
    + survey_automation.process_threshold_checks(max_items);

  -- An expired SMTP lease can represent a successfully accepted message.
  -- Automation jobs are never delivered again after such an uncertain outcome.
  with expired as (
    select q.id from public.mail_queue q
    where q.automation_run_id is not null and (
      (q.status='queued' and not survey_automation.run_is_active(q.automation_run_id))
      or (q.status = 'processing' and q.locked_at<sweep_time-interval '10 minutes'))
    order by q.created_at,q.id limit max_items for update skip locked
  )
  update public.mail_queue q set status='failed',locked_by=null,locked_at=null,
    last_error=case when q.status = 'processing' then 'Не удалось подтвердить отправку письма'
      else 'Правило выключено, изменено или данные больше недоступны' end
    from expired e where q.id=e.id;

  for candidate in select id,form_id from public.automation_runs where status='pending'
    order by created_at,id limit max_items
  loop
    -- Take locks in the same order as the form deletion path.
    select * into f from public.forms where id=candidate.form_id for key share skip locked;
    if not found and exists(select from public.forms where id=candidate.form_id) then continue; end if;
    select * into run from public.automation_runs where id=candidate.id and status='pending' for no key update skip locked;
    if not found then continue; end if;

    if f.id is not null and survey_automation.run_is_active(run.id) then
      begin
        select payload into strict snapshot from survey_automation.payloads where run_id=run.id;
        case snapshot->>'actionType'
          when 'email' then perform survey_automation.dispatch_email(run,f,p_app_origin,snapshot);
          else raise exception 'Действие правила недоступно' using errcode='P0001';
        end case;
      exception
        when raise_exception then
          update public.automation_runs set status='failed',last_error=SQLERRM where id=run.id returning * into run;
          perform survey_automation.terminal_notice(run);
        when data_exception or integrity_constraint_violation or no_data_found then
          raise log 'Automation run % could not prepare an email (%)',run.id,SQLSTATE;
          update public.automation_runs set status='failed',last_error='Не удалось подготовить письмо'
            where id=run.id returning * into run;
          perform survey_automation.terminal_notice(run);
      end;
    else
      update public.automation_runs set status='cancelled',last_error='Правило выключено, изменено или данные больше недоступны'
        where id=run.id returning * into run;
      perform survey_automation.terminal_notice(run);
    end if;
    delete from survey_automation.payloads where run_id=run.id;
    completed:=completed+1;
  end loop;
  return completed;
end;
$$;

notify pgrst, 'reload schema';

commit;
