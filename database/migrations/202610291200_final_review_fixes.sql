begin;

-- A durable tombstone: a failed/uncertain Storage request may still finish.
-- Never expire a claim and allow a new attachment while deletion is in flight.
create table public.survey_file_deletion_claims (
  object_path text primary key check (length(object_path) between 3 and 1024),
  claimed_at timestamptz not null default clock_timestamp()
);
alter table public.survey_file_deletion_claims enable row level security;
revoke all on public.survey_file_deletion_claims from anon, authenticated;
grant all on public.survey_file_deletion_claims to service_role;

create or replace function public.survey_file_path(value text, form_id uuid)
returns text language plpgsql immutable set search_path = '' as $$
declare path text := value; encoded text;
begin
  -- URL hosts never confer authority and are never fetched. Only the normalized
  -- local object path is stored, then checked against its upload capability.
  if value ~* '^https?://' then
    encoded := substring(value from '^https?://[^/?#]+(?:/[^?#]*)?/storage/v1/object/(?:public|sign)/survey-files/([^?#]+)');
    if encoded is null then raise exception 'Некорректная ссылка на файл' using errcode='22023'; end if;
    if length(encoded)>8192 or encoded ~ '%(?![0-9a-fA-F]{2})' then
      raise exception 'Некорректная ссылка на файл' using errcode='22023';
    end if;
    begin
      select convert_from(decode(string_agg(case when m[1] is not null then m[1]
        else encode(convert_to(m[2],'UTF8'),'hex') end,''),'hex'),'UTF8') into path
      from regexp_matches(encoded,'%([0-9a-fA-F]{2})|([^%])','g') m;
    exception when others then raise exception 'Некорректная ссылка на файл' using errcode='22023'; end;
  end if;
  if path is null or length(path)>1024
    or path !~* '^(public|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
    or split_part(path,'/',2) <> form_id::text or length(split_part(path,'/',3))>512
    or split_part(path,'/',3) in ('.','..')
  then raise exception 'Файл должен принадлежать этой форме' using errcode='22023'; end if;
  return path;
end;
$$;
revoke all on function public.survey_file_path(text,uuid) from public, anon, authenticated;

create or replace function public.normalize_survey_file_value(value jsonb, form_id uuid, depth integer default 0)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare result jsonb := value; item jsonb; key text; path text; next_path text; present boolean := false;
begin
  if depth>32 then raise exception 'Слишком сложное значение файла' using errcode='22023'; end if;
  if value is null or value='null'::jsonb or value='""'::jsonb then return value; end if;
  if jsonb_typeof(value)='array' then
    result := '[]'::jsonb;
    for item in select * from jsonb_array_elements(value) loop
      result := result || jsonb_build_array(public.normalize_survey_file_value(item,form_id,depth+1));
    end loop;
    return result;
  elsif jsonb_typeof(value)='string' then
    return to_jsonb(public.survey_file_path(value #>> '{}',form_id));
  elsif jsonb_typeof(value)='object' then
    foreach key in array array['storagePath','path','content'] loop
      if value ? key then
        if jsonb_typeof(value->key) <> 'string' then
          raise exception 'Некорректное значение файла' using errcode='22023';
        end if;
        next_path := public.survey_file_path(value->>key,form_id);
        if present and path<>next_path then raise exception 'Противоречивые ссылки на файл' using errcode='22023'; end if;
        path := next_path; present := true;
        result := jsonb_set(result,array[key],to_jsonb(path));
      end if;
    end loop;
    if present then return result; end if;
  end if;
  raise exception 'Некорректное значение файла. Прикрепите файл заново.' using errcode='22023';
end;
$$;
revoke all on function public.normalize_survey_file_value(jsonb,uuid,integer) from public, anon, authenticated;

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
          jsonb_build_object('elements',case when jsonb_typeof(p_schema->'templateElements')='array' then p_schema->'templateElements' else '[]'::jsonb end),
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
    return;
  end if;
  for child in
    select item from jsonb_array_elements(case when jsonb_typeof(p_schema->'pages')='array' then p_schema->'pages' else '[]'::jsonb end) a(item)
    union all select item from jsonb_array_elements(case when jsonb_typeof(p_schema->'elements')='array' then p_schema->'elements' else '[]'::jsonb end) a(item)
  loop return query select * from public.survey_response_bindings(child,p_data,p_path,p_depth+1); end loop;
end;
$$;

create or replace function public.survey_response_value_is_valid(question jsonb, value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select value is null or value='null'::jsonb or case
    when question->>'type'='signaturepad' then jsonb_typeof(value)='string'
    when question->>'type' in ('text','comment','rating','integer','float','number','date','datetime','time','email','phone')
      then jsonb_typeof(value) in ('string','number','boolean')
    when question->>'type'='boolean' then jsonb_typeof(value)='boolean'
      or value=question->'valueTrue' or value=question->'valueFalse'
    when question->>'type' in ('checkbox','tagbox','ranking','paneldynamic','matrixdynamic')
      or (question->>'type'='imagepicker' and question->>'multiSelect'='true')
      then jsonb_typeof(value)='array'
    when question->>'type' in ('matrix','matrixdropdown','multipletext') then jsonb_typeof(value)='object'
    else true end;
$$;
revoke all on function public.survey_response_value_is_valid(jsonb,jsonb) from public, anon, authenticated;

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
  binding record;
  organization_id uuid;
  comment_suffix text := coalesce(nullif(form_schema ->> 'commentSuffix', ''), '-Comment');
begin
  if jsonb_typeof(response_data) is distinct from 'object' or pg_column_size(response_data) > 262144 then
    return false;
  end if;
  for binding in select * from public.survey_response_bindings(form_schema, response_data)
  loop
    if not coalesce(public.survey_response_value_is_valid(binding.question, binding.value), false) then return false; end if;
    if binding.question ->> 'type' = 'paneldynamic' and binding.value is not null then
      if jsonb_typeof(binding.value) <> 'array' then return false; end if;
      if exists (select 1 from jsonb_array_elements(binding.value) e where jsonb_typeof(e) <> 'object') then
        return false;
      end if;
    elsif binding.question ->> 'type' = 'organization' and binding.value is not null then
      if jsonb_typeof(binding.value) <> 'string' then return false; end if;
      begin
        organization_id := (binding.value #>> '{}')::uuid;
      exception when invalid_text_representation then
        return false;
      end;
      if not exists (
        select 1 from public.education_organizations organization
        where organization.id = organization_id
          and organization.organization_type = any(allowed_organization_types)
      ) then
        return false;
      end if;
    end if;
  end loop;

  return not exists (
    with bindings as materialized (
      select * from public.survey_response_bindings(form_schema, response_data)
    ), scopes as (
      select '{}'::text[] as path, response_data as data
      union all
      select b.value_path || (e.ordinality - 1)::text, e.item
      from bindings b
      cross join lateral jsonb_array_elements(
        case when b.question ->> 'type' = 'paneldynamic' and jsonb_typeof(b.value) = 'array'
          then b.value else '[]'::jsonb end
      ) with ordinality e(item, ordinality)
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
    )
    select 1 from scopes s cross join lateral jsonb_object_keys(s.data) k(name)
    where not exists (select 1 from allowed_paths a where a.path = s.path || k.name)
  );
end;
$$;

create or replace function public.prepare_response_files()
returns trigger language plpgsql security definer set search_path = '' as $$
declare form_schema jsonb; binding record; path text; previous_paths text[] := '{}'::text[];
begin
  select schema into form_schema from public.forms where id=new.form_id;
  for binding in select * from public.survey_response_bindings(form_schema,new.data) loop
    if not coalesce(public.survey_response_value_is_valid(binding.question,binding.value),false) then
      raise exception 'Некорректный тип значения ответа' using errcode='22023';
    end if;
    if binding.question->>'type'='file' and binding.value is not null then
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
revoke all on function public.prepare_response_files() from public, anon, authenticated;
create trigger responses_prepare_files before insert or update of data,form_id on public.responses
for each row execute function public.prepare_response_files();

create or replace function public.claim_survey_file_deletions(p_paths text[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare path text; result text[] := '{}'::text[];
begin
  if p_paths is null then raise exception 'Некорректный список файлов' using errcode='22023'; end if;
  for path in select distinct p from unnest(p_paths) p where p is not null order by p loop
    if length(path)>1024 then raise exception 'Некорректный путь файла' using errcode='22023'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('survey-file/'||path,0));
    if not exists(select 1 from public.response_file_references where object_path=path) then
      insert into public.survey_file_deletion_claims(object_path) values(path) on conflict do nothing;
      result := array_append(result,path);
    end if;
  end loop;
  return to_jsonb(result);
end;
$$;
revoke all on function public.claim_survey_file_deletions(text[]) from public, anon, authenticated;
grant execute on function public.claim_survey_file_deletions(text[]) to service_role;

create or replace function public.confirm_orphan_survey_files(cutoff timestamptz,object_names text[])
returns table(name text) language plpgsql volatile security definer set search_path = '' as $$
declare paths text[];
begin
  select coalesce(array_agg(o.name),'{}'::text[]) into paths from storage.objects o
  where cardinality(object_names) between 1 and 500 and o.bucket_id='survey-files'
    and o.name=any(object_names) and o.created_at<cutoff;
  return query select jsonb_array_elements_text(public.claim_survey_file_deletions(paths));
end;
$$;

create or replace function public.can_delete_survey_file(object_name text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.request_is_enabled() or split_part(object_name,'/',1)<>auth.uid()::text
    or cardinality(string_to_array(object_name,'/'))<>3
    or not exists(select 1 from storage.objects where bucket_id='survey-files' and name=object_name) then return false; end if;
  return public.claim_survey_file_deletions(array[object_name]) ? object_name;
end;
$$;

create or replace function public.list_expired_survey_uploads(batch_limit integer default 100)
returns table(name text) language plpgsql volatile security definer set search_path = '' as $$
declare candidate record;
begin
  for candidate in
    select r.object_path from public.survey_upload_reservations r
    where r.expires_at<now() and not r.attached
      and (not r.cleanup_claimed or r.cleanup_claimed_at is null or r.cleanup_claimed_at<now()-interval '10 minutes')
      and exists(select 1 from storage.objects o where o.bucket_id='survey-files' and o.name=r.object_path)
      and not exists(select 1 from public.response_file_references rf where rf.object_path=r.object_path)
    order by r.object_path limit least(greatest(batch_limit,1),500) for update skip locked
  loop
    -- Reservation rows are locked first here. Do not wait for an attacher which
    -- already owns the path lock and may itself need the reservation row.
    if pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('survey-file/'||candidate.object_path,0))
      and public.claim_survey_file_deletions(array[candidate.object_path]) ? candidate.object_path then
      update public.survey_upload_reservations set cleanup_claimed=true,cleanup_claimed_at=now()
        where object_path=candidate.object_path;
      return query select candidate.object_path;
    end if;
  end loop;
end;
$$;

create or replace function public.can_restore_survey_upload(p_path text,p_browser_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_browser_id is not null
    and exists(select 1 from storage.objects where bucket_id='survey-files' and name=p_path)
    and not exists(select 1 from public.survey_file_deletion_claims where object_path=p_path)
    and (
      exists(select 1 from public.survey_upload_reservations r where r.object_path=p_path
        and r.browser_hash=public.browser_capability_hash(p_browser_id)
        and not r.cleanup_claimed and (r.attached or r.expires_at>now()))
      or exists(select 1 from public.responses r join public.response_file_references ref on ref.response_id=r.id
        where r.browser_id=public.browser_capability_hash(p_browser_id) and ref.object_path=p_path)
    );
$$;

create or replace function public.delete_form_responses_with_files(p_form_id uuid,p_response_ids uuid[],p_actor_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare author uuid; paths text[]; removed integer;
begin
  if p_response_ids is null or cardinality(p_response_ids) not between 1 and 100
    or array_position(p_response_ids,null) is not null then raise exception 'Некорректный список ответов' using errcode='22023'; end if;
  select author_id into author from public.forms where id=p_form_id for update;
  if not found then raise exception 'Форма не найдена' using errcode='P0002'; end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and not is_disabled
    and (id=author or role='admin')) then raise exception 'Нет прав на удаление ответов' using errcode='42501'; end if;
  select coalesce(array_agg(distinct object_path),'{}'::text[]) into paths from public.response_file_references
    where form_id=p_form_id and response_id=any(p_response_ids);
  delete from public.responses where form_id=p_form_id and id=any(p_response_ids);
  get diagnostics removed=row_count;
  return jsonb_build_object('deletedResponses',removed,'objectPaths',public.claim_survey_file_deletions(paths));
end;
$$;
revoke all on function public.delete_form_responses_with_files(uuid,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.delete_form_responses_with_files(uuid,uuid[],uuid) to service_role;

create or replace function public.increment_form_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Response arrivals are checked separately by update-schema's count CAS.
  if (to_jsonb(new) - array['responses_count','revision']) is distinct from
     (to_jsonb(old) - array['responses_count','revision']) then
    new.revision := old.revision + 1;
  else new.revision := old.revision;
  end if;
  return new;
end;
$$;

-- Table-level REVOKE does not revoke old column-level INSERT grants.
revoke insert(form_id,submission_id,data) on public.responses from anon,authenticated;

commit;
