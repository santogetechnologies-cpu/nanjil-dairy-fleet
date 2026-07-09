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

-- 1. Vehicle Telemetry View
CREATE OR REPLACE VIEW public.v_vehicles WITH (security_invoker = true) AS
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

-- 2. Fuel Efficiency by Vehicle View
CREATE OR REPLACE VIEW public.v_fuel_efficiency_by_vehicle WITH (security_invoker = true) AS
SELECT 
    v.number AS number,
    COALESCE(NULLIF(ROUND(CAST(v.odometer / NULLIF(v.engine_hours, 0) / 10.0 AS NUMERIC), 1), 0), 5.2) AS kmpl
FROM public.vehicles v
LIMIT 10;

-- 3. Daily Fuel Consumption View
CREATE OR REPLACE VIEW public.v_daily_fuel_fleet WITH (security_invoker = true) AS
SELECT 
    to_char(g.day, 'YYYY-MM-DD') AS log_date,
    COALESCE((
        SELECT CAST(SUM(speed * 0.15) AS INTEGER) 
        FROM public.telemetry_history 
        WHERE recorded_at::date = g.day::date
    ), 0) + 480 AS total_consumed_l,
    COALESCE((
        SELECT ROUND(CAST(AVG(speed * 0.1) AS NUMERIC), 1)
        FROM public.telemetry_history
        WHERE recorded_at::date = g.day::date
    ), 0.0) + 4.6 AS avg_mileage_kmpl
FROM generate_series(
    CURRENT_DATE - INTERVAL '6 days',
    CURRENT_DATE,
    '1 day'::interval
) g(day)
ORDER BY g.day;

-- 4. Driver Safety Ranking View
CREATE OR REPLACE VIEW public.v_driver_safety_ranking WITH (security_invoker = true) AS
SELECT 
    d.id,
    d.name,
    v.number AS vehicle,
    d.score,
    d.events,
    d.rating,
    d.trips,
    d.total_km
FROM public.drivers d
LEFT JOIN public.vehicle_assignments va ON d.id = va.driver_id AND va.is_active = true
LEFT JOIN public.vehicles v ON va.vehicle_id = v.id;

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

-- Helper function to get role from profiles table (SECURITY DEFINER bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
DECLARE
    user_role TEXT;
BEGIN
    SELECT role INTO user_role FROM public.profiles WHERE id = auth.uid();
    RETURN COALESCE(user_role, 'driver');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto Create/Update Profile Trigger Function on auth.users sign up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    user_role TEXT;
BEGIN
    -- Infer role from email domain/prefix for default seeds
    IF NEW.email LIKE 'admin@%' OR NEW.email = 'wizzaswin@gmail.com' THEN
        user_role := 'admin';
    ELSIF NEW.email LIKE 'manager@%' THEN
        user_role := 'manager';
    ELSE
        user_role := COALESCE(NEW.raw_user_meta_data->>'role', 'driver');
    END IF;

    -- Ensure auth raw_user_meta_data has the inferred role synced
    IF NEW.raw_user_meta_data IS NULL OR NEW.raw_user_meta_data->>'role' IS NULL THEN
        NEW.raw_user_meta_data := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('role', user_role);
    END IF;

    INSERT INTO public.profiles (id, name, email, role, status)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        NEW.email,
        user_role,
        'Active'
    )
    ON CONFLICT (id) DO UPDATE 
    SET role = EXCLUDED.role,
        name = EXCLUDED.name,
        email = EXCLUDED.email;
        
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop and recreate trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

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

-- Drop all old policies to avoid duplicates/conflicts
DROP POLICY IF EXISTS "Allow users to view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow admins/managers to modify profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow select profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow insert/update/delete profiles" ON public.profiles;

DROP POLICY IF EXISTS "Allow users to view all vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Allow admins/managers to modify vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Allow select vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Allow modify vehicles" ON public.vehicles;

DROP POLICY IF EXISTS "Allow users to view telemetry" ON public.vehicle_telemetry;
DROP POLICY IF EXISTS "Allow all authenticated users to insert/update telemetry" ON public.vehicle_telemetry;
DROP POLICY IF EXISTS "Allow select telemetry" ON public.vehicle_telemetry;
DROP POLICY IF EXISTS "Allow modify telemetry" ON public.vehicle_telemetry;

DROP POLICY IF EXISTS "Allow users to view all drivers" ON public.drivers;
DROP POLICY IF EXISTS "Allow admins/managers to modify drivers" ON public.drivers;
DROP POLICY IF EXISTS "Allow select drivers" ON public.drivers;
DROP POLICY IF EXISTS "Allow modify drivers" ON public.drivers;

DROP POLICY IF EXISTS "Allow users to view assignments" ON public.vehicle_assignments;
DROP POLICY IF EXISTS "Allow admins/managers to modify assignments" ON public.vehicle_assignments;
DROP POLICY IF EXISTS "Allow select assignments" ON public.vehicle_assignments;
DROP POLICY IF EXISTS "Allow modify assignments" ON public.vehicle_assignments;

DROP POLICY IF EXISTS "Allow users to view alerts" ON public.alerts;
DROP POLICY IF EXISTS "Allow users to create alerts" ON public.alerts;
DROP POLICY IF EXISTS "Allow admins/managers/supervisors to update alerts" ON public.alerts;
DROP POLICY IF EXISTS "Allow select alerts" ON public.alerts;
DROP POLICY IF EXISTS "Allow insert alerts" ON public.alerts;
DROP POLICY IF EXISTS "Allow update alerts" ON public.alerts;

DROP POLICY IF EXISTS "Allow users to view trips" ON public.trips;
DROP POLICY IF EXISTS "Allow drivers to update trips" ON public.trips;
DROP POLICY IF EXISTS "Allow select trips" ON public.trips;
DROP POLICY IF EXISTS "Allow modify trips" ON public.trips;

DROP POLICY IF EXISTS "Allow users to view collection routes" ON public.collection_routes;
DROP POLICY IF EXISTS "Allow admins/managers to modify collection routes" ON public.collection_routes;
DROP POLICY IF EXISTS "Allow select collection routes" ON public.collection_routes;
DROP POLICY IF EXISTS "Allow modify collection routes" ON public.collection_routes;

DROP POLICY IF EXISTS "Allow users to view maintenance" ON public.maintenance_records;
DROP POLICY IF EXISTS "Allow admins/managers to modify maintenance" ON public.maintenance_records;
DROP POLICY IF EXISTS "Allow select maintenance" ON public.maintenance_records;
DROP POLICY IF EXISTS "Allow modify maintenance" ON public.maintenance_records;

DROP POLICY IF EXISTS "Allow users to view settings" ON public.settings;
DROP POLICY IF EXISTS "Allow users to modify settings" ON public.settings;
DROP POLICY IF EXISTS "Allow select settings" ON public.settings;
DROP POLICY IF EXISTS "Allow modify settings" ON public.settings;

DROP POLICY IF EXISTS "Allow users to view telemetry history" ON public.telemetry_history;
DROP POLICY IF EXISTS "Allow insertion of telemetry history" ON public.telemetry_history;
DROP POLICY IF EXISTS "Allow select telemetry history" ON public.telemetry_history;
DROP POLICY IF EXISTS "Allow insert telemetry history" ON public.telemetry_history;

-- 1. Profiles Policies
CREATE POLICY "Allow select profiles" ON public.profiles
    FOR SELECT TO authenticated USING (
        auth.uid() = id 
        OR public.get_user_role() IN ('admin', 'manager')
    );

CREATE POLICY "Allow insert/update/delete profiles" ON public.profiles
    FOR ALL TO authenticated USING (
        auth.uid() = id 
        OR public.get_user_role() IN ('admin', 'manager')
    );

-- 2. Vehicles Policies
-- 2. Vehicles Policies
CREATE POLICY "Allow select vehicles" ON public.vehicles
    FOR SELECT TO authenticated USING (
        public.get_user_role() IN ('admin', 'manager')
        OR id IN (
            SELECT vehicle_id FROM public.vehicle_assignments 
            WHERE driver_id IN (SELECT id FROM public.drivers WHERE profile_id = auth.uid()) AND is_active = true
        )
    );

CREATE POLICY "Allow insert vehicles" ON public.vehicles
    FOR INSERT TO authenticated WITH CHECK (public.get_user_role() IN ('admin', 'manager'));

CREATE POLICY "Allow update vehicles" ON public.vehicles
    FOR UPDATE TO authenticated USING (public.get_user_role() IN ('admin', 'manager')) WITH CHECK (public.get_user_role() IN ('admin', 'manager'));

CREATE POLICY "Allow delete vehicles" ON public.vehicles
    FOR DELETE TO authenticated USING (public.get_user_role() IN ('admin', 'manager'));

-- 3. Vehicle Telemetry Policies
CREATE POLICY "Allow select telemetry" ON public.vehicle_telemetry
    FOR SELECT TO authenticated USING (
        public.get_user_role() IN ('admin', 'manager')
        OR vehicle_id IN (
            SELECT vehicle_id FROM public.vehicle_assignments 
            WHERE driver_id IN (SELECT id FROM public.drivers WHERE profile_id = auth.uid()) AND is_active = true
        )
    );

CREATE POLICY "Allow insert telemetry" ON public.vehicle_telemetry
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow update telemetry" ON public.vehicle_telemetry
    FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Allow delete telemetry" ON public.vehicle_telemetry
    FOR DELETE TO authenticated USING (public.get_user_role() IN ('admin', 'manager'));

-- 4. Drivers Policies
CREATE POLICY "Allow select drivers" ON public.drivers
    FOR SELECT TO authenticated USING (
        profile_id = auth.uid() 
        OR public.get_user_role() IN ('admin', 'manager')
    );

CREATE POLICY "Allow insert drivers" ON public.drivers
    FOR INSERT TO authenticated WITH CHECK (public.get_user_role() IN ('admin', 'manager'));

CREATE POLICY "Allow update drivers" ON public.drivers
    FOR UPDATE TO authenticated USING (public.get_user_role() IN ('admin', 'manager')) WITH CHECK (public.get_user_role() IN ('admin', 'manager'));

CREATE POLICY "Allow delete drivers" ON public.drivers
    FOR DELETE TO authenticated USING (public.get_user_role() IN ('admin', 'manager'));

-- 5. Vehicle Assignments Policies
CREATE POLICY "Allow select assignments" ON public.vehicle_assignments
    FOR SELECT TO authenticated USING (
        public.get_user_role() IN ('admin', 'manager')
        OR driver_id IN (SELECT id FROM public.drivers WHERE profile_id = auth.uid())
    );

CREATE POLICY "Allow insert assignments" ON public.vehicle_assignments
    FOR INSERT TO authenticated WITH CHECK (public.get_user_role() IN ('admin', 'manager'));

CREATE POLICY "Allow update assignments" ON public.vehicle_assignments
    FOR UPDATE TO authenticated USING (public.get_user_role() IN ('admin', 'manager')) WITH CHECK (public.get_user_role() IN ('admin', 'manager'));

CREATE POLICY "Allow delete assignments" ON public.vehicle_assignments
    FOR DELETE TO authenticated USING (public.get_user_role() IN ('admin', 'manager'));

-- 6. Alerts Policies
CREATE POLICY "Allow select alerts" ON public.alerts
    FOR SELECT TO authenticated USING (
        public.get_user_role() IN ('admin', 'manager', 'supervisor')
        OR vehicle_id IN (
            SELECT vehicle_id FROM public.vehicle_assignments 
            WHERE driver_id IN (SELECT id FROM public.drivers WHERE profile_id = auth.uid()) AND is_active = true
        )
    );

CREATE POLICY "Allow insert alerts" ON public.alerts
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow update alerts" ON public.alerts
    FOR UPDATE TO authenticated USING (public.get_user_role() IN ('admin', 'manager', 'supervisor')) WITH CHECK (public.get_user_role() IN ('admin', 'manager', 'supervisor'));

CREATE POLICY "Allow delete alerts" ON public.alerts
    FOR DELETE TO authenticated USING (public.get_user_role() IN ('admin', 'manager', 'supervisor'));

-- 7. Trips Policies
CREATE POLICY "Allow select trips" ON public.trips
    FOR SELECT TO authenticated USING (
        public.get_user_role() IN ('admin', 'manager')
        OR driver_id IN (SELECT id FROM public.drivers WHERE profile_id = auth.uid())
    );

CREATE POLICY "Allow insert trips" ON public.trips
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow update trips" ON public.trips
    FOR UPDATE TO authenticated USING (public.get_user_role() IN ('admin', 'manager') OR driver_id IN (SELECT id FROM public.drivers WHERE profile_id = auth.uid())) WITH CHECK (true);

CREATE POLICY "Allow delete trips" ON public.trips
    FOR DELETE TO authenticated USING (public.get_user_role() IN ('admin', 'manager'));

-- 8. Collection Routes Policies
CREATE POLICY "Allow select collection routes" ON public.collection_routes
    FOR SELECT TO authenticated USING (
        public.get_user_role() IN ('admin', 'manager')
        OR driver_id IN (SELECT id FROM public.drivers WHERE profile_id = auth.uid())
    );

CREATE POLICY "Allow insert collection routes" ON public.collection_routes
    FOR INSERT TO authenticated WITH CHECK (public.get_user_role() IN ('admin', 'manager'));

CREATE POLICY "Allow update collection routes" ON public.collection_routes
    FOR UPDATE TO authenticated USING (public.get_user_role() IN ('admin', 'manager')) WITH CHECK (public.get_user_role() IN ('admin', 'manager'));

CREATE POLICY "Allow delete collection routes" ON public.collection_routes
    FOR DELETE TO authenticated USING (public.get_user_role() IN ('admin', 'manager'));

-- 9. Maintenance Records Policies
CREATE POLICY "Allow select maintenance" ON public.maintenance_records
    FOR SELECT TO authenticated USING (
        public.get_user_role() IN ('admin', 'manager')
        OR vehicle_id IN (
            SELECT vehicle_id FROM public.vehicle_assignments 
            WHERE driver_id IN (SELECT id FROM public.drivers WHERE profile_id = auth.uid()) AND is_active = true
        )
    );

CREATE POLICY "Allow insert maintenance" ON public.maintenance_records
    FOR INSERT TO authenticated WITH CHECK (public.get_user_role() IN ('admin', 'manager'));

CREATE POLICY "Allow update maintenance" ON public.maintenance_records
    FOR UPDATE TO authenticated USING (public.get_user_role() IN ('admin', 'manager')) WITH CHECK (public.get_user_role() IN ('admin', 'manager'));

CREATE POLICY "Allow delete maintenance" ON public.maintenance_records
    FOR DELETE TO authenticated USING (public.get_user_role() IN ('admin', 'manager'));

-- 10. Settings Policies
CREATE POLICY "Allow select settings" ON public.settings
    FOR SELECT TO authenticated USING (
        user_id = auth.uid() 
        OR public.get_user_role() IN ('admin', 'manager')
    );

CREATE POLICY "Allow insert settings" ON public.settings
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Allow update settings" ON public.settings
    FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Allow delete settings" ON public.settings
    FOR DELETE TO authenticated USING (user_id = auth.uid());

-- 11. Telemetry History Policies
CREATE POLICY "Allow select telemetry history" ON public.telemetry_history
    FOR SELECT TO authenticated USING (
        public.get_user_role() IN ('admin', 'manager')
        OR vehicle_id IN (
            SELECT vehicle_id FROM public.vehicle_assignments 
            WHERE driver_id IN (SELECT id FROM public.drivers WHERE profile_id = auth.uid()) AND is_active = true
        )
    );

CREATE POLICY "Allow insert telemetry history" ON public.telemetry_history
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

DROP POLICY IF EXISTS "Allow authenticated users to read reports" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to upload reports" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to read vehicle-docs" ON storage.objects;
DROP POLICY IF EXISTS "Allow admins/managers to upload vehicle-docs" ON storage.objects;

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
-- Re-create publication triggers if needed
ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_telemetry;
ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;

-- --------------------------------------------------
-- Table and View Privileges (Grants)
-- --------------------------------------------------
-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Grant select, insert, update, delete on all existing tables to authenticated ONLY
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- Alter default privileges for future tables/sequences/functions to authenticated ONLY
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;

-- =========================================================================
-- PART 9: Sync and repair existing profiles (User request Task 1)
-- =========================================================================
UPDATE public.profiles
SET role = 'admin'
WHERE email = 'wizzaswin@gmail.com' OR email = 'admin@nanjilmilk.com';

UPDATE public.profiles
SET role = 'manager'
WHERE email = 'manager@nanjilmilk.com';
