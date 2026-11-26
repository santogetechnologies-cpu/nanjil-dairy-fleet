-- =============================================================================
-- NANJIL DAIRY FLEET — MANUAL ROUTES LIFECYCLE, CLEANUP & IMMUTABLE SNAPSHOTS
-- Migration: 20261126120000_manual_routes_lifecycle_and_snapshots.sql
--
-- Features:
-- 1. Lifecycle columns `is_archived` + `archived_at` on public.collection_routes
-- 2. Immutable `route_snapshot` JSONB on public.vehicle_assignments and public.trips
-- 3. Safe idempotent cleanup of legacy/preset routes:
--    - Referenced legacy routes (assignments, trips, shifts) are preserved & archived
--    - Unreferenced legacy routes (without manual route marker) are cleanly removed
-- 4. RPC `admin_archive_collection_route` & `admin_cleanup_legacy_routes`
-- 5. Updated `admin_save_route_assignment` rejecting archived/incomplete routes
--    and capturing immutable `route_snapshot`
-- 6. Updated `start_driver_trip_statement` preserving `route_snapshot` on trips
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Lifecycle & Snapshot Schema Extensions (Idempotent)
-- -----------------------------------------------------------------------------
ALTER TABLE public.collection_routes
  ADD COLUMN IF NOT EXISTS route_config JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now());

CREATE INDEX IF NOT EXISTS idx_collection_routes_is_archived
  ON public.collection_routes(is_archived, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = 'collection_routes'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.collection_routes;
    END IF;
  END IF;
END $$;

ALTER TABLE public.vehicle_assignments
  ADD COLUMN IF NOT EXISTS route_snapshot JSONB;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS route_snapshot JSONB;

-- -----------------------------------------------------------------------------
-- 2. Safe One-Time Cleanup Helper (Archives referenced legacy routes, deletes
--    unreferenced non-manual legacy routes without breaking foreign keys)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._cleanup_legacy_collection_routes_internal()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived_count INTEGER := 0;
  v_deleted_count INTEGER := 0;
  v_has_schedules BOOLEAN := (to_regclass('public.route_schedules') IS NOT NULL);
  v_has_execution_logs BOOLEAN := (to_regclass('public.route_execution_logs') IS NOT NULL);
  v_sql TEXT;
BEGIN
  -- Archive any legacy (non-manual) route that is referenced by historical records
  UPDATE public.collection_routes cr
  SET
    is_archived = true,
    archived_at = COALESCE(cr.archived_at, timezone('utc', now())),
    updated_at = timezone('utc', now())
  WHERE cr.is_archived = false
    AND COALESCE((cr.route_config->>'createdManually')::boolean, false) = false
    AND (
      EXISTS (SELECT 1 FROM public.vehicle_assignments va WHERE va.route_id = cr.id)
      OR EXISTS (SELECT 1 FROM public.trips t WHERE t.route_id = cr.id)
      OR EXISTS (SELECT 1 FROM public.driver_shifts ds WHERE ds.route_id = cr.id)
    );
  GET DIAGNOSTICS v_archived_count = ROW_COUNT;

  -- Delete only unreferenced legacy routes (never touch newly created manual routes)
  v_sql := '
    DELETE FROM public.collection_routes cr
    WHERE COALESCE((cr.route_config->>''createdManually'')::boolean, false) = false
      AND NOT EXISTS (SELECT 1 FROM public.vehicle_assignments va WHERE va.route_id = cr.id)
      AND NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.route_id = cr.id)
      AND NOT EXISTS (SELECT 1 FROM public.driver_shifts ds WHERE ds.route_id = cr.id)
  ';

  IF v_has_schedules THEN
    v_sql := v_sql || ' AND NOT EXISTS (SELECT 1 FROM public.route_schedules rs WHERE rs.route_id = cr.id)';
  END IF;

  IF v_has_execution_logs THEN
    v_sql := v_sql || ' AND NOT EXISTS (SELECT 1 FROM public.route_execution_logs rel WHERE rel.route_id = cr.id)';
  END IF;

  EXECUTE v_sql;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'archived_legacy_routes', v_archived_count,
    'deleted_unreferenced_legacy_routes', v_deleted_count
  );
END;
$$;

-- Run cleanup once safely during migration
SELECT public._cleanup_legacy_collection_routes_internal();

-- -----------------------------------------------------------------------------
-- 3. Admin RPC: admin_archive_collection_route
--    Archives a saved route without destroying historical FK relationships.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_archive_collection_route(
  p_route_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated public.collection_routes%ROWTYPE;
BEGIN
  PERFORM public._assert_admin_or_manager();

  IF p_route_id IS NULL THEN
    RAISE EXCEPTION 'Route ID is required to archive a route.';
  END IF;

  UPDATE public.collection_routes
  SET
    is_archived = true,
    archived_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE id = p_route_id
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collection route not found.';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'route', to_jsonb(v_updated)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_archive_collection_route(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_archive_collection_route(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_cleanup_legacy_routes()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public._assert_admin_or_manager();
  RETURN public._cleanup_legacy_collection_routes_internal();
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cleanup_legacy_routes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cleanup_legacy_routes() TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Update admin_save_route_assignment:
--    - Reject archived or incomplete routes without startPoint/destinationPoint
--    - Capture immutable `route_snapshot` JSONB on vehicle_assignments
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_save_route_assignment(
  p_driver_id UUID,
  p_vehicle_id UUID,
  p_route_id UUID,
  p_assignment_date DATE,
  p_departure_time TEXT DEFAULT '05:30',
  p_notes TEXT DEFAULT NULL,
  p_assignment_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID;
  v_driver public.drivers%ROWTYPE;
  v_vehicle public.vehicles%ROWTYPE;
  v_route public.collection_routes%ROWTYPE;
  v_today_ist DATE := (timezone('Asia/Kolkata', now()))::DATE;
  v_assign_date DATE := COALESCE(p_assignment_date, v_today_ist);
  v_dep_time TEXT := COALESCE(NULLIF(TRIM(p_departure_time), ''), '05:30');
  v_target_status TEXT;
  v_is_active BOOLEAN;
  v_existing public.vehicle_assignments%ROWTYPE;
  v_saved public.vehicle_assignments%ROWTYPE;
  v_route_snapshot JSONB;
BEGIN
  v_uid := public._assert_admin_or_manager();

  IF p_driver_id IS NULL OR p_vehicle_id IS NULL OR p_route_id IS NULL THEN
    RAISE EXCEPTION 'Driver, Vehicle, and Collection Route are all required.';
  END IF;

  IF v_dep_time !~ '^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$' THEN
    RAISE EXCEPTION 'Invalid Departure Time format. Expected HH:MM.';
  END IF;

  SELECT * INTO v_driver FROM public.drivers WHERE id = p_driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected driver was not found.';
  END IF;

  SELECT * INTO v_vehicle FROM public.vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected vehicle was not found.';
  END IF;

  SELECT * INTO v_route FROM public.collection_routes WHERE id = p_route_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected collection route was not found.';
  END IF;

  IF COALESCE(v_route.is_archived, false) = true THEN
    RAISE EXCEPTION 'Archived routes cannot be assigned. Please choose an active manually created route.';
  END IF;

  IF v_route.route_config IS NULL
     OR v_route.route_config->'startPoint' IS NULL
     OR v_route.route_config->'destinationPoint' IS NULL THEN
    RAISE EXCEPTION 'Selected route is missing valid start and destination configuration. Edit and save it in Route Planner first.';
  END IF;

  v_route_snapshot := jsonb_build_object(
    'id', v_route.id,
    'name', v_route.name,
    'start_time', v_route.start_time,
    'end_time', v_route.end_time,
    'centres', v_route.centres,
    'route_config', v_route.route_config,
    'snapshotted_at', timezone('utc', now())
  );

  -- Check vehicle operational availability
  IF EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.vehicle_id = p_vehicle_id
      AND t.status = 'Ongoing'
      AND t.driver_id IS DISTINCT FROM p_driver_id
  ) THEN
    RAISE EXCEPTION 'Vehicle % currently has an ongoing trip with another driver.', v_vehicle.number;
  END IF;

  v_target_status := CASE WHEN v_assign_date <= v_today_ist THEN 'Assigned' ELSE 'Scheduled' END;
  v_is_active := (v_target_status = 'Assigned');

  IF p_assignment_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.vehicle_assignments WHERE id = p_assignment_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Assignment record not found.';
    END IF;
    IF v_existing.status IN ('Completed', 'Cancelled') THEN
      RAISE EXCEPTION 'Historical completed or cancelled assignments cannot be modified.';
    END IF;
    IF v_existing.status = 'In Progress' THEN
      RAISE EXCEPTION 'Cannot reassign an assignment that is currently In Progress.';
    END IF;
  END IF;

  IF v_is_active AND EXISTS (
    SELECT 1 FROM public.vehicle_assignments va
    WHERE va.driver_id = p_driver_id
      AND va.is_active = true
      AND (p_assignment_id IS NULL OR va.id <> p_assignment_id)
  ) THEN
    RAISE EXCEPTION 'Driver % already has an active assignment. Complete or cancel the existing assignment first.', v_driver.name;
  END IF;

  IF v_is_active AND EXISTS (
    SELECT 1 FROM public.vehicle_assignments va
    WHERE va.vehicle_id = p_vehicle_id
      AND va.is_active = true
      AND (p_assignment_id IS NULL OR va.id <> p_assignment_id)
  ) THEN
    RAISE EXCEPTION 'Vehicle % is already actively assigned to another driver.', v_vehicle.number;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.vehicle_assignments va
    WHERE va.assignment_date = v_assign_date
      AND va.status IN ('Scheduled', 'Assigned', 'In Progress')
      AND (va.driver_id = p_driver_id OR va.vehicle_id = p_vehicle_id)
      AND (p_assignment_id IS NULL OR va.id <> p_assignment_id)
  ) THEN
    RAISE EXCEPTION 'A conflicting assignment already exists for this driver or vehicle on %.', v_assign_date;
  END IF;

  IF p_assignment_id IS NOT NULL THEN
    UPDATE public.vehicle_assignments
    SET
      driver_id = p_driver_id,
      vehicle_id = p_vehicle_id,
      route_id = p_route_id,
      route_name = v_route.name,
      route_snapshot = v_route_snapshot,
      assignment_date = v_assign_date,
      departure_time = v_dep_time,
      status = v_target_status,
      is_active = v_is_active,
      notes = NULLIF(TRIM(p_notes), ''),
      assigned_by_profile_id = v_uid,
      updated_at = timezone('utc', now())
    WHERE id = p_assignment_id
    RETURNING * INTO v_saved;
  ELSE
    INSERT INTO public.vehicle_assignments (
      driver_id,
      vehicle_id,
      route_id,
      route_name,
      route_snapshot,
      assignment_date,
      departure_time,
      status,
      is_active,
      notes,
      assigned_by_profile_id,
      assigned_at,
      updated_at
    ) VALUES (
      p_driver_id,
      p_vehicle_id,
      p_route_id,
      v_route.name,
      v_route_snapshot,
      v_assign_date,
      v_dep_time,
      v_target_status,
      v_is_active,
      NULLIF(TRIM(p_notes), ''),
      v_uid,
      timezone('utc', now()),
      timezone('utc', now())
    )
    RETURNING * INTO v_saved;
  END IF;

  IF v_is_active THEN
    UPDATE public.vehicles
    SET route = v_route.name,
        updated_at = timezone('utc', now())
    WHERE id = p_vehicle_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'assignment', to_jsonb(v_saved)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_route_assignment(UUID, UUID, UUID, DATE, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_route_assignment(UUID, UUID, UUID, DATE, TEXT, TEXT, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Update start_driver_trip_statement:
--    Capture immutable `route_snapshot` on `public.trips`
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
  v_assignment public.vehicle_assignments%ROWTYPE;
  v_route public.collection_routes%ROWTYPE;
  v_now_ist TIMESTAMP := timezone('Asia/Kolkata', now());
  v_out_date DATE := COALESCE(p_out_date, v_now_ist::DATE);
  v_out_time TEXT := COALESCE(NULLIF(TRIM(p_out_time), ''), to_char(v_now_ist, 'HH24:MI'));
  v_started_at TIMESTAMP WITH TIME ZONE;
  v_hw_telemetry_odo NUMERIC := 0;
  v_hw_history_odo NUMERIC := 0;
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

  v_out_km := ROUND(GREATEST(COALESCE(v_vehicle.odometer, 0), COALESCE(v_hw_telemetry_odo, 0), COALESCE(v_hw_history_odo, 0))::numeric, 2);

  IF v_out_km > COALESCE(v_vehicle.odometer, 0) THEN
    UPDATE public.vehicles
    SET odometer = v_out_km,
        odometer_source = 'HARDWARE_GPS',
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

REVOKE ALL ON FUNCTION public.start_driver_trip_statement(UUID, TEXT, UUID, TEXT, DATE, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_driver_trip_statement(UUID, TEXT, UUID, TEXT, DATE, TEXT, TEXT) TO authenticated;
