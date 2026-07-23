begin;

drop policy if exists "survey files delete anon" on storage.objects;
drop policy if exists "survey files delete authenticated" on storage.objects;

create policy "survey files delete authenticated"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'survey-files'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1
      from public.forms f
      where f.id::text = (storage.foldername(name))[2]
        and (
          f.author_id = (select auth.uid())
          or (select public.request_role()) = 'admin'
        )
    )
  )
);

commit;
