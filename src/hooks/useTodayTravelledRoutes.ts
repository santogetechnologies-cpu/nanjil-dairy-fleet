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

export { isFleetOperatingCoordinate };

export interface LatLngPoint {
  lat: number;
  lng: number;
  recorded_at?: string;
}

export type VehicleRouteSegments = LatLngPoint[][];
export type TodayRoutesMap = Record<string, VehicleRouteSegments>;

export function normalizeDeviceId(devId?: string | number | null): string | undefined {
  if (devId == null) return undefined;
  const s = String(devId).trim();
  if (!s) return undefined;
  return s.replace(/^device_/, "");
}

/**
 * Filter and segment time-series GPS points for today:
 * 1. Filter out coordinates outside the fleet operating geofence or with corrupted longitudes (e.g. Africa artifacts).
 * 2. Chronologically sort by timestamp.
 * 3. Reject teleport jumps (>200 km or implied speed >160 km/h).
 * 4. Filter consecutive stationary duplicate points (<2 meters apart).
 * 5. Break the polyline across signal gaps (>15 minutes) into separate segments.
 */
export function processRawGpsPoints(
  points: GpsPoint[],
  maxGapMinutes = 15,
): VehicleRouteSegments {
  if (!points || points.length === 0) return [];

  // Filter out any points that are not valid fleet operating coordinates
  // (eliminates hardware truncation glitches like West Africa / Gulf of Guinea)
  const validFleetPoints = points.filter(
    (pt) => pt && isFleetOperatingCoordinate(pt.lat, pt.lng),
  );
  if (validFleetPoints.length === 0) return [];

  // 1. Sort chronologically by actual GPS timestamp
  const sorted = [...validFleetPoints].sort((a, b) => {
    const tA = new Date(a.recorded_at).getTime();
    const tB = new Date(b.recorded_at).getTime();
    if (tA !== tB) return tA - tB;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  const segments: VehicleRouteSegments = [];
  let currentSegment: LatLngPoint[] = [];
  let prevValid: GpsPoint | null = null;

  for (const pt of sorted) {
    const lat = Number(pt.lat);
    const lng = Number(pt.lng);

    if (prevValid) {
      const distKm = haversineDistanceKm(prevValid.lat, prevValid.lng, lat, lng);
      const timeDiffSec = Math.max(
        0,
        (new Date(pt.recorded_at).getTime() - new Date(prevValid.recorded_at).getTime()) / 1000,
      );

      // Teleport rejection: discard impossible single-point GPS jumps
      if (distKm > 200) continue;
      if (timeDiffSec > 0 && distKm / (timeDiffSec / 3600) > 160) continue;

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

  return segments;
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

/**
 * useTodayTravelledRoutes — Hook to fetch and maintain today's actual GPS travelled route
 * for all vehicles in Live Tracking with real-time incremental extension.
 */
export function useTodayTravelledRoutes(vehicles: Vehicle[]) {
  const [routes, setRoutes] = useState<TodayRoutesMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Keep a ref to the latest routes state for real-time appends without re-fetching
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

            // Merge safely with any live points that arrived while fetch was in flight!
            const existingLivePoints = rawPointsMapRef.current.get(uuid) || [];
            const mergedPoints = mergeAndDeduplicatePoints(existingLivePoints, points);
            rawPointsMapRef.current.set(uuid, mergedPoints);

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
            }
          });

          routesRef.current = nextRoutes;
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
    isLoading,
    error,
  };
}
