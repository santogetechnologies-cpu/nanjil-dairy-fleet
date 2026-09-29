/**
 * useRealtimeVehicleTracking
 *
 * Streams live vehicle telemetry from Supabase Realtime.
 * This hook is the EMQX-era replacement for usePureFirebaseTracking.
 *
 * Data flow:
 *   IoT Device -> MQTT -> EMQX Cloud Rule Engine
 *     -> PostgreSQL Connector -> Supabase
 *     -> vehicle_telemetry (upserted by ingest_emqx_telemetry)
 *     -> Supabase Realtime (postgres_changes on vehicle_telemetry)
 *     -> this hook -> UI
 *
 * Design principles:
 * - Does NOT replace Firebase immediately; coexists during migration.
 * - Gracefully handles missing/stale telemetry.
 * - Derives VehicleStatus from speed/engine_on/ignition + stale check.
 * - Preserves the existing Vehicle interface exactly (no UI changes needed).
 * - Zero fake/hardcoded telemetry.
 * - Stale threshold configurable via VITE_TELEMETRY_STALE_THRESHOLD_SECONDS.
 */

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { type Vehicle, type VehicleStatus } from "@/lib/types";

// Telemetry source flag (set VITE_TELEMETRY_SOURCE=supabase to enable this hook)
// Default: "firebase" (keeps existing behaviour during migration period)
export const TELEMETRY_SOURCE = (import.meta.env.VITE_TELEMETRY_SOURCE as string) || "firebase";

// Stale threshold in seconds: telemetry older than this is treated as Offline
const STALE_THRESHOLD_SECS = parseInt(
  (import.meta.env.VITE_TELEMETRY_STALE_THRESHOLD_SECONDS as string) || "120",
  10,
);

/**
 * Derives VehicleStatus from live telemetry fields + staleness check.
 */
function deriveStatus(
  speed: number,
  engineOn: boolean,
  ignition: boolean,
  lastUpdate: Date | null,
): VehicleStatus {
  if (!lastUpdate) return "Offline";

  const ageMs = Date.now() - lastUpdate.getTime();
  if (ageMs > STALE_THRESHOLD_SECS * 1000) return "Offline";

  if (speed > 0) return "Moving";
  if (engineOn || ignition) return "Idle";
  return "Parked";
}

/**
 * Formats a UTC timestamp for display in India Standard Time.
 */
function formatLastUpdate(ts: string | null): string {
  if (!ts) return "No data";
  try {
    return new Date(ts).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return "No data";
  }
}

/**
 * Maps a v_vehicles row from Supabase to the Vehicle interface.
 */
function mapRowToVehicle(row: Record<string, unknown>): Vehicle {
  const lastUpdateStr = row.last_update as string | null;
  const lastUpdateDate = lastUpdateStr ? new Date(lastUpdateStr) : null;

  const speed = Number(row.speed ?? 0);
  const engineOn = Boolean(row.engine_on ?? false);
  const ignition = Boolean(row.ignition ?? false);
  const status = deriveStatus(speed, engineOn, ignition, lastUpdateDate);

  // Prefer live GPS odometer from telemetry if available
  const odometer = Number(row.live_odometer ?? row.odometer ?? 0);
  const engineHours = Number(row.live_engine_hours ?? row.engine_hours ?? 0);

  return {
    id: String(row.id ?? ""),
    number: String(row.number ?? ""),
    type: String(row.type ?? ""),
    model: String(row.model ?? ""),
    driver: String(row.driver_name ?? ""),
    driverId: String(row.driver_id ?? ""),
    status,
    location: String(row.location ?? ""),
    lat: Number(row.lat ?? 0),
    lng: Number(row.lng ?? 0),
    speed,
    fuel: Number(row.fuel ?? 0),
    temperature: Number(row.temperature ?? 0),
    humidity: Number(row.humidity ?? 0),
    engineOn,
    ignition,
    route: String(row.route ?? ""),
    insuranceExpiry: String(row.insurance_expiry ?? ""),
    lastService: String(row.last_service ?? ""),
    nextServiceKm: Number(row.next_service_km ?? 0),
    odometer,
    engineHours,
    lastUpdate: formatLastUpdate(lastUpdateStr),
    deviceId: String(row.device_id ?? ""),
  };
}

/**
 * Hook: streams ALL vehicles with live telemetry from Supabase Realtime.
 *
 * Equivalent to usePureFirebaseTracking but sourced from Supabase
 * after EMQX injects telemetry via the PostgreSQL connector.
 *
 * Usage:
 *   const vehicles = useRealtimeAllVehicles();
 */
export function useRealtimeAllVehicles(): Vehicle[] {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    async function load() {
      try {
        const { data, error } = await supabase.from("v_vehicles").select("*");
        if (error) {
          console.warn("[EMQX/Supabase] Error loading vehicles:", error.message);
          return;
        }
        if (data && isMountedRef.current) {
          setVehicles(data.map(mapRowToVehicle));
        }
      } catch (err) {
        console.warn("[EMQX/Supabase] Failed to load vehicles:", err);
      }
    }

    load();

    // Subscribe to vehicle_telemetry changes (EMQX upserts trigger these)
    const channel = supabase
      .channel("emqx-realtime-all-vehicles")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicle_telemetry" }, () => {
        if (isMountedRef.current) {
          console.log("[EMQX/Supabase] vehicle_telemetry changed — reloading");
          load();
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, () => {
        if (isMountedRef.current) load();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vehicle_assignments" },
        () => {
          if (isMountedRef.current) load();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("[EMQX/Supabase] Realtime channel subscribed — live tracking active");
        } else if (status === "CHANNEL_ERROR" || (status === "CLOSED" && isMountedRef.current)) {
          console.warn("[EMQX/Supabase] Realtime channel status:", status);
        }
      });

    return () => {
      isMountedRef.current = false;
      channel.unsubscribe();
    };
  }, []);

  return vehicles;
}

/**
 * Hook: streams a SINGLE vehicle's live telemetry from Supabase Realtime.
 *
 * Equivalent to useSingleVehicleFirebaseTracking but sourced from Supabase.
 *
 * Usage:
 *   const vehicle = useRealtimeSingleVehicle(initialVehicle);
 */
export function useRealtimeSingleVehicle(initialVehicle: Vehicle | null): Vehicle | null {
  const [vehicle, setVehicle] = useState<Vehicle | null>(initialVehicle);
  const isMountedRef = useRef(true);

  useEffect(() => {
    setVehicle(initialVehicle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVehicle?.id]);

  useEffect(() => {
    if (!initialVehicle?.id) return;
    isMountedRef.current = true;
    const vehicleId = initialVehicle.id;

    async function reload() {
      try {
        const { data, error } = await supabase
          .from("v_vehicles")
          .select("*")
          .eq("id", vehicleId)
          .maybeSingle();

        if (error) {
          console.warn("[EMQX/Supabase] Error reloading single vehicle:", error.message);
          return;
        }
        if (data && isMountedRef.current) {
          setVehicle(mapRowToVehicle(data as Record<string, unknown>));
        }
      } catch (err) {
        console.warn("[EMQX/Supabase] Failed to reload vehicle:", err);
      }
    }

    const channel = supabase
      .channel(`emqx-realtime-vehicle-${vehicleId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "vehicle_telemetry",
          filter: `vehicle_id=eq.${vehicleId}`,
        },
        () => {
          if (isMountedRef.current) {
            console.log(`[EMQX/Supabase] Telemetry update for vehicle ${vehicleId}`);
            reload();
          }
        },
      )
      .subscribe();

    return () => {
      isMountedRef.current = false;
      channel.unsubscribe();
    };
  }, [initialVehicle?.id]);

  return vehicle;
}

/**
 * Hook: enriches a list of existing vehicles with Supabase Realtime telemetry.
 *
 * Equivalent to useFirebaseTracking(initialVehicles) but sourced from Supabase.
 * Used as a drop-in replacement for the vehicles list page.
 */
export function useRealtimeVehicleList(initialVehicles: Vehicle[]): Vehicle[] {
  const [vehicles, setVehicles] = useState<Vehicle[]>(initialVehicles);
  const isMountedRef = useRef(true);

  useEffect(() => {
    setVehicles(initialVehicles);
  }, [initialVehicles]);

  useEffect(() => {
    isMountedRef.current = true;

    async function reload() {
      try {
        const { data, error } = await supabase.from("v_vehicles").select("*");
        if (error) {
          console.warn("[EMQX/Supabase] List reload error:", error.message);
          return;
        }
        if (data && isMountedRef.current) {
          setVehicles(data.map(mapRowToVehicle));
        }
      } catch (err) {
        console.warn("[EMQX/Supabase] List reload failed:", err);
      }
    }

    const channel = supabase
      .channel("emqx-realtime-vehicle-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicle_telemetry" }, () => {
        if (isMountedRef.current) reload();
      })
      .subscribe();

    return () => {
      isMountedRef.current = false;
      channel.unsubscribe();
    };
  }, []);

  return vehicles;
}
