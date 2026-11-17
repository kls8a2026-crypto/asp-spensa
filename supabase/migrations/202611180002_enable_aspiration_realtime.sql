-- Enable Supabase Realtime events for aspiration changes.
-- Safe to run more than once.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'aspirations'
  ) then
    alter publication supabase_realtime add table public.aspirations;
  end if;
end;
$$;
