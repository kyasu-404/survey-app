begin;
set local lock_timeout = '5s';

create or replace function public.valid_embedding_origins(origins text[])
returns boolean language plpgsql immutable set search_path = '' as $$
declare origin text; port text;
begin
  if origins is null or cardinality(origins) > 50 then return false; end if;
  foreach origin in array origins loop
    if origin is null or length(origin) > 300 or origin !~ '^https?://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*(:[1-9][0-9]{0,4})?$' then return false; end if;
    port := substring(origin from ':([0-9]+)$');
    if port is not null and port::integer > 65535 then return false; end if;
  end loop;
  return cardinality(origins) = (select count(distinct item) from unnest(origins) item);
end;
$$;
create table if not exists public.form_embedding_settings (
  id smallint primary key default 1 check (id = 1),
  allowed_origins text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint valid_form_embedding_origins check (public.valid_embedding_origins(allowed_origins))
);
insert into public.form_embedding_settings(id) values(1) on conflict do nothing;
alter table public.form_embedding_settings enable row level security;
revoke all on public.form_embedding_settings from anon, authenticated;
grant select on public.form_embedding_settings to authenticated;
grant all on public.form_embedding_settings to service_role;
create policy embedding_settings_admin_read on public.form_embedding_settings for select to authenticated
using ((select public.request_is_enabled()) and (select public.request_role()) = 'admin');

create or replace function public.set_form_embedding_origins(p_origins text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.request_is_enabled() or public.request_role() <> 'admin' then
    raise exception 'Изменять разрешённые сайты может только администратор' using errcode='42501';
  end if;
  if not public.valid_embedding_origins(p_origins) then
    raise exception 'Укажите до 50 уникальных сайтов в формате https://example.ru, без путей и подстановок' using errcode='22023';
  end if;
  update public.form_embedding_settings set allowed_origins=p_origins, updated_at=now(), updated_by=auth.uid() where id=1;
  return (select jsonb_build_object('allowed_origins', allowed_origins, 'updated_at', updated_at) from public.form_embedding_settings where id=1);
end;
$$;
revoke all on function public.set_form_embedding_origins(text[]) from public, anon;
grant execute on function public.set_form_embedding_origins(text[]) to authenticated;

-- Nginx reads this header in an internal auth_request before serving public HTML.
-- No origin/referrer supplied by a visitor influences the policy.
create or replace function public.get_form_embedding_policy()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare origins text[]; policy text;
begin
  select allowed_origins into origins from public.form_embedding_settings where id=1;
  policy := case when coalesce(cardinality(origins),0)=0 then '''none''' else array_to_string(origins,' ') end;
  perform set_config('response.headers',jsonb_build_array(jsonb_build_object('X-Form-Frame-Ancestors',policy),jsonb_build_object('Cache-Control','no-store'))::text,true);
  return jsonb_build_object('frameAncestors',policy);
end;
$$;
revoke all on function public.get_form_embedding_policy() from public;
grant execute on function public.get_form_embedding_policy() to anon, authenticated, service_role;

alter table public.app_branding add column if not exists favicon_path text;
alter table public.app_branding add column if not exists favicon_mime text;
alter table public.app_branding add constraint app_branding_favicon_valid check (
  (favicon_path is null and favicon_mime is null) or
  (favicon_path is not null and favicon_mime is not null and favicon_path ~ '^favicon-[0-9a-f-]{36}\.(png|svg|ico)$' and favicon_mime in ('image/png','image/svg+xml','image/x-icon'))
);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('app-favicons','app-favicons',true,1048576,array['image/png','image/svg+xml','image/x-icon'])
on conflict(id) do update set public=true,file_size_limit=1048576,allowed_mime_types=excluded.allowed_mime_types;
-- Favicon writes use service_role after content validation. No browser upload policy.
create or replace function public.get_app_favicon()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('path',favicon_path,'mime',favicon_mime,'updatedAt',updated_at) from public.app_branding where id=1;
$$;
revoke all on function public.get_app_favicon() from public;
grant execute on function public.get_app_favicon() to anon, authenticated, service_role;
create or replace function public.set_app_favicon(p_path text, p_mime text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare previous text;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and not is_disabled) then
    raise exception 'Только администратор может изменить favicon' using errcode='42501';
  end if;
  select favicon_path into previous from public.app_branding where id=1 for update;
  update public.app_branding set favicon_path=p_path,favicon_mime=p_mime,updated_at=now(),updated_by=p_actor where id=1;
  return public.get_app_favicon() || jsonb_build_object('previousPath',previous);
end;
$$;
revoke all on function public.set_app_favicon(text,text,uuid) from public,anon,authenticated;
grant execute on function public.set_app_favicon(text,text,uuid) to service_role;

-- Form mail and capabilities are owned by the form's author, including when
-- another user is an administrator. Administrative test mail remains private.
create or replace function public.can_read_mail_batch(target_batch_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.request_is_enabled() and exists (
    select 1 from public.mail_batches b left join public.forms f on f.id=b.form_id
    where b.id=target_batch_id and (f.author_id=auth.uid() or (b.form_id is null and b.created_by=auth.uid()))
  );
$$;

create or replace function public.get_form_personal_links(p_form_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f public.forms%rowtype; can_manage boolean; links jsonb;
begin
  if not public.request_is_enabled() then
    raise exception 'Требуется действующая учётная запись' using errcode = '42501';
  end if;
  select * into f from public.forms where id = p_form_id;
  if not found then raise exception 'Форма не найдена' using errcode = 'P0002'; end if;
  can_manage := f.author_id = auth.uid();
  if can_manage then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'organization_type', o.organization_type, 'number', o.number,
      'alias', o.alias, 'email', o.email, 'token', l.token
    ) order by o.organization_type, o.number, o.alias, o.id), '[]'::jsonb) into links
    from public.form_personal_links l
    join public.education_organizations o on o.id = l.organization_id
    where l.form_id = f.id and not o.is_archived and o.organization_type = any(f.organization_types);
  end if;
  return jsonb_build_object('available', jsonb_path_exists(f.schema, '$.** ? (@.type == "organization")'),
    'canManage', can_manage, 'enabled', f.personal_links_enabled, 'links', coalesce(links, '[]'::jsonb));
end;
$$;

create or replace function public.set_form_personal_links(p_form_id uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.forms%rowtype;
begin
  if not public.request_is_enabled() then
    raise exception 'Требуется действующая учётная запись' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mail-reminder/' || p_form_id::text, 0));
  select * into f from public.forms where id = p_form_id for update;
  if not found or not (f.author_id = auth.uid()) then
    raise exception 'Нет прав на управление персональными ссылками' using errcode = '42501';
  end if;
  if p_enabled is null then raise exception 'Укажите состояние переключателя' using errcode = '22023'; end if;
  if p_enabled and not jsonb_path_exists(f.schema, '$.** ? (@.type == "organization")') then
    raise exception 'Добавьте в форму вопрос «Организация»' using errcode = '22023';
  end if;
  if p_enabled is distinct from f.personal_links_enabled and exists (
    select 1 from public.mail_queue where form_id = p_form_id and status in ('queued', 'processing')
  ) then
    raise exception 'Дождитесь завершения текущей рассылки по форме' using errcode = '55000';
  end if;
  update public.forms set personal_links_enabled = p_enabled where id = p_form_id;
  if p_enabled then perform public.ensure_form_personal_links(p_form_id); end if;
  return public.get_form_personal_links(p_form_id);
end;
$$;

create or replace function public.enqueue_form_mail_batch(
  p_batch_id uuid, p_form_id uuid, p_created_by uuid, p_jobs jsonb, p_kind text, p_personal boolean
)
returns integer language plpgsql security definer set search_path = '' as $$
declare job_count integer; f public.forms%rowtype;
begin
  if p_batch_id is null or p_form_id is null or p_created_by is null or p_jobs is null
    or jsonb_typeof(p_jobs) <> 'array' or p_kind is null or p_kind not in ('reminder','invitation') then
    raise exception 'Некорректная рассылка' using errcode = '22023';
  end if;
  job_count := jsonb_array_length(p_jobs);
  if job_count not between 1 and 5000 then raise exception 'Некорректное число писем' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mail-reminder/' || p_form_id::text, 0));
  select * into f from public.forms where id = p_form_id for update;
  if not found or not public.is_public_active_form(p_form_id)
    or f.personal_links_enabled is distinct from p_personal or (p_kind = 'invitation' and not p_personal)
    or not jsonb_path_exists(f.schema, '$.** ? (@.type == "organization")') then
    raise exception 'Настройки формы изменились. Повторите рассылку.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_created_by and not p.is_disabled
    and p.id = f.author_id) then
    raise exception 'Нет прав на рассылку по этой форме' using errcode = '42501';
  end if;
  if exists (select 1 from public.mail_queue q where q.form_id = p_form_id and q.status in ('queued','processing')) then
    raise exception 'Previous reminder run is still active' using errcode = '55000';
  end if;
  insert into public.mail_batches(id, kind, form_id, created_by, total_count)
  values (p_batch_id, p_kind, p_form_id, p_created_by, job_count);
  insert into public.mail_queue(batch_id, form_id, organization_id, recipient_email, recipient_name, subject, body_text)
  select p_batch_id, p_form_id, (job ->> 'organization_id')::uuid,
    lower(btrim(job ->> 'recipient_email')), btrim(job ->> 'recipient_name'), job ->> 'subject', job ->> 'body_text'
  from jsonb_array_elements(p_jobs) job;
  return job_count;
end;
$$;

notify pgrst, 'reload schema';
commit;
