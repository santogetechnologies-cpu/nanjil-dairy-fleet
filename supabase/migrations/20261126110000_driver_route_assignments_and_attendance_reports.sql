-- =============================================================================
-- Migration: Driver-Vehicle-Route Assignment & Attendance History Reports
-- Date: 2026-11-26
-- Version: 20261126110000
--
-- Reuses existing tables:
--   - public.vehicle_assignments (extended cleanly for route, date, time, status, notes)
--   - public.driver_shifts (linked to assignment_id & route_id for attendance audits)
--   - public.trips (linked to assignment_id alongside existing route_id)
--   - public.collection_routes
--
-- Security & Data Integrity:
--   - Idempotent DDL & policy updates; never drops existing user data.
--   - Strict authenticated RLS: Admin/Manager see fleet-wide; Drivers see only own rows.
--   - Hardened SECURITY DEFINER RPCs with explicit role/ownership checks.
--   - Enforces unique active assignments per driver & per vehicle while preserving history.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extend public.vehicle_assignments (non-destructive)
-- -----------------------------------------------------------------------------
ALTER TABLE public.vehicle_assignments
  ADD COLUMN IF NOT EXISTS route_id UUID REFERENCES public.collection_routes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS route_name TEXT,
  ADD COLUMN IF NOT EXISTS assignment_date DATE,
  ADD COLUMN IF NOT EXISTS departure_time TEXT DEFAULT '05:30',
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Assigned',
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS assigned_by_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc', now());

-- Backfill assignment_date and status safely on historical rows
UPDATE public.vehicle_assignments
SET
  assignment_date = COALESCE(assignment_date, (timezone('Asia/Kolkata', assigned_at))::DATE),
  status = CASE
    WHEN status IN ('Scheduled', 'Assigned', 'In Progress', 'Completed', 'Cancelled') THEN status
    WHEN is_active = true THEN 'Assigned'
    WHEN unassigned_at IS NOT NULL THEN 'Completed'
    ELSE 'Completed'
  END
WHERE assignment_date IS NULL
   OR status IS NULL
   OR status NOT IN ('Scheduled', 'Assigned', 'In Progress', 'Completed', 'Cancelled');

ALTER TABLE public.vehicle_assignments
  ALTER COLUMN assignment_date SET NOT NULL,
  ALTER COLUMN assignment_date SET DEFAULT (timezone('Asia/Kolkata', now()))::DATE,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'Assigned';

ALTER TABLE public.vehicle_assignments
  DROP CONSTRAINT IF EXISTS chk_vehicle_assignments_status;

ALTER TABLE public.vehicle_assignments
  ADD CONSTRAINT chk_vehicle_assignments_status
  CHECK (status IN ('Scheduled', 'Assigned', 'In Progress', 'Completed', 'Cancelled'));

-- Clean up any legacy duplicate active driver assignments before enforcing unique driver index
WITH ranked_active_driver AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY driver_id ORDER BY assigned_at DESC, id DESC) AS rn
  FROM public.vehicle_assignments
  WHERE is_active = true
)
UPDATE public.vehicle_assignments
SET is_active = false,
    unassigned_at = COALESCE(unassigned_at, timezone('utc', now())),
    status = CASE WHEN status IN ('Assigned', 'In Progress') THEN 'Completed' ELSE status END,
    updated_at = timezone('utc', now())
WHERE id IN (SELECT id FROM ranked_active_driver WHERE rn > 1);

-- Prevent duplicate active assignments on same vehicle OR same driver
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_assignments_active
  ON public.vehicle_assignments (vehicle_id)
  WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_assignments_active_driver
  ON public.vehicle_assignments (driver_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_date_status
  ON public.vehicle_assignments (assignment_date DESC, status);

CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_driver_date
  ON public.vehicle_assignments (driver_id, assignment_date DESC);

-- -----------------------------------------------------------------------------
-- 2. Link public.driver_shifts & public.trips cleanly to assignments/routes
-- -----------------------------------------------------------------------------
ALTER TABLE public.driver_shifts
  ADD COLUMN IF NOT EXISTS assignment_id UUID REFERENCES public.vehicle_assignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS route_id UUID REFERENCES public.collection_routes(id) ON DELETE SET NULL;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS assignment_id UUID REFERENCES public.vehicle_assignments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_driver_shifts_started_at
  ON public.driver_shifts (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_driver_shifts_driver_started
  ON public.driver_shifts (driver_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_trips_route_id_date
  ON public.trips (route_id, date DESC);

-- -----------------------------------------------------------------------------
-- 3. Strengthen RLS across vehicle_assignments, driver_shifts, collection_routes
--    (Zero anonymous access; Admin/Manager fleet-wide; Driver scoped strictly to self)
-- -----------------------------------------------------------------------------
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.vehicle_assignments FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.driver_shifts FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.collection_routes FROM anon;
REVOKE DELETE ON public.driver_shifts FROM authenticated;
REVOKE DELETE ON public.trips FROM authenticated;

DROP POLICY IF EXISTS "Allow anon select vehicle_assignments" ON public.vehicle_assignments;
DROP POLICY IF EXISTS "Allow select assignments" ON public.vehicle_assignments;
DROP POLICY IF EXISTS "Allow insert assignments" ON public.vehicle_assignments;
DROP POLICY IF EXISTS "Allow update assignments" ON public.vehicle_assignments;
DROP POLICY IF EXISTS "Allow delete assignments" ON public.vehicle_assignments;

CREATE POLICY "Authenticated select own or fleet assignments"
  ON public.vehicle_assignments
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

CREATE POLICY "Admin manager insert assignments"
  ON public.vehicle_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.status = 'Active'
        AND p.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admin manager update assignments"
  ON public.vehicle_assignments
  FOR UPDATE
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

DROP POLICY IF EXISTS "Allow select shifts" ON public.driver_shifts;
DROP POLICY IF EXISTS "Allow insert shifts" ON public.driver_shifts;
DROP POLICY IF EXISTS "Allow update shifts" ON public.driver_shifts;
DROP POLICY IF EXISTS "Allow delete shifts" ON public.driver_shifts;

CREATE POLICY "Authenticated select own or fleet shifts"
  ON public.driver_shifts
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

-- Drivers clock in/out via RPCs; keep Admin/Manager manage shifts policy
CREATE POLICY "Admin manager manage shifts"
  ON public.driver_shifts
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

DROP POLICY IF EXISTS "Allow anon select collection_routes" ON public.collection_routes;
DROP POLICY IF EXISTS "Allow select collection routes" ON public.collection_routes;
DROP POLICY IF EXISTS "Allow insert collection routes" ON public.collection_routes;
DROP POLICY IF EXISTS "Allow update collection routes" ON public.collection_routes;
DROP POLICY IF EXISTS "Allow delete collection routes" ON public.collection_routes;

CREATE POLICY "Authenticated select assigned or fleet routes"
  ON public.collection_routes
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
    OR id IN (
      SELECT va.route_id
      FROM public.vehicle_assignments va
      JOIN public.drivers d ON d.id = va.driver_id
      WHERE d.profile_id = auth.uid() AND va.route_id IS NOT NULL
    )
    OR id IN (
      SELECT t.route_id
      FROM public.trips t
      JOIN public.drivers d ON d.id = t.driver_id
      WHERE d.profile_id = auth.uid() AND t.route_id IS NOT NULL
    )
  );

CREATE POLICY "Admin manager manage collection routes"
  ON public.collection_routes
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
-- 4. Enable Realtime on vehicle_assignments & collection_routes & trips
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'vehicle_assignments') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_assignments;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'trips') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'drivers') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
    END IF;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Internal Helper: Assert active Admin or Manager caller
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._assert_admin_or_manager()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR v_profile.status <> 'Active' OR v_profile.role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'Unauthorized: Active Admin or Manager permissions required.';
  END IF;

  RETURN v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_admin_or_manager() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Admin RPC: admin_save_route_assignment
--    Creates or edits a Driver-Vehicle-Route assignment atomically with
--    conflict prevention, availability checks, and historical preservation.
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

  -- Check vehicle operational availability (do not assign vehicles with ongoing trip on another driver)
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

  -- Prevent duplicate / conflicting active assignments for the driver
  IF v_is_active AND EXISTS (
    SELECT 1 FROM public.vehicle_assignments va
    WHERE va.driver_id = p_driver_id
      AND va.is_active = true
      AND (p_assignment_id IS NULL OR va.id <> p_assignment_id)
  ) THEN
    RAISE EXCEPTION 'Driver % already has an active assignment. Complete or cancel the existing assignment first.', v_driver.name;
  END IF;

  -- Prevent duplicate / conflicting active assignments for the vehicle
  IF v_is_active AND EXISTS (
    SELECT 1 FROM public.vehicle_assignments va
    WHERE va.vehicle_id = p_vehicle_id
      AND va.is_active = true
      AND (p_assignment_id IS NULL OR va.id <> p_assignment_id)
  ) THEN
    RAISE EXCEPTION 'Vehicle % is already actively assigned to another driver.', v_vehicle.number;
  END IF;

  -- Prevent conflicting Scheduled assignments for same driver OR same vehicle on same date
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

  -- Sync vehicle's assigned route label when immediately active
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
-- 7. Admin RPC: admin_cancel_route_assignment
--    Cancels an open or scheduled assignment while preserving history intact.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_cancel_route_assignment(
  p_assignment_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.vehicle_assignments%ROWTYPE;
  v_cancelled public.vehicle_assignments%ROWTYPE;
BEGIN
  PERFORM public._assert_admin_or_manager();

  IF p_assignment_id IS NULL THEN
    RAISE EXCEPTION 'Assignment ID is required.';
  END IF;

  SELECT * INTO v_existing FROM public.vehicle_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment record not found.';
  END IF;

  IF v_existing.status = 'Completed' THEN
    RAISE EXCEPTION 'Completed assignments are permanent historical records and cannot be cancelled.';
  END IF;

  IF v_existing.status = 'In Progress' OR EXISTS (
    SELECT 1 FROM public.trips WHERE assignment_id = p_assignment_id AND status = 'Ongoing'
  ) THEN
    RAISE EXCEPTION 'Cannot cancel an assignment while driver has an ongoing trip in progress.';
  END IF;

  UPDATE public.vehicle_assignments
  SET
    status = 'Cancelled',
    is_active = false,
    unassigned_at = timezone('utc', now()),
    notes = COALESCE(NULLIF(TRIM(p_reason), ''), notes),
    updated_at = timezone('utc', now())
  WHERE id = p_assignment_id
  RETURNING * INTO v_cancelled;

  RETURN jsonb_build_object(
    'ok', true,
    'assignment', to_jsonb(v_cancelled)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cancel_route_assignment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_route_assignment(UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. Update Driver Workflow RPCs (preserving existing signatures)
--    - driver_clock_in(): promotes due Scheduled assignment if needed, updates
--      status -> 'In Progress', records assignment_id & route_id in driver_shifts
--    - driver_clock_out(): ends shift cleanly & completes route assignment
--    - start_driver_trip_statement(): auto-links assignment_id & route_id
--    - close_driver_trip_statement(): completes route assignment cleanly
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
  v_route public.collection_routes%ROWTYPE;
  v_existing_shift public.driver_shifts%ROWTYPE;
  v_active_trip public.trips%ROWTYPE;
  v_new_shift public.driver_shifts%ROWTYPE;
  v_today_ist DATE := (timezone('Asia/Kolkata', now()))::DATE;
  v_hw_tel_odo NUMERIC := 0;
  v_hw_hist_odo NUMERIC := 0;
  v_auth_odo NUMERIC(12, 2) := 0;
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

  -- Mark assignment status as In Progress upon clock in
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

  v_auth_odo := ROUND(GREATEST(COALESCE(v_vehicle.odometer, 0), COALESCE(v_hw_tel_odo, 0), COALESCE(v_hw_hist_odo, 0))::numeric, 2);

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

REVOKE ALL ON FUNCTION public.driver_clock_in() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_clock_in() TO authenticated;

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

  -- If this shift came from a Driver & Route assignment with no trip started, revert 'In Progress' -> 'Assigned'
  -- or keep historical integrity if trips were completed on this assignment.
  IF v_shift.assignment_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.trips WHERE assignment_id = v_shift.assignment_id AND status = 'Completed') THEN
      UPDATE public.vehicle_assignments
      SET status = 'Completed',
          is_active = false,
          unassigned_at = COALESCE(unassigned_at, v_now),
          updated_at = v_now
      WHERE id = v_shift.assignment_id;
    ELSE
      UPDATE public.vehicle_assignments
      SET status = 'Assigned',
          updated_at = v_now
      WHERE id = v_shift.assignment_id AND status = 'In Progress';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'shift', to_jsonb(v_shift)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_clock_out() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_clock_out() TO authenticated;

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
    NULLIF(TRIM(p_route), ''),
    NULLIF(TRIM(v_route.name), ''),
    NULLIF(TRIM(v_assignment.route_name), ''),
    NULLIF(TRIM(v_vehicle.route), ''),
    'Collection Route'
  );

  IF v_route.id IS NOT NULL AND v_route.route_config IS NOT NULL THEN
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

  -- Close driver's active shift atomically on trip closure
  UPDATE public.driver_shifts
  SET
    ended_at = v_in_ts,
    active_hours = GREATEST(0, ROUND((EXTRACT(EPOCH FROM (v_in_ts - started_at)) / 3600.0)::numeric, 2)),
    updated_at = timezone('utc', now())
  WHERE driver_id = v_driver.id
    AND ended_at IS NULL;

  -- Complete linked Driver & Route assignment while preserving the record for history
  UPDATE public.vehicle_assignments
  SET
    status = 'Completed',
    is_active = false,
    unassigned_at = COALESCE(unassigned_at, v_in_ts),
    updated_at = timezone('utc', now())
  WHERE driver_id = v_driver.id
    AND vehicle_id = v_trip.vehicle_id
    AND (
      (v_trip.assignment_id IS NOT NULL AND id = v_trip.assignment_id)
      OR (is_active = true AND route_id IS NOT NULL)
    );

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
