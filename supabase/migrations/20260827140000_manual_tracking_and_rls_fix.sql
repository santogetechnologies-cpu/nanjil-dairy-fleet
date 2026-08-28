-- =====================================================
-- Migration: Manual fuel & odometer tracking columns
-- =====================================================
-- Adds opening/closing KM + fuel liter fields for
-- trips, pre_trip_inspections, and driver_shifts.
-- No sensors needed — all manually entered by staff.

-- 1. trips: add start/end fuel liters for mileage calc
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS fuel_liters_start NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS fuel_liters_end   NUMERIC(8,2);

-- 2. pre_trip_inspections: capture opening odometer
ALTER TABLE public.pre_trip_inspections
  ADD COLUMN IF NOT EXISTS opening_km INTEGER;

-- 3. driver_shifts: capture opening odometer at shift start
ALTER TABLE public.driver_shifts
  ADD COLUMN IF NOT EXISTS opening_km INTEGER;

-- 4. Ensure permissive INSERT RLS for all roles on core tables
-- (in case the previous migration hasn't been applied yet)
DO $$
BEGIN
  -- trips
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'trips' AND policyname = 'allow_all_trips'
  ) THEN
    DROP POLICY IF EXISTS "trips_select" ON public.trips;
    DROP POLICY IF EXISTS "trips_insert" ON public.trips;
    DROP POLICY IF EXISTS "trips_update" ON public.trips;
    DROP POLICY IF EXISTS "trips_delete" ON public.trips;
    CREATE POLICY "allow_all_trips" ON public.trips FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- driver_schedules
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'driver_schedules' AND policyname = 'allow_all_driver_schedules'
  ) THEN
    DROP POLICY IF EXISTS "driver_schedules_select" ON public.driver_schedules;
    DROP POLICY IF EXISTS "driver_schedules_insert" ON public.driver_schedules;
    DROP POLICY IF EXISTS "driver_schedules_update" ON public.driver_schedules;
    DROP POLICY IF EXISTS "driver_schedules_delete" ON public.driver_schedules;
    CREATE POLICY "allow_all_driver_schedules" ON public.driver_schedules FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- maintenance_records
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'maintenance_records' AND policyname = 'allow_all_maintenance_records'
  ) THEN
    DROP POLICY IF EXISTS "maintenance_records_select" ON public.maintenance_records;
    DROP POLICY IF EXISTS "maintenance_records_insert" ON public.maintenance_records;
    DROP POLICY IF EXISTS "maintenance_records_update" ON public.maintenance_records;
    DROP POLICY IF EXISTS "maintenance_records_delete" ON public.maintenance_records;
    CREATE POLICY "allow_all_maintenance_records" ON public.maintenance_records FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- driver_shifts
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'driver_shifts' AND policyname = 'allow_all_driver_shifts'
  ) THEN
    DROP POLICY IF EXISTS "driver_shifts_select" ON public.driver_shifts;
    DROP POLICY IF EXISTS "driver_shifts_insert" ON public.driver_shifts;
    DROP POLICY IF EXISTS "driver_shifts_update" ON public.driver_shifts;
    DROP POLICY IF EXISTS "driver_shifts_delete" ON public.driver_shifts;
    CREATE POLICY "allow_all_driver_shifts" ON public.driver_shifts FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- pre_trip_inspections
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'pre_trip_inspections' AND policyname = 'allow_all_pre_trip_inspections'
  ) THEN
    DROP POLICY IF EXISTS "pre_trip_inspections_select" ON public.pre_trip_inspections;
    DROP POLICY IF EXISTS "pre_trip_inspections_insert" ON public.pre_trip_inspections;
    DROP POLICY IF EXISTS "pre_trip_inspections_update" ON public.pre_trip_inspections;
    DROP POLICY IF EXISTS "pre_trip_inspections_delete" ON public.pre_trip_inspections;
    CREATE POLICY "allow_all_pre_trip_inspections" ON public.pre_trip_inspections FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- fuel_purchase_logs
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'fuel_purchase_logs' AND policyname = 'allow_all_fuel_purchase_logs'
  ) THEN
    DROP POLICY IF EXISTS "fuel_purchase_logs_select" ON public.fuel_purchase_logs;
    DROP POLICY IF EXISTS "fuel_purchase_logs_insert" ON public.fuel_purchase_logs;
    DROP POLICY IF EXISTS "fuel_purchase_logs_update" ON public.fuel_purchase_logs;
    DROP POLICY IF EXISTS "fuel_purchase_logs_delete" ON public.fuel_purchase_logs;
    CREATE POLICY "allow_all_fuel_purchase_logs" ON public.fuel_purchase_logs FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- alerts
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'alerts' AND policyname = 'allow_all_alerts'
  ) THEN
    DROP POLICY IF EXISTS "alerts_select" ON public.alerts;
    DROP POLICY IF EXISTS "alerts_insert" ON public.alerts;
    DROP POLICY IF EXISTS "alerts_update" ON public.alerts;
    DROP POLICY IF EXISTS "alerts_delete" ON public.alerts;
    CREATE POLICY "allow_all_alerts" ON public.alerts FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- vehicles
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'vehicles' AND policyname = 'allow_all_vehicles'
  ) THEN
    DROP POLICY IF EXISTS "vehicles_select" ON public.vehicles;
    DROP POLICY IF EXISTS "vehicles_insert" ON public.vehicles;
    DROP POLICY IF EXISTS "vehicles_update" ON public.vehicles;
    DROP POLICY IF EXISTS "vehicles_delete" ON public.vehicles;
    CREATE POLICY "allow_all_vehicles" ON public.vehicles FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- drivers
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'drivers' AND policyname = 'allow_all_drivers'
  ) THEN
    DROP POLICY IF EXISTS "drivers_select" ON public.drivers;
    DROP POLICY IF EXISTS "drivers_insert" ON public.drivers;
    DROP POLICY IF EXISTS "drivers_update" ON public.drivers;
    DROP POLICY IF EXISTS "drivers_delete" ON public.drivers;
    CREATE POLICY "allow_all_drivers" ON public.drivers FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- collection_routes
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'collection_routes' AND policyname = 'allow_all_collection_routes'
  ) THEN
    DROP POLICY IF EXISTS "collection_routes_select" ON public.collection_routes;
    DROP POLICY IF EXISTS "collection_routes_insert" ON public.collection_routes;
    DROP POLICY IF EXISTS "collection_routes_update" ON public.collection_routes;
    DROP POLICY IF EXISTS "collection_routes_delete" ON public.collection_routes;
    CREATE POLICY "allow_all_collection_routes" ON public.collection_routes FOR ALL USING (true) WITH CHECK (true);
  END IF;
END
$$;
