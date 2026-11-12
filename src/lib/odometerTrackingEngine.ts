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
  gpsEstimatedDistanceKm?: number;
  lastVerifiedHardwareOdometerKm?: number;
  stationaryStartTime?: string;
  tripStartTime?: string;
}

export interface RawTelemetryInput {
  id?: string | number;
  vehicleId: string;
  lat?: number | null;
  lng?: number | null;
  speed?: number | null;
  odometer?: number | null; // Baseline/reported odometer
  hardwareOdometer?: number | null; // Genuine verified OBD-II/CAN reading from device packet
  isVerifiedHardware?: boolean;
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

  // Check implied speed and time gap if timestamps are present
  if (prevRecordedAt && currRecordedAt) {
    const prevMs = new Date(prevRecordedAt).getTime();
    const currMs = new Date(currRecordedAt).getTime();

    if (!isNaN(prevMs) && !isNaN(currMs)) {
      const diffSec = Math.max(0, (currMs - prevMs) / 1000);

      // If signal gap > 15 minutes, do not add fake gap distance
      if (diffSec > 15 * 60) {
        return 0;
      }

      // Reject impossible implied speed (> 160 km/h)
      if (diffSec > 0 && distKm / (diffSec / 3600) > 160) {
        return 0;
      }

      // Stationary drift rejection: if reported speed is stationary (<= 3 km/h)
      // and implied speed is also stationary (<= 3 km/h), reject as drift
      const speed = Math.max(0, Number(currentSpeedKmh || 0));
      if (speed <= 3 && diffSec > 0 && distKm / (diffSec / 3600) <= 3) {
        return 0;
      }
    }
  } else {
    // Without timestamps, if reported speed <= 3, reject as stationary
    const speed = Math.max(0, Number(currentSpeedKmh || 0));
    if (speed <= 3) {
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
  initialTripDistance = 0,
): VehicleOdometerState {
  const baseline = Math.max(0, Number(vehicle.odometer || 0));
  const todayDist = Math.max(0, initialTodayDistance);
  const tripDist = Math.max(0, initialTripDistance);
  const total = Math.round((baseline + todayDist) * 100) / 100;
  const todayDate = initialTodayDate || getTodayIstDateString();

  return {
    vehicleId: vehicle.id,
    vehicleNumber: vehicle.number,
    deviceId: vehicle.deviceId || vehicle.device_id,
    totalOdometerKm: total,
    todayDistanceKm: Math.round(todayDist * 100) / 100,
    currentTripDistanceKm: Math.round(tripDist * 100) / 100,
    currentSpeedKmh: 0,
    readingSource: "gps_estimated", // Always default to GPS Estimated; never assume static baseline is hardware!
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
    gpsEstimatedDistanceKm: Math.round(todayDist * 100) / 100,
    lastVerifiedHardwareOdometerKm: undefined,
    stationaryStartTime: undefined,
    tripStartTime: undefined,
  };
}

/**
 * Safely reconciles cached odometer state against database baseline and restores
 * GPS Estimated mode if hardware classification was spuriously applied from baseline.
 */
export function reconcileOdometerState(
  cachedState: VehicleOdometerState,
  vehicleBaseline: number,
  currentIstDate = getTodayIstDateString(),
): VehicleOdometerState {
  const reconciled = { ...cachedState };
  const base = Math.max(0, Number(vehicleBaseline || 0));

  // 1. Detect states where hardware classification came only from the vehicle baseline
  if (
    reconciled.readingSource === "hardware" &&
    (!reconciled.lastVerifiedHardwareOdometerKm ||
      reconciled.totalOdometerKm <= base ||
      reconciled.totalOdometerKm === reconciled.baselineOdometerKm)
  ) {
    reconciled.readingSource = "gps_estimated";
  }

  // 2. Ensure baseline is at least the database baseline
  if (base > (reconciled.baselineOdometerKm || 0)) {
    reconciled.baselineOdometerKm = base;
  }

  // 3. Ensure totalOdometerKm is at least baselineOdometerKm + todayDistanceKm
  const minExpectedTotal = Math.round((reconciled.baselineOdometerKm + (reconciled.todayDistanceKm || 0)) * 100) / 100;
  if (reconciled.totalOdometerKm < minExpectedTotal) {
    reconciled.totalOdometerKm = minExpectedTotal;
  }

  // 4. Midnight check (Asia/Kolkata)
  if (reconciled.todayDate !== currentIstDate) {
    reconciled.todayDate = currentIstDate;
    reconciled.todayDistanceKm = 0;
  }

  reconciled.totalOdometerKm = Math.round(reconciled.totalOdometerKm * 100) / 100;
  reconciled.todayDistanceKm = Math.round((reconciled.todayDistanceKm || 0) * 100) / 100;
  reconciled.currentTripDistanceKm = Math.round((reconciled.currentTripDistanceKm || 0) * 100) / 100;

  return reconciled;
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

  // 3. Priority 1: Genuine Hardware Odometer Verification
  let hardwareUpdatedInThisPacket = false;
  const hasExplicitHw =
    input.hardwareOdometer != null &&
    !isNaN(Number(input.hardwareOdometer)) &&
    Number(input.hardwareOdometer) > 0;

  const isVerifiedHardware =
    hasExplicitHw ||
    (input.isVerifiedHardware === true &&
      input.odometer != null &&
      !isNaN(Number(input.odometer)) &&
      Number(input.odometer) > 0);

  const rawHw = isVerifiedHardware
    ? Number(input.hardwareOdometer ?? input.odometer)
    : null;

  if (rawHw != null) {
    // Only accept genuine hardware reading if it doesn't roll backwards from verified baseline
    if (rawHw >= next.baselineOdometerKm) {
      if (rawHw >= next.totalOdometerKm) {
        const added = rawHw - next.totalOdometerKm;
        next.totalOdometerKm = Math.round(rawHw * 100) / 100;
        next.readingSource = "hardware";
        next.lastVerifiedHardwareOdometerKm = next.totalOdometerKm;
        next.todayDistanceKm = Math.round((next.todayDistanceKm + added) * 100) / 100;
        next.currentTripDistanceKm = Math.round((next.currentTripDistanceKm + added) * 100) / 100;
        hardwareUpdatedInThisPacket = true;
      }
    }
  } else {
    // Hardware odometer not provided in this packet.
    // If vehicle was previously in hardware mode, transition seamlessly to GPS Estimated fallback
    // starting from the last verified reading without resetting the cumulative total!
    if (next.readingSource === "hardware") {
      next.readingSource = "gps_estimated";
    }
  }

  // 4. Moving vs Stationary check
  const rawSpeed = input.speed != null ? Math.max(0, Number(input.speed)) : 0;
  let isMoving = rawSpeed > 3;
  let effectiveSpeed = rawSpeed;

  const prevLat = next.previousLatitude ?? next.lastValidLat;
  const prevLng = next.previousLongitude ?? next.lastValidLng;
  const prevTime = next.previousGpsTimestamp ?? next.lastTelemetryTime;

  // If reported speed <= 3, check whether coordinate progression indicates physical movement
  if (
    !isMoving &&
    input.lat != null &&
    input.lng != null &&
    prevLat != null &&
    prevLng != null &&
    isFleetOperatingCoordinate(input.lat, input.lng) &&
    input.recordedAt &&
    prevTime
  ) {
    const prevMs = new Date(prevTime).getTime();
    const currMs = new Date(input.recordedAt).getTime();
    if (!isNaN(prevMs) && !isNaN(currMs)) {
      const diffSec = Math.max(0, (currMs - prevMs) / 1000);
      if (diffSec > 0 && diffSec <= 15 * 60) {
        const rawDist = calculateDistance(prevLat, prevLng, input.lat, input.lng);
        if (rawDist >= 0.005 && rawDist <= 200) {
          const impliedSpeed = rawDist / (diffSec / 3600);
          if (impliedSpeed > 3 && impliedSpeed <= 160) {
            isMoving = true;
            effectiveSpeed = Math.round(impliedSpeed);
          }
        }
      }
    }
  }

  next.currentSpeedKmh = effectiveSpeed;
  next.isMoving = isMoving;

  let distanceAddedKm = 0;

  // 5. GPS-Based Distance Accumulation (when moving)
  if (isMoving && input.lat != null && input.lng != null) {
    if (isFleetOperatingCoordinate(input.lat, input.lng)) {
      if (prevLat != null && prevLng != null) {
        // 1. Check if vehicle was stationary prior to this movement (trip completed, new trip begins)
        if (next.stationaryStartTime && input.recordedAt) {
          const stopMs = new Date(next.stationaryStartTime).getTime();
          const currMs = new Date(input.recordedAt).getTime();
          const stopMins = (currMs - stopMs) / 60000;
          if (stopMins >= 5) {
            // Vehicle was stopped for >= 5 minutes: completed previous trip, new trip begins!
            next.currentTripDistanceKm = 0;
            next.tripStartTime = input.recordedAt;
          }
          next.stationaryStartTime = undefined;
        }

        // 2. Check if signal gap was > 15 minutes before this movement
        if (prevTime && input.recordedAt) {
          const prevMs = new Date(prevTime).getTime();
          const currMs = new Date(input.recordedAt).getTime();
          const gapMins = (currMs - prevMs) / 60000;
          if (gapMins > 15) {
            // Signal gap > 15 minutes: new trip begins
            next.currentTripDistanceKm = 0;
            next.tripStartTime = input.recordedAt;
            next.stationaryStartTime = undefined;
          }
        }

        const deltaKm = calculateMovementDistanceKm(
          prevLat,
          prevLng,
          prevTime,
          input.lat,
          input.lng,
          input.recordedAt,
          effectiveSpeed,
        );

        if (deltaKm > 0) {
          distanceAddedKm = deltaKm;
          // Add valid GPS distance to cumulative odometer if hardware didn't update in this packet
          // (prevents double-counting when hardware telemetry is active)
          if (!hardwareUpdatedInThisPacket) {
            next.totalOdometerKm = Math.round((next.totalOdometerKm + deltaKm) * 100) / 100;
            next.todayDistanceKm = Math.round((next.todayDistanceKm + deltaKm) * 100) / 100;
            next.currentTripDistanceKm = Math.round((next.currentTripDistanceKm + deltaKm) * 100) / 100;
            next.gpsEstimatedDistanceKm = Math.round(((next.gpsEstimatedDistanceKm || 0) + deltaKm) * 100) / 100;
          }
        }
      }

      // Movement confirms active trip; clear any stationary marker
      next.stationaryStartTime = undefined;

      next.previousLatitude = Number(input.lat);
      next.previousLongitude = Number(input.lng);
      next.lastValidLat = Number(input.lat);
      next.lastValidLng = Number(input.lng);
    }
  } else if (!isMoving) {
    // When vehicle is stopped/idle: mark stationary start time, freeze odometer & trip distance
    if (!next.stationaryStartTime) {
      next.stationaryStartTime = input.recordedAt || new Date().toISOString();
    }
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
 * Persists an odometer state to the Supabase vehicles table.
 * Persists rounded integer to vehicles.odometer to prevent PostgreSQL 22P02 / HTTP 400 Bad Request errors.
 * Never calls non-existent tables like vehicle_odometers to avoid HTTP 404 console errors.
 */
export async function persistVehicleOdometer(
  supabaseClient: any,
  state: VehicleOdometerState,
): Promise<void> {
  if (!supabaseClient || !state.vehicleId) return;

  try {
    const decimalOdo = Math.round(state.totalOdometerKm * 100) / 100;
    const integerOdo = Math.round(decimalOdo);

    // Persist to vehicles table. We use integerOdo because the default schema defines
    // vehicles.odometer as INTEGER. Writing a decimal causes PostgreSQL 22P02 error and HTTP 400 Bad Request.
    // An integer update succeeds cleanly on both INTEGER and NUMERIC column types without errors.
    if (integerOdo >= state.baselineOdometerKm) {
      await supabaseClient
        .from("vehicles")
        .update({
          odometer: integerOdo,
          updated_at: new Date().toISOString(),
        })
        .eq("id", state.vehicleId);
    }
  } catch (err) {
    // Non-fatal error handler
  }
}

/**
 * Computes both Today's cumulative distance and Current Trip distance from historical time-series points.
 * A new trip is identified when the vehicle resumes movement after being stopped/stationary for >= stopThresholdMinutes (default: 5m)
 * or across signal gaps > 15 minutes.
 */
export function calculateTodayAndTripDistances(
  points: Array<{ lat: number; lng: number; speed?: number; recorded_at?: string }>,
  stopThresholdMinutes = 5,
): {
  todayDistanceKm: number;
  currentTripDistanceKm: number;
  tripsCount: number;
  currentTripStart?: string;
  isCurrentTripActive: boolean;
} {
  if (!points || points.length < 2) {
    return {
      todayDistanceKm: 0,
      currentTripDistanceKm: 0,
      tripsCount: points && points.length === 1 ? 1 : 0,
      isCurrentTripActive: false,
    };
  }

  // Filter valid fleet operating coordinates
  const validPoints = points.filter(
    (pt) => pt && pt.lat != null && pt.lng != null && isFleetOperatingCoordinate(pt.lat, pt.lng),
  );
  if (validPoints.length < 2) {
    return {
      todayDistanceKm: 0,
      currentTripDistanceKm: 0,
      tripsCount: validPoints.length,
      isCurrentTripActive: false,
    };
  }

  // Sort chronologically ascending by recorded_at
  const sorted = [...validPoints].sort((a, b) => {
    const tA = a.recorded_at ? new Date(a.recorded_at).getTime() : 0;
    const tB = b.recorded_at ? new Date(b.recorded_at).getTime() : 0;
    return tA - tB;
  });

  let todayDistanceKm = 0;
  let currentTripDistanceKm = 0;
  let tripsCount = 1;
  let currentTripStart = sorted[0].recorded_at;

  let stationaryStartMs: number | null = null;
  let prevPt: (typeof sorted)[0] | null = null;
  let isCurrentlyMoving = false;

  for (let i = 0; i < sorted.length; i++) {
    const pt = sorted[i];

    if (!prevPt) {
      prevPt = pt;
      if ((pt.speed ?? 0) <= 3) {
        stationaryStartMs = pt.recorded_at ? new Date(pt.recorded_at).getTime() : null;
      }
      continue;
    }

    const prevMs = prevPt.recorded_at ? new Date(prevPt.recorded_at).getTime() : 0;
    const currMs = pt.recorded_at ? new Date(pt.recorded_at).getTime() : 0;
    const dtSec = Math.max(0, (currMs - prevMs) / 1000);
    const d = calculateMovementDistanceKm(
      prevPt.lat,
      prevPt.lng,
      prevPt.recorded_at,
      pt.lat,
      pt.lng,
      pt.recorded_at,
      pt.speed ?? 10,
    );

    const isMoving = (pt.speed ?? 0) > 3 || (dtSec > 0 && (d / (dtSec / 3600)) > 3);
    isCurrentlyMoving = isMoving;

    if (isMoving) {
      // Check if vehicle was stationary for >= stopThresholdMinutes before this movement
      if (stationaryStartMs !== null) {
        const stopDurationMin = (currMs - stationaryStartMs) / 60000;
        if (stopDurationMin >= stopThresholdMinutes || dtSec > 15 * 60) {
          tripsCount++;
          currentTripDistanceKm = 0; // New trip begins
          currentTripStart = pt.recorded_at;
        }
        stationaryStartMs = null;
      }

      if (d > 0) {
        todayDistanceKm += d;
        currentTripDistanceKm += d;
      }
    } else {
      // Stationary (speed <= 3)
      if (stationaryStartMs === null) {
        stationaryStartMs = prevMs > 0 ? prevMs : currMs;
      }
    }

    prevPt = pt;
  }

  return {
    todayDistanceKm: Math.round(todayDistanceKm * 100) / 100,
    currentTripDistanceKm: Math.round(currentTripDistanceKm * 100) / 100,
    tripsCount,
    currentTripStart,
    isCurrentTripActive: isCurrentlyMoving,
  };
}

/**
 * Computes today's GPS distance from time-series points.
 */
export function calculateTodayGpsDistance(
  points: Array<{ lat: number; lng: number; speed?: number; recorded_at?: string }>,
): number {
  return calculateTodayAndTripDistances(points).todayDistanceKm;
}

