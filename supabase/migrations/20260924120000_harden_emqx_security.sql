-- ============================================================
-- Migration: Harden EMQX integration security
-- Date: 2026-09-24
-- Version: 20260924120000
--
-- Fixes applied:
--   1. SECURITY DEFINER functions hardened with explicit search_path
--      to prevent search_path injection attacks.
--   2. emqx_integration_errors RLS changed from open FOR ALL
--      to least-privilege: emqx_writer INSERT only,
--      authenticated SELECT only, no anon access,
--      no UPDATE or DELETE from any client.
--   3. Exact GRANT EXECUTE on ingest_emqx_telemetry() with the
--      full PostgreSQL function signature for emqx_writer.
--   4. Idempotent pg_cron schedule for mark_stale_vehicles_offline.
--
-- SAFE TO RE-RUN: Yes (CREATE OR REPLACE, DROP POLICY IF EXISTS,
--                      idempotent cron schedule)
-- ============================================================

-- ============================================================
-- 1. Recreate ingest_emqx_telemetry with hardened search_path
-- ============================================================
CREATE OR REPLACE FUNCTION public.ingest_emqx_telemetry(
  p_device_id    TEXT,
  p_timestamp    TIMESTAMP WITH TIME ZONE,
  p_lat          NUMERIC,
  p_lng          NUMERIC,
  p_speed        NUMERIC,
  p_fuel         NUMERIC,
  p_temperature  NUMERIC,
  p_humidity     NUMERIC,
  p_engine_on    BOOLEAN,
  p_ignition     BOOLEAN,
  p_odometer     NUMERIC DEFAULT NULL,
  p_engine_hours NUMERIC DEFAULT NULL,
  p_location     TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vehicle_id   UUID;
  v_vehicle_row  RECORD;
  v_status       TEXT;
  v_settings_row RECORD;
  v_speed_int    INTEGER;
  v_fuel_int     INTEGER;
  v_humidity_int INTEGER;
BEGIN
  -- 1. Validate device_id
  IF p_device_id IS NULL OR p_device_id !~ '^\d{15}$' THEN
    INSERT INTO public.emqx_integration_errors(raw_device_id, error_type, error_detail)
    VALUES (p_device_id, 'INVALID_DEVICE_ID',
      'device_id must be exactly 15 numeric digits, got: ' || COALESCE(p_device_id, 'NULL'));
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_DEVICE_ID');
  END IF;

  -- 2. Validate coordinates
  IF p_lat IS NULL OR p_lat < -90 OR p_lat > 90 THEN
    INSERT INTO public.emqx_integration_errors(raw_device_id, error_type, error_detail)
    VALUES (p_device_id, 'INVALID_LAT',
      'latitude out of range: ' || COALESCE(p_lat::TEXT, 'NULL'));
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LAT');
  END IF;

  IF p_lng IS NULL OR p_lng < -180 OR p_lng > 180 THEN
    INSERT INTO public.emqx_integration_errors(raw_device_id, error_type, error_detail)
    VALUES (p_device_id, 'INVALID_LNG',
      'longitude out of range: ' || COALESCE(p_lng::TEXT, 'NULL'));
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LNG');
  END IF;

  -- 3. Validate speed
  IF p_speed IS NULL OR p_speed < 0 OR p_speed > 300 THEN
    INSERT INTO public.emqx_integration_errors(raw_device_id, error_type, error_detail)
    VALUES (p_device_id, 'INVALID_SPEED',
      'speed invalid: ' || COALESCE(p_speed::TEXT, 'NULL'));
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_SPEED');
  END IF;

  -- 4. Validate fuel
  IF p_fuel IS NULL OR p_fuel < 0 OR p_fuel > 100 THEN
    INSERT INTO public.emqx_integration_errors(raw_device_id, error_type, error_detail)
    VALUES (p_device_id, 'INVALID_FUEL',
      'fuel out of range: ' || COALESCE(p_fuel::TEXT, 'NULL'));
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_FUEL');
  END IF;

  -- 5. Validate timestamp
  IF p_timestamp IS NULL THEN
    INSERT INTO public.emqx_integration_errors(raw_device_id, error_type, error_detail)
    VALUES (p_device_id, 'INVALID_TIMESTAMP', 'timestamp is NULL');
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TIMESTAMP');
  END IF;

  IF p_timestamp > (timezone('utc', now()) + INTERVAL '5 minutes') THEN
    INSERT INTO public.emqx_integration_errors(raw_device_id, error_type, error_detail)
    VALUES (p_device_id, 'FUTURE_TIMESTAMP',
      'timestamp is too far in future: ' || p_timestamp::TEXT);
    RETURN jsonb_build_object('ok', false, 'error', 'FUTURE_TIMESTAMP');
  END IF;

  -- 6. Resolve device_id -> vehicle_id
  SELECT id, number, odometer, engine_hours
    INTO v_vehicle_row
    FROM public.vehicles
   WHERE device_id = p_device_id
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.emqx_integration_errors(raw_device_id, error_type, error_detail)
    VALUES (p_device_id, 'UNKNOWN_DEVICE',
      'No vehicle registered with device_id=' || p_device_id ||
      '. Register the vehicle first in the fleet management UI.');
    RETURN jsonb_build_object('ok', false, 'error', 'UNKNOWN_DEVICE', 'device_id', p_device_id);
  END IF;

  v_vehicle_id := v_vehicle_row.id;

  -- 7. Coerce types
  v_speed_int    := LEAST(GREATEST(ROUND(p_speed)::INTEGER, 0), 300);
  v_fuel_int     := LEAST(GREATEST(ROUND(p_fuel)::INTEGER, 0), 100);
  v_humidity_int := CASE
    WHEN p_humidity IS NULL THEN NULL
    ELSE LEAST(GREATEST(ROUND(p_humidity)::INTEGER, 0), 100)
  END;

  -- 8. Derive status
  IF v_speed_int > 0 THEN
    v_status := 'Moving';
  ELSIF p_engine_on = true OR p_ignition = true THEN
    v_status := 'Idle';
  ELSE
    v_status := 'Parked';
  END IF;

  -- 9. Upsert vehicle_telemetry (current state, 1 row per vehicle)
  INSERT INTO public.vehicle_telemetry (
    vehicle_id, status, lat, lng, speed, fuel, temperature, humidity,
    engine_on, ignition, location, odometer, engine_hours, last_update, updated_at
  ) VALUES (
    v_vehicle_id, v_status,
    ROUND(p_lat::NUMERIC, 6), ROUND(p_lng::NUMERIC, 6),
    v_speed_int, v_fuel_int,
    ROUND(p_temperature::NUMERIC, 1),
    v_humidity_int,
    COALESCE(p_engine_on, false), COALESCE(p_ignition, false),
    COALESCE(p_location, ''),
    p_odometer, p_engine_hours,
    p_timestamp, timezone('utc', now())
  )
  ON CONFLICT (vehicle_id) DO UPDATE SET
    status       = EXCLUDED.status,
    lat          = EXCLUDED.lat,
    lng          = EXCLUDED.lng,
    speed        = EXCLUDED.speed,
    fuel         = EXCLUDED.fuel,
    temperature  = EXCLUDED.temperature,
    humidity     = EXCLUDED.humidity,
    engine_on    = EXCLUDED.engine_on,
    ignition     = EXCLUDED.ignition,
    location     = EXCLUDED.location,
    odometer     = COALESCE(EXCLUDED.odometer, vehicle_telemetry.odometer),
    engine_hours = COALESCE(EXCLUDED.engine_hours, vehicle_telemetry.engine_hours),
    last_update  = EXCLUDED.last_update,
    updated_at   = EXCLUDED.updated_at;

  -- 10. Update master odometer if GPS value is higher
  IF p_odometer IS NOT NULL AND p_odometer > COALESCE(v_vehicle_row.odometer, 0) THEN
    UPDATE public.vehicles
       SET odometer = ROUND(p_odometer)::INTEGER,
           updated_at = timezone('utc', now())
     WHERE id = v_vehicle_id;
  END IF;

  -- 11. Append to telemetry_history
  INSERT INTO public.telemetry_history (
    vehicle_id, speed, fuel, temperature, humidity,
    lat, lng, engine_on, ignition, location,
    odometer, engine_hours, source, recorded_at
  ) VALUES (
    v_vehicle_id, v_speed_int, v_fuel_int,
    ROUND(p_temperature::NUMERIC, 1),
    v_humidity_int,
    ROUND(p_lat::NUMERIC, 6), ROUND(p_lng::NUMERIC, 6),
    COALESCE(p_engine_on, false), COALESCE(p_ignition, false),
    COALESCE(p_location, ''),
    p_odometer, p_engine_hours,
    'emqx',
    p_timestamp
  );

  -- 12. Alert generation (rate-limited to 1 per 30 min per vehicle per type)
  SELECT overspeed, fuel_alert INTO v_settings_row FROM public.settings LIMIT 1;

  -- Overspeed alert
  IF v_speed_int > COALESCE(v_settings_row.overspeed, 60) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.alerts
       WHERE vehicle_id = v_vehicle_id AND type = 'Safety'
         AND resolved = false
         AND time > (timezone('utc', now()) - INTERVAL '30 minutes')
    ) THEN
      INSERT INTO public.alerts (vehicle_id, type, severity, message, time, resolved)
      VALUES (v_vehicle_id, 'Safety', 'High',
        'Overspeed detected: ' || v_speed_int || ' km/h (limit: ' ||
        COALESCE(v_settings_row.overspeed, 60) || ' km/h)',
        timezone('utc', now()), false);
    END IF;
  END IF;

  -- Low fuel alert
  IF v_fuel_int <= COALESCE(v_settings_row.fuel_alert, 25) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.alerts
       WHERE vehicle_id = v_vehicle_id AND type = 'Fuel'
         AND resolved = false
         AND time > (timezone('utc', now()) - INTERVAL '30 minutes')
    ) THEN
      INSERT INTO public.alerts (vehicle_id, type, severity, message, time, resolved)
      VALUES (v_vehicle_id, 'Fuel',
        CASE WHEN v_fuel_int <= 10 THEN 'High' ELSE 'Medium' END,
        'Low fuel: ' || v_fuel_int || '% remaining',
        timezone('utc', now()), false);
    END IF;
  END IF;

  -- Temperature alert (cold chain)
  IF p_temperature IS NOT NULL AND (p_temperature < 0 OR p_temperature > 10) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.alerts
       WHERE vehicle_id = v_vehicle_id AND type = 'Temperature'
         AND resolved = false
         AND time > (timezone('utc', now()) - INTERVAL '30 minutes')
    ) THEN
      INSERT INTO public.alerts (vehicle_id, type, severity, message, time, resolved)
      VALUES (v_vehicle_id, 'Temperature',
        CASE WHEN p_temperature < -2 OR p_temperature > 15 THEN 'High' ELSE 'Medium' END,
        'Temperature alert: ' || ROUND(p_temperature::NUMERIC, 1) || 'C (cold chain threshold exceeded)',
        timezone('utc', now()), false);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'vehicle_id', v_vehicle_id,
    'status', v_status, 'device_id', p_device_id
  );

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.emqx_integration_errors(raw_device_id, error_type, error_detail)
  VALUES (p_device_id, 'EXCEPTION', SQLERRM);
  RETURN jsonb_build_object('ok', false, 'error', 'EXCEPTION', 'detail', SQLERRM);
END;
$$;

-- ============================================================
-- 2. Recreate mark_stale_vehicles_offline with hardened search_path
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_stale_vehicles_offline(
  p_threshold_secs INT DEFAULT 120
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE public.vehicle_telemetry
     SET status = 'Offline', updated_at = timezone('utc', now())
   WHERE status != 'Offline'
     AND last_update < (timezone('utc', now()) - make_interval(secs => p_threshold_secs));
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.mark_stale_vehicles_offline IS
  'Marks vehicle_telemetry rows Offline when last_update exceeds threshold. '
  'SECURITY DEFINER with search_path = public, pg_temp. '
  'Schedule: SELECT cron.schedule(stale_vehicle_check, */2 * * * *, '
  '$$SELECT public.mark_stale_vehicles_offline(120);$$);';

-- ============================================================
-- 3. Harden emqx_integration_errors RLS (least privilege)
--
--    Old policy was: FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)
--    New policy:
--      emqx_writer: INSERT only (errors written by the stored procedure)
--      authenticated: SELECT only (for admin observability in the dashboard)
--      anon: NO access
--      Nobody: UPDATE or DELETE (errors are immutable audit records)
-- ============================================================

-- Drop all existing broad policies on this table
DROP POLICY IF EXISTS "allow_all_emqx_integration_errors" ON public.emqx_integration_errors;

-- Revoke the broad GRANT ALL that was set in the previous migration
REVOKE ALL ON public.emqx_integration_errors FROM anon;
REVOKE ALL ON public.emqx_integration_errors FROM authenticated;
REVOKE ALL ON SEQUENCE public.emqx_integration_errors_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.emqx_integration_errors_id_seq FROM authenticated;

-- Grant only SELECT to authenticated users (admin/manager observability)
GRANT SELECT ON public.emqx_integration_errors TO authenticated;

-- emqx_writer INSERT handled via GRANT EXECUTE on the function (SECURITY DEFINER).
-- The function runs as its owner (postgres/superuser), not as emqx_writer,
-- so emqx_writer does NOT need direct INSERT on this table when using the function.
-- The direct-INSERT grant below is only needed if EMQX uses the raw INSERT action
-- (Option A in the EMQX configuration guide) instead of the stored procedure.
-- GRANT INSERT ON public.emqx_integration_errors TO emqx_writer;  -- only for raw INSERT

-- RLS SELECT policy: authenticated users can view integration errors
CREATE POLICY "emqx_errors_select_authenticated"
  ON public.emqx_integration_errors
  FOR SELECT TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policies for anon or authenticated:
-- Writes come only from the SECURITY DEFINER stored procedure (runs as owner).

-- ============================================================
-- 4. Exact GRANT EXECUTE for emqx_writer with full function signature
--
--    Must match the actual PostgreSQL function signature exactly.
--    The 13-parameter variant is the one EMQX calls.
-- ============================================================

-- Remove broad execute grant from previous migration and re-grant precisely
REVOKE EXECUTE ON FUNCTION public.ingest_emqx_telemetry(
  TEXT, TIMESTAMP WITH TIME ZONE, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  NUMERIC, NUMERIC, BOOLEAN, BOOLEAN, NUMERIC, NUMERIC, TEXT
) FROM authenticated;

-- Note: emqx_writer role must be created manually before this grant will work.
-- Run CREATE ROLE emqx_writer ... first in Supabase SQL Editor (see Section 6
-- of the integration report). This GRANT is idempotent once the role exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'emqx_writer') THEN
    EXECUTE $grant$
      GRANT EXECUTE ON FUNCTION public.ingest_emqx_telemetry(
        TEXT, TIMESTAMP WITH TIME ZONE, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
        NUMERIC, NUMERIC, BOOLEAN, BOOLEAN, NUMERIC, NUMERIC, TEXT
      ) TO emqx_writer;

      GRANT EXECUTE ON FUNCTION public.mark_stale_vehicles_offline(INT)
        TO emqx_writer;

      -- emqx_writer also needs SELECT on vehicles and settings (for lookups inside the function)
      GRANT SELECT ON public.vehicles TO emqx_writer;
      GRANT SELECT ON public.settings TO emqx_writer;
      -- Sequence access for telemetry_history and alerts (INSERT inside SECURITY DEFINER)
      GRANT USAGE, SELECT ON SEQUENCE public.telemetry_history_id_seq TO emqx_writer;
      GRANT USAGE, SELECT ON SEQUENCE public.alerts_id_seq TO emqx_writer;
      GRANT USAGE, SELECT ON SEQUENCE public.emqx_integration_errors_id_seq TO emqx_writer;
    $grant$;
    RAISE NOTICE 'emqx_writer role found: GRANT EXECUTE applied';
  ELSE
    RAISE NOTICE 'emqx_writer role does not yet exist. Create it manually and re-run this migration.';
  END IF;
END $$;

-- ============================================================
-- 5. Idempotent pg_cron setup for stale vehicle detection
--
--    Checks whether pg_cron extension is installed before scheduling.
--    Safe to run multiple times: removes existing job by name first.
-- ============================================================
DO $$
BEGIN
  -- Only proceed if pg_cron extension is available
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    -- Remove existing job with this name (prevents duplicates on re-run)
    IF EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'stale_vehicle_check'
    ) THEN
      PERFORM cron.unschedule('stale_vehicle_check');
      RAISE NOTICE 'Removed existing stale_vehicle_check cron job';
    END IF;

    -- Schedule new job: run every 2 minutes
    PERFORM cron.schedule(
      'stale_vehicle_check',
      '*/2 * * * *',
      $job$SELECT public.mark_stale_vehicles_offline(120);$job$
    );
    RAISE NOTICE 'pg_cron: stale_vehicle_check scheduled (*/2 * * * *)';
  ELSE
    RAISE NOTICE 'pg_cron extension not installed. To enable automatic stale detection, install pg_cron in Supabase Dashboard under Database > Extensions.';
  END IF;
END $$;

-- ============================================================
-- 6. Confirm Realtime publication includes vehicle_telemetry
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'vehicle_telemetry'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_telemetry;
    RAISE NOTICE 'Added vehicle_telemetry to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'vehicle_telemetry is already in supabase_realtime publication';
  END IF;
END $$;

-- ============================================================
-- END OF HARDENING MIGRATION
-- ============================================================
