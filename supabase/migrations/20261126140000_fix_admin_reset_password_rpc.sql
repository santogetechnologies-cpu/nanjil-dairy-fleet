-- =============================================================================
-- NANJIL DAIRY FLEET — HARDENED ADMIN USER PASSWORD RESET RPC
-- Migration: 20261126140000_fix_admin_reset_password_rpc.sql
--
-- Fixes & Enhancements:
-- 1. Ensures pgcrypto extension is enabled and `extensions` is included in
--    SECURITY DEFINER `search_path` (Supabase installs pgcrypto in `extensions`).
-- 2. Verifies caller is an Active Administrator directly from `public.profiles`.
-- 3. Validates minimum 8-character password and verifies target user exists.
-- 4. Confirms email if needed and clears recovery lockouts when resetting.
-- 5. Adds `admin_reset_user_password_by_email` so unlinked driver/staff accounts
--    existing in `auth.users` can have their password reset in-place without
--    deleting or breaking historical foreign keys.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP FUNCTION IF EXISTS public.admin_reset_user_password(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.admin_reset_user_password(
  user_id UUID,
  new_password TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_caller public.profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_caller FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR v_caller.status <> 'Active' OR v_caller.role <> 'admin' THEN
    RAISE EXCEPTION 'Only active administrators can reset user passwords.';
  END IF;

  IF user_id IS NULL THEN
    RAISE EXCEPTION 'Target user ID is required.';
  END IF;

  IF new_password IS NULL OR char_length(new_password) < 8 THEN
    RAISE EXCEPTION 'New password must be at least 8 characters long.';
  END IF;

  UPDATE auth.users
  SET
    encrypted_password = crypt(new_password, gen_salt('bf', 10)),
    email_confirmed_at = COALESCE(email_confirmed_at, timezone('utc', now())),
    confirmation_token = COALESCE(confirmation_token, ''),
    recovery_token = COALESCE(recovery_token, ''),
    updated_at = timezone('utc', now())
  WHERE id = user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth account not found for user ID %.', user_id;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_user_password(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_password(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reset_user_password_by_email(
  target_email TEXT,
  new_password TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_caller public.profiles%ROWTYPE;
  v_target_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_caller FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR v_caller.status <> 'Active' OR v_caller.role <> 'admin' THEN
    RAISE EXCEPTION 'Only active administrators can reset user passwords.';
  END IF;

  IF target_email IS NULL OR TRIM(target_email) = '' THEN
    RAISE EXCEPTION 'Target email address is required.';
  END IF;

  IF new_password IS NULL OR char_length(new_password) < 8 THEN
    RAISE EXCEPTION 'New password must be at least 8 characters long.';
  END IF;

  SELECT id INTO v_target_id
  FROM auth.users
  WHERE LOWER(email) = LOWER(TRIM(target_email))
  LIMIT 1;

  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'No auth account found for email %.', TRIM(target_email);
  END IF;

  UPDATE auth.users
  SET
    encrypted_password = crypt(new_password, gen_salt('bf', 10)),
    email_confirmed_at = COALESCE(email_confirmed_at, timezone('utc', now())),
    confirmation_token = COALESCE(confirmation_token, ''),
    recovery_token = COALESCE(recovery_token, ''),
    updated_at = timezone('utc', now())
  WHERE id = v_target_id;

  RETURN v_target_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_user_password_by_email(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_password_by_email(TEXT, TEXT) TO authenticated;
