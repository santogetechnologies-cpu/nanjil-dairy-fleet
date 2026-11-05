/**
 * tripHistoryEngine.ts — Authoritative Trip History & GPS Playback Engine
 *
 * Core capabilities:
 * 1. Timezone conversion strictly for Asia/Kolkata (IST, UTC+05:30)
 * 2. Full paginated fetching of telemetry_history without silent row-limit cutoffs
 * 3. Strict UUID foreign key validation (never passes device IDs to UUID queries)
 * 4. GPS coordinate validation, jump rejection (>200 km / >150 km/h)
 * 5. Route segmentation across signal gaps (>15m) preventing false straight lines
 * 6. Timestamp-based mathematical journey metrics (distance, driving/stopped duration, avg speed)
 * 7. Authentic driver assignment correlation across time windows
 * 8. Trip association & derived GPS journeys
 * 9. Synchronized journey timeline events
 */

export { haversineDistanceKm } from "./roadRouting.ts";
import { haversineDistanceKm } from "./roadRouting.ts";

// ── TYPES ────────────────────────────────────────────────────────────────────

export interface GpsPoint {
  id: string;
  lat: number;
  lng: number;
  speed: number;
  ignition: boolean;
  recorded_at: string;
  odometer?: number;
  engine_hours?: number;
  source?: string;
  isGap?: boolean;
  gapMinutes?: number;
}

export interface RouteSegment {
  points: GpsPoint[];
  startIndex: number;
  endIndex: number;
}

export interface JourneyMetrics {
  totalDistanceKm: number;
  totalDurationSeconds: number;
  drivingDurationSeconds: number;
  stoppedDurationSeconds: number;
  stopsCount: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  speedingIncidentsCount: number;
  gapsCount: number;
  totalGapDurationSeconds: number;
  startOdometer?: number;
  endOdometer?: number;
  odometerDistanceKm?: number;
  isDataSufficient: boolean;
  qualityScore: "High" | "Moderate" | "Low" | "Insufficient";
}

export interface DerivedJourney {
  id: string;
  vehicle_id: string;
  vehicle_number: string;
  vehicle_model?: string;
  driver_id?: string | null;
  driver_name: string;
  start_time: string;
  end_time: string;
  start_location: string;
  end_location: string;
  start_lat: number;
  start_lng: number;
  end_lat: number;
  end_lng: number;
  metrics: JourneyMetrics;
  points: GpsPoint[];
  segments: RouteSegment[];
  isManualTrip?: boolean;
  status: "Completed" | "Ongoing" | "Stationary";
}

export interface TimelineEvent {
  id: string;
  type: "start" | "moving" | "stop" | "resumed" | "speeding" | "gap" | "end";
  timestamp: string;
  title: string;
  description: string;
  pointIndex: number;
  lat: number;
  lng: number;
  durationMins?: number;
  speed?: number;
  source?: string;
}

// ── TIMEZONE CONVERSION (ASIA/KOLKATA) ───────────────────────────────────────

/**
 * Computes calendar date boundaries in Asia/Kolkata (IST = UTC+05:30)
 * and safely converts them to UTC ISO strings for Supabase database queries.
 */
export function getIstDateRange(
  mode: "today" | "yesterday" | "last7" | "last30" | "custom",
  customStart?: string,
  customEnd?: string,
  refDate = new Date()
): {
  startUtcIso: string;
  endUtcIso: string;
  startIstDate: string;
  endIstDate: string;
  displayLabel: string;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayIstStr = formatter.format(refDate);

  let startIstDate = todayIstStr;
  let endIstDate = todayIstStr;
  let displayLabel = "Today";

  if (mode === "today") {
    startIstDate = todayIstStr;
    endIstDate = todayIstStr;
    displayLabel = `Today (${todayIstStr})`;
  } else if (mode === "yesterday") {
    const [y, m, d] = todayIstStr.split("-").map(Number);
    const prevDate = new Date(Date.UTC(y, m - 1, d - 1));
    const yestStr = prevDate.toISOString().split("T")[0];
    startIstDate = yestStr;
    endIstDate = yestStr;
    displayLabel = `Yesterday (${yestStr})`;
  } else if (mode === "last7") {
    const [y, m, d] = todayIstStr.split("-").map(Number);
    const prev7Date = new Date(Date.UTC(y, m - 1, d - 6));
    startIstDate = prev7Date.toISOString().split("T")[0];
    endIstDate = todayIstStr;
    displayLabel = `Last 7 Days (${startIstDate} to ${endIstDate})`;
  } else if (mode === "last30") {
    const [y, m, d] = todayIstStr.split("-").map(Number);
    const prev30Date = new Date(Date.UTC(y, m - 1, d - 29));
    startIstDate = prev30Date.toISOString().split("T")[0];
    endIstDate = todayIstStr;
    displayLabel = `Last 30 Days (${startIstDate} to ${endIstDate})`;
  } else {
    startIstDate = customStart || todayIstStr;
    endIstDate = customEnd || todayIstStr;
    displayLabel = `${startIstDate} to ${endIstDate}`;
  }

  // Convert IST calendar boundaries to UTC ISO string
  const startUtc = new Date(`${startIstDate}T00:00:00.000+05:30`);
  const endUtc = new Date(`${endIstDate}T23:59:59.999+05:30`);

  return {
    startUtcIso: startUtc.toISOString(),
    endUtcIso: endUtc.toISOString(),
    startIstDate,
    endIstDate,
    displayLabel,
  };
}

export function formatIstDateTime(isoString?: string | null): string {
  if (!isoString) return "N/A";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "N/A";
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return "N/A";
  }
}

export function formatIstTime(isoString?: string | null): string {
  if (!isoString) return "00:00";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "00:00";
    return d.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return "00:00";
  }
}

// ── UUID & COORDINATES VALIDATION ────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(val?: unknown): boolean {
  if (typeof val !== "string") return false;
  return UUID_REGEX.test(val.trim());
}

export function isValidGpsCoord(lat: unknown, lng: unknown): boolean {
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (isNaN(nLat) || isNaN(nLng)) return false;
  if (nLat < -90 || nLat > 90 || nLng < -180 || nLng > 180) return false;
  // Ignore (0, 0) default coordinates
  if (Math.abs(nLat) < 0.0001 && Math.abs(nLng) < 0.0001) return false;
  return true;
}

// ── PAGINATED HISTORICAL GPS FETCHING ────────────────────────────────────────

export async function fetchPaginatedTelemetryHistory(
  supabaseClient: any,
  vehicleUuid: string,
  startUtcIso: string,
  endUtcIso: string,
  pageSize = 1000,
  onProgress?: (loaded: number, total?: number) => void,
  signal?: AbortSignal
): Promise<{
  data: GpsPoint[];
  earliestTimestamp?: string;
  latestTimestamp?: string;
  error?: string;
}> {
  if (!isValidUuid(vehicleUuid)) {
    return { data: [], error: `Invalid vehicle UUID provided: ${vehicleUuid}` };
  }

  const allPoints: GpsPoint[] = [];
  const seenIds = new Set<string>();
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    if (signal?.aborted) {
      return { data: [], error: "Fetch cancelled by user" };
    }

    const to = from + pageSize - 1;
    const { data, error, count } = await supabaseClient
      .from("telemetry_history")
      .select(
        "id, vehicle_id, lat, lng, speed, ignition, engine_on, recorded_at, odometer, engine_hours, source",
        { count: from === 0 ? "exact" : undefined }
      )
      .eq("vehicle_id", vehicleUuid)
      .gte("recorded_at", startUtcIso)
      .lte("recorded_at", endUtcIso)
      .order("recorded_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      return { data: allPoints, error: error.message };
    }

    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }

    for (const row of data) {
      const idStr = String(row.id);
      if (!seenIds.has(idStr)) {
        seenIds.add(idStr);
        const lat = Number(row.lat);
        const lng = Number(row.lng);
        if (isValidGpsCoord(lat, lng)) {
          allPoints.push({
            id: idStr,
            lat,
            lng,
            speed: Math.max(0, Math.round(Number(row.speed) || 0)),
            ignition: Boolean(row.ignition ?? row.engine_on),
            recorded_at: row.recorded_at,
            odometer: row.odometer != null ? Number(row.odometer) : undefined,
            engine_hours: row.engine_hours != null ? Number(row.engine_hours) : undefined,
            source: row.source || "telemetry",
          });
        }
      }
    }

    onProgress?.(allPoints.length, count ?? undefined);

    if (data.length < pageSize) {
      hasMore = false;
    } else {
      from += pageSize;
    }
  }

  return {
    data: allPoints,
    earliestTimestamp: allPoints[0]?.recorded_at,
    latestTimestamp: allPoints[allPoints.length - 1]?.recorded_at,
  };
}

// ── ROUTE SEGMENTATION & GAP SPLITTING ───────────────────────────────────────

export function splitPointsIntoSegments(
  points: GpsPoint[],
  maxGapMinutes = 15
): {
  segments: RouteSegment[];
  gapIndices: number[];
  totalGapsCount: number;
  totalGapDurationSec: number;
} {
  if (!points || points.length === 0) {
    return { segments: [], gapIndices: [], totalGapsCount: 0, totalGapDurationSec: 0 };
  }

  const segments: RouteSegment[] = [];
  const gapIndices: number[] = [];
  let currentSegmentPoints: GpsPoint[] = [points[0]];
  let segmentStartIndex = 0;
  let totalGapDurationSec = 0;

  for (let i = 1; i < points.length; i++) {
    const prevTime = new Date(points[i - 1].recorded_at).getTime();
    const currTime = new Date(points[i].recorded_at).getTime();
    const diffSec = Math.max(0, (currTime - prevTime) / 1000);
    const diffMins = diffSec / 60;

    if (diffMins > maxGapMinutes) {
      points[i].isGap = true;
      points[i].gapMinutes = Math.round(diffMins);
      gapIndices.push(i);
      totalGapDurationSec += diffSec;

      segments.push({
        points: currentSegmentPoints,
        startIndex: segmentStartIndex,
        endIndex: i - 1,
      });

      currentSegmentPoints = [points[i]];
      segmentStartIndex = i;
    } else {
      currentSegmentPoints.push(points[i]);
    }
  }

  if (currentSegmentPoints.length > 0) {
    segments.push({
      points: currentSegmentPoints,
      startIndex: segmentStartIndex,
      endIndex: points.length - 1,
    });
  }

  return {
    segments,
    gapIndices,
    totalGapsCount: gapIndices.length,
    totalGapDurationSec,
  };
}

export function buildSegmentedGeoJson(segments: RouteSegment[]): any {
  const lineStrings = segments
    .filter((s) => s.points.length >= 2)
    .map((s) => s.points.map((p) => [p.lng, p.lat]));

  if (lineStrings.length === 0) return null;

  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "MultiLineString" as const,
      coordinates: lineStrings,
    },
  };
}

// ── TIMESTAMP-BASED MATHEMATICAL JOURNEY CALCULATIONS ───────────────────────

export function calculateJourneyMetrics(
  points: GpsPoint[],
  maxGapMinutes = 15,
  overspeedThresholdKmh = 60
): JourneyMetrics {
  if (!points || points.length === 0) {
    return {
      totalDistanceKm: 0,
      totalDurationSeconds: 0,
      drivingDurationSeconds: 0,
      stoppedDurationSeconds: 0,
      stopsCount: 0,
      avgSpeedKmh: 0,
      maxSpeedKmh: 0,
      speedingIncidentsCount: 0,
      gapsCount: 0,
      totalGapDurationSeconds: 0,
      isDataSufficient: false,
      qualityScore: "Insufficient",
    };
  }

  let totalDistanceKm = 0;
  let maxSpeedKmh = 0;
  let drivingDurationSeconds = 0;
  let stoppedDurationSeconds = 0;
  let speedingIncidentsCount = 0;
  let inOverspeed = false;

  const { gapIndices, totalGapsCount, totalGapDurationSec } = splitPointsIntoSegments(points, maxGapMinutes);

  let currentStationaryStartMs: number | null = null;
  let confirmedStopsCount = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.speed > maxSpeedKmh) maxSpeedKmh = p.speed;

    // Overspeed check
    if (p.speed > overspeedThresholdKmh) {
      if (!inOverspeed) {
        speedingIncidentsCount++;
        inOverspeed = true;
      }
    } else {
      inOverspeed = false;
    }

    if (i === 0) {
      if (p.speed <= 3) {
        currentStationaryStartMs = new Date(p.recorded_at).getTime();
      }
      continue;
    }

    const prevP = points[i - 1];
    const prevMs = new Date(prevP.recorded_at).getTime();
    const currMs = new Date(p.recorded_at).getTime();
    const deltaSec = Math.max(0, (currMs - prevMs) / 1000);

    // Skip distance and duration across signal gaps
    if (p.isGap || deltaSec > maxGapMinutes * 60) {
      if (currentStationaryStartMs !== null) {
        const stationaryDurationSec = Math.round((prevMs - currentStationaryStartMs) / 1000);
        if (stationaryDurationSec >= 120) {
          stoppedDurationSeconds += stationaryDurationSec;
          confirmedStopsCount++;
        }
        currentStationaryStartMs = null;
      }

      if (p.speed <= 3) {
        currentStationaryStartMs = currMs;
      }
      continue;
    }

    // Distance calculation with teleport rejection
    const dist = haversineDistanceKm(prevP.lat, prevP.lng, p.lat, p.lng);
    const impliedSpeedKmh = deltaSec > 0 ? (dist / (deltaSec / 3600)) : 0;

    // Reject teleport jump (>200 km or implied speed > 150 km/h)
    const isValidJump = dist <= 200 && impliedSpeedKmh <= 150;
    if (isValidJump) {
      totalDistanceKm += dist;
    }

    // Movement condition (speed > 3 km/h)
    if (p.speed > 3) {
      drivingDurationSeconds += deltaSec;
      if (currentStationaryStartMs !== null) {
        const stationaryDurationSec = Math.round((prevMs - currentStationaryStartMs) / 1000);
        if (stationaryDurationSec >= 120) {
          stoppedDurationSeconds += stationaryDurationSec;
          confirmedStopsCount++;
        }
        currentStationaryStartMs = null;
      }
    } else {
      // Stationary condition
      if (currentStationaryStartMs === null) {
        currentStationaryStartMs = prevMs;
      }
    }
  }

  // Final stationary block check
  if (currentStationaryStartMs !== null && points.length > 1) {
    const lastMs = new Date(points[points.length - 1].recorded_at).getTime();
    const stationaryDurationSec = Math.round((lastMs - currentStationaryStartMs) / 1000);
    if (stationaryDurationSec >= 120) {
      stoppedDurationSeconds += stationaryDurationSec;
      confirmedStopsCount++;
    }
  }

  const startMs = new Date(points[0].recorded_at).getTime();
  const endMs = new Date(points[points.length - 1].recorded_at).getTime();
  const totalDurationSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));

  // Mathematical Average Speed = Total Distance / Driving Time
  const drivingHours = drivingDurationSeconds / 3600;
  const avgSpeedKmh = drivingHours > 0
    ? Math.round((totalDistanceKm / drivingHours) * 10) / 10
    : 0;

  // Odometers
  const startOdometer = points[0]?.odometer;
  const endOdometer = points[points.length - 1]?.odometer;
  let odometerDistanceKm: number | undefined;
  if (startOdometer != null && endOdometer != null && endOdometer >= startOdometer) {
    odometerDistanceKm = Math.round((endOdometer - startOdometer) * 10) / 10;
  }

  const isDataSufficient = points.length >= 2;
  let qualityScore: "High" | "Moderate" | "Low" | "Insufficient" = "Insufficient";
  if (isDataSufficient) {
    if (totalGapsCount === 0) qualityScore = "High";
    else if (totalGapsCount <= 2) qualityScore = "Moderate";
    else qualityScore = "Low";
  }

  return {
    totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
    totalDurationSeconds,
    drivingDurationSeconds,
    stoppedDurationSeconds,
    stopsCount: confirmedStopsCount,
    avgSpeedKmh,
    maxSpeedKmh,
    speedingIncidentsCount,
    gapsCount: totalGapsCount,
    totalGapDurationSeconds: totalGapDurationSec,
    startOdometer,
    endOdometer,
    odometerDistanceKm,
    isDataSufficient,
    qualityScore,
  };
}

// ── DRIVER ASSOCIATION ───────────────────────────────────────────────────────

export function resolveDriverForJourney(
  vehicleId: string,
  journeyStartIso: string,
  journeyEndIso: string,
  assignments: any[],
  drivers: any[]
): { driverId: string | null; driverName: string } {
  if (!assignments || assignments.length === 0) {
    return { driverId: null, driverName: "Driver information unavailable" };
  }

  const jStart = new Date(journeyStartIso).getTime();

  // Find assignment active at journey start
  const matched = assignments.find((a) => {
    if (a.vehicle_id !== vehicleId) return false;
    const aStart = new Date(a.assigned_at).getTime();
    if (isNaN(aStart) || aStart > jStart) return false;
    if (a.unassigned_at) {
      const aEnd = new Date(a.unassigned_at).getTime();
      if (!isNaN(aEnd) && aEnd < jStart) return false;
    }
    return true;
  });

  if (matched) {
    const driverId = matched.driver_id;
    let dName = matched.drivers?.name;
    if (!dName && drivers) {
      const dObj = drivers.find((d) => d.id === driverId);
      if (dObj) dName = dObj.name;
    }
    return {
      driverId: driverId || null,
      driverName: dName || "Assigned Driver",
    };
  }

  return { driverId: null, driverName: "Driver information unavailable" };
}

// ── JOURNEY DERIVATION & TRIPS TABLE CORRELATION ────────────────────────────

export function deriveJourneysFromTelemetry(
  points: GpsPoint[],
  vehicle: { id: string; number: string; model?: string },
  tripsTable: any[],
  assignments: any[],
  drivers: any[],
  maxGapMinutes = 15,
  journeySplitSilenceMins = 30
): DerivedJourney[] {
  if (!points || points.length === 0) return [];

  // 1. Check if matching manual trips exist in `trips` table
  const matchingTrips = (tripsTable || []).filter((t) => t.vehicle_id === vehicle.id);

  if (matchingTrips.length > 0) {
    const journeysFromTrips: DerivedJourney[] = [];

    for (const trip of matchingTrips) {
      const tripDateStr = trip.date; // "YYYY-MM-DD"
      const tripPoints = points.filter((p) => p.recorded_at.startsWith(tripDateStr));

      if (tripPoints.length > 0) {
        const { segments } = splitPointsIntoSegments(tripPoints, maxGapMinutes);
        const metrics = calculateJourneyMetrics(tripPoints, maxGapMinutes);
        const driverInfo = trip.driver_id
          ? {
              driverId: trip.driver_id,
              driverName: trip.drivers?.name || "Assigned Driver",
            }
          : resolveDriverForJourney(
              vehicle.id,
              tripPoints[0].recorded_at,
              tripPoints[tripPoints.length - 1].recorded_at,
              assignments,
              drivers
            );

        journeysFromTrips.push({
          id: trip.id,
          vehicle_id: vehicle.id,
          vehicle_number: vehicle.number,
          vehicle_model: vehicle.model,
          driver_id: driverInfo.driverId,
          driver_name: driverInfo.driverName,
          start_time: tripPoints[0].recorded_at,
          end_time: tripPoints[tripPoints.length - 1].recorded_at,
          start_location: trip.start || `${tripPoints[0].lat.toFixed(4)}, ${tripPoints[0].lng.toFixed(4)}`,
          end_location:
            trip.destination ||
            `${tripPoints[tripPoints.length - 1].lat.toFixed(4)}, ${tripPoints[tripPoints.length - 1].lng.toFixed(4)}`,
          start_lat: tripPoints[0].lat,
          start_lng: tripPoints[0].lng,
          end_lat: tripPoints[tripPoints.length - 1].lat,
          end_lng: tripPoints[tripPoints.length - 1].lng,
          metrics,
          points: tripPoints,
          segments,
          isManualTrip: true,
          status: trip.status === "Completed" ? "Completed" : "Ongoing",
        });
      }
    }

    if (journeysFromTrips.length > 0) {
      return journeysFromTrips;
    }
  }

  // 2. Derive distinct journeys from telemetry time series
  const journeyPointGroups: GpsPoint[][] = [];
  let currentGroup: GpsPoint[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prevTime = new Date(points[i - 1].recorded_at).getTime();
    const currTime = new Date(points[i].recorded_at).getTime();
    const diffMins = (currTime - prevTime) / (60 * 1000);

    // If gap between consecutive points > journeySplitSilenceMins, treat as new journey
    if (diffMins > journeySplitSilenceMins) {
      if (currentGroup.length > 0) {
        journeyPointGroups.push(currentGroup);
      }
      currentGroup = [points[i]];
    } else {
      currentGroup.push(points[i]);
    }
  }

  if (currentGroup.length > 0) {
    journeyPointGroups.push(currentGroup);
  }

  const derived: DerivedJourney[] = [];

  for (let idx = 0; idx < journeyPointGroups.length; idx++) {
    const jPoints = journeyPointGroups[idx];
    if (jPoints.length === 0) continue;

    const { segments } = splitPointsIntoSegments(jPoints, maxGapMinutes);
    const metrics = calculateJourneyMetrics(jPoints, maxGapMinutes);
    const firstPt = jPoints[0];
    const lastPt = jPoints[jPoints.length - 1];

    const driverInfo = resolveDriverForJourney(
      vehicle.id,
      firstPt.recorded_at,
      lastPt.recorded_at,
      assignments,
      drivers
    );

    const isMovingNow = lastPt.speed > 3;
    const isCompleted = !isMovingNow && Date.now() - new Date(lastPt.recorded_at).getTime() > 15 * 60 * 1000;

    derived.push({
      id: `journey-${vehicle.id.substring(0, 8)}-${idx + 1}`,
      vehicle_id: vehicle.id,
      vehicle_number: vehicle.number,
      vehicle_model: vehicle.model,
      driver_id: driverInfo.driverId,
      driver_name: driverInfo.driverName,
      start_time: firstPt.recorded_at,
      end_time: lastPt.recorded_at,
      start_location: `${firstPt.lat.toFixed(4)}, ${firstPt.lng.toFixed(4)}`,
      end_location: `${lastPt.lat.toFixed(4)}, ${lastPt.lng.toFixed(4)}`,
      start_lat: firstPt.lat,
      start_lng: firstPt.lng,
      end_lat: lastPt.lat,
      end_lng: lastPt.lng,
      metrics,
      points: jPoints,
      segments,
      isManualTrip: false,
      status: isCompleted ? "Completed" : isMovingNow ? "Ongoing" : "Stationary",
    });
  }

  return derived;
}

// ── SYNCHRONIZED TIMELINE EVENTS GENERATION ──────────────────────────────────

export function generateJourneyTimelineEvents(
  points: GpsPoint[],
  journey?: DerivedJourney,
  overspeedThresholdKmh = 60
): TimelineEvent[] {
  if (!points || points.length === 0) return [];

  const events: TimelineEvent[] = [];

  // Departure Event
  events.push({
    id: "ev-start",
    type: "start",
    timestamp: points[0].recorded_at,
    title: "Trip Departure",
    description: `Vehicle departed at ${formatIstTime(points[0].recorded_at)}`,
    pointIndex: 0,
    lat: points[0].lat,
    lng: points[0].lng,
    source: points[0].source || "telemetry",
  });

  let stationaryStartIndex = -1;
  let inSpeeding = false;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];

    // Overspeed check
    if (p.speed > overspeedThresholdKmh) {
      if (!inSpeeding) {
        events.push({
          id: `ev-speed-${i}`,
          type: "speeding",
          timestamp: p.recorded_at,
          title: `Speeding Alert (${p.speed} km/h)`,
          description: `Exceeded ${overspeedThresholdKmh} km/h threshold by +${p.speed - overspeedThresholdKmh} km/h`,
          pointIndex: i,
          lat: p.lat,
          lng: p.lng,
          speed: p.speed,
          source: p.source,
        });
        inSpeeding = true;
      }
    } else {
      inSpeeding = false;
    }

    // Signal Gap check
    if (p.isGap) {
      events.push({
        id: `ev-gap-${i}`,
        type: "gap",
        timestamp: p.recorded_at,
        title: `GPS Signal Loss (${p.gapMinutes || 15}m Gap)`,
        description: `Signal resumed after ${p.gapMinutes || 15} min offline interval`,
        pointIndex: i,
        lat: p.lat,
        lng: p.lng,
        durationMins: p.gapMinutes || 15,
        source: p.source,
      });
    }

    // Stop detection (stationary >= 2 min)
    if (p.speed <= 3) {
      if (stationaryStartIndex === -1) {
        stationaryStartIndex = i;
      }
    } else {
      if (stationaryStartIndex !== -1) {
        const startMs = new Date(points[stationaryStartIndex].recorded_at).getTime();
        const endMs = new Date(p.recorded_at).getTime();
        const stopDurationMin = Math.round((endMs - startMs) / (60 * 1000));

        if (stopDurationMin >= 2) {
          events.push({
            id: `ev-stop-${stationaryStartIndex}`,
            type: "stop",
            timestamp: points[stationaryStartIndex].recorded_at,
            title: `Recorded Stop (${stopDurationMin}m)`,
            description: `Stationary from ${formatIstTime(points[stationaryStartIndex].recorded_at)} to ${formatIstTime(p.recorded_at)}`,
            pointIndex: stationaryStartIndex,
            lat: points[stationaryStartIndex].lat,
            lng: points[stationaryStartIndex].lng,
            durationMins: stopDurationMin,
            source: p.source,
          });

          events.push({
            id: `ev-resume-${i}`,
            type: "resumed",
            timestamp: p.recorded_at,
            title: "Movement Resumed",
            description: `Vehicle resumed movement at ${p.speed} km/h`,
            pointIndex: i,
            lat: p.lat,
            lng: p.lng,
            speed: p.speed,
            source: p.source,
          });
        }
        stationaryStartIndex = -1;
      }
    }
  }

  // Arrival Event (only if genuine trip end or completed status)
  const lastIndex = points.length - 1;
  const isTripEnded = journey ? journey.status === "Completed" : false;

  if (points.length > 1 && isTripEnded) {
    events.push({
      id: "ev-end",
      type: "end",
      timestamp: points[lastIndex].recorded_at,
      title: "Trip Arrival & Parking",
      description: `Engine shut down / journey ended at ${formatIstTime(points[lastIndex].recorded_at)}`,
      pointIndex: lastIndex,
      lat: points[lastIndex].lat,
      lng: points[lastIndex].lng,
      source: points[lastIndex].source,
    });
  }

  return events;
}
