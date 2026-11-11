-- Migration: Create vehicle_odometers table for Real-Time Odometer & Distance Tracking
-- Date: 2026-11-11
-- Version: 20261111160000

CREATE TABLE IF NOT EXISTS public.vehicle_odometers (
  vehicle_id               UUID PRIMARY KEY REFERENCES public.vehicles(id) ON DELETE CASCADE,
  total_odometer_km        NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  today_distance_km        NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  current_trip_distance_km NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  current_speed_kmh        NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
  reading_source           TEXT NOT NULL DEFAULT 'gps_estimated' CHECK (reading_source IN ('hardware', 'gps_estimated')),
  today_date               TEXT NOT NULL,
  is_moving                BOOLEAN NOT NULL DEFAULT false,
  last_valid_lat           NUMERIC(9, 6),
  last_valid_lng           NUMERIC(9, 6),
  last_telemetry_id        TEXT,
  last_telemetry_time      TIMESTAMP WITH TIME ZONE,
  last_updated_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
  created_at               TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- Performance index
CREATE INDEX IF NOT EXISTS idx_vehicle_odometers_updated_at ON public.vehicle_odometers(last_updated_at DESC);

-- Enable Row Level Security
ALTER TABLE public.vehicle_odometers ENABLE ROW LEVEL SECURITY;

-- Allow anon and authenticated read access
CREATE POLICY "Allow read vehicle_odometers"
  ON public.vehicle_odometers FOR SELECT
  USING (true);

-- Allow anon and authenticated insert access
CREATE POLICY "Allow insert vehicle_odometers"
  ON public.vehicle_odometers FOR INSERT
  WITH CHECK (true);

-- Allow anon and authenticated update access
CREATE POLICY "Allow update vehicle_odometers"
  ON public.vehicle_odometers FOR UPDATE
  USING (true);
