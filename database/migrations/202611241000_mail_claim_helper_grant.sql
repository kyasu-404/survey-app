begin;

-- The existing SECURITY DEFINER function keeps its owner on upgrade.
do $$
declare
  mail_claim_owner regrole;
begin
  select proowner::regrole into strict mail_claim_owner
  from pg_proc
  where oid = 'public.claim_mail_jobs(text,integer)'::regprocedure;

  execute format(
    'grant execute on function survey_automation.run_is_active(uuid) to %s',
    mail_claim_owner
  );
end;
$$;

commit;
