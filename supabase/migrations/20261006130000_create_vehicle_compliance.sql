-- ==========================================================================
-- Migration: Create vehicle_compliance table, view, RLS, and indexes
-- ==========================================================================

-- 1. Create vehicle_compliance table
CREATE TABLE IF NOT EXISTS public.vehicle_compliance (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    fc_inspection_date DATE,
    fc_expiry_date DATE,
    tn_permit_expiry DATE,
    kl_permit_expiry DATE,
    tn_tax_expiry DATE,
    kl_tax_expiry DATE,
    pollution_expiry DATE,
    food_safety_expiry DATE,
    insurance_expiry DATE,
    advertisement_expiry DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    CONSTRAINT uq_vehicle_compliance_vehicle UNIQUE (vehicle_id),
    CONSTRAINT check_fc_dates CHECK (
        fc_inspection_date IS NULL OR fc_expiry_date IS NULL OR fc_expiry_date >= fc_inspection_date
    )
);

-- 2. Indexes for performance
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_compliance_vehicle_id ON public.vehicle_compliance(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_compliance_fc_expiry ON public.vehicle_compliance(fc_expiry_date);
CREATE INDEX IF NOT EXISTS idx_vehicle_compliance_pollution_expiry ON public.vehicle_compliance(pollution_expiry);
CREATE INDEX IF NOT EXISTS idx_vehicle_compliance_insurance_expiry ON public.vehicle_compliance(insurance_expiry);

-- 3. Automatic updated_at trigger
DROP TRIGGER IF EXISTS tr_vehicle_compliance_updated_at ON public.vehicle_compliance;
CREATE TRIGGER tr_vehicle_compliance_updated_at
    BEFORE UPDATE ON public.vehicle_compliance
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Secure Database View: v_vehicle_compliance (Security Invoker)
CREATE OR REPLACE VIEW public.v_vehicle_compliance WITH (security_invoker = true) AS
SELECT 
    v.id AS vehicle_id,
    v.number AS vehicle_no,
    v.model,
    v.type,
    COALESCE(
      CASE 
        WHEN UPPER(v.model) LIKE '%TARRUS%' OR UPPER(v.model) LIKE '%TAURUS%' OR UPPER(v.model) LIKE '%15%KL%' OR UPPER(v.model) LIKE '%20%KL%' THEN 'TAURUS'
        WHEN UPPER(v.model) LIKE '%ECOMET%' OR UPPER(v.model) LIKE '%EICHER%' THEN 'ECOMET'
        WHEN UPPER(v.model) LIKE '%BOSS%' THEN 'BOSS'
        WHEN UPPER(v.model) LIKE '%709%' THEN 'TATA - 709'
        WHEN UPPER(v.model) LIKE '%407%' THEN 'TATA - 407'
        WHEN UPPER(v.model) LIKE '%DOST%' THEN 'BADA DOST'
        WHEN UPPER(v.model) LIKE '%INTRA%' OR UPPER(v.model) LIKE '%INDRA%' THEN 'TATA INTRA'
        WHEN UPPER(v.model) LIKE '%ACE%' THEN 'TATA ACE'
        WHEN UPPER(v.model) LIKE '%PARTNER%' THEN 'ASHOK PARTNER'
        ELSE UPPER(COALESCE(NULLIF(v.model, 'Unknown Model'), v.type, 'OTHER'))
      END,
      'OTHER'
    ) AS vehicle_group,
    vc.id AS compliance_id,
    vc.fc_inspection_date,
    vc.fc_expiry_date,
    vc.tn_permit_expiry,
    vc.kl_permit_expiry,
    vc.tn_tax_expiry,
    vc.kl_tax_expiry,
    vc.pollution_expiry,
    vc.food_safety_expiry,
    vc.insurance_expiry,
    vc.advertisement_expiry,
    vc.created_at,
    vc.updated_at,
    vc.created_by,
    vc.updated_by
FROM public.vehicles v
LEFT JOIN public.vehicle_compliance vc ON v.id = vc.vehicle_id;

-- 5. Realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'vehicle_compliance'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_compliance;
  END IF;
END $$;

-- 6. Add compliance warning threshold column to settings if not exists
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS compliance_warning_days INTEGER NOT NULL DEFAULT 30 CHECK (compliance_warning_days BETWEEN 1 AND 180);

-- 7. Security & Row Level Security (RLS) - Least Privilege
-- First, revoke any broad grants inherited from historical migrations
REVOKE ALL ON public.vehicle_compliance FROM anon;
REVOKE ALL ON public.vehicle_compliance FROM authenticated;

-- Grant explicit table permissions to authenticated role only
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_compliance TO authenticated;

-- Grant read permission on view to authenticated
GRANT SELECT ON public.v_vehicle_compliance TO authenticated;

-- Enable RLS on vehicle_compliance
ALTER TABLE public.vehicle_compliance ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies
DROP POLICY IF EXISTS "compliance_select_authenticated" ON public.vehicle_compliance;
DROP POLICY IF EXISTS "compliance_insert_admin_manager" ON public.vehicle_compliance;
DROP POLICY IF EXISTS "compliance_update_admin_manager" ON public.vehicle_compliance;
DROP POLICY IF EXISTS "compliance_delete_admin" ON public.vehicle_compliance;

-- Policy 1: SELECT
-- Admins/Managers can view all fleet compliance records.
-- Drivers can only view compliance for their assigned active vehicle.
CREATE POLICY "compliance_select_authenticated"
    ON public.vehicle_compliance
    FOR SELECT
    TO authenticated
    USING (
        public.get_user_role() IN ('admin', 'manager', 'supervisor', 'operations')
        OR vehicle_id IN (
            SELECT va.vehicle_id
            FROM public.vehicle_assignments va
            JOIN public.drivers d ON va.driver_id = d.id
            WHERE d.profile_id = auth.uid() AND va.is_active = true
        )
    );

-- Policy 2: INSERT
-- Only admins and managers may create compliance entries.
CREATE POLICY "compliance_insert_admin_manager"
    ON public.vehicle_compliance
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.get_user_role() IN ('admin', 'manager')
    );

-- Policy 3: UPDATE
-- Only admins and managers may modify compliance entries.
CREATE POLICY "compliance_update_admin_manager"
    ON public.vehicle_compliance
    FOR UPDATE
    TO authenticated
    USING (
        public.get_user_role() IN ('admin', 'manager')
    )
    WITH CHECK (
        public.get_user_role() IN ('admin', 'manager')
    );

-- Policy 4: DELETE
-- Only admins may delete compliance records.
CREATE POLICY "compliance_delete_admin"
    ON public.vehicle_compliance
    FOR DELETE
    TO authenticated
    USING (
        public.get_user_role() = 'admin'
    );
