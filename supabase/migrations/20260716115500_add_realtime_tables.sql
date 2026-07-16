-- ==========================================================
-- Migration: Recreate supabase_realtime publication with all tables
-- ==========================================================

DROP PUBLICATION IF EXISTS supabase_realtime;
CREATE PUBLICATION supabase_realtime FOR TABLE 
    public.profiles,
    public.drivers,
    public.vehicles,
    public.vehicle_telemetry,
    public.alerts,
    public.driver_shifts,
    public.vehicle_documents,
    public.fuel_purchase_logs,
    public.pre_trip_inspections,
    public.driver_schedules;
