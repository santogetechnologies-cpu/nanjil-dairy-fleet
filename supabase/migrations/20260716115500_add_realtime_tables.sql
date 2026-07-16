-- ==========================================================
-- Migration: Add drivers and profiles tables to realtime publication
-- ==========================================================

-- Check if supabase_realtime publication exists, then add tables
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        alter publication supabase_realtime add table public.drivers;
        alter publication supabase_realtime add table public.profiles;
    end if;
end;
$$;
