/**
 * driverAttendanceReports.ts — Authoritative Driver Attendance & Route History Engine
 *
 * Uses `driver_shifts.started_at` & `driver_shifts.ended_at` exclusively for
 * attendance records (never inferring clock-in/out from trip creation), links
 * trips cleanly via `route_id` / `collection_routes`, formats all timestamps in
 * Asia/Kolkata, builds detailed per-driver historical timelines, and exports CSVs.
 */

import {
  type ReportDateBounds,
  buildReportCsv,
} from "./dailyActivityReport.ts";
import {
  formatIsoToIstTime,
  formatStatementNumber,
} from "./driverOperationStatement.ts";
import { extractRouteSummary } from "./driverRouteAssignments.ts";
import { getTodayIstDateString } from "./odometerTrackingEngine.ts";

export interface RawShiftRow {
  id: string;
  driver_id: string;
  vehicle_id?: string | null;
  assignment_id?: string | null;
  route_id?: string | null;
  started_at: string;
  ended_at?: string | null;
  active_hours?: number | null;
  opening_km?: number | null;
}

export type AttendanceStatus = "On Duty" | "Completed" | "Not Clocked In";

export interface AttendanceOverviewKpis {
  totalDrivers: number;
  clockedInToday: number;
  clockedOutToday: number;
  currentlyOnDuty: number;
  totalCompletedShifts: number;
  avgWorkingHours: number;
}

export interface FormattedAttendanceRow {
  id: string;
  shiftId: string | null;
  driverId: string;
  driverName: string;
  driverPhone: string;
  date: string;
  clockInTime: string;
  clockOutTime: string;
  clockInIso: string | null;
  clockOutIso: string | null;
  totalWorkingHoursNum: number;
  totalWorkingHours: string;
  vehicleId: string | null;
  vehicleRegistration: string;
  routeId: string | null;
  routeName: string;
  attendanceStatus: AttendanceStatus;
  openingKm: number | null;
}

export interface FormattedTripRouteHistoryRow {
  id: string;
  driverId: string;
  driverName: string;
  vehicleId: string | null;
  vehicleRegistration: string;
  routeId: string | null;
  routeName: string;
  startingPoint: string;
  destination: string;
  tripDate: string;
  departureTime: string;
  returnTime: string;
  outKmNum: number;
  outKm: string;
  inKmNum: number | null;
  inKm: string;
  distanceNum: number;
  distanceTravelled: string;
  tripDuration: string;
  tripStatus: string;
  statementNumber: string;
  dieselLitres: number;
  fuelAmount: number;
  kmpl: number | null;
}

export interface DetailedDriverTimelineItem {
  id: string;
  timestampMs: number;
  dateIst: string;
  timeIst: string;
  kind: "SHIFT" | "ASSIGNMENT" | "TRIP";
  title: string;
  subtitle: string;
  badge: string;
}

export interface DetailedDriverHistoryBundle {
  driver: any;
  shifts: FormattedAttendanceRow[];
  assignments: any[];
  routes: string[];
  vehicles: string[];
  trips: FormattedTripRouteHistoryRow[];
  totalDistanceKm: number;
  totalWorkingHours: number;
  timeline: DetailedDriverTimelineItem[];
}

export function formatIsoToIstDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function formatIsoToIstClock(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export function formatHoursDuration(hours: number | null | undefined, isOpenShift: boolean): string {
  if (isOpenShift) return "Active";
  if (hours == null || !Number.isFinite(hours) || hours < 0) return "0.00 h";
  const mins = Math.round(hours * 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${hours.toFixed(2)} h (${h}h ${m}m)`;
}

/**
 * Computes authoritative Attendance Overview KPIs using real `driver_shifts` rows.
 */
export function computeAttendanceOverviewKpis(
  drivers: Array<{ id: string }>,
  shifts: RawShiftRow[],
  refTodayIst?: string
): AttendanceOverviewKpis {
  const todayIst = refTodayIst || getTodayIstDateString();
  const clockedInTodayDrivers = new Set<string>();
  const clockedOutTodayDrivers = new Set<string>();
  const onDutyDrivers = new Set<string>();

  let totalCompletedShifts = 0;
  let completedHoursSum = 0;

  for (const s of shifts || []) {
    const startIst = formatIsoToIstDate(s.started_at);
    const endIst = formatIsoToIstDate(s.ended_at);

    if (startIst === todayIst && s.driver_id) {
      clockedInTodayDrivers.add(s.driver_id);
    }
    if (s.ended_at) {
      totalCompletedShifts += 1;
      const computedHrs =
        s.active_hours != null && Number(s.active_hours) >= 0
          ? Number(s.active_hours)
          : Math.max(0, (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 3600000);
      completedHoursSum += computedHrs;
      if (endIst === todayIst && s.driver_id) {
        clockedOutTodayDrivers.add(s.driver_id);
      }
    } else if (s.driver_id) {
      onDutyDrivers.add(s.driver_id);
    }
  }

  const avgWorkingHours =
    totalCompletedShifts > 0
      ? Math.round((completedHoursSum / totalCompletedShifts) * 100) / 100
      : 0;

  return {
    totalDrivers: drivers.length,
    clockedInToday: clockedInTodayDrivers.size,
    clockedOutToday: clockedOutTodayDrivers.size,
    currentlyOnDuty: onDutyDrivers.size,
    totalCompletedShifts,
    avgWorkingHours,
  };
}

/**
 * Builds Driver Attendance History rows strictly from `driver_shifts.started_at`
 * and `driver_shifts.ended_at`. Optionally emits `Not Clocked In` rows for
 * drivers who have zero shifts in the active date window.
 */
export function buildDriverAttendanceRows(
  drivers: any[],
  shifts: RawShiftRow[],
  vehicles: any[],
  routes: any[],
  assignments: any[],
  bounds: Pick<ReportDateBounds, "startMs" | "endMs" | "isAllTime" | "startIstDate" | "endIstDate">,
  options?: {
    driverId?: string;
    vehicleId?: string;
    routeId?: string;
    statusFilter?: string;
    includeNotClockedIn?: boolean;
  }
): FormattedAttendanceRow[] {
  const driverMap = new Map<string, any>(drivers.map((d) => [d.id, d]));
  const vehicleMap = new Map<string, any>(vehicles.map((v) => [v.id, v]));
  const routeMap = new Map<string, any>(routes.map((r) => [r.id, r]));
  const assignmentMap = new Map<string, any>(assignments.map((a) => [a.id, a]));

  const rows: FormattedAttendanceRow[] = [];
  const driversWithShiftInBounds = new Set<string>();

  for (const s of shifts || []) {
    const startMs = new Date(s.started_at).getTime();
    if (!Number.isFinite(startMs)) continue;

    // An open shift (`ended_at IS NULL`) remains On Duty even if started earlier; still match bounds for historical shifts
    const hasFiniteBounds = !bounds.isAllTime && bounds.startMs != null && bounds.endMs != null;
    const inBounds =
      !hasFiniteBounds ||
      (startMs >= bounds.startMs! && startMs <= bounds.endMs!) ||
      (!s.ended_at && startMs <= bounds.endMs!);
    if (!inBounds) continue;

    if (s.driver_id) driversWithShiftInBounds.add(s.driver_id);

    const d = driverMap.get(s.driver_id);
    const asg = s.assignment_id ? assignmentMap.get(s.assignment_id) : null;
    const effectiveVehId = s.vehicle_id || asg?.vehicle_id || null;
    const v = effectiveVehId ? vehicleMap.get(effectiveVehId) : null;
    const effectiveRouteId = s.route_id || asg?.route_id || null;
    const r = effectiveRouteId ? routeMap.get(effectiveRouteId) : null;

    const isOpen = !s.ended_at;
    const status: AttendanceStatus = isOpen ? "On Duty" : "Completed";

    const hrsNum = isOpen
      ? Math.max(0, Math.round(((Date.now() - startMs) / 3600000) * 100) / 100)
      : s.active_hours != null
      ? Number(s.active_hours)
      : Math.max(
          0,
          Math.round(((new Date(s.ended_at!).getTime() - startMs) / 3600000) * 100) / 100
        );

    const routeName =
      r?.name || asg?.route_snapshot?.name || asg?.route_name || "—";

    rows.push({
      id: s.id,
      shiftId: s.id,
      driverId: s.driver_id,
      driverName: d?.name || "—",
      driverPhone: d?.phone || "—",
      date: formatIsoToIstDate(s.started_at),
      clockInTime: formatIsoToIstClock(s.started_at),
      clockOutTime: isOpen ? "Active Shift" : formatIsoToIstClock(s.ended_at),
      clockInIso: s.started_at,
      clockOutIso: s.ended_at || null,
      totalWorkingHoursNum: hrsNum,
      totalWorkingHours: isOpen ? `On Duty (${hrsNum.toFixed(1)} h)` : formatHoursDuration(hrsNum, false),
      vehicleId: effectiveVehId,
      vehicleRegistration: v?.number || "—",
      routeId: effectiveRouteId,
      routeName,
      attendanceStatus: status,
      openingKm: s.opening_km != null ? Number(s.opening_km) : null,
    });
  }

  // Only emit Not Clocked In rows when explicitly requested; default strictly reflects actual DB `driver_shifts`
  if (options?.includeNotClockedIn === true) {
    for (const d of drivers || []) {
      if (driversWithShiftInBounds.has(d.id)) continue;
      const activeAsg = (assignments || []).find(
        (a) => a.driver_id === d.id && (a.is_active || a.status === "Assigned")
      );
      const v = activeAsg?.vehicle_id ? vehicleMap.get(activeAsg.vehicle_id) : null;
      const r = activeAsg?.route_id ? routeMap.get(activeAsg.route_id) : null;

      rows.push({
        id: `noclock-${d.id}`,
        shiftId: null,
        driverId: d.id,
        driverName: d.name || "Driver",
        driverPhone: d.phone || "—",
        date: bounds.endIstDate || getTodayIstDateString(),
        clockInTime: "—",
        clockOutTime: "—",
        clockInIso: null,
        clockOutIso: null,
        totalWorkingHoursNum: 0,
        totalWorkingHours: "0.00 h",
        vehicleId: activeAsg?.vehicle_id || null,
        vehicleRegistration: v?.number || "Unassigned",
        routeId: activeAsg?.route_id || null,
        routeName: r?.name || activeAsg?.route_name || "—",
        attendanceStatus: "Not Clocked In",
        openingKm: null,
      });
    }
  }

  return rows
    .filter((row) => {
      if (options?.driverId && options.driverId !== "All" && row.driverId !== options.driverId) return false;
      if (options?.vehicleId && options.vehicleId !== "All" && row.vehicleId !== options.vehicleId) return false;
      if (options?.routeId && options.routeId !== "All" && row.routeId !== options.routeId) return false;
      if (options?.statusFilter && options.statusFilter !== "All" && row.attendanceStatus !== options.statusFilter) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      // On Duty first, then newest clock-in, then Not Clocked In alphabetically
      if (a.attendanceStatus === "On Duty" && b.attendanceStatus !== "On Duty") return -1;
      if (b.attendanceStatus === "On Duty" && a.attendanceStatus !== "On Duty") return 1;
      if (a.clockInIso && b.clockInIso) return b.clockInIso.localeCompare(a.clockInIso);
      if (a.clockInIso) return -1;
      if (b.clockInIso) return 1;
      return a.driverName.localeCompare(b.driverName);
    });
}

/**
 * Builds Driver Trip & Route History rows using `trips`, `collection_routes`,
 * `vehicles`, and `drivers`. Strictly avoids inventing route associations for
 * legacy trips that have no `route_id`.
 */
export function buildDriverTripRouteHistoryRows(
  trips: any[],
  drivers: any[],
  vehicles: any[],
  routes: any[],
  bounds: Pick<ReportDateBounds, "startMs" | "endMs" | "isAllTime">,
  options?: {
    driverId?: string;
    vehicleId?: string;
    routeId?: string;
    tripStatus?: string;
  }
): FormattedTripRouteHistoryRow[] {
  const driverMap = new Map<string, any>(drivers.map((d) => [d.id, d]));
  const vehicleMap = new Map<string, any>(vehicles.map((v) => [v.id, v]));
  const routeMap = new Map<string, any>(routes.map((r) => [r.id, r]));

  const rows: FormattedTripRouteHistoryRow[] = [];

  for (const t of trips || []) {
    const tripTs = t.started_at
      ? new Date(t.started_at).getTime()
      : t.out_date || t.date
      ? Date.parse(`${(t.out_date || t.date).slice(0, 10)}T00:00:00+05:30`)
      : t.created_at
      ? new Date(t.created_at).getTime()
      : NaN;

    if (!bounds.isAllTime && bounds.startMs != null && bounds.endMs != null && Number.isFinite(tripTs)) {
      if (tripTs < bounds.startMs || tripTs > bounds.endMs) continue;
    }

    if (options?.driverId && options.driverId !== "All" && t.driver_id !== options.driverId) continue;
    if (options?.vehicleId && options.vehicleId !== "All" && t.vehicle_id !== options.vehicleId) continue;
    if (options?.routeId && options.routeId !== "All" && t.route_id !== options.routeId) continue;
    if (options?.tripStatus && options.tripStatus !== "All" && t.status !== options.tripStatus) continue;

    const d = t.driver_id ? driverMap.get(t.driver_id) : null;
    const v = t.vehicle_id ? vehicleMap.get(t.vehicle_id) : null;
    const linkedRoute = t.route_id ? routeMap.get(t.route_id) : null;
    // Prefer immutable route_snapshot saved when the trip started so later route edits never alter history
    const parsedRoute = t.route_snapshot
      ? extractRouteSummary(t.route_snapshot)
      : linkedRoute
      ? extractRouteSummary(linkedRoute)
      : null;

    // Only populate routeName from linked collection_route / snapshot; legacy trips with no route_id stay explicit
    const routeName =
      parsedRoute?.name ||
      t.route_snapshot?.name ||
      (t.route_id ? "Assigned Route" : "Direct / Legacy Trip");
    const startingPoint = parsedRoute?.startPoint || t.start || "—";
    const destination = parsedRoute?.destination || t.destination || "—";

    const depTime =
      t.out_time ||
      formatIsoToIstTime(t.started_at || t.created_at) ||
      "—";
    const retTime =
      t.status === "Ongoing"
        ? "Ongoing"
        : t.in_time || formatIsoToIstTime(t.closed_at) || "—";

    const outKmNum = Math.round(Math.max(0, Number(t.start_km ?? 0)) * 100) / 100;
    const inKmNum = t.end_km != null ? Math.round(Math.max(0, Number(t.end_km)) * 100) / 100 : null;
    const distanceNum =
      t.distance != null
        ? Math.round(Math.max(0, Number(t.distance)) * 100) / 100
        : inKmNum != null && inKmNum >= outKmNum
        ? Math.round((inKmNum - outKmNum) * 100) / 100
        : 0;

    rows.push({
      id: t.id,
      driverId: t.driver_id || "",
      driverName: d?.name || t.drivers?.name || "Unassigned",
      vehicleId: t.vehicle_id || null,
      vehicleRegistration: v?.number || t.vehicles?.number || "—",
      routeId: t.route_id || null,
      routeName,
      startingPoint,
      destination,
      tripDate: (t.in_date || t.out_date || t.date || "").slice(0, 10),
      departureTime: depTime,
      returnTime: retTime,
      outKmNum,
      outKm: `${outKmNum.toLocaleString()} km`,
      inKmNum,
      inKm: inKmNum != null ? `${inKmNum.toLocaleString()} km` : "—",
      distanceNum,
      distanceTravelled: t.status === "Ongoing" && inKmNum == null ? "—" : `${distanceNum.toLocaleString()} km`,
      tripDuration: t.duration || (t.status === "Ongoing" ? "In Progress" : "—"),
      tripStatus: t.status || "Ongoing",
      statementNumber: formatStatementNumber(t),
      dieselLitres: Number(t.diesel_liters || 0),
      fuelAmount: Number(t.fuel_amount || 0),
      kmpl: t.kmpl != null ? Number(t.kmpl) : null,
    });
  }

  return rows;
}

/**
 * Builds complete historical audit bundle for a single driver (Attendance, Assignments, Routes, Trips, Timeline).
 */
export function buildDetailedDriverHistory(
  driverId: string,
  drivers: any[],
  shifts: RawShiftRow[],
  assignments: any[],
  trips: any[],
  vehicles: any[],
  routes: any[]
): DetailedDriverHistoryBundle {
  const driver = drivers.find((d) => d.id === driverId) || { id: driverId, name: "Driver" };
  const allTimeBounds = {
    startMs: 0,
    endMs: Number.MAX_SAFE_INTEGER,
    isAllTime: true,
    startIstDate: "",
    endIstDate: getTodayIstDateString(),
  };

  const driverShifts = buildDriverAttendanceRows(
    [driver],
    shifts.filter((s) => s.driver_id === driverId),
    vehicles,
    routes,
    assignments,
    allTimeBounds,
    { driverId, includeNotClockedIn: false }
  );

  const driverAssignments = (assignments || [])
    .filter((a) => a.driver_id === driverId)
    .sort((a, b) =>
      String(b.assignment_date || b.assigned_at || "").localeCompare(
        String(a.assignment_date || a.assigned_at || "")
      )
    );

  const driverTrips = buildDriverTripRouteHistoryRows(
    trips.filter((t) => t.driver_id === driverId),
    [driver],
    vehicles,
    routes,
    allTimeBounds,
    { driverId }
  );

  const vehicleSet = new Set<string>();
  const routeSet = new Set<string>();

  driverAssignments.forEach((a) => {
    const vNum = a.vehicles?.number || vehicles.find((v) => v.id === a.vehicle_id)?.number;
    if (vNum) vehicleSet.add(vNum);
    const rName =
      a.route_snapshot?.name ||
      a.route_name ||
      a.collection_routes?.name ||
      routes.find((r) => r.id === a.route_id)?.name;
    if (rName) routeSet.add(rName);
  });
  driverTrips.forEach((t) => {
    if (t.vehicleRegistration && t.vehicleRegistration !== "—") vehicleSet.add(t.vehicleRegistration);
    if (t.routeName && t.routeName !== "Direct / Legacy Trip") routeSet.add(t.routeName);
  });

  const totalDistanceKm =
    Math.round(driverTrips.reduce((sum, t) => sum + t.distanceNum, 0) * 10) / 10;
  const totalWorkingHours =
    Math.round(
      driverShifts
        .filter((s) => s.attendanceStatus === "Completed")
        .reduce((sum, s) => sum + s.totalWorkingHoursNum, 0) * 100
    ) / 100;

  const timeline: DetailedDriverTimelineItem[] = [];

  for (const s of driverShifts) {
    if (!s.clockInIso) continue;
    timeline.push({
      id: `tl-shift-${s.id}`,
      timestampMs: new Date(s.clockInIso).getTime(),
      dateIst: s.date,
      timeIst: s.clockInTime,
      kind: "SHIFT",
      title: `Shift ${s.attendanceStatus === "On Duty" ? "Clock In (On Duty)" : "Completed"}`,
      subtitle: `${s.vehicleRegistration} · Out: ${s.clockOutTime} · Hours: ${s.totalWorkingHours}`,
      badge: s.attendanceStatus,
    });
  }

  for (const a of driverAssignments) {
    const refIso = a.assigned_at || `${a.assignment_date}T00:00:00+05:30`;
    const vNum = a.vehicles?.number || vehicles.find((v) => v.id === a.vehicle_id)?.number || "—";
    const rName = a.route_snapshot?.name || a.route_name || a.collection_routes?.name || "—";
    timeline.push({
      id: `tl-asg-${a.id}`,
      timestampMs: new Date(refIso).getTime() || 0,
      dateIst: a.assignment_date || formatIsoToIstDate(refIso),
      timeIst: a.departure_time ? `${a.departure_time} IST` : formatIsoToIstClock(refIso),
      kind: "ASSIGNMENT",
      title: `Route Assignment: ${rName}`,
      subtitle: a.departure_time ? `${vNum} · Scheduled departure ${a.departure_time}` : vNum,
      badge: a.status || "Assigned",
    });
  }

  for (const t of driverTrips) {
    const rawTrip = trips.find((x) => x.id === t.id);
    const refIso = rawTrip?.started_at || rawTrip?.created_at || `${t.tripDate}T00:00:00+05:30`;
    timeline.push({
      id: `tl-trip-${t.id}`,
      timestampMs: new Date(refIso).getTime() || 0,
      dateIst: t.tripDate,
      timeIst: `${t.departureTime} → ${t.returnTime}`,
      kind: "TRIP",
      title: `Trip ${t.statementNumber} (${t.startingPoint} → ${t.destination})`,
      subtitle: `${t.vehicleRegistration} · ${t.outKm} → ${t.inKm} (${t.distanceTravelled})`,
      badge: t.tripStatus,
    });
  }

  timeline.sort((a, b) => b.timestampMs - a.timestampMs);

  return {
    driver,
    shifts: driverShifts,
    assignments: driverAssignments,
    routes: Array.from(routeSet),
    vehicles: Array.from(vehicleSet),
    trips: driverTrips,
    totalDistanceKm,
    totalWorkingHours,
    timeline,
  };
}

export function buildAttendanceCsv(rows: FormattedAttendanceRow[]): string {
  return buildReportCsv(
    rows.map((r) => ({
      driverName: r.driverName,
      driverContact: r.driverPhone,
      date: r.date,
      clockInTime: r.clockInTime,
      clockOutTime: r.clockOutTime,
      totalWorkingHours: r.totalWorkingHours,
      vehicleRegistration: r.vehicleRegistration,
      routeName: r.routeName,
      attendanceStatus: r.attendanceStatus,
    }))
  );
}

export function buildTripRouteHistoryCsv(rows: FormattedTripRouteHistoryRow[]): string {
  return buildReportCsv(
    rows.map((r) => ({
      driverName: r.driverName,
      vehicleRegistration: r.vehicleRegistration,
      routeName: r.routeName,
      startingPoint: r.startingPoint,
      destination: r.destination,
      tripDate: r.tripDate,
      departureTime: r.departureTime,
      returnTime: r.returnTime,
      startingOdometer: r.outKm,
      endingOdometer: r.inKm,
      distanceTravelled: r.distanceTravelled,
      tripDuration: r.tripDuration,
      tripStatus: r.tripStatus,
      statementNumber: r.statementNumber,
    }))
  );
}
