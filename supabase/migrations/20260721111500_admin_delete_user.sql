-- ==========================================================
-- Migration: Add Admin Delete User RPC Functions
-- ==========================================================

-- Function 1: Delete User by ID (removes from auth.users, profiles, and drivers)
CREATE OR REPLACE FUNCTION public.admin_delete_user(target_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    -- Check if caller is admin
    IF public.get_user_role() NOT IN ('admin') THEN
        RAISE EXCEPTION 'Only administrators can delete user accounts.';
    END IF;

    -- Delete driver mapping if exists
    DELETE FROM public.drivers WHERE profile_id = target_user_id;

    -- Delete profile
    DELETE FROM public.profiles WHERE id = target_user_id;

    -- Delete auth user from auth.users table
    DELETE FROM auth.users WHERE id = target_user_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;

-- Function 2: Delete User by Email (for clearing orphaned auth accounts)
CREATE OR REPLACE FUNCTION public.admin_delete_user_by_email(target_email TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    found_id UUID;
BEGIN
    IF public.get_user_role() NOT IN ('admin') THEN
        RAISE EXCEPTION 'Only administrators can delete user accounts.';
    END IF;

    SELECT id INTO found_id FROM auth.users WHERE LOWER(email) = LOWER(TRIM(target_email)) LIMIT 1;

    IF found_id IS NOT NULL THEN
        DELETE FROM public.drivers WHERE profile_id = found_id;
        DELETE FROM public.profiles WHERE id = found_id;
        DELETE FROM auth.users WHERE id = found_id;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.admin_delete_user_by_email(TEXT) TO authenticated;
