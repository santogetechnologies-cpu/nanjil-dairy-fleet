/**
 * driverRouteAssignments.ts — Admin Driver–Vehicle–Route Assignment Engine
 *
 * Pure helpers, conflict validation, summary KPI calculations, route config
 * extraction, and secure Supabase RPC wrappers for Driver & Route Assignments.
 */

import { getTodayIstDateString } from "./odometerTrackingEngine.ts";

export type AssignmentStatus =
  | "Scheduled"
  | "Assigned"
  | "In Progress"
  | "Completed"
  | "Cancelled";

export interface RouteAssignmentRecord {
  id: string;
  driver_id: string;
  vehicle_id: string;
  route_id?: string | null;
  route_name?: string | null;
  assignment_date: string;
  departure_time?: string | null;
  status: AssignmentStatus | string;
  is_active: boolean;
  notes?: string | null;
  route_snapshot?: any;
  assigned_at?: string | null;
  unassigned_at?: string | null;
  drivers?: { id?: string; name?: string; phone?: string } | null;
  vehicles?: { id?: string; number?: string; type?: string; model?: string; status?: string; route?: string } | null;
  collection_routes?: any;
}

export interface RouteStopSummary {
  id?: string;
  name: string;
  lat?: number;
  lng?: number;
  serviceDurationMins?: number;
  isMandatory?: boolean;
}

export interface RouteSummaryInfo {
  id: string;
  name: string;
  startPoint: string;
  destination: string;
  startLat?: number | null;
  startLng?: number | null;
  destinationLat?: number | null;
  destinationLng?: number | null;
  roundTripType?: "same_path" | "different_path" | "one_way";
  revisitStopsOnReturn?: boolean;
  totalDistanceKm?: number | null;
  totalDurationMins?: number | null;
  speedLimitKmh?: number | null;
  deviationThresholdMeters?: number | null;
  routeNotes?: string | null;
  centresCount: number;
  stops: RouteStopSummary[];
  outboundStops: RouteStopSummary[];
  returnStops: RouteStopSummary[];
  departureTime?: string | null;
  isArchived?: boolean;
  isValidConfig?: boolean;
}

export interface AssignmentDashboardKpis {
  totalDrivers: number;
  availableDrivers: number;
  assignedDrivers: number;
  activeAssignments: number;
  vehiclesAssigned: number;
  unassignedVehicles: number;
}

export interface AssignmentValidationInput {
  editingAssignmentId?: string | null;
  driverId?: string | null;
  vehicleId?: string | null;
  routeId?: string | null;
  assignmentDate: string;
  departureTime: string;
  vehicleStatus?: string | null;
  existingAssignments: RouteAssignmentRecord[];
  ongoingTrips?: Array<{ vehicle_id?: string | null; driver_id?: string | null; status?: string | null }>;
  todayIst?: string;
}

export function formatAssignmentCode(id?: string | null, assignmentDate?: string | null): string {
  const datePart = (assignmentDate || getTodayIstDateString()).replace(/-/g, "");
  const suffix = id ? id.slice(0, 4).toUpperCase() : "NEW";
  return `ASG-${datePart}-${suffix}`;
}

function parseRouteConfigJson(rawConfig: any): any | null {
  if (!rawConfig) return null;
  if (typeof rawConfig === "string") {
    try {
      const parsed = JSON.parse(rawConfig);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof rawConfig === "object" ? rawConfig : null;
}

export function isValidSavedRoute(routeRow: any): boolean {
  if (!routeRow || routeRow.is_archived === true) return false;
  if (!routeRow.name || !String(routeRow.name).trim()) return false;

  const config = parseRouteConfigJson(routeRow.route_config);
  if (!config) return false;

  const start = config.startPoint;
  const dest = config.destinationPoint || config.destination;
  const hasStart = Boolean(start && typeof start.name === "string" && start.name.trim());
  const hasDest = Boolean(dest && typeof dest.name === "string" && dest.name.trim());

  return hasStart && hasDest;
}

export function filterAssignableRoutes(routes: any[]): any[] {
  return (routes || []).filter((r) => isValidSavedRoute(r));
}

export function extractRouteSummary(routeRow: any): RouteSummaryInfo | null {
  if (!routeRow) return null;
  const config = parseRouteConfigJson(routeRow.route_config);

  const startObj = config?.startPoint;
  const destObj = config?.destinationPoint || config?.destination;

  const startPoint =
    startObj?.name ||
    config?.start ||
    routeRow.start_point ||
    (routeRow.name?.includes(" to ") ? routeRow.name.split(" to ")[0].trim() : null) ||
    "Starting Point";

  const destination =
    destObj?.name ||
    (typeof config?.destination === "string" ? config.destination : null) ||
    routeRow.destination ||
    (routeRow.name?.includes(" to ") ? routeRow.name.split(" to ")[1].trim() : null) ||
    "Destination";

  const rawOutbound = Array.isArray(config?.outboundStops) ? config.outboundStops : [];
  const rawReturn = Array.isArray(config?.returnStops) ? config.returnStops : [];

  const normalizeStop = (s: any): RouteStopSummary => ({
    id: s?.id,
    name: String(s?.name || "Unnamed Stop"),
    lat: typeof s?.lat === "number" && Number.isFinite(s.lat) ? s.lat : undefined,
    lng: typeof s?.lng === "number" && Number.isFinite(s.lng) ? s.lng : undefined,
    serviceDurationMins:
      typeof s?.serviceDurationMins === "number" ? s.serviceDurationMins : undefined,
    isMandatory: typeof s?.isMandatory === "boolean" ? s.isMandatory : undefined,
  });

  const outboundStops = rawOutbound.map(normalizeStop);
  const returnStops = rawReturn.map(normalizeStop);
  const stops = outboundStops.length > 0 ? outboundStops : returnStops;

  const centresCount = Number(
    routeRow.centres ?? outboundStops.length + returnStops.length
  );

  const rawMode = config?.roundTripType;
  const roundTripType: "same_path" | "different_path" | "one_way" =
    rawMode === "same_path" || rawMode === "different_path" || rawMode === "one_way"
      ? rawMode
      : returnStops.length > 0
      ? "different_path"
      : "one_way";

  return {
    id: routeRow.id || "",
    name: routeRow.name || "Collection Route",
    startPoint,
    destination,
    startLat: typeof startObj?.lat === "number" ? startObj.lat : null,
    startLng: typeof startObj?.lng === "number" ? startObj.lng : null,
    destinationLat: typeof destObj?.lat === "number" ? destObj.lat : null,
    destinationLng: typeof destObj?.lng === "number" ? destObj.lng : null,
    roundTripType,
    revisitStopsOnReturn: Boolean(config?.revisitStopsOnReturn),
    totalDistanceKm:
      config?.totalDistanceKm != null && Number.isFinite(Number(config.totalDistanceKm))
        ? Number(config.totalDistanceKm)
        : null,
    totalDurationMins:
      config?.totalDurationMins != null && Number.isFinite(Number(config.totalDurationMins))
        ? Number(config.totalDurationMins)
        : null,
    speedLimitKmh:
      config?.speedLimitKmh != null && Number.isFinite(Number(config.speedLimitKmh))
        ? Number(config.speedLimitKmh)
        : null,
    deviationThresholdMeters:
      config?.deviationThresholdMeters != null &&
      Number.isFinite(Number(config.deviationThresholdMeters))
        ? Number(config.deviationThresholdMeters)
        : null,
    routeNotes: config?.routeNotes || null,
    centresCount: Number.isFinite(centresCount) ? centresCount : 0,
    stops,
    outboundStops,
    returnStops,
    departureTime: routeRow.start_time || config?.departureTime || null,
    isArchived: Boolean(routeRow.is_archived),
    isValidConfig: isValidSavedRoute(routeRow),
  };
}

export function computeAssignmentDashboardKpis(
  drivers: Array<{ id: string }>,
  vehicles: Array<{ id: string }>,
  assignments: RouteAssignmentRecord[]
): AssignmentDashboardKpis {
  const activeDriverIds = new Set<string>();
  const activeVehicleIds = new Set<string>();
  let activeAssignments = 0;

  for (const a of assignments || []) {
    const isLive =
      a.is_active === true ||
      a.status === "Assigned" ||
      a.status === "In Progress";
    if (isLive && a.status !== "Cancelled" && a.status !== "Completed") {
      activeAssignments += 1;
      if (a.driver_id) activeDriverIds.add(a.driver_id);
      if (a.vehicle_id) activeVehicleIds.add(a.vehicle_id);
    }
  }

  const totalDrivers = drivers.length;
  const assignedDrivers = Math.min(totalDrivers, activeDriverIds.size);
  const availableDrivers = Math.max(0, totalDrivers - assignedDrivers);
  const vehiclesAssigned = Math.min(vehicles.length, activeVehicleIds.size);
  const unassignedVehicles = Math.max(0, vehicles.length - vehiclesAssigned);

  return {
    totalDrivers,
    availableDrivers,
    assignedDrivers,
    activeAssignments,
    vehiclesAssigned,
    unassignedVehicles,
  };
}

export function validateAssignmentInput(input: AssignmentValidationInput): {
  valid: boolean;
  error?: string;
} {
  if (!input.driverId) {
    return { valid: false, error: "Please select a driver." };
  }
  if (!input.vehicleId) {
    return { valid: false, error: "Please select a vehicle." };
  }
  if (!input.routeId) {
    return { valid: false, error: "Please select a collection route." };
  }
  if (!input.assignmentDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.assignmentDate)) {
    return { valid: false, error: "Please enter a valid Assignment Date." };
  }
  if (!input.departureTime || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(input.departureTime.trim())) {
    return { valid: false, error: "Please enter a valid Scheduled Departure Time (HH:MM)." };
  }

  const vStatus = (input.vehicleStatus || "").toLowerCase();
  if (vStatus === "maintenance" || vStatus === "inactive" || vStatus === "breakdown") {
    return {
      valid: false,
      error: `Selected vehicle is currently unavailable (status: ${input.vehicleStatus}).`,
    };
  }

  const ongoingConflict = (input.ongoingTrips || []).find(
    (t) =>
      t.status === "Ongoing" &&
      t.vehicle_id === input.vehicleId &&
      t.driver_id !== input.driverId
  );
  if (ongoingConflict) {
    return {
      valid: false,
      error: "Selected vehicle currently has an ongoing trip with another driver.",
    };
  }

  const todayIst = input.todayIst || getTodayIstDateString();
  const isImmediateActive = input.assignmentDate <= todayIst;

  for (const existing of input.existingAssignments || []) {
    if (input.editingAssignmentId && existing.id === input.editingAssignmentId) continue;
    if (existing.status === "Completed" || existing.status === "Cancelled") continue;

    // Duplicate exact check
    if (
      existing.driver_id === input.driverId &&
      existing.vehicle_id === input.vehicleId &&
      existing.route_id === input.routeId &&
      existing.assignment_date === input.assignmentDate
    ) {
      return {
        valid: false,
        error: "Duplicate assignment: This driver, vehicle, and route are already assigned for that date.",
      };
    }

    // Active conflicts (immediate date)
    if (isImmediateActive && (existing.is_active || existing.status === "Assigned" || existing.status === "In Progress")) {
      if (existing.driver_id === input.driverId) {
        return {
          valid: false,
          error: "Conflicting active assignment: Selected driver already has an active assignment.",
        };
      }
      if (existing.vehicle_id === input.vehicleId) {
        return {
          valid: false,
          error: "Vehicle unavailable: Selected vehicle is already actively assigned to another driver.",
        };
      }
    }

    // Scheduled same-date conflicts
    if (existing.assignment_date === input.assignmentDate) {
      if (existing.driver_id === input.driverId) {
        return {
          valid: false,
          error: `Selected driver already has a scheduled or active assignment on ${input.assignmentDate}.`,
        };
      }
      if (existing.vehicle_id === input.vehicleId) {
        return {
          valid: false,
          error: `Selected vehicle already has a scheduled or active assignment on ${input.assignmentDate}.`,
        };
      }
    }
  }

  return { valid: true };
}

export async function saveRouteAssignment(
  supabaseClient: any,
  params: {
    assignmentId?: string | null;
    driverId: string;
    vehicleId: string;
    routeId: string;
    assignmentDate: string;
    departureTime: string;
    notes?: string;
  }
): Promise<{ ok: boolean; assignment?: RouteAssignmentRecord; error?: string }> {
  const { data, error } = await supabaseClient.rpc("admin_save_route_assignment", {
    p_driver_id: params.driverId,
    p_vehicle_id: params.vehicleId,
    p_route_id: params.routeId,
    p_assignment_date: params.assignmentDate,
    p_departure_time: params.departureTime,
    p_notes: params.notes?.trim() || null,
    p_assignment_id: params.assignmentId || null,
  });

  if (error) {
    if (error.message?.includes("Could not find the function") || error.message?.includes("PGRST202")) {
      return {
        ok: false,
        error:
          "Database RPC admin_save_route_assignment not deployed yet. Apply migration 20261126110000_driver_route_assignments_and_attendance_reports.sql in Supabase.",
      };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true, assignment: data?.assignment as RouteAssignmentRecord | undefined };
}

export async function cancelRouteAssignment(
  supabaseClient: any,
  assignmentId: string,
  reason?: string
): Promise<{ ok: boolean; assignment?: RouteAssignmentRecord; error?: string }> {
  const { data, error } = await supabaseClient.rpc("admin_cancel_route_assignment", {
    p_assignment_id: assignmentId,
    p_reason: reason?.trim() || null,
  });

  if (error) {
    if (error.message?.includes("Could not find the function") || error.message?.includes("PGRST202")) {
      return {
        ok: false,
        error:
          "Database RPC admin_cancel_route_assignment not deployed yet. Apply migration 20261126110000_driver_route_assignments_and_attendance_reports.sql in Supabase.",
      };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true, assignment: data?.assignment as RouteAssignmentRecord | undefined };
}

export async function archiveCollectionRoute(
  supabaseClient: any,
  routeId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabaseClient.rpc("admin_archive_collection_route", {
    p_route_id: routeId,
  });

  if (!error) {
    return { ok: Boolean(data?.ok ?? true) };
  }

  const msg = error.message || "";
  if (msg.includes("Could not find the function") || msg.includes("PGRST202")) {
    const upd = await supabaseClient
      .from("collection_routes")
      .update({
        is_archived: true,
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", routeId);
    if (!upd.error) return { ok: true };
    return { ok: false, error: upd.error.message };
  }

  return { ok: false, error: msg };
}

/**
 * Fetches vehicle_assignments safely without selecting nonexistent columns on
 * `public.vehicles` (`status` only lives on `v_vehicles`), and automatically
 * falls back to legacy columns if migration 20261126110000 hasn't been applied yet.
 */
export async function fetchAssignmentsWithFallback(
  supabaseClient: any,
  options?: { driverId?: string; limit?: number }
): Promise<{
  data: RouteAssignmentRecord[];
  schemaPendingMigration: boolean;
  error?: string;
}> {
  let q = supabaseClient
    .from("vehicle_assignments")
    .select(
      "*, drivers(id, name, phone), vehicles(id, number, type, model, route, odometer), collection_routes(*)"
    );

  if (options?.driverId) q = q.eq("driver_id", options.driverId);
  q = q.order("assignment_date", { ascending: false }).order("assigned_at", { ascending: false });
  if (options?.limit) q = q.limit(options.limit);

  const primaryRes = await q;
  if (!primaryRes.error) {
    return {
      data: (primaryRes.data || []) as RouteAssignmentRecord[],
      schemaPendingMigration: false,
    };
  }

  const msg = primaryRes.error.message || "";
  const code = primaryRes.error.code || "";
  const isMissingSchemaOrRel =
    code === "PGRST200" ||
    code === "PGRST204" ||
    code === "42703" ||
    msg.includes("assignment_date") ||
    msg.includes("collection_routes") ||
    msg.includes("relationship");

  if (!isMissingSchemaOrRel) {
    return { data: [], schemaPendingMigration: false, error: msg };
  }

  let fallbackQ = supabaseClient
    .from("vehicle_assignments")
    .select("*, drivers(id, name, phone), vehicles(id, number, type, model, route, odometer)");

  if (options?.driverId) fallbackQ = fallbackQ.eq("driver_id", options.driverId);
  fallbackQ = fallbackQ.order("assigned_at", { ascending: false });
  if (options?.limit) fallbackQ = fallbackQ.limit(options.limit);

  const fallbackRes = await fallbackQ;
  if (fallbackRes.error) {
    return { data: [], schemaPendingMigration: true, error: fallbackRes.error.message };
  }

  const normalized = (fallbackRes.data || []).map((a: any) => ({
    ...a,
    assignment_date:
      a.assignment_date ||
      (a.assigned_at ? String(a.assigned_at).slice(0, 10) : getTodayIstDateString()),
    status:
      a.status || (a.is_active ? "Assigned" : a.unassigned_at ? "Completed" : "Completed"),
  })) as RouteAssignmentRecord[];

  return { data: normalized, schemaPendingMigration: true };
}
