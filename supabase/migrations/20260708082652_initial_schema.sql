-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- --------------------------------------------------
-- 1. Profiles Table
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'driver', 'operations', 'accounts', 'supervisor', 'qa', 'logistics')),
    status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- --------------------------------------------------
-- 2. Vehicles Table
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    model TEXT NOT NULL,
    route TEXT,
    insurance_expiry DATE,
    last_service DATE,
    next_service_km INTEGER,
    odometer INTEGER NOT NULL DEFAULT 0 CHECK (odometer >= 0),
    engine_hours NUMERIC(10,2) NOT NULL DEFAULT 0.0 CHECK (engine_hours >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- --------------------------------------------------
-- 3. Vehicle Telemetry Table
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicle_telemetry (
    vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'Offline' CHECK (status IN ('Moving', 'Idle', 'Parked', 'Offline')),
    location TEXT,
    lat NUMERIC(9,6),
    lng NUMERIC(9,6),
    speed INTEGER NOT NULL DEFAULT 0 CHECK (speed >= 0),
    fuel INTEGER NOT NULL DEFAULT 0 CHECK (fuel BETWEEN 0 AND 100),
    temperature NUMERIC(4,1),
    humidity INTEGER CHECK (humidity BETWEEN 0 AND 100),
    engine_on BOOLEAN NOT NULL DEFAULT false,
    ignition BOOLEAN NOT NULL DEFAULT false,
    last_update TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- --------------------------------------------------
-- 4. Drivers Table
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.drivers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL UNIQUE,
    name TEXT NOT NULL,
    phone TEXT,
    license TEXT,
    score INTEGER NOT NULL DEFAULT 100 CHECK (score BETWEEN 0 AND 100),
    events INTEGER NOT NULL DEFAULT 0 CHECK (events >= 0),
    rating TEXT NOT NULL DEFAULT 'Good' CHECK (rating IN ('Excellent', 'Good', 'Average', 'Poor')),
    trips INTEGER NOT NULL DEFAULT 0 CHECK (trips >= 0),
    total_km INTEGER NOT NULL DEFAULT 0 CHECK (total_km >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- --------------------------------------------------
-- 5. Vehicle Assignments Table
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicle_assignments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE NOT NULL,
    driver_id UUID REFERENCES public.drivers(id) ON DELETE CASCADE NOT NULL,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    unassigned_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN NOT NULL DEFAULT true
);

-- --------------------------------------------------
-- 6. Alerts Table
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('Fuel', 'Safety', 'Temperature', 'Vehicle', 'Maintenance')),
    severity TEXT NOT NULL CHECK (severity IN ('High', 'Medium', 'Low')),
    vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE NOT NULL,
    message TEXT NOT NULL,
    time TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    resolved BOOLEAN NOT NULL DEFAULT false,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- --------------------------------------------------
-- 7. Trips Table
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trips (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
    driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    start TEXT NOT NULL,
    destination TEXT NOT NULL,
    distance NUMERIC(8,2) CHECK (distance >= 0),
    duration TEXT,
    status TEXT NOT NULL DEFAULT 'Ongoing' CHECK (status IN ('Completed', 'Ongoing', 'Delayed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- --------------------------------------------------
-- 8. Collection Routes Table
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.collection_routes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
    driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
    centres INTEGER NOT NULL DEFAULT 0 CHECK (centres >= 0),
    start_time TEXT,
    end_time TEXT,
    status TEXT NOT NULL DEFAULT 'In Progress' CHECK (status IN ('On Time', 'Delayed', 'Completed', 'In Progress')),
    litres INTEGER NOT NULL DEFAULT 0 CHECK (litres >= 0),
    completion INTEGER NOT NULL DEFAULT 0 CHECK (completion BETWEEN 0 AND 100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- --------------------------------------------------
-- 9. Maintenance Records Table
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.maintenance_records (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE NOT NULL,
    service TEXT NOT NULL,
    due_in TEXT,
    due_date DATE,
    status TEXT NOT NULL DEFAULT 'Upcoming' CHECK (status IN ('Upcoming', 'Overdue', 'Completed')),
    cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- --------------------------------------------------
-- 10. Settings Table
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE NOT NULL,
    notifications BOOLEAN NOT NULL DEFAULT true,
    sms BOOLEAN NOT NULL DEFAULT false,
    geofence BOOLEAN NOT NULL DEFAULT true,
    overspeed INTEGER NOT NULL DEFAULT 60 CHECK (overspeed > 0),
    cold_min INTEGER NOT NULL DEFAULT 2,
    cold_max INTEGER NOT NULL DEFAULT 6,
    fuel_alert INTEGER NOT NULL DEFAULT 25 CHECK (fuel_alert BETWEEN 1 AND 99),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- --------------------------------------------------
-- 11. Telemetry History Table (Time series)
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telemetry_history (
    id BIGSERIAL PRIMARY KEY,
    vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE NOT NULL,
    speed INTEGER NOT NULL CHECK (speed >= 0),
    fuel INTEGER NOT NULL CHECK (fuel BETWEEN 0 AND 100),
    temperature NUMERIC(4,1),
    humidity INTEGER CHECK (humidity BETWEEN 0 AND 100),
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- --------------------------------------------------
-- Indexes
-- --------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_vehicles_number ON public.vehicles(number);
CREATE INDEX IF NOT EXISTS idx_telemetry_status ON public.vehicle_telemetry(status);
CREATE INDEX IF NOT EXISTS idx_drivers_profile_id ON public.drivers(profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_assignments_active ON public.vehicle_assignments(vehicle_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_alerts_vehicle_id ON public.alerts(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON public.alerts(resolved);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle_id ON public.trips(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_trips_driver_id ON public.trips(driver_id);
CREATE INDEX IF NOT EXISTS idx_collection_routes_vehicle_id ON public.collection_routes(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_records_vehicle_id ON public.maintenance_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_history_vehicle_recorded ON public.telemetry_history(vehicle_id, recorded_at DESC);

-- --------------------------------------------------
-- Views
-- --------------------------------------------------
CREATE OR REPLACE VIEW public.v_vehicles AS
SELECT 
    v.id,
    v.number,
    v.type,
    v.model,
    v.route,
    v.insurance_expiry,
    v.last_service,
    v.next_service_km,
    v.odometer,
    v.engine_hours,
    vt.status,
    vt.location,
    vt.lat,
    vt.lng,
    vt.speed,
    vt.fuel,
    vt.temperature,
    vt.humidity,
    vt.engine_on,
    vt.ignition,
    vt.last_update,
    d.name AS driver_name,
    d.id AS driver_id
FROM public.vehicles v
LEFT JOIN public.vehicle_telemetry vt ON v.id = vt.vehicle_id
LEFT JOIN public.vehicle_assignments va ON v.id = va.vehicle_id AND va.is_active = true
LEFT JOIN public.drivers d ON va.driver_id = d.id;

-- --------------------------------------------------
-- Functions & Triggers
-- --------------------------------------------------

-- Auto updated_at Trigger Function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER tr_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_vehicles_updated_at BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_vehicle_telemetry_updated_at BEFORE UPDATE ON public.vehicle_telemetry FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_drivers_updated_at BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_alerts_updated_at BEFORE UPDATE ON public.alerts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_trips_updated_at BEFORE UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_collection_routes_updated_at BEFORE UPDATE ON public.collection_routes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_maintenance_records_updated_at BEFORE UPDATE ON public.maintenance_records FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_settings_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto Create Profile Trigger Function on auth.users sign up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, name, email, role, status)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'role', 'driver'),
        'Active'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Helper function to check role in RLS Policies
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- --------------------------------------------------
-- Row Level Security (RLS) Policies
-- --------------------------------------------------

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_history ENABLE ROW LEVEL SECURITY;

-- 1. Profiles Policies
CREATE POLICY "Allow users to view all profiles" ON public.profiles
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow admins/managers to modify profiles" ON public.profiles
    FOR ALL TO authenticated USING (public.get_user_role() IN ('admin', 'manager'));

-- 2. Vehicles Policies
CREATE POLICY "Allow users to view all vehicles" ON public.vehicles
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow admins/managers to modify vehicles" ON public.vehicles
    FOR ALL TO authenticated USING (public.get_user_role() IN ('admin', 'manager'));

-- 3. Vehicle Telemetry Policies
CREATE POLICY "Allow users to view telemetry" ON public.vehicle_telemetry
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow all authenticated users to insert/update telemetry" ON public.vehicle_telemetry
    FOR ALL TO authenticated USING (true);

-- 4. Drivers Policies
CREATE POLICY "Allow users to view all drivers" ON public.drivers
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow admins/managers to modify drivers" ON public.drivers
    FOR ALL TO authenticated USING (public.get_user_role() IN ('admin', 'manager'));

-- 5. Vehicle Assignments Policies
CREATE POLICY "Allow users to view assignments" ON public.vehicle_assignments
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow admins/managers to modify assignments" ON public.vehicle_assignments
    FOR ALL TO authenticated USING (public.get_user_role() IN ('admin', 'manager'));

-- 6. Alerts Policies
CREATE POLICY "Allow users to view alerts" ON public.alerts
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow users to create alerts" ON public.alerts
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow admins/managers/supervisors to update alerts" ON public.alerts
    FOR UPDATE TO authenticated USING (public.get_user_role() IN ('admin', 'manager', 'supervisor'));

-- 7. Trips Policies
CREATE POLICY "Allow users to view trips" ON public.trips
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow drivers to update trips" ON public.trips
    FOR ALL TO authenticated USING (true);

-- 8. Collection Routes Policies
CREATE POLICY "Allow users to view collection routes" ON public.collection_routes
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow admins/managers to modify collection routes" ON public.collection_routes
    FOR ALL TO authenticated USING (public.get_user_role() IN ('admin', 'manager'));

-- 9. Maintenance Records Policies
CREATE POLICY "Allow users to view maintenance" ON public.maintenance_records
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow admins/managers to modify maintenance" ON public.maintenance_records
    FOR ALL TO authenticated USING (public.get_user_role() IN ('admin', 'manager'));

-- 10. Settings Policies
CREATE POLICY "Allow users to view settings" ON public.settings
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow users to modify settings" ON public.settings
    FOR ALL TO authenticated USING (auth.uid() = user_id);

-- 11. Telemetry History Policies
CREATE POLICY "Allow users to view telemetry history" ON public.telemetry_history
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow insertion of telemetry history" ON public.telemetry_history
    FOR INSERT TO authenticated WITH CHECK (true);

-- --------------------------------------------------
-- Storage Buckets & Policies
-- --------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('vehicle-docs', 'vehicle-docs', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Allow authenticated users to read reports"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'reports');

CREATE POLICY "Allow authenticated users to upload reports"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'reports');

CREATE POLICY "Allow authenticated users to read vehicle-docs"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'vehicle-docs');

CREATE POLICY "Allow admins/managers to upload vehicle-docs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'vehicle-docs' AND public.get_user_role() IN ('admin', 'manager'));

-- --------------------------------------------------
-- Realtime Subscriptions
-- --------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_telemetry;
ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
