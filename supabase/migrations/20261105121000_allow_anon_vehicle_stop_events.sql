-- ==============================================================================
-- Migration: 20261105121000_allow_anon_vehicle_stop_events.sql
-- Grant anon and authenticated access to vehicle_stop_events and views.
-- Fixes permission denied (42501) during browser reload / initialization.
-- ==============================================================================

-- 1. Grant table and sequence permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON public.vehicle_stop_events TO anon, authenticated;
GRANT ALL ON public.stop_tracking_checkpoints TO anon, authenticated;
GRANT SELECT ON public.v_vehicle_stop_summary TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_vehicle_telemetry_stop TO anon, authenticated;

-- 2. Ensure RLS is active with explicit anon read/write policies
ALTER TABLE public.vehicle_stop_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stop_tracking_checkpoints ENABLE ROW LEVEL SECURITY;

-- vehicle_stop_events policies
DROP POLICY IF EXISTS "anon_select_stop_events" ON public.vehicle_stop_events;
CREATE POLICY "anon_select_stop_events"
  ON public.vehicle_stop_events
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "anon_insert_stop_events" ON public.vehicle_stop_events;
CREATE POLICY "anon_insert_stop_events"
  ON public.vehicle_stop_events
  FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_stop_events" ON public.vehicle_stop_events;
CREATE POLICY "anon_update_stop_events"
  ON public.vehicle_stop_events
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_stop_events" ON public.vehicle_stop_events;
CREATE POLICY "anon_delete_stop_events"
  ON public.vehicle_stop_events
  FOR DELETE
  TO anon
  USING (true);

-- stop_tracking_checkpoints policies
DROP POLICY IF EXISTS "anon_select_checkpoints" ON public.stop_tracking_checkpoints;
CREATE POLICY "anon_select_checkpoints"
  ON public.stop_tracking_checkpoints
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "anon_mod_checkpoints" ON public.stop_tracking_checkpoints;
CREATE POLICY "anon_mod_checkpoints"
  ON public.stop_tracking_checkpoints
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

