-- =============================================================================
-- Migration: Filter Corrupt GPS Speed Spikes (> 150 km/h) & Dedupe Safety Alerts
-- =============================================================================
-- Purpose:
--   1. Remove existing corrupt overspeed alerts (e.g. 333 km/h GPS packet glitches)
--      and clamp existing corrupt > 150 km/h speed readings in telemetry tables.
--   2. Add a BEFORE INSERT trigger on public.alerts to silently discard impossible
--      Safety speed alerts (> 150 km/h) without failing telemetry ingestion.
--   3. Add atomic record_safety_overspeed_alert RPC using pg_advisory_xact_lock
--      so multiple open browser tabs cannot create duplicate safety alerts in the
--      same second or cooldown window.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Clean up historical corrupt speed spike alerts & telemetry rows
-- -----------------------------------------------------------------------------
DELETE FROM public.alerts
WHERE type = 'Safety'
  AND message ~ '(15[1-9]|1[6-9][0-9]|[2-9][0-9]{2}|[0-9]{4,})\s*km/h';

-- Deduplicate identical Safety alerts created within the same second by multi-tab clients
WITH ranked_dups AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY vehicle_id, type, severity, message, date_trunc('second', time)
      ORDER BY time ASC, id ASC
    ) AS rn
  FROM public.alerts
  WHERE type = 'Safety'
)
DELETE FROM public.alerts
WHERE id IN (SELECT id FROM ranked_dups WHERE rn > 1);

UPDATE public.vehicle_telemetry
SET speed = 0
WHERE speed > 150 OR speed < 0;

UPDATE public.telemetry_history
SET speed = 0
WHERE speed > 150 OR speed < 0;

-- -----------------------------------------------------------------------------
-- 2. Trigger guard: Drop impossible > 150 km/h Safety alerts before insert
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tr_filter_implausible_safety_speed_alerts()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_match TEXT[];
  v_speed_num NUMERIC;
BEGIN
  IF NEW.type = 'Safety' AND NEW.message IS NOT NULL THEN
    v_match := regexp_match(NEW.message, '([0-9]+(?:\.[0-9]+)?)\s*km/h', 'i');
    IF v_match IS NOT NULL AND array_length(v_match, 1) >= 1 THEN
      v_speed_num := v_match[1]::NUMERIC;
      IF v_speed_num > 150 OR v_speed_num < 0 THEN
        RETURN NULL;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_alerts_filter_implausible_speed ON public.alerts;
CREATE TRIGGER tr_alerts_filter_implausible_speed
  BEFORE INSERT ON public.alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_filter_implausible_safety_speed_alerts();

-- -----------------------------------------------------------------------------
-- 3. Atomic RPC: record_safety_overspeed_alert
--    Prevents corrupt > 150 km/h alerts and multi-tab simultaneous duplicates.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_safety_overspeed_alert(
  p_vehicle_id UUID,
  p_speed NUMERIC,
  p_limit NUMERIC DEFAULT 60,
  p_severity TEXT DEFAULT 'High',
  p_message TEXT DEFAULT NULL,
  p_cooldown_minutes INTEGER DEFAULT 15
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cooldown INTEGER := GREATEST(1, COALESCE(p_cooldown_minutes, 15));
  v_severity TEXT := CASE WHEN p_severity IN ('High', 'Medium', 'Low') THEN p_severity ELSE 'High' END;
  v_msg TEXT;
  v_exists BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_vehicle_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'inserted', false, 'reason', 'MISSING_VEHICLE');
  END IF;

  IF p_speed IS NULL OR p_speed <= 0 OR p_speed > 150 THEN
    RETURN jsonb_build_object('ok', false, 'inserted', false, 'reason', 'IMPLAUSIBLE_SPEED_SPIKE');
  END IF;

  IF p_speed <= COALESCE(p_limit, 60) THEN
    RETURN jsonb_build_object('ok', false, 'inserted', false, 'reason', 'WITHIN_SPEED_LIMIT');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_vehicle_id::TEXT || ':Safety:' || v_severity));

  SELECT EXISTS (
    SELECT 1
    FROM public.alerts a
    WHERE a.vehicle_id = p_vehicle_id
      AND a.type = 'Safety'
      AND a.severity = v_severity
      AND a.resolved = false
      AND a.time >= (timezone('utc', now()) - make_interval(mins => v_cooldown))
  ) INTO v_exists;

  IF v_exists THEN
    RETURN jsonb_build_object('ok', true, 'inserted', false, 'reason', 'COOLDOWN_ACTIVE');
  END IF;

  v_msg := COALESCE(
    NULLIF(TRIM(COALESCE(p_message, '')), ''),
    'Critical overspeed: ' || ROUND(p_speed)::TEXT || ' km/h recorded in ' || ROUND(COALESCE(p_limit, 60))::TEXT || ' km/h zone (excess: +' || GREATEST(0, ROUND(p_speed - COALESCE(p_limit, 60)))::TEXT || ' km/h)'
  );

  INSERT INTO public.alerts (vehicle_id, type, severity, message, time, resolved)
  VALUES (p_vehicle_id, 'Safety', v_severity, v_msg, timezone('utc', now()), false);

  RETURN jsonb_build_object('ok', true, 'inserted', true);
END;
$$;

REVOKE ALL ON FUNCTION public.record_safety_overspeed_alert(UUID, NUMERIC, NUMERIC, TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_safety_overspeed_alert(UUID, NUMERIC, NUMERIC, TEXT, TEXT, INTEGER) TO authenticated;
