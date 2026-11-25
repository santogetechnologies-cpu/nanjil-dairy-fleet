-- =============================================================================
-- Migration: Driver Vehicle Operation Statement, Validation & Atomic Odometer RPCs
-- Date: 2026-11-25
-- Version: 20261125150000
--
-- Features & Security Guarantees:
--   1. Reuses public.vehicles (canonical `odometer` field, no duplicate column)
--      and extends it only with metadata (`odometer_source`, `odometer_updated_at`).
--   2. Extends public.trips with Nanjil Dairy Vehicle Operation Statement fields
--      (salesman_name, out_date, in_date, out_time, in_time, started_at, closed_at,
--       diesel_liters, fuel_amount, kmpl, odometer_updated_source, closed_by_profile_id, notes).
--   3. Enforces at most ONE active ('Ongoing') trip per vehicle via partial unique index.
--   4. Creates public.odometer_audit_logs for immutable odometer change history.
--   5. Provides hardened SECURITY DEFINER RPCs (SET search_path = public, pg_temp):
--        - public.start_driver_trip_statement
--        - public.close_driver_trip_statement
--        - public.log_driver_fuel_refill
--   6. Revokes anonymous writes on operational trip/odometer tables & locks RPC
--      execution strictly to authenticated users with server-side ownership checks.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extend public.vehicles (preserve single canonical `odometer` column and
--    keep dependent views such as v_fuel_efficiency_by_vehicle & v_vehicles intact)
-- -----------------------------------------------------------------------------
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS odometer_source TEXT,
  ADD COLUMN IF NOT EXISTS odometer_updated_at TIMESTAMP WITH TIME ZONE;

-- -----------------------------------------------------------------------------
-- 2. Extend public.trips for Nanjil Dairy Vehicle Operation Statement
-- -----------------------------------------------------------------------------
ALTER TABLE public.trips
  ALTER COLUMN start_km TYPE NUMERIC(12, 2) USING start_km::NUMERIC(12, 2),
  ALTER COLUMN end_km TYPE NUMERIC(12, 2) USING end_km::NUMERIC(12, 2);

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS salesman_name TEXT,
  ADD COLUMN IF NOT EXISTS out_date DATE,
  ADD COLUMN IF NOT EXISTS in_date DATE,
  ADD COLUMN IF NOT EXISTS out_time TEXT,
  ADD COLUMN IF NOT EXISTS in_time TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS diesel_liters NUMERIC(10, 2) DEFAULT 0 CHECK (diesel_liters >= 0),
  ADD COLUMN IF NOT EXISTS fuel_amount NUMERIC(12, 2) DEFAULT 0 CHECK (fuel_amount >= 0),
  ADD COLUMN IF NOT EXISTS kmpl NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS odometer_updated_source TEXT,
  ADD COLUMN IF NOT EXISTS closed_by_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Prevent multiple concurrent active trips on the same vehicle at DB level
CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_one_active_per_vehicle
  ON public.trips (vehicle_id)
  WHERE status = 'Ongoing' AND vehicle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trips_driver_status_date
  ON public.trips (driver_id, status, date DESC);

-- -----------------------------------------------------------------------------
-- 3. Immutable Odometer Audit Logs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.odometer_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE NOT NULL,
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  actor_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  previous_odometer NUMERIC(12, 2) NOT NULL CHECK (previous_odometer >= 0),
  new_odometer NUMERIC(12, 2) NOT NULL CHECK (new_odometer >= 0),
  running_km NUMERIC(12, 2),
  source TEXT NOT NULL CHECK (source IN ('DRIVER_TRIP_CLOSURE', 'HARDWARE_GPS', 'ADMIN_MANUAL', 'FUEL_LOG')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_odometer_audit_vehicle_created
  ON public.odometer_audit_logs (vehicle_id, created_at DESC);

ALTER TABLE public.odometer_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read odometer_audit_logs" ON public.odometer_audit_logs;
CREATE POLICY "Allow authenticated read odometer_audit_logs"
  ON public.odometer_audit_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.status = 'Active'
        AND p.role IN ('admin', 'manager')
    )
    OR driver_id IN (
      SELECT d.id FROM public.drivers d WHERE d.profile_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- 4. Tighten RLS on public.trips and public.vehicles (no anonymous writes)
-- -----------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.trips FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.vehicles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.odometer_audit_logs FROM anon, authenticated;

DROP POLICY IF EXISTS "allow_all_trips" ON public.trips;
DROP POLICY IF EXISTS "Allow select trips for all" ON public.trips;
DROP POLICY IF EXISTS "Allow insert trips for all" ON public.trips;
DROP POLICY IF EXISTS "Allow update trips for all" ON public.trips;
DROP POLICY IF EXISTS "Allow delete trips for all" ON public.trips;
DROP POLICY IF EXISTS "Authenticated select trips" ON public.trips;
DROP POLICY IF EXISTS "Admin manager manage trips" ON public.trips;

CREATE POLICY "Authenticated select trips"
  ON public.trips
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.status = 'Active'
        AND p.role IN ('admin', 'manager')
    )
    OR driver_id IN (
      SELECT d.id FROM public.drivers d WHERE d.profile_id = auth.uid()
    )
    OR vehicle_id IN (
      SELECT va.vehicle_id
      FROM public.vehicle_assignments va
      JOIN public.drivers d ON d.id = va.driver_id
      WHERE d.profile_id = auth.uid() AND va.is_active = true
    )
  );

-- Only active Admin/Manager may directly write trips outside validated driver RPCs
CREATE POLICY "Admin manager manage trips"
  ON public.trips
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.status = 'Active'
        AND p.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.status = 'Active'
        AND p.role IN ('admin', 'manager')
    )
  );

DROP POLICY IF EXISTS "allow_all_vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Authenticated read vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Admin manager update vehicles" ON public.vehicles;

CREATE POLICY "Authenticated read vehicles"
  ON public.vehicles
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin manager update vehicles"
  ON public.vehicles
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.status = 'Active'
        AND p.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.status = 'Active'
        AND p.role IN ('admin', 'manager')
    )
  );

-- -----------------------------------------------------------------------------
-- 5. Internal Helper: Resolve Authoritative Driver for auth.uid()
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._resolve_authenticated_driver()
RETURNS public.drivers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_driver public.drivers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required. Please log in as a driver.';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found.';
  END IF;

  IF v_profile.status <> 'Active' THEN
    RAISE EXCEPTION 'Account is inactive. Please contact fleet administration.';
  END IF;

  IF v_profile.role <> 'driver' THEN
    RAISE EXCEPTION 'Unauthorized: Driver account role required.';
  END IF;

  SELECT * INTO v_driver FROM public.drivers WHERE profile_id = v_uid LIMIT 1;
  IF NOT FOUND THEN
    -- Safe legacy fallback ONLY when profile_id is still NULL and exact name matches
    SELECT * INTO v_driver
    FROM public.drivers
    WHERE profile_id IS NULL
      AND LOWER(TRIM(name)) = LOWER(TRIM(v_profile.name))
    ORDER BY created_at ASC
    LIMIT 1;

    IF FOUND THEN
      UPDATE public.drivers
      SET profile_id = v_uid, updated_at = timezone('utc', now())
      WHERE id = v_driver.id AND profile_id IS NULL;
      v_driver.profile_id := v_uid;
    END IF;
  END IF;

  IF v_driver.id IS NULL THEN
    RAISE EXCEPTION 'No driver record is linked to your profile.';
  END IF;

  RETURN v_driver;
END;
$$;

REVOKE ALL ON FUNCTION public._resolve_authenticated_driver() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. RPC: start_driver_trip_statement
--    Starts a trip on the driver's actively assigned vehicle, capturing
--    authoritative Out KM directly on the server (never trusting client input).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_driver_trip_statement(
  p_vehicle_id UUID,
  p_route TEXT DEFAULT NULL,
  p_route_id UUID DEFAULT NULL,
  p_salesman_name TEXT DEFAULT NULL,
  p_out_date DATE DEFAULT NULL,
  p_out_time TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver public.drivers%ROWTYPE;
  v_vehicle public.vehicles%ROWTYPE;
  v_now_ist TIMESTAMP := timezone('Asia/Kolkata', now());
  v_out_date DATE := COALESCE(p_out_date, v_now_ist::DATE);
  v_out_time TEXT := COALESCE(NULLIF(TRIM(p_out_time), ''), to_char(v_now_ist, 'HH24:MI'));
  v_started_at TIMESTAMP WITH TIME ZONE;
  v_hw_telemetry_odo NUMERIC := 0;
  v_hw_history_odo NUMERIC := 0;
  v_out_km NUMERIC(12, 2) := 0;
  v_route_label TEXT;
  v_start_place TEXT;
  v_dest_place TEXT;
  v_new_trip public.trips%ROWTYPE;
  v_is_assigned BOOLEAN := false;
BEGIN
  -- 1. Authenticate caller & resolve driver
  v_driver := public._resolve_authenticated_driver();

  IF p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Vehicle ID is required to start a trip.';
  END IF;

  -- 2. Verify driver-to-vehicle active assignment
  SELECT EXISTS (
    SELECT 1 FROM public.vehicle_assignments
    WHERE vehicle_id = p_vehicle_id
      AND driver_id = v_driver.id
      AND is_active = true
  ) INTO v_is_assigned;

  IF NOT v_is_assigned THEN
    RAISE EXCEPTION 'Unauthorized: You are not assigned to this vehicle.';
  END IF;

  -- 3. Lock vehicle row exclusively for atomic trip start check
  SELECT * INTO v_vehicle FROM public.vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assigned vehicle not found.';
  END IF;

  -- 4. Reject if vehicle OR driver already has an Ongoing trip
  IF EXISTS (
    SELECT 1 FROM public.trips
    WHERE vehicle_id = p_vehicle_id AND status = 'Ongoing'
  ) THEN
    RAISE EXCEPTION 'An active trip is already in progress for this vehicle. Please close the open trip first.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.trips
    WHERE driver_id = v_driver.id AND status = 'Ongoing'
  ) THEN
    RAISE EXCEPTION 'You already have an active trip in progress. Close it before starting a new trip.';
  END IF;

  -- 5. Validate Out Date & Time
  IF v_out_time !~ '^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$' THEN
    RAISE EXCEPTION 'Invalid Out Time format. Expected HH:MM.';
  END IF;

  v_started_at := ((v_out_date::TEXT || ' ' || v_out_time)::TIMESTAMP AT TIME ZONE 'Asia/Kolkata');

  -- 6. Compute authoritative Out KM from vehicle master & any higher hardware GPS telemetry
  SELECT COALESCE(odometer, 0) INTO v_hw_telemetry_odo
  FROM public.vehicle_telemetry
  WHERE vehicle_id = p_vehicle_id;

  SELECT COALESCE(MAX(odometer), 0) INTO v_hw_history_odo
  FROM public.telemetry_history
  WHERE vehicle_id = p_vehicle_id AND odometer IS NOT NULL AND odometer > 0;

  v_out_km := ROUND(GREATEST(COALESCE(v_vehicle.odometer, 0), COALESCE(v_hw_telemetry_odo, 0), COALESCE(v_hw_history_odo, 0))::numeric, 2);

  -- Sync vehicle odometer up if hardware telemetry was already ahead of master column
  IF v_out_km > COALESCE(v_vehicle.odometer, 0) THEN
    UPDATE public.vehicles
    SET odometer = v_out_km,
        odometer_source = 'HARDWARE_GPS',
        odometer_updated_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    WHERE id = p_vehicle_id;
  END IF;

  -- 7. Resolve Route / Start / Destination labels
  v_route_label := COALESCE(NULLIF(TRIM(p_route), ''), NULLIF(TRIM(v_vehicle.route), ''), 'Collection Route');
  IF position(' to ' in lower(v_route_label)) > 0 THEN
    v_start_place := split_part(v_route_label, ' to ', 1);
    v_dest_place := split_part(v_route_label, ' to ', 2);
  ELSIF position('->' in v_route_label) > 0 THEN
    v_start_place := TRIM(split_part(v_route_label, '->', 1));
    v_dest_place := TRIM(split_part(v_route_label, '->', 2));
  ELSIF position('→' in v_route_label) > 0 THEN
    v_start_place := TRIM(split_part(v_route_label, '→', 1));
    v_dest_place := TRIM(split_part(v_route_label, '→', 2));
  ELSE
    v_start_place := v_route_label;
    v_dest_place := 'Return Plant';
  END IF;

  -- 8. Insert active trip statement
  INSERT INTO public.trips (
    vehicle_id,
    driver_id,
    route_id,
    date,
    start,
    destination,
    status,
    start_km,
    out_date,
    out_time,
    started_at,
    salesman_name,
    notes,
    updated_at
  ) VALUES (
    p_vehicle_id,
    v_driver.id,
    p_route_id,
    v_out_date,
    COALESCE(NULLIF(v_start_place, ''), v_route_label),
    COALESCE(NULLIF(v_dest_place, ''), 'Return Plant'),
    'Ongoing',
    v_out_km,
    v_out_date,
    v_out_time,
    v_started_at,
    NULLIF(TRIM(p_salesman_name), ''),
    NULLIF(TRIM(p_notes), ''),
    timezone('utc', now())
  )
  RETURNING * INTO v_new_trip;

  RETURN jsonb_build_object(
    'ok', true,
    'out_km', v_out_km,
    'trip', to_jsonb(v_new_trip)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_driver_trip_statement(UUID, TEXT, UUID, TEXT, DATE, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_driver_trip_statement(UUID, TEXT, UUID, TEXT, DATE, TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. RPC: close_driver_trip_statement
--    Atomically validates trip ownership, prevents duplicate closures, verifies
--    In KM >= Out KM, >= vehicles.odometer, and >= newer GPS hardware odometer,
--    closes the trip, updates vehicles.odometer with source='DRIVER_TRIP_CLOSURE',
--    syncs vehicle_odometers (if present), and records odometer_audit_logs.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_driver_trip_statement(
  p_trip_id UUID,
  p_in_km NUMERIC,
  p_in_date DATE,
  p_in_time TEXT,
  p_diesel_liters NUMERIC DEFAULT 0,
  p_fuel_amount NUMERIC DEFAULT 0,
  p_salesman_name TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_driver public.drivers%ROWTYPE;
  v_trip public.trips%ROWTYPE;
  v_vehicle public.vehicles%ROWTYPE;
  v_is_assigned BOOLEAN := false;
  v_out_km NUMERIC(12, 2);
  v_in_km NUMERIC(12, 2);
  v_prev_vehicle_odo NUMERIC(12, 2);
  v_running_km NUMERIC(12, 2);
  v_diesel NUMERIC(10, 2);
  v_amount NUMERIC(12, 2);
  v_kmpl NUMERIC(8, 2);
  v_out_ts TIMESTAMP WITH TIME ZONE;
  v_in_ts TIMESTAMP WITH TIME ZONE;
  v_duration_mins INTEGER;
  v_duration_text TEXT;
  v_hw_tel_odo NUMERIC := 0;
  v_hw_hist_odo NUMERIC := 0;
  v_hw_max_odo NUMERIC := 0;
  v_updated_trip public.trips%ROWTYPE;
BEGIN
  -- 1. Authenticate caller & resolve driver
  v_driver := public._resolve_authenticated_driver();

  IF p_trip_id IS NULL THEN
    RAISE EXCEPTION 'Trip ID is required.';
  END IF;

  -- 2. Lock trip record exclusively
  SELECT * INTO v_trip FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip record not found.';
  END IF;

  -- 3. Verify trip ownership
  IF v_trip.driver_id IS DISTINCT FROM v_driver.id THEN
    RAISE EXCEPTION 'Unauthorized: You cannot close another driver''s trip.';
  END IF;

  -- 4. Prevent duplicate closure
  IF v_trip.status = 'Completed' OR v_trip.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate submission rejected: This trip is already closed.';
  END IF;

  -- 5. Verify driver is actively assigned to the trip's vehicle
  SELECT EXISTS (
    SELECT 1 FROM public.vehicle_assignments
    WHERE vehicle_id = v_trip.vehicle_id
      AND driver_id = v_driver.id
      AND is_active = true
  ) INTO v_is_assigned;

  IF NOT v_is_assigned THEN
    RAISE EXCEPTION 'Unauthorized: Your assignment to this vehicle is not active.';
  END IF;

  -- 6. Lock vehicle row exclusively
  SELECT * INTO v_vehicle FROM public.vehicles WHERE id = v_trip.vehicle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated vehicle record not found.';
  END IF;

  -- 7. Strict numeric & odometer validations
  IF p_in_km IS NULL THEN
    RAISE EXCEPTION 'In KM is mandatory.';
  END IF;

  v_in_km := ROUND(p_in_km::numeric, 2);
  IF v_in_km <= 0 THEN
    RAISE EXCEPTION 'Invalid Odometer Reading! In KM must be a positive number greater than 0.';
  END IF;

  v_prev_vehicle_odo := ROUND(COALESCE(v_vehicle.odometer, 0)::numeric, 2);
  v_out_km := ROUND(COALESCE(v_trip.start_km, v_prev_vehicle_odo)::numeric, 2);

  IF v_in_km < v_out_km THEN
    RAISE EXCEPTION 'Invalid Odometer Reading! In KM cannot be less than Out KM (% KM).', v_out_km;
  END IF;

  IF v_in_km < v_prev_vehicle_odo THEN
    RAISE EXCEPTION 'Invalid Odometer Reading! In KM (%) cannot be lower than vehicle''s current odometer (% KM).', v_in_km, v_prev_vehicle_odo;
  END IF;

  -- 8. Guard against overwriting a newer hardware GPS odometer reading
  SELECT COALESCE(vt.odometer, 0) INTO v_hw_tel_odo
  FROM public.vehicle_telemetry vt
  WHERE vt.vehicle_id = v_trip.vehicle_id
    AND vt.last_update >= COALESCE(v_trip.started_at, v_trip.created_at);

  SELECT COALESCE(MAX(th.odometer), 0) INTO v_hw_hist_odo
  FROM public.telemetry_history th
  WHERE th.vehicle_id = v_trip.vehicle_id
    AND th.odometer IS NOT NULL
    AND th.odometer > 0
    AND th.recorded_at >= COALESCE(v_trip.started_at, v_trip.created_at);

  v_hw_max_odo := ROUND(GREATEST(COALESCE(v_hw_tel_odo, 0), COALESCE(v_hw_hist_odo, 0))::numeric, 2);
  IF v_hw_max_odo > v_in_km THEN
    RAISE EXCEPTION 'Stale odometer reading: GPS hardware odometer (% KM) has already advanced beyond submitted In KM (% KM). Reconciliation required.', v_hw_max_odo, v_in_km;
  END IF;

  -- 9. Validate In Date and In Time
  IF p_in_date IS NULL OR p_in_time IS NULL OR TRIM(p_in_time) !~ '^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$' THEN
    RAISE EXCEPTION 'Valid In Date and In Time (HH:MM) are required.';
  END IF;

  v_out_ts := COALESCE(
    v_trip.started_at,
    ((COALESCE(v_trip.out_date, v_trip.date)::TEXT || ' ' || COALESCE(v_trip.out_time, '00:00'))::TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
  );
  v_in_ts := ((p_in_date::TEXT || ' ' || TRIM(p_in_time))::TIMESTAMP AT TIME ZONE 'Asia/Kolkata');

  IF date_trunc('minute', v_in_ts) < date_trunc('minute', v_out_ts) THEN
    RAISE EXCEPTION 'In Date and In Time cannot be earlier than Out Date and Out Time.';
  END IF;

  -- 10. Validate Diesel & Fuel Amount
  v_diesel := ROUND(COALESCE(p_diesel_liters, 0)::numeric, 2);
  v_amount := ROUND(COALESCE(p_fuel_amount, 0)::numeric, 2);

  IF v_diesel < 0 THEN
    RAISE EXCEPTION 'Diesel (Litres) cannot be negative.';
  END IF;
  IF v_amount < 0 THEN
    RAISE EXCEPTION 'Fuel Amount cannot be negative.';
  END IF;

  -- 11. Compute Running KM, Duration, and KMPL
  v_running_km := ROUND((v_in_km - v_out_km)::numeric, 2);
  v_kmpl := CASE
    WHEN v_diesel > 0 AND v_running_km >= 0 THEN ROUND((v_running_km / v_diesel)::numeric, 2)
    ELSE NULL
  END;

  v_duration_mins := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (v_in_ts - v_out_ts)) / 60.0)::INTEGER);
  IF v_duration_mins >= 60 THEN
    v_duration_text := (v_duration_mins / 60)::TEXT || 'h ' || (v_duration_mins % 60)::TEXT || 'm';
  ELSE
    v_duration_text := v_duration_mins::TEXT || 'm';
  END IF;

  -- 12. Atomic Update 1: Close Trip Statement
  UPDATE public.trips
  SET
    status = 'Completed',
    start_km = v_out_km,
    end_km = v_in_km,
    distance = v_running_km,
    duration = v_duration_text,
    in_date = p_in_date,
    in_time = TRIM(p_in_time),
    closed_at = v_in_ts,
    diesel_liters = v_diesel,
    fuel_liters_end = CASE WHEN v_diesel > 0 THEN v_diesel ELSE fuel_liters_end END,
    fuel_amount = v_amount,
    kmpl = v_kmpl,
    salesman_name = COALESCE(NULLIF(TRIM(p_salesman_name), ''), salesman_name),
    notes = COALESCE(NULLIF(TRIM(p_notes), ''), notes),
    odometer_updated_source = 'DRIVER_TRIP_CLOSURE',
    closed_by_profile_id = v_uid,
    updated_at = timezone('utc', now())
  WHERE id = p_trip_id
  RETURNING * INTO v_updated_trip;

  -- 13. Atomic Update 2: Update Canonical Vehicle Master Odometer
  UPDATE public.vehicles
  SET
    odometer = v_in_km,
    odometer_source = 'DRIVER_TRIP_CLOSURE',
    odometer_updated_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE id = v_trip.vehicle_id;

  -- 14. Sync vehicle_odometers state table if present so GPS tracker continues cleanly
  IF to_regclass('public.vehicle_odometers') IS NOT NULL THEN
    UPDATE public.vehicle_odometers
    SET
      total_odometer_km = GREATEST(total_odometer_km, v_in_km),
      current_trip_distance_km = 0.00,
      updated_at = timezone('utc', now()),
      last_updated_at = timezone('utc', now())
    WHERE vehicle_id = v_trip.vehicle_id;
  END IF;

  -- 15. Atomic Update 3: Append Odometer Audit Log
  INSERT INTO public.odometer_audit_logs (
    vehicle_id,
    trip_id,
    driver_id,
    actor_profile_id,
    previous_odometer,
    new_odometer,
    running_km,
    source,
    notes
  ) VALUES (
    v_trip.vehicle_id,
    v_trip.id,
    v_driver.id,
    v_uid,
    v_prev_vehicle_odo,
    v_in_km,
    v_running_km,
    'DRIVER_TRIP_CLOSURE',
    COALESCE(NULLIF(TRIM(p_notes), ''), 'Closed trip statement for vehicle ' || v_vehicle.number)
  );

  -- 16. Update Driver trip & distance counters
  UPDATE public.drivers
  SET
    trips = COALESCE(trips, 0) + 1,
    total_km = COALESCE(total_km, 0) + ROUND(v_running_km)::INTEGER,
    updated_at = timezone('utc', now())
  WHERE id = v_driver.id;

  RETURN jsonb_build_object(
    'ok', true,
    'trip', to_jsonb(v_updated_trip),
    'vehicle_id', v_trip.vehicle_id,
    'vehicle_number', v_vehicle.number,
    'previous_odometer', v_prev_vehicle_odo,
    'vehicle_odometer', v_in_km,
    'running_km', v_running_km,
    'kmpl', v_kmpl,
    'odometer_source', 'DRIVER_TRIP_CLOSURE'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.close_driver_trip_statement(UUID, NUMERIC, DATE, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_driver_trip_statement(UUID, NUMERIC, DATE, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. RPC: log_driver_fuel_refill (authenticated driver fuel logging with odometer check)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_driver_fuel_refill(
  p_vehicle_id UUID,
  p_liters NUMERIC,
  p_cost NUMERIC,
  p_odometer NUMERIC,
  p_is_full_tank BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_driver public.drivers%ROWTYPE;
  v_vehicle public.vehicles%ROWTYPE;
  v_is_assigned BOOLEAN := false;
  v_clean_odo NUMERIC(12, 2);
  v_prev_odo NUMERIC(12, 2);
  v_new_log public.fuel_purchase_logs%ROWTYPE;
BEGIN
  v_driver := public._resolve_authenticated_driver();

  IF p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Vehicle ID is required.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.vehicle_assignments
    WHERE vehicle_id = p_vehicle_id
      AND driver_id = v_driver.id
      AND is_active = true
  ) INTO v_is_assigned;

  IF NOT v_is_assigned THEN
    RAISE EXCEPTION 'Unauthorized: You are not assigned to this vehicle.';
  END IF;

  IF p_liters IS NULL OR p_liters <= 0 THEN
    RAISE EXCEPTION 'Fuel volume must be greater than 0 litres.';
  END IF;

  IF p_cost IS NULL OR p_cost <= 0 THEN
    RAISE EXCEPTION 'Fuel cost must be greater than 0.';
  END IF;

  v_clean_odo := ROUND(COALESCE(p_odometer, -1)::numeric, 2);
  IF v_clean_odo <= 0 THEN
    RAISE EXCEPTION 'Valid positive odometer reading is required.';
  END IF;

  SELECT * INTO v_vehicle FROM public.vehicles WHERE id = p_vehicle_id FOR UPDATE;
  v_prev_odo := ROUND(COALESCE(v_vehicle.odometer, 0)::numeric, 2);

  IF v_prev_odo > 0 AND v_clean_odo < v_prev_odo THEN
    RAISE EXCEPTION 'Odometer reading (% KM) cannot be lower than vehicle''s current odometer (% KM).', v_clean_odo, v_prev_odo;
  END IF;

  INSERT INTO public.fuel_purchase_logs (
    vehicle_id,
    driver_id,
    liters,
    cost,
    odometer,
    is_full_tank
  ) VALUES (
    p_vehicle_id,
    v_driver.id,
    ROUND(p_liters::numeric, 2),
    ROUND(p_cost::numeric, 2),
    ROUND(v_clean_odo)::INTEGER,
    COALESCE(p_is_full_tank, true)
  )
  RETURNING * INTO v_new_log;

  IF v_clean_odo > v_prev_odo THEN
    UPDATE public.vehicles
    SET odometer = v_clean_odo,
        odometer_source = 'FUEL_LOG',
        odometer_updated_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    WHERE id = p_vehicle_id;

    INSERT INTO public.odometer_audit_logs (
      vehicle_id,
      driver_id,
      actor_profile_id,
      previous_odometer,
      new_odometer,
      running_km,
      source,
      notes
    ) VALUES (
      p_vehicle_id,
      v_driver.id,
      v_uid,
      v_prev_odo,
      v_clean_odo,
      ROUND((v_clean_odo - v_prev_odo)::numeric, 2),
      'FUEL_LOG',
      'Fuel refill odometer log'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'fuel_log', to_jsonb(v_new_log),
    'vehicle_odometer', GREATEST(v_prev_odo, v_clean_odo)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_driver_fuel_refill(UUID, NUMERIC, NUMERIC, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_driver_fuel_refill(UUID, NUMERIC, NUMERIC, NUMERIC, BOOLEAN) TO authenticated;
