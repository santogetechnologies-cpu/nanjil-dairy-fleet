-- ==========================================================================
-- Migration: Create driver shifts table for active-hours tracking
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.driver_shifts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    driver_id UUID REFERENCES public.drivers(id) ON DELETE CASCADE NOT NULL,
    vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE,
    active_hours NUMERIC(10,2) DEFAULT 0.00 CHECK (active_hours >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.driver_shifts ENABLE ROW LEVEL SECURITY;

-- Apply updated_at trigger
DROP TRIGGER IF EXISTS tr_driver_shifts_updated_at ON public.driver_shifts;
CREATE TRIGGER tr_driver_shifts_updated_at BEFORE UPDATE ON public.driver_shifts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Policies
CREATE POLICY "Allow select shifts" ON public.driver_shifts
    FOR SELECT TO authenticated USING (
        public.get_user_role() IN ('admin', 'manager')
        -- Driver can see their own shifts
        OR driver_id IN (SELECT id FROM public.drivers WHERE profile_id = auth.uid())
    );

CREATE POLICY "Allow insert shifts" ON public.driver_shifts
    FOR INSERT TO authenticated WITH CHECK (
        public.get_user_role() IN ('admin', 'manager')
        OR driver_id IN (SELECT id FROM public.drivers WHERE profile_id = auth.uid())
    );

CREATE POLICY "Allow update shifts" ON public.driver_shifts
    FOR UPDATE TO authenticated USING (
        public.get_user_role() IN ('admin', 'manager')
        OR driver_id IN (SELECT id FROM public.drivers WHERE profile_id = auth.uid())
    ) WITH CHECK (
        public.get_user_role() IN ('admin', 'manager')
        OR driver_id IN (SELECT id FROM public.drivers WHERE profile_id = auth.uid())
    );

CREATE POLICY "Allow delete shifts" ON public.driver_shifts
    FOR DELETE TO authenticated USING (public.get_user_role() IN ('admin', 'manager'));

-- Publication triggers for real-time
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_shifts;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_shifts TO authenticated;
