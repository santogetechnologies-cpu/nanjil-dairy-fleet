-- ==============================================================================
-- Migration: Add is_full_tank flag to fuel_purchase_logs for full-tank mileage calculation
-- ==============================================================================

ALTER TABLE public.fuel_purchase_logs
ADD COLUMN IF NOT EXISTS is_full_tank BOOLEAN NOT NULL DEFAULT true;

-- Ensure permissions remain granted for anon and authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fuel_purchase_logs TO anon, authenticated;
