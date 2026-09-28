begin;

-- Accept SurveyJS comment fields only for questions that enable them.
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
          element ->> 'name' = response_key
          or (
            -- SurveyJS stores "Other" text and question comments separately.
            response_key = (element ->> 'name') || coalesce(nullif(form_schema ->> 'commentSuffix', ''), '-Comment')
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
    question_name := question ->> 'name';
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

commit;
