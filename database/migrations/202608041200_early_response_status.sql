begin;

create or replace function public.get_form_response_status(
  p_form_id uuid,
  p_browser_id uuid
)
returns table (
  response_id uuid,
  response_data jsonb,
  response_editable boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_form public.forms%rowtype;
  existing_response public.responses%rowtype;
begin
  if auth.uid() is not null and not public.request_is_enabled() then
    raise exception 'Пользователь отключён' using errcode = '42501';
  end if;

  if p_form_id is null or p_browser_id is null then
    raise exception 'Некорректный идентификатор ответа' using errcode = '22023';
  end if;

  select f.*
  into target_form
  from public.forms f
  join public.profiles p on p.id = f.author_id
  where f.id = p_form_id
    and p.is_disabled = false;

  if target_form.id is null then
    return;
  end if;

  select r.*
  into existing_response
  from public.responses r
  where r.form_id = p_form_id
    and r.browser_id = p_browser_id;

  if existing_response.id is null then
    return;
  end if;

  return query select
    existing_response.id,
    existing_response.data,
    target_form.allow_response_editing
      and target_form.is_public
      and (target_form.deadline_at is null or target_form.deadline_at > now());
end;
$$;

revoke all on function public.get_form_response_status(uuid, uuid) from public;
grant execute on function public.get_form_response_status(uuid, uuid) to anon, authenticated, service_role;

commit;
