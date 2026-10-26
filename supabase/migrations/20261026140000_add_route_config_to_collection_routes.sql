-- ==========================================================
-- Migration: Add route_config JSONB column to collection_routes
-- Enables persistent storage of complete Route Planner configuration
-- (start/destination coordinates, outbound and return stop sequences,
--  round-trip modes, revisit settings, speed limit, deviation threshold,
--  alerts, and notes).
-- ==========================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'collection_routes' 
          AND column_name = 'route_config'
    ) THEN
        ALTER TABLE public.collection_routes 
        ADD COLUMN route_config JSONB DEFAULT '{}'::jsonb;
    END IF;
END $$;

COMMENT ON COLUMN public.collection_routes.route_config IS 
'Stores full Route Planner configuration: waypoints, start/destination coords, outbound & return stops, roundTripType, speedLimitKmh, deviationThresholdMeters, alerts, notes, etc.';

-- Ensure RLS and permissions remain consistent for collection_routes
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collection_routes TO anon, authenticated;

-- Ensure collection_routes is in realtime publication if publication exists
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
