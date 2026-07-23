do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'forms'
  ) then
    execute 'alter publication supabase_realtime add table public.forms';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'responses'
  ) then
    execute 'alter publication supabase_realtime add table public.responses';
  end if;
end
$$;
