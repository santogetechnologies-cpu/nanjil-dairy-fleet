import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase.ts";
import type { Vehicle } from "../lib/types.ts";
import { globalGpsSpeedTracker } from "../lib/gpsAverageSpeed.ts";
import {
  getIstDateRange,
  isValidGpsCoord,
  isValidUuid,
  haversineDistanceKm,
  isFleetOperatingCoordinate,
  fetchPaginatedTelemetryHistory,
  type GpsPoint,
} from "../lib/tripHistoryEngine.ts";
import { KNOWN_NANJIL_DEVICE_MAP } from "../lib/vehicle-stop-detection.ts";
import { NANJIL_DAIRY_DEPOT } from "../lib/routeTemplates.ts";
import { calculateRoadRoute } from "../lib/roadRouting.ts";

export { isFleetOperatingCoordinate, NANJIL_DAIRY_DEPOT };

export interface LatLngPoint {
  lat: number;
  lng: number;
  recorded_at?: string;
}

export type VehicleRouteSegments = LatLngPoint[][];
export type TodayRoutesMap = Record<string, VehicleRouteSegments>;

export interface VehicleRouteDiagnosticItem {
  registrationNumber: string;
  supabaseUuid: string;
  firebaseDocId: string;
  gpsDeviceId: string;
  currentCoords: string;
  todayTelemetryCount: number;
  validGpsCount: number;
  rejectedGpsCount: number;
  routeSegmentsCount: number;
  segmentsGte2Points: number;
  polylineRenderedStatus: string;
  reason: string;
}

export function normalizeDeviceId(devId?: string | number | null): string | undefined {
  if (devId == null) return undefined;
  const s = String(devId).trim();
  if (!s) return undefined;
  return s.replace(/^device_/, "");
}

/**
 * Diagnostic logger for all 7 Nanjil GPS fleet vehicles.
 * Generates an authoritative console report breaking down coordinates, segments, and rendering status.
 */
export function printFleetRouteDiagnostics(
  vehicles: Vehicle[],
  routesMap: TodayRoutesMap,
  rawPointsMap: Map<string, GpsPoint[]>,
): VehicleRouteDiagnosticItem[] {
  const diagList: VehicleRouteDiagnosticItem[] = [];

  Object.entries(KNOWN_NANJIL_DEVICE_MAP).forEach(([devId, meta]) => {
    const vMatch = (vehicles || []).find(
      (v) =>
        v.id === meta.id ||
        normalizeDeviceId(v.deviceId) === devId ||
        v.deviceId === devId ||
        v.deviceId === `device_${devId}`,
    );

    const points =
      rawPointsMap.get(meta.id) ||
      rawPointsMap.get(devId) ||
      rawPointsMap.get(`device_${devId}`) ||
      [];

    const segments =
      routesMap[meta.id] ||
      routesMap[devId] ||
      routesMap[`device_${devId}`] ||
      [];

    const segsGte2 = segments.filter((s) => s && s.length >= 2);
    const renderedPts = segsGte2.reduce((acc, s) => acc + s.length, 0);

    const validCount = points.filter((p) => isFleetOperatingCoordinate(p.lat, p.lng)).length;
    const rejectedCount = Math.max(0, points.length - validCount);

    const currLat = vMatch?.lat;
    const currLng = vMatch?.lng;
    const currentCoords =
      currLat != null && currLng != null && isValidGpsCoord(currLat, currLng)
        ? `${Number(currLat).toFixed(4)}, ${Number(currLng).toFixed(4)}`
        : "0.0000, 0.0000 (Idle)";

    const isRendered = segsGte2.length > 0;
    const polylineStatus = isRendered ? "Active / Rendered" : "Insufficient Data (< 2 points)";
    const reason = isRendered
      ? `${segsGte2.length} segment(s) (${renderedPts} points)`
      : points.length === 0
        ? "Stationary / No GPS transmission today"
        : "Fewer than 2 valid points";

    diagList.push({
      registrationNumber: meta.number,
      supabaseUuid: meta.id,
      firebaseDocId: devId,
      gpsDeviceId: devId,
      currentCoords,
      todayTelemetryCount: points.length,
      validGpsCount: validCount,
      rejectedGpsCount: rejectedCount,
      routeSegmentsCount: segments.length,
      segmentsGte2Points: segsGte2.length,
      polylineRenderedStatus: polylineStatus,
      reason,
    });
  });

  if (typeof window !== "undefined") {
    (window as any).__NANJIL_ROUTE_DIAGNOSTICS__ = diagList;
    if ((window as any).__DEBUG_FLEET_ROUTES__ && typeof console !== "undefined" && console.groupCollapsed) {
      console.groupCollapsed(
        "%c[Nanjil Fleet] 7-Vehicle Today GPS Route Diagnostics",
        "color: #0284c7; font-weight: bold; font-size: 11px;",
      );
      if (console.table) {
        console.table(diagList);
      }
      diagList.forEach((d) => {
        console.log(
          `[Vehicle Route] ${d.registrationNumber} (Device: ${d.gpsDeviceId}) | UUID: ${d.supabaseUuid} | Firebase Doc: ${d.firebaseDocId} | Coords: ${d.currentCoords} | Records: ${d.todayTelemetryCount} | Valid: ${d.validGpsCount} | Rejected: ${d.rejectedGpsCount} | Segments: ${d.routeSegmentsCount} (>=2 pts: ${d.segmentsGte2Points}) | Status: ${d.polylineRenderedStatus} | Reason: ${d.reason}`,
        );
      });
      console.groupEnd();
    }
  }

  return diagList;
}

/**
 * Anchors GPS route points to Nanjil Dairy Plant as the base location.
 * Every registered vehicle's travelled route originates from Nanjil Central Processing Plant (Mulagumoodu).
 * If the vehicle has valid points, prepends the plant origin point so the route starts at the plant.
 */
export function anchorPointsToNanjilPlant(points: GpsPoint[]): GpsPoint[] {
  if (!points || points.length === 0) return [];

  const valid = points.filter((p) => p && isFleetOperatingCoordinate(p.lat, p.lng));
  if (valid.length === 0) return [];

  const sorted = [...valid].sort((a, b) => {
    const tA = new Date(a.recorded_at).getTime();
    const tB = new Date(b.recorded_at).getTime();
    return tA - tB;
  });

  const firstPt = sorted[0];
  const distFromPlantKm = haversineDistanceKm(
    NANJIL_DAIRY_DEPOT.lat,
    NANJIL_DAIRY_DEPOT.lng,
    firstPt.lat,
    firstPt.lng,
  );

  // If already at depot (within 50 meters), keep sorted points
  if (distFromPlantKm < 0.05) {
    return sorted;
  }

  // Estimate realistic departure time from plant based on driving distance (~45 km/h)
  const firstTime = new Date(firstPt.recorded_at).getTime();
  const driveMinutes = Math.max(1, Math.round((distFromPlantKm / 45) * 60));
  const departureIso = new Date(firstTime - driveMinutes * 60 * 1000).toISOString();

  // Prepend Nanjil Dairy Plant as authoritative origin point
  const plantOriginPoint: GpsPoint = {
    id: `00000000-plant-origin-${firstPt.id || "0"}`,
    lat: NANJIL_DAIRY_DEPOT.lat,
    lng: NANJIL_DAIRY_DEPOT.lng,
    speed: 0,
    ignition: true,
    recorded_at: departureIso,
  };

  return [plantOriginPoint, ...sorted];
}

/**
 * In-memory cache for computed road-following plant connectors.
 * Avoids redundant network round-trips for identical start coordinates.
 */
const plantConnectorCache = new Map<string, LatLngPoint[]>();

/**
 * Computes an estimated road connector between Nanjil Dairy Plant and the vehicle's earliest GPS location.
 * If the vehicle's first GPS record is already within 150m of the plant, no connector is needed.
 * If the first GPS record is far away, an estimated road connector is generated separately (dashed line).
 * Under NO circumstances is this connector included in actual travelled distance or odometer!
 */
export async function buildPlantConnector(
  firstPoint?: { lat: number; lng: number } | null,
): Promise<LatLngPoint[] | null> {
  if (!firstPoint || !isFleetOperatingCoordinate(firstPoint.lat, firstPoint.lng)) {
    return null;
  }

  const distKm = haversineDistanceKm(
    NANJIL_DAIRY_DEPOT.lat,
    NANJIL_DAIRY_DEPOT.lng,
    firstPoint.lat,
    firstPoint.lng,
  );

  // If vehicle already started at the plant (<150 meters), no connector is needed!
  if (distKm < 0.15) {
    return null;
  }

  const cacheKey = `${firstPoint.lat.toFixed(4)}_${firstPoint.lng.toFixed(4)}`;
  if (plantConnectorCache.has(cacheKey)) {
    return plantConnectorCache.get(cacheKey)!;
  }

  // Calculate road-following route from Nanjil Dairy Depot to vehicle first GPS point
  try {
    const roadRes = await calculateRoadRoute([
      NANJIL_DAIRY_DEPOT,
      { lat: firstPoint.lat, lng: firstPoint.lng },
    ]);

    if (roadRes.coordinates && roadRes.coordinates.length >= 2) {
      const roadPts: LatLngPoint[] = roadRes.coordinates.map(([lng, lat]) => ({ lat, lng }));
      plantConnectorCache.set(cacheKey, roadPts);
      return roadPts;
    }
  } catch (err) {
    // Graceful fallback on network/API failure
  }

  const fallback: LatLngPoint[] = [
    { lat: NANJIL_DAIRY_DEPOT.lat, lng: NANJIL_DAIRY_DEPOT.lng },
    { lat: firstPoint.lat, lng: firstPoint.lng },
  ];
  plantConnectorCache.set(cacheKey, fallback);
  return fallback;
}

/**
 * Filter isolated GPS spikes, multipath glitches, and teleports:
 * - Discards coordinates outside the fleet operating geofence
 * - Rejects single-ping teleport spikes (implied speed > 85 km/h for > 100m)
 * - Rejects V-spikes (jumping away > 80m and jumping back to original area within next point)
 */
export function filterGpsSpikesAndNoise(points: GpsPoint[]): GpsPoint[] {
  if (!points || points.length === 0) return [];
  const valid = points.filter((p) => p && isFleetOperatingCoordinate(p.lat, p.lng));
  if (valid.length < 3) return valid;

  const filtered: GpsPoint[] = [];

  for (let i = 0; i < valid.length; i++) {
    const cur = valid[i];
    const prev = filtered.length > 0 ? filtered[filtered.length - 1] : null;
    const next = i < valid.length - 1 ? valid[i + 1] : null;

    if (prev && next) {
      const dPrev = haversineDistanceKm(prev.lat, prev.lng, cur.lat, cur.lng);
      const dNext = haversineDistanceKm(cur.lat, cur.lng, next.lat, next.lng);
      const dDirect = haversineDistanceKm(prev.lat, prev.lng, next.lat, next.lng);
      const tPrev = Math.max(0.1, (new Date(cur.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / 1000);
      const speedPrev = dPrev / (tPrev / 3600);

      // V-spike: jump out >80m and jump back to within 40m of previous point
      if (dPrev > 0.08 && dNext > 0.08 && dDirect < 0.04) {
        continue;
      }

      // Implied speed > 85 km/h for significant distance jump (>100m)
      if (speedPrev > 85 && dPrev > 0.1) {
        continue;
      }
    } else if (prev && !next) {
      const dPrev = haversineDistanceKm(prev.lat, prev.lng, cur.lat, cur.lng);
      const tPrev = Math.max(0.1, (new Date(cur.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / 1000);
      const speedPrev = dPrev / (tPrev / 3600);
      if (speedPrev > 85 && dPrev > 0.1) {
        continue;
      }
    }

    filtered.push(cur);
  }

  return filtered;
}

/**
 * Filter and segment time-series GPS points for today:
 * 1. Filter out coordinates outside the fleet operating geofence or with corrupted longitudes.
 * 2. Chronologically sort by timestamp.
 * 3. Filter out isolated spikes, multipath glitches, and teleport jumps.
 * 4. Filter consecutive stationary duplicate points (<2 meters apart).
 * 5. Break the polyline across signal gaps (>15 minutes).
 * 6. Exclude stationary yard jitter (<50 meters net movement for multi-point segments).
 *
 * NOTE: Never inserts artificial coordinates into authentic GPS history!
 */
export function processRawGpsPoints(
  points: GpsPoint[],
  maxGapMinutes = 15,
  _deprecatedAnchor = false,
): VehicleRouteSegments {
  if (!points || points.length === 0) return [];

  // Filter out any points that are not valid fleet operating coordinates
  // (eliminates hardware truncation glitches like West Africa / Gulf of Guinea)
  const validFleetPoints = points.filter(
    (pt) => pt && isFleetOperatingCoordinate(pt.lat, pt.lng),
  );
  if (validFleetPoints.length === 0) return [];

  // 1. Sort chronologically by actual GPS timestamp first
  const sorted = [...validFleetPoints].sort((a, b) => {
    const tA = new Date(a.recorded_at).getTime();
    const tB = new Date(b.recorded_at).getTime();
    if (tA !== tB) return tA - tB;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  // 2. Filter isolated spikes and multipath glitches on chronologically ordered points
  const cleanPoints = filterGpsSpikesAndNoise(sorted);
  if (cleanPoints.length === 0) return [];

  const segments: VehicleRouteSegments = [];
  let currentSegment: LatLngPoint[] = [];
  let prevValid: GpsPoint | null = null;

  for (const pt of cleanPoints) {
    const lat = Number(pt.lat);
    const lng = Number(pt.lng);

    if (prevValid) {
      const distKm = haversineDistanceKm(prevValid.lat, prevValid.lng, lat, lng);
      const timeDiffSec = Math.max(
        0,
        (new Date(pt.recorded_at).getTime() - new Date(prevValid.recorded_at).getTime()) / 1000,
      );

      // Teleport rejection: discard impossible single-point GPS jumps (>200 km or speed >85 km/h for >100m)
      if (distKm > 200) continue;
      if (timeDiffSec > 0 && distKm / (timeDiffSec / 3600) > 85 && distKm > 0.1) continue;

      // Duplicate stationary filter: omit consecutive points within 2 meters
      if (distKm < 0.002) continue;

      // Signal gap splitting: if gap > 15 minutes, break into separate segment
      if (timeDiffSec > maxGapMinutes * 60) {
        if (currentSegment.length > 0) {
          segments.push(currentSegment);
        }
        currentSegment = [{ lat, lng, recorded_at: pt.recorded_at }];
        prevValid = pt;
        continue;
      }
    }

    currentSegment.push({ lat, lng, recorded_at: pt.recorded_at });
    prevValid = pt;
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  // Filter out stationary segments (yard jitter where multi-point segment bounding box < 50 meters)
  return segments.filter((seg) => {
    if (seg.length <= 1) return true; // keep single points for diagnostic or test assertion
    let minLat = Infinity,
      maxLat = -Infinity,
      minLng = Infinity,
      maxLng = -Infinity;
    for (const p of seg) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
    const spanKm = haversineDistanceKm(minLat, minLng, maxLat, maxLng);
    return spanKm >= 0.05; // requires at least 50m of actual net movement
  });
}

/**
 * Safely merges historical GPS points with incoming or live GPS points:
 * 1. Deduplicates points by ID (when present) or timestamp + coordinate key.
 * 2. Filters coordinates strictly to the fleet operating geofence (rejects Africa glitches).
 * 3. Sorts chronologically ascending by GPS timestamp.
 * 4. Preserves both historical and live updates without race conditions.
 */
export function mergeAndDeduplicatePoints(
  existingPoints: GpsPoint[],
  incomingPoints: GpsPoint[],
): GpsPoint[] {
  const seenIds = new Set<string>();
  const seenTimeCoords = new Set<string>();
  const combined: GpsPoint[] = [];

  const addPoint = (p: GpsPoint) => {
    if (!p) return;
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!isFleetOperatingCoordinate(lat, lng)) return;

    if (p.id != null && String(p.id).trim() !== "") {
      const idStr = String(p.id);
      if (seenIds.has(idStr)) return;
      seenIds.add(idStr);
    }

    const t = p.recorded_at ? new Date(p.recorded_at).getTime() : 0;
    const timeCoordKey = `${t}_${lat.toFixed(5)}_${lng.toFixed(5)}`;
    if (seenTimeCoords.has(timeCoordKey)) return;
    seenTimeCoords.add(timeCoordKey);

    combined.push({
      ...p,
      lat,
      lng,
      speed: Math.max(0, Math.round(Number(p.speed) || 0)),
      recorded_at: p.recorded_at || new Date().toISOString(),
    });
  };

  if (existingPoints && Array.isArray(existingPoints)) {
    for (const p of existingPoints) addPoint(p);
  }
  if (incomingPoints && Array.isArray(incomingPoints)) {
    for (const p of incomingPoints) addPoint(p);
  }

  combined.sort((a, b) => {
    const tA = a.recorded_at ? new Date(a.recorded_at).getTime() : 0;
    const tB = b.recorded_at ? new Date(b.recorded_at).getTime() : 0;
    if (tA !== tB) return tA - tB;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  return combined;
}

export interface UseTodayTravelledRoutesReturn {
  routes: TodayRoutesMap;
  plantConnectors: TodayRoutesMap;
  tripStartTimes: Record<string, string>;
  routeDistances: Record<string, number>;
  isLoading: boolean;
  error: string | null;
}

/**
 * useTodayTravelledRoutes — Hook to fetch and maintain today's actual GPS travelled route
 * for all vehicles in Live Tracking with real-time incremental extension.
 * Keeps Nanjil Dairy Plant as the base location marker, with optional road connector.
 */
export function useTodayTravelledRoutes(vehicles: Vehicle[]): UseTodayTravelledRoutesReturn {
  const [routes, setRoutes] = useState<TodayRoutesMap>({});
  const [plantConnectors, setPlantConnectors] = useState<TodayRoutesMap>({});
  const [tripStartTimes, setTripStartTimes] = useState<Record<string, string>>({});
  const [routeDistances, setRouteDistances] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Keep a ref to the latest vehicles and routes state for real-time appends without re-fetching
  const vehiclesRef = useRef<Vehicle[]>(vehicles);
  vehiclesRef.current = vehicles;

  const routesRef = useRef<TodayRoutesMap>({});
  routesRef.current = routes;

  // Active abort controller for cancelling fetch on unmount
  const abortRef = useRef<AbortController | null>(null);

  // Raw deduplicated points per vehicle (keyed by canonical vehicle identifier/UUID)
  const rawPointsMapRef = useRef<Map<string, GpsPoint[]>>(new Map());

  // Track UUIDs that have already been fetched or are currently in-flight
  const fetchedUuidsRef = useRef<Set<string>>(new Set());
  const inFlightUuidsRef = useRef<Set<string>>(new Set());

  // Cache of vehicle UUID to device ID and vice versa
  const deviceToUuidMapRef = useRef<Map<string, string>>(new Map());
  const uuidToDeviceMapRef = useRef<Map<string, string>>(new Map());

  // Helper to register an alias
  const registerMapping = useCallback((uuid?: string | null, deviceId?: string | number | null) => {
    if (!uuid || !deviceId) return;
    const cleanDev = normalizeDeviceId(deviceId);
    if (!cleanDev) return;
    deviceToUuidMapRef.current.set(cleanDev, uuid);
    deviceToUuidMapRef.current.set(`device_${cleanDev}`, uuid);
    uuidToDeviceMapRef.current.set(uuid, cleanDev);
  }, []);

  // Populate known mappings
  useEffect(() => {
    Object.entries(KNOWN_NANJIL_DEVICE_MAP).forEach(([devId, meta]) => {
      registerMapping(meta.id, devId);
    });
  }, [registerMapping]);

  // Helper to append a new live coordinate to a vehicle's route
  const appendCoordinateToVehicle = useCallback(
    (
      vehicleIdentifier: string,
      lat: number,
      lng: number,
      recordedAt?: string,
      telemetryId?: string | number,
    ) => {
      // Validate that coordinate belongs to valid fleet operating geofence
      // (rejects corrupted hardware packet truncation artifacts like Africa coordinates)
      if (!isFleetOperatingCoordinate(lat, lng)) return;

      const cleanId = normalizeDeviceId(vehicleIdentifier) || vehicleIdentifier;
      const uuid =
        deviceToUuidMapRef.current.get(cleanId) ||
        deviceToUuidMapRef.current.get(vehicleIdentifier) ||
        (isValidUuid(vehicleIdentifier) ? vehicleIdentifier : null);
      const devId =
        uuidToDeviceMapRef.current.get(vehicleIdentifier) ||
        (!isValidUuid(vehicleIdentifier) ? cleanId : null);

      const targetKey = uuid || cleanId || vehicleIdentifier;
      const timestamp = recordedAt || new Date().toISOString();
      const currTime = new Date(timestamp).getTime();

      const existingPoints = rawPointsMapRef.current.get(targetKey) || [];

      if (existingPoints.length > 0) {
        const lastPt = existingPoints[existingPoints.length - 1];
        const lastTime = lastPt.recorded_at ? new Date(lastPt.recorded_at).getTime() : Date.now();
        const timeDiffSec = Math.max(0, (currTime - lastTime) / 1000);
        const distKm = haversineDistanceKm(lastPt.lat, lastPt.lng, lat, lng);

        // Teleport jump rejection: discard impossible single-point GPS jumps (>200 km or speed >160 km/h)
        if (distKm > 200) return;
        if (timeDiffSec > 0 && distKm / (timeDiffSec / 3600) > 160) return;

        // Stationary duplicate filter: omit points within 2 meters or exact same timestamp
        if (distKm < 0.002 || (timeDiffSec === 0 && distKm < 0.005)) return;

        // Only append if vehicle moved at least 5 meters
        if (distKm < 0.005) return;

        const impliedSpeed = timeDiffSec > 0 ? distKm / (timeDiffSec / 3600) : 0;
        globalGpsSpeedTracker.updateGpsPoint(targetKey, lat, lng, impliedSpeed, currTime);
        if (devId) globalGpsSpeedTracker.registerAlias(targetKey, devId);
      }

      const newPoint: GpsPoint = {
        id: telemetryId ? String(telemetryId) : `${currTime}`,
        lat: Number(lat),
        lng: Number(lng),
        speed: 10,
        ignition: true,
        recorded_at: timestamp,
      };

      existingPoints.push(newPoint);
      rawPointsMapRef.current.set(targetKey, existingPoints);

      const updatedSegments = processRawGpsPoints(existingPoints, 15);

      let distKm = 0;
      updatedSegments.forEach((seg) => {
        for (let i = 0; i < seg.length - 1; i++) {
          distKm += haversineDistanceKm(seg[i].lat, seg[i].lng, seg[i + 1].lat, seg[i + 1].lng);
        }
      });
      const roundedDist = Math.round(distKm * 10) / 10;

      // Check if plant connector should be computed (only if first point is far from plant)
      if (existingPoints.length > 0) {
        const firstPt = existingPoints[0];
        const distFromPlantKm = haversineDistanceKm(
          NANJIL_DAIRY_DEPOT.lat,
          NANJIL_DAIRY_DEPOT.lng,
          firstPt.lat,
          firstPt.lng,
        );
        if (distFromPlantKm >= 0.15) {
          buildPlantConnector(firstPt).then((conn) => {
            if (conn && conn.length >= 2) {
              setPlantConnectors((prev) => ({
                ...prev,
                [targetKey]: [conn],
                ...(uuid ? { [uuid]: [conn] } : {}),
                ...(devId ? { [devId]: [conn], [`device_${devId}`]: [conn] } : {}),
              }));
            }
          });
        }
      }

      setRouteDistances((prev) => ({
        ...prev,
        [targetKey]: roundedDist,
        ...(uuid ? { [uuid]: roundedDist } : {}),
        ...(devId ? { [devId]: roundedDist, [`device_${devId}`]: roundedDist } : {}),
      }));

      setTripStartTimes((prev) => {
        if (!prev[targetKey] && existingPoints.length > 0) {
          const startT = existingPoints[0].recorded_at || timestamp;
          return {
            ...prev,
            [targetKey]: startT,
            ...(uuid ? { [uuid]: startT } : {}),
            ...(devId ? { [devId]: startT, [`device_${devId}`]: startT } : {}),
          };
        }
        return prev;
      });

      setRoutes((currentRoutes) => {
        const nextMap: TodayRoutesMap = {
          ...currentRoutes,
          [targetKey]: updatedSegments,
        };
        if (uuid && uuid !== targetKey) {
          nextMap[uuid] = updatedSegments;
        }
        if (devId && devId !== targetKey) {
          nextMap[devId] = updatedSegments;
          nextMap[`device_${devId}`] = updatedSegments;
        }
        routesRef.current = nextMap;
        return nextMap;
      });
    },
    [],
  );

  // Helper to load historical points for a set of vehicle UUIDs
  const loadHistoryForUuids = useCallback(
    async (uuids: string[], signal?: AbortSignal) => {
      const { startUtcIso, endUtcIso } = getIstDateRange("today");

      const toFetch = uuids.filter(
        (u) => isValidUuid(u) && !fetchedUuidsRef.current.has(u) && !inFlightUuidsRef.current.has(u),
      );

      if (toFetch.length === 0) return;

      toFetch.forEach((u) => inFlightUuidsRef.current.add(u));

      try {
        const fetchResults = await Promise.all(
          toFetch.map(async (uuid) => {
            try {
              const res = await fetchPaginatedTelemetryHistory(
                supabase,
                uuid,
                startUtcIso,
                endUtcIso,
                1000,
                undefined,
                signal,
              );
              return { uuid, points: res.data || [] };
            } catch (err: any) {
              console.warn(`[TodayRoute] Error fetching history for vehicle ${uuid}:`, err);
              return { uuid, points: [] };
            }
          }),
        );

        if (signal?.aborted) return;

        // Mark as fetched and remove from inFlight
        toFetch.forEach((u) => {
          fetchedUuidsRef.current.add(u);
          inFlightUuidsRef.current.delete(u);
        });

        setRoutes((prevRoutes) => {
          const nextRoutes: TodayRoutesMap = { ...prevRoutes };

          fetchResults.forEach(({ uuid, points }) => {
            const devId = uuidToDeviceMapRef.current.get(uuid);

            // Merge safely with any live points that arrived while fetch was in flight across all alias keys
            const existingLivePoints = [
              ...(rawPointsMapRef.current.get(uuid) || []),
              ...(devId ? rawPointsMapRef.current.get(devId) || [] : []),
              ...(devId ? rawPointsMapRef.current.get(`device_${devId}`) || [] : []),
            ];
            const mergedPoints = mergeAndDeduplicatePoints(existingLivePoints, points);
            rawPointsMapRef.current.set(uuid, mergedPoints);
            if (devId) {
              rawPointsMapRef.current.set(devId, mergedPoints);
              rawPointsMapRef.current.set(`device_${devId}`, mergedPoints);
            }

            // Process authentic GPS telemetry without artificial depot prepending
            const segments = processRawGpsPoints(mergedPoints, 15);

            // Hydrate the authoritative GPS speed tracker with today's telemetry points
            if (mergedPoints.length >= 2) {
              globalGpsSpeedTracker.loadPoints(uuid, mergedPoints as any);
              if (devId) {
                globalGpsSpeedTracker.registerAlias(uuid, devId);
              }
            }

            nextRoutes[uuid] = segments;
            if (devId) {
              nextRoutes[devId] = segments;
              nextRoutes[`device_${devId}`] = segments;
            }

            // Check if estimated plant connector should be generated (only when first GPS ping is far from plant)
            if (mergedPoints.length > 0) {
              const firstPt = mergedPoints[0];
              const distFromPlantKm = haversineDistanceKm(
                NANJIL_DAIRY_DEPOT.lat,
                NANJIL_DAIRY_DEPOT.lng,
                firstPt.lat,
                firstPt.lng,
              );
              if (distFromPlantKm >= 0.15) {
                buildPlantConnector(firstPt).then((conn) => {
                  if (conn && conn.length >= 2) {
                    setPlantConnectors((prev) => ({
                      ...prev,
                      [uuid]: [conn],
                      ...(devId ? { [devId]: [conn], [`device_${devId}`]: [conn] } : {}),
                    }));
                  }
                });
              }
            }

            // Record earliest trip start time and total distance
            if (mergedPoints.length > 0 && mergedPoints[0].recorded_at) {
              const startT = mergedPoints[0].recorded_at;
              setTripStartTimes((prev) => ({
                ...prev,
                [uuid]: startT,
                ...(devId ? { [devId]: startT, [`device_${devId}`]: startT } : {}),
              }));
            }

            let distKm = 0;
            segments.forEach((seg) => {
              for (let i = 0; i < seg.length - 1; i++) {
                distKm += haversineDistanceKm(seg[i].lat, seg[i].lng, seg[i + 1].lat, seg[i + 1].lng);
              }
            });
            const roundedDist = Math.round(distKm * 10) / 10;
            setRouteDistances((prev) => ({
              ...prev,
              [uuid]: roundedDist,
              ...(devId ? { [devId]: roundedDist, [`device_${devId}`]: roundedDist } : {}),
            }));
          });

          routesRef.current = nextRoutes;
          printFleetRouteDiagnostics(vehiclesRef.current, nextRoutes, rawPointsMapRef.current);
          return nextRoutes;
        });
      } catch (err: any) {
        if (!signal?.aborted) {
          console.error("[TodayRoute] Failed to load today's route:", err);
          setError(err.message || "Failed to load today's routes");
        }
      } finally {
        toFetch.forEach((u) => inFlightUuidsRef.current.delete(u));
        setIsLoading(false);
      }
    },
    [],
  );

  // 1. Initial Discovery & Fetch on Mount
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setError(null);

    async function discoverAndLoadInitialRoutes() {
      try {
        const targetUuids = new Set<string>();

        // 1. Known device mappings
        Object.values(KNOWN_NANJIL_DEVICE_MAP).forEach((m) => {
          if (isValidUuid(m.id)) targetUuids.add(m.id);
        });

        // 2. Discover registered vehicles directly from database
        try {
          const { data: dbVehicles } = await supabase
            .from("vehicles")
            .select("id, device_id, number");

          if (dbVehicles && dbVehicles.length > 0) {
            dbVehicles.forEach((v) => {
              if (v.id && v.device_id) {
                registerMapping(v.id, v.device_id);
              }
              if (isValidUuid(v.id)) {
                targetUuids.add(v.id);
              }
            });
          }
        } catch (dbErr) {
          console.warn("[TodayRoute] Could not query vehicles table on mount:", dbErr);
        }

        // 3. Vehicles in initial prop
        vehicles.forEach((v) => {
          if (v.id && v.deviceId) {
            registerMapping(v.id, v.deviceId);
          }
          if (isValidUuid(v.id)) {
            targetUuids.add(v.id);
          }
        });

        await loadHistoryForUuids(Array.from(targetUuids), controller.signal);
      } catch (err: any) {
        if (!controller.signal.aborted) {
          console.error("[TodayRoute] Initial discovery failed:", err);
          setError(err.message || "Failed to discover routes");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    discoverAndLoadInitialRoutes();

    return () => {
      controller.abort();
    };
  }, [registerMapping, loadHistoryForUuids]);

  // 2. Dynamic Vehicle Resolution & Real-Time Extension when vehicles updates
  useEffect(() => {
    if (!vehicles || vehicles.length === 0) return;

    const targetUuids: string[] = [];

    vehicles.forEach((v) => {
      if (v.id && v.deviceId) {
        registerMapping(v.id, v.deviceId);
      }

      if (isValidUuid(v.id)) {
        targetUuids.push(v.id);
      } else if (v.deviceId) {
        const mapped = deviceToUuidMapRef.current.get(normalizeDeviceId(v.deviceId) || v.deviceId);
        if (mapped && isValidUuid(mapped)) {
          targetUuids.push(mapped);
        }
      }

      // Real-Time Extension: append coordinates as vehicles update in useVehicles()
      if (isFleetOperatingCoordinate(v.lat, v.lng)) {
        const key = v.id || v.deviceId;
        if (key) {
          appendCoordinateToVehicle(key, v.lat, v.lng, v.lastUpdate);
        }
      }
    });

    // Check if any vehicles were dynamically added or resolved after mount
    const unfetched = targetUuids.filter(
      (u) => !fetchedUuidsRef.current.has(u) && !inFlightUuidsRef.current.has(u),
    );
    if (unfetched.length > 0) {
      loadHistoryForUuids(unfetched);
    }
  }, [vehicles, registerMapping, appendCoordinateToVehicle, loadHistoryForUuids]);

  // 3. Real-Time Telemetry Subscriptions (vehicle_telemetry and telemetry_history)
  useEffect(() => {
    const { startUtcIso } = getIstDateRange("today");

    const channel = supabase
      .channel("tracking-today-route-live-stream")
      // Live EMQX telemetry updates
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vehicle_telemetry" },
        (payload) => {
          const row = payload.new as any;
          if (!row) return;
          const targetKey = row.vehicle_id || row.device_id;
          if (!targetKey) return;

          const lat = Number(row.lat);
          const lng = Number(row.lng);
          if (!isFleetOperatingCoordinate(lat, lng)) return;

          const recAt =
            row.recorded_at ||
            row.last_update ||
            (row.timestamp ? new Date(row.timestamp).toISOString() : new Date().toISOString());

          appendCoordinateToVehicle(targetKey, lat, lng, recAt, row.id);
        },
      )
      // Historical inserts into telemetry_history
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "telemetry_history" },
        (payload) => {
          const row = payload.new as any;
          if (!row || !row.vehicle_id) return;
          if (row.recorded_at && row.recorded_at < startUtcIso) return;

          const lat = Number(row.lat);
          const lng = Number(row.lng);
          if (!isFleetOperatingCoordinate(lat, lng)) return;

          appendCoordinateToVehicle(row.vehicle_id, lat, lng, row.recorded_at, row.id);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [appendCoordinateToVehicle]);

  return {
    routes,
    plantConnectors,
    tripStartTimes,
    routeDistances,
    isLoading,
    error,
  };
}
