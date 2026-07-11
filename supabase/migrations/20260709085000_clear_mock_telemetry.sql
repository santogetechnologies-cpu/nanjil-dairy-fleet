-- ==========================================================================
-- Migration: Reset and clear pre-seeded mock vehicle telemetry
-- Since ESP32 microcontrollers are not yet connected, all vehicle telemetry
-- is set to default unconfigured values (Offline, 0 speed, 0 fuel, NULL GPS).
-- ==========================================================================

UPDATE public.vehicle_telemetry
SET status = 'Offline',
    location = 'Unknown',
    lat = NULL,
    lng = NULL,
    speed = 0,
    fuel = 0,
    temperature = NULL,
    humidity = NULL,
    engine_on = false,
    ignition = false;
