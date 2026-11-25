/**
 * dailyActivityReport.ts — Daily Vehicle Activity & IST Date-Wise Filtering Engine
 *
 * Computes authentic per-vehicle daily telemetry summaries (distance, trips,
 * driving/stopped duration, speed, odometer, location, driver, and live status)
 * using strict Asia/Kolkata (IST, UTC+05:30) date boundaries.
 */

import {
  type GpsPoint,
  getIstDateRange,
  calculateJourneyMetrics,
  deriveJourneysFromTelemetry,
  resolveDriverForJourney,
  formatIstDateTime,
} from "./tripHistoryEngine.ts";
import { KNOWN_NANJIL_DEVICE_MAP } from "./vehicle-stop-detection.ts";
import { getImmediateLocationDisplay } from "./reverseGeocoding.ts";

export type ReportDateMode = "all" | "today" | "yesterday" | "week" | "month" | "custom";

export interface ReportDateBounds {
  mode: ReportDateMode;
  isAllTime: boolean;
  startUtcIso: string | null;
  endUtcIso: string | null;
  startMs: number | null;
  endMs: number | null;
  startIstDate: string;
  endIstDate: string;
  daySpan: number;
  displayLabel: string;
}

export interface DailyActivityVehicleMeta {
  id: string;
  number: string;
  device_id?: string | null;
  type?: string | null;
  model?: string | null;
  odometer?: number | null;
  status?: string | null;
  location?: string | null;
  lat?: number | null;
  lng?: number | null;
  last_update?: string | null;
  driver_name?: string | null;
  driver_id?: string | null;
}

export interface DailyActivityMetricsRow {
  vehicleId: string;
  vehicle: string;
  driver: string;
  model: string;
  category: string;
  distanceKmNum: number;
  distanceKm: string;
  tripsCount: number;
  drivingSeconds: number;
  drivingTime: string;
  stoppedSeconds: number;
  stoppedTime: string;
  stopsCount: number;
  maxSpeedKmh: number;
  avgSpeedKmh: number;
  speedSummary: string;
  odometerNum: number | null;
  odometerKm: string;
  status: string;
  location: string;
  coordLat: number | null;
  coordLng: number | null;
  lastReportedMs: number;
  lastReported: string;
  hasMovement: boolean;
  hasTelemetry: boolean;
}

export interface DailyActivitySummary {
  totalVehicles: number;
  activeVehicles: number;
  idleVehicles: number;
  totalDistanceKm: number;
  totalTrips: number;
  totalStopsCount: number;
  totalDrivingSeconds: number;
  totalStoppedSeconds: number;
  fleetMaxSpeedKmh: number;
  fleetAvgSpeedKmh: number;
}

/**
 * Formats a duration in seconds as compact "Xh Ym" or "Ym".
 */
export function formatDurationCompact(totalSeconds: number): string {
  const safeSec = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const totalMins = Math.round(safeSec / 60);
  if (totalMins < 60) {
    return `${totalMins}m`;
  }
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Resolves a human-readable vehicle model, replacing placeholder strings like
 * "Unknown Model" with authoritative Nanjil hardware registry metadata.
 */
export function resolveFleetVehicleModel(
  dbModel?: string | null,
  dbType?: string | null,
  deviceId?: string | null,
  vehicleId?: string | null
): string {
  const cleanDb = (dbModel || "").trim();
  if (cleanDb && cleanDb.toLowerCase() !== "unknown model" && cleanDb.toLowerCase() !== "unknown") {
    return cleanDb;
  }

  const cleanDev = (deviceId || "").trim();
  if (cleanDev && KNOWN_NANJIL_DEVICE_MAP[cleanDev]?.model) {
    return KNOWN_NANJIL_DEVICE_MAP[cleanDev].model;
  }

  if (vehicleId) {
    for (const meta of Object.values(KNOWN_NANJIL_DEVICE_MAP)) {
      if (meta.id === vehicleId && meta.model) {
        return meta.model;
      }
    }
  }

  return (dbType || "").trim() || "Tanker 10KL";
}

/**
 * Computes exact Asia/Kolkata (IST) calendar boundaries for Fleet Reports filters.
 * Both start and end boundaries are returned so ranges like "yesterday" strictly
 * exclude today's records.
 */
export function resolveReportDateBounds(
  mode: ReportDateMode,
  customStart?: string,
  customEnd?: string,
  refDate = new Date()
): ReportDateBounds {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayIstStr = formatter.format(refDate);

  if (mode === "all") {
    return {
      mode: "all",
      isAllTime: true,
      startUtcIso: null,
      endUtcIso: null,
      startMs: null,
      endMs: null,
      startIstDate: "",
      endIstDate: todayIstStr,
      daySpan: 9999,
      displayLabel: "All Time",
    };
  }

  const mappedMode =
    mode === "week" ? "last7" : mode === "month" ? "last30" : mode;

  // Normalize custom bounds: ensure start <= end
  let effStart = customStart || todayIstStr;
  let effEnd = customEnd || effStart;
  if (mappedMode === "custom" && effStart > effEnd) {
    const tmp = effStart;
    effStart = effEnd;
    effEnd = tmp;
  }

  const ist = getIstDateRange(mappedMode, effStart, effEnd, refDate);
  const startMs = new Date(ist.startUtcIso).getTime();
  const endMs = new Date(ist.endUtcIso).getTime();

  const startDayMs = new Date(`${ist.startIstDate}T00:00:00Z`).getTime();
  const endDayMs = new Date(`${ist.endIstDate}T00:00:00Z`).getTime();
  const daySpan = Math.max(1, Math.round((endDayMs - startDayMs) / 86400000) + 1);

  const label =
    mappedMode === "custom" && ist.startIstDate === ist.endIstDate
      ? `Date: ${ist.startIstDate}`
      : ist.displayLabel;

  return {
    mode,
    isAllTime: false,
    startUtcIso: ist.startUtcIso,
    endUtcIso: ist.endUtcIso,
    startMs,
    endMs,
    startIstDate: ist.startIstDate,
    endIstDate: ist.endIstDate,
    daySpan,
    displayLabel: label,
  };
}

/**
 * Filters any array of records using strict inclusive [startMs, endMs] IST bounds.
 */
export function filterRecordsByIstRange<T>(
  records: T[],
  getTimestamp: (item: T) => string | number | Date | null | undefined,
  bounds: ReportDateBounds
): T[] {
  if (!records || records.length === 0) return [];
  if (bounds.isAllTime || bounds.startMs == null || bounds.endMs == null) {
    return records;
  }

  return records.filter((item) => {
    const raw = getTimestamp(item);
    if (raw == null) return false;
    const ms =
      raw instanceof Date
        ? raw.getTime()
        : typeof raw === "number"
        ? raw
        : new Date(raw).getTime();
    if (!Number.isFinite(ms)) return false;
    return ms >= bounds.startMs! && ms <= bounds.endMs!;
  });
}

function isValidCoordPair(lat: unknown, lng: unknown): boolean {
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return false;
  if (Math.abs(nLat) < 0.001 && Math.abs(nLng) < 0.001) return false;
  return nLat >= -90 && nLat <= 90 && nLng >= -180 && nLng <= 180;
}

/**
 * Builds an authentic Daily Vehicle Activity row from telemetry points +
 * live vehicle state + DB vehicle/driver assignments.
 */
export function buildDailyActivityRow(params: {
  vehicle: DailyActivityVehicleMeta;
  liveVehicle?: {
    status?: string;
    odometer?: number;
    location?: string;
    lat?: number;
    lng?: number;
    lastUpdate?: string;
    driver?: string;
    driverId?: string | null;
    speed?: number;
  } | null;
  points: GpsPoint[];
  assignments: any[];
  drivers: any[];
  bounds: ReportDateBounds;
  telemetryComputed: boolean;
}): DailyActivityMetricsRow {
  const { vehicle, liveVehicle, points, assignments, drivers, bounds, telemetryComputed } = params;

  const model = resolveFleetVehicleModel(vehicle.model, vehicle.type, vehicle.device_id, vehicle.id);
  const category = (vehicle.type || "").trim() || "Tanker 10KL";

  const metrics = telemetryComputed && points.length > 0 ? calculateJourneyMetrics(points) : null;
  const journeys =
    telemetryComputed && points.length > 0
      ? deriveJourneysFromTelemetry(points, { id: vehicle.id, number: vehicle.number, model }, [], assignments, drivers)
      : [];

  // Count genuine moving journeys (exclude stationary yard snapshots)
  const movingJourneys = journeys.filter(
    (j) =>
      j.status !== "Stationary" &&
      (j.metrics.totalDistanceKm >= 0.2 || j.metrics.drivingDurationSeconds >= 60)
  );
  const tripsCount = movingJourneys.length;

  const distanceKmNum = metrics ? metrics.totalDistanceKm : 0;
  const drivingSeconds = metrics ? Math.round(metrics.drivingDurationSeconds) : 0;
  const stoppedSeconds = metrics ? Math.round(metrics.stoppedDurationSeconds) : 0;
  const stopsCount = metrics ? metrics.stopsCount : 0;
  const maxSpeedKmh = metrics ? metrics.maxSpeedKmh : 0;
  const avgSpeedKmh = metrics ? metrics.avgSpeedKmh : 0;

  // Resolve Driver: journey assignment -> live driver -> active assignment -> DB fallback
  const driverFallback = {
    driver_id: liveVehicle?.driverId || vehicle.driver_id || null,
    driver_name: liveVehicle?.driver || vehicle.driver_name || null,
  };
  const refStartIso = points[0]?.recorded_at || bounds.startUtcIso || new Date().toISOString();
  const refEndIso = points[points.length - 1]?.recorded_at || bounds.endUtcIso || new Date().toISOString();
  const driverResolved = resolveDriverForJourney(
    vehicle.id,
    refStartIso,
    refEndIso,
    assignments,
    drivers,
    driverFallback
  );
  const driver =
    driverResolved.driverName && driverResolved.driverName !== "Unassigned Driver"
      ? driverResolved.driverName
      : liveVehicle?.driver || vehicle.driver_name || "Unassigned";

  // Odometer: prefer non-zero telemetry endOdometer, then liveVehicle, then DB vehicle
  const odoCandidates = [
    metrics?.endOdometer,
    liveVehicle?.odometer,
    vehicle.odometer,
  ].filter((val): val is number => typeof val === "number" && Number.isFinite(val) && val > 0);
  const odometerNum = odoCandidates.length > 0 ? odoCandidates[0] : null;
  const odometerKm = odometerNum != null ? `${Math.round(odometerNum).toLocaleString()} km` : "-";

  // Location & Last Reported
  const lastPt = points.length > 0 ? points[points.length - 1] : null;
  const isCurrentScope = bounds.isAllTime || bounds.mode === "today";

  let coordLat: number | null = null;
  let coordLng: number | null = null;
  let location = "No telemetry in period";
  let lastReportedIso: string | null = null;

  if (lastPt) {
    coordLat = lastPt.lat;
    coordLng = lastPt.lng;
    // If today/all-time and live location is fresher or same spot with readable name, prefer readable
    const liveMatchesToday =
      isCurrentScope &&
      liveVehicle?.location &&
      isValidCoordPair(liveVehicle.lat, liveVehicle.lng);
    location = liveMatchesToday
      ? getImmediateLocationDisplay(liveVehicle?.location, liveVehicle?.lat ?? lastPt.lat, liveVehicle?.lng ?? lastPt.lng)
      : getImmediateLocationDisplay(null, lastPt.lat, lastPt.lng);
    lastReportedIso = lastPt.recorded_at;
  } else if (isCurrentScope) {
    const rawLat = liveVehicle?.lat ?? vehicle.lat;
    const rawLng = liveVehicle?.lng ?? vehicle.lng;
    const rawLoc = liveVehicle?.location ?? vehicle.location;
    if (isValidCoordPair(rawLat, rawLng)) {
      coordLat = Number(rawLat);
      coordLng = Number(rawLng);
    }
    location = getImmediateLocationDisplay(rawLoc, rawLat, rawLng);
    const liveMs = liveVehicle?.lastUpdate ? new Date(liveVehicle.lastUpdate).getTime() : 0;
    const dbMs = vehicle.last_update ? new Date(vehicle.last_update).getTime() : 0;
    lastReportedIso = liveMs >= dbMs && liveMs > 0 ? liveVehicle!.lastUpdate! : vehicle.last_update || null;
  }

  // Status: For Today/All Time, synchronize with live Firebase telemetry so it never contradicts top bar!
  let status = "No Telemetry";
  if (isCurrentScope && liveVehicle?.status) {
    status = liveVehicle.status;
  } else if (!telemetryComputed) {
    status = vehicle.status || "Idle";
  } else if (distanceKmNum >= 0.2 || tripsCount > 0) {
    status = tripsCount > 0 ? `Active (${tripsCount} ${tripsCount === 1 ? "trip" : "trips"})` : "Active";
  } else if (points.length > 0) {
    status = "Stationary";
  } else if (bounds.mode === "today") {
    status = liveVehicle?.status || vehicle.status || "Idle";
  }

  const lastReportedMs = lastReportedIso ? new Date(lastReportedIso).getTime() : 0;
  const lastReported = lastReportedIso ? formatIstDateTime(lastReportedIso) : "No signal in period";

  return {
    vehicleId: vehicle.id,
    vehicle: vehicle.number,
    driver,
    model,
    category,
    distanceKmNum,
    distanceKm: `${distanceKmNum.toFixed(1)} km`,
    tripsCount,
    drivingSeconds,
    drivingTime: formatDurationCompact(drivingSeconds),
    stoppedSeconds,
    stoppedTime: formatDurationCompact(stoppedSeconds),
    stopsCount,
    maxSpeedKmh,
    avgSpeedKmh,
    speedSummary: maxSpeedKmh > 0 ? `${avgSpeedKmh} / ${maxSpeedKmh} km/h` : "0 km/h",
    odometerNum,
    odometerKm,
    status,
    location,
    coordLat,
    coordLng,
    lastReportedMs: Number.isFinite(lastReportedMs) ? lastReportedMs : 0,
    lastReported,
    hasMovement: distanceKmNum >= 0.2 || tripsCount > 0,
    hasTelemetry: points.length > 0 || (isCurrentScope && Boolean(lastReportedIso)),
  };
}

/**
 * Aggregates per-vehicle Daily Activity rows into top-level dashboard KPIs.
 */
export function aggregateDailyActivitySummary(rows: DailyActivityMetricsRow[]): DailyActivitySummary {
  const totalVehicles = rows.length;
  let activeVehicles = 0;
  let totalDistanceKm = 0;
  let totalTrips = 0;
  let totalStopsCount = 0;
  let totalDrivingSeconds = 0;
  let totalStoppedSeconds = 0;
  let fleetMaxSpeedKmh = 0;

  for (const r of rows) {
    if (r.hasMovement || r.status === "Moving") {
      activeVehicles++;
    }
    totalDistanceKm += r.distanceKmNum;
    totalTrips += r.tripsCount;
    totalStopsCount += r.stopsCount;
    totalDrivingSeconds += r.drivingSeconds;
    totalStoppedSeconds += r.stoppedSeconds;
    if (r.maxSpeedKmh > fleetMaxSpeedKmh) {
      fleetMaxSpeedKmh = r.maxSpeedKmh;
    }
  }

  const roundedDist = Math.round(totalDistanceKm * 10) / 10;
  const drivingHours = totalDrivingSeconds / 3600;
  const fleetAvgSpeedKmh =
    drivingHours > 0 ? Math.round((roundedDist / drivingHours) * 10) / 10 : 0;

  return {
    totalVehicles,
    activeVehicles,
    idleVehicles: Math.max(0, totalVehicles - activeVehicles),
    totalDistanceKm: roundedDist,
    totalTrips,
    totalStopsCount,
    totalDrivingSeconds,
    totalStoppedSeconds,
    fleetMaxSpeedKmh,
    fleetAvgSpeedKmh,
  };
}
