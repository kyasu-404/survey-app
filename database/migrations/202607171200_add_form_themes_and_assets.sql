begin;

alter table public.forms
add column if not exists theme jsonb not null default '{}'::jsonb;

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
            or setting ~ '[[:cntrl:]]'
            or setting ~* '(url[[:space:]]*\(|expression[[:space:]]*\(|@import|javascript:)'
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
        or not (
          btrim(asset #>> '{}') = ''
          or btrim(asset #>> '{}') ~ '^/[^/\\]'
          or btrim(asset #>> '{}') ~* '^https://[^[:space:]]+$'
          or btrim(asset #>> '{}') ~* '^http://(localhost|127\.0\.0\.1|10\.[0-9.]+|192\.168\.[0-9.]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9.]+|\[::1\])(:[0-9]+)?/[^[:space:]]*$'
        )
    );
$$;

revoke all on function public.survey_theme_is_safe(jsonb) from public;
grant execute on function public.survey_theme_is_safe(jsonb) to authenticated, service_role;

alter table public.forms drop constraint if exists forms_theme_is_safe;
alter table public.forms
add constraint forms_theme_is_safe check (public.survey_theme_is_safe(theme));

revoke insert on table public.forms from authenticated;
grant insert (id, title, schema, theme, form_type, form_reason, is_public, deadline_at, max_responses, author_id)
  on table public.forms to authenticated;
revoke update on table public.forms from authenticated;
grant update (title, schema, theme, form_type, form_reason, is_public, deadline_at, max_responses)
  on table public.forms to authenticated;

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
    or (path_parts[3] <> auth.uid()::text and public.request_role() <> 'admin')
    or path_parts[4] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
  then
    return false;
  end if;

  begin
    target_form_id := path_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return path_parts[3] = auth.uid()::text
    or public.request_role() = 'admin'
    or exists (
      select 1 from public.forms f
      where f.id = target_form_id and f.author_id = auth.uid()
    );
end;
$$;

revoke all on function public.can_manage_survey_asset(text) from public;
grant execute on function public.can_manage_survey_asset(text) to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'survey-assets',
  'survey-assets',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "survey_assets_authenticated_read" on storage.objects;
drop policy if exists "survey_assets_authenticated_upload" on storage.objects;
drop policy if exists "survey_assets_authenticated_delete" on storage.objects;

create policy "survey_assets_authenticated_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'survey-assets'
  and (name like 'gallery/%' or public.can_manage_survey_asset(name))
);

create policy "survey_assets_authenticated_upload" on storage.objects
for insert to authenticated
with check (bucket_id = 'survey-assets' and public.can_manage_survey_asset(name));

create policy "survey_assets_authenticated_delete" on storage.objects
for delete to authenticated
using (bucket_id = 'survey-assets' and public.can_manage_survey_asset(name));

commit;
