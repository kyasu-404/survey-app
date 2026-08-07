begin;

create table if not exists public.mail_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  host text not null,
  port integer not null check (port between 1 and 65535),
  ssl_mode text not null default 'tls' check (ssl_mode in ('tls', 'starttls', 'none')),
  username text not null,
  password_encrypted text not null,
  from_email text not null,
  from_name text not null,
  reply_to text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint mail_settings_host_length check (length(btrim(host)) between 1 and 253),
  constraint mail_settings_username_length check (length(btrim(username)) between 1 and 320),
  constraint mail_settings_password_length check (length(password_encrypted) between 20 and 8192),
  constraint mail_settings_from_email_length check (length(btrim(from_email)) between 3 and 320),
  constraint mail_settings_from_name_length check (length(btrim(from_name)) between 1 and 200),
  constraint mail_settings_reply_to_length check (reply_to is null or length(btrim(reply_to)) between 3 and 320)
);

create table if not exists public.mail_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('reminder', 'test')),
  form_id uuid references public.forms(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  total_count integer not null check (total_count between 1 and 5000),
  created_at timestamptz not null default now(),
  constraint mail_batches_form_kind check (
    (kind = 'reminder' and form_id is not null)
    or (kind = 'test' and form_id is null)
  )
);

create table if not exists public.mail_queue (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.mail_batches(id) on delete cascade,
  form_id uuid references public.forms(id) on delete cascade,
  organization_id uuid references public.education_organizations(id) on delete set null,
  recipient_email text not null,
  recipient_name text not null,
  subject text not null,
  body_text text not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mail_queue_recipient_email_length check (length(btrim(recipient_email)) between 3 and 320),
  constraint mail_queue_recipient_name_length check (length(btrim(recipient_name)) between 1 and 300),
  constraint mail_queue_subject_length check (length(subject) between 1 and 500),
  constraint mail_queue_body_length check (length(body_text) between 1 and 20000),
  constraint mail_queue_error_length check (last_error is null or length(last_error) <= 1000),
  unique nulls not distinct (batch_id, organization_id, recipient_email)
);

create or replace function public.set_mail_record_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mail_settings_set_updated_at on public.mail_settings;
create trigger mail_settings_set_updated_at
before update on public.mail_settings
for each row execute procedure public.set_mail_record_updated_at();

drop trigger if exists mail_queue_set_updated_at on public.mail_queue;
create trigger mail_queue_set_updated_at
before update on public.mail_queue
for each row execute procedure public.set_mail_record_updated_at();

create or replace function public.can_read_mail_batch(target_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.request_is_enabled()
    and exists (
      select 1
      from public.mail_batches b
      left join public.forms f on f.id = b.form_id
      where b.id = target_batch_id
        and (
          b.created_by = auth.uid()
          or f.author_id = auth.uid()
          or public.request_role() = 'admin'
        )
    );
$$;

create or replace function public.list_missing_form_organizations(p_form_id uuid)
returns table (
  id uuid,
  organization_type text,
  number text,
  alias text,
  email text
)
language sql
stable
security definer
set search_path = ''
as $$
  with target_form as (
    select f.id, f.schema, f.organization_types
    from public.forms f
    where f.id = p_form_id
  ),
  question_names as (
    select distinct question_name.value #>> '{}' as name
    from target_form f
    cross join lateral jsonb_path_query(
      f.schema,
      '$.** ? (@.type == "organization").name',
      '{}'::jsonb,
      true
    ) as question_name(value)
  )
  select o.id, o.organization_type, o.number, o.alias, o.email
  from public.education_organizations o
  join target_form f on o.organization_type = any(f.organization_types)
  where exists (select 1 from question_names)
    and not exists (
      select 1
      from public.responses r
      cross join question_names q
      where r.form_id = f.id
        and r.data ->> q.name = o.id::text
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

create or replace function public.claim_mail_jobs(
  p_worker_id text,
  p_limit integer default 20
)
returns setof public.mail_queue
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(btrim(p_worker_id)) not between 1 and 200 then
    raise exception 'Invalid worker id' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select q.id
    from public.mail_queue q
    where (
      (q.status = 'queued' and q.next_attempt_at <= now())
      or (q.status = 'processing' and q.locked_at < now() - interval '10 minutes')
    )
    order by q.next_attempt_at, q.created_at, q.id
    for update skip locked
    limit least(greatest(p_limit, 1), 100)
  )
  update public.mail_queue q
  set status = 'processing',
      attempts = q.attempts + 1,
      locked_at = now(),
      locked_by = btrim(p_worker_id),
      last_error = null
  from candidates c
  where q.id = c.id
  returning q.*;
end;
$$;

create or replace function public.finish_mail_job(
  p_job_id uuid,
  p_worker_id text,
  p_success boolean,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  final_status text;
begin
  update public.mail_queue q
  set status = case
        when p_success then 'sent'
        when q.attempts >= q.max_attempts then 'failed'
        else 'queued'
      end,
      sent_at = case when p_success then now() else null end,
      next_attempt_at = case
        when p_success or q.attempts >= q.max_attempts then q.next_attempt_at
        else now() + make_interval(secs => least(1800, 30 * power(2, least(q.attempts, 6))::integer))
      end,
      last_error = case when p_success then null else left(coalesce(nullif(btrim(p_error), ''), 'Неизвестная ошибка отправки'), 1000) end,
      locked_at = null,
      locked_by = null
  where q.id = p_job_id
    and q.status = 'processing'
    and q.locked_by = btrim(p_worker_id)
  returning q.status into final_status;

  return final_status;
end;
$$;

revoke all on function public.can_read_mail_batch(uuid) from public;
revoke all on function public.list_missing_form_organizations(uuid) from public;
revoke all on function public.claim_mail_jobs(text, integer) from public;
revoke all on function public.finish_mail_job(uuid, text, boolean, text) from public;
grant execute on function public.can_read_mail_batch(uuid) to authenticated, service_role;
grant execute on function public.list_missing_form_organizations(uuid) to service_role;
grant execute on function public.claim_mail_jobs(text, integer) to service_role;
grant execute on function public.finish_mail_job(uuid, text, boolean, text) to service_role;

alter table public.mail_settings enable row level security;
alter table public.mail_batches enable row level security;
alter table public.mail_queue enable row level security;

drop policy if exists "mail_batches_select" on public.mail_batches;
create policy "mail_batches_select"
on public.mail_batches
for select
to authenticated
using (public.can_read_mail_batch(id));

drop policy if exists "mail_queue_select" on public.mail_queue;
create policy "mail_queue_select"
on public.mail_queue
for select
to authenticated
using (public.can_read_mail_batch(batch_id));

revoke all on table public.mail_settings, public.mail_batches, public.mail_queue from anon, authenticated;
grant select on table public.mail_batches, public.mail_queue to authenticated;
grant select, insert, update, delete on table public.mail_settings, public.mail_batches, public.mail_queue to service_role;

create index if not exists idx_mail_batches_form_created_at
on public.mail_batches(form_id, created_at desc);

create index if not exists idx_mail_queue_claim
on public.mail_queue(status, next_attempt_at, created_at);

create index if not exists idx_mail_queue_batch_created_at
on public.mail_queue(batch_id, created_at, id);

create index if not exists idx_mail_queue_form_created_at
on public.mail_queue(form_id, created_at desc);

alter publication supabase_realtime add table public.mail_queue;

commit;
