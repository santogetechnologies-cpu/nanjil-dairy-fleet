-- =============================================================================
-- Migration: Fuel Receipt Photo Storage & Columns (Driver Fuel Logs)
-- =============================================================================
-- Purpose:
--   1. Create public storage bucket 'fuel-receipts' for compressed (10-50 KB)
--      fuel receipt photos taken or uploaded by drivers.
--   2. Add receipt_photo_url column to public.fuel_purchase_logs.
--   3. Extend log_driver_fuel_refill RPC to store p_receipt_photo_url cleanly.
-- =============================================================================

-- 1. Storage bucket for fuel receipt photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('fuel-receipts', 'fuel-receipts', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Allow authenticated read fuel-receipts" ON storage.objects;
CREATE POLICY "Allow authenticated read fuel-receipts"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'fuel-receipts');

DROP POLICY IF EXISTS "Allow public read fuel-receipts" ON storage.objects;
CREATE POLICY "Allow public read fuel-receipts"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'fuel-receipts');

DROP POLICY IF EXISTS "Allow authenticated upload fuel-receipts" ON storage.objects;
CREATE POLICY "Allow authenticated upload fuel-receipts"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fuel-receipts');

-- 2. Extend public.fuel_purchase_logs
ALTER TABLE public.fuel_purchase_logs
  ADD COLUMN IF NOT EXISTS receipt_photo_url TEXT;

-- 3. Extend log_driver_fuel_refill RPC (preserves all previous validations)
DROP FUNCTION IF EXISTS public.log_driver_fuel_refill(UUID, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.log_driver_fuel_refill(UUID, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.log_driver_fuel_refill(
  p_vehicle_id UUID,
  p_liters NUMERIC,
  p_cost NUMERIC,
  p_odometer NUMERIC,
  p_is_full_tank BOOLEAN DEFAULT true,
  p_price_per_liter NUMERIC DEFAULT NULL,
  p_station TEXT DEFAULT NULL,
  p_receipt_ref TEXT DEFAULT NULL,
  p_receipt_photo_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_driver public.drivers%ROWTYPE;
  v_vehicle public.vehicles%ROWTYPE;
  v_is_assigned BOOLEAN := false;
  v_clean_odo NUMERIC(12, 2);
  v_prev_odo NUMERIC(12, 2);
  v_new_log public.fuel_purchase_logs%ROWTYPE;
BEGIN
  v_driver := public._resolve_authenticated_driver();

  IF p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Vehicle ID is required.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.vehicle_assignments
    WHERE vehicle_id = p_vehicle_id
      AND driver_id = v_driver.id
      AND is_active = true
  ) INTO v_is_assigned;

  IF NOT v_is_assigned THEN
    RAISE EXCEPTION 'Unauthorized: You are not assigned to this vehicle.';
  END IF;

  IF p_liters IS NULL OR p_liters <= 0 THEN
    RAISE EXCEPTION 'Volume (Litres) must be greater than 0.';
  END IF;

  IF p_cost IS NULL OR p_cost <= 0 THEN
    RAISE EXCEPTION 'Fuel cost must be greater than 0.';
  END IF;

  v_clean_odo := ROUND(COALESCE(p_odometer, -1)::numeric, 2);
  IF v_clean_odo <= 0 THEN
    RAISE EXCEPTION 'Valid positive physical odometer reading is required.';
  END IF;

  SELECT * INTO v_vehicle FROM public.vehicles WHERE id = p_vehicle_id FOR UPDATE;
  v_prev_odo := ROUND(COALESCE(v_vehicle.odometer, 0)::numeric, 2);

  IF v_prev_odo > 0 AND v_clean_odo < v_prev_odo THEN
    RAISE EXCEPTION 'Odometer reading (% KM) cannot be lower than vehicle''s current odometer (% KM).', v_clean_odo, v_prev_odo;
  END IF;

  INSERT INTO public.fuel_purchase_logs (
    vehicle_id,
    driver_id,
    liters,
    cost,
    odometer,
    is_full_tank,
    price_per_liter,
    station,
    receipt_ref,
    receipt_photo_url
  ) VALUES (
    p_vehicle_id,
    v_driver.id,
    ROUND(p_liters::numeric, 2),
    ROUND(p_cost::numeric, 2),
    ROUND(v_clean_odo)::INTEGER,
    COALESCE(p_is_full_tank, true),
    CASE WHEN p_price_per_liter IS NOT NULL AND p_price_per_liter > 0 THEN ROUND(p_price_per_liter::numeric, 2) ELSE NULL END,
    NULLIF(TRIM(p_station), ''),
    NULLIF(TRIM(p_receipt_ref), ''),
    NULLIF(TRIM(p_receipt_photo_url), '')
  )
  RETURNING * INTO v_new_log;

  IF v_clean_odo > v_prev_odo THEN
    UPDATE public.vehicles
    SET odometer = v_clean_odo,
        odometer_source = 'FUEL_LOG',
        odometer_updated_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    WHERE id = p_vehicle_id;

    INSERT INTO public.odometer_audit_logs (
      vehicle_id,
      driver_id,
      actor_profile_id,
      previous_odometer,
      new_odometer,
      running_km,
      source,
      notes
    ) VALUES (
      p_vehicle_id,
      v_driver.id,
      v_uid,
      v_prev_odo,
      v_clean_odo,
      ROUND((v_clean_odo - v_prev_odo)::numeric, 2),
      'FUEL_LOG',
      CONCAT_WS(' · ', 'Fuel refill log', NULLIF(TRIM(p_station), ''), NULLIF(TRIM(p_receipt_ref), ''))
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'fuel_log', to_jsonb(v_new_log),
    'vehicle_odometer', GREATEST(v_prev_odo, v_clean_odo)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_driver_fuel_refill(UUID, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_driver_fuel_refill(UUID, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
