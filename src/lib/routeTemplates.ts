import { type RoutePoint } from "./roadRouting.ts";

export interface ManualRouteEndpoint {
  name: string;
  lat: number;
  lng: number;
}

export interface RouteConfiguration {
  roundTripType: "same_path" | "different_path" | "one_way";
  revisitStopsOnReturn: boolean;
  startPoint: ManualRouteEndpoint | null;
  destinationPoint: ManualRouteEndpoint | null;
  outboundStops: RoutePoint[];
  returnStops: RoutePoint[];
  departureTime: string;
  speedLimitKmh: number;
  deviationThresholdMeters: number;
  routeNotes?: string;
  totalDistanceKm?: number;
  totalDurationMins?: number;
  createdManually?: boolean;
}

// Primary depot reference coordinate used only as initial Google Maps viewport center.
export const NANJIL_DAIRY_DEPOT = {
  name: "Nanjil Central Processing Plant, Mulagumoodu",
  lat: 8.260765,
  lng: 77.288373,
};

export function createEmptyRouteDraft(): {
  routeName: string;
  startPoint: ManualRouteEndpoint | null;
  destinationPoint: ManualRouteEndpoint | null;
  outboundStops: RoutePoint[];
  returnStops: RoutePoint[];
  roundTripType: "same_path" | "different_path" | "one_way";
  revisitStopsOnReturn: boolean;
  departureTime: string;
  speedLimitKmh: number;
  deviationThresholdMeters: number;
  routeNotes: string;
} {
  return {
    routeName: "",
    startPoint: null,
    destinationPoint: null,
    outboundStops: [],
    returnStops: [],
    roundTripType: "one_way",
    revisitStopsOnReturn: false,
    departureTime: "05:30",
    speedLimitKmh: 55,
    deviationThresholdMeters: 200,
    routeNotes: "",
  };
}

export function isValidRouteEndpoint(
  pt: any
): pt is ManualRouteEndpoint {
  return Boolean(
    pt &&
      typeof pt.name === "string" &&
      pt.name.trim().length > 0
  );
}

export function validateManualRouteConfig(input: {
  routeName: string;
  startPoint: ManualRouteEndpoint | null;
  destinationPoint: ManualRouteEndpoint | null;
  outboundStops: RoutePoint[];
  returnStops: RoutePoint[];
  roundTripType: "same_path" | "different_path" | "one_way";
}): { valid: boolean; error?: string } {
  if (!input.routeName || !input.routeName.trim()) {
    return { valid: false, error: "Route Name is required." };
  }
  if (!isValidRouteEndpoint(input.startPoint)) {
    return {
      valid: false,
      error: "Starting Location name is required.",
    };
  }
  if (!isValidRouteEndpoint(input.destinationPoint)) {
    return {
      valid: false,
      error: "Destination name is required.",
    };
  }
  if (!["one_way", "same_path", "different_path"].includes(input.roundTripType)) {
    return { valid: false, error: "Please choose a valid route type." };
  }
  if (!Array.isArray(input.outboundStops) || input.outboundStops.length === 0) {
    return {
      valid: false,
      error: "Please add at least one outbound collection stop to define the stop sequence.",
    };
  }
  for (let i = 0; i < input.outboundStops.length; i++) {
    const s = input.outboundStops[i];
    if (!s?.name?.trim()) {
      return {
        valid: false,
        error: `Outbound stop #${i + 1} requires a stop name.`,
      };
    }
  }
  if (input.roundTripType === "different_path") {
    for (let i = 0; i < input.returnStops.length; i++) {
      const s = input.returnStops[i];
      if (!s?.name?.trim()) {
        return {
          valid: false,
          error: `Return stop #${i + 1} requires a stop name.`,
        };
      }
    }
  }
  return { valid: true };
}
