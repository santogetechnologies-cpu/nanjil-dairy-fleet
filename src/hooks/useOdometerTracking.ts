/**
 * useOdometerTracking.ts — React Hook for Fleet Odometer & Distance Tracking
 *
 * Automatically manages live odometer accumulation, drift filtering,
 * today's distance, and trip distance for all vehicles in Live Tracking.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Vehicle } from "@/lib/types";
import {
  type VehicleOdometerState,
  initVehicleOdometerState,
  processOdometerTelemetry,
  loadLocalOdometerStates,
  saveLocalOdometerStates,
  persistVehicleOdometer,
  getTodayIstDateString,
  calculateTodayGpsDistance,
  calculateTodayAndTripDistances,
} from "@/lib/odometerTrackingEngine";
import { getIstDateRange, fetchPaginatedTelemetryHistory } from "@/lib/tripHistoryEngine";
import { KNOWN_NANJIL_DEVICE_MAP } from "@/lib/vehicle-stop-detection";

export function useOdometerTracking(vehicles: Vehicle[]) {
  const [odometerStates, setOdometerStates] = useState<Record<string, VehicleOdometerState>>({});
  const [isLoading, setIsLoading] = useState(true);

  const statesRef = useRef<Record<string, VehicleOdometerState>>({});
  statesRef.current = odometerStates;

  // Track debounced persistence timers per vehicle
  const syncTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Mapping from deviceId to vehicleId and vice versa
  const deviceToIdMapRef = useRef<Map<string, string>>(new Map());

  // Populate known mappings
  Object.entries(KNOWN_NANJIL_DEVICE_MAP).forEach(([devId, meta]) => {
    deviceToIdMapRef.current.set(devId, meta.id);
  });

  // Debounced persistence to avoid spamming the database on every second of movement
  const schedulePersist = useCallback((state: VehicleOdometerState) => {
    const existing = syncTimersRef.current.get(state.vehicleId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      persistVehicleOdometer(supabase, state);
      syncTimersRef.current.delete(state.vehicleId);
    }, 3000); // Debounce by 3 seconds

    syncTimersRef.current.set(state.vehicleId, timer);
  }, []);

  // 1. Initial State Hydration on Mount
  useEffect(() => {
    let isCancelled = false;

    async function initializeOdometer() {
      setIsLoading(true);
      const localMap = loadLocalOdometerStates();
      const currentIstDate = getTodayIstDateString();
      const nextMap: Record<string, VehicleOdometerState> = {
        ...statesRef.current,
        ...localMap,
      };

      // Initialize any missing vehicles
      vehicles.forEach((v) => {
        if (!nextMap[v.id]) {
          nextMap[v.id] = initVehicleOdometerState(v, 0, currentIstDate);
        } else {
          // Verify baseline odometer hasn't been increased in DB
          const currentBase = Math.max(0, Number(v.odometer || 0));
          if (currentBase > nextMap[v.id].baselineOdometerKm) {
            nextMap[v.id].baselineOdometerKm = currentBase;
            if (nextMap[v.id].totalOdometerKm < currentBase) {
              nextMap[v.id].totalOdometerKm = currentBase;
            }
          }
          // Reset daily distance if midnight passed
          if (nextMap[v.id].todayDate !== currentIstDate) {
            nextMap[v.id].todayDate = currentIstDate;
            nextMap[v.id].todayDistanceKm = 0;
          }
        }
      });

      // Query today's telemetry from Supabase for all GPS vehicles to ensure
      // today's distance and current trip distance reflect actual travelled kilometers from 00:00:00 IST
      try {
        const { startUtcIso, endUtcIso } = getIstDateRange("today");
        const targetUuids = vehicles
          .map((v) => v.id)
          .filter((id) => id && id.length > 10);

        if (targetUuids.length > 0) {
          await Promise.all(
            targetUuids.map(async (vId) => {
              try {
                const res = await fetchPaginatedTelemetryHistory(
                  supabase,
                  vId,
                  startUtcIso,
                  endUtcIso,
                  1000,
                );

                const rows = res.data || [];
                if (rows.length > 0 && !isCancelled) {
                  const { todayDistanceKm, currentTripDistanceKm, isCurrentTripActive } =
                    calculateTodayAndTripDistances(rows as any);

                  const existing = nextMap[vId];
                  if (existing) {
                    const maxToday = Math.max(existing.todayDistanceKm, todayDistanceKm);
                    existing.todayDistanceKm = maxToday;
                    existing.totalOdometerKm =
                      Math.round((existing.baselineOdometerKm + maxToday) * 100) / 100;
                    existing.currentTripDistanceKm = currentTripDistanceKm;
                    existing.isMoving = isCurrentTripActive;
                  }
                }
              } catch (err) {
                console.warn(`[OdometerHook] Error calculating today distance for ${vId}:`, err);
              }
            }),
          );
        }
      } catch (err) {
        console.warn("[OdometerHook] Error fetching today history:", err);
      }

      if (!isCancelled) {
        statesRef.current = nextMap;
        setOdometerStates(nextMap);
        saveLocalOdometerStates(nextMap);
        setIsLoading(false);
      }
    }

    if (vehicles.length > 0) {
      initializeOdometer();
    } else {
      setIsLoading(false);
    }

    return () => {
      isCancelled = true;
    };
  }, [vehicles.length]); // Re-run if vehicles count changes on initial load

  // Helper to ingest an incoming telemetry point for a vehicle
  const ingestTelemetryPoint = useCallback(
    (
      vehicleIdOrDeviceId: string,
      lat?: number | null,
      lng?: number | null,
      speed?: number | null,
      odometer?: number | null,
      recordedAt?: string | null,
      telemetryId?: string | number,
    ) => {
      const vId = deviceToIdMapRef.current.get(vehicleIdOrDeviceId) || vehicleIdOrDeviceId;
      let current = statesRef.current[vId];
      if (!current) {
        const matched = vehicles.find((v) => v.id === vId || v.deviceId === vehicleIdOrDeviceId);
        current = initVehicleOdometerState(matched || { id: vId });
      }

      const { updatedState, distanceAddedKm, isDuplicate } = processOdometerTelemetry(
        current,
        {
          id: telemetryId,
          vehicleId: vId,
          lat,
          lng,
          speed,
          odometer,
          recordedAt,
        },
      );

      if (isDuplicate) return;

      const nextMap = {
        ...statesRef.current,
        [vId]: updatedState,
      };

      statesRef.current = nextMap;
      setOdometerStates(nextMap);
      saveLocalOdometerStates(nextMap);

      if (distanceAddedKm > 0 || updatedState.isMoving !== current.isMoving) {
        schedulePersist(updatedState);
      }
    },
    [schedulePersist, vehicles],
  );

  // 2. Real-Time Extension: Process incoming vehicles stream
  useEffect(() => {
    if (vehicles.length === 0) return;

    vehicles.forEach((v) => {
      if (v.deviceId && v.id) {
        deviceToIdMapRef.current.set(v.deviceId, v.id);
      }

      ingestTelemetryPoint(
        v.id,
        v.lat,
        v.lng,
        v.speed,
        v.odometer,
        v.lastUpdate,
      );
    });
  }, [vehicles, ingestTelemetryPoint]);

  // 3. Real-Time Telemetry Subscriptions (vehicle_telemetry upserts & telemetry_history inserts)
  useEffect(() => {
    const { startUtcIso } = getIstDateRange("today");

    const channel = supabase
      .channel("tracking-odometer-stream")
      // Listen to live telemetry updates from EMQX ingestion
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vehicle_telemetry" },
        (payload) => {
          const row = payload.new as any;
          if (!row) return;
          const targetKey = row.vehicle_id || row.device_id;
          if (!targetKey) return;

          const recAt =
            row.recorded_at ||
            row.last_update ||
            (row.timestamp ? new Date(row.timestamp).toISOString() : new Date().toISOString());

          ingestTelemetryPoint(
            targetKey,
            row.lat != null ? Number(row.lat) : null,
            row.lng != null ? Number(row.lng) : null,
            row.speed != null ? Number(row.speed) : null,
            row.odometer != null ? Number(row.odometer) : null,
            recAt,
            row.id || `${targetKey}-${recAt}`,
          );
        },
      )
      // Also listen to historical inserts
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "telemetry_history" },
        (payload) => {
          const row = payload.new as any;
          if (!row || !row.vehicle_id) return;
          if (row.recorded_at && row.recorded_at < startUtcIso) return;

          ingestTelemetryPoint(
            row.vehicle_id,
            Number(row.lat),
            Number(row.lng),
            Number(row.speed || 0),
            row.odometer != null ? Number(row.odometer) : null,
            row.recorded_at,
            row.id,
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ingestTelemetryPoint]);

  // Safe lookup function
  const getVehicleOdometer = useCallback(
    (vehicleIdOrDeviceId?: string): VehicleOdometerState => {
      if (!vehicleIdOrDeviceId) {
        return initVehicleOdometerState({ id: "unknown" });
      }

      const vId = deviceToIdMapRef.current.get(vehicleIdOrDeviceId) || vehicleIdOrDeviceId;
      const found = odometerStates[vId];
      if (found) return found;

      // Try finding vehicle in vehicles list to initialize
      const match = vehicles.find((v) => v.id === vId || v.deviceId === vehicleIdOrDeviceId);
      if (match) {
        return initVehicleOdometerState(match);
      }

      return initVehicleOdometerState({ id: vId });
    },
    [odometerStates, vehicles],
  );

  return {
    odometerStates,
    getVehicleOdometer,
    isLoading,
  };
}

