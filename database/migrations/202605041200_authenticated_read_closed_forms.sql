begin;

drop policy if exists "forms_select" on public.forms;

create policy "forms_select"
on public.forms
for select
to authenticated
using (true);

commit;
