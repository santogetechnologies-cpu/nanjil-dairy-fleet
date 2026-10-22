-- ==========================================================================
-- Migration: Remove deprecated roles (supervisor, qa, logistics, accounts)
-- Allowed active roles: 'admin', 'manager', 'driver', 'operations'
-- ==========================================================================

-- 1. Migrate any existing profiles with deprecated roles to 'operations'
UPDATE public.profiles 
SET role = 'operations' 
WHERE role IN ('supervisor', 'qa', 'logistics', 'accounts');

-- 2. Update CHECK constraint on public.profiles.role
DO $$
BEGIN
    -- Drop existing role check constraint if it exists
    ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
    
    -- Recreate constraint with active roles only
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check 
        CHECK (role IN ('admin', 'manager', 'driver', 'operations'));
END $$;

-- 3. Update vehicle_compliance RLS policy to active roles
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' AND tablename = 'vehicle_compliance'
    ) THEN
        DROP POLICY IF EXISTS "compliance_select_authenticated" ON public.vehicle_compliance;
        CREATE POLICY "compliance_select_authenticated"
            ON public.vehicle_compliance
            FOR SELECT
            TO authenticated
            USING (
                public.get_user_role() IN ('admin', 'manager', 'operations')
                OR vehicle_id IN (
                    SELECT va.vehicle_id
                    FROM public.vehicle_assignments va
                    JOIN public.drivers d ON va.driver_id = d.id
                    WHERE d.profile_id = auth.uid() AND va.is_active = true
                )
            );
    END IF;
END $$;
