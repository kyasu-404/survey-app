begin;
set local lock_timeout = '5s';

alter table public.forms add column if not exists personal_links_enabled boolean not null default false;

-- Tokens are capabilities. Browser credentials used by the existing response API
-- stay server-side, separate from the published token and ordinary browser IDs.
create table if not exists public.form_personal_links (
  form_id uuid not null references public.forms(id) on delete cascade,
  organization_id uuid not null references public.education_organizations(id),
  token uuid not null default gen_random_uuid() unique,
  browser_id uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  primary key (form_id, organization_id)
);
alter table public.form_personal_links enable row level security;
revoke all on public.form_personal_links from anon, authenticated;
grant all on public.form_personal_links to service_role;

create or replace function public.ensure_form_personal_links(p_form_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.form_personal_links(form_id, organization_id)
  select f.id, o.id from public.forms f
  join public.education_organizations o on o.organization_type = any(f.organization_types)
  where f.id = p_form_id and f.personal_links_enabled and not o.is_archived
    and jsonb_path_exists(f.schema, '$.** ? (@.type == "organization")')
  on conflict (form_id, organization_id) do nothing;
end;
$$;
revoke all on function public.ensure_form_personal_links(uuid) from public, anon, authenticated;

create or replace function public.get_form_personal_links(p_form_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f public.forms%rowtype; can_manage boolean; links jsonb;
begin
  if not public.request_is_enabled() then
    raise exception 'Требуется действующая учётная запись' using errcode = '42501';
  end if;
  select * into f from public.forms where id = p_form_id;
  if not found then raise exception 'Форма не найдена' using errcode = 'P0002'; end if;
  can_manage := f.author_id = auth.uid() or public.request_role() = 'admin';
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
revoke all on function public.get_form_personal_links(uuid) from public, anon;
grant execute on function public.get_form_personal_links(uuid) to authenticated;

create or replace function public.set_form_personal_links(p_form_id uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.forms%rowtype;
begin
  if not public.request_is_enabled() then
    raise exception 'Требуется действующая учётная запись' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mail-reminder/' || p_form_id::text, 0));
  select * into f from public.forms where id = p_form_id for update;
  if not found or not (f.author_id = auth.uid() or public.request_role() = 'admin') then
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
revoke all on function public.set_form_personal_links(uuid, boolean) from public, anon;
grant execute on function public.set_form_personal_links(uuid, boolean) to authenticated;

create or replace function public.resolve_form_personal_link(p_form_id uuid, p_token uuid)
returns public.form_personal_links language plpgsql stable security definer set search_path = '' as $$
declare link public.form_personal_links%rowtype;
begin
  if auth.uid() is not null and not public.request_is_enabled() then
    raise exception 'Пользователь отключён' using errcode = '42501';
  end if;
  select l.* into link from public.form_personal_links l
  join public.forms f on f.id = l.form_id
  join public.education_organizations o on o.id = l.organization_id
  where l.form_id = p_form_id and l.token = p_token and f.personal_links_enabled
    and public.is_public_active_form(f.id) and not o.is_archived
    and o.organization_type = any(f.organization_types)
    and jsonb_path_exists(f.schema, '$.** ? (@.type == "organization")');
  if not found then
    raise exception 'Персональная ссылка недействительна или форма закрыта' using errcode = '42501';
  end if;
  return link;
end;
$$;
revoke all on function public.resolve_form_personal_link(uuid, uuid) from public, anon, authenticated;

create or replace function public.get_personal_form_context(p_form_id uuid, p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare link public.form_personal_links%rowtype; organization jsonb;
begin
  link := public.resolve_form_personal_link(p_form_id, p_token);
  select jsonb_build_object('id', o.id, 'organization_type', o.organization_type,
    'number', o.number, 'alias', o.alias) into organization
  from public.education_organizations o where o.id = link.organization_id;
  return organization;
end;
$$;
revoke all on function public.get_personal_form_context(uuid, uuid) from public;
grant execute on function public.get_personal_form_context(uuid, uuid) to anon, authenticated;

create or replace function public.check_personal_response_data(p_form_id uuid, p_organization_id uuid, p_data jsonb)
returns void language plpgsql stable security definer set search_path = '' as $$
declare question_name text;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Некорректные данные ответа' using errcode = '22023';
  end if;
  for question_name in
    select distinct coalesce(nullif(q ->> 'valueName', ''), q ->> 'name')
    from public.forms f cross join lateral jsonb_path_query(f.schema, '$.** ? (@.type == "organization")') q
    where f.id = p_form_id
  loop
    if (p_data ->> question_name) is distinct from p_organization_id::text then
      raise exception 'Организацию в персональной ссылке изменить нельзя' using errcode = '22023';
    end if;
  end loop;
end;
$$;
revoke all on function public.check_personal_response_data(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.get_personal_form_response_status(p_form_id uuid, p_token uuid)
returns table(response_id uuid, response_data jsonb, response_editable boolean)
language plpgsql stable security definer set search_path = '' as $$
declare link public.form_personal_links%rowtype;
begin
  link := public.resolve_form_personal_link(p_form_id, p_token);
  return query select * from public.get_form_response_status(p_form_id, link.browser_id);
end;
$$;
revoke all on function public.get_personal_form_response_status(uuid, uuid) from public;
grant execute on function public.get_personal_form_response_status(uuid, uuid) to anon, authenticated;

create or replace function public.submit_personal_form_response(p_form_id uuid, p_token uuid, p_submission_id uuid, p_data jsonb)
returns table(status text, response_id uuid, response_data jsonb, response_editable boolean)
language plpgsql security definer set search_path = '' as $$
declare link public.form_personal_links%rowtype;
begin
  perform 1 from public.forms where id = p_form_id for update;
  link := public.resolve_form_personal_link(p_form_id, p_token);
  perform public.check_personal_response_data(p_form_id, link.organization_id, p_data);
  return query select * from public.submit_form_response(p_form_id, link.browser_id, p_submission_id, p_data);
end;
$$;
revoke all on function public.submit_personal_form_response(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.submit_personal_form_response(uuid, uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.update_personal_form_response(p_form_id uuid, p_token uuid, p_response_id uuid, p_data jsonb)
returns table(response_id uuid, response_data jsonb)
language plpgsql security definer set search_path = '' as $$
declare link public.form_personal_links%rowtype;
begin
  perform 1 from public.forms where id = p_form_id for update;
  link := public.resolve_form_personal_link(p_form_id, p_token);
  perform public.check_personal_response_data(p_form_id, link.organization_id, p_data);
  return query select * from public.update_form_response(p_form_id, link.browser_id, p_response_id, p_data);
end;
$$;
revoke all on function public.update_personal_form_response(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.update_personal_form_response(uuid, uuid, uuid, jsonb) to anon, authenticated;

-- One JSON snapshot avoids PostgREST's 1000-row truncation. Prepare missing
-- tokens for new directory entries before either invitations or reminders.
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
  select coalesce(jsonb_agg(to_jsonb(recipient)), '[]'::jsonb) into recipients from (
    select o.id, o.organization_type, o.number, o.alias, o.email,
      case when f.personal_links_enabled then l.token else null end as token
    from public.education_organizations o
    left join public.form_personal_links l on l.form_id = f.id and l.organization_id = o.id
    where not o.is_archived and o.organization_type = any(f.organization_types)
      and (p_kind = 'invitation' or not exists (
        select 1 from public.responses r
        cross join lateral jsonb_path_query(f.schema, '$.** ? (@.type == "organization")') q
        where r.form_id = f.id and r.data ->> coalesce(nullif(q ->> 'valueName', ''), q ->> 'name') = o.id::text
      ))
    order by o.organization_type, o.number, o.alias, o.id limit 5001
  ) recipient;
  if jsonb_array_length(recipients) > 5000 then
    raise exception 'За одну рассылку можно поставить в очередь не более 5000 писем' using errcode = '22023';
  end if;
  return jsonb_build_object('personal', f.personal_links_enabled, 'recipients', recipients);
end;
$$;
revoke all on function public.prepare_form_mail_recipients(uuid, text) from public, anon, authenticated;
grant execute on function public.prepare_form_mail_recipients(uuid, text) to service_role;

alter table public.mail_batches drop constraint if exists mail_batches_kind_check;
alter table public.mail_batches add constraint mail_batches_kind_check check (kind in ('reminder', 'invitation', 'test'));
alter table public.mail_batches drop constraint if exists mail_batches_form_kind;
alter table public.mail_batches add constraint mail_batches_form_kind check (
  (kind in ('reminder', 'invitation') and form_id is not null) or (kind = 'test' and form_id is null)
);

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
    and (p.id = f.author_id or p.role = 'admin')) then
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
revoke all on function public.enqueue_form_mail_batch(uuid, uuid, uuid, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.enqueue_form_mail_batch(uuid, uuid, uuid, jsonb, text, boolean) to service_role;


-- A personal capability may restore only files already attached to its own
-- response. Unsubmitted drafts continue to require the uploader's browser ID.
create or replace function public.can_restore_personal_upload(p_form_id uuid, p_token uuid, p_path text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare link public.form_personal_links%rowtype;
begin
  link := public.resolve_form_personal_link(p_form_id, p_token);
  return exists (
    select 1 from public.responses r
    join public.response_file_references ref on ref.response_id = r.id and ref.form_id = r.form_id
    where r.form_id = p_form_id and r.browser_id = public.browser_capability_hash(link.browser_id)
      and ref.object_path = p_path
  );
end;
$$;
revoke all on function public.can_restore_personal_upload(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.can_restore_personal_upload(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
