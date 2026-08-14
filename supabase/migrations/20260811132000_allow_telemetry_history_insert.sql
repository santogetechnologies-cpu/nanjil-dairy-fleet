-- ==========================================================
-- Migration: Grant INSERT & SELECT on telemetry_history to anon & authenticated roles
-- ==========================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.telemetry_history TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- RLS Policies for telemetry_history
DROP POLICY IF EXISTS "Allow insert telemetry history" ON public.telemetry_history;
DROP POLICY IF EXISTS "Allow anon insert telemetry_history" ON public.telemetry_history;
CREATE POLICY "Allow anon insert telemetry_history" ON public.telemetry_history
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow select telemetry history" ON public.telemetry_history;
DROP POLICY IF EXISTS "Allow anon select telemetry_history" ON public.telemetry_history;
CREATE POLICY "Allow anon select telemetry_history" ON public.telemetry_history
    FOR SELECT TO anon, authenticated USING (true);
