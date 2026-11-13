import { NANJIL_DAIRY_DEPOT } from "../../lib/routeTemplates.ts";
import type { Vehicle } from "../../lib/types";

export { NANJIL_DAIRY_DEPOT };

export const GOOGLE_MAPS_API_KEY =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_GOOGLE_MAPS_API_KEY as string) || "";

export const GOOGLE_MAPS_LIBRARIES: ("marker" | "geometry" | "places")[] = [
  "marker",
  "geometry",
  "places",
];

export const DEFAULT_MAP_CENTER = {
  lat: NANJIL_DAIRY_DEPOT.lat,
  lng: NANJIL_DAIRY_DEPOT.lng,
};

export const DEFAULT_MAP_ZOOM = 12;

// Map ID required for Google Maps AdvancedMarkerElement.
// If VITE_GOOGLE_MAPS_MAP_ID is not provided in .env, fallback to Google's official demo vector map ID.
export const GOOGLE_MAPS_MAP_ID =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_GOOGLE_MAPS_MAP_ID as string) || "DEMO_MAP_ID";

/**
 * Rigorously validates coordinates before passing to Google Maps bounds, center, markers, or polylines.
 * - Latitude between -90 and 90, Longitude between -180 and 180.
 * - Rejects null, undefined, NaN, and non-finite numbers.
 * - Rejects (0, 0) Null Island and near-zero coordinates.
 * - Detects and rejects swapped lat/lng (e.g. lat > 50 && lng < 25 in South India).
 * - Enforces realistic bounds for Indian fleet operations (lat 5°-25° N, lng 65°-95° E).
 * - Ensures format is strictly { lat: number, lng: number }.
 */
export function isValidFleetCoord(
  coord?: { lat?: unknown; lng?: unknown } | null,
): coord is { lat: number; lng: number } {
  if (!coord || typeof coord !== "object") return false;
  if (coord.lat == null || coord.lng == null) return false;

  const lat = Number(coord.lat);
  const lng = Number(coord.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (isNaN(lat) || isNaN(lng)) return false;

  // Global geographic range validation
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;

  // Reject (0, 0) Null Island and close coordinates
  if (Math.abs(lat) < 0.001 && Math.abs(lng) < 0.001) return false;

  // Detect and reject swapped latitude & longitude
  // (In Southern India, lat is ~8-14, lng is ~76-80. If swapped: lat ~77, lng ~8)
  if (lat > 50 && lng < 25) return false;

  // Fleet operational geofence: reject points far outside India (e.g. 0.2° hardware corruption)
  if (lng < 50 || lng > 105) return false;
  if (lat < 4 || lat > 38) return false;

  return true;
}

/**
 * Safely parses any coordinate representation into a verified { lat: number, lng: number } object.
 * Accepts:
 * - { lat, lng } or { latitude, longitude }
 * - GeoJSON coordinate array [lng, lat] (explicitly converted)
 * - String format "lat, lng"
 * Strictly rejects coordinates outside the Indian fleet operational geofence (e.g. Africa / Null Island).
 */
export function toFleetCoord(
  input: unknown,
): { lat: number; lng: number } | null {
  if (!input) return null;

  // 1. Array representation: [lng, lat] (GeoJSON standard) or [lat, lng]
  if (Array.isArray(input) && input.length >= 2) {
    const a = Number(input[0]);
    const b = Number(input[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

    // GeoJSON [lng, lat] where lng ~ 77, lat ~ 8
    if (a >= 50 && a <= 105 && b >= 4 && b <= 38) {
      return { lat: b, lng: a };
    }
    // [lat, lng] where lat ~ 8, lng ~ 77
    if (a >= 4 && a <= 38 && b >= 50 && b <= 105) {
      return { lat: a, lng: b };
    }
    return null;
  }

  // 2. String representation "lat, lng"
  if (typeof input === "string") {
    const parts = input.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      if (isValidFleetCoord({ lat: parts[0], lng: parts[1] })) {
        return { lat: parts[0], lng: parts[1] };
      }
    }
    return null;
  }

  // 3. Object representation: { lat, lng } or { latitude, longitude }
  if (typeof input === "object") {
    const obj = input as any;
    const rawLat = obj.lat ?? obj.latitude ?? obj.Lat ?? obj.Latitude;
    const rawLng = obj.lng ?? obj.longitude ?? obj.lon ?? obj.Lng ?? obj.Longitude;
    if (rawLat != null && rawLng != null) {
      const lat = Number(rawLat);
      const lng = Number(rawLng);
      if (isValidFleetCoord({ lat, lng })) {
        return { lat, lng };
      }
    }
  }

  return null;
}

/**
 * Returns brand colors for vehicle status badges and markers.
 * Moving: Green (#10B981)
 * Idle: Amber (#F59E0B)
 * Stopped: Red (#EF4444)
 * Offline / Unknown: Slate (#64748B)
 */
export function getVehicleStatusColor(status?: string | null): string {
  const s = (status || "").toLowerCase();
  if (s.includes("moving")) return "#10B981";
  if (s.includes("idle")) return "#F59E0B";
  if (s.includes("stop") || s.includes("inactive")) return "#EF4444";
  return "#64748B";
}

/**
 * Extracts and returns a clean, formatted vehicle registration number.
 */
export function getVehicleRegistrationNumber(vehicle?: Partial<Vehicle> | null): string {
  if (!vehicle) return "Vehicle";
  const anyV = vehicle as any;
  return (
    vehicle.number ||
    anyV.reg_no ||
    anyV.registration_number ||
    vehicle.id ||
    "Vehicle"
  );
}
