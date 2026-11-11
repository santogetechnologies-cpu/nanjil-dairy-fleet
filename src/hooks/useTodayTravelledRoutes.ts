import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase.ts";
import type { Vehicle } from "../lib/types.ts";
import {
  getIstDateRange,
  isValidGpsCoord,
  isValidUuid,
  haversineDistanceKm,
  fetchPaginatedTelemetryHistory,
  type GpsPoint,
} from "../lib/tripHistoryEngine.ts";
import { KNOWN_NANJIL_DEVICE_MAP } from "../lib/vehicle-stop-detection.ts";

export interface LatLngPoint {
  lat: number;
  lng: number;
  recorded_at?: string;
}

export type VehicleRouteSegments = LatLngPoint[][];
export type TodayRoutesMap = Record<string, VehicleRouteSegments>;

/**
 * Filter and segment time-series GPS points for today:
 * 1. Chronologically sort by timestamp.
 * 2. Validate GPS coordinates.
 * 3. Reject teleport jumps (>200 km or implied speed >160 km/h).
 * 4. Filter consecutive stationary duplicate points (<2 meters apart).
 * 5. Break the polyline across signal gaps (>15 minutes) into separate segments.
 */
export function processRawGpsPoints(
  points: GpsPoint[],
  maxGapMinutes = 15,
): VehicleRouteSegments {
  if (!points || points.length === 0) return [];

  // 1. Sort chronologically by actual GPS timestamp
  const sorted = [...points].sort((a, b) => {
    const tA = new Date(a.recorded_at).getTime();
    const tB = new Date(b.recorded_at).getTime();
    if (tA !== tB) return tA - tB;
    return String(a.id).localeCompare(String(b.id));
  });

  const segments: VehicleRouteSegments = [];
  let currentSegment: LatLngPoint[] = [];
  let prevValid: GpsPoint | null = null;

  for (const pt of sorted) {
    const lat = Number(pt.lat);
    const lng = Number(pt.lng);
    if (!isValidGpsCoord(lat, lng)) continue;

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

  // Cache of vehicle UUID to device ID and vice versa
  const deviceToUuidMapRef = useRef<Map<string, string>>(new Map());
  const uuidToDeviceMapRef = useRef<Map<string, string>>(new Map());

  // Populate known mappings
  Object.entries(KNOWN_NANJIL_DEVICE_MAP).forEach(([devId, meta]) => {
    deviceToUuidMapRef.current.set(devId, meta.id);
    uuidToDeviceMapRef.current.set(meta.id, devId);
  });

  // Helper to append a new live coordinate to a vehicle's route
  const appendCoordinateToVehicle = useCallback(
    (vehicleIdentifier: string, lat: number, lng: number, recordedAt?: string) => {
      if (!isValidGpsCoord(lat, lng)) return;

      const currentRoutes = routesRef.current;
      const uuid =
        deviceToUuidMapRef.current.get(vehicleIdentifier) ||
        (isValidUuid(vehicleIdentifier) ? vehicleIdentifier : null);
      const devId =
        uuidToDeviceMapRef.current.get(vehicleIdentifier) ||
        (!isValidUuid(vehicleIdentifier) ? vehicleIdentifier : null);

      const targetKey = uuid || vehicleIdentifier;
      const existingSegments = currentRoutes[targetKey] || [];
      const updatedSegments: VehicleRouteSegments = existingSegments.map((s) => [...s]);

      const timestamp = recordedAt || new Date().toISOString();

      if (updatedSegments.length === 0) {
        updatedSegments.push([{ lat, lng, recorded_at: timestamp }]);
      } else {
        const lastSeg = updatedSegments[updatedSegments.length - 1];
        if (lastSeg.length === 0) {
          lastSeg.push({ lat, lng, recorded_at: timestamp });
        } else {
          const lastPt = lastSeg[lastSeg.length - 1];
          const distKm = haversineDistanceKm(lastPt.lat, lastPt.lng, lat, lng);

          // Only append if vehicle moved at least 5 meters
          if (distKm >= 0.005) {
            const lastTime = lastPt.recorded_at ? new Date(lastPt.recorded_at).getTime() : Date.now();
            const currTime = new Date(timestamp).getTime();
            const diffMins = Math.max(0, (currTime - lastTime) / 60000);

            if (diffMins > 15) {
              // Signal gap: start a new segment
              updatedSegments.push([{ lat, lng, recorded_at: timestamp }]);
            } else {
              lastSeg.push({ lat, lng, recorded_at: timestamp });
            }
          } else {
            return; // No movement, no state update needed
          }
        }
      }

      // Update both keys so lookup succeeds by either UUID or device ID
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
      setRoutes(nextMap);
    },
    [],
  );

  // 1. Initial Fetch of Today's Route History on Mount
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setError(null);

    async function loadTodayRoutes() {
      try {
        const { startUtcIso, endUtcIso } = getIstDateRange("today");

        // Collect all target vehicle UUIDs (from vehicles list + known Nanjil GPS fleet)
        const targetUuids = new Set<string>();

        Object.values(KNOWN_NANJIL_DEVICE_MAP).forEach((m) => {
          if (isValidUuid(m.id)) targetUuids.add(m.id);
        });

        vehicles.forEach((v) => {
          if (isValidUuid(v.id)) targetUuids.add(v.id);
          if (v.deviceId && KNOWN_NANJIL_DEVICE_MAP[v.deviceId]) {
            targetUuids.add(KNOWN_NANJIL_DEVICE_MAP[v.deviceId].id);
          }
        });

        const uuidList = Array.from(targetUuids);
        if (uuidList.length === 0) {
          setIsLoading(false);
          return;
        }

        // Fetch today's telemetry for all target vehicles in parallel
        const fetchResults = await Promise.all(
          uuidList.map(async (uuid) => {
            try {
              const res = await fetchPaginatedTelemetryHistory(
                supabase,
                uuid,
                startUtcIso,
                endUtcIso,
                1000,
                undefined,
                controller.signal,
              );
              return { uuid, points: res.data || [] };
            } catch (err: any) {
              console.warn(`[TodayRoute] Error fetching history for vehicle ${uuid}:`, err);
              return { uuid, points: [] };
            }
          }),
        );

        if (controller.signal.aborted) return;

        const newRoutesMap: TodayRoutesMap = {};

        fetchResults.forEach(({ uuid, points }) => {
          const segments = processRawGpsPoints(points, 15);
          const devId = uuidToDeviceMapRef.current.get(uuid);

          // Find current live vehicle data if available to extend route to live location
          const liveMatch = vehicles.find(
            (v) => v.id === uuid || (devId && v.deviceId === devId),
          );

          if (
            liveMatch &&
            isValidGpsCoord(liveMatch.lat, liveMatch.lng) &&
            segments.length > 0
          ) {
            const lastSeg = segments[segments.length - 1];
            if (lastSeg.length > 0) {
              const lastPt = lastSeg[lastSeg.length - 1];
              const distKm = haversineDistanceKm(lastPt.lat, lastPt.lng, liveMatch.lat, liveMatch.lng);
              if (distKm >= 0.005) {
                lastSeg.push({
                  lat: liveMatch.lat,
                  lng: liveMatch.lng,
                  recorded_at: liveMatch.lastUpdate || new Date().toISOString(),
                });
              }
            }
          }

          newRoutesMap[uuid] = segments;
          if (devId) {
            newRoutesMap[devId] = segments;
          }
        });

        routesRef.current = newRoutesMap;
        setRoutes(newRoutesMap);
      } catch (err: any) {
        if (!controller.signal.aborted) {
          console.error("[TodayRoute] Failed to load today's route:", err);
          setError(err.message || "Failed to load today's routes");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    loadTodayRoutes();

    return () => {
      controller.abort();
    };
  }, []); // Run once on mount

  // 2. Real-Time Extension: append coordinates as vehicles update in useVehicles()
  useEffect(() => {
    if (vehicles.length === 0) return;

    vehicles.forEach((v) => {
      if (!isValidGpsCoord(v.lat, v.lng)) return;
      const key = v.id || v.deviceId;
      if (!key) return;

      // Update mapping caches
      if (v.id && v.deviceId) {
        deviceToUuidMapRef.current.set(v.deviceId, v.id);
        uuidToDeviceMapRef.current.set(v.id, v.deviceId);
      }

      appendCoordinateToVehicle(key, v.lat, v.lng, v.lastUpdate);
    });
  }, [vehicles, appendCoordinateToVehicle]);

  // 3. Real-Time Supabase INSERT Subscription on telemetry_history
  useEffect(() => {
    const { startUtcIso } = getIstDateRange("today");

    const channel = supabase
      .channel("tracking-today-route-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "telemetry_history" },
        (payload) => {
          const row = payload.new;
          if (!row || !row.vehicle_id) return;
          if (row.recorded_at && row.recorded_at < startUtcIso) return;

          const lat = Number(row.lat);
          const lng = Number(row.lng);
          if (!isValidGpsCoord(lat, lng)) return;

          appendCoordinateToVehicle(row.vehicle_id, lat, lng, row.recorded_at);
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
