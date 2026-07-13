-- ==========================================================================
-- Migration: Create tables and columns for non-hardware logging features
-- ==========================================================================

-- 1. Vehicle Documents Table (no image uploads)
CREATE TABLE IF NOT EXISTS public.vehicle_documents (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE NOT NULL,
    document_type TEXT NOT NULL CHECK (document_type IN ('Insurance', 'Pollution Certificate', 'Road Tax', 'Fitness Certificate')),
    document_number TEXT NOT NULL,
    expiry_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Manual Fuel Purchase Logs (no image uploads)
CREATE TABLE IF NOT EXISTS public.fuel_purchase_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE NOT NULL,
    driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
    liters NUMERIC(10,2) NOT NULL CHECK (liters > 0),
    cost NUMERIC(10,2) NOT NULL CHECK (cost > 0),
    odometer INTEGER NOT NULL CHECK (odometer >= 0),
    logged_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Pre-Trip Inspections Table
CREATE TABLE IF NOT EXISTS public.pre_trip_inspections (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    driver_id UUID REFERENCES public.drivers(id) ON DELETE CASCADE NOT NULL,
    vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE NOT NULL,
    tyres_ok BOOLEAN NOT NULL DEFAULT true,
    brakes_ok BOOLEAN NOT NULL DEFAULT true,
    lights_ok BOOLEAN NOT NULL DEFAULT true,
    cleanliness_ok BOOLEAN NOT NULL DEFAULT true,
    passed BOOLEAN NOT NULL DEFAULT true,
    logged_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Driver Schedules Table
CREATE TABLE IF NOT EXISTS public.driver_schedules (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    driver_id UUID REFERENCES public.drivers(id) ON DELETE CASCADE NOT NULL,
    vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    shift_type TEXT NOT NULL CHECK (shift_type IN ('Morning Shift', 'Evening Shift', 'Night Shift')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Alter Trips Table
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS route_id UUID REFERENCES public.collection_routes(id) ON DELETE SET NULL;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS start_km INTEGER;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS end_km INTEGER;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS total_milk_collected NUMERIC(10,2) DEFAULT 0.00;

-- 6. Enable Row Level Security (RLS)
ALTER TABLE public.vehicle_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_purchase_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pre_trip_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_schedules ENABLE ROW LEVEL SECURITY;

-- 7. Define RLS Policies

-- Vehicle Documents Policies
CREATE POLICY "Allow select vehicle_documents" ON public.vehicle_documents
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow modify vehicle_documents" ON public.vehicle_documents
    FOR ALL TO authenticated USING (public.get_user_role() IN ('admin', 'manager'));

-- Fuel Purchase Logs Policies
CREATE POLICY "Allow select fuel_purchase_logs" ON public.fuel_purchase_logs
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow insert fuel_purchase_logs" ON public.fuel_purchase_logs
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow modify fuel_purchase_logs" ON public.fuel_purchase_logs
    FOR ALL TO authenticated USING (public.get_user_role() IN ('admin', 'manager'));

-- Pre-Trip Inspections Policies
CREATE POLICY "Allow select pre_trip_inspections" ON public.pre_trip_inspections
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow insert pre_trip_inspections" ON public.pre_trip_inspections
    FOR INSERT TO authenticated WITH CHECK (true);

-- Driver Schedules Policies
CREATE POLICY "Allow select driver_schedules" ON public.driver_schedules
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow modify driver_schedules" ON public.driver_schedules
    FOR ALL TO authenticated USING (public.get_user_role() IN ('admin', 'manager'));

-- 8. Add to Realtime Publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_documents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.fuel_purchase_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pre_trip_inspections;
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_schedules;

-- 9. Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fuel_purchase_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pre_trip_inspections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_schedules TO authenticated;
