begin;

alter table public.survey_upload_reservations add column if not exists response_browser_hash uuid;

create or replace function public.survey_response_bindings(
  p_schema jsonb, p_data jsonb, p_path text[] default '{}'::text[], p_depth integer default 0
)
returns table (question jsonb, value jsonb, value_path text[])
language plpgsql immutable set search_path = ''
as $$
declare
  child jsonb;
  entry record;
  answer_path text[];
  answer_value jsonb;
begin
  if p_depth > 32 then
    raise exception 'Структура формы превышает допустимую глубину' using errcode = '22023';
  end if;
  if jsonb_typeof(p_schema -> 'type') = 'string' and p_schema ->> 'type' <> 'panel'
    and jsonb_typeof(p_schema -> 'name') = 'string'
  then
    answer_path := p_path || coalesce(nullif(p_schema ->> 'valueName', ''), p_schema ->> 'name');
    answer_value := p_data -> coalesce(nullif(p_schema ->> 'valueName', ''), p_schema ->> 'name');
    return query select p_schema, answer_value, answer_path;
    if p_schema ->> 'type' = 'paneldynamic' and jsonb_typeof(answer_value) = 'array' then
      for entry in select item, ordinality from jsonb_array_elements(answer_value) with ordinality a(item, ordinality)
      loop
        return query select * from public.survey_response_bindings(
          jsonb_build_object('elements', case when jsonb_typeof(p_schema -> 'templateElements') = 'array' then p_schema -> 'templateElements' else '[]'::jsonb end), entry.item,
          answer_path || (entry.ordinality - 1)::text, p_depth + 1);
      end loop;
    end if;
    return;
  end if;
  for child in
    select item from jsonb_array_elements(case when jsonb_typeof(p_schema -> 'pages') = 'array' then p_schema -> 'pages' else '[]'::jsonb end) a(item)
    union all
    select item from jsonb_array_elements(case when jsonb_typeof(p_schema -> 'elements') = 'array' then p_schema -> 'elements' else '[]'::jsonb end) a(item)
  loop
    return query select * from public.survey_response_bindings(child, p_data, p_path, p_depth + 1);
  end loop;
end;
$$;
create or replace function public.sync_response_file_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_path text;
  previous_paths text[] := '{}'::text[];
begin
  if tg_op = 'UPDATE' then
    if old.form_id = new.form_id and old.browser_id is not distinct from new.browser_id then
      select coalesce(array_agg(object_path), '{}'::text[]) into previous_paths
      from public.response_file_references where response_id = old.id and form_id = new.form_id;
    end if;
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
      if split_part(candidate_path, '/', 1) = 'public' then
        -- Keep exact existing attachments after old reservations are pruned.
        -- New paths require a browser capability, including personal responses.
        if not (candidate_path = any(previous_paths)) or exists (
          select 1 from public.survey_upload_reservations r where r.object_path = candidate_path
        ) then
          -- Serialize attachment against the cleanup worker's row update.
          update public.survey_upload_reservations r set attached = true
          where r.object_path = candidate_path and r.form_id = new.form_id and not r.cleanup_claimed
            and (r.browser_hash = new.browser_id or r.response_browser_hash = new.browser_id
              or candidate_path = any(previous_paths))
            and (r.expires_at > clock_timestamp() or candidate_path = any(previous_paths));
          if not found then
            raise exception 'Файл недоступен. Прикрепите файл заново.' using errcode = '22023';
          end if;
        end if;
      elsif not (candidate_path = any(previous_paths)) and (
        auth.uid() is null or not public.request_is_enabled()
        or split_part(candidate_path, '/', 1)::uuid <> auth.uid()
      ) then
        raise exception 'Файл недоступен. Прикрепите файл заново.' using errcode = '22023';
      end if;
      insert into public.response_file_references (response_id, form_id, object_path)
      values (new.id, new.form_id, candidate_path)
      on conflict do nothing;
    end if;
  end loop;

  return new;
end;
$$;

-- Preserve the local uploader capability while binding a personal response.
create or replace function public.reserve_personal_survey_upload(
  p_form_id uuid, p_browser_id uuid, p_client_hash text, p_size bigint, p_extension text, p_token uuid
)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  link public.form_personal_links%rowtype;
  reserved_path text;
begin
  link := public.resolve_form_personal_link(p_form_id, p_token);
  reserved_path := public.reserve_survey_upload(p_form_id, p_browser_id, p_client_hash, p_size, p_extension);
  update public.survey_upload_reservations
  set response_browser_hash = public.browser_capability_hash(link.browser_id)
  where object_path = reserved_path;
  return reserved_path;
end;
$$;
revoke all on function public.reserve_personal_survey_upload(uuid,uuid,text,bigint,text,uuid) from public, anon, authenticated;
grant execute on function public.reserve_personal_survey_upload(uuid,uuid,text,bigint,text,uuid) to service_role;

-- Restored drafts from earlier releases need the same association. Both the
-- uploader browser and the personal token must be valid; a path is insufficient.
create or replace function public.bind_personal_survey_upload(
  p_form_id uuid, p_token uuid, p_browser_id uuid, p_path text
)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare link public.form_personal_links%rowtype;
begin
  link := public.resolve_form_personal_link(p_form_id, p_token);
  update public.survey_upload_reservations r
  set response_browser_hash = public.browser_capability_hash(link.browser_id)
  where r.object_path = p_path and r.form_id = p_form_id
    and r.browser_hash = public.browser_capability_hash(p_browser_id)
    and not r.cleanup_claimed and (r.attached or r.expires_at > clock_timestamp());
  return found;
end;
$$;
revoke all on function public.bind_personal_survey_upload(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.bind_personal_survey_upload(uuid,uuid,uuid,text) to service_role;

commit;
