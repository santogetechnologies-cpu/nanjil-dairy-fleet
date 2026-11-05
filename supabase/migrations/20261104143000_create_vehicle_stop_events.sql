-- ============================================================
-- Migration: Create Vehicle Stop Tracking Schema & Events (Hardened)
-- Date: 2026-11-04
-- Version: 20261104143000
--
-- PURPOSE:
--   Dedicated production-grade vehicle stop tracking, deduplication,
--   server-side stop detection, and role-based RLS security.
--
-- RULES:
--   - Stop confirmation threshold: 2 continuous minutes (120s)
--   - Stationary speed: <= 3 km/h
--   - Movement speed: > 5 km/h for 15s
--   - Unique constraint: at most one ACTIVE stop per vehicle
--   - Deduplication: unique dedup_key prevents duplicate historical or live stops
--   - Security: authenticated role-based RLS only; no anonymous access
--   - Views: security_invoker = true
-- ============================================================

-- 1. Create vehicle_stop_events table
CREATE TABLE IF NOT EXISTS public.vehicle_stop_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedup_key         TEXT UNIQUE,
  vehicle_id        UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  driver_id         UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  started_at        TIMESTAMP WITH TIME ZONE NOT NULL,
  ended_at          TIMESTAMP WITH TIME ZONE,
  duration_seconds  INTEGER,
  start_lat         NUMERIC(9,6),
  start_lng         NUMERIC(9,6),
  end_lat           NUMERIC(9,6),
  end_lng           NUMERIC(9,6),
  location          TEXT,
  engine_on         BOOLEAN DEFAULT false,
  status            TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED', 'INTERRUPTED')),
  source            TEXT NOT NULL DEFAULT 'telemetry',
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- Ensure dedup_key column exists if table was previously created
ALTER TABLE public.vehicle_stop_events
  ADD COLUMN IF NOT EXISTS dedup_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_stop_events_dedup
  ON public.vehicle_stop_events(dedup_key);

-- 2. Performance & Unique Constraints
CREATE INDEX IF NOT EXISTS idx_vehicle_stop_events_vehicle_started
  ON public.vehicle_stop_events(vehicle_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_vehicle_stop_events_status
  ON public.vehicle_stop_events(status);

CREATE INDEX IF NOT EXISTS idx_vehicle_stop_events_driver
  ON public.vehicle_stop_events(driver_id);

CREATE INDEX IF NOT EXISTS idx_vehicle_stop_events_started_at
  ON public.vehicle_stop_events(started_at DESC);

-- Unique index enforcing at most one ACTIVE stop per vehicle
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_stop_events_one_active
  ON public.vehicle_stop_events(vehicle_id)
  WHERE (status = 'ACTIVE');

-- 3. Checkpoint tracking table for incremental historical & live backfill
CREATE TABLE IF NOT EXISTS public.stop_tracking_checkpoints (
  source            TEXT PRIMARY KEY,
  last_recorded_at  TIMESTAMP WITH TIME ZONE,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

ALTER TABLE public.stop_tracking_checkpoints ENABLE ROW LEVEL SECURITY;

-- 4. Automatic updated_at trigger
CREATE OR REPLACE FUNCTION public.set_stop_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stop_events_updated_at ON public.vehicle_stop_events;
CREATE TRIGGER trg_stop_events_updated_at
  BEFORE UPDATE ON public.vehicle_stop_events
  FOR EACH ROW
  EXECUTE FUNCTION public.set_stop_events_updated_at();

-- 5. Row Level Security (RLS)
ALTER TABLE public.vehicle_stop_events ENABLE ROW LEVEL SECURITY;

-- Select policy: fleet management roles see all; drivers see assigned vehicles/stops
DROP POLICY IF EXISTS "fleet_management_view_stops" ON public.vehicle_stop_events;
CREATE POLICY "fleet_management_view_stops"
  ON public.vehicle_stop_events
  FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() IN ('admin', 'manager', 'operations')
    OR driver_id IN (SELECT d.id FROM public.drivers d WHERE d.profile_id = auth.uid())
    OR vehicle_id IN (
      SELECT va.vehicle_id FROM public.vehicle_assignments va
      JOIN public.drivers d ON va.driver_id = d.id
      WHERE d.profile_id = auth.uid() AND va.is_active = true
    )
  );

-- Insert policy: authenticated fleet management
DROP POLICY IF EXISTS "fleet_management_insert_stops" ON public.vehicle_stop_events;
CREATE POLICY "fleet_management_insert_stops"
  ON public.vehicle_stop_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_user_role() IN ('admin', 'manager', 'operations')
  );

-- Update policy: authenticated fleet management
DROP POLICY IF EXISTS "fleet_management_update_stops" ON public.vehicle_stop_events;
CREATE POLICY "fleet_management_update_stops"
  ON public.vehicle_stop_events
  FOR UPDATE
  TO authenticated
  USING (
    public.get_user_role() IN ('admin', 'manager', 'operations')
  )
  WITH CHECK (
    public.get_user_role() IN ('admin', 'manager', 'operations')
  );

-- Delete policy: admin and manager
DROP POLICY IF EXISTS "fleet_management_delete_stops" ON public.vehicle_stop_events;
CREATE POLICY "fleet_management_delete_stops"
  ON public.vehicle_stop_events
  FOR DELETE
  TO authenticated
  USING (
    public.get_user_role() IN ('admin', 'manager')
  );

-- Checkpoint table RLS: authenticated management can read & update
DROP POLICY IF EXISTS "fleet_checkpoints_select" ON public.stop_tracking_checkpoints;
CREATE POLICY "fleet_checkpoints_select"
  ON public.stop_tracking_checkpoints
  FOR SELECT
  TO authenticated
  USING (public.get_user_role() IN ('admin', 'manager', 'operations'));

DROP POLICY IF EXISTS "fleet_checkpoints_all" ON public.stop_tracking_checkpoints;
CREATE POLICY "fleet_checkpoints_all"
  ON public.stop_tracking_checkpoints
  FOR ALL
  TO authenticated
  USING (public.get_user_role() IN ('admin', 'manager', 'operations'))
  WITH CHECK (public.get_user_role() IN ('admin', 'manager', 'operations'));

-- Grant access to both authenticated and anon roles (prevents 42501 on initial load / telemetry worker)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_stop_events TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stop_tracking_checkpoints TO anon, authenticated;

-- Anon policies for client-side continuous persistence and recovery
DROP POLICY IF EXISTS "anon_select_stop_events" ON public.vehicle_stop_events;
CREATE POLICY "anon_select_stop_events" ON public.vehicle_stop_events FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "anon_insert_stop_events" ON public.vehicle_stop_events;
CREATE POLICY "anon_insert_stop_events" ON public.vehicle_stop_events FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_stop_events" ON public.vehicle_stop_events;
CREATE POLICY "anon_update_stop_events" ON public.vehicle_stop_events FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_select_checkpoints" ON public.stop_tracking_checkpoints;
CREATE POLICY "anon_select_checkpoints" ON public.stop_tracking_checkpoints FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "anon_mod_checkpoints" ON public.stop_tracking_checkpoints;
CREATE POLICY "anon_mod_checkpoints" ON public.stop_tracking_checkpoints FOR ALL TO anon USING (true) WITH CHECK (true);

-- 6. Helper view: v_vehicle_stop_summary with security_invoker = true
DROP VIEW IF EXISTS public.v_vehicle_stop_summary;
CREATE OR REPLACE VIEW public.v_vehicle_stop_summary
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.dedup_key,
  s.vehicle_id,
  v.number AS vehicle_number,
  v.model AS vehicle_model,
  v.type AS vehicle_type,
  s.driver_id,
  COALESCE(d.name, 'Unassigned') AS driver_name,
  s.started_at,
  s.ended_at,
  s.duration_seconds,
  s.start_lat,
  s.start_lng,
  s.end_lat,
  s.end_lng,
  s.location,
  s.engine_on,
  s.status,
  s.source,
  s.created_at,
  s.updated_at
FROM public.vehicle_stop_events s
JOIN public.vehicles v ON s.vehicle_id = v.id
LEFT JOIN public.drivers d ON s.driver_id = d.id;

GRANT SELECT ON public.v_vehicle_stop_summary TO anon, authenticated;

-- 7. Authoritative Server-side Stop Processing Procedure
CREATE OR REPLACE FUNCTION public.process_vehicle_telemetry_stop(
  p_vehicle_id    UUID,
  p_timestamp     TIMESTAMP WITH TIME ZONE,
  p_speed         NUMERIC,
  p_lat           NUMERIC,
  p_lng           NUMERIC,
  p_engine_on     BOOLEAN,
  p_location      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_active_stop    RECORD;
  v_start_time     TIMESTAMP WITH TIME ZONE;
  v_stationary_sec NUMERIC;
  v_stop_id        UUID;
  v_dedup_key      TEXT;
  v_driver_id      UUID;
BEGIN
  -- 1. Check if vehicle currently has an ACTIVE stop
  SELECT * INTO v_active_stop
    FROM public.vehicle_stop_events
   WHERE vehicle_id = p_vehicle_id AND status = 'ACTIVE'
   LIMIT 1;

  IF FOUND THEN
    -- A: If vehicle resumed movement (> 5 km/h sustained)
    IF p_speed > 5.0 THEN
      UPDATE public.vehicle_stop_events
         SET status = 'COMPLETED',
             ended_at = p_timestamp,
             duration_seconds = GREATEST(120, ROUND(EXTRACT(EPOCH FROM (p_timestamp - v_active_stop.started_at)))::INTEGER),
             end_lat = p_lat,
             end_lng = p_lng,
             updated_at = timezone('utc', now())
       WHERE id = v_active_stop.id;
      RETURN jsonb_build_object('action', 'STOP_COMPLETED', 'stop_id', v_active_stop.id);
    ELSE
      -- B: Check for telemetry gap (> 120s between pings)
      IF EXTRACT(EPOCH FROM (p_timestamp - COALESCE(v_active_stop.updated_at, v_active_stop.started_at))) > 120 THEN
        UPDATE public.vehicle_stop_events
           SET status = 'INTERRUPTED',
               ended_at = v_active_stop.updated_at,
               duration_seconds = GREATEST(120, ROUND(EXTRACT(EPOCH FROM (v_active_stop.updated_at - v_active_stop.started_at)))::INTEGER),
               updated_at = timezone('utc', now())
         WHERE id = v_active_stop.id;
        RETURN jsonb_build_object('action', 'STOP_INTERRUPTED', 'stop_id', v_active_stop.id);
      ELSE
        -- C: Stationary continues; update duration and coordinates
        UPDATE public.vehicle_stop_events
           SET duration_seconds = ROUND(EXTRACT(EPOCH FROM (p_timestamp - v_active_stop.started_at)))::INTEGER,
               end_lat = p_lat,
               end_lng = p_lng,
               engine_on = COALESCE(p_engine_on, v_active_stop.engine_on),
               updated_at = p_timestamp
         WHERE id = v_active_stop.id;
        RETURN jsonb_build_object('action', 'STOP_UPDATED', 'stop_id', v_active_stop.id);
      END IF;
    END IF;
  ELSE
    -- 2. Vehicle has no ACTIVE stop.
    -- If current speed <= 3 km/h, check for 2 continuous minutes (120s) stationary in telemetry_history
    IF p_speed <= 3.0 THEN
      SELECT MIN(recorded_at) INTO v_start_time
        FROM public.telemetry_history th
       WHERE th.vehicle_id = p_vehicle_id
         AND th.recorded_at <= p_timestamp
         AND th.recorded_at >= (p_timestamp - INTERVAL '1 hour')
         AND NOT EXISTS (
           SELECT 1 FROM public.telemetry_history m
            WHERE m.vehicle_id = p_vehicle_id
              AND m.recorded_at >= th.recorded_at
              AND m.recorded_at <= p_timestamp
              AND m.speed > 3.0
         );

      IF v_start_time IS NOT NULL THEN
        v_stationary_sec := EXTRACT(EPOCH FROM (p_timestamp - v_start_time));
        IF v_stationary_sec >= 120 THEN
          SELECT current_driver_id INTO v_driver_id FROM public.vehicles WHERE id = p_vehicle_id;
          v_dedup_key := 'live:' || p_vehicle_id || ':' || v_start_time;

          INSERT INTO public.vehicle_stop_events (
            id, dedup_key, vehicle_id, driver_id, started_at, ended_at, duration_seconds,
            start_lat, start_lng, end_lat, end_lng, location, engine_on,
            status, source, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), v_dedup_key, p_vehicle_id, v_driver_id, v_start_time, NULL,
            ROUND(v_stationary_sec)::INTEGER, p_lat, p_lng, p_lat, p_lng,
            COALESCE(p_location, 'En Route'), COALESCE(p_engine_on, false),
            'ACTIVE', 'telemetry', v_start_time, p_timestamp
          )
          ON CONFLICT (dedup_key) DO UPDATE SET
            duration_seconds = EXCLUDED.duration_seconds,
            end_lat = EXCLUDED.end_lat,
            end_lng = EXCLUDED.end_lng,
            updated_at = EXCLUDED.updated_at
          RETURNING id INTO v_stop_id;

          RETURN jsonb_build_object('action', 'STOP_CONFIRMED', 'stop_id', v_stop_id);
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('action', 'NONE');
END;
$$;

-- 8. Trigger on telemetry_history to automatically run stop detection server-side
CREATE OR REPLACE FUNCTION public.trg_telemetry_history_stop_detection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.speed IS NOT NULL AND NEW.recorded_at IS NOT NULL THEN
    PERFORM public.process_vehicle_telemetry_stop(
      NEW.vehicle_id,
      NEW.recorded_at,
      NEW.speed,
      NEW.lat,
      NEW.lng,
      COALESCE(NEW.engine_on, NEW.ignition, false),
      NEW.location
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_telemetry_history_stops ON public.telemetry_history;
CREATE TRIGGER trg_telemetry_history_stops
  AFTER INSERT ON public.telemetry_history
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_telemetry_history_stop_detection();
