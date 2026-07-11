-- ==========================================================================
-- Migration: Fix infinite recursion in get_user_role() and profiles RLS policies
-- ==========================================================================

-- Redefine get_user_role to query auth.users metadata directly.
-- This prevents the function from querying public.profiles, which itself
-- references get_user_role() in its SELECT policy, causing infinite stack recursion.
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text AS $$
DECLARE
    r text;
BEGIN
    SELECT COALESCE(raw_user_meta_data->>'role', 'driver') INTO r 
    FROM auth.users 
    WHERE id = auth.uid();
    RETURN COALESCE(r, 'driver');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
