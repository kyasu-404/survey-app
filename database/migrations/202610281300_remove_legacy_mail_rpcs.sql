begin;
set local lock_timeout = '5s';

-- Replaced by prepare_form_mail_recipients(uuid, text) and
-- enqueue_form_mail_batch(uuid, uuid, uuid, jsonb, text, boolean).
-- No CASCADE: an unexpected external dependency must abort this migration.
drop function if exists public.list_missing_form_organizations_snapshot(uuid);
drop function if exists public.list_missing_form_organizations(uuid);
drop function if exists public.enqueue_mail_reminder_batch(uuid, uuid, uuid, jsonb);

notify pgrst, 'reload schema';
commit;
