-- ============================================================
-- Migration: Create Vehicle Stop Tracking Schema & Events
-- Date: 2026-11-04
-- Version: 20261104143000
--
-- PURPOSE:
--   Dedicated vehicle stop tracking and historical stop audits
--   for the Nanjil Dairy Fleet Management System.
--
-- ARCHITECTURE:
--   Telemetry (Firebase / EMQX) -> Stop Detection Engine
--     -> vehicle_stop_events (confirmed stop records)
--     -> v_vehicle_stop_summary (enriched view)
--
-- RULES:
--   - Stop confirmation threshold: 2 continuous minutes
--   - Unique constraint: at most one ACTIVE stop per vehicle
--   - Role-based RLS: authenticated operations & drivers
-- ============================================================

-- 1. Create vehicle_stop_events table
CREATE TABLE IF NOT EXISTS public.vehicle_stop_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

-- 2. Performance indexes
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

-- 3. Automatic updated_at trigger
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

-- 4. Row Level Security (RLS)
ALTER TABLE public.vehicle_stop_events ENABLE ROW LEVEL SECURITY;

-- Select policy: fleet managers view all stops, drivers view their own stops
DROP POLICY IF EXISTS "fleet_management_view_stops" ON public.vehicle_stop_events;
CREATE POLICY "fleet_management_view_stops"
  ON public.vehicle_stop_events
  FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() IN ('admin', 'manager', 'supervisor', 'operations', 'logistics')
    OR driver_id IN (SELECT id FROM public.drivers WHERE profile_id = auth.uid())
  );

-- Insert policy
DROP POLICY IF EXISTS "fleet_management_insert_stops" ON public.vehicle_stop_events;
CREATE POLICY "fleet_management_insert_stops"
  ON public.vehicle_stop_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_user_role() IN ('admin', 'manager', 'supervisor', 'operations', 'logistics')
  );

-- Update policy
DROP POLICY IF EXISTS "fleet_management_update_stops" ON public.vehicle_stop_events;
CREATE POLICY "fleet_management_update_stops"
  ON public.vehicle_stop_events
  FOR UPDATE
  TO authenticated
  USING (
    public.get_user_role() IN ('admin', 'manager', 'supervisor', 'operations', 'logistics')
  )
  WITH CHECK (
    public.get_user_role() IN ('admin', 'manager', 'supervisor', 'operations', 'logistics')
  );

-- Delete policy
DROP POLICY IF EXISTS "fleet_management_delete_stops" ON public.vehicle_stop_events;
CREATE POLICY "fleet_management_delete_stops"
  ON public.vehicle_stop_events
  FOR DELETE
  TO authenticated
  USING (
    public.get_user_role() IN ('admin', 'manager')
  );

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_stop_events TO authenticated;
GRANT SELECT ON public.vehicle_stop_events TO anon;

-- 5. Helper view: v_vehicle_stop_summary
CREATE OR REPLACE VIEW public.v_vehicle_stop_summary AS
SELECT
  s.id,
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
