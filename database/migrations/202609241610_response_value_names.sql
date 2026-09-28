begin;

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
  question jsonb;
  question_name text;
  organization_id uuid;
begin
  if jsonb_typeof(response_data) <> 'object' or pg_column_size(response_data) > 262144 then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_object_keys(response_data) response_key
    where not exists (
      select 1
      from jsonb_path_query(form_schema, '$.** ? (@.type() == "object")', '{}'::jsonb, true) element
      where jsonb_typeof(element -> 'name') = 'string'
        and (
          coalesce(nullif(element ->> 'valueName', ''), element ->> 'name') = response_key
          or (
            -- SurveyJS stores "Other" text and question comments separately.
            response_key = coalesce(nullif(element ->> 'valueName', ''), element ->> 'name') || coalesce(nullif(form_schema ->> 'commentSuffix', ''), '-Comment')
            and (element @> '{"showOtherItem":true}' or element @> '{"showCommentArea":true}'
              or element @> '{"hasOther":true}' or element @> '{"hasComment":true}')
            and jsonb_typeof(response_data -> response_key) = 'string'
          )
        )
    )
  ) then
    return false;
  end if;

  for question in
    select element
    from jsonb_path_query(form_schema, '$.** ? (@.type() == "object")', '{}'::jsonb, true) element
    where element ->> 'type' = 'organization'
      and jsonb_typeof(element -> 'name') = 'string'
  loop
    question_name := coalesce(nullif(question ->> 'valueName', ''), question ->> 'name');
    if response_data ? question_name then
      begin
        organization_id := (response_data ->> question_name)::uuid;
      exception when invalid_text_representation then
        return false;
      end;

      if not exists (
        select 1
        from public.education_organizations organization
        where organization.id = organization_id
          and organization.organization_type = any(allowed_organization_types)
      ) then
        return false;
      end if;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function public.response_data_matches_form(jsonb, text[], jsonb) from public;
grant execute on function public.response_data_matches_form(jsonb, text[], jsonb) to service_role;

create or replace function public.validate_response_payload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_form public.forms%rowtype;
  question_name text;
  selected_is_archived boolean;
begin
  select f.* into target_form from public.forms f where f.id = new.form_id;
  if target_form.id is null
    or not public.response_data_matches_form(target_form.schema, target_form.organization_types, new.data)
  then
    raise exception 'Ответ не соответствует структуре формы' using errcode = '22023';
  end if;
  -- Lock selected organizations against concurrent archiving until the response commits.
  for question_name in
    select distinct coalesce(nullif(element ->> 'valueName', ''), element ->> 'name')
    from jsonb_path_query(target_form.schema, '$.** ? (@.type() == "object")', '{}'::jsonb, true) element
    where element ->> 'type' = 'organization'
      and jsonb_typeof(element -> 'name') = 'string'
    order by 1
  loop
    if new.data ? question_name then
      select o.is_archived into selected_is_archived
      from public.education_organizations o
      where o.id = (new.data ->> question_name)::uuid
      for share;
      if not found then
        raise exception 'Организация не найдена' using errcode = '22023';
      end if;
      if selected_is_archived then
        if tg_op = 'INSERT' then
          raise exception 'Организация удалена из действующего справочника' using errcode = '22023';
        elsif new.form_id is distinct from old.form_id
          or (new.data -> question_name) is distinct from (old.data -> question_name)
        then
          raise exception 'Архивную организацию можно сохранить только в прежнем ответе' using errcode = '22023';
        end if;
      end if;
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.validate_response_payload() from public;

commit;
