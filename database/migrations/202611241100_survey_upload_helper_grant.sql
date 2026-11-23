begin;

-- The upload policy function retains its existing owner on upgrade.
do $$
declare
  upload_policy_owner regrole;
begin
  select proowner::regrole into strict upload_policy_owner
  from pg_proc
  where oid = 'public.can_upload_survey_file(text,boolean,bigint)'::regprocedure;

  execute format(
    'grant execute on function public.survey_upload_questions(jsonb,integer) to %s',
    upload_policy_owner
  );
end;
$$;

commit;
