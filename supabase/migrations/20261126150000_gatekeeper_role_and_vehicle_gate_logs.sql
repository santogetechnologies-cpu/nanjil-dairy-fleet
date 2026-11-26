-- =============================================================================
-- Migration: Gate Keeper Role & Vehicle Outgoing / Incoming Gate Logs
-- =============================================================================
-- Purpose:
--   1. Add 'gatekeeper' to public.profiles role CHECK constraint.
--   2. Create public.vehicle_gate_logs table to record vehicle outgoing time,
--      incoming time, driver name, and optional salesman name at the gate.
--   3. Configure strict RLS policies and atomic SECURITY DEFINER RPCs so active
--      gatekeeper, admin, manager, and operations users can record and audit
--      gate entries securely.
--   4. Add vehicle_gate_logs to supabase_realtime publication.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Expand public.profiles role CHECK constraint to include 'gatekeeper'
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('admin', 'manager', 'driver', 'operations', 'gatekeeper'));
END $$;

-- -----------------------------------------------------------------------------
-- 2. Create public.vehicle_gate_logs table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicle_gate_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id            UUID NULL REFERENCES public.vehicles(id) ON DELETE SET NULL,
  vehicle_number        TEXT NOT NULL,
  driver_id             UUID NULL REFERENCES public.drivers(id) ON DELETE SET NULL,
  driver_name           TEXT NOT NULL,
  salesman_name         TEXT NULL,
  log_date              DATE NOT NULL DEFAULT ((NOW() AT TIME ZONE 'Asia/Kolkata')::date),
  outgoing_at           TIMESTAMPTZ NOT NULL,
  outgoing_time         TEXT NOT NULL,
  incoming_at           TIMESTAMPTZ NULL,
  incoming_time         TEXT NULL,
  status                TEXT NOT NULL DEFAULT 'Out' CHECK (status IN ('Out', 'Returned')),
  notes                 TEXT NULL,
  gatekeeper_profile_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  gatekeeper_name       TEXT NULL,
  closed_by_profile_id  UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  closed_by_name        TEXT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_gate_log_incoming_after_outgoing
    CHECK (incoming_at IS NULL OR incoming_at >= outgoing_at)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_gate_logs_log_date
  ON public.vehicle_gate_logs(log_date DESC, outgoing_at DESC);

CREATE INDEX IF NOT EXISTS idx_vehicle_gate_logs_vehicle_status
  ON public.vehicle_gate_logs(vehicle_id, status);

CREATE INDEX IF NOT EXISTS idx_vehicle_gate_logs_status
  ON public.vehicle_gate_logs(status, outgoing_at DESC);

CREATE INDEX IF NOT EXISTS idx_vehicle_gate_logs_gatekeeper
  ON public.vehicle_gate_logs(gatekeeper_profile_id, log_date DESC);

DROP TRIGGER IF EXISTS tr_vehicle_gate_logs_updated_at ON public.vehicle_gate_logs;
CREATE TRIGGER tr_vehicle_gate_logs_updated_at
  BEFORE UPDATE ON public.vehicle_gate_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Enable RLS & Grants (zero anon access; authenticated gatekeeper/admin/mgr)
-- -----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.vehicle_gate_logs FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.vehicle_gate_logs TO authenticated;

ALTER TABLE public.vehicle_gate_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gate_logs_select_staff" ON public.vehicle_gate_logs;
CREATE POLICY "gate_logs_select_staff"
  ON public.vehicle_gate_logs
  FOR SELECT
  TO authenticated
  USING (public.get_user_role() IN ('admin', 'manager', 'operations', 'gatekeeper'));

DROP POLICY IF EXISTS "gate_logs_insert_staff" ON public.vehicle_gate_logs;
CREATE POLICY "gate_logs_insert_staff"
  ON public.vehicle_gate_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'manager', 'operations', 'gatekeeper'));

DROP POLICY IF EXISTS "gate_logs_update_staff" ON public.vehicle_gate_logs;
CREATE POLICY "gate_logs_update_staff"
  ON public.vehicle_gate_logs
  FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('admin', 'manager', 'operations', 'gatekeeper'))
  WITH CHECK (public.get_user_role() IN ('admin', 'manager', 'operations', 'gatekeeper'));

DROP POLICY IF EXISTS "gate_logs_delete_admin" ON public.vehicle_gate_logs;
CREATE POLICY "gate_logs_delete_admin"
  ON public.vehicle_gate_logs
  FOR DELETE
  TO authenticated
  USING (public.get_user_role() IN ('admin', 'manager'));

-- -----------------------------------------------------------------------------
-- 4. Enable Supabase Realtime on vehicle_gate_logs
-- -----------------------------------------------------------------------------
ALTER TABLE public.vehicle_gate_logs REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'vehicle_gate_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_gate_logs;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Internal Helper: Assert Active Gatekeeper, Admin, or Manager Caller
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._assert_gatekeeper_or_staff()
RETURNS public.profiles
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
  IF NOT FOUND OR v_profile.status <> 'Active' OR v_profile.role NOT IN ('gatekeeper', 'admin', 'manager', 'operations') THEN
    RAISE EXCEPTION 'Unauthorized: Active Gate Keeper or Fleet Admin permissions required.';
  END IF;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_gatekeeper_or_staff() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. RPC: gatekeeper_record_vehicle_out
--    Records vehicle outgoing entry at the gate (or complete Out+In entry when
--    p_incoming_at / p_incoming_time are provided simultaneously).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gatekeeper_record_vehicle_out(
  p_vehicle_id UUID DEFAULT NULL,
  p_vehicle_number TEXT DEFAULT '',
  p_driver_id UUID DEFAULT NULL,
  p_driver_name TEXT DEFAULT '',
  p_salesman_name TEXT DEFAULT NULL,
  p_log_date DATE DEFAULT NULL,
  p_outgoing_at TIMESTAMPTZ DEFAULT NULL,
  p_outgoing_time TEXT DEFAULT NULL,
  p_incoming_at TIMESTAMPTZ DEFAULT NULL,
  p_incoming_time TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_veh_id UUID := p_vehicle_id;
  v_veh_num TEXT := NULLIF(TRIM(COALESCE(p_vehicle_number, '')), '');
  v_drv_id UUID := p_driver_id;
  v_drv_name TEXT := NULLIF(TRIM(COALESCE(p_driver_name, '')), '');
  v_salesman TEXT := NULLIF(TRIM(COALESCE(p_salesman_name, '')), '');
  v_out_at TIMESTAMPTZ := COALESCE(p_outgoing_at, NOW());
  v_out_time TEXT := NULLIF(TRIM(COALESCE(p_outgoing_time, '')), '');
  v_in_at TIMESTAMPTZ := p_incoming_at;
  v_in_time TEXT := NULLIF(TRIM(COALESCE(p_incoming_time, '')), '');
  v_date DATE := COALESCE(p_log_date, (v_out_at AT TIME ZONE 'Asia/Kolkata')::date);
  v_status TEXT := CASE WHEN v_in_at IS NOT NULL THEN 'Returned' ELSE 'Out' END;
  v_row public.vehicle_gate_logs%ROWTYPE;
BEGIN
  v_profile := public._assert_gatekeeper_or_staff();

  -- Resolve vehicle number/id cleanly
  IF v_veh_id IS NOT NULL THEN
    SELECT id, number INTO v_veh_id, v_veh_num FROM public.vehicles WHERE id = v_veh_id;
  ELSIF v_veh_num IS NOT NULL THEN
    SELECT id, number INTO v_veh_id, v_veh_num
    FROM public.vehicles
    WHERE UPPER(REPLACE(number, ' ', '')) = UPPER(REPLACE(v_veh_num, ' ', ''))
    LIMIT 1;
    v_veh_num := COALESCE(v_veh_num, TRIM(p_vehicle_number));
  END IF;

  IF v_veh_num IS NULL THEN
    RAISE EXCEPTION 'Vehicle registration is required.';
  END IF;

  -- Resolve driver name if only driver_id was passed
  IF v_drv_id IS NOT NULL AND v_drv_name IS NULL THEN
    SELECT name INTO v_drv_name FROM public.drivers WHERE id = v_drv_id;
  END IF;

  IF v_drv_name IS NULL THEN
    RAISE EXCEPTION 'Driver name is required.';
  END IF;

  IF v_out_time IS NULL THEN
    v_out_time := TO_CHAR(v_out_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI');
  END IF;

  IF v_in_at IS NOT NULL THEN
    IF v_in_at < v_out_at THEN
      RAISE EXCEPTION 'Incoming time cannot be earlier than outgoing time.';
    END IF;
    IF v_in_time IS NULL THEN
      v_in_time := TO_CHAR(v_in_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI');
    END IF;
  END IF;

  -- Prevent duplicate active 'Out' gate entry for the same vehicle unless already Returned
  IF v_status = 'Out' AND EXISTS (
    SELECT 1
    FROM public.vehicle_gate_logs g
    WHERE g.status = 'Out'
      AND (
        (v_veh_id IS NOT NULL AND g.vehicle_id = v_veh_id)
        OR UPPER(REPLACE(g.vehicle_number, ' ', '')) = UPPER(REPLACE(v_veh_num, ' ', ''))
      )
  ) THEN
    RAISE EXCEPTION 'Vehicle % already has an active Out entry. Record incoming time first.', v_veh_num;
  END IF;

  INSERT INTO public.vehicle_gate_logs (
    vehicle_id,
    vehicle_number,
    driver_id,
    driver_name,
    salesman_name,
    log_date,
    outgoing_at,
    outgoing_time,
    incoming_at,
    incoming_time,
    status,
    notes,
    gatekeeper_profile_id,
    gatekeeper_name,
    closed_by_profile_id,
    closed_by_name
  ) VALUES (
    v_veh_id,
    v_veh_num,
    v_drv_id,
    v_drv_name,
    v_salesman,
    v_date,
    v_out_at,
    v_out_time,
    v_in_at,
    v_in_time,
    v_status,
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    v_profile.id,
    v_profile.name,
    CASE WHEN v_status = 'Returned' THEN v_profile.id ELSE NULL END,
    CASE WHEN v_status = 'Returned' THEN v_profile.name ELSE NULL END
  )
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.gatekeeper_record_vehicle_out(UUID, TEXT, UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gatekeeper_record_vehicle_out(UUID, TEXT, UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, TEXT, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. RPC: gatekeeper_record_vehicle_in
--    Marks an open 'Out' gate entry as 'Returned' with incoming timestamp/time.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gatekeeper_record_vehicle_in(
  p_log_id UUID,
  p_incoming_at TIMESTAMPTZ DEFAULT NULL,
  p_incoming_time TEXT DEFAULT NULL,
  p_salesman_name TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_existing public.vehicle_gate_logs%ROWTYPE;
  v_in_at TIMESTAMPTZ := COALESCE(p_incoming_at, NOW());
  v_in_time TEXT := NULLIF(TRIM(COALESCE(p_incoming_time, '')), '');
  v_salesman TEXT := NULLIF(TRIM(COALESCE(p_salesman_name, '')), '');
  v_notes TEXT := NULLIF(TRIM(COALESCE(p_notes, '')), '');
  v_updated public.vehicle_gate_logs%ROWTYPE;
BEGIN
  v_profile := public._assert_gatekeeper_or_staff();

  SELECT * INTO v_existing
  FROM public.vehicle_gate_logs
  WHERE id = p_log_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate log record not found.';
  END IF;

  IF v_existing.status = 'Returned' THEN
    RAISE EXCEPTION 'Incoming time is already recorded for this gate entry.';
  END IF;

  IF v_in_at < v_existing.outgoing_at THEN
    RAISE EXCEPTION 'Incoming time cannot be earlier than outgoing time.';
  END IF;

  IF v_in_time IS NULL THEN
    v_in_time := TO_CHAR(v_in_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI');
  END IF;

  UPDATE public.vehicle_gate_logs
  SET
    incoming_at = v_in_at,
    incoming_time = v_in_time,
    salesman_name = COALESCE(v_salesman, v_existing.salesman_name),
    notes = COALESCE(v_notes, v_existing.notes),
    status = 'Returned',
    closed_by_profile_id = v_profile.id,
    closed_by_name = v_profile.name,
    updated_at = NOW()
  WHERE id = p_log_id
  RETURNING * INTO v_updated;

  RETURN to_jsonb(v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.gatekeeper_record_vehicle_in(UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gatekeeper_record_vehicle_in(UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT) TO authenticated;
