/**
 * dailyActivityReport.ts — Daily Vehicle Activity & Fleet Reports Analytics Engine
 *
 * Computes authentic per-vehicle daily telemetry summaries (distance, trips,
 * driving / idling / parked durations, speed, odometer, location, driver,
 * journeys, and timeline events) using strict Asia/Kolkata (IST, UTC+05:30)
 * date boundaries, plus filtered report KPIs, chart data, sorting, and CSV export.
 */

import {
  type GpsPoint,
  type RouteSegment,
  type DerivedJourney,
  type TimelineEvent,
  getIstDateRange,
  calculateJourneyMetrics,
  deriveJourneysFromTelemetry,
  splitPointsIntoSegments,
  generateJourneyTimelineEvents,
  resolveDriverForJourney,
  formatIstDateTime,
  haversineDistanceKm,
  isTelemetryIntervalMoving,
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
  activityDate: string;
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
  idlingSeconds: number;
  idlingTime: string;
  parkedSeconds: number;
  parkedTime: string;
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
  startLocation: string;
  coordLat: number | null;
  coordLng: number | null;
  startLat: number | null;
  startLng: number | null;
  startTimeIso: string | null;
  endTimeIso: string | null;
  lastReportedMs: number;
  lastReported: string;
  hasMovement: boolean;
  hasTelemetry: boolean;
  points: GpsPoint[];
  segments: RouteSegment[];
  journeys: DerivedJourney[];
  timelineEvents: TimelineEvent[];
}

export interface DailyActivitySummary {
  totalVehicles: number;
  activeVehicles: number;
  idleVehicles: number;
  totalDays: number;
  activeDays: number;
  totalDistanceKm: number;
  totalTrips: number;
  totalStopsCount: number;
  totalDrivingSeconds: number;
  totalIdlingSeconds: number;
  totalParkedSeconds: number;
  totalStoppedSeconds: number;
  fleetMaxSpeedKmh: number;
  fleetAvgSpeedKmh: number;
}

export interface OtherReportSummary {
  kpis: Array<{ label: string; value: string; hint: string }>;
  chartTitle: string;
  chartData: Array<{ name: string; primary: number; secondary?: number; primaryLabel: string; secondaryLabel?: string }>;
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
 * Splits stationary telemetry intervals (not actively moving, excluding signal gaps > 15m)
 * into Idling (engine ON) vs Parked (engine OFF) seconds.
 *
 * When a vehicle's GPS tracker reports ignition OFF (`!ignition`) anywhere in the stream,
 * intervals are split directly by ignition state. When hardware hardwires `ignition = true`
 * continuously (>= 10 points with zero ignition-off readings), brief pauses (<= 5 min) count
 * as Idling and extended stops (> 5 min) count as Parked.
 */
export function computeIdleParkedBreakdown(
  points: GpsPoint[],
  maxGapMinutes = 15
): { idlingSeconds: number; parkedSeconds: number } {
  if (!points || points.length < 2) {
    return { idlingSeconds: 0, parkedSeconds: 0 };
  }

  const hasIgnitionOffTelemetry = points.some((p) => !p.ignition);
  const useDurationHeuristic = !hasIgnitionOffTelemetry && points.length >= 10;

  let idlingSeconds = 0;
  let parkedSeconds = 0;
  let currentBlockSec = 0;

  const flushBlock = () => {
    if (currentBlockSec <= 0) return;
    if (currentBlockSec <= 300) {
      idlingSeconds += currentBlockSec;
    } else {
      parkedSeconds += currentBlockSec;
    }
    currentBlockSec = 0;
  };

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const prevMs = new Date(prev.recorded_at).getTime();
    const currMs = new Date(curr.recorded_at).getTime();
    if (!Number.isFinite(prevMs) || !Number.isFinite(currMs) || currMs <= prevMs) continue;

    const dtSec = (currMs - prevMs) / 1000;
    if (dtSec > maxGapMinutes * 60) {
      if (useDurationHeuristic) flushBlock();
      continue;
    }

    const distKm = haversineDistanceKm(prev.lat, prev.lng, curr.lat, curr.lng);
    const isMoving = isTelemetryIntervalMoving(curr, distKm);

    if (!isMoving) {
      if (useDurationHeuristic) {
        currentBlockSec += dtSec;
      } else if (prev.ignition || curr.ignition) {
        idlingSeconds += dtSec;
      } else {
        parkedSeconds += dtSec;
      }
    } else if (useDurationHeuristic) {
      flushBlock();
    }
  }

  if (useDurationHeuristic) {
    flushBlock();
  }

  return {
    idlingSeconds: Math.round(idlingSeconds),
    parkedSeconds: Math.round(parkedSeconds),
  };
}

/**
 * Groups chronological GPS telemetry points by Asia/Kolkata (IST) calendar date (YYYY-MM-DD).
 */
export function groupPointsByIstDate(points: GpsPoint[]): Map<string, GpsPoint[]> {
  const byDate = new Map<string, GpsPoint[]>();
  if (!points || points.length === 0) return byDate;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  for (const pt of points) {
    const d = new Date(pt.recorded_at);
    if (!Number.isFinite(d.getTime())) continue;
    const istDate = formatter.format(d);
    const bucket = byDate.get(istDate);
    if (bucket) {
      bucket.push(pt);
    } else {
      byDate.set(istDate, [pt]);
    }
  }
  return byDate;
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
  activityDate?: string;
}): DailyActivityMetricsRow {
  const { vehicle, liveVehicle, points, assignments, drivers, bounds, telemetryComputed, activityDate } = params;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayIstStr = formatter.format(new Date());
  const resolvedActivityDate =
    activityDate ||
    (points[0] ? formatter.format(new Date(points[0].recorded_at)) : null) ||
    bounds.endIstDate ||
    todayIstStr;

  const model = resolveFleetVehicleModel(vehicle.model, vehicle.type, vehicle.device_id, vehicle.id);
  const category = (vehicle.type || "").trim() || "Tanker 10KL";

  const metrics = telemetryComputed && points.length > 0 ? calculateJourneyMetrics(points) : null;
  const segmented = telemetryComputed && points.length > 0 ? splitPointsIntoSegments(points) : { segments: [] };
  const journeys =
    telemetryComputed && points.length > 0
      ? deriveJourneysFromTelemetry(points, { id: vehicle.id, number: vehicle.number, model }, [], assignments, drivers)
      : [];
  const timelineEvents =
    telemetryComputed && points.length > 0
      ? generateJourneyTimelineEvents(points, journeys[0])
      : [];
  const idleParked =
    telemetryComputed && points.length > 1
      ? computeIdleParkedBreakdown(points)
      : { idlingSeconds: 0, parkedSeconds: 0 };

  // Count genuine moving journeys (exclude stationary yard snapshots)
  const movingJourneys = journeys.filter(
    (j) => j.metrics.totalDistanceKm >= 0.2 || j.metrics.drivingDurationSeconds >= 60
  );
  const tripsCount = movingJourneys.length;

  const distanceKmNum = metrics ? metrics.totalDistanceKm : 0;
  const drivingSeconds = metrics ? Math.round(metrics.drivingDurationSeconds) : 0;
  const stoppedSeconds = metrics ? Math.round(metrics.stoppedDurationSeconds) : 0;
  const idlingSeconds = idleParked.idlingSeconds;
  const parkedSeconds = idleParked.parkedSeconds;
  const stopsCount = metrics ? metrics.stopsCount : 0;
  const maxSpeedKmh = metrics ? metrics.maxSpeedKmh : 0;
  const avgSpeedKmh =
    metrics && (distanceKmNum >= 0.2 || drivingSeconds >= 60) ? metrics.avgSpeedKmh : 0;

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
  const firstPt = points.length > 0 ? points[0] : null;
  const lastPt = points.length > 0 ? points[points.length - 1] : null;
  // Only overlay live current telemetry onto Today's row or non-daily-grouped All-Time snapshot
  const isCurrentScope =
    resolvedActivityDate === todayIstStr &&
    (bounds.mode === "today" || (bounds.isAllTime && !activityDate));

  let coordLat: number | null = null;
  let coordLng: number | null = null;
  let startLat: number | null = firstPt ? firstPt.lat : null;
  let startLng: number | null = firstPt ? firstPt.lng : null;
  let location = "No telemetry in period";
  let startLocation = firstPt ? getImmediateLocationDisplay(null, firstPt.lat, firstPt.lng) : "-";
  let lastReportedIso: string | null = null;

  if (lastPt) {
    coordLat = lastPt.lat;
    coordLng = lastPt.lng;
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
      startLat = coordLat;
      startLng = coordLng;
    }
    location = getImmediateLocationDisplay(rawLoc, rawLat, rawLng);
    startLocation = location;
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
    activityDate: resolvedActivityDate,
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
    idlingSeconds,
    idlingTime: formatDurationCompact(idlingSeconds),
    parkedSeconds,
    parkedTime: formatDurationCompact(parkedSeconds),
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
    startLocation,
    coordLat,
    coordLng,
    startLat,
    startLng,
    startTimeIso: firstPt?.recorded_at || null,
    endTimeIso: lastPt?.recorded_at || lastReportedIso || null,
    lastReportedMs: Number.isFinite(lastReportedMs) ? lastReportedMs : 0,
    lastReported,
    hasMovement: distanceKmNum >= 0.2 || tripsCount > 0,
    hasTelemetry: points.length > 0 || (isCurrentScope && Boolean(lastReportedIso)),
    points,
    segments: segmented.segments,
    journeys,
    timelineEvents,
  };
}

/**
 * Expands a vehicle's telemetry points into day-by-day rows (sorted newest to oldest)
 * so multi-day reports show every recorded day one by one.
 */
export function buildVehicleDailyHistoryRows(params: {
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
}): DailyActivityMetricsRow[] {
  const { vehicle, liveVehicle, points, assignments, drivers, bounds } = params;
  const grouped = groupPointsByIstDate(points);
  if (grouped.size === 0) {
    return [
      buildDailyActivityRow({
        vehicle,
        liveVehicle,
        points: [],
        assignments,
        drivers,
        bounds,
        telemetryComputed: true,
        activityDate: bounds.endIstDate,
      }),
    ];
  }

  const datesDesc = Array.from(grouped.keys()).sort((a, b) => b.localeCompare(a));
  return datesDesc.map((dayStr) =>
    buildDailyActivityRow({
      vehicle,
      liveVehicle,
      points: grouped.get(dayStr) || [],
      assignments,
      drivers,
      bounds,
      telemetryComputed: true,
      activityDate: dayStr,
    })
  );
}

/**
 * Aggregates per-vehicle Daily Activity rows into top-level dashboard KPIs.
 */
export function aggregateDailyActivitySummary(rows: DailyActivityMetricsRow[]): DailyActivitySummary {
  const uniqueVehicles = new Set<string>();
  const activeVehicleIds = new Set<string>();
  const uniqueDates = new Set<string>();
  const activeDates = new Set<string>();
  let totalDistanceKm = 0;
  let totalTrips = 0;
  let totalStopsCount = 0;
  let totalDrivingSeconds = 0;
  let totalIdlingSeconds = 0;
  let totalParkedSeconds = 0;
  let totalStoppedSeconds = 0;
  let fleetMaxSpeedKmh = 0;

  for (const r of rows) {
    uniqueVehicles.add(r.vehicleId);
    if (r.activityDate) uniqueDates.add(r.activityDate);
    if (r.hasMovement || r.status === "Moving") {
      activeVehicleIds.add(r.vehicleId);
      if (r.activityDate) activeDates.add(r.activityDate);
    }
    totalDistanceKm += r.distanceKmNum;
    totalTrips += r.tripsCount;
    totalStopsCount += r.stopsCount;
    totalDrivingSeconds += r.drivingSeconds;
    totalIdlingSeconds += r.idlingSeconds;
    totalParkedSeconds += r.parkedSeconds;
    totalStoppedSeconds += r.stoppedSeconds;
    if (r.maxSpeedKmh > fleetMaxSpeedKmh) {
      fleetMaxSpeedKmh = r.maxSpeedKmh;
    }
  }

  const totalVehicles = uniqueVehicles.size;
  const activeVehicles = activeVehicleIds.size;
  const roundedDist = Math.round(totalDistanceKm * 10) / 10;
  const drivingHours = totalDrivingSeconds / 3600;
  const fleetAvgSpeedKmh =
    drivingHours > 0 ? Math.round((roundedDist / drivingHours) * 10) / 10 : 0;

  return {
    totalVehicles,
    activeVehicles,
    idleVehicles: Math.max(0, totalVehicles - activeVehicles),
    totalDays: uniqueDates.size,
    activeDays: activeDates.size,
    totalDistanceKm: roundedDist,
    totalTrips,
    totalStopsCount,
    totalDrivingSeconds,
    totalIdlingSeconds,
    totalParkedSeconds,
    totalStoppedSeconds,
    fleetMaxSpeedKmh,
    fleetAvgSpeedKmh,
  };
}

/**
 * Parses numeric or date metric values out of formatted report strings (e.g. "116.9 km",
 * "₹ 4,500", "3h 11m", "2026-11-24", "17 Nov 2026, 09:24 am") so sorting works naturally.
 */
function parseSortableValue(val: unknown): { isNum: boolean; num: number; str: string } {
  if (typeof val === "number" && Number.isFinite(val)) {
    return { isNum: true, num: val, str: String(val) };
  }
  const s = String(val ?? "").trim();
  if (!s || s === "-" || s === "—") {
    return { isNum: false, num: -Infinity, str: "" };
  }
  // ISO calendar date YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { isNum: true, num: new Date(`${s}T00:00:00Z`).getTime(), str: s };
  }
  // Formatted date/time strings like "17 Nov 2026, 09:24:54 am" or "Nov 24, 2026"
  if (/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(s)) {
    const parsedMs = Date.parse(s);
    if (Number.isFinite(parsedMs)) {
      return { isNum: true, num: parsedMs, str: s };
    }
  }
  // Duration like "3h 11m" or "45m"
  const durMatch = s.match(/^(?:(\d+)h)?\s*(?:(\d+)m)?$/i);
  if (durMatch && (durMatch[1] || durMatch[2])) {
    const mins = (Number(durMatch[1] || 0) * 60) + Number(durMatch[2] || 0);
    return { isNum: true, num: mins, str: s };
  }
  // Numeric prefix/currency like "10,035 km", "₹ 4,500.50", "85%"
  const cleanNum = s.replace(/[₹,\s]/g, "").replace(/(km\/h|km|L|%)$/i, "");
  if (/^-?\d+(\.\d+)?$/.test(cleanNum)) {
    return { isNum: true, num: Number(cleanNum), str: s };
  }
  return { isNum: false, num: 0, str: s.toLowerCase() };
}

/**
 * Applies status filter, full-row search query, and column sort deterministically.
 * Used identically by the UI table and CSV export so exported data matches filtered rows.
 */
export function filterAndSortReportRows<T extends Record<string, any>>(
  rows: T[],
  options: {
    searchQuery?: string;
    statusFilter?: string;
    sortKey?: string | null;
    sortDir?: "asc" | "desc";
  }
): T[] {
  const { searchQuery = "", statusFilter = "All", sortKey = null, sortDir = "asc" } = options;
  let result = rows;

  if (statusFilter && statusFilter !== "All") {
    const target = statusFilter.toLowerCase();
    result = result.filter((row) => {
      const st = String(row.status ?? "").toLowerCase();
      if (target === "active") return st === "moving" || st.startsWith("active");
      if (target === "idle") return st === "idle" || st === "stationary";
      return st === target || st.includes(target);
    });
  }

  const trimmedQ = searchQuery.trim().toLowerCase();
  if (trimmedQ) {
    result = result.filter((row) =>
      Object.values(row).some((v) => String(v ?? "").toLowerCase().includes(trimmedQ))
    );
  }

  if (sortKey) {
    result = [...result].sort((a, b) => {
      const pa = parseSortableValue(a[sortKey]);
      const pb = parseSortableValue(b[sortKey]);
      let cmp = 0;
      if (pa.isNum && pb.isNum) {
        cmp = pa.num - pb.num;
      } else {
        cmp = pa.str.localeCompare(pb.str);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  return result;
}

/**
 * Generates RFC-4180 escaped CSV text with UTF-8 BOM from the currently filtered rows.
 */
export function buildReportCsv(rows: Record<string, any>[]): string {
  if (!rows || rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const headerLine = keys
    .map((k) => `"${k.replace(/([A-Z])/g, " $1").trim().replace(/"/g, '""')}"`)
    .join(",");
  const dataLines = rows.map((r) =>
    keys.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(",")
  );
  return "\uFEFF" + [headerLine, ...dataLines].join("\r\n");
}

function parseLeadingNumber(val: unknown): number {
  const cleaned = String(val ?? "").replace(/[₹,\s]/g, "");
  const m = cleaned.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

/**
 * Derives KPI cards and chart datasets for the non-daily report tabs strictly
 * from the currently filtered rows.
 */
export function computeOtherReportInsights(
  reportType: "route_completion" | "speeding_incidents" | "fuel_efficiency" | "maintenance_costs",
  rows: Record<string, any>[]
): OtherReportSummary {
  if (reportType === "route_completion") {
    const totalRoutes = rows.length;
    const totalLitres = rows.reduce((s, r) => s + parseLeadingNumber(r.milkCollectedLiters), 0);
    const avgCompletion =
      totalRoutes > 0
        ? Math.round(rows.reduce((s, r) => s + parseLeadingNumber(r.completionRate), 0) / totalRoutes)
        : 0;
    const completed = rows.filter((r) => String(r.status).toLowerCase() === "completed").length;

    const byVehicle = new Map<string, { litres: number; completionSum: number; count: number }>();
    for (const r of rows) {
      const v = String(r.vehicle || "Unassigned");
      const cur = byVehicle.get(v) || { litres: 0, completionSum: 0, count: 0 };
      cur.litres += parseLeadingNumber(r.milkCollectedLiters);
      cur.completionSum += parseLeadingNumber(r.completionRate);
      cur.count += 1;
      byVehicle.set(v, cur);
    }

    return {
      kpis: [
        { label: "Total Routes", value: String(totalRoutes), hint: `${completed} completed` },
        { label: "Milk Collected", value: `${totalLitres.toLocaleString()} L`, hint: "Filtered routes sum" },
        { label: "Avg Completion", value: `${avgCompletion}%`, hint: "Across filtered routes" },
        { label: "Active Units", value: String(byVehicle.size), hint: "Vehicles assigned" },
      ],
      chartTitle: "Milk Collected (L) & Avg Completion (%) by Vehicle",
      chartData: Array.from(byVehicle.entries()).map(([name, val]) => ({
        name,
        primary: Math.round(val.litres),
        secondary: Math.round(val.completionSum / val.count),
        primaryLabel: "Milk (L)",
        secondaryLabel: "Completion (%)",
      })),
    };
  }

  if (reportType === "speeding_incidents") {
    const total = rows.length;
    const open = rows.filter((r) => String(r.status).toLowerCase().includes("open")).length;
    const resolved = total - open;
    const highSev = rows.filter((r) => String(r.severity).toLowerCase() === "high").length;

    const byVehicle = new Map<string, { open: number; resolved: number }>();
    for (const r of rows) {
      const v = String(r.vehicle || "Fleet Unit");
      const cur = byVehicle.get(v) || { open: 0, resolved: 0 };
      if (String(r.status).toLowerCase().includes("open")) cur.open += 1;
      else cur.resolved += 1;
      byVehicle.set(v, cur);
    }

    return {
      kpis: [
        { label: "Total Incidents", value: String(total), hint: "Filtered safety alerts" },
        { label: "Open Alerts", value: String(open), hint: "Needs review" },
        { label: "Resolved", value: String(resolved), hint: "Closed incidents" },
        { label: "High Severity", value: String(highSev), hint: "Critical events" },
      ],
      chartTitle: "Safety Incidents by Vehicle (Open vs Resolved)",
      chartData: Array.from(byVehicle.entries()).map(([name, val]) => ({
        name,
        primary: val.open,
        secondary: val.resolved,
        primaryLabel: "Open",
        secondaryLabel: "Resolved",
      })),
    };
  }

  if (reportType === "fuel_efficiency") {
    const fills = rows.length;
    const totalLiters = rows.reduce((s, r) => s + parseLeadingNumber(r.volumeLiters), 0);
    const totalCost = rows.reduce((s, r) => s + parseLeadingNumber(r.totalCost), 0);
    const avgRate = totalLiters > 0 ? totalCost / totalLiters : 0;

    const byVehicle = new Map<string, { liters: number; cost: number }>();
    for (const r of rows) {
      const v = String(r.vehicle || "Fleet Unit");
      const cur = byVehicle.get(v) || { liters: 0, cost: 0 };
      cur.liters += parseLeadingNumber(r.volumeLiters);
      cur.cost += parseLeadingNumber(r.totalCost);
      byVehicle.set(v, cur);
    }

    return {
      kpis: [
        { label: "Fuel Fills", value: String(fills), hint: "Filtered log entries" },
        { label: "Total Volume", value: `${totalLiters.toFixed(1)} L`, hint: "Diesel purchased" },
        { label: "Total Spend", value: `₹ ${Math.round(totalCost).toLocaleString("en-IN")}`, hint: "Filtered period cost" },
        { label: "Weighted Rate", value: avgRate > 0 ? `₹ ${avgRate.toFixed(2)} / L` : "-", hint: "Avg per liter" },
      ],
      chartTitle: "Fuel Volume (L) by Vehicle",
      chartData: Array.from(byVehicle.entries()).map(([name, val]) => ({
        name,
        primary: Math.round(val.liters * 10) / 10,
        secondary: Math.round(val.cost),
        primaryLabel: "Volume (L)",
        secondaryLabel: "Cost (₹)",
      })),
    };
  }

  // maintenance_costs
  const totalJobs = rows.length;
  const totalCost = rows.reduce((s, r) => s + parseLeadingNumber(r.cost), 0);
  const completed = rows.filter((r) => String(r.status).toLowerCase() === "completed").length;
  const pending = totalJobs - completed;

  const byVehicle = new Map<string, { cost: number; jobs: number }>();
  for (const r of rows) {
    const v = String(r.vehicle || "Fleet Unit");
    const cur = byVehicle.get(v) || { cost: 0, jobs: 0 };
    cur.cost += parseLeadingNumber(r.cost);
    cur.jobs += 1;
    byVehicle.set(v, cur);
  }

  return {
    kpis: [
      { label: "Service Records", value: String(totalJobs), hint: `${completed} completed` },
      { label: "Total Repair Cost", value: `₹ ${Math.round(totalCost).toLocaleString("en-IN")}`, hint: "Filtered services" },
      { label: "Pending / Scheduled", value: String(pending), hint: "Open work orders" },
      { label: "Vehicles Serviced", value: String(byVehicle.size), hint: "Across filtered logs" },
    ],
    chartTitle: "Maintenance Cost (₹) by Vehicle",
    chartData: Array.from(byVehicle.entries()).map(([name, val]) => ({
      name,
      primary: Math.round(val.cost),
      secondary: val.jobs,
      primaryLabel: "Cost (₹)",
      secondaryLabel: "Services",
    })),
  };
}
