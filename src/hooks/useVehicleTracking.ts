/**
 * useVehicleTracking — unified telemetry source adapter
 *
 * Reads VITE_TELEMETRY_SOURCE from the environment and transparently
 * delegates to the correct underlying hook. All pages import from
 * this single adapter; no page needs to know which backend is active.
 *
 * Supported values of VITE_TELEMETRY_SOURCE:
 *   "firebase"  — (default) stream from Firebase Firestore ("vechile" collection)
 *   "supabase"  — stream from EMQX -> Supabase Realtime (vehicle_telemetry table)
 *
 * All three hook variants follow the same pattern:
 *   useVehicles()           — all vehicles, live
 *   useSingleVehicle(v)     — single vehicle, live
 *   useVehicleList(raw)     — enrich a pre-loaded list with live telemetry
 *
 * The exported constant TELEMETRY_LABEL provides a human-readable source
 * label suitable for display in the UI without hardcoding "Firebase".
 */

import type { Vehicle } from "@/lib/types";
import {
  usePureFirebaseTracking,
  useSingleVehicleFirebaseTracking,
  useFirebaseTracking,
} from "@/hooks/useFirebaseTracking";
import {
  useRealtimeAllVehicles,
  useRealtimeSingleVehicle,
  useRealtimeVehicleList,
} from "@/hooks/useRealtimeVehicleTracking";

// ── Source resolution ────────────────────────────────────────────────────────
// Read once at module load time. Changing the env var requires a full reload.
const RAW_SOURCE = (import.meta.env.VITE_TELEMETRY_SOURCE as string) || "firebase";

/** The active telemetry source: "firebase" | "supabase" */
export const TELEMETRY_SOURCE: "firebase" | "supabase" =
  RAW_SOURCE === "supabase" ? "supabase" : "firebase";

/**
 * Human-readable label for the active telemetry source.
 * Use this in subtitle badges and cards instead of hardcoding "Firebase".
 */
export const TELEMETRY_LABEL =
  TELEMETRY_SOURCE === "supabase" ? "EMQX / Supabase Realtime" : "Firebase Firestore";

// ── Hook: all vehicles (live stream) ────────────────────────────────────────

/**
 * Stream all fleet vehicles with live telemetry.
 * On "firebase" mode:  reads from Firebase Firestore "vechile" collection.
 * On "supabase" mode:  reads from Supabase vehicle_telemetry via EMQX ingestion.
 *
 * Drop-in replacement for usePureFirebaseTracking().
 */
export function useVehicles(): Vehicle[] {
  // Rules of Hooks: both hooks are always called. Only the result of the
  // active source is returned. This satisfies the "same hooks in same order"
  // requirement even when the source env var is toggled between builds.
  const firebase = usePureFirebaseTracking();
  const supabase = useRealtimeAllVehicles();
  return TELEMETRY_SOURCE === "supabase" ? supabase : firebase;
}

// ── Hook: single vehicle (live stream) ──────────────────────────────────────

/**
 * Stream a single vehicle with live telemetry.
 * On "firebase" mode:  enriches with Firebase Firestore telemetry by deviceId.
 * On "supabase" mode:  enriches with Supabase Realtime telemetry by vehicle_id.
 *
 * Drop-in replacement for useSingleVehicleFirebaseTracking(initialVehicle).
 */
export function useSingleVehicle(initialVehicle: Vehicle | null): Vehicle | null {
  const firebase = useSingleVehicleFirebaseTracking(initialVehicle);
  const supabase = useRealtimeSingleVehicle(initialVehicle);
  return TELEMETRY_SOURCE === "supabase" ? supabase : firebase;
}

// ── Hook: enrich a pre-loaded vehicle list (live stream) ─────────────────────

/**
 * Enrich a pre-loaded list of vehicles with live telemetry.
 * On "firebase" mode:  overlays Firebase Firestore telemetry fields.
 * On "supabase" mode:  overlays Supabase Realtime telemetry fields.
 *
 * Drop-in replacement for useFirebaseTracking(initialVehicles).
 */
export function useVehicleList(initialVehicles: Vehicle[]): Vehicle[] {
  const firebase = useFirebaseTracking(initialVehicles);
  const supabase = useRealtimeVehicleList(initialVehicles);
  return TELEMETRY_SOURCE === "supabase" ? supabase : firebase;
}
