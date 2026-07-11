// TypeScript types and interfaces for the Nanjil Vehicle Intelligence Platform

export type VehicleStatus = "Moving" | "Idle" | "Parked" | "Offline";

export interface Vehicle {
  id: string;
  number: string;
  type: string;
  driver: string;
  driverId: string;
  status: VehicleStatus;
  location: string;
  lat: number;
  lng: number;
  speed: number;
  fuel: number;
  temperature: number;
  humidity: number;
  engineOn: boolean;
  ignition: boolean;
  route: string;
  model: string;
  insuranceExpiry: string;
  lastService: string;
  nextServiceKm: number;
  odometer: number;
  engineHours: number;
  lastUpdate: string;
}

export interface Driver {
  id: string;
  name: string;
  vehicle: string;
  phone: string;
  license: string;
  score: number;
  events: number;
  rating: "Excellent" | "Good" | "Average" | "Poor";
  trips: number;
  totalKm: number;
}

export interface AlertItem {
  id: string;
  type: "Fuel" | "Safety" | "Temperature" | "Vehicle" | "Maintenance";
  severity: "High" | "Medium" | "Low";
  vehicle: string;
  message: string;
  time: string;
  resolved: boolean;
}

export interface Trip {
  id: string;
  vehicle: string;
  driver: string;
  date: string;
  start: string;
  destination: string;
  distance: number;
  duration: string;
  status: "Completed" | "Ongoing" | "Delayed";
}

export interface CollectionRoute {
  id: string;
  name: string;
  vehicle: string;
  driver: string;
  centres: number;
  startTime: string;
  endTime: string;
  status: "On Time" | "Delayed" | "Completed" | "In Progress";
  litres: number;
  completion: number;
}

export interface MaintenanceRecord {
  id: string;
  vehicle: string;
  service: string;
  dueIn: string;
  dueDate: string;
  status: "Upcoming" | "Overdue" | "Completed";
  cost: number;
}
