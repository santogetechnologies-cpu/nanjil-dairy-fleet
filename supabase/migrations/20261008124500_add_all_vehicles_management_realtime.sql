-- ==========================================================
-- Migration: Ensure all Vehicles Management tables are in supabase_realtime publication
-- Enables real-time CDC updates for maintenance_records, trips, telemetry_history, etc.
-- ==========================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    -- maintenance_records
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND tablename = 'maintenance_records'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.maintenance_records;
    END IF;

    -- trips
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND tablename = 'trips'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;
    END IF;

    -- telemetry_history
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND tablename = 'telemetry_history'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.telemetry_history;
    END IF;

    -- vehicles
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND tablename = 'vehicles'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicles;
    END IF;

    -- fuel_purchase_logs
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND tablename = 'fuel_purchase_logs'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.fuel_purchase_logs;
    END IF;

    -- alerts
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND tablename = 'alerts'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
    END IF;

    -- drivers
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND tablename = 'drivers'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
    END IF;
  END IF;
END $$;
