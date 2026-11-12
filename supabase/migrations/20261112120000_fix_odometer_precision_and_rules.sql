-- Migration: Fix Odometer Calculation, Persistence Precision, and Database RPC Rules
-- Date: 2026-11-12
-- Version: 20261112120000

-- 1. Ensure vehicles table supports decimal kilometres (NUMERIC(12, 2))
DROP VIEW IF EXISTS public.v_vehicles CASCADE;

ALTER TABLE public.vehicles 
  ALTER COLUMN odometer TYPE NUMERIC(12, 2) USING odometer::numeric;

-- Recreate public.v_vehicles view
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

GRANT SELECT ON public.v_vehicles TO anon, authenticated;

-- 2. Ensure vehicle_odometers table exists and supports decimal precision
CREATE TABLE IF NOT EXISTS public.vehicle_odometers (
  vehicle_id                  UUID PRIMARY KEY REFERENCES public.vehicles(id) ON DELETE CASCADE,
  device_id                   TEXT,
  total_odometer_km           NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  today_distance_km           NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  current_trip_distance_km    NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  current_speed_kmh           NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
  reading_source              TEXT NOT NULL DEFAULT 'gps_estimated' CHECK (reading_source IN ('hardware', 'gps_estimated')),
  today_date                  TEXT NOT NULL,
  is_moving                   BOOLEAN NOT NULL DEFAULT false,
  previous_latitude           NUMERIC(9, 6),
  previous_longitude          NUMERIC(9, 6),
  previous_gps_timestamp      TIMESTAMP WITH TIME ZONE,
  last_processed_telemetry_id TEXT,
  last_valid_lat              NUMERIC(9, 6),
  last_valid_lng              NUMERIC(9, 6),
  last_telemetry_id           TEXT,
  last_telemetry_time         TIMESTAMP WITH TIME ZONE,
  updated_at                  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
  last_updated_at             TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
  created_at                  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vehicle_odometers_device_id ON public.vehicle_odometers(device_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_odometers_updated_at ON public.vehicle_odometers(updated_at DESC);

ALTER TABLE public.vehicle_odometers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Allow read vehicle_odometers" ON public.vehicle_odometers FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Allow insert vehicle_odometers" ON public.vehicle_odometers FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Allow update vehicle_odometers" ON public.vehicle_odometers FOR UPDATE USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Reconcile existing states: if reading_source is 'hardware' but total_odometer_km equals baseline, revert to 'gps_estimated'
UPDATE public.vehicle_odometers
SET reading_source = 'gps_estimated'
WHERE reading_source = 'hardware'
  AND total_odometer_km <= (SELECT COALESCE(odometer, 0.00) FROM public.vehicles WHERE id = vehicle_odometers.vehicle_id);

-- 4. Corrected atomic accumulate_gps_odometer RPC function
CREATE OR REPLACE FUNCTION public.accumulate_gps_odometer(
  p_vehicle_id UUID,
  p_device_id TEXT,
  p_lat NUMERIC,
  p_lng NUMERIC,
  p_speed NUMERIC,
  p_recorded_at TIMESTAMP WITH TIME ZONE,
  p_telemetry_id TEXT,
  p_hardware_odometer NUMERIC,
  p_ist_today_date TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec public.vehicle_odometers%ROWTYPE;
  v_base_odo NUMERIC := 0.00;
  v_dist_km NUMERIC := 0.00;
  v_is_moving BOOLEAN := false;
  v_hardware_updated BOOLEAN := false;
  v_prev_ms DOUBLE PRECISION;
  v_curr_ms DOUBLE PRECISION;
  v_diff_sec DOUBLE PRECISION;
  v_gap_mins DOUBLE PRECISION;
  v_rad_lat1 DOUBLE PRECISION;
  v_rad_lat2 DOUBLE PRECISION;
  v_dlat DOUBLE PRECISION;
  v_dlon DOUBLE PRECISION;
  v_a DOUBLE PRECISION;
  v_c DOUBLE PRECISION;
  v_pi CONSTANT DOUBLE PRECISION := 3.141592653589793;
BEGIN
  -- 1. Fetch existing vehicle_odometers state or create initial row from vehicles baseline
  SELECT * INTO v_rec FROM public.vehicle_odometers WHERE vehicle_id = p_vehicle_id FOR UPDATE;

  IF NOT FOUND THEN
    SELECT COALESCE(odometer, 0.00) INTO v_base_odo FROM public.vehicles WHERE id = p_vehicle_id;
    INSERT INTO public.vehicle_odometers (
      vehicle_id,
      device_id,
      total_odometer_km,
      today_distance_km,
      current_trip_distance_km,
      current_speed_kmh,
      reading_source,
      today_date,
      is_moving,
      previous_latitude,
      previous_longitude,
      previous_gps_timestamp,
      last_processed_telemetry_id,
      last_valid_lat,
      last_valid_lng,
      last_telemetry_id,
      last_telemetry_time,
      updated_at,
      last_updated_at
    ) VALUES (
      p_vehicle_id,
      p_device_id,
      v_base_odo,
      0.00,
      0.00,
      COALESCE(p_speed, 0.00),
      CASE WHEN p_hardware_odometer IS NOT NULL AND p_hardware_odometer > 0 THEN 'hardware' ELSE 'gps_estimated' END,
      p_ist_today_date,
      (COALESCE(p_speed, 0.00) > 3.0),
      p_lat,
      p_lng,
      p_recorded_at,
      p_telemetry_id,
      p_lat,
      p_lng,
      p_telemetry_id,
      p_recorded_at,
      timezone('utc', now()),
      timezone('utc', now())
    ) RETURNING * INTO v_rec;

    RETURN to_jsonb(v_rec);
  END IF;

  -- 2. Deduplication: ignore if identical telemetry ID or older timestamp
  IF p_telemetry_id IS NOT NULL AND v_rec.last_processed_telemetry_id = p_telemetry_id THEN
    RETURN to_jsonb(v_rec);
  END IF;

  IF p_recorded_at IS NOT NULL AND v_rec.previous_gps_timestamp IS NOT NULL AND p_recorded_at <= v_rec.previous_gps_timestamp THEN
    RETURN to_jsonb(v_rec);
  END IF;

  -- 3. Daily rollover check (Asia/Kolkata date)
  IF v_rec.today_date <> p_ist_today_date THEN
    v_rec.today_date := p_ist_today_date;
    v_rec.today_distance_km := 0.00;
  END IF;

  -- 4. Check moving status
  v_is_moving := (COALESCE(p_speed, 0.00) > 3.0);
  v_rec.is_moving := v_is_moving;
  v_rec.current_speed_kmh := COALESCE(p_speed, 0.00);

  -- 5. Priority 1: Genuine Hardware Odometer Telemetry
  IF p_hardware_odometer IS NOT NULL AND p_hardware_odometer > 0 THEN
    IF p_hardware_odometer >= v_rec.total_odometer_km THEN
      v_rec.today_distance_km := ROUND((v_rec.today_distance_km + (p_hardware_odometer - v_rec.total_odometer_km))::numeric, 2);
      v_rec.current_trip_distance_km := ROUND((v_rec.current_trip_distance_km + (p_hardware_odometer - v_rec.total_odometer_km))::numeric, 2);
      v_rec.total_odometer_km := ROUND(p_hardware_odometer::numeric, 2);
      v_rec.reading_source := 'hardware';
      v_hardware_updated := true;
    END IF;
  ELSE
    -- If hardware is unavailable, fallback to gps_estimated without resetting cumulative total
    IF v_rec.reading_source = 'hardware' THEN
      v_rec.reading_source := 'gps_estimated';
    END IF;
  END IF;

  -- 6. GPS Movement & Distance Accumulation
  IF v_is_moving AND p_lat IS NOT NULL AND p_lng IS NOT NULL AND v_rec.previous_latitude IS NOT NULL AND v_rec.previous_longitude IS NOT NULL THEN
    IF p_lat >= -90 AND p_lat <= 90 AND p_lng >= 50 AND p_lng <= 105 THEN
      v_curr_ms := EXTRACT(EPOCH FROM p_recorded_at);
      v_prev_ms := EXTRACT(EPOCH FROM v_rec.previous_gps_timestamp);
      v_diff_sec := GREATEST(0.0, v_curr_ms - v_prev_ms);
      v_gap_mins := v_diff_sec / 60.0;

      IF v_gap_mins > 15.0 THEN
        v_rec.current_trip_distance_km := 0.00;
        v_dist_km := 0.00;
      ELSE
        v_rad_lat1 := (v_rec.previous_latitude * v_pi) / 180.0;
        v_rad_lat2 := (p_lat * v_pi) / 180.0;
        v_dlat := ((p_lat - v_rec.previous_latitude) * v_pi) / 180.0;
        v_dlon := ((p_lng - v_rec.previous_longitude) * v_pi) / 180.0;

        v_a := (sin(v_dlat / 2.0) ^ 2) + cos(v_rad_lat1) * cos(v_rad_lat2) * (sin(v_dlon / 2.0) ^ 2);
        v_c := 2.0 * atan2(sqrt(v_a), sqrt(GREATEST(0.0, 1.0 - v_a)));
        v_dist_km := 6371.0 * v_c;

        IF v_dist_km < 0.005 THEN
          v_dist_km := 0.00;
        ELSIF v_dist_km > 200.0 OR (v_diff_sec > 0 AND (v_dist_km / (v_diff_sec / 3600.0)) > 160.0) THEN
          v_dist_km := 0.00;
        END IF;
      END IF;

      -- Add validated GPS distance if hardware odometer did not update in this packet
      IF v_dist_km > 0.00 THEN
        IF NOT v_hardware_updated THEN
          v_rec.total_odometer_km := ROUND((v_rec.total_odometer_km + v_dist_km)::numeric, 2);
          v_rec.today_distance_km := ROUND((v_rec.today_distance_km + v_dist_km)::numeric, 2);
          v_rec.current_trip_distance_km := ROUND((v_rec.current_trip_distance_km + v_dist_km)::numeric, 2);
        END IF;
      END IF;
    END IF;
  END IF;

  -- 7. Update tracking coordinates
  IF p_lat IS NOT NULL AND p_lng IS NOT NULL AND p_lat >= -90 AND p_lat <= 90 AND p_lng >= 50 AND p_lng <= 105 THEN
    v_rec.previous_latitude := p_lat;
    v_rec.previous_longitude := p_lng;
    v_rec.last_valid_lat := p_lat;
    v_rec.last_valid_lng := p_lng;
  END IF;

  v_rec.previous_gps_timestamp := COALESCE(p_recorded_at, timezone('utc', now()));
  v_rec.last_telemetry_time := v_rec.previous_gps_timestamp;
  v_rec.last_processed_telemetry_id := p_telemetry_id;
  v_rec.last_telemetry_id := p_telemetry_id;
  v_rec.device_id := COALESCE(p_device_id, v_rec.device_id);
  v_rec.updated_at := timezone('utc', now());
  v_rec.last_updated_at := v_rec.updated_at;

  -- 8. Write back to database
  UPDATE public.vehicle_odometers
  SET
    device_id = v_rec.device_id,
    total_odometer_km = v_rec.total_odometer_km,
    today_distance_km = v_rec.today_distance_km,
    current_trip_distance_km = v_rec.current_trip_distance_km,
    current_speed_kmh = v_rec.current_speed_kmh,
    reading_source = v_rec.reading_source,
    today_date = v_rec.today_date,
    is_moving = v_rec.is_moving,
    previous_latitude = v_rec.previous_latitude,
    previous_longitude = v_rec.previous_longitude,
    previous_gps_timestamp = v_rec.previous_gps_timestamp,
    last_processed_telemetry_id = v_rec.last_processed_telemetry_id,
    last_valid_lat = v_rec.last_valid_lat,
    last_valid_lng = v_rec.last_valid_lng,
    last_telemetry_id = v_rec.last_telemetry_id,
    last_telemetry_time = v_rec.last_telemetry_time,
    updated_at = v_rec.updated_at,
    last_updated_at = v_rec.last_updated_at
  WHERE vehicle_id = p_vehicle_id;

  -- 9. Sync canonical vehicles.odometer preserving 2 decimal precision
  UPDATE public.vehicles
  SET odometer = v_rec.total_odometer_km
  WHERE id = p_vehicle_id AND v_rec.total_odometer_km > COALESCE(odometer, 0.00);

  RETURN to_jsonb(v_rec);
END;
$$;

