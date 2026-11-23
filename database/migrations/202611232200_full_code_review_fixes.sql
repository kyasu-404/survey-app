begin;

set local lock_timeout = '5s';

-- 1. Tighten schema and theme URL/CSS validators against whitespace and CSS escapes (F-04, F-38).
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
      or (asset #>> '{}') ~ '[[:cntrl:]]'
      or not (
        regexp_replace(asset #>> '{}', '^[[:space:]]+|[[:space:]]+$', '', 'g') = '__APP_DEFAULT_CARD_LOGO__'
        or regexp_replace(asset #>> '{}', '^[[:space:]]+|[[:space:]]+$', '', 'g') ~* '^data:image/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$'
        or regexp_replace(asset #>> '{}', '^[[:space:]]+|[[:space:]]+$', '', 'g') !~* '^([a-z][a-z0-9+.-]*:|//|\\)'
      )
  ) or jsonb_path_exists(value, '$.**.contentMode ? (@ != "image")', '{}'::jsonb, true);
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
          or regexp_replace(asset #>> '{}', '^[[:space:]]+|[[:space:]]+$', '', 'g') ~ '^/[A-Za-z0-9._/%-]+$'
          or regexp_replace(asset #>> '{}', '^[[:space:]]+|[[:space:]]+$', '', 'g') ~* '^__APP_SURVEY_ASSET__/(gallery/[a-z0-9._-]{1,255}|forms/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpe?g|png|webp))$'
          or regexp_replace(asset #>> '{}', '^[[:space:]]+|[[:space:]]+$', '', 'g') ~* '^http://(localhost|127\.0\.0\.1|10\.[0-9.]+|192\.168\.[0-9.]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9.]+|\[::1\])(:[0-9]+)?/[^[:space:]]*$'
        )
    );
$$;

-- 2. Exclude template forms from public access and enforce enabled-session checks (F-25, F-26).
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
    where f.id = target_form_id
      and f.form_type <> 'template'
      and f.is_public = true
      and (f.deadline_at is null or f.deadline_at > now())
  );
$$;

create or replace function public.get_public_form(p_form_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', f.id, 'title', f.title, 'form_type', f.form_type, 'form_reason', f.form_reason,
    'schema', f.schema, 'theme', f.theme, 'is_public', f.is_public,
    'deadline_at', f.deadline_at, 'max_responses', f.max_responses,
    'responses_count', f.responses_count, 'allow_response_editing', f.allow_response_editing,
    'organization_types', f.organization_types, 'personal_links_enabled', f.personal_links_enabled,
    'revision', f.revision, 'created_at', f.created_at
  )
  from public.forms f
  where f.id = p_form_id
    and (auth.uid() is null or public.request_is_enabled())
    and public.is_public_active_form(f.id)
    and f.responses_count < least(coalesce(f.max_responses, 100000), 100000);
$$;

create or replace function public.list_form_organizations(p_form_id uuid)
returns table (
  id uuid,
  organization_type text,
  number text,
  alias text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.organization_type, o.number, o.alias
  from public.education_organizations o
  join public.forms f on f.id = p_form_id
  where not o.is_archived
    and (auth.uid() is null or public.request_is_enabled())
    and o.organization_type = any(f.organization_types)
    and jsonb_path_exists(f.schema, '$.** ? (@.type == "organization")', '{}'::jsonb, true)
    and (
      public.is_public_active_form(f.id)
      or public.request_is_enabled()
    )
  order by
    case o.organization_type
      when 'school' then 1
      when 'kindergarten' then 2
      when 'odo' then 3
      else 4
    end,
    o.number nulls last,
    o.alias;
$$;

-- 3. Remove obsolete SECURITY DEFINER oracles and dead insert policy; tighten anon/authenticated privileges (F-25, L-01).
drop policy if exists "responses_insert" on public.responses;
drop function if exists public.is_existing_response_submission(uuid, uuid, uuid);
drop function if exists public.is_public_active_admin_authored_form(uuid);

revoke all on table public.responses from anon;
revoke update, delete on table public.responses from authenticated;
grant select (id, form_id, data, created_at, updated_at) on table public.responses to authenticated;

drop policy if exists "survey_assets_authenticated_read" on storage.objects;
create policy "survey_assets_authenticated_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'survey-assets'
  and (select public.request_is_enabled())
  and (name like 'gallery/%' or public.can_manage_survey_asset(name))
);

drop policy if exists "survey_assets_branding_read" on storage.objects;
create policy "survey_assets_branding_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'survey-assets'
  and (select public.request_is_enabled())
  and name like 'app-branding/%'
);

grant select, insert, update, delete on table
  public.automation_rules,
  public.automation_runs,
  public.notification_preferences,
  public.notifications
to service_role;

comment on column public.mail_settings.allow_invalid_certificate is
  'When true, mail-worker skips TLS certificate verification for this SMTP server while keeping TLS >= 1.2.';

-- 4. Fix survey_assets ownership check and orphan asset/favicon cleanup (F-03, L-02).
create or replace function public.can_manage_survey_asset(object_name text)
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
  if not public.request_is_enabled()
    or array_length(path_parts, 1) <> 4
    or path_parts[1] <> 'forms'
    or path_parts[3] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or path_parts[4] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
  then
    return false;
  end if;

  begin
    target_form_id := path_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if public.request_role() = 'admin' then
    return true;
  end if;

  -- Authors can manage assets under their own forms (including ones uploaded by admins).
  -- Pre-save new-form draft uploads are allowed only under the caller's own UID segment
  -- when no form with target_form_id exists yet.
  return exists (
    select 1 from public.forms f
    where f.id = target_form_id and f.author_id = auth.uid()
  ) or (
    path_parts[3] = auth.uid()::text
    and not exists (select 1 from public.forms f where f.id = target_form_id)
  );
end;
$$;

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
          where f.id::text = split_part(o.name, '/', 2)
            and (
              f.theme::text like '%' || o.name || '%'
              or f.schema::text like '%' || o.name || '%'
            )
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
          where f.id::text = split_part(o.name, '/', 2)
            and (
              f.theme::text like '%' || o.name || '%'
              or f.schema::text like '%' || o.name || '%'
            )
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

create or replace function public.list_orphan_app_favicons(
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
  where o.bucket_id = 'app-favicons'
    and o.created_at < cutoff
    and not exists (
      select 1 from public.app_branding s
      where s.favicon_path = o.name
    )
  order by o.created_at, o.id
  limit least(greatest(batch_limit, 1), 1000);
$$;

create or replace function public.confirm_orphan_app_favicons(
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
    and o.bucket_id = 'app-favicons'
    and o.name = any(object_names)
    and o.created_at < cutoff
    and not exists (
      select 1 from public.app_branding s
      where s.favicon_path = o.name
    )
  order by o.name;
$$;

revoke all on function public.list_orphan_app_favicons(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.list_orphan_app_favicons(timestamptz, integer) to service_role;
revoke all on function public.confirm_orphan_app_favicons(timestamptz, text[]) from public, anon, authenticated;
grant execute on function public.confirm_orphan_app_favicons(timestamptz, text[]) to service_role;

-- 5. Close wildcard MIME bypass, disallow uploads to forms without upload questions,
--    traverse legacy questions/choices[].elements, and enforce signaturepad image policy (F-01, F-02, F-28).
create or replace function public.survey_question_upload_type_allowed(p_question jsonb, p_file_name text, p_mime_type text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  rules text[]:=public.survey_question_upload_rules(p_question); rule text;
  file_name text:=lower(coalesce(p_file_name,''));
  mime_type text:=lower(btrim(split_part(coalesce(p_mime_type,''),';',1)));
  -- A claimed common MIME must also agree with its filename extension. Wildcard
  -- MIME rules (type/*) only permit subtypes registered in this consistency map;
  -- unknown MIME subtypes require an explicit exact rule from the author.
  known_types jsonb:='{
    "application/pdf":[".pdf"],"text/plain":[".txt",".text",".log"],"text/csv":[".csv"],
    "application/msword":[".doc",".dot"],"application/vnd.ms-excel":[".xls",".xlt"],
    "application/vnd.ms-powerpoint":[".ppt",".pps",".pot"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":[".docx"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":[".xlsx"],
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":[".pptx"],
    "application/vnd.oasis.opendocument.text":[".odt"],"application/vnd.oasis.opendocument.spreadsheet":[".ods"],
    "application/vnd.oasis.opendocument.presentation":[".odp"],"application/rtf":[".rtf"],"text/rtf":[".rtf"],
    "image/png":[".png"],"image/jpeg":[".jpg",".jpeg",".jpe",".jfif"],"image/gif":[".gif"],
    "image/webp":[".webp"],"image/bmp":[".bmp"],"image/tiff":[".tif",".tiff"],
    "image/svg+xml":[".svg",".svgz"],"image/avif":[".avif"],"image/heic":[".heic"],"image/heif":[".heif"],
    "image/x-icon":[".ico"],"image/vnd.microsoft.icon":[".ico"],
    "application/zip":[".zip"],"application/x-zip-compressed":[".zip"],
    "application/x-7z-compressed":[".7z"],"application/vnd.rar":[".rar"],"application/x-rar-compressed":[".rar"],
    "application/gzip":[".gz"],"application/x-gzip":[".gz"],"application/x-tar":[".tar"],
    "audio/mpeg":[".mp3"],"audio/wav":[".wav"],"audio/x-wav":[".wav"],"audio/ogg":[".ogg",".oga"],
    "audio/flac":[".flac"],"audio/x-flac":[".flac"],"audio/aac":[".aac"],"audio/mp4":[".m4a"],
    "audio/x-ms-wma":[".wma"],"audio/webm":[".weba",".webm"],
    "video/mp4":[".mp4",".m4v"],"video/webm":[".webm"],"video/quicktime":[".mov"],
    "video/x-msvideo":[".avi"],"video/x-matroska":[".mkv"],"video/x-ms-wmv":[".wmv"],"video/x-flv":[".flv"],
    "text/html":[".html",".htm"],"application/json":[".json"],"application/xml":[".xml"],"text/xml":[".xml"]
  }';
begin
  if p_question->>'type'='signaturepad' and cardinality(rules)=0 then
    rules:=array['image/png','image/jpeg','image/webp','image/svg+xml'];
  end if;
  if cardinality(rules)=0 then return true; end if;
  foreach rule in array rules loop
    if rule in ('*','*/*') then return true; end if;
    if left(rule,1)='.' and right(file_name,length(rule))=rule then return true; end if;
    if rule=mime_type then
      if not (known_types ? mime_type) or exists(
        select 1 from jsonb_array_elements_text(known_types->mime_type) extension where right(file_name,length(extension))=extension
      ) then return true; end if;
    elsif rule ~ '^[a-z0-9!#$&^_.+-]+/\*$' and split_part(rule,'/',1)=split_part(mime_type,'/',1) then
      if known_types ? mime_type and exists(
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

create or replace function public.survey_upload_questions(p_schema jsonb, p_depth integer default 0)
returns setof jsonb language plpgsql immutable set search_path = '' as $$
declare child jsonb; container text; cell_type text; choice jsonb;
begin
  if p_depth>32 then raise exception 'Структура формы превышает допустимую глубину' using errcode='22023'; end if;
  if jsonb_typeof(p_schema)<>'object' then return; end if;
  if p_schema->>'type'='file' or (p_schema->>'type'='signaturepad' and coalesce(p_schema->>'storeDataAsText','true')='false') then return next p_schema; end if;
  foreach container in array array['pages','elements','questions','templateElements','detailElements'] loop
    for child in select * from jsonb_array_elements(case when jsonb_typeof(p_schema->container)='array' then p_schema->container else '[]'::jsonb end) loop
      return query select * from public.survey_upload_questions(child,p_depth+1);
    end loop;
  end loop;
  if jsonb_typeof(p_schema->'choices')='array' then
    for choice in select * from jsonb_array_elements(p_schema->'choices') loop
      if jsonb_typeof(choice)='object' and jsonb_typeof(choice->'elements')='array' then
        for child in select * from jsonb_array_elements(choice->'elements') loop
          return query select * from public.survey_upload_questions(child,p_depth+1);
        end loop;
      end if;
    end loop;
  end if;
  if p_schema->>'type' in ('matrixdynamic','matrixdropdown') then
    for child in select * from jsonb_array_elements(case when jsonb_typeof(p_schema->'columns')='array' then p_schema->'columns' else '[]'::jsonb end) loop
      cell_type:=coalesce(nullif(child->>'cellType','default'),p_schema->>'cellType','dropdown');
      return query select * from public.survey_upload_questions(child || jsonb_build_object('type',cell_type),p_depth+1);
    end loop;
  end if;
end;
$$;

create or replace function public.survey_upload_type_allowed(p_form_id uuid, p_question_name text, p_file_name text, p_mime_type text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare form_schema jsonb; question jsonb; has_upload_question boolean := false;
begin
  select schema into form_schema from public.forms where id=p_form_id;
  if not found then return false; end if;
  for question in select * from public.survey_upload_questions(form_schema) loop
    has_upload_question := true;
    if nullif(p_question_name,'') is null then
      -- Legacy clients may omit the name only when the author has no type
      -- restriction anywhere and no signaturepad restriction applies.
      if question->>'type'='signaturepad' or cardinality(public.survey_question_upload_rules(question))>0 then return false; end if;
    elsif p_question_name in (question->>'name',question->>'valueName') then
      -- Separate repeated panels can legitimately share a local file name.
      -- Accept a candidate here; the response trigger checks its exact binding.
      if public.survey_question_upload_type_allowed(question,p_file_name,p_mime_type) then return true; end if;
    end if;
  end loop;
  return has_upload_question and nullif(p_question_name,'') is null;
end;
$$;

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
  if not exists (
    select 1 from public.forms f
    where f.id = p_form_id
      and exists (select 1 from public.survey_upload_questions(f.schema))
  ) then
    raise exception 'Форма не принимает загрузку файлов' using errcode = '22023';
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

create or replace function public.enforce_response_upload_types()
returns trigger language plpgsql security definer set search_path = '' as $$
declare form_schema jsonb; binding record; normalized jsonb; previous jsonb; path text; object_record record;
begin
  select schema into form_schema from public.forms where id=new.form_id;
  for binding in select * from public.survey_response_bindings(form_schema,new.data)
    where question->>'type' in ('file','signaturepad')
  loop
    if binding.value is null or binding.value in ('null'::jsonb,'""'::jsonb) then continue; end if;
    if binding.question->>'type'='signaturepad' and jsonb_typeof(binding.value)='string' and (binding.value #>> '{}') ~* '^data:' then
      continue;
    end if;
    normalized:=public.normalize_survey_file_value(binding.value,new.form_id);
    previous:=null;
    if tg_op='UPDATE' and old.form_id=new.form_id and old.browser_id is not distinct from new.browser_id then
      if binding.question->>'type'='signaturepad'
        and jsonb_typeof(old.data #> binding.value_path)='string'
        and ((old.data #> binding.value_path) #>> '{}') ~* '^data:'
      then
        previous:=null;
      else
        previous:=public.normalize_survey_file_value(old.data #> binding.value_path,old.form_id);
      end if;
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

-- 6. Validate matrixdynamic/matrixdropdown rows and object keys in single-pass response_data_matches_form (F-05, F-28).
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
          or exists (select 1 from jsonb_each(b.value) e where jsonb_typeof(e.value) <> 'object')
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

-- 7. Reject template submissions/edits in submit_form_response & update_form_response (F-26).
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

  if jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 262144 then
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

  if not public.response_data_matches_form(target_form.schema, target_form.organization_types, p_data) then
    raise exception 'Ответ не соответствует структуре формы' using errcode = '22023';
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

  if jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 262144 then
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

  if not public.response_data_matches_form(target_form.schema, target_form.organization_types, p_data) then
    raise exception 'Ответ не соответствует структуре формы' using errcode = '22023';
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

-- 8. Fix TOCTOU in delete_form_responses_with_files by locking target responses before reading refs (F-06).
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
  -- Lock target responses before capturing their references so a concurrent
  -- update_form_response cannot attach a new file after the snapshot.
  perform 1 from public.responses where form_id=p_form_id and id=any(p_response_ids) order by id for update;
  select coalesce(array_agg(distinct object_path),'{}'::text[]) into paths from public.response_file_references
    where form_id=p_form_id and response_id=any(p_response_ids);
  delete from public.responses where form_id=p_form_id and id=any(p_response_ids);
  get diagnostics removed=row_count;
  return jsonb_build_object('deletedResponses',removed,'objectPaths',public.claim_survey_file_deletions(paths));
end;
$$;

-- 9. Eliminate O(N_orgs * N_responses) correlated scans in prepare_form_mail_recipients and list_saved_form_organizations (F-07).
create or replace function public.prepare_form_mail_recipients(p_form_id uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.forms%rowtype; recipients jsonb;
begin
  select * into f from public.forms where id = p_form_id for update;
  if not found or not public.is_public_active_form(p_form_id) then
    raise exception 'Форма закрыта для ответов' using errcode = '22023';
  end if;
  if p_kind not in ('invitation', 'reminder') or p_kind is null then
    raise exception 'Некорректный тип рассылки' using errcode = '22023';
  end if;
  if not jsonb_path_exists(f.schema, '$.** ? (@.type == "organization")') then
    raise exception 'Добавьте в форму вопрос «Организация»' using errcode = '22023';
  end if;
  if p_kind = 'invitation' and not f.personal_links_enabled then
    raise exception 'Сначала включите персональные ссылки' using errcode = '22023';
  end if;
  perform public.ensure_form_personal_links(p_form_id);
  with answered as materialized (
    select distinct (v.value #>> '{}') as org_id
    from public.responses r
    cross join lateral public.survey_organization_values(f.schema, r.data) v(value)
    where p_kind = 'reminder' and r.form_id = f.id and jsonb_typeof(v.value) = 'string'
  )
  select coalesce(jsonb_agg(to_jsonb(recipient)), '[]'::jsonb) into recipients from (
    select o.id, o.organization_type, o.number, o.alias, o.email,
      case when f.personal_links_enabled then l.token else null end as token
    from public.education_organizations o
    left join public.form_personal_links l on l.form_id = f.id and l.organization_id = o.id
    where not o.is_archived and o.organization_type = any(f.organization_types)
      and (p_kind = 'invitation' or not exists (
        select 1 from answered a where a.org_id = o.id::text
      ))
    order by o.organization_type, o.number, o.alias, o.id limit 5001
  ) recipient;
  if jsonb_array_length(recipients) > 5000 then
    raise exception 'За одну рассылку можно поставить в очередь не более 5000 писем' using errcode = '22023';
  end if;
  return jsonb_build_object('personal', f.personal_links_enabled, 'recipients', recipients);
end;
$$;

create or replace function public.list_saved_form_organizations(p_form_id uuid, p_browser_id uuid)
returns table (id uuid, organization_type text, number text, alias text)
language sql stable security definer set search_path = ''
as $$
  with answered as materialized (
    select distinct (v.value #>> '{}') as org_id
    from public.responses r
    join public.forms f on f.id = r.form_id
    cross join lateral public.survey_organization_values(f.schema, r.data) v(value)
    where r.form_id = p_form_id
      and jsonb_typeof(v.value) = 'string'
      and (auth.uid() is null or public.request_is_enabled())
      and (public.request_is_enabled() or r.browser_id = public.browser_capability_hash(p_browser_id))
  )
  select o.id, o.organization_type, o.number, o.alias
  from public.education_organizations o
  join answered a on a.org_id = o.id::text
  where o.is_archived
    and (auth.uid() is null or public.request_is_enabled())
  order by o.id;
$$;

-- 10. Downgrade personal link form locks to FOR KEY SHARE (F-28).
create or replace function public.submit_personal_form_response(p_form_id uuid, p_token uuid, p_submission_id uuid, p_data jsonb)
returns table(status text, response_id uuid, response_data jsonb, response_editable boolean)
language plpgsql security definer set search_path = '' as $$
declare link public.form_personal_links%rowtype;
begin
  perform 1 from public.forms where id = p_form_id for key share;
  link := public.resolve_form_personal_link(p_form_id, p_token);
  perform public.check_personal_response_data(p_form_id, link.organization_id, p_data);
  return query select * from public.submit_form_response(p_form_id, link.browser_id, p_submission_id, p_data);
end;
$$;

create or replace function public.update_personal_form_response(p_form_id uuid, p_token uuid, p_response_id uuid, p_data jsonb)
returns table(response_id uuid, response_data jsonb)
language plpgsql security definer set search_path = '' as $$
declare link public.form_personal_links%rowtype;
begin
  perform 1 from public.forms where id = p_form_id for key share;
  link := public.resolve_form_personal_link(p_form_id, p_token);
  perform public.check_personal_response_data(p_form_id, link.organization_id, p_data);
  return query select * from public.update_form_response(p_form_id, link.browser_id, p_response_id, p_data);
end;
$$;

-- 11. Fix NULL p_worker_id guard in claim_mail_jobs, depth/null-name guards in office question IDs, and profiles.name bound (F-27).
create or replace function public.claim_mail_jobs(p_worker_id text,p_limit integer default 20)
returns setof public.mail_queue language plpgsql security definer set search_path = '' as $$
begin
  if p_worker_id is null or length(btrim(p_worker_id)) not between 1 and 200 then
    raise exception 'Invalid worker id' using errcode='22023';
  end if;

  -- A worker can lose its last lease before recording a result. Finalize those
  -- jobs without holding up other workers or increasing their attempt count.
  with exhausted as (
    select q.id from public.mail_queue q
    where q.automation_run_id is null and q.attempts>=q.max_attempts
      and (q.status='queued' or (q.status='processing' and q.locked_at<now()-interval '10 minutes'))
    order by q.next_attempt_at,q.created_at,q.id
    limit least(greatest(p_limit,1),100) for update skip locked
  )
  update public.mail_queue q set status='failed',locked_at=null,locked_by=null,
    last_error=coalesce(q.last_error,'Не удалось подтвердить отправку письма')
    from exhausted e where q.id=e.id;

  return query
  with candidates as (
    select q.id from public.mail_queue q
    where q.attempts<q.max_attempts and (
      (q.status='queued' and q.next_attempt_at<=now()
        and (q.automation_run_id is null or survey_automation.run_is_active(q.automation_run_id)))
      or (q.automation_run_id is null and q.status = 'processing' and q.locked_at<now()-interval '10 minutes')
    )
    order by q.next_attempt_at,q.created_at,q.id for update skip locked
    limit least(greatest(p_limit,1),100)
  )
  update public.mail_queue q set status='processing',attempts=q.attempts+1,locked_at=now(),
    locked_by=btrim(p_worker_id),last_error=null
    from candidates c where q.id=c.id returning q.*;
end;
$$;

drop function if exists public.office_assign_question_ids(jsonb, jsonb);

create or replace function public.office_assign_question_ids(node jsonb, previous jsonb default '{}', p_depth integer default 0)
returns jsonb language plpgsql set search_path = '' as $$
declare result jsonb := node; field text; children jsonb; child jsonb; stable_id text;
begin
  if p_depth > 32 then raise exception 'Структура формы превышает допустимую глубину' using errcode = '22023'; end if;
  if jsonb_typeof(node) <> 'object' then return node; end if;
  if node ? 'type' and jsonb_typeof(node->'name') = 'string' and nullif(node->>'name', '') is not null
    and node->>'type' not in ('panel', 'sectiontitle', 'html') then
    stable_id := previous->>(node->>'name');
    result := jsonb_set(result, '{integrationId}', to_jsonb(coalesce(stable_id, gen_random_uuid()::text)));
  end if;
  foreach field in array array['pages','elements','templateElements'] loop
    if jsonb_typeof(node->field) = 'array' then
      children := '[]'::jsonb;
      for child in select value from jsonb_array_elements(node->field) loop
        children := children || jsonb_build_array(public.office_assign_question_ids(child, previous, p_depth + 1));
      end loop;
      result := jsonb_set(result, array[field], children);
    end if;
  end loop;
  return result;
end;
$$;

create or replace function public.office_preserve_question_ids()
returns trigger language plpgsql security definer set search_path = '' as $$
declare previous jsonb := '{}';
begin
  if TG_OP = 'UPDATE' then
    select coalesce(jsonb_object_agg(q->>'name', q->>'integrationId'), '{}') into previous
    from jsonb_path_query(old.schema, 'strict $.** ? (exists(@.integrationId) && exists(@.name))') q
    where jsonb_typeof(q->'name') = 'string' and nullif(q->>'name', '') is not null;
  end if;
  new.schema := public.office_assign_question_ids(new.schema, previous, 0);
  return new;
end;
$$;

revoke all on function public.office_assign_question_ids(jsonb, jsonb, integer) from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_name_length_and_chars'
  ) then
    alter table public.profiles
      add constraint profiles_name_length_and_chars
      check (char_length(name) <= 200 and name !~ '[[:cntrl:]]') not valid;
  end if;
end $$;

-- 12. Fix automation phase order, post-expiry deadline-reached notice, and 100k cap alignment (F-29).
create or replace function public.list_forms_by_activity(
  p_is_public boolean,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns setof public.forms
language sql stable security invoker
as $$
  select f.* from public.forms f
  where (f.is_public and (f.deadline_at is null or f.deadline_at > now())
    and f.responses_count < least(coalesce(f.max_responses, 100000), 100000)) = p_is_public
    and ((p_before_created_at is null and p_before_id is null)
      or (p_before_created_at is not null and p_before_id is not null
        and (f.created_at, f.id) < (p_before_created_at, p_before_id)));
$$;

create or replace function public.get_dashboard_forms_stats(
  p_search text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_author_id uuid default null,
  p_form_type text default null,
  p_form_reason text default null,
  p_is_public boolean default null
)
returns table (
  total_count bigint,
  active_count bigint,
  forms_with_deadline_count bigint
)
language sql
stable
set search_path = ''
as $$
  select
    count(*)::bigint as total_count,
    count(*) filter (
      where f.is_public = true
        and (f.deadline_at is null or f.deadline_at > now())
        and f.responses_count < least(coalesce(f.max_responses, 100000), 100000)
    )::bigint as active_count,
    count(*) filter (where f.deadline_at > now())::bigint as forms_with_deadline_count
  from public.forms f
  where f.form_type <> 'template'
    and (
      p_search is null
      or p_search = ''
      or f.title ilike '%' || public.escape_forms_search(p_search) || '%'
      or f.author_name ilike '%' || public.escape_forms_search(p_search) || '%'
    )
    and (p_date_from is null or f.created_at >= p_date_from)
    and (p_date_to is null or f.created_at <= p_date_to)
    and (p_author_id is null or f.author_id = p_author_id)
    and (p_form_type is null or f.form_type = p_form_type)
    and (p_form_reason is null or f.form_reason = p_form_reason)
    and (
      p_is_public is null
      or (
        f.is_public = true
        and (f.deadline_at is null or f.deadline_at > now())
        and f.responses_count < least(coalesce(f.max_responses, 100000), 100000)
      ) = p_is_public
    );
$$;

create or replace function public.list_forms_sorted(
  p_sort_field text default 'created_at',
  p_sort_direction text default 'desc',
  p_page_size integer default 20,
  p_after_id uuid default null,
  p_after_value text default null,
  p_reference_time timestamptz default null,
  p_search text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_author_id uuid default null,
  p_form_type text default null,
  p_form_reason text default null,
  p_is_public boolean default null
)
returns table (
  id uuid, title text, form_type text, form_reason text, is_public boolean,
  deadline_at timestamptz, max_responses integer, author_id uuid, author_name text,
  created_at timestamptz, responses_count integer,
  sort_value text, sort_reference_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  sort_expression text;
  sort_type text;
  comparison text;
  reference_time timestamptz := coalesce(p_reference_time, statement_timestamp());
begin
  if p_sort_direction is null or p_sort_direction not in ('asc', 'desc')
    or p_page_size is null or p_page_size < 1 or p_page_size > 999
    or (p_after_id is null) <> (p_after_value is null)
    or (p_after_id is not null and p_reference_time is null)
  then
    raise exception 'Некорректные параметры сортировки или страницы' using errcode = '22023';
  end if;

  -- Only these fixed expressions and directions enter SQL; user values remain bound parameters.
  case p_sort_field
    when 'created_at' then sort_expression := 'f.created_at'; sort_type := 'timestamptz';
    when 'title' then sort_expression := 'lower(f.title)'; sort_type := 'text';
    when 'author_name' then
      sort_expression := 'lower(coalesce(nullif(f.author_name, ''''), f.author_id::text))'; sort_type := 'text';
    when 'responses_count' then sort_expression := 'coalesce(f.responses_count, 0)'; sort_type := 'integer';
    when 'status' then
      -- Match the displayed deadline state. Freeze the clock across a cursor chain.
      sort_expression := '(f.is_public and (f.deadline_at is null or f.deadline_at > $1) and f.responses_count < least(coalesce(f.max_responses, 100000), 100000))';
      sort_type := 'boolean';
    when 'classification' then
      sort_expression := $expr$(case f.form_type
        when 'anketa' then 'Анкетирование' when 'voting' then 'Голосование'
        when 'request' then 'Запрос' when 'monitoring' then 'Мониторинг'
        when 'survey' then 'Опрос' when 'sample' then 'Проба' when 'other' then 'Другое'
        else f.form_type end || ' • ' || case f.form_reason
        when 'request' then 'Запрос' when 'plan' then 'План работ'
        when 'order' then 'Приказ' when 'directive' then 'Распоряжение'
        when 'other' then 'Иное' else f.form_reason end)$expr$;
      sort_type := 'text';
    else raise exception 'Неизвестная колонка сортировки' using errcode = '22023';
  end case;
  comparison := case when p_sort_direction = 'asc' then '>' else '<' end;

  return query execute format($query$
    select f.id, f.title, f.form_type, f.form_reason, f.is_public,
      f.deadline_at, f.max_responses, f.author_id, f.author_name,
      f.created_at, f.responses_count, (%1$s)::text, $1
    from public.forms f
    where f.form_type <> 'template'
      and ($2 is null or $2 = '' or f.title ilike '%%' || $2 || '%%' or f.author_name ilike '%%' || $2 || '%%')
      and ($3 is null or f.created_at >= $3)
      and ($4 is null or f.created_at <= $4)
      and ($5 is null or f.author_id = $5)
      and ($6 is null or f.form_type = $6)
      and ($7 is null or f.form_reason = $7)
      and ($8 is null or (f.is_public and (f.deadline_at is null or f.deadline_at > now())
        and f.responses_count < least(coalesce(f.max_responses, 100000), 100000)) = $8)
      and ($9 is null or ((%1$s), f.id) %2$s (($10)::%3$s, $9))
    order by %1$s %4$s, f.id %4$s
    limit $11
  $query$, sort_expression, comparison, sort_type, p_sort_direction)
  using reference_time, public.escape_forms_search(p_search), p_date_from, p_date_to, p_author_id,
    p_form_type, p_form_reason, p_is_public, p_after_id, p_after_value, p_page_size + 1;
exception when invalid_text_representation or invalid_datetime_format then
  raise exception 'Некорректное значение курсора' using errcode = '22023';
end;
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
      perform pg_advisory_xact_lock(hashtextextended('survey-automation-owner:'||owner::text,0));
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
  perform survey_automation.process_schedules(sweep_time,max_items);
  perform survey_automation.process_threshold_checks(max_items);

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

-- 13. Serialize admin role/delete/disable transitions and prevent last-admin lockout (F-32, P-09).
create or replace function public.set_employee_disabled(p_user_id uuid, p_disabled boolean, p_actor_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  target_role text;
  target_disabled boolean;
begin
  if p_disabled is null or p_user_id is null then
    raise exception 'Некорректный статус пользователя' using errcode = '22023';
  end if;
  if p_user_id = p_actor_id then
    raise exception 'Нельзя изменить собственную блокировку' using errcode = '42501';
  end if;
  -- Serialize admin status/role/delete changes to prevent mutual lockout and deadlocks.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('survey-admin-role-mutation', 0));
  perform 1 from public.profiles where id = p_actor_id and role = 'admin' and not is_disabled for share;
  if not found then raise exception 'Требуются права администратора' using errcode = '42501'; end if;
  perform 1 from auth.users where id = p_user_id for update;
  if not found then raise exception 'Пользователь не найден' using errcode = 'P0002'; end if;
  select role, is_disabled into target_role, target_disabled from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Профиль пользователя не найден' using errcode = 'P0002'; end if;
  if p_disabled and target_role = 'admin' and not target_disabled then
    if not exists (
      select 1 from public.profiles
      where role = 'admin' and not is_disabled and id <> p_user_id
    ) then
      raise exception 'Нельзя отключить последнего активного администратора' using errcode = '42501';
    end if;
  end if;
  update auth.users set banned_until = case when p_disabled then clock_timestamp() + interval '876000 hours' else null end
    where id = p_user_id;
  update public.profiles set is_disabled = p_disabled where id = p_user_id;
  return true;
end;
$$;

create or replace function public.set_employee_role(p_user_id uuid, p_role text, p_actor_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  target_role text;
  target_disabled boolean;
begin
  if p_user_id is null or p_role not in ('user', 'admin') then
    raise exception 'Некорректная роль пользователя' using errcode = '22023';
  end if;
  if p_user_id = p_actor_id then
    raise exception 'Нельзя изменить собственную роль' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('survey-admin-role-mutation', 0));
  perform 1 from public.profiles where id = p_actor_id and role = 'admin' and not is_disabled for share;
  if not found then raise exception 'Требуются права администратора' using errcode = '42501'; end if;
  select role, is_disabled into target_role, target_disabled from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Профиль пользователя не найден' using errcode = 'P0002'; end if;
  if target_role = 'admin' and p_role <> 'admin' and not target_disabled then
    if not exists (
      select 1 from public.profiles
      where role = 'admin' and not is_disabled and id <> p_user_id
    ) then
      raise exception 'Нельзя понизить последнего активного администратора' using errcode = '42501';
    end if;
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  return true;
end;
$$;

create or replace function public.assert_can_delete_employee(p_user_id uuid, p_actor_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  target_role text;
  target_disabled boolean;
begin
  if p_user_id is null then
    raise exception 'Некорректный идентификатор пользователя' using errcode = '22023';
  end if;
  if p_user_id = p_actor_id then
    raise exception 'Нельзя удалить самого себя' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('survey-admin-role-mutation', 0));
  perform 1 from public.profiles where id = p_actor_id and role = 'admin' and not is_disabled for share;
  if not found then raise exception 'Требуются права администратора' using errcode = '42501'; end if;
  select role, is_disabled into target_role, target_disabled from public.profiles where id = p_user_id for update;
  if found and target_role = 'admin' and not target_disabled then
    if not exists (
      select 1 from public.profiles
      where role = 'admin' and not is_disabled and id <> p_user_id
    ) then
      raise exception 'Нельзя удалить последнего активного администратора' using errcode = '42501';
    end if;
  end if;
  return true;
end;
$$;

revoke all on function public.set_employee_role(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.set_employee_role(uuid, text, uuid) to service_role;
revoke all on function public.assert_can_delete_employee(uuid, uuid) from public, anon, authenticated;
grant execute on function public.assert_can_delete_employee(uuid, uuid) to service_role;

-- 14. Add missing FK and hot-predicate indexes; drop redundant indexes (F-08, L-01).
create index if not exists idx_response_file_references_form_id
  on public.response_file_references(form_id);
create index if not exists idx_responses_user_id
  on public.responses(user_id) where user_id is not null;
create index if not exists idx_survey_upload_reservations_form_expires
  on public.survey_upload_reservations(form_id, expires_at);
create index if not exists idx_office_generation_results_template_id
  on public.office_generation_results(template_id) where template_id is not null;
create index if not exists idx_office_generation_jobs_template_id
  on public.office_generation_jobs(template_id) where template_id is not null;
create index if not exists idx_mail_batches_created_by
  on public.mail_batches(created_by) where created_by is not null;
create index if not exists idx_mail_queue_organization_id
  on public.mail_queue(organization_id) where organization_id is not null;
create index if not exists idx_mail_queue_claim_queued
  on public.mail_queue(next_attempt_at, created_at, id) where status = 'queued';
create index if not exists idx_mail_queue_claim_processing
  on public.mail_queue(locked_at, next_attempt_at, created_at, id) where status = 'processing';
create index if not exists idx_announcements_created_at_id
  on survey_announcements.announcements(created_at desc, id desc);

drop index if exists public.idx_forms_author_id;
drop index if exists public.idx_responses_form_id;
drop index if exists public.idx_forms_created_at;
drop index if exists public.idx_forms_author_created_at;

-- 15. Dedicated least-privilege PostgreSQL role for office-service (F-35).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'office_service') then
    create role office_service nosuperuser nocreatedb nocreaterole noinherit bypassrls nologin;
  end if;
end $$;

grant usage on schema public to office_service;
grant select on table
  public.forms,
  public.responses,
  public.profiles,
  public.education_organizations
to office_service;
grant select, update on table public.onlyoffice_settings to office_service;
grant select, insert, update, delete on table
  public.office_documents,
  public.office_generation_jobs,
  public.office_generation_results,
  public.office_storage_cleanup
to office_service;

notify pgrst, 'reload schema';

commit;
