begin;

-- Follow-up for installations that already applied 202608131200_app_branding.sql.
-- Supabase Storage fills final object metadata after the INSERT policy check,
-- so metadata.size cannot be required by the INSERT policy itself.

drop policy if exists "survey_assets_branding_upload" on storage.objects;

create policy "survey_assets_branding_upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'survey-assets'
  and public.can_manage_app_branding_asset(name)
);

notify pgrst, 'reload schema';

commit;
