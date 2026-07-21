-- ==========================================================================
-- Migration: Fix driver profile sync trigger to prevent duplicate drivers
-- ==========================================================================

-- 1. Deduplicate existing drivers table entries with duplicate names
-- If a driver has a profile_id assigned, delete any unlinked duplicate driver row with the same name.
DELETE FROM public.drivers d1
WHERE d1.profile_id IS NULL 
  AND EXISTS (
    SELECT 1 FROM public.drivers d2 
    WHERE LOWER(TRIM(d2.name)) = LOWER(TRIM(d1.name)) 
      AND d2.id <> d1.id 
      AND d2.profile_id IS NOT NULL
  );

-- Also remove unlinked duplicate driver rows sharing the exact same name (keeping oldest)
DELETE FROM public.drivers d1
WHERE d1.id IN (
    SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(name)) ORDER BY created_at ASC) as rn
        FROM public.drivers
    ) t WHERE t.rn > 1
);

-- 2. Update trigger function to check for existing unlinked driver before creating a new one
CREATE OR REPLACE FUNCTION public.handle_new_driver_profile()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.role = 'driver' THEN
        -- If an unlinked driver row with the same name exists, attach profile_id to it
        IF EXISTS (SELECT 1 FROM public.drivers WHERE LOWER(TRIM(name)) = LOWER(TRIM(NEW.name)) AND profile_id IS NULL) THEN
            UPDATE public.drivers 
            SET profile_id = NEW.id
            WHERE id = (
                SELECT id FROM public.drivers 
                WHERE LOWER(TRIM(name)) = LOWER(TRIM(NEW.name)) AND profile_id IS NULL 
                LIMIT 1
            );
        -- Otherwise, insert a single new driver record if not already linked
        ELSIF NOT EXISTS (SELECT 1 FROM public.drivers WHERE profile_id = NEW.id) THEN
            INSERT INTO public.drivers (name, license, phone, profile_id)
            VALUES (
                NEW.name,
                'LIC-' || UPPER(SUBSTRING(NEW.id::text FROM 1 FOR 8)),
                '+919999999999',
                NEW.id
            )
            ON CONFLICT (profile_id) DO UPDATE SET name = EXCLUDED.name;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Ensure trigger is attached
DROP TRIGGER IF EXISTS on_driver_profile_created ON public.profiles;
CREATE TRIGGER on_driver_profile_created
    AFTER INSERT ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_driver_profile();
