begin;

revoke delete on table public.forms from authenticated;

drop policy if exists "forms_delete" on public.forms;

commit;
