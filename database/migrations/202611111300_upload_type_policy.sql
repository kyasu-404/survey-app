begin;

-- These are author-selected SurveyJS rules, not an application-wide allowlist.
-- Keep the built-in categories aligned with survey-core's acceptedFileCategories.
create or replace function public.survey_question_upload_rules(p_question jsonb)
returns text[] language plpgsql immutable set search_path = '' as $$
declare rules text[] := '{}'::text[]; item jsonb; category text; raw_types text;
begin
  if jsonb_typeof(p_question->'acceptedTypes')='array' then
    for item in select * from jsonb_array_elements(p_question->'acceptedTypes') loop
      if jsonb_typeof(item)<>'string' then return array['!invalid']; end if;
      rules:=rules || string_to_array(lower(item #>> '{}'),',');
    end loop;
  elsif jsonb_typeof(p_question->'acceptedTypes')='string' then
    rules:=string_to_array(lower(p_question->>'acceptedTypes'),',');
  elsif p_question ? 'acceptedTypes' and p_question->'acceptedTypes'<>'null'::jsonb then
    return array['!invalid'];
  end if;
  if jsonb_typeof(p_question->'acceptedCategories')='array' then
    for category in select value from jsonb_array_elements_text(p_question->'acceptedCategories') loop
      raw_types:=case category
        when 'image' then '.png,.jpg,.jpeg,.gif,.bmp,.tiff,.svg'
        when 'video' then '.mp4,.avi,.mov,.wmv,.flv,.mkv,.webm'
        when 'audio' then '.mp3,.wav,.aac,.ogg,.wma,.flac'
        when 'document' then '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.rtf,.odt'
        when 'archive' then '.zip,.rar,.7z,.tar,.gz'
        when 'custom' then '' else '!invalid' end;
      rules:=rules || string_to_array(raw_types,',');
    end loop;
  end if;
  return array(select distinct btrim(rule) from unnest(rules) rule where btrim(rule)<>'');
end;
$$;
revoke all on function public.survey_question_upload_rules(jsonb) from public, anon, authenticated;

create or replace function public.survey_question_upload_type_allowed(p_question jsonb, p_file_name text, p_mime_type text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  rules text[]:=public.survey_question_upload_rules(p_question); rule text;
  file_name text:=lower(coalesce(p_file_name,''));
  mime_type text:=lower(btrim(split_part(coalesce(p_mime_type,''),';',1)));
  -- A claimed common MIME must also agree with its filename extension. Types
  -- outside this consistency map still follow the author's exact/wildcard rule;
  -- MIME values are declarations, not content-signature validation.
  known_types jsonb:='{
    "application/pdf":[".pdf"],"text/plain":[".txt",".text",".log"],"text/csv":[".csv"],
    "application/msword":[".doc",".dot"],"application/vnd.ms-excel":[".xls",".xlt"],
    "application/vnd.ms-powerpoint":[".ppt",".pps",".pot"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":[".docx"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":[".xlsx"],
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":[".pptx"],
    "application/vnd.oasis.opendocument.text":[".odt"],"application/vnd.oasis.opendocument.spreadsheet":[".ods"],
    "application/vnd.oasis.opendocument.presentation":[".odp"],"application/rtf":[".rtf"],"text/rtf":[".rtf"],
    "image/png":[".png"],"image/jpeg":[".jpg",".jpeg",".jpe"],"image/gif":[".gif"],
    "image/webp":[".webp"],"image/bmp":[".bmp"],"image/tiff":[".tif",".tiff"],
    "image/svg+xml":[".svg",".svgz"],"image/avif":[".avif"],"image/heic":[".heic"],"image/heif":[".heif"],
    "application/zip":[".zip"],"application/x-zip-compressed":[".zip"],
    "application/x-7z-compressed":[".7z"],"application/vnd.rar":[".rar"],"application/x-rar-compressed":[".rar"],
    "application/gzip":[".gz"],"application/x-gzip":[".gz"],"application/x-tar":[".tar"],
    "audio/mpeg":[".mp3"],"audio/wav":[".wav"],"audio/ogg":[".ogg",".oga"],
    "video/mp4":[".mp4",".m4v"],"video/webm":[".webm"],"video/quicktime":[".mov"],
    "text/html":[".html",".htm"],"application/json":[".json"],"application/xml":[".xml"],"text/xml":[".xml"]
  }';
begin
  if cardinality(rules)=0 then return true; end if;
  foreach rule in array rules loop
    if rule in ('*','*/*') then return true; end if;
    if left(rule,1)='.' and right(file_name,length(rule))=rule then return true; end if;
    if rule=mime_type or (rule ~ '^[a-z0-9!#$&^_.+-]+/\*$' and split_part(rule,'/',1)=split_part(mime_type,'/',1)) then
      if not (known_types ? mime_type) or exists(
        select 1 from jsonb_array_elements_text(known_types->mime_type) extension where right(file_name,length(extension))=extension
      ) then return true; end if;
    end if;
    -- Some browsers omit the type for office documents. A known extension can
    -- establish the MIME only when no more specific type was supplied.
    if mime_type in ('','application/octet-stream') and known_types ? rule and exists(
      select 1 from jsonb_array_elements_text(known_types->rule) extension where right(file_name,length(extension))=extension
    ) then return true; end if;
  end loop;
  return false;
end;
$$;
revoke all on function public.survey_question_upload_type_allowed(jsonb,text,text) from public, anon, authenticated;

-- Traverse only schema containers, including matrix file columns, repeated
-- panel templates and signature questions sharing SurveyJS's upload handler.
-- Runtime names and valueName aliases resolve to stored rules.
create or replace function public.survey_upload_questions(p_schema jsonb, p_depth integer default 0)
returns setof jsonb language plpgsql immutable set search_path = '' as $$
declare child jsonb; container text; cell_type text;
begin
  if p_depth>32 then raise exception 'Структура формы превышает допустимую глубину' using errcode='22023'; end if;
  if p_schema->>'type' in ('file','signaturepad') then return next p_schema; end if;
  foreach container in array array['pages','elements','templateElements','detailElements'] loop
    for child in select * from jsonb_array_elements(case when jsonb_typeof(p_schema->container)='array' then p_schema->container else '[]'::jsonb end) loop
      return query select * from public.survey_upload_questions(child,p_depth+1);
    end loop;
  end loop;
  if p_schema->>'type' in ('matrixdynamic','matrixdropdown') then
    for child in select * from jsonb_array_elements(case when jsonb_typeof(p_schema->'columns')='array' then p_schema->'columns' else '[]'::jsonb end) loop
      cell_type:=coalesce(nullif(child->>'cellType','default'),p_schema->>'cellType','dropdown');
      return query select * from public.survey_upload_questions(child || jsonb_build_object('type',cell_type),p_depth+1);
    end loop;
  end if;
end;
$$;
revoke all on function public.survey_upload_questions(jsonb,integer) from public, anon, authenticated;

create or replace function public.survey_upload_type_allowed(p_form_id uuid, p_question_name text, p_file_name text, p_mime_type text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare form_schema jsonb; question jsonb;
begin
  select schema into form_schema from public.forms where id=p_form_id;
  if not found then return false; end if;
  for question in select * from public.survey_upload_questions(form_schema) loop
    if nullif(p_question_name,'') is null then
      -- Legacy clients may omit the name only when the author has no type
      -- restriction anywhere. They cannot bypass a restricted sibling question.
      if cardinality(public.survey_question_upload_rules(question))>0 then return false; end if;
    elsif p_question_name in (question->>'name',question->>'valueName') then
      -- Separate repeated panels can legitimately share a local file name.
      -- Accept a candidate here; the response trigger checks its exact binding.
      if public.survey_question_upload_type_allowed(question,p_file_name,p_mime_type) then return true; end if;
    end if;
  end loop;
  return nullif(p_question_name,'') is null;
end;
$$;
revoke all on function public.survey_upload_type_allowed(uuid,text,text,text) from public, anon, authenticated;

create or replace function public.assert_survey_upload_type(p_form_id uuid, p_question_name text, p_file_name text, p_mime_type text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.survey_upload_type_allowed(p_form_id,p_question_name,p_file_name,p_mime_type) then
    raise exception 'Тип файла не разрешён автором вопроса' using errcode='22023';
  end if;
  return true;
end;
$$;
revoke all on function public.assert_survey_upload_type(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.assert_survey_upload_type(uuid,text,text,text) to service_role;

-- Canonicalize only the suffix used by the client's opaque Storage path. Keep
-- the complete original filename when evaluating the author's acceptedTypes.
create or replace function public.survey_upload_extension(p_file_name text)
returns text language plpgsql immutable set search_path = '' as $$
declare clean_name text; extension text;
begin
  clean_name:=regexp_replace(coalesce(p_file_name,''),'^.*[\\/]','');
  extension:=regexp_replace(coalesce(substring(clean_name from '[.][^.]*$'),''),'[^a-zA-Z0-9.]','','g');
  return case when extension ~ '^[.][a-zA-Z0-9]{1,12}$' then extension else '' end;
end;
$$;
revoke all on function public.survey_upload_extension(text) from public, anon, authenticated;

create or replace function public.enforce_survey_upload_type()
returns trigger language plpgsql security definer set search_path = '' as $$
declare form_id uuid; file_name text; path_extension text;
begin
  if new.bucket_id<>'survey-files' then return new; end if;
  begin form_id:=split_part(new.name,'/',2)::uuid;
  exception when invalid_text_representation then
    raise exception 'Некорректный путь файла' using errcode='22023';
  end;
  file_name:=coalesce(nullif(new.user_metadata->>'fileName',''),split_part(new.name,'/',3));
  path_extension:=coalesce(substring(lower(split_part(new.name,'/',3)) from '[.][^.]+$'),'');
  if (nullif(new.user_metadata->>'fileName','') is not null and path_extension<>lower(public.survey_upload_extension(file_name)))
    or not public.survey_upload_type_allowed(form_id,new.user_metadata->>'questionName',file_name,
      coalesce(nullif(new.metadata->>'mimetype',''),new.user_metadata->>'mimeType','')) then
    raise exception 'Тип файла не разрешён автором вопроса' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_survey_upload_type() from public, anon, authenticated;
create or replace trigger survey_upload_type_policy before insert or update of metadata,user_metadata,name,bucket_id on storage.objects
for each row execute function public.enforce_survey_upload_type();

-- Upload metadata is supplied by the caller. Validate against the question that
-- actually receives the file as well, so another unrestricted field cannot act
-- as a type-validation bypass. Existing unchanged attachments remain editable.
create or replace function public.enforce_response_upload_types()
returns trigger language plpgsql security definer set search_path = '' as $$
declare form_schema jsonb; binding record; normalized jsonb; previous jsonb; path text; object_record record;
begin
  select schema into form_schema from public.forms where id=new.form_id;
  for binding in select * from public.survey_response_bindings(form_schema,new.data) where question->>'type'='file' loop
    if binding.value is null or binding.value in ('null'::jsonb,'""'::jsonb) then continue; end if;
    normalized:=public.normalize_survey_file_value(binding.value,new.form_id);
    previous:=null;
    if tg_op='UPDATE' and old.form_id=new.form_id and old.browser_id is not distinct from new.browser_id then
      previous:=public.normalize_survey_file_value(old.data #> binding.value_path,old.form_id);
    end if;
    for path in select distinct scalar #>> '{}' from jsonb_path_query(normalized,'$.** ? (@.type() == "string")') scalar
      where (scalar #>> '{}') ~* '^(public|[0-9a-f-]{36})/[0-9a-f-]{36}/[^/]+$'
    loop
      if previous is not null and jsonb_path_exists(previous,'$.** ? (@ == $path)',jsonb_build_object('path',path)) then continue; end if;
      select name,metadata,user_metadata into object_record from storage.objects where bucket_id='survey-files' and name=path;
      if not found or not public.survey_question_upload_type_allowed(binding.question,
        coalesce(nullif(object_record.user_metadata->>'fileName',''),split_part(path,'/',3)),
        coalesce(nullif(object_record.metadata->>'mimetype',''),object_record.user_metadata->>'mimeType','')) then
        raise exception 'Тип файла не разрешён автором вопроса' using errcode='22023';
      end if;
    end loop;
  end loop;
  return new;
end;
$$;
revoke all on function public.enforce_response_upload_types() from public, anon, authenticated;
create or replace trigger responses_upload_type_policy before insert or update of data,form_id,browser_id on public.responses
for each row execute function public.enforce_response_upload_types();

commit;
