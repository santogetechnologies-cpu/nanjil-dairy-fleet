-- ==========================================================================
-- Migration: Fix RLS policies for trips, driver_schedules, maintenance_records,
-- and other operational tables for anon and authenticated roles
-- ==========================================================================

-- 1. Grant table privileges to anon and authenticated
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

-- ==========================================================================
-- 1. Table: public.trips
-- ==========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trips TO anon, authenticated;

DROP POLICY IF EXISTS "Allow select trips" ON public.trips;
DROP POLICY IF EXISTS "Allow users to view trips" ON public.trips;
DROP POLICY IF EXISTS "Allow anon select trips" ON public.trips;
DROP POLICY IF EXISTS "Allow select trips for all" ON public.trips;
CREATE POLICY "Allow select trips for all" ON public.trips
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow insert trips" ON public.trips;
DROP POLICY IF EXISTS "Allow insert trips for all" ON public.trips;
CREATE POLICY "Allow insert trips for all" ON public.trips
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update trips" ON public.trips;
DROP POLICY IF EXISTS "Allow drivers to update trips" ON public.trips;
DROP POLICY IF EXISTS "Allow update trips for all" ON public.trips;
CREATE POLICY "Allow update trips for all" ON public.trips
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete trips" ON public.trips;
DROP POLICY IF EXISTS "Allow delete trips for all" ON public.trips;
CREATE POLICY "Allow delete trips for all" ON public.trips
    FOR DELETE TO anon, authenticated USING (true);

-- ==========================================================================
-- 2. Table: public.driver_schedules
-- ==========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_schedules TO anon, authenticated;

DROP POLICY IF EXISTS "Allow select driver_schedules" ON public.driver_schedules;
DROP POLICY IF EXISTS "Allow modify driver_schedules" ON public.driver_schedules;
DROP POLICY IF EXISTS "Allow select driver_schedules for all" ON public.driver_schedules;
CREATE POLICY "Allow select driver_schedules for all" ON public.driver_schedules
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow insert driver_schedules for all" ON public.driver_schedules;
CREATE POLICY "Allow insert driver_schedules for all" ON public.driver_schedules
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update driver_schedules for all" ON public.driver_schedules;
CREATE POLICY "Allow update driver_schedules for all" ON public.driver_schedules
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete driver_schedules for all" ON public.driver_schedules;
CREATE POLICY "Allow delete driver_schedules for all" ON public.driver_schedules
    FOR DELETE TO anon, authenticated USING (true);

-- ==========================================================================
-- 3. Table: public.maintenance_records
-- ==========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_records TO anon, authenticated;

DROP POLICY IF EXISTS "Allow select maintenance" ON public.maintenance_records;
DROP POLICY IF EXISTS "Allow anon select maintenance" ON public.maintenance_records;
DROP POLICY IF EXISTS "Allow select maintenance for all" ON public.maintenance_records;
CREATE POLICY "Allow select maintenance for all" ON public.maintenance_records
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow insert maintenance" ON public.maintenance_records;
DROP POLICY IF EXISTS "Allow insert maintenance for all" ON public.maintenance_records;
CREATE POLICY "Allow insert maintenance for all" ON public.maintenance_records
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update maintenance" ON public.maintenance_records;
DROP POLICY IF EXISTS "Allow update maintenance for all" ON public.maintenance_records;
CREATE POLICY "Allow update maintenance for all" ON public.maintenance_records
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete maintenance" ON public.maintenance_records;
DROP POLICY IF EXISTS "Allow delete maintenance for all" ON public.maintenance_records;
CREATE POLICY "Allow delete maintenance for all" ON public.maintenance_records
    FOR DELETE TO anon, authenticated USING (true);

-- ==========================================================================
-- 4. Table: public.vehicle_documents
-- ==========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_documents TO anon, authenticated;

DROP POLICY IF EXISTS "Allow select vehicle_documents" ON public.vehicle_documents;
DROP POLICY IF EXISTS "Allow modify vehicle_documents" ON public.vehicle_documents;
DROP POLICY IF EXISTS "Allow select vehicle_documents for all" ON public.vehicle_documents;
CREATE POLICY "Allow select vehicle_documents for all" ON public.vehicle_documents
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow insert vehicle_documents for all" ON public.vehicle_documents;
CREATE POLICY "Allow insert vehicle_documents for all" ON public.vehicle_documents
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update vehicle_documents for all" ON public.vehicle_documents;
CREATE POLICY "Allow update vehicle_documents for all" ON public.vehicle_documents
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete vehicle_documents for all" ON public.vehicle_documents;
CREATE POLICY "Allow delete vehicle_documents for all" ON public.vehicle_documents
    FOR DELETE TO anon, authenticated USING (true);

-- ==========================================================================
-- 5. Table: public.fuel_purchase_logs
-- ==========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fuel_purchase_logs TO anon, authenticated;

DROP POLICY IF EXISTS "Allow select fuel_purchase_logs" ON public.fuel_purchase_logs;
DROP POLICY IF EXISTS "Allow insert fuel_purchase_logs" ON public.fuel_purchase_logs;
DROP POLICY IF EXISTS "Allow modify fuel_purchase_logs" ON public.fuel_purchase_logs;
DROP POLICY IF EXISTS "Allow select fuel_purchase_logs for all" ON public.fuel_purchase_logs;
CREATE POLICY "Allow select fuel_purchase_logs for all" ON public.fuel_purchase_logs
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow insert fuel_purchase_logs for all" ON public.fuel_purchase_logs;
CREATE POLICY "Allow insert fuel_purchase_logs for all" ON public.fuel_purchase_logs
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update fuel_purchase_logs for all" ON public.fuel_purchase_logs;
CREATE POLICY "Allow update fuel_purchase_logs for all" ON public.fuel_purchase_logs
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete fuel_purchase_logs for all" ON public.fuel_purchase_logs;
CREATE POLICY "Allow delete fuel_purchase_logs for all" ON public.fuel_purchase_logs
    FOR DELETE TO anon, authenticated USING (true);

-- ==========================================================================
-- 6. Table: public.pre_trip_inspections
-- ==========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pre_trip_inspections TO anon, authenticated;

DROP POLICY IF EXISTS "Allow select pre_trip_inspections" ON public.pre_trip_inspections;
DROP POLICY IF EXISTS "Allow insert pre_trip_inspections" ON public.pre_trip_inspections;
DROP POLICY IF EXISTS "Allow select pre_trip_inspections for all" ON public.pre_trip_inspections;
CREATE POLICY "Allow select pre_trip_inspections for all" ON public.pre_trip_inspections
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow insert pre_trip_inspections for all" ON public.pre_trip_inspections;
CREATE POLICY "Allow insert pre_trip_inspections for all" ON public.pre_trip_inspections
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update pre_trip_inspections for all" ON public.pre_trip_inspections;
CREATE POLICY "Allow update pre_trip_inspections for all" ON public.pre_trip_inspections
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete pre_trip_inspections for all" ON public.pre_trip_inspections;
CREATE POLICY "Allow delete pre_trip_inspections for all" ON public.pre_trip_inspections
    FOR DELETE TO anon, authenticated USING (true);

-- ==========================================================================
-- 7. Table: public.driver_shifts
-- ==========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_shifts TO anon, authenticated;

DROP POLICY IF EXISTS "Allow select shifts" ON public.driver_shifts;
DROP POLICY IF EXISTS "Allow insert shifts" ON public.driver_shifts;
DROP POLICY IF EXISTS "Allow update shifts" ON public.driver_shifts;
DROP POLICY IF EXISTS "Allow delete shifts" ON public.driver_shifts;
CREATE POLICY "Allow select shifts for all" ON public.driver_shifts
    FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow insert shifts for all" ON public.driver_shifts
    FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update shifts for all" ON public.driver_shifts
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow delete shifts for all" ON public.driver_shifts
    FOR DELETE TO anon, authenticated USING (true);

-- ==========================================================================
-- 8. Table: public.collection_routes
-- ==========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collection_routes TO anon, authenticated;

DROP POLICY IF EXISTS "Allow select collection routes" ON public.collection_routes;
DROP POLICY IF EXISTS "Allow anon select collection_routes" ON public.collection_routes;
DROP POLICY IF EXISTS "Allow select collection routes for all" ON public.collection_routes;
CREATE POLICY "Allow select collection routes for all" ON public.collection_routes
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow insert collection routes" ON public.collection_routes;
DROP POLICY IF EXISTS "Allow insert collection routes for all" ON public.collection_routes;
CREATE POLICY "Allow insert collection routes for all" ON public.collection_routes
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update collection routes" ON public.collection_routes;
DROP POLICY IF EXISTS "Allow update collection routes for all" ON public.collection_routes;
CREATE POLICY "Allow update collection routes for all" ON public.collection_routes
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete collection routes" ON public.collection_routes;
DROP POLICY IF EXISTS "Allow delete collection routes for all" ON public.collection_routes;
CREATE POLICY "Allow delete collection routes for all" ON public.collection_routes
    FOR DELETE TO anon, authenticated USING (true);

-- ==========================================================================
-- 9. Table: public.vehicles
-- ==========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles TO anon, authenticated;

DROP POLICY IF EXISTS "Allow select vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Allow anon select vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Allow select vehicles for all" ON public.vehicles;
CREATE POLICY "Allow select vehicles for all" ON public.vehicles
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow insert vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Allow insert vehicles for all" ON public.vehicles;
CREATE POLICY "Allow insert vehicles for all" ON public.vehicles
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Allow update vehicles for all" ON public.vehicles;
CREATE POLICY "Allow update vehicles for all" ON public.vehicles
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Allow delete vehicles for all" ON public.vehicles;
CREATE POLICY "Allow delete vehicles for all" ON public.vehicles
    FOR DELETE TO anon, authenticated USING (true);

-- ==========================================================================
-- 10. Table: public.vehicle_assignments
-- ==========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_assignments TO anon, authenticated;

DROP POLICY IF EXISTS "Allow select assignments" ON public.vehicle_assignments;
DROP POLICY IF EXISTS "Allow anon select vehicle_assignments" ON public.vehicle_assignments;
DROP POLICY IF EXISTS "Allow select vehicle_assignments for all" ON public.vehicle_assignments;
CREATE POLICY "Allow select vehicle_assignments for all" ON public.vehicle_assignments
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow insert assignments" ON public.vehicle_assignments;
DROP POLICY IF EXISTS "Allow anon insert vehicle_assignments" ON public.vehicle_assignments;
DROP POLICY IF EXISTS "Allow insert vehicle_assignments for all" ON public.vehicle_assignments;
CREATE POLICY "Allow insert vehicle_assignments for all" ON public.vehicle_assignments
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update assignments" ON public.vehicle_assignments;
DROP POLICY IF EXISTS "Allow update vehicle_assignments for all" ON public.vehicle_assignments;
CREATE POLICY "Allow update vehicle_assignments for all" ON public.vehicle_assignments
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete assignments" ON public.vehicle_assignments;
DROP POLICY IF EXISTS "Allow delete vehicle_assignments for all" ON public.vehicle_assignments;
CREATE POLICY "Allow delete vehicle_assignments for all" ON public.vehicle_assignments
    FOR DELETE TO anon, authenticated USING (true);

-- ==========================================================================
-- 11. Table: public.vehicle_telemetry
-- ==========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_telemetry TO anon, authenticated;

DROP POLICY IF EXISTS "Allow select telemetry" ON public.vehicle_telemetry;
DROP POLICY IF EXISTS "Allow anon select vehicle_telemetry" ON public.vehicle_telemetry;
DROP POLICY IF EXISTS "Allow select vehicle_telemetry for all" ON public.vehicle_telemetry;
CREATE POLICY "Allow select vehicle_telemetry for all" ON public.vehicle_telemetry
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow insert telemetry" ON public.vehicle_telemetry;
DROP POLICY IF EXISTS "Allow insert vehicle_telemetry for all" ON public.vehicle_telemetry;
CREATE POLICY "Allow insert vehicle_telemetry for all" ON public.vehicle_telemetry
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update telemetry" ON public.vehicle_telemetry;
DROP POLICY IF EXISTS "Allow update vehicle_telemetry for all" ON public.vehicle_telemetry;
CREATE POLICY "Allow update vehicle_telemetry for all" ON public.vehicle_telemetry
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete telemetry" ON public.vehicle_telemetry;
DROP POLICY IF EXISTS "Allow delete vehicle_telemetry for all" ON public.vehicle_telemetry;
CREATE POLICY "Allow delete vehicle_telemetry for all" ON public.vehicle_telemetry
    FOR DELETE TO anon, authenticated USING (true);

-- ==========================================================================
-- 12. Table: public.settings
-- ==========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO anon, authenticated;

DROP POLICY IF EXISTS "Allow select settings" ON public.settings;
DROP POLICY IF EXISTS "Allow select settings for all" ON public.settings;
CREATE POLICY "Allow select settings for all" ON public.settings
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow insert settings" ON public.settings;
DROP POLICY IF EXISTS "Allow insert settings for all" ON public.settings;
CREATE POLICY "Allow insert settings for all" ON public.settings
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update settings" ON public.settings;
DROP POLICY IF EXISTS "Allow update settings for all" ON public.settings;
CREATE POLICY "Allow update settings for all" ON public.settings
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete settings" ON public.settings;
DROP POLICY IF EXISTS "Allow delete settings for all" ON public.settings;
CREATE POLICY "Allow delete settings for all" ON public.settings
    FOR DELETE TO anon, authenticated USING (true);
