-- ================================================================
-- Migration: Fix All Schema, Missing Columns & RLS Constraints
-- ================================================================

-- 1. Relax vehicle_id NOT NULL constraint on pre_trip_inspections
-- (Allows drivers to start inspection even if vehicle is unassigned)
ALTER TABLE IF EXISTS public.pre_trip_inspections 
  ALTER COLUMN vehicle_id DROP NOT NULL;

-- 2. Add missing manual tracking columns
ALTER TABLE IF EXISTS public.pre_trip_inspections 
  ADD COLUMN IF NOT EXISTS opening_km INTEGER;

ALTER TABLE IF EXISTS public.driver_shifts 
  ADD COLUMN IF NOT EXISTS opening_km INTEGER;

ALTER TABLE IF EXISTS public.trips 
  ADD COLUMN IF NOT EXISTS fuel_liters_start NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS fuel_liters_end NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS start_km INTEGER,
  ADD COLUMN IF NOT EXISTS end_km INTEGER;

-- 3. Recreate v_vehicles view clean with all columns & correct types
DROP VIEW IF EXISTS public.v_vehicles CASCADE;

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
    v.device_id,
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

-- 4. Grant full schema and view access to anon and authenticated roles
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.v_vehicles TO anon, authenticated;

-- 5. Set up permissive RLS policies on all operational tables
DO $$
DECLARE
    tbl text;
BEGIN
    FOR tbl IN 
        SELECT unnest(ARRAY[
            'trips', 'driver_schedules', 'maintenance_records', 
            'driver_shifts', 'pre_trip_inspections', 'fuel_purchase_logs', 
            'alerts', 'vehicles', 'drivers', 'collection_routes', 
            'vehicle_assignments', 'vehicle_telemetry', 'profiles'
        ])
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "allow_all_%s" ON public.%I', tbl, tbl);
        EXECUTE format('CREATE POLICY "allow_all_%s" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', tbl, tbl);
    END LOOP;
END
$$;
