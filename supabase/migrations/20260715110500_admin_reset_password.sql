-- ==========================================================
-- Migration: Add Admin Password Reset RPC
-- ==========================================================

CREATE OR REPLACE FUNCTION public.admin_reset_user_password(user_id UUID, new_password TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- 1. Check if caller is indeed admin/manager
    IF public.get_user_role() NOT IN ('admin') THEN
        RAISE EXCEPTION 'Only administrators can change user passwords.';
    END IF;

    -- 2. Update auth.users password using bcrypt hash
    UPDATE auth.users 
    SET encrypted_password = crypt(new_password, gen_salt('bf', 10))
    WHERE id = user_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions to authenticated users to run the RPC
GRANT EXECUTE ON FUNCTION public.admin_reset_user_password(UUID, TEXT) TO authenticated;
