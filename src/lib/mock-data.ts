// Realistic dummy data for Nanjil Vehicle Intelligence Platform

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

const driverNames = [
  "Raj Kumar", "Suresh Babu", "Murugan S", "Karthik R", "Vijay Anand",
  "Prakash M", "Saravanan K", "Ganesh P", "Arun Kumar", "Manikandan T",
  "Selvam R", "Balaji V", "Ramesh N", "Senthil M", "Dinesh K",
  "Vignesh S", "Kannan P", "Jayaraman R", "Rajesh K", "Kumaresan V",
  "Mohan Raj", "Anbu Selvan", "Velmurugan", "Sivakumar", "Naveen Kumar",
  "Praveen R", "Hari Krishna", "Srinivasan", "Pandian M", "Tamilselvan",
  "Bharath Raj", "Gokul Krishna", "Logesh M", "Mahesh K", "Nithin Raj",
  "Pradeep V", "Ravi Shankar", "Sanjay Kumar", "Thiruvel M", "Yuvaraj S",
];

const routes = [
  "Nagercoil - Marthandam", "Kanyakumari - Nagercoil", "Tirunelveli - Nanguneri",
  "Thuckalay - Kuzhithurai", "Colachel - Kanyakumari", "Marthandam - Parassala",
  "Vadasery - Suchindram", "Boothapandi - Eraniel", "Kollemcode - Kanyakumari",
  "Aralvaimozhi - Nagercoil", "Kuzhithurai - Marthandam", "Padmanabhapuram - Thuckalay",
];

const places = [
  "Nagercoil", "Marthandam", "Kanyakumari", "Tirunelveli", "Thuckalay",
  "Colachel", "Kuzhithurai", "Vadasery", "Suchindram", "Boothapandi",
  "Eraniel", "Aralvaimozhi", "Padmanabhapuram", "Parassala", "Nanguneri",
];

const vehicleTypes = ["Milk Tanker 5000L", "Milk Tanker 3000L", "Refrigerated Van", "Collection Pickup", "Distribution Truck"];
const models = ["Tata LPT 1109", "Ashok Leyland Boss", "Mahindra Furio", "Eicher Pro 3015", "BharatBenz 1217C"];

function rand(min: number, max: number) { return Math.random() * (max - min) + min; }
function randInt(min: number, max: number) { return Math.floor(rand(min, max + 1)); }
function pick<T>(arr: T[]): T { return arr[randInt(0, arr.length - 1)]; }

// Deterministic seed-ish using index
function seeded(i: number, salt: number) {
  const x = Math.sin(i * 9301 + salt * 49297) * 10000;
  return x - Math.floor(x);
}

const seriesPrefixes = ["TN-01", "TN-02", "TN-74", "TN-75", "TN-76"];

export const VEHICLES: Vehicle[] = Array.from({ length: 40 }, (_, i) => {
  const prefix = seriesPrefixes[i % seriesPrefixes.length];
  const num = `${prefix}-${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i * 3) % 26))}-${1000 + i * 37}`;
  const sRand = seeded(i, 1);
  const status: VehicleStatus =
    sRand < 0.7 ? "Moving" : sRand < 0.85 ? "Idle" : sRand < 0.97 ? "Parked" : "Offline";
  const driver = driverNames[i % driverNames.length];
  // Kanyakumari district approx: 8.0–8.4 lat, 77.3–77.6 lng
  const lat = 8.05 + seeded(i, 2) * 0.5;
  const lng = 77.3 + seeded(i, 3) * 0.45;
  const fuel = Math.round(15 + seeded(i, 4) * 80);
  const temp = +(2 + seeded(i, 5) * 6).toFixed(1);
  const speed = status === "Moving" ? Math.round(20 + seeded(i, 6) * 60) : 0;
  return {
    id: `V${String(i + 1).padStart(3, "0")}`,
    number: num,
    type: vehicleTypes[i % vehicleTypes.length],
    driver,
    driverId: `D${String((i % driverNames.length) + 1).padStart(3, "0")}`,
    status,
    location: places[i % places.length],
    lat, lng, speed,
    fuel,
    temperature: temp,
    humidity: Math.round(55 + seeded(i, 7) * 25),
    engineOn: status === "Moving" || status === "Idle",
    ignition: status !== "Offline",
    route: routes[i % routes.length],
    model: models[i % models.length],
    insuranceExpiry: `2026-${String(((i % 12) + 1)).padStart(2, "0")}-15`,
    lastService: `2026-${String((((i + 3) % 12) + 1)).padStart(2, "0")}-10`,
    nextServiceKm: Math.round(200 + seeded(i, 8) * 1800),
    odometer: 45000 + i * 1234,
    engineHours: 1200 + i * 47,
    lastUpdate: `${randInt(1, 30)} sec ago`,
  };
});

export const DRIVERS: Driver[] = driverNames.map((name, i) => {
  const v = VEHICLES[i % VEHICLES.length];
  const score = Math.round(70 + seeded(i, 9) * 28);
  const rating: Driver["rating"] = score >= 90 ? "Excellent" : score >= 80 ? "Good" : score >= 75 ? "Average" : "Poor";
  return {
    id: `D${String(i + 1).padStart(3, "0")}`,
    name,
    vehicle: v.number,
    phone: `+91 9${randInt(100000000, 999999999)}`,
    license: `TN${randInt(10, 99)}${randInt(2018, 2024)}${randInt(100000, 999999)}`,
    score,
    events: Math.round((100 - score) / 4),
    rating,
    trips: randInt(120, 380),
    totalKm: randInt(8000, 42000),
  };
});

const alertMessages: Record<AlertItem["type"], string[]> = {
  Fuel: ["Sudden fuel drop detected (12L)", "Fuel level critical (<15%)", "Possible fuel theft", "Refill detected"],
  Safety: ["Harsh braking detected", "Overspeed: 78 km/h in 60 zone", "Sharp turning event", "Sudden acceleration"],
  Temperature: ["Cold chain violation: 8.4°C", "Temperature exceeded 6°C for 12 min", "Sensor failure detected", "Humidity above threshold"],
  Vehicle: ["Engine warning light", "Battery voltage low", "Tyre pressure low (FL)", "GPS signal lost"],
  Maintenance: ["Service due in 500 km", "Insurance expires in 30 days", "Fitness certificate due", "Oil change overdue"],
};

export const ALERTS: AlertItem[] = Array.from({ length: 36 }, (_, i) => {
  const types: AlertItem["type"][] = ["Fuel", "Safety", "Temperature", "Vehicle", "Maintenance"];
  const type = types[i % types.length];
  const sev: AlertItem["severity"] = i % 5 === 0 ? "High" : i % 3 === 0 ? "Medium" : "Low";
  const v = VEHICLES[i % VEHICLES.length];
  return {
    id: `A${String(i + 1).padStart(4, "0")}`,
    type,
    severity: sev,
    vehicle: v.number,
    message: alertMessages[type][i % alertMessages[type].length],
    time: `${randInt(1, 11)}h ${randInt(1, 59)}m ago`,
    resolved: i % 7 === 0,
  };
});

export const TRIPS: Trip[] = Array.from({ length: 60 }, (_, i) => {
  const v = VEHICLES[i % VEHICLES.length];
  const startP = places[i % places.length];
  const endP = places[(i + 3) % places.length];
  const status: Trip["status"] = i % 9 === 0 ? "Delayed" : i % 11 === 0 ? "Ongoing" : "Completed";
  return {
    id: `T${String(i + 1).padStart(4, "0")}`,
    vehicle: v.number,
    driver: v.driver,
    date: `2026-06-${String(((i % 19) + 1)).padStart(2, "0")}`,
    start: startP,
    destination: endP,
    distance: randInt(28, 180),
    duration: `${randInt(1, 4)}h ${randInt(5, 55)}m`,
    status,
  };
});

export const COLLECTION_ROUTES: CollectionRoute[] = Array.from({ length: 18 }, (_, i) => {
  const v = VEHICLES[i % VEHICLES.length];
  const completion = randInt(20, 100);
  const status: CollectionRoute["status"] =
    completion === 100 ? "Completed" : i % 6 === 0 ? "Delayed" : i % 3 === 0 ? "On Time" : "In Progress";
  return {
    id: `R${String(i + 1).padStart(3, "0")}`,
    name: routes[i % routes.length] + " Loop",
    vehicle: v.number,
    driver: v.driver,
    centres: randInt(5, 18),
    startTime: `0${randInt(4, 6)}:${randInt(10, 55)}`,
    endTime: `${randInt(9, 12)}:${randInt(10, 55)}`,
    status,
    litres: randInt(800, 4200),
    completion,
  };
});

export const MAINTENANCE: MaintenanceRecord[] = VEHICLES.slice(0, 22).map((v, i) => ({
  id: `M${String(i + 1).padStart(3, "0")}`,
  vehicle: v.number,
  service: pick(["Engine Oil Change", "Brake Inspection", "Tyre Rotation", "Coolant Top-up", "Full Service", "Filter Replacement"]),
  dueIn: i % 5 === 0 ? "Overdue" : `${randInt(50, 1500)} km`,
  dueDate: `2026-07-${String(((i % 28) + 1)).padStart(2, "0")}`,
  status: i % 5 === 0 ? "Overdue" : i % 3 === 0 ? "Upcoming" : "Upcoming",
  cost: randInt(1500, 18000),
}));

// Time-series helpers
export function speedHistory() {
  return Array.from({ length: 24 }, (_, i) => ({ t: `${i}:00`, speed: Math.round(20 + Math.random() * 60) }));
}
export function fuelHistory() {
  let f = 95;
  return Array.from({ length: 14 }, (_, i) => {
    f -= rand(2, 7);
    if (f < 20) f = 90;
    return { day: `D${i + 1}`, fuel: Math.round(f) };
  });
}
export function tempHistory() {
  return Array.from({ length: 24 }, (_, i) => ({ t: `${i}:00`, temp: +(3 + Math.sin(i / 3) + Math.random()).toFixed(1) }));
}
export function fuelEfficiencyByVehicle() {
  return VEHICLES.slice(0, 10).map((v) => ({
    vehicle: v.number.split("-").slice(0, 2).join("-"),
    kmpl: +(3 + Math.random() * 4).toFixed(1),
  }));
}
export function dailyFuel() {
  return Array.from({ length: 7 }, (_, i) => ({
    day: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i],
    consumed: randInt(380, 720),
  }));
}

export const KPI = {
  totalVehicles: VEHICLES.length,
  moving: VEHICLES.filter((v) => v.status === "Moving").length,
  idle: VEHICLES.filter((v) => v.status === "Idle").length,
  parked: VEHICLES.filter((v) => v.status === "Parked").length,
  offline: VEHICLES.filter((v) => v.status === "Offline").length,
  fuelAlerts: ALERTS.filter((a) => a.type === "Fuel" && !a.resolved).length,
  tempAlerts: ALERTS.filter((a) => a.type === "Temperature" && !a.resolved).length,
  maintenanceDue: MAINTENANCE.filter((m) => m.status !== "Completed").length,
};
