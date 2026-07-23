-- ==========================================================
-- Migration: Allow SELECT for anon role to prevent empty fleet tables
-- ==========================================================

-- Grant SELECT permissions on all tables & views to anon role
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;

-- Add SELECT RLS policies for anon role
DROP POLICY IF EXISTS "Allow anon select profiles" ON public.profiles;
CREATE POLICY "Allow anon select profiles" ON public.profiles FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow anon select vehicles" ON public.vehicles;
CREATE POLICY "Allow anon select vehicles" ON public.vehicles FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow anon select drivers" ON public.drivers;
CREATE POLICY "Allow anon select drivers" ON public.drivers FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow anon select vehicle_telemetry" ON public.vehicle_telemetry;
CREATE POLICY "Allow anon select vehicle_telemetry" ON public.vehicle_telemetry FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow anon select vehicle_assignments" ON public.vehicle_assignments;
CREATE POLICY "Allow anon select vehicle_assignments" ON public.vehicle_assignments FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow anon select alerts" ON public.alerts;
CREATE POLICY "Allow anon select alerts" ON public.alerts FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow anon select collection_routes" ON public.collection_routes;
CREATE POLICY "Allow anon select collection_routes" ON public.collection_routes FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow anon select maintenance" ON public.maintenance_records;
CREATE POLICY "Allow anon select maintenance" ON public.maintenance_records FOR SELECT TO anon USING (true);
