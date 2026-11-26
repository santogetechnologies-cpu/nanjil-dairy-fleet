import type { VehicleOperationTripRecord } from "@/lib/driverOperationStatement";
import type { RouteAssignmentRecord, RouteSummaryInfo } from "@/lib/driverRouteAssignments";

export type DriverTabId = "home" | "trips" | "vehicle" | "profile";

export interface DriverProfileData {
  id: string | null;
  profile_id?: string | null;
  name: string;
  phone?: string | null;
  license?: string | null;
  employee_id?: string | null;
  status?: string | null;
  score: number;
  rating: string;
  trips: number;
  total_km: number;
  events: number;
}

export interface DriverAssignedVehicle {
  id: string | null;
  number: string;
  type: string;
  model: string;
  route: string;
  insuranceExpiry?: string;
  lastService?: string;
  nextServiceKm?: number;
  odometer: number;
  odometerSource?: string;
  odometerUpdatedAt?: string | null;
  engineHours?: number;
  status: string;
  location?: string;
  lat?: number;
  lng?: number;
  speed: number;
  fuel: number;
  temperature: number;
  humidity?: number;
  engineOn: boolean;
  ignition?: boolean;
  driver: string;
  driverId?: string | null;
  deviceId?: string;
  assignedAt?: string | null;
  lastUpdate: string;
}

export interface DriverAlertItem {
  id: string;
  severity: string;
  message: string;
  type: string;
  time: string;
  resolved: boolean;
}

export interface DriverAssignedWorkInfo {
  assignment: RouteAssignmentRecord | null;
  upcomingAssignment: RouteAssignmentRecord | null;
  routeSummary: RouteSummaryInfo | null;
}

export type RecentTripCardItem = VehicleOperationTripRecord;
