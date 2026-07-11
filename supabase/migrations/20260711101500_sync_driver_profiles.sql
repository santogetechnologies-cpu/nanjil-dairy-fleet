-- ==========================================================================
-- Migration: Sync driver profiles with drivers table + add auto-create trigger
-- ==========================================================================

-- 1. Sync any existing profiles that have role = 'driver' but no driver record
INSERT INTO public.drivers (name, license, phone, profile_id)
SELECT 
    p.name,
    'LIC-' || UPPER(SUBSTRING(p.id::text FROM 1 FOR 8)) AS license,
    '+919999999999' AS phone,
    p.id AS profile_id
FROM public.profiles p
WHERE p.role = 'driver'
  AND p.id NOT IN (SELECT profile_id FROM public.drivers WHERE profile_id IS NOT NULL)
ON CONFLICT (profile_id) DO NOTHING;

-- 2. Create trigger function to auto-create a driver row when a user with role = 'driver' is created
CREATE OR REPLACE FUNCTION public.handle_new_driver_profile()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.role = 'driver' THEN
        INSERT INTO public.drivers (name, license, phone, profile_id)
        VALUES (
            NEW.name,
            'LIC-' || UPPER(SUBSTRING(NEW.id::text FROM 1 FOR 8)),
            '+919999999999',
            NEW.id
        )
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Bind trigger to public.profiles
DROP TRIGGER IF EXISTS on_driver_profile_created ON public.profiles;
CREATE TRIGGER on_driver_profile_created
    AFTER INSERT ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_driver_profile();
