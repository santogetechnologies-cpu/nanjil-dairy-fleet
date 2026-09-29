/**
 * useAverageSpeed — GPS-based average speed calculator for live vehicle tracking
 *
 * Calculates Average Speed as:
 *   Total Distance Travelled (km) / Total Driving Time (hours)
 *
 * Uses the Haversine formula on consecutive GPS coordinates, NOT averaging
 * Firebase speed values.
 *
 * Each vehicle/device maintains its own independent tracking state.
 * The calculation is incremental — only the new GPS segment is computed
 * on each update, avoiding full-history recalculation.
 */

import { useRef, useCallback } from "react";

/** A single GPS tracking point for average speed calculation */
export interface GpsTrackingPoint {
  lat: number;
  lng: number;
  timestamp: number; // Unix epoch ms
  speed: number; // Current speed from telemetry (used to determine moving vs idle)
}

/** Cumulative tracking state for a single device */
export interface DeviceTrackingState {
  /** The last valid GPS point recorded */
  lastPoint: GpsTrackingPoint;
  /** Total distance travelled in km */
  totalDistanceKm: number;
  /** Total driving time in seconds (only periods where vehicle was moving) */
  totalDrivingTimeSec: number;
  /** Number of valid moving segments accumulated */
  segmentCount: number;
  /** Calculated average speed in km/h, or null if insufficient data */
  averageSpeed: number | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Earth radius in kilometers */
export const EARTH_RADIUS_KM = 6371;

/** Minimum speed (km/h) to be considered "moving" for driving-time accumulation */
export const MOVING_SPEED_THRESHOLD = 1;

/**
 * Maximum realistic segment distance in km.
 * GPS jumps exceeding this are treated as outliers and discarded.
 * (e.g. 200 km jump in a single telemetry interval is impossible for a dairy fleet)
 */
export const MAX_SEGMENT_DISTANCE_KM = 200;

/**
 * Maximum realistic implied speed (km/h) between consecutive updates.
 * Guards against sudden GPS multipath/teleportation jumps within small time intervals.
 */
export const MAX_REALISTIC_SPEED_KMH = 150;

/**
 * Maximum gap in seconds between two consecutive points before we consider it
 * a "signal lost" gap and do NOT count it as driving time.
 * (10 minutes — if no update for 10min, the segment is unreliable)
 */
export const MAX_GAP_SECONDS = 600;

/**
 * Minimum driving seconds needed before reporting an average speed
 * to avoid erratic initial micro-segment division.
 */
export const MIN_DRIVING_TIME_SEC_FOR_AVG = 5;

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeDevId(val: unknown): string {
  if (val == null) return "";
  return String(val).trim().replace(/\D/g, "");
}

/**
 * Calculates the great-circle distance between two GPS coordinates
 * using the Haversine formula.
 * @returns Distance in kilometres
 */
export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

export function isValidCoord(lat: number, lng: number): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    lat !== 0 &&
    lng !== 0 &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function isValidTimestamp(ts: number): boolean {
  return typeof ts === "number" && !isNaN(ts) && ts > 0;
}

// ── GPS Average Speed Tracker Engine ──────────────────────────────────────────

/**
 * Pure calculation engine for GPS-based average speed tracking.
 * Maintains independent state per normalized device ID.
 * Usable directly in headless scripts, background workers, and React hooks.
 */
export class GpsAverageSpeedTracker {
  private states = new Map<string, DeviceTrackingState>();

  /**
   * Record a new GPS telemetry point for a device.
   * Incrementally updates total distance and driving time.
   *
   * @param rawDeviceId Device identifier
   * @param lat Latitude (-90 to 90)
   * @param lng Longitude (-180 to 180)
   * @param speed Instantaneous telemetry speed in km/h
   * @param timestamp Optional epoch timestamp in ms (defaults to Date.now())
   */
  public updateGpsPoint(
    rawDeviceId: string,
    lat: number,
    lng: number,
    speed: number,
    timestamp?: number,
  ): void {
    const deviceId = normalizeDevId(rawDeviceId);
    if (!deviceId) return;

    if (!isValidCoord(lat, lng)) return;

    const time = typeof timestamp === "number" && isValidTimestamp(timestamp) ? timestamp : Date.now();
    if (!isValidTimestamp(time)) return;

    const newPoint: GpsTrackingPoint = {
      lat,
      lng,
      timestamp: time,
      speed: typeof speed === "number" && !isNaN(speed) ? speed : 0,
    };

    const existing = this.states.get(deviceId);

    if (!existing) {
      // First point for this device — record reference point, no distance or time yet
      this.states.set(deviceId, {
        lastPoint: newPoint,
        totalDistanceKm: 0,
        totalDrivingTimeSec: 0,
        segmentCount: 0,
        averageSpeed: null,
      });
      return;
    }

    const prev = existing.lastPoint;

    // Skip duplicate or out-of-order timestamps
    if (newPoint.timestamp <= prev.timestamp) return;

    // If coordinates have not changed, update timestamp and speed without accumulating distance/time
    if (newPoint.lat === prev.lat && newPoint.lng === prev.lng) {
      existing.lastPoint = newPoint;
      return;
    }

    const segmentDistKm = haversineDistanceKm(prev.lat, prev.lng, newPoint.lat, newPoint.lng);
    const segmentTimeSec = (newPoint.timestamp - prev.timestamp) / 1000;

    // 1. Reject impossible GPS jumps (>200 km single segment)
    if (segmentDistKm > MAX_SEGMENT_DISTANCE_KM) {
      existing.lastPoint = newPoint;
      return;
    }

    // 2. Reject signal gaps > 10 minutes (600 seconds)
    if (segmentTimeSec > MAX_GAP_SECONDS) {
      existing.lastPoint = newPoint;
      return;
    }

    // 3. Reject unrealistic implied speed (>150 km/h) to filter GPS multipath jumps
    const impliedSpeedKmH = segmentTimeSec > 0 ? (segmentDistKm / segmentTimeSec) * 3600 : 0;
    if (impliedSpeedKmH > MAX_REALISTIC_SPEED_KMH) {
      existing.lastPoint = newPoint;
      return;
    }

    // 4. Movement filter: only accumulate if vehicle was actually moving
    const isMoving =
      prev.speed >= MOVING_SPEED_THRESHOLD || newPoint.speed >= MOVING_SPEED_THRESHOLD;

    if (isMoving && segmentDistKm > 0.001) {
      // 1 meter minimum threshold to filter GPS stationary jitter
      existing.totalDistanceKm += segmentDistKm;
      existing.totalDrivingTimeSec += segmentTimeSec;
      existing.segmentCount += 1;
    }

    // Update last point reference
    existing.lastPoint = newPoint;

    // 5. Calculate Average Speed = totalDistanceKm / (totalDrivingTimeSec / 3600)
    if (existing.totalDrivingTimeSec >= MIN_DRIVING_TIME_SEC_FOR_AVG) {
      const totalHours = existing.totalDrivingTimeSec / 3600;
      const avgSpeed = existing.totalDistanceKm / totalHours;
      existing.averageSpeed = Math.round(avgSpeed * 10) / 10; // 1 decimal place
    }
  }

  /**
   * Get the current calculated average speed for a device.
   * @returns Average speed in km/h, or null if insufficient driving data
   */
  public getAverageSpeed(rawDeviceId: string): number | null {
    const deviceId = normalizeDevId(rawDeviceId);
    if (!deviceId) return null;
    const state = this.states.get(deviceId);
    return state?.averageSpeed ?? null;
  }

  /**
   * Get full tracking statistics for a device.
   */
  public getTrackingStats(rawDeviceId: string): {
    distanceKm: number;
    drivingTimeSec: number;
    segmentCount: number;
    avgSpeed: number | null;
  } | null {
    const deviceId = normalizeDevId(rawDeviceId);
    if (!deviceId) return null;
    const state = this.states.get(deviceId);
    if (!state) return null;
    return {
      distanceKm: Math.round(state.totalDistanceKm * 1000) / 1000,
      drivingTimeSec: Math.round(state.totalDrivingTimeSec * 10) / 10,
      segmentCount: state.segmentCount,
      avgSpeed: state.averageSpeed,
    };
  }

  /**
   * Reset tracking state for a specific device, or all devices if omitted.
   */
  public reset(rawDeviceId?: string): void {
    if (rawDeviceId) {
      this.states.delete(normalizeDevId(rawDeviceId));
    } else {
      this.states.clear();
    }
  }
}

// ── React Hook ───────────────────────────────────────────────────────────────

/**
 * Hook providing an incremental average-speed calculator for all tracked vehicles.
 *
 * All state is held in a mutable ref (not React state) to avoid re-render
 * cascades on every telemetry tick. The parent hook reads the ref's current
 * value during its own render cycle.
 */
export function useAverageSpeed() {
  const trackerRef = useRef<GpsAverageSpeedTracker>(new GpsAverageSpeedTracker());

  const updateGpsPoint = useCallback(
    (
      rawDeviceId: string,
      lat: number,
      lng: number,
      speed: number,
      timestamp?: number,
    ): void => {
      trackerRef.current.updateGpsPoint(rawDeviceId, lat, lng, speed, timestamp);
    },
    [],
  );

  const getAverageSpeed = useCallback((rawDeviceId: string): number | null => {
    return trackerRef.current.getAverageSpeed(rawDeviceId);
  }, []);

  const getTrackingStats = useCallback(
    (rawDeviceId: string) => {
      return trackerRef.current.getTrackingStats(rawDeviceId);
    },
    [],
  );

  const resetSpeedTracker = useCallback((rawDeviceId?: string) => {
    trackerRef.current.reset(rawDeviceId);
  }, []);

  return { updateGpsPoint, getAverageSpeed, getTrackingStats, resetSpeedTracker };
}
