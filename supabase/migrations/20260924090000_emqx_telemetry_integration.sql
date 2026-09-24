-- ============================================================
-- Migration: EMQX Cloud -> Supabase Telemetry Integration
-- Date: 2026-09-24
-- Version: 20260924090000
--
-- PURPOSE:
--   Prepare the Supabase/PostgreSQL schema to receive MQTT
--   telemetry data forwarded by EMQX Cloud via its PostgreSQL
--   connector, and expose live changes through Supabase Realtime.
--
-- ARCHITECTURE:
--   IoT Device -> MQTT -> EMQX Cloud Rule Engine
--     -> PostgreSQL Connector -> Supabase PostgreSQL
--     -> vehicle_telemetry (current state, 1 row/vehicle)
--     -> telemetry_history (append-only event stream)
--     -> Supabase Realtime -> React Fleet UI
--
-- SAFE TO RE-RUN: Yes (all DDL uses IF NOT EXISTS / OR REPLACE)
-- ============================================================

-- ============================================================
-- 1. Extend telemetry_history with GPS + engine columns
-- ============================================================
ALTER TABLE public.telemetry_history
  ADD COLUMN IF NOT EXISTS lat           NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS lng           NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS engine_on     BOOLEAN,
  ADD COLUMN IF NOT EXISTS ignition      BOOLEAN,
  ADD COLUMN IF NOT EXISTS location      TEXT,
  ADD COLUMN IF NOT EXISTS odometer      NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS engine_hours  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS source        TEXT DEFAULT 'emqx';

-- ============================================================
-- 2. Extend vehicle_telemetry with odometer + engine_hours
-- ============================================================
ALTER TABLE public.vehicle_telemetry
  ADD COLUMN IF NOT EXISTS odometer      NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS engine_hours  NUMERIC(10,2);

-- ============================================================
-- 3. EMQX dedicated DB user (MANUAL STEP - see comment)
--
-- Run this block manually in Supabase SQL Editor:
--
-- CREATE ROLE emqx_writer WITH LOGIN PASSWORD '<STRONG_RANDOM_PASSWORD>';
-- GRANT USAGE ON SCHEMA public TO emqx_writer;
-- GRANT SELECT ON public.vehicles TO emqx_writer;
-- GRANT INSERT, UPDATE ON public.vehicle_telemetry TO emqx_writer;
-- GRANT INSERT ON public.telemetry_history TO emqx_writer;
-- GRANT INSERT ON public.alerts TO emqx_writer;
-- GRANT USAGE, SELECT ON SEQUENCE public.telemetry_history_id_seq TO emqx_writer;
-- GRANT USAGE, SELECT ON SEQUENCE public.alerts_id_seq TO emqx_writer;
-- GRANT USAGE, SELECT ON SEQUENCE public.emqx_integration_errors_id_seq TO emqx_writer;
-- GRANT INSERT ON public.emqx_integration_errors TO emqx_writer;
-- ============================================================

-- ============================================================
-- 4a. Create integration error log table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.emqx_integration_errors (
  id            BIGSERIAL PRIMARY KEY,
  received_at   TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
  raw_device_id TEXT,
  error_type    TEXT NOT NULL,
  error_detail  TEXT,
  raw_payload   JSONB
);

COMMENT ON TABLE public.emqx_integration_errors IS
  'Captures EMQX telemetry ingestion failures for observability. Contains NO secrets or credentials.';

CREATE INDEX IF NOT EXISTS idx_emqx_errors_received_at
  ON public.emqx_integration_errors(received_at DESC);

-- ============================================================
-- 4b. Main ingestion stored procedure
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
    VALUES (p_device_id, 'INVALID_LAT', 'latitude out of range: ' || COALESCE(p_lat::TEXT, 'NULL'));
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LAT');
  END IF;

  IF p_lng IS NULL OR p_lng < -180 OR p_lng > 180 THEN
    INSERT INTO public.emqx_integration_errors(raw_device_id, error_type, error_detail)
    VALUES (p_device_id, 'INVALID_LNG', 'longitude out of range: ' || COALESCE(p_lng::TEXT, 'NULL'));
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LNG');
  END IF;

  -- 3. Validate speed
  IF p_speed IS NULL OR p_speed < 0 OR p_speed > 300 THEN
    INSERT INTO public.emqx_integration_errors(raw_device_id, error_type, error_detail)
    VALUES (p_device_id, 'INVALID_SPEED', 'speed invalid: ' || COALESCE(p_speed::TEXT, 'NULL'));
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_SPEED');
  END IF;

  -- 4. Validate fuel
  IF p_fuel IS NULL OR p_fuel < 0 OR p_fuel > 100 THEN
    INSERT INTO public.emqx_integration_errors(raw_device_id, error_type, error_detail)
    VALUES (p_device_id, 'INVALID_FUEL', 'fuel out of range: ' || COALESCE(p_fuel::TEXT, 'NULL'));
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
    VALUES (p_device_id, 'FUTURE_TIMESTAMP', 'timestamp is too far in future: ' || p_timestamp::TEXT);
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

  -- 10. Update master odometer if hardware value is newer/higher
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

  -- 12. Alert generation (telemetry-driven, rate-limited to 1 per 30 min)
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

  -- Temperature alert (cold chain: flag if outside -2 to 10 degC)
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

COMMENT ON FUNCTION public.ingest_emqx_telemetry IS
  'Called by EMQX PostgreSQL connector to ingest MQTT telemetry. '
  'Validates payload, resolves device->vehicle, upserts live telemetry, '
  'appends history, and generates telemetry-driven alerts. '
  'Rejects unknown devices and invalid payloads safely.';

-- ============================================================
-- 5. Stale-telemetry mark function (call via pg_cron every 2 min)
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_stale_vehicles_offline(
  p_threshold_secs INT DEFAULT 120
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
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
  'Schedule via Supabase pg_cron: SELECT cron.schedule(stale_check, */2 * * * *, SELECT public.mark_stale_vehicles_offline(120));';

-- ============================================================
-- 6. Ensure Realtime publications include new tables
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND tablename = 'vehicle_telemetry'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_telemetry;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND tablename = 'emqx_integration_errors'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.emqx_integration_errors;
  END IF;
END $$;

-- ============================================================
-- 7. RLS for new tables
-- ============================================================
ALTER TABLE public.emqx_integration_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_emqx_integration_errors" ON public.emqx_integration_errors;
CREATE POLICY "allow_all_emqx_integration_errors"
  ON public.emqx_integration_errors
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- ============================================================
-- 8. Grants
-- ============================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON public.emqx_integration_errors TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.emqx_integration_errors_id_seq TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_emqx_telemetry TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stale_vehicles_offline TO authenticated;

-- ============================================================
-- 9. Recreate v_vehicles view with new live_odometer + live_engine_hours
-- ============================================================
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
    COALESCE(vt.odometer, v.odometer::NUMERIC) AS live_odometer,
    COALESCE(vt.engine_hours, v.engine_hours) AS live_engine_hours,
    COALESCE(vt.last_update, timezone('utc'::text, now())) AS last_update,
    d.name AS driver_name,
    d.id AS driver_id
FROM public.vehicles v
LEFT JOIN public.vehicle_telemetry vt ON v.id = vt.vehicle_id
LEFT JOIN public.vehicle_assignments va ON v.id = va.vehicle_id AND va.is_active = true
LEFT JOIN public.drivers d ON va.driver_id = d.id;

GRANT SELECT ON public.v_vehicles TO anon, authenticated;

-- ============================================================
-- 10. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_telemetry_history_source
  ON public.telemetry_history(source, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_history_vehicle_source
  ON public.telemetry_history(vehicle_id, source, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_vehicles_device_id
  ON public.vehicles(device_id)
  WHERE device_id IS NOT NULL;

-- ============================================================
-- END OF MIGRATION
-- ============================================================
