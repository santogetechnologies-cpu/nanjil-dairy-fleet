import type { Vehicle, VehicleStatus } from "@/lib/types";

export type TimeRange = "today" | "7d" | "30d" | "90d" | "all";

export type MaintenanceHealthStatus = "Good" | "Due Soon" | "Due" | "Overdue" | "Under Maintenance";

export interface VehicleSummaryMetrics {
  topSpeed: number | null;
  avgSpeed: number | null;
  avgMileage: number | null;
  maintenanceStatus: MaintenanceHealthStatus;
  maintenanceDueInDays?: number | null;
  lastServiceDate?: string | null;
  nextServiceDate?: string | null;
  totalTripsCount: number;
  totalMaintenanceCost: number;
}

export interface VehicleFiltersState {
  searchQuery: string;
  status: VehicleStatus | "All";
  vehicleType: string;
  driver: string;
  maintenanceStatus: MaintenanceHealthStatus | "All";
  sortBy: "number" | "topSpeed" | "avgSpeed" | "avgMileage" | "maintenance" | "lastUpdate" | "status";
  sortOrder: "asc" | "desc";
  viewMode: "grid" | "list";
}

export interface MaintenanceRecordItem {
  id: string;
  vehicle_id: string;
  service: string;
  due_in: string | null;
  due_date: string | null;
  status: "Upcoming" | "Overdue" | "Completed";
  cost: number;
  created_at?: string;
  updated_at?: string;
}

export interface HealthScoreResult {
  score: number | null;
  label: "Excellent" | "Good" | "Fair" | "Needs Attention" | "Data Insufficient";
  deductions: { reason: string; points: number }[];
}

export interface PerformanceTimeMetrics {
  topSpeed: number;
  avgSpeed: number | null;
  totalDistanceKm: number;
  totalDrivingHours: number;
  totalTrips: number;
  completedTrips: number;
  delayedTrips: number;
  avgTripDistanceKm: number;
  fuelConsumedLiters: number;
  fuelRefillCount: number;
  averageMileageKmpl: number | null;
  totalFuelCost: number;
  overspeedEventsCount: number;
  alertsCount: number;
  maintenanceRecordsCount: number;
}
