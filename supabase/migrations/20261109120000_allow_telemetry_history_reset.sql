-- ==============================================================================
-- Migration: 20261109120000_allow_telemetry_history_reset.sql
-- Allow anon & authenticated users to DELETE telemetry_history & trips for reset operations
-- ==============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.telemetry_history TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trips TO anon, authenticated;

-- Ensure DELETE policy exists on telemetry_history
DROP POLICY IF EXISTS "Allow anon delete telemetry_history" ON public.telemetry_history;
CREATE POLICY "Allow anon delete telemetry_history" ON public.telemetry_history
    FOR DELETE TO anon, authenticated USING (true);

-- Ensure DELETE policy exists on trips
DROP POLICY IF EXISTS "Allow delete trips for all" ON public.trips;
CREATE POLICY "Allow delete trips for all" ON public.trips
    FOR DELETE TO anon, authenticated USING (true);

-- Create a helper RPC to cleanly truncate / reset telemetry history if invoked by admin
CREATE OR REPLACE FUNCTION public.reset_trip_history(target_vehicle_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  deleted_telemetry_count INT := 0;
  deleted_trips_count INT := 0;
BEGIN
  IF target_vehicle_id IS NULL THEN
    -- Delete all telemetry history
    DELETE FROM public.telemetry_history;
    GET DIAGNOSTICS deleted_telemetry_count = ROW_COUNT;
    
    DELETE FROM public.trips;
    GET DIAGNOSTICS deleted_trips_count = ROW_COUNT;
  ELSE
    -- Delete for specified vehicle
    DELETE FROM public.telemetry_history WHERE vehicle_id = target_vehicle_id;
    GET DIAGNOSTICS deleted_telemetry_count = ROW_COUNT;
    
    DELETE FROM public.trips WHERE vehicle_id = target_vehicle_id;
    GET DIAGNOSTICS deleted_trips_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_telemetry', deleted_telemetry_count,
    'deleted_trips', deleted_trips_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_trip_history(UUID) TO anon, authenticated;

