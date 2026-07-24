-- ==========================================================
-- Migration: Grant anon & authenticated SELECT on all tables + views
-- This fixes 401 Unauthorized errors for unauthenticated users
-- ==========================================================

-- Grant ALL permissions (SELECT, INSERT, UPDATE, DELETE) on base tables
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Disable Row Level Security on fleet management tables
ALTER TABLE public.drivers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_assignments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_telemetry DISABLE ROW LEVEL SECURITY;

-- Explicitly grant on views (needed when security_invoker = true)
GRANT SELECT ON public.v_vehicles TO anon, authenticated;
GRANT SELECT ON public.v_fuel_efficiency_by_vehicle TO anon, authenticated;
GRANT SELECT ON public.v_daily_fuel_fleet TO anon, authenticated;

-- Grant on driver safety ranking view if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'v_driver_safety_ranking') THEN
    EXECUTE 'GRANT SELECT ON public.v_driver_safety_ranking TO anon, authenticated';
  END IF;
END $$;

-- Drop existing anon SELECT policies and recreate them
DROP POLICY IF EXISTS "Allow anon select profiles" ON public.profiles;
CREATE POLICY "Allow anon select profiles" ON public.profiles FOR SELECT TO anon, authenticated USING (true);

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

-- Allow anon to select fuel_logs and telemetry_history if they exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'fuel_logs') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Allow anon select fuel_logs" ON public.fuel_logs';
    EXECUTE 'CREATE POLICY "Allow anon select fuel_logs" ON public.fuel_logs FOR SELECT TO anon USING (true)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'telemetry_history') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Allow anon select telemetry_history" ON public.telemetry_history';
    EXECUTE 'CREATE POLICY "Allow anon select telemetry_history" ON public.telemetry_history FOR SELECT TO anon USING (true)';
  END IF;
END $$;

-- Recreate views WITHOUT security_invoker so they run as the view owner (bypasses RLS)
CREATE OR REPLACE VIEW public.v_fuel_efficiency_by_vehicle AS
SELECT 
    v.number AS number,
    CASE 
        WHEN v.engine_hours > 0 
        THEN ROUND(CAST(v.odometer / v.engine_hours / 10.0 AS NUMERIC), 1)
        ELSE NULL
    END AS kmpl
FROM public.vehicles v
LIMIT 10;

CREATE OR REPLACE VIEW public.v_daily_fuel_fleet AS
SELECT 
    to_char(g.day, 'YYYY-MM-DD') AS log_date,
    COALESCE((
        SELECT CAST(SUM(speed * 0.15) AS INTEGER) 
        FROM public.telemetry_history 
        WHERE recorded_at::date = g.day::date
    ), 0) AS total_consumed_l,
    COALESCE((
        SELECT ROUND(CAST(AVG(speed * 0.1) AS NUMERIC), 1)
        FROM public.telemetry_history
        WHERE recorded_at::date = g.day::date
    ), 0.0) AS avg_mileage_kmpl
FROM generate_series(
    CURRENT_DATE - INTERVAL '6 days',
    CURRENT_DATE,
    '1 day'::interval
) g(day)
ORDER BY g.day;

CREATE OR REPLACE VIEW public.v_vehicles AS
SELECT 
    v.id,
    v.number,
    v.type,
    v.model,
    v.route,
    v.insurance_expiry,
    v.last_service,
    v.next_service_km,
    v.odometer,
    v.engine_hours,
    COALESCE(vt.status, 'Offline'::text) AS status,
    COALESCE(vt.location, 'Unknown'::text) AS location,
    CAST(vt.lat AS numeric) AS lat,
    CAST(vt.lng AS numeric) AS lng,
    COALESCE(vt.speed, 0) AS speed,
    COALESCE(vt.fuel, 0) AS fuel,
    COALESCE(vt.temperature, 0::numeric) AS temperature,
    COALESCE(vt.humidity, 0) AS humidity,
    COALESCE(vt.engine_on, false) AS engine_on,
    COALESCE(vt.ignition, false) AS ignition,
    COALESCE(vt.last_update, timezone('utc'::text, now())) AS last_update,
    d.name AS driver_name,
    d.id AS driver_id
FROM public.vehicles v
LEFT JOIN public.vehicle_telemetry vt ON v.id = vt.vehicle_id
LEFT JOIN public.vehicle_assignments va ON v.id = va.vehicle_id AND va.is_active = true
LEFT JOIN public.drivers d ON va.driver_id = d.id;

-- Grant on the recreated views
GRANT SELECT ON public.v_vehicles TO anon, authenticated;
GRANT SELECT ON public.v_fuel_efficiency_by_vehicle TO anon, authenticated;
GRANT SELECT ON public.v_daily_fuel_fleet TO anon, authenticated;

-- Allow INSERT, DELETE & UPDATE for anon & authenticated roles on profiles, drivers, and assignments
DROP POLICY IF EXISTS "Allow anon delete profiles" ON public.profiles;
CREATE POLICY "Allow anon delete profiles" ON public.profiles FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow anon update profiles" ON public.profiles;
CREATE POLICY "Allow anon update profiles" ON public.profiles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon insert profiles" ON public.profiles;
CREATE POLICY "Allow anon insert profiles" ON public.profiles FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon delete drivers" ON public.drivers;
CREATE POLICY "Allow anon delete drivers" ON public.drivers FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow anon update drivers" ON public.drivers;
CREATE POLICY "Allow anon update drivers" ON public.drivers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon insert drivers" ON public.drivers;
CREATE POLICY "Allow anon insert drivers" ON public.drivers FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon insert vehicle_assignments" ON public.vehicle_assignments;
CREATE POLICY "Allow anon insert vehicle_assignments" ON public.vehicle_assignments FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Admin Delete RPC Functions
CREATE OR REPLACE FUNCTION public.admin_delete_user(target_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    DELETE FROM public.drivers WHERE profile_id = target_user_id OR id = target_user_id;
    DELETE FROM public.profiles WHERE id = target_user_id;
    DELETE FROM auth.users WHERE id = target_user_id;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_user_by_email(target_email TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    found_id UUID;
BEGIN
    SELECT id INTO found_id FROM auth.users WHERE LOWER(email) = LOWER(TRIM(target_email)) LIMIT 1;
    IF found_id IS NOT NULL THEN
        DELETE FROM public.drivers WHERE profile_id = found_id OR id = found_id;
        DELETE FROM public.profiles WHERE id = found_id;
        DELETE FROM auth.users WHERE id = found_id;
    END IF;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.admin_delete_user_by_email(TEXT) TO anon, authenticated;

