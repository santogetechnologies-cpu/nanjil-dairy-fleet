-- ==========================================================================
-- Migration: Fix profiles SELECT policy and get_user_role to bypass recursion
-- ==========================================================================

-- 1. Redefine profiles select policy to allow authenticated users to view profiles
-- This breaks recursion because selecting profiles no longer invokes get_user_role()
DROP POLICY IF EXISTS "Allow select profiles" ON public.profiles;
CREATE POLICY "Allow select profiles" ON public.profiles
    FOR SELECT TO authenticated USING (true);

-- 2. Restore get_user_role to query public.profiles (the source of truth)
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text AS $$
DECLARE
    r text;
BEGIN
    SELECT role INTO r FROM public.profiles WHERE id = auth.uid();
    RETURN COALESCE(r, 'driver');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
