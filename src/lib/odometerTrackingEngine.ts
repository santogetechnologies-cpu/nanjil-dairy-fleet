/**
 * odometerTrackingEngine.ts — Authoritative Real-Time Odometer & Distance Tracking Engine
 *
 * Capabilities:
 * 1. Tracks persistent cumulative odometer reading for each vehicle in Nanjil Fleet.
 * 2. Prioritizes Hardware OBD-II/CAN bus reading when available, falling back to GPS-based cumulative distance.
 * 3. Rejects GPS drift, stationary fluctuation (<5m or <=3 km/h), unrealistic jumps (>200 km), and speed (>160 km/h).
 * 4. Freezes odometer when vehicle is stationary/idle/parked; resumes accumulation when vehicle moves.
 * 5. Strictly isolates vehicles and prevents duplicate distance accumulation.
 * 6. Tracks Today's Distance strictly from 00:00:00 Asia/Kolkata (IST), resetting daily without resetting total odometer.
 * 7. Tracks Current Trip Distance, resetting when a new trip begins after stationary periods.
 * 8. Protects baseline odometers against rollbacks or silent decreases.
 * 9. Persists across browser refreshes and application restarts (Supabase vehicle_odometers / vehicles table & local mirror).
 */

import { haversineDistanceKm } from "./roadRouting.ts";
import { isFleetOperatingCoordinate, getIstDateRange } from "./tripHistoryEngine.ts";
import type { Vehicle } from "./types.ts";

export type OdometerReadingSource = "hardware" | "gps_estimated";

/**
 * Haversine formula to calculate the distance between two consecutive GPS coordinates.
 * R = 6371 km.
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (value: number) => (value * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export interface VehicleOdometerState {
  vehicleId: string;
  vehicleNumber?: string;
  deviceId?: string;
  totalOdometerKm: number;
  todayDistanceKm: number;
  currentTripDistanceKm: number;
  currentSpeedKmh: number;
  readingSource: OdometerReadingSource;
  isMoving: boolean;
  lastUpdated: string;
  todayDate: string; // YYYY-MM-DD in Asia/Kolkata
  previousLatitude?: number;
  previousLongitude?: number;
  previousGpsTimestamp?: string;
  lastProcessedTelemetryId?: string;
  // Backward-compatible aliases:
  lastValidLat?: number;
  lastValidLng?: number;
  lastTelemetryId?: string;
  lastTelemetryTime?: string;
  baselineOdometerKm: number;
}

export interface RawTelemetryInput {
  id?: string | number;
  vehicleId: string;
  lat?: number | null;
  lng?: number | null;
  speed?: number | null;
  odometer?: number | null;
  recordedAt?: string | null;
  source?: string | null;
}

const LOCAL_STORAGE_KEY = "nanjil_fleet_vehicle_odometers";

/**
 * Returns the current date in Asia/Kolkata formatted as YYYY-MM-DD.
 */
export function getTodayIstDateString(refDate = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(refDate);
  } catch {
    return refDate.toISOString().split("T")[0];
  }
}

/**
 * Validates consecutive GPS points and calculates movement distance.
 * Returns 0 if point is stationary, duplicate, invalid, or an impossible jump.
 */
export function calculateMovementDistanceKm(
  prevLat?: number | null,
  prevLng?: number | null,
  prevRecordedAt?: string | null,
  currLat?: number | null,
  currLng?: number | null,
  currRecordedAt?: string | null,
  currentSpeedKmh?: number | null,
): number {
  if (
    prevLat == null ||
    prevLng == null ||
    currLat == null ||
    currLng == null ||
    !isFleetOperatingCoordinate(prevLat, prevLng) ||
    !isFleetOperatingCoordinate(currLat, currLng)
  ) {
    return 0;
  }

  // Stationary & GPS drift rejection: if speed <= 3 km/h, vehicle is stationary
  const speed = Math.max(0, Number(currentSpeedKmh || 0));
  if (speed <= 3) {
    return 0;
  }

  // Exact Haversine formula distance calculation
  const distKm = calculateDistance(prevLat, prevLng, currLat, currLng);

  // Filter tiny GPS drift (< 5 meters)
  if (distKm < 0.005) {
    return 0;
  }

  // Reject unrealistic single-point GPS jumps (> 200 km)
  if (distKm > 200) {
    return 0;
  }

  // Check implied speed if timestamps are present
  if (prevRecordedAt && currRecordedAt) {
    const prevMs = new Date(prevRecordedAt).getTime();
    const currMs = new Date(currRecordedAt).getTime();
    const diffSec = Math.max(0, (currMs - prevMs) / 1000);

    // If signal gap > 15 minutes, do not add fake gap distance
    if (diffSec > 15 * 60) {
      return 0;
    }

    // Reject impossible implied speed (> 160 km/h)
    if (diffSec > 0 && distKm / (diffSec / 3600) > 160) {
      return 0;
    }
  }

  return distKm;
}

/**
 * Initializes a clean VehicleOdometerState preserving verified baseline odometers.
 */
export function initVehicleOdometerState(
  vehicle: {
    id: string;
    number?: string;
    deviceId?: string;
    device_id?: string;
    odometer?: number;
  },
  initialTodayDistance = 0,
  initialTodayDate?: string,
): VehicleOdometerState {
  const baseline = Math.max(0, Number(vehicle.odometer || 0));
  const todayDist = Math.max(0, initialTodayDistance);
  const total = baseline + todayDist;
  const todayDate = initialTodayDate || getTodayIstDateString();

  return {
    vehicleId: vehicle.id,
    vehicleNumber: vehicle.number,
    deviceId: vehicle.deviceId || vehicle.device_id,
    totalOdometerKm: Math.round(total * 100) / 100,
    todayDistanceKm: Math.round(todayDist * 100) / 100,
    currentTripDistanceKm: Math.round(todayDist * 100) / 100,
    currentSpeedKmh: 0,
    readingSource: "gps_estimated",
    isMoving: false,
    lastUpdated: new Date().toISOString(),
    todayDate,
    previousLatitude: undefined,
    previousLongitude: undefined,
    previousGpsTimestamp: undefined,
    lastProcessedTelemetryId: undefined,
    lastValidLat: undefined,
    lastValidLng: undefined,
    lastTelemetryId: undefined,
    lastTelemetryTime: undefined,
    baselineOdometerKm: baseline,
  };
}

/**
 * Pure processing function: takes existing state and an incoming telemetry point,
 * returns updated state and the distance added.
 */
export function processOdometerTelemetry(
  state: VehicleOdometerState,
  input: RawTelemetryInput,
  currentIstDate?: string,
): {
  updatedState: VehicleOdometerState;
  distanceAddedKm: number;
  isDuplicate: boolean;
} {
  const activeIstDate = currentIstDate || getTodayIstDateString();
  const next: VehicleOdometerState = { ...state };

  // 1. Midnight rollover check (Asia/Kolkata)
  if (next.todayDate !== activeIstDate) {
    next.todayDate = activeIstDate;
    next.todayDistanceKm = 0;
    // Note: totalOdometerKm and currentTripDistanceKm are preserved across midnight
  }

  // 2. Duplicate or out-of-order telemetry protection
  const inputIdStr = input.id != null ? String(input.id) : undefined;
  const inputTimeStr = input.recordedAt || undefined;

  if (
    (inputIdStr && (next.lastProcessedTelemetryId === inputIdStr || next.lastTelemetryId === inputIdStr)) ||
    (inputTimeStr && (next.previousGpsTimestamp === inputTimeStr || next.lastTelemetryTime === inputTimeStr) && !inputIdStr)
  ) {
    return { updatedState: next, distanceAddedKm: 0, isDuplicate: true };
  }

  // Reject stale / out-of-order telemetry older than previous point
  if (inputTimeStr && (next.previousGpsTimestamp || next.lastTelemetryTime)) {
    const prevMs = new Date(next.previousGpsTimestamp || next.lastTelemetryTime!).getTime();
    const currMs = new Date(inputTimeStr).getTime();
    if (!isNaN(prevMs) && !isNaN(currMs) && currMs <= prevMs) {
      return { updatedState: next, distanceAddedKm: 0, isDuplicate: true };
    }
  }

  // 3. Priority 1: Hardware Odometer
  const rawOdo = input.odometer != null ? Number(input.odometer) : null;
  if (rawOdo != null && !isNaN(rawOdo) && rawOdo > 0) {
    // Only accept hardware odometer if it doesn't roll backwards from verified baseline
    if (rawOdo >= next.baselineOdometerKm) {
      if (rawOdo >= next.totalOdometerKm) {
        const added = rawOdo - next.totalOdometerKm;
        next.totalOdometerKm = Math.round(rawOdo * 100) / 100;
        next.readingSource = "hardware";
        next.todayDistanceKm = Math.round((next.todayDistanceKm + added) * 100) / 100;
        next.currentTripDistanceKm = Math.round((next.currentTripDistanceKm + added) * 100) / 100;
      }
    }
  }

  // 4. Moving vs Stationary check
  const speed = Math.max(0, Number(input.speed ?? 0));
  const isMoving = speed > 3;
  next.currentSpeedKmh = speed;
  next.isMoving = isMoving;

  let distanceAddedKm = 0;
  const prevLat = next.previousLatitude ?? next.lastValidLat;
  const prevLng = next.previousLongitude ?? next.lastValidLng;
  const prevTime = next.previousGpsTimestamp ?? next.lastTelemetryTime;

  // 5. GPS-Based Distance Accumulation (when moving)
  if (isMoving && input.lat != null && input.lng != null) {
    if (isFleetOperatingCoordinate(input.lat, input.lng)) {
      if (prevLat != null && prevLng != null) {
        // Check if vehicle was stopped for > 15 minutes before this movement (new trip started)
        if (prevTime && input.recordedAt) {
          const prevMs = new Date(prevTime).getTime();
          const currMs = new Date(input.recordedAt).getTime();
          const gapMins = (currMs - prevMs) / 60000;
          if (gapMins > 15 && !state.isMoving) {
            // New trip begins
            next.currentTripDistanceKm = 0;
          }
        }

        const deltaKm = calculateMovementDistanceKm(
          prevLat,
          prevLng,
          prevTime,
          input.lat,
          input.lng,
          input.recordedAt,
          speed,
        );

        if (deltaKm > 0) {
          distanceAddedKm = deltaKm;
          // If reading source is not hardware, increment total odometer with GPS distance
          if (next.readingSource !== "hardware") {
            next.totalOdometerKm = Math.round((next.totalOdometerKm + deltaKm) * 100) / 100;
          }
          next.todayDistanceKm = Math.round((next.todayDistanceKm + deltaKm) * 100) / 100;
          next.currentTripDistanceKm = Math.round((next.currentTripDistanceKm + deltaKm) * 100) / 100;
        }
      }

      next.previousLatitude = Number(input.lat);
      next.previousLongitude = Number(input.lng);
      next.lastValidLat = Number(input.lat);
      next.lastValidLng = Number(input.lng);
    }
  } else if (!isMoving) {
    // When vehicle is stopped/idle: freeze odometer reading, do not accrue drift
    // Current trip distance freezes at its completed value
    if (input.lat != null && input.lng != null && isFleetOperatingCoordinate(input.lat, input.lng)) {
      next.previousLatitude = Number(input.lat);
      next.previousLongitude = Number(input.lng);
      next.lastValidLat = Number(input.lat);
      next.lastValidLng = Number(input.lng);
    }
  }

  if (inputIdStr) {
    next.lastProcessedTelemetryId = inputIdStr;
    next.lastTelemetryId = inputIdStr;
  }
  if (inputTimeStr) {
    next.previousGpsTimestamp = inputTimeStr;
    next.lastTelemetryTime = inputTimeStr;
  }
  next.lastUpdated = inputTimeStr || new Date().toISOString();

  return { updatedState: next, distanceAddedKm, isDuplicate: false };
}

/**
 * Loads all locally cached odometer states from localStorage.
 */
export function loadLocalOdometerStates(): Record<string, VehicleOdometerState> {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.warn("[OdometerEngine] Failed to read from localStorage:", err);
    return {};
  }
}

/**
 * Saves odometer states to localStorage.
 */
export function saveLocalOdometerStates(states: Record<string, VehicleOdometerState>): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(states));
  } catch (err) {
    console.warn("[OdometerEngine] Failed to save to localStorage:", err);
  }
}

/**
 * Persists an odometer state to Supabase (vehicle_odometers + vehicles.odometer sync).
 */
export async function persistVehicleOdometer(
  supabaseClient: any,
  state: VehicleOdometerState,
): Promise<void> {
  if (!supabaseClient || !state.vehicleId) return;

  const lat = state.previousLatitude ?? state.lastValidLat;
  const lng = state.previousLongitude ?? state.lastValidLng;
  const timestamp = state.previousGpsTimestamp ?? state.lastTelemetryTime ?? new Date().toISOString();
  const telemetryId = state.lastProcessedTelemetryId ?? state.lastTelemetryId;

  // 1. Try atomic server RPC if available
  try {
    const { data, error } = await supabaseClient.rpc("accumulate_gps_odometer", {
      p_vehicle_id: state.vehicleId,
      p_device_id: state.deviceId || null,
      p_lat: lat != null ? Number(lat) : null,
      p_lng: lng != null ? Number(lng) : null,
      p_speed: Number(state.currentSpeedKmh || 0),
      p_recorded_at: timestamp,
      p_telemetry_id: telemetryId ? String(telemetryId) : null,
      p_hardware_odometer: state.readingSource === "hardware" ? Number(state.totalOdometerKm) : null,
      p_ist_today_date: state.todayDate,
    });
    if (!error && data) return;
  } catch {
    // If RPC is unavailable, fallback to direct upsert
  }

  const payload = {
    vehicle_id: state.vehicleId,
    device_id: state.deviceId,
    total_odometer_km: state.totalOdometerKm,
    today_distance_km: state.todayDistanceKm,
    current_trip_distance_km: state.currentTripDistanceKm,
    current_speed_kmh: state.currentSpeedKmh,
    reading_source: state.readingSource,
    today_date: state.todayDate,
    is_moving: state.isMoving,
    previous_latitude: lat,
    previous_longitude: lng,
    previous_gps_timestamp: timestamp,
    last_processed_telemetry_id: telemetryId,
    last_valid_lat: lat,
    last_valid_lng: lng,
    last_telemetry_id: telemetryId,
    last_telemetry_time: timestamp,
    updated_at: new Date().toISOString(),
    last_updated_at: new Date().toISOString(),
  };

  try {
    // 2. Try upserting to vehicle_odometers table
    const { error: odoError } = await supabaseClient
      .from("vehicle_odometers")
      .upsert(payload, { onConflict: "vehicle_id" });

    if (odoError) {
      // Table may be in-flight before migration deploy
    }

    // 3. Keep canonical vehicles.odometer in sync if higher than baseline
    const roundedOdo = Math.round(state.totalOdometerKm);
    if (roundedOdo > state.baselineOdometerKm) {
      await supabaseClient
        .from("vehicles")
        .update({ odometer: roundedOdo })
        .eq("id", state.vehicleId);
    }
  } catch (err) {
    console.warn(`[OdometerEngine] Error syncing odometer for ${state.vehicleId}:`, err);
  }
}

/**
 * Computes today's GPS distance from time-series points.
 */
export function calculateTodayGpsDistance(
  points: Array<{ lat: number; lng: number; speed?: number; recorded_at?: string }>,
): number {
  if (!points || points.length < 2) return 0;

  let totalDistKm = 0;
  let prevPt: { lat: number; lng: number; speed?: number; recorded_at?: string } | null = null;

  for (const pt of points) {
    if (
      pt.lat == null ||
      pt.lng == null ||
      !isFleetOperatingCoordinate(pt.lat, pt.lng)
    ) {
      continue;
    }

    if (prevPt) {
      const d = calculateMovementDistanceKm(
        prevPt.lat,
        prevPt.lng,
        prevPt.recorded_at,
        pt.lat,
        pt.lng,
        pt.recorded_at,
        pt.speed ?? 10, // assume moving if consecutive trajectory point
      );
      totalDistKm += d;
    }

    prevPt = pt;
  }

  return Math.round(totalDistKm * 100) / 100;
}

