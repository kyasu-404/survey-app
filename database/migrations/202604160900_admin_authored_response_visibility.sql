begin;

create or replace function public.is_public_active_admin_authored_form(target_form_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.forms f
    join public.profiles p on p.id = f.author_id
    where f.id = target_form_id
      and f.is_public = true
      and (f.deadline_at is null or f.deadline_at > now())
      and p.role = 'admin'
  );
$$;

revoke all on function public.is_public_active_admin_authored_form(uuid) from public;
grant execute on function public.is_public_active_admin_authored_form(uuid) to authenticated, service_role;

alter policy "responses_select_author_or_admin"
on public.responses
using (
  (select public.request_role()) = 'admin'
  OR exists (
    select 1
    from public.forms f
    where f.id = form_id
      and f.author_id = (select auth.uid())
  )
  OR public.is_public_active_admin_authored_form(form_id)
);

commit;
