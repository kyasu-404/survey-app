begin;

-- Only the browser that reserved a file may reopen it from a response draft.
create or replace function public.can_restore_survey_upload(p_path text, p_browser_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.survey_upload_reservations r
    join storage.objects o on o.bucket_id = 'survey-files' and o.name = r.object_path
    where r.object_path = p_path and r.browser_hash = public.browser_capability_hash(p_browser_id)
      and not r.cleanup_claimed and (r.attached or r.expires_at > now())
  );
$$;
revoke all on function public.can_restore_survey_upload(text,uuid) from public, anon, authenticated;
grant execute on function public.can_restore_survey_upload(text,uuid) to service_role;

commit;
