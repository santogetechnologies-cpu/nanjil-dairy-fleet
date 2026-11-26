-- =============================================================================
-- NANJIL DAIRY FLEET — DRIVER CLOCK IN WITH STARTING VEHICLE ODOMETER ENTRY
-- Migration: 20261126130000_driver_clock_in_starting_odometer.sql
--
-- Features:
-- 1. Updates `driver_clock_in(p_opening_km, p_notes)` so drivers can submit
--    their physical Starting Vehicle Odometer (KM) in the Clock-In form.
--    Enforces non-negative validation and monotonic baseline reconciliation.
-- 2. Updates `start_driver_trip_statement(..., p_out_km)` so trips inherit
--    the entered starting odometer from `driver_shifts.opening_km` or explicit
--    `p_out_km`, while preserving immutable `route_snapshot`.
-- =============================================================================

-- Replace 0-arg signature cleanly to avoid overload ambiguity in PostgREST
DROP FUNCTION IF EXISTS public.driver_clock_in();

CREATE OR REPLACE FUNCTION public.driver_clock_in(
  p_opening_km NUMERIC DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver public.drivers%ROWTYPE;
  v_assignment public.vehicle_assignments%ROWTYPE;
  v_vehicle public.vehicles%ROWTYPE;
  v_route public.collection_routes%ROWTYPE;
  v_existing_shift public.driver_shifts%ROWTYPE;
  v_active_trip public.trips%ROWTYPE;
  v_new_shift public.driver_shifts%ROWTYPE;
  v_today_ist DATE := (timezone('Asia/Kolkata', now()))::DATE;
  v_hw_tel_odo NUMERIC := 0;
  v_hw_hist_odo NUMERIC := 0;
  v_baseline_odo NUMERIC(12, 2) := 0;
  v_auth_odo NUMERIC(12, 2) := 0;
  v_clean_notes TEXT := NULLIF(TRIM(COALESCE(p_notes, '')), '');
BEGIN
  v_driver := public._resolve_authenticated_driver();

  SELECT * INTO v_existing_shift
  FROM public.driver_shifts
  WHERE driver_id = v_driver.id AND ended_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Duplicate Clock In prevented: You are already clocked in.';
  END IF;

  -- Check active assignment first, then auto-promote due Scheduled assignment for today
  SELECT * INTO v_assignment
  FROM public.vehicle_assignments
  WHERE driver_id = v_driver.id AND is_active = true
  ORDER BY assigned_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT * INTO v_assignment
    FROM public.vehicle_assignments
    WHERE driver_id = v_driver.id
      AND status = 'Scheduled'
      AND assignment_date <= v_today_ist
    ORDER BY assignment_date ASC, departure_time ASC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.vehicle_assignments
      SET is_active = true,
          status = 'In Progress',
          updated_at = timezone('utc', now())
      WHERE id = v_assignment.id
      RETURNING * INTO v_assignment;
    END IF;
  END IF;

  IF v_assignment.id IS NULL OR v_assignment.vehicle_id IS NULL THEN
    RAISE EXCEPTION 'No Vehicle Assigned. Please contact your administrator.';
  END IF;

  SELECT * INTO v_vehicle
  FROM public.vehicles
  WHERE id = v_assignment.vehicle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assigned vehicle record not found. Please contact your administrator.';
  END IF;

  SELECT * INTO v_active_trip
  FROM public.trips
  WHERE vehicle_id = v_vehicle.id AND status = 'Ongoing'
  LIMIT 1;

  IF FOUND AND v_active_trip.driver_id IS DISTINCT FROM v_driver.id THEN
    RAISE EXCEPTION 'Assigned vehicle is currently unavailable because another trip is already in progress.';
  END IF;

  UPDATE public.vehicle_assignments
  SET status = 'In Progress',
      updated_at = timezone('utc', now())
  WHERE id = v_assignment.id
    AND status IN ('Assigned', 'Scheduled');

  IF v_assignment.route_id IS NOT NULL THEN
    SELECT * INTO v_route FROM public.collection_routes WHERE id = v_assignment.route_id;
    IF FOUND THEN
      UPDATE public.vehicles
      SET route = COALESCE(NULLIF(TRIM(v_route.name), ''), route),
          updated_at = timezone('utc', now())
      WHERE id = v_vehicle.id;
    END IF;
  END IF;

  SELECT COALESCE(odometer, 0) INTO v_hw_tel_odo
  FROM public.vehicle_telemetry
  WHERE vehicle_id = v_vehicle.id;

  SELECT COALESCE(MAX(odometer), 0) INTO v_hw_hist_odo
  FROM public.telemetry_history
  WHERE vehicle_id = v_vehicle.id AND odometer IS NOT NULL AND odometer > 0;

  v_baseline_odo := ROUND(
    GREATEST(
      COALESCE(v_vehicle.odometer, 0),
      COALESCE(v_hw_tel_odo, 0),
      COALESCE(v_hw_hist_odo, 0)
    )::numeric,
    2
  );

  IF p_opening_km IS NOT NULL THEN
    IF p_opening_km < 0 THEN
      RAISE EXCEPTION 'Starting vehicle odometer cannot be negative.';
    END IF;
    IF v_baseline_odo > 0 AND p_opening_km < v_baseline_odo THEN
      RAISE EXCEPTION 'Starting odometer (% KM) cannot be less than recorded vehicle baseline (% KM).',
        ROUND(p_opening_km::numeric, 2),
        v_baseline_odo;
    END IF;
    v_auth_odo := ROUND(p_opening_km::numeric, 2);

    IF v_auth_odo > COALESCE(v_vehicle.odometer, 0) THEN
      UPDATE public.vehicles
      SET odometer = v_auth_odo,
          odometer_source = 'MANUAL',
          odometer_updated_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
      WHERE id = v_vehicle.id
      RETURNING * INTO v_vehicle;
    END IF;
  ELSE
    v_auth_odo := v_baseline_odo;
  END IF;

  INSERT INTO public.driver_shifts (
    driver_id,
    vehicle_id,
    assignment_id,
    route_id,
    started_at,
    opening_km
  ) VALUES (
    v_driver.id,
    v_vehicle.id,
    v_assignment.id,
    v_assignment.route_id,
    timezone('utc', now()),
    v_auth_odo
  )
  RETURNING * INTO v_new_shift;

  -- If driver entered clock-in note, log odometer audit when odometer advanced
  IF v_auth_odo > v_baseline_odo AND to_regclass('public.odometer_audit_logs') IS NOT NULL THEN
    INSERT INTO public.odometer_audit_logs (
      vehicle_id,
      driver_id,
      previous_odometer,
      new_odometer,
      source,
      notes
    ) VALUES (
      v_vehicle.id,
      v_driver.id,
      v_baseline_odo,
      v_auth_odo,
      'MANUAL_CLOCK_IN',
      v_clean_notes
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'shift', to_jsonb(v_new_shift),
    'vehicle', to_jsonb(v_vehicle),
    'assignment', to_jsonb(v_assignment),
    'route', CASE WHEN v_route.id IS NOT NULL THEN to_jsonb(v_route) ELSE NULL END,
    'authoritative_odometer', v_auth_odo,
    'has_active_trip', (v_active_trip.id IS NOT NULL),
    'active_trip', CASE WHEN v_active_trip.id IS NOT NULL THEN to_jsonb(v_active_trip) ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_clock_in(NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_clock_in(NUMERIC, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- Update start_driver_trip_statement to accept optional p_out_km while
-- inheriting open shift's entered opening_km and preserving route_snapshot
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.start_driver_trip_statement(UUID, TEXT, UUID, TEXT, DATE, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.start_driver_trip_statement(
  p_vehicle_id UUID,
  p_route TEXT DEFAULT NULL,
  p_route_id UUID DEFAULT NULL,
  p_salesman_name TEXT DEFAULT NULL,
  p_out_date DATE DEFAULT NULL,
  p_out_time TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_out_km NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver public.drivers%ROWTYPE;
  v_vehicle public.vehicles%ROWTYPE;
  v_assignment public.vehicle_assignments%ROWTYPE;
  v_route public.collection_routes%ROWTYPE;
  v_now_ist TIMESTAMP := timezone('Asia/Kolkata', now());
  v_out_date DATE := COALESCE(p_out_date, v_now_ist::DATE);
  v_out_time TEXT := COALESCE(NULLIF(TRIM(p_out_time), ''), to_char(v_now_ist, 'HH24:MI'));
  v_started_at TIMESTAMP WITH TIME ZONE;
  v_hw_telemetry_odo NUMERIC := 0;
  v_hw_history_odo NUMERIC := 0;
  v_shift_opening_odo NUMERIC := 0;
  v_baseline_odo NUMERIC(12, 2) := 0;
  v_out_km NUMERIC(12, 2) := 0;
  v_effective_route_id UUID;
  v_route_snapshot JSONB;
  v_route_label TEXT;
  v_start_place TEXT;
  v_dest_place TEXT;
  v_statement_number TEXT;
  v_new_trip public.trips%ROWTYPE;
BEGIN
  v_driver := public._resolve_authenticated_driver();

  IF p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Vehicle ID is required to start a trip.';
  END IF;

  SELECT * INTO v_assignment
  FROM public.vehicle_assignments
  WHERE vehicle_id = p_vehicle_id
    AND driver_id = v_driver.id
    AND is_active = true
  ORDER BY assigned_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
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

  SELECT COALESCE(opening_km, 0) INTO v_shift_opening_odo
  FROM public.driver_shifts
  WHERE driver_id = v_driver.id AND ended_at IS NULL
  ORDER BY started_at DESC
  LIMIT 1;

  v_baseline_odo := ROUND(
    GREATEST(
      COALESCE(v_vehicle.odometer, 0),
      COALESCE(v_hw_telemetry_odo, 0),
      COALESCE(v_hw_history_odo, 0),
      COALESCE(v_shift_opening_odo, 0)
    )::numeric,
    2
  );

  IF p_out_km IS NOT NULL THEN
    IF p_out_km < 0 THEN
      RAISE EXCEPTION 'Starting vehicle odometer cannot be negative.';
    END IF;
    IF v_baseline_odo > 0 AND p_out_km < v_baseline_odo THEN
      RAISE EXCEPTION 'Starting odometer (% KM) cannot be less than recorded baseline (% KM).',
        ROUND(p_out_km::numeric, 2),
        v_baseline_odo;
    END IF;
    v_out_km := ROUND(p_out_km::numeric, 2);
  ELSE
    v_out_km := v_baseline_odo;
  END IF;

  IF v_out_km > COALESCE(v_vehicle.odometer, 0) THEN
    UPDATE public.vehicles
    SET odometer = v_out_km,
        odometer_source = CASE
          WHEN p_out_km IS NOT NULL OR COALESCE(v_shift_opening_odo, 0) >= v_out_km THEN 'MANUAL'
          ELSE 'HARDWARE_GPS'
        END,
        odometer_updated_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    WHERE id = p_vehicle_id;
  END IF;

  v_effective_route_id := COALESCE(p_route_id, v_assignment.route_id);
  IF v_effective_route_id IS NOT NULL THEN
    SELECT * INTO v_route FROM public.collection_routes WHERE id = v_effective_route_id;
  END IF;

  v_route_snapshot := COALESCE(
    v_assignment.route_snapshot,
    CASE
      WHEN v_route.id IS NOT NULL THEN jsonb_build_object(
        'id', v_route.id,
        'name', v_route.name,
        'start_time', v_route.start_time,
        'end_time', v_route.end_time,
        'centres', v_route.centres,
        'route_config', v_route.route_config,
        'snapshotted_at', timezone('utc', now())
      )
      ELSE NULL
    END
  );

  UPDATE public.vehicle_assignments
  SET status = 'In Progress',
      updated_at = timezone('utc', now())
  WHERE id = v_assignment.id;

  IF NOT EXISTS (
    SELECT 1 FROM public.driver_shifts
    WHERE driver_id = v_driver.id AND ended_at IS NULL
  ) THEN
    INSERT INTO public.driver_shifts (driver_id, vehicle_id, assignment_id, route_id, started_at, opening_km)
    VALUES (v_driver.id, p_vehicle_id, v_assignment.id, v_effective_route_id, v_started_at, v_out_km);
  ELSE
    UPDATE public.driver_shifts
    SET assignment_id = COALESCE(assignment_id, v_assignment.id),
        route_id = COALESCE(route_id, v_effective_route_id),
        opening_km = GREATEST(COALESCE(opening_km, 0), v_out_km),
        updated_at = timezone('utc', now())
    WHERE driver_id = v_driver.id AND ended_at IS NULL;
  END IF;

  v_route_label := COALESCE(
    NULLIF(TRIM(v_route_snapshot->>'name'), ''),
    NULLIF(TRIM(v_route.name), ''),
    NULLIF(TRIM(v_assignment.route_name), ''),
    NULLIF(TRIM(p_route), ''),
    NULLIF(TRIM(v_vehicle.route), ''),
    'Collection Route'
  );

  IF v_route_snapshot->'route_config' IS NOT NULL THEN
    v_start_place := NULLIF(TRIM(v_route_snapshot->'route_config'->'startPoint'->>'name'), '');
    v_dest_place := NULLIF(TRIM(v_route_snapshot->'route_config'->'destinationPoint'->>'name'), '');
  ELSIF v_route.id IS NOT NULL AND v_route.route_config IS NOT NULL THEN
    v_start_place := NULLIF(TRIM(v_route.route_config->'startPoint'->>'name'), '');
    v_dest_place := NULLIF(TRIM(v_route.route_config->'destinationPoint'->>'name'), '');
  END IF;

  IF v_start_place IS NULL THEN
    IF position(' to ' in lower(v_route_label)) > 0 THEN
      v_start_place := split_part(v_route_label, ' to ', 1);
      v_dest_place := COALESCE(v_dest_place, split_part(v_route_label, ' to ', 2));
    ELSIF position('->' in v_route_label) > 0 THEN
      v_start_place := TRIM(split_part(v_route_label, '->', 1));
      v_dest_place := COALESCE(v_dest_place, TRIM(split_part(v_route_label, '->', 2)));
    ELSIF position('→' in v_route_label) > 0 THEN
      v_start_place := TRIM(split_part(v_route_label, '→', 1));
      v_dest_place := COALESCE(v_dest_place, TRIM(split_part(v_route_label, '→', 2)));
    ELSE
      v_start_place := v_route_label;
      v_dest_place := COALESCE(v_dest_place, 'Return Plant');
    END IF;
  END IF;

  v_statement_number := 'NVIP-' || to_char(v_out_date, 'YYYYMMDD') || '-' || UPPER(SUBSTRING(gen_random_uuid()::text FROM 1 FOR 4));

  INSERT INTO public.trips (
    vehicle_id,
    driver_id,
    route_id,
    assignment_id,
    route_snapshot,
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
    v_effective_route_id,
    v_assignment.id,
    v_route_snapshot,
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

REVOKE ALL ON FUNCTION public.start_driver_trip_statement(UUID, TEXT, UUID, TEXT, DATE, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_driver_trip_statement(UUID, TEXT, UUID, TEXT, DATE, TEXT, TEXT, NUMERIC) TO authenticated;
