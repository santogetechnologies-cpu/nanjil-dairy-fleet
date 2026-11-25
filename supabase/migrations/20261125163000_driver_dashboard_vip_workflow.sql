-- =============================================================================
-- Migration: Nanjil VIP Driver Dashboard Workflow, Attendance & Statement Numbers
-- Date: 2026-11-25
-- Version: 20261125163000
--
-- Features & Security Guarantees:
--   1. Adds `statement_number` to `public.trips` and `employee_id` to `public.drivers`.
--   2. Ensures `driver_shifts` supports `opening_km` and enforces at most ONE
--      active shift (`ended_at IS NULL`) per driver via partial unique index.
--   3. Adds authenticated SECURITY DEFINER RPCs (`SET search_path = public, pg_temp`):
--        - public.driver_clock_in()
--        - public.driver_clock_out()
--   4. Updates `public.start_driver_trip_statement` to auto-generate unique
--      formatted Statement Numbers (`NVIP-YYYYMMDD-XXXX`).
--   5. Updates `public.close_driver_trip_statement` to atomically close the
--      driver's open shift alongside closing the trip & updating master odometer.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extend public.drivers & public.trips (non-destructive)
-- -----------------------------------------------------------------------------
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS employee_id TEXT;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS statement_number TEXT;

UPDATE public.trips
SET statement_number = 'NVIP-' || to_char(COALESCE(out_date, date, created_at::date), 'YYYYMMDD') || '-' || UPPER(SUBSTRING(id::text FROM 1 FOR 4))
WHERE statement_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_statement_number
  ON public.trips (statement_number)
  WHERE statement_number IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Harden public.driver_shifts (opening_km & single active shift per driver)
-- -----------------------------------------------------------------------------
ALTER TABLE public.driver_shifts
  ADD COLUMN IF NOT EXISTS opening_km NUMERIC(12, 2);

-- Safely close any stale duplicate open shifts if present before enforcing uniqueness
WITH ranked_open_shifts AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY driver_id ORDER BY started_at DESC) AS rn
  FROM public.driver_shifts
  WHERE ended_at IS NULL
)
UPDATE public.driver_shifts
SET ended_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
WHERE id IN (SELECT id FROM ranked_open_shifts WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_shifts_one_active_per_driver
  ON public.driver_shifts (driver_id)
  WHERE ended_at IS NULL;

-- Ensure drivers can only read their own shifts and clock in/out via RPCs
REVOKE INSERT, UPDATE, DELETE ON public.driver_shifts FROM anon;

-- -----------------------------------------------------------------------------
-- 3. RPC: driver_clock_in
--    Verifies authenticated driver, checks admin vehicle assignment, checks
--    vehicle availability, prevents duplicate clock-in, and starts shift.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_clock_in()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver public.drivers%ROWTYPE;
  v_assignment public.vehicle_assignments%ROWTYPE;
  v_vehicle public.vehicles%ROWTYPE;
  v_existing_shift public.driver_shifts%ROWTYPE;
  v_active_trip public.trips%ROWTYPE;
  v_new_shift public.driver_shifts%ROWTYPE;
  v_hw_tel_odo NUMERIC := 0;
  v_hw_hist_odo NUMERIC := 0;
  v_auth_odo NUMERIC(12, 2) := 0;
BEGIN
  -- 1. Verify authenticated driver profile
  v_driver := public._resolve_authenticated_driver();

  -- 2. Prevent duplicate Clock In
  SELECT * INTO v_existing_shift
  FROM public.driver_shifts
  WHERE driver_id = v_driver.id AND ended_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Duplicate Clock In prevented: You are already clocked in.';
  END IF;

  -- 3. Verify Admin vehicle assignment
  SELECT * INTO v_assignment
  FROM public.vehicle_assignments
  WHERE driver_id = v_driver.id AND is_active = true
  ORDER BY assigned_at DESC
  LIMIT 1;

  IF NOT FOUND OR v_assignment.vehicle_id IS NULL THEN
    RAISE EXCEPTION 'No Vehicle Assigned. Please contact your administrator.';
  END IF;

  -- 4. Lock and load assigned vehicle
  SELECT * INTO v_vehicle
  FROM public.vehicles
  WHERE id = v_assignment.vehicle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assigned vehicle record not found. Please contact your administrator.';
  END IF;

  -- 5. Verify assigned vehicle is not blocked by another driver's active trip
  SELECT * INTO v_active_trip
  FROM public.trips
  WHERE vehicle_id = v_vehicle.id AND status = 'Ongoing'
  LIMIT 1;

  IF FOUND AND v_active_trip.driver_id IS DISTINCT FROM v_driver.id THEN
    RAISE EXCEPTION 'Assigned vehicle is currently unavailable because another trip is already in progress.';
  END IF;

  -- 6. Compute authoritative current odometer
  SELECT COALESCE(odometer, 0) INTO v_hw_tel_odo
  FROM public.vehicle_telemetry
  WHERE vehicle_id = v_vehicle.id;

  SELECT COALESCE(MAX(odometer), 0) INTO v_hw_hist_odo
  FROM public.telemetry_history
  WHERE vehicle_id = v_vehicle.id AND odometer IS NOT NULL AND odometer > 0;

  v_auth_odo := ROUND(GREATEST(COALESCE(v_vehicle.odometer, 0), COALESCE(v_hw_tel_odo, 0), COALESCE(v_hw_hist_odo, 0))::numeric, 2);

  -- 7. Record shift attendance
  INSERT INTO public.driver_shifts (
    driver_id,
    vehicle_id,
    started_at,
    opening_km
  ) VALUES (
    v_driver.id,
    v_vehicle.id,
    timezone('utc', now()),
    v_auth_odo
  )
  RETURNING * INTO v_new_shift;

  RETURN jsonb_build_object(
    'ok', true,
    'shift', to_jsonb(v_new_shift),
    'vehicle', to_jsonb(v_vehicle),
    'assignment', to_jsonb(v_assignment),
    'authoritative_odometer', v_auth_odo,
    'has_active_trip', (v_active_trip.id IS NOT NULL),
    'active_trip', CASE WHEN v_active_trip.id IS NOT NULL THEN to_jsonb(v_active_trip) ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_clock_in() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_clock_in() TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. RPC: driver_clock_out
--    Ends an open driver shift when no Ongoing trip remains unclosed.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_clock_out()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver public.drivers%ROWTYPE;
  v_shift public.driver_shifts%ROWTYPE;
  v_now TIMESTAMP WITH TIME ZONE := timezone('utc', now());
  v_hours NUMERIC(10, 2);
BEGIN
  v_driver := public._resolve_authenticated_driver();

  IF EXISTS (
    SELECT 1 FROM public.trips
    WHERE driver_id = v_driver.id AND status = 'Ongoing'
  ) THEN
    RAISE EXCEPTION 'Complete your active Vehicle Operation Statement before clocking out.';
  END IF;

  SELECT * INTO v_shift
  FROM public.driver_shifts
  WHERE driver_id = v_driver.id AND ended_at IS NULL
  ORDER BY started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'already_clocked_out', true);
  END IF;

  v_hours := GREATEST(0, ROUND((EXTRACT(EPOCH FROM (v_now - v_shift.started_at)) / 3600.0)::numeric, 2));

  UPDATE public.driver_shifts
  SET ended_at = v_now,
      active_hours = v_hours,
      updated_at = v_now
  WHERE id = v_shift.id
  RETURNING * INTO v_shift;

  RETURN jsonb_build_object(
    'ok', true,
    'shift', to_jsonb(v_shift)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_clock_out() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_clock_out() TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Update start_driver_trip_statement to auto-generate Statement Number
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
  v_statement_number TEXT;
  v_new_trip public.trips%ROWTYPE;
  v_is_assigned BOOLEAN := false;
BEGIN
  v_driver := public._resolve_authenticated_driver();

  IF p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Vehicle ID is required to start a trip.';
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

  SELECT * INTO v_vehicle FROM public.vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assigned vehicle not found.';
  END IF;

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

  IF v_out_time !~ '^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$' THEN
    RAISE EXCEPTION 'Invalid Out Time format. Expected HH:MM.';
  END IF;

  v_started_at := ((v_out_date::TEXT || ' ' || v_out_time)::TIMESTAMP AT TIME ZONE 'Asia/Kolkata');

  SELECT COALESCE(odometer, 0) INTO v_hw_telemetry_odo
  FROM public.vehicle_telemetry
  WHERE vehicle_id = p_vehicle_id;

  SELECT COALESCE(MAX(odometer), 0) INTO v_hw_history_odo
  FROM public.telemetry_history
  WHERE vehicle_id = p_vehicle_id AND odometer IS NOT NULL AND odometer > 0;

  v_out_km := ROUND(GREATEST(COALESCE(v_vehicle.odometer, 0), COALESCE(v_hw_telemetry_odo, 0), COALESCE(v_hw_history_odo, 0))::numeric, 2);

  IF v_out_km > COALESCE(v_vehicle.odometer, 0) THEN
    UPDATE public.vehicles
    SET odometer = v_out_km,
        odometer_source = 'HARDWARE_GPS',
        odometer_updated_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    WHERE id = p_vehicle_id;
  END IF;

  -- Ensure driver has an active shift logged on start
  IF NOT EXISTS (
    SELECT 1 FROM public.driver_shifts
    WHERE driver_id = v_driver.id AND ended_at IS NULL
  ) THEN
    INSERT INTO public.driver_shifts (driver_id, vehicle_id, started_at, opening_km)
    VALUES (v_driver.id, p_vehicle_id, v_started_at, v_out_km);
  END IF;

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

  v_statement_number := 'NVIP-' || to_char(v_out_date, 'YYYYMMDD') || '-' || UPPER(SUBSTRING(gen_random_uuid()::text FROM 1 FOR 4));

  INSERT INTO public.trips (
    vehicle_id,
    driver_id,
    route_id,
    statement_number,
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
    v_statement_number,
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
    'statement_number', v_statement_number,
    'trip', to_jsonb(v_new_trip)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_driver_trip_statement(UUID, TEXT, UUID, TEXT, DATE, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_driver_trip_statement(UUID, TEXT, UUID, TEXT, DATE, TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. Update close_driver_trip_statement to atomically clock out active shift
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
  v_driver := public._resolve_authenticated_driver();

  IF p_trip_id IS NULL THEN
    RAISE EXCEPTION 'Trip ID is required.';
  END IF;

  SELECT * INTO v_trip FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip record not found.';
  END IF;

  IF v_trip.driver_id IS DISTINCT FROM v_driver.id THEN
    RAISE EXCEPTION 'Unauthorized: You cannot close another driver''s trip.';
  END IF;

  IF v_trip.status = 'Completed' OR v_trip.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate submission rejected: This trip is already closed.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.vehicle_assignments
    WHERE vehicle_id = v_trip.vehicle_id
      AND driver_id = v_driver.id
      AND is_active = true
  ) INTO v_is_assigned;

  IF NOT v_is_assigned THEN
    RAISE EXCEPTION 'Unauthorized: Your assignment to this vehicle is not active.';
  END IF;

  SELECT * INTO v_vehicle FROM public.vehicles WHERE id = v_trip.vehicle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated vehicle record not found.';
  END IF;

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

  v_diesel := ROUND(COALESCE(p_diesel_liters, 0)::numeric, 2);
  v_amount := ROUND(COALESCE(p_fuel_amount, 0)::numeric, 2);

  IF v_diesel < 0 THEN
    RAISE EXCEPTION 'Diesel (Litres) cannot be negative.';
  END IF;
  IF v_amount < 0 THEN
    RAISE EXCEPTION 'Fuel Amount cannot be negative.';
  END IF;

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

  UPDATE public.trips
  SET
    status = 'Completed',
    statement_number = COALESCE(statement_number, 'NVIP-' || to_char(COALESCE(out_date, date), 'YYYYMMDD') || '-' || UPPER(SUBSTRING(id::text FROM 1 FOR 4))),
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

  UPDATE public.vehicles
  SET
    odometer = v_in_km,
    odometer_source = 'DRIVER_TRIP_CLOSURE',
    odometer_updated_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE id = v_trip.vehicle_id;

  IF to_regclass('public.vehicle_odometers') IS NOT NULL THEN
    UPDATE public.vehicle_odometers
    SET
      total_odometer_km = GREATEST(total_odometer_km, v_in_km),
      current_trip_distance_km = 0.00,
      updated_at = timezone('utc', now()),
      last_updated_at = timezone('utc', now())
    WHERE vehicle_id = v_trip.vehicle_id;
  END IF;

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

  UPDATE public.drivers
  SET
    trips = COALESCE(trips, 0) + 1,
    total_km = COALESCE(total_km, 0) + ROUND(v_running_km)::INTEGER,
    updated_at = timezone('utc', now())
  WHERE id = v_driver.id;

  -- Close driver's active shift atomically on COMPLETE TRIP / CLOCK OUT
  UPDATE public.driver_shifts
  SET
    ended_at = v_in_ts,
    active_hours = GREATEST(0, ROUND((EXTRACT(EPOCH FROM (v_in_ts - started_at)) / 3600.0)::numeric, 2)),
    updated_at = timezone('utc', now())
  WHERE driver_id = v_driver.id
    AND ended_at IS NULL;

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
