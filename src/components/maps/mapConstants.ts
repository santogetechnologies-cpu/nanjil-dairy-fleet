import { NANJIL_DAIRY_DEPOT } from "@/lib/routeTemplates";
import type { Vehicle } from "@/lib/types";

export { NANJIL_DAIRY_DEPOT };

export const GOOGLE_MAPS_API_KEY =
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || "";

export const GOOGLE_MAPS_LIBRARIES: ("marker" | "geometry" | "places" | "routes")[] = [
  "marker",
  "geometry",
  "routes",
];

export const DEFAULT_MAP_CENTER = {
  lat: NANJIL_DAIRY_DEPOT.lat,
  lng: NANJIL_DAIRY_DEPOT.lng,
};

export const DEFAULT_MAP_ZOOM = 12;

// Map ID required for Google Maps AdvancedMarkerElement.
// If VITE_GOOGLE_MAPS_MAP_ID is not provided in .env, fallback to Google's official demo vector map ID.
export const GOOGLE_MAPS_MAP_ID =
  (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string) || "DEMO_MAP_ID";

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
