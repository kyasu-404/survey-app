begin;

-- Question names are immutable in the builder. Preserve the previous ID on updates
-- (including saves from old browser tabs); every newly inserted form gets new IDs.
create or replace function public.office_assign_question_ids(node jsonb, previous jsonb default '{}')
returns jsonb language plpgsql set search_path = '' as $$
declare result jsonb := node; field text; children jsonb; child jsonb; stable_id text;
begin
  if jsonb_typeof(node) <> 'object' then return node; end if;
  if node ? 'type' and node ? 'name' and node->>'type' not in ('panel', 'sectiontitle', 'html') then
    stable_id := previous->>(node->>'name');
    result := jsonb_set(result, '{integrationId}', to_jsonb(coalesce(stable_id, gen_random_uuid()::text)));
  end if;
  foreach field in array array['pages','elements','templateElements'] loop
    if jsonb_typeof(node->field) = 'array' then
      children := '[]'::jsonb;
      for child in select value from jsonb_array_elements(node->field) loop
        children := children || jsonb_build_array(public.office_assign_question_ids(child, previous));
      end loop;
      result := jsonb_set(result, array[field], children);
    end if;
  end loop;
  return result;
end $$;

create or replace function public.office_preserve_question_ids()
returns trigger language plpgsql security definer set search_path = '' as $$
declare previous jsonb := '{}';
begin
  if TG_OP = 'UPDATE' then
    select coalesce(jsonb_object_agg(q->>'name', q->>'integrationId'), '{}') into previous
    from jsonb_path_query(old.schema, 'strict $.** ? (exists(@.integrationId) && exists(@.name))') q;
  end if;
  new.schema := public.office_assign_question_ids(new.schema, previous);
  return new;
end $$;

create trigger forms_office_question_ids before insert or update of schema on public.forms
for each row execute function public.office_preserve_question_ids();
update public.forms set schema = schema;
revoke all on function public.office_assign_question_ids(jsonb,jsonb), public.office_preserve_question_ids() from public;

create table public.onlyoffice_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  public_url text not null default '',
  internal_url text not null default '',
  storage_url_override text not null default '',
  jwt_secret_encrypted text not null default '',
  jwt_header text not null default 'Authorization',
  jwt_prefix text not null default 'Bearer ',
  max_file_mb integer not null default 25 check (max_file_mb between 1 and 100),
  max_table_rows integer not null default 1000 check (max_table_rows between 1 and 5000),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.onlyoffice_settings (id) values (1);

create table public.office_documents (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  name text not null check (length(name) between 6 and 200 and name ~* '\.docx$'),
  storage_path text not null unique,
  size_bytes bigint not null default 0,
  version integer not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_opened_at timestamptz,
  last_callback_at timestamptz,
  last_save_error text,
  last_force_save_at bigint not null default 0
);
create index office_documents_form_idx on public.office_documents(form_id, updated_at desc);
create table public.office_document_bindings (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.office_documents(id) on delete cascade,
  binding_type text not null check (binding_type in ('form_field','metric','responses_table','non_respondents')),
  label text not null check (length(label) between 1 and 300),
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 32768),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index office_document_bindings_document_idx on public.office_document_bindings(document_id);
create table public.office_storage_cleanup (
  storage_path text primary key,
  created_at timestamptz not null default now()
);
create or replace function public.office_queue_storage_cleanup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'DELETE' or old.storage_path is distinct from new.storage_path then
    insert into public.office_storage_cleanup(storage_path) values(old.storage_path) on conflict do nothing;
  end if;
  return null;
end $$;
create trigger office_documents_cleanup after delete or update of storage_path on public.office_documents
for each row execute function public.office_queue_storage_cleanup();
revoke all on function public.office_queue_storage_cleanup() from public;

alter table public.onlyoffice_settings enable row level security;
alter table public.office_documents enable row level security;
alter table public.office_document_bindings enable row level security;
alter table public.office_storage_cleanup enable row level security;
revoke all on public.onlyoffice_settings, public.office_documents, public.office_document_bindings, public.office_storage_cleanup from anon, authenticated;
grant select on public.office_documents, public.office_document_bindings to authenticated;
grant all on public.onlyoffice_settings, public.office_documents, public.office_document_bindings, public.office_storage_cleanup to service_role;
create policy office_documents_read on public.office_documents for select to authenticated
using ((select public.request_is_enabled()) and exists(select 1 from public.forms f where f.id = form_id));
create policy office_bindings_read on public.office_document_bindings for select to authenticated
using (exists(select 1 from public.office_documents d where d.id = document_id));
-- Writes/downloads go through Office API with verified active employee identity.
-- No anonymous or authenticated Storage policies are created for this bucket.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('survey-documents','survey-documents',false,104857600,array['application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

commit;
