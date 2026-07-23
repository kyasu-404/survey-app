begin;

drop policy if exists "authenticated can delete files" on storage.objects;
drop policy if exists "authenticated can read files" on storage.objects;
drop policy if exists "authenticated can upload files" on storage.objects;
drop policy if exists "owners authors and admins can read survey files" on storage.objects;
drop policy if exists "users can delete own survey files" on storage.objects;
drop policy if exists "users can upload own survey files" on storage.objects;

create policy "survey files upload authenticated"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'survey-files'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (
      (storage.foldername(name))[1] = 'public'
      and exists (
        select 1
        from public.forms f
        where f.id::text = (storage.foldername(name))[2]
          and f.is_public = true
          and (f.deadline_at is null or f.deadline_at > now())
      )
    )
  )
);

create policy "survey files upload anon"
on storage.objects
for insert
to anon
with check (
  bucket_id = 'survey-files'
  and (storage.foldername(name))[1] = 'public'
  and exists (
    select 1
    from public.forms f
    where f.id::text = (storage.foldername(name))[2]
      and f.is_public = true
      and (f.deadline_at is null or f.deadline_at > now())
  )
);

create policy "survey files read authenticated"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'survey-files'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (
      (storage.foldername(name))[1] = 'public'
      and exists (
        select 1
        from public.forms f
        where f.id::text = (storage.foldername(name))[2]
          and f.is_public = true
          and (f.deadline_at is null or f.deadline_at > now())
      )
    )
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

create policy "survey files read anon"
on storage.objects
for select
to anon
using (
  bucket_id = 'survey-files'
  and (storage.foldername(name))[1] = 'public'
  and exists (
    select 1
    from public.forms f
    where f.id::text = (storage.foldername(name))[2]
      and f.is_public = true
      and (f.deadline_at is null or f.deadline_at > now())
  )
);

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
