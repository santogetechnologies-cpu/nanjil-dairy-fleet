-- ==========================================================
-- Migration: Fix RLS policies on public.alerts to prevent 401 for authenticated/anon users
-- ==========================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alerts TO anon, authenticated;

DROP POLICY IF EXISTS "Allow select alerts" ON public.alerts;
DROP POLICY IF EXISTS "Allow anon select alerts" ON public.alerts;
DROP POLICY IF EXISTS "Allow select alerts for all" ON public.alerts;

CREATE POLICY "Allow select alerts for all" ON public.alerts
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow insert alerts" ON public.alerts;
DROP POLICY IF EXISTS "Allow insert alerts for authenticated and anon" ON public.alerts;

CREATE POLICY "Allow insert alerts for authenticated and anon" ON public.alerts
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update alerts" ON public.alerts;
DROP POLICY IF EXISTS "Allow update alerts for authenticated and anon" ON public.alerts;

CREATE POLICY "Allow update alerts for authenticated and anon" ON public.alerts
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
