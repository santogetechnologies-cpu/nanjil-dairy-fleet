-- ==========================================================================
-- Migration: Fix fake baseline numbers in views + remove fabricated defaults
-- ==========================================================================

-- 1. Fix v_fuel_efficiency_by_vehicle:
--    Remove the COALESCE fallback of 5.2 (fake mileage default).
--    If a vehicle has no engine_hours, return NULL instead of a fabricated number.
CREATE OR REPLACE VIEW public.v_fuel_efficiency_by_vehicle WITH (security_invoker = true) AS
SELECT 
    v.number AS number,
    CASE 
        WHEN v.engine_hours > 0 
        THEN ROUND(CAST(v.odometer / v.engine_hours / 10.0 AS NUMERIC), 1)
        ELSE NULL
    END AS kmpl
FROM public.vehicles v
LIMIT 10;

-- 2. Fix v_daily_fuel_fleet:
--    Remove the + 480 and + 4.6 fake baseline values.
--    If telemetry_history has no records for a day, show 0 (real empty state).
CREATE OR REPLACE VIEW public.v_daily_fuel_fleet WITH (security_invoker = true) AS
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

-- 3. Fix v_vehicles:
--    Explicitly CAST lat and lng to NUMERIC (unconstrained) to match the existing 
--    datatype from the original COALESCE(vt.lat, 8.25) view definition.
--    This prevents the data type change error and allows CREATE OR REPLACE VIEW to succeed.
CREATE OR REPLACE VIEW public.v_vehicles WITH (security_invoker = true) AS
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

-- 4. Grant SELECT on all views to authenticated role
GRANT SELECT ON public.v_vehicles TO authenticated;
GRANT SELECT ON public.v_fuel_efficiency_by_vehicle TO authenticated;
GRANT SELECT ON public.v_daily_fuel_fleet TO authenticated;
GRANT SELECT ON public.v_driver_safety_ranking TO authenticated;
