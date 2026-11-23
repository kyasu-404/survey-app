begin;

-- The existing trigger function keeps its owner when upgraded in place.
do $$
declare
  question_trigger_owner regrole;
begin
  select proowner::regrole into strict question_trigger_owner
  from pg_proc
  where oid = 'public.office_preserve_question_ids()'::regprocedure;

  execute format(
    'grant execute on function public.office_assign_question_ids(jsonb,jsonb,integer) to %s',
    question_trigger_owner
  );
end;
$$;

commit;
