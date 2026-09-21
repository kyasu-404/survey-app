begin;

-- A scalar JSON result is not truncated by PostgREST db-max-rows. STABLE uses
-- one MVCC snapshot for size checks and payload, including concurrent deletes.
create or replace function public.export_form_responses(p_form_id uuid, p_response_ids uuid[] default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  row_count bigint;
  byte_count bigint;
  result jsonb;
begin
  if not public.request_is_enabled() then
    raise exception 'Требуется действующая учётная запись' using errcode = '42501';
  end if;
  if p_response_ids is not null and cardinality(p_response_ids) not between 1 and 10000 then
    raise exception 'Выберите от 1 до 10000 ответов' using errcode = '22023';
  end if;
  select count(*), coalesce(sum(octet_length(r.data::text) + 256), 0)
  into row_count, byte_count
  from public.responses r where r.form_id = p_form_id
    and (p_response_ids is null or r.id = any(p_response_ids));
  if row_count > 10000 or byte_count > 33554432 then
    raise exception 'Слишком большая выгрузка. Выберите до 10000 ответов общим объёмом до 32 МБ.' using errcode = '54000';
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc), '[]'::jsonb)
  into result
  from (select id, form_id, data, created_at, updated_at from public.responses
    where form_id = p_form_id and (p_response_ids is null or id = any(p_response_ids))) r;
  return result;
end;
$$;
revoke all on function public.export_form_responses(uuid,uuid[]) from public, anon;
grant execute on function public.export_form_responses(uuid,uuid[]) to authenticated, service_role;

-- Preserve the entire reminder audience (or reject >5000) in one SQL snapshot.
create or replace function public.list_missing_form_organizations_snapshot(p_form_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb)
  from (select * from public.list_missing_form_organizations(p_form_id) limit 5001) o;
$$;
revoke all on function public.list_missing_form_organizations_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.list_missing_form_organizations_snapshot(uuid) to service_role;

commit;
