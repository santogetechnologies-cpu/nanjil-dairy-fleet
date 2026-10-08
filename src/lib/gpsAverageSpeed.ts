/**
 * gpsAverageSpeed.ts
 *
 * Centralized, authoritative GPS Average Speed calculation engine for the
 * Nanjil Dairy Fleet Intelligence Platform.
 *
 * Mathematical Core Formula:
 *   Average Speed = Total Distance Travelled (km) / Total Driving Time (hours)
 *   NOT: Average of instantaneous speed readings
 *
 * Rules & Constraints:
 * 1. Strict Geodesic Distance via Haversine (Earth radius = 6371 km).
 * 2. True Telemetry Timestamps (recorded_at > timestamp > server commit time).
 * 3. Idle / Stationary Exclusion (speed < 1 km/h or < 1m movement does not accrue driving time).
 * 4. Signal Gap Protection (> 10 minutes interval not counted as driving time).
 * 5. Outlier Rejection (> 200 km jump or implied speed > 150 km/h rejected).
 * 6. Zero Hardcoded Fallbacks (no fake 42 km/h; returns null when insufficient data).
 * 7. Vehicle-Level Isolation (independent state per vehicle/device).
 * 8. Zero Fabrication: Insufficient data yields null -> displayed as "—".
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Earth mean radius in kilometers */
export const EARTH_RADIUS_KM = 6371;

/** Minimum speed (km/h) to consider the vehicle moving */
export const MOVING_SPEED_THRESHOLD_KMH = 1;

/** Maximum realistic segment distance in km (filters GPS teleport jumps) */
export const MAX_SEGMENT_DISTANCE_KM = 200;

/** Maximum realistic implied speed (km/h) between consecutive updates */
export const MAX_REALISTIC_SPEED_KMH = 150;

/** Maximum telemetry signal gap (seconds) before segment time is excluded (10 minutes) */
export const MAX_GAP_SECONDS = 600;

/** Minimum driving time in seconds required before calculating average speed */
export const MIN_DRIVING_TIME_SEC_FOR_AVG = 5;

/** Minimum segment distance in km (1 meter) to filter GPS stationary jitter */
export const MIN_SEGMENT_DISTANCE_KM = 0.001;

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface GpsPointInput {
  lat: number;
  lng: number;
  speed?: number | string | null;
  timestamp?: number | string | Date | null;
  recorded_at?: string | null;
  last_update?: string | null;
}

export interface ValidatedGpsPoint {
  lat: number;
  lng: number;
  speed: number;
  timestamp: number; // Unix epoch ms
}

export interface AverageSpeedResult {
  averageSpeed: number | null; // km/h rounded to 1 decimal place, or null
  totalDistanceKm: number;
  totalDrivingTimeSec: number;
  segmentCount: number;
  hasSufficientData: boolean;
}

export interface DeviceTrackingState {
  lastPoint: ValidatedGpsPoint;
  totalDistanceKm: number;
  totalDrivingTimeSec: number;
  segmentCount: number;
  averageSpeed: number | null;
  history: ValidatedGpsPoint[]; // Rolling buffer of recent points (up to 500)
}

// ── Core Geodesic & Validation Helpers ───────────────────────────────────────

/**
 * Calculates great-circle distance between two GPS coordinates using Haversine formula.
 * @returns Distance in kilometers
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

/**
 * Validates coordinate pair. Rejects zeros, NaNs, and out-of-range coordinates.
 */
export function isValidCoord(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (isNaN(lat) || isNaN(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Validates epoch timestamp.
 */
export function isValidTimestamp(ts: unknown): boolean {
  return typeof ts === "number" && !isNaN(ts) && isFinite(ts) && ts > 0;
}

/**
 * Parses any timestamp representation (number, ISO string, Date, Firestore Timestamp) to epoch ms.
 */
export function parseTimestampToEpochMs(val: unknown): number | null {
  if (val == null) return null;
  if (typeof val === "number" && isFinite(val) && val > 0) {
    // If given in seconds instead of ms (e.g. 10 digits Unix timestamp)
    return val < 10000000000 ? val * 1000 : val;
  }
  if (val instanceof Date) {
    const ms = val.getTime();
    return isNaN(ms) ? null : ms;
  }
  if (typeof val === "string") {
    const parsed = Date.parse(val);
    if (!isNaN(parsed)) return parsed;
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) return num < 10000000000 ? num * 1000 : num;
    return null;
  }
  // Firestore Timestamp object { seconds, nanoseconds, toMillis() }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (typeof (obj as any).toMillis === "function") {
      return (obj as any).toMillis();
    }
    if (typeof (obj as any).toDate === "function") {
      const d = (obj as any).toDate();
      return d instanceof Date ? d.getTime() : null;
    }
    if (typeof obj.seconds === "number") {
      const nanos = typeof obj.nanoseconds === "number" ? obj.nanoseconds : 0;
      return obj.seconds * 1000 + Math.floor(nanos / 1000000);
    }
    if (typeof obj._seconds === "number") {
      const nanos = typeof obj._nanoseconds === "number" ? obj._nanoseconds : 0;
      return obj._seconds * 1000 + Math.floor(nanos / 1000000);
    }
  }
  return null;
}

/**
 * Normalizes device or vehicle lookup key.
 * Trims whitespace and lowercases string.
 */
export function normalizeDeviceKey(val: unknown): string {
  if (val == null) return "";
  return String(val).trim().toLowerCase();
}

/**
 * Extracts true telemetry timestamp from any telemetry payload.
 *
 * Preferred Order:
 * 1. data.recorded_at
 * 2. data.timestamp
 * 3. data.last_update / data.lastUpdate / data.time / data.updated_at
 * 4. Firestore snapshot server commit timestamp (docSnap._document.version.timestamp)
 * 5. docSnap.updateTime
 */
export function extractTelemetryTimestamp(data: any, docSnap?: any): number | null {
  if (!data && !docSnap) return null;

  // 1. recorded_at (highest priority — standard Supabase/EMQX timestamp)
  if (data?.recorded_at != null) {
    const ts = parseTimestampToEpochMs(data.recorded_at);
    if (ts) return ts;
  }

  // 2. timestamp
  if (data?.timestamp != null) {
    const ts = parseTimestampToEpochMs(data.timestamp);
    if (ts) return ts;
  }

  // 3. last_update / lastUpdate / time / updated_at
  const candidate =
    data?.last_update ??
    data?.lastUpdate ??
    data?.time ??
    data?.updated_at ??
    data?.created_at;
  if (candidate != null) {
    const ts = parseTimestampToEpochMs(candidate);
    if (ts) return ts;
  }

  // 4. Firestore Snapshot Server Version Timestamp
  const docVerTs = docSnap?._document?.version?.timestamp;
  if (docVerTs) {
    const ts = parseTimestampToEpochMs(docVerTs);
    if (ts) return ts;
  }

  // 5. Firestore updateTime
  if (docSnap?.updateTime) {
    const ts = parseTimestampToEpochMs(docSnap.updateTime);
    if (ts) return ts;
  }

  return null;
}

// ── Pure Batch Calculation (for Historical & Filtered Telemetry) ─────────────

/**
 * Calculates Average Speed mathematically from an array of GPS points.
 *
 * Formula:
 *   Average Speed = Total Distance (km) / Total Driving Time (hours)
 *
 * Excludes stationary/idle periods, excludes gaps > 10 min, rejects GPS jumps,
 * rejects duplicate or out-of-order timestamps.
 */
export function calculateAverageSpeedFromPoints(
  rawPoints: GpsPointInput[],
  options?: {
    minTimestampMs?: number;
    maxTimestampMs?: number;
  },
): AverageSpeedResult {
  if (!Array.isArray(rawPoints) || rawPoints.length < 2) {
    return {
      averageSpeed: null,
      totalDistanceKm: 0,
      totalDrivingTimeSec: 0,
      segmentCount: 0,
      hasSufficientData: false,
    };
  }

  // 1. Sanitize and validate points
  const validPoints: ValidatedGpsPoint[] = [];

  for (const pt of rawPoints) {
    const lat = typeof pt.lat === "number" ? pt.lat : parseFloat(String(pt.lat ?? 0));
    const lng = typeof pt.lng === "number" ? pt.lng : parseFloat(String(pt.lng ?? 0));
    if (!isValidCoord(lat, lng)) continue;

    const rawTs = pt.timestamp ?? pt.recorded_at ?? pt.last_update;
    const ts = parseTimestampToEpochMs(rawTs);
    if (ts == null || !isValidTimestamp(ts)) continue;

    // Optional range boundaries
    if (options?.minTimestampMs != null && ts < options.minTimestampMs) continue;
    if (options?.maxTimestampMs != null && ts > options.maxTimestampMs) continue;

    const rawSpeed = pt.speed;
    const speed =
      typeof rawSpeed === "number" && !isNaN(rawSpeed)
        ? rawSpeed
        : typeof rawSpeed === "string"
          ? parseFloat(rawSpeed) || 0
          : 0;

    validPoints.push({ lat, lng, speed, timestamp: ts });
  }

  if (validPoints.length < 2) {
    return {
      averageSpeed: null,
      totalDistanceKm: 0,
      totalDrivingTimeSec: 0,
      segmentCount: 0,
      hasSufficientData: false,
    };
  }

  // 2. Sort chronologically ascending
  validPoints.sort((a, b) => a.timestamp - b.timestamp);

  let totalDistanceKm = 0;
  let totalDrivingTimeSec = 0;
  let segmentCount = 0;

  let prev = validPoints[0];

  for (let i = 1; i < validPoints.length; i++) {
    const curr = validPoints[i];

    const segmentTimeSec = (curr.timestamp - prev.timestamp) / 1000;

    // Duplicate or out-of-order timestamp: skip
    if (segmentTimeSec <= 0) continue;

    // Identical coordinates: stationary, update prev reference without distance
    if (curr.lat === prev.lat && curr.lng === prev.lng) {
      prev = curr;
      continue;
    }

    const segmentDistKm = haversineDistanceKm(prev.lat, prev.lng, curr.lat, curr.lng);

    // Filter 1: Reject impossible GPS jump (>200 km single segment)
    if (segmentDistKm > MAX_SEGMENT_DISTANCE_KM) {
      prev = curr;
      continue;
    }

    // Filter 2: Signal gap > 10 minutes (600 seconds) — exclude from driving time
    if (segmentTimeSec > MAX_GAP_SECONDS) {
      prev = curr;
      continue;
    }

    // Filter 3: Unrealistic implied speed (>150 km/h) — rejects multipath jumps
    const impliedSpeedKmH = segmentTimeSec > 0 ? (segmentDistKm / segmentTimeSec) * 3600 : 0;
    if (impliedSpeedKmH > MAX_REALISTIC_SPEED_KMH) {
      prev = curr;
      continue;
    }

    // Filter 4: Movement check — vehicle must be moving
    const isMoving =
      prev.speed >= MOVING_SPEED_THRESHOLD_KMH || curr.speed >= MOVING_SPEED_THRESHOLD_KMH;

    if (isMoving && segmentDistKm >= MIN_SEGMENT_DISTANCE_KM) {
      totalDistanceKm += segmentDistKm;
      totalDrivingTimeSec += segmentTimeSec;
      segmentCount += 1;
    }

    prev = curr;
  }

  // 3. Calculate Average Speed = totalDistanceKm / (totalDrivingTimeSec / 3600)
  if (totalDrivingTimeSec >= MIN_DRIVING_TIME_SEC_FOR_AVG && totalDistanceKm > 0) {
    const totalHours = totalDrivingTimeSec / 3600;
    const avgSpeed = totalDistanceKm / totalHours;
    return {
      averageSpeed: Math.round(avgSpeed * 10) / 10,
      totalDistanceKm: Math.round(totalDistanceKm * 1000) / 1000,
      totalDrivingTimeSec: Math.round(totalDrivingTimeSec * 10) / 10,
      segmentCount,
      hasSufficientData: true,
    };
  }

  return {
    averageSpeed: null,
    totalDistanceKm: Math.round(totalDistanceKm * 1000) / 1000,
    totalDrivingTimeSec: Math.round(totalDrivingTimeSec * 10) / 10,
    segmentCount,
    hasSufficientData: false,
  };
}

// ── GPS Average Speed Tracker Engine ──────────────────────────────────────────

/**
 * Stateful, incremental GPS Average Speed Tracker.
 * Maintains independent state per vehicle/device.
 *
 * Supports alias resolution (mapping vehicle_id UUID <-> device_id),
 * rolling history caching, and query filtering by timestamp.
 */
export class GpsAverageSpeedTracker {
  private states = new Map<string, DeviceTrackingState>();
  private aliases = new Map<string, string>(); // aliasKey -> canonicalKey

  /**
   * Resolve a key to its canonical tracking state key.
   */
  private resolveKey(rawKey: string): string {
    const normalized = normalizeDeviceKey(rawKey);
    if (!normalized) return "";
    return this.aliases.get(normalized) || normalized;
  }

  /**
   * Register an alias so querying by either ID resolves to the same tracking state.
   * e.g. registerAlias(vehicle.id, vehicle.deviceId)
   */
  public registerAlias(aliasKey: string, canonicalKey: string): void {
    const normAlias = normalizeDeviceKey(aliasKey);
    const normCanon = normalizeDeviceKey(canonicalKey);
    if (!normAlias || !normCanon || normAlias === normCanon) return;

    this.aliases.set(normAlias, normCanon);

    // If an existing state was recorded under the alias, merge it into canonical
    const aliasState = this.states.get(normAlias);
    const canonState = this.states.get(normCanon);

    if (aliasState && !canonState) {
      this.states.set(normCanon, aliasState);
      this.states.delete(normAlias);
    }
  }

  /**
   * Record a new GPS telemetry point for a vehicle/device.
   * Incrementally updates total distance and driving time.
   */
  public updateGpsPoint(
    rawKey: string,
    lat: number,
    lng: number,
    speed: number,
    timestamp?: number | null,
  ): void {
    const key = this.resolveKey(rawKey);
    if (!key) return;

    if (!isValidCoord(lat, lng)) return;

    // Use supplied timestamp; do NOT fallback to Date.now() unless genuinely live
    const time = isValidTimestamp(timestamp) ? Number(timestamp) : Date.now();
    if (!isValidTimestamp(time)) return;

    const validatedPoint: ValidatedGpsPoint = {
      lat,
      lng,
      timestamp: time,
      speed: typeof speed === "number" && !isNaN(speed) ? speed : 0,
    };

    const existing = this.states.get(key);

    if (!existing) {
      // First point for this device: record as initial reference
      this.states.set(key, {
        lastPoint: validatedPoint,
        totalDistanceKm: 0,
        totalDrivingTimeSec: 0,
        segmentCount: 0,
        averageSpeed: null,
        history: [validatedPoint],
      });
      return;
    }

    const prev = existing.lastPoint;

    // Skip duplicate or out-of-order timestamps
    if (validatedPoint.timestamp <= prev.timestamp) return;

    // Append to rolling history (cap at 500)
    existing.history.push(validatedPoint);
    if (existing.history.length > 500) {
      existing.history.shift();
    }

    // Coordinates unchanged: update reference point without accumulating distance/time
    if (validatedPoint.lat === prev.lat && validatedPoint.lng === prev.lng) {
      existing.lastPoint = validatedPoint;
      return;
    }

    const segmentDistKm = haversineDistanceKm(
      prev.lat,
      prev.lng,
      validatedPoint.lat,
      validatedPoint.lng,
    );
    const segmentTimeSec = (validatedPoint.timestamp - prev.timestamp) / 1000;

    // 1. Reject impossible GPS jumps (>200 km)
    if (segmentDistKm > MAX_SEGMENT_DISTANCE_KM) {
      existing.lastPoint = validatedPoint;
      return;
    }

    // 2. Reject signal gaps > 10 minutes (600 seconds)
    if (segmentTimeSec > MAX_GAP_SECONDS) {
      existing.lastPoint = validatedPoint;
      return;
    }

    // 3. Reject unrealistic implied speed (>150 km/h)
    const impliedSpeedKmH = segmentTimeSec > 0 ? (segmentDistKm / segmentTimeSec) * 3600 : 0;
    if (impliedSpeedKmH > MAX_REALISTIC_SPEED_KMH) {
      existing.lastPoint = validatedPoint;
      return;
    }

    // 4. Movement filter: vehicle must be moving
    const isMoving =
      prev.speed >= MOVING_SPEED_THRESHOLD_KMH ||
      validatedPoint.speed >= MOVING_SPEED_THRESHOLD_KMH;

    if (isMoving && segmentDistKm >= MIN_SEGMENT_DISTANCE_KM) {
      existing.totalDistanceKm += segmentDistKm;
      existing.totalDrivingTimeSec += segmentTimeSec;
      existing.segmentCount += 1;
    }

    // Update reference point
    existing.lastPoint = validatedPoint;

    // 5. Calculate Average Speed = totalDistanceKm / (totalDrivingTimeSec / 3600)
    if (existing.totalDrivingTimeSec >= MIN_DRIVING_TIME_SEC_FOR_AVG && existing.totalDistanceKm > 0) {
      const totalHours = existing.totalDrivingTimeSec / 3600;
      const avgSpeed = existing.totalDistanceKm / totalHours;
      existing.averageSpeed = Math.round(avgSpeed * 10) / 10;
    }
  }

  /**
   * Get the current calculated average speed for a vehicle/device.
   *
   * @param rawKey Vehicle ID or Device ID
   * @param sinceTimestamp Optional boundary to only calculate speed for points after timestamp
   * @returns Average speed in km/h rounded to 1 decimal place, or null if insufficient data
   */
  public getAverageSpeed(rawKey: string, sinceTimestamp?: number): number | null {
    const key = this.resolveKey(rawKey);
    if (!key) return null;

    const state = this.states.get(key);
    if (!state) return null;

    if (sinceTimestamp != null && isValidTimestamp(sinceTimestamp)) {
      // Re-calculate strictly for points within the requested time boundary
      const filtered = state.history.filter((p) => p.timestamp >= sinceTimestamp);
      return calculateAverageSpeedFromPoints(filtered).averageSpeed;
    }

    return state.averageSpeed;
  }

  /**
   * Get full tracking statistics for a vehicle/device.
   */
  public getTrackingStats(
    rawKey: string,
    sinceTimestamp?: number,
  ): {
    distanceKm: number;
    drivingTimeSec: number;
    segmentCount: number;
    avgSpeed: number | null;
  } | null {
    const key = this.resolveKey(rawKey);
    if (!key) return null;

    const state = this.states.get(key);
    if (!state) return null;

    if (sinceTimestamp != null && isValidTimestamp(sinceTimestamp)) {
      const filtered = state.history.filter((p) => p.timestamp >= sinceTimestamp);
      const res = calculateAverageSpeedFromPoints(filtered);
      return {
        distanceKm: res.totalDistanceKm,
        drivingTimeSec: res.totalDrivingTimeSec,
        segmentCount: res.segmentCount,
        avgSpeed: res.averageSpeed,
      };
    }

    return {
      distanceKm: Math.round(state.totalDistanceKm * 1000) / 1000,
      drivingTimeSec: Math.round(state.totalDrivingTimeSec * 10) / 10,
      segmentCount: state.segmentCount,
      avgSpeed: state.averageSpeed,
    };
  }

  /**
   * Batch load historical points into a vehicle's tracker state.
   */
  public loadPoints(rawKey: string, points: GpsPointInput[]): void {
    const key = this.resolveKey(rawKey);
    if (!key || !Array.isArray(points)) return;

    this.reset(key);
    for (const pt of points) {
      const lat = typeof pt.lat === "number" ? pt.lat : parseFloat(String(pt.lat ?? 0));
      const lng = typeof pt.lng === "number" ? pt.lng : parseFloat(String(pt.lng ?? 0));
      const speed = typeof pt.speed === "number" ? pt.speed : parseFloat(String(pt.speed ?? 0));
      const ts = parseTimestampToEpochMs(pt.timestamp ?? pt.recorded_at ?? pt.last_update);
      this.updateGpsPoint(key, lat, lng, speed, ts);
    }
  }

  /**
   * Reset tracking state for a specific device, or all devices if omitted.
   */
  public reset(rawKey?: string): void {
    if (rawKey) {
      const key = this.resolveKey(rawKey);
      this.states.delete(key);
    } else {
      this.states.clear();
      this.aliases.clear();
    }
  }
}

// ── Shared Singleton Tracker (One Source of Truth) ───────────────────────────

/**
 * Global singleton instance of GpsAverageSpeedTracker.
 * Guarantees that all tracking hooks, pages, and components access
 * the exact same tracking state across the application.
 */
export const globalGpsSpeedTracker = new GpsAverageSpeedTracker();

// ── Display Formatting Helper ────────────────────────────────────────────────

/**
 * Formats average speed cleanly for UI display.
 * Returns "—" if speed is null, undefined, or zero.
 */
export function formatAverageSpeed(speed: number | null | undefined): string {
  if (speed == null || isNaN(speed) || speed <= 0) {
    return "—";
  }
  return `${speed.toFixed(1)} km/h`;
}
