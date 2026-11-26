/**
 * gatekeeperLogs.ts — Vehicle Gate Keeper Entry Engine & Admin Report Helpers
 *
 * Pure validation, Asia/Kolkata (IST) timestamp assembly, duration calculation,
 * backend RPC wrappers, KPI aggregation, filtering, and CSV export helpers for
 * public.vehicle_gate_logs. Zero fake or mock data.
 */

import { type ReportDateBounds, filterRecordsByIstRange } from "./dailyActivityReport.ts";
import { getTodayIstDateString } from "./odometerTrackingEngine.ts";
import { formatIsoToIstTime, getCurrentIstTimeString } from "./driverOperationStatement.ts";

export interface RawVehicleGateLogRow {
  id: string;
  vehicle_id?: string | null;
  vehicle_number: string;
  driver_id?: string | null;
  driver_name: string;
  salesman_name?: string | null;
  log_date: string;
  outgoing_at: string;
  outgoing_time: string;
  incoming_at?: string | null;
  incoming_time?: string | null;
  status: "Out" | "Returned" | string;
  notes?: string | null;
  gatekeeper_profile_id?: string | null;
  gatekeeper_name?: string | null;
  closed_by_profile_id?: string | null;
  closed_by_name?: string | null;
  created_at?: string;
  updated_at?: string;
  vehicles?: { id?: string; number?: string; device_id?: string | null } | null;
  drivers?: { id?: string; name?: string } | null;
}

export interface GateOutgoingInput {
  vehicleId?: string | null;
  vehicleNumber: string;
  driverId?: string | null;
  driverName: string;
  salesmanName?: string | null;
  logDate: string;
  outgoingTime: string;
  incomingDate?: string | null;
  incomingTime?: string | null;
  notes?: string | null;
}

export interface GateIncomingInput {
  logId: string;
  outgoingAtIso: string;
  incomingDate: string;
  incomingTime: string;
  salesmanName?: string | null;
  notes?: string | null;
}

export interface GateValidationResult {
  valid: boolean;
  error?: string;
  fieldErrors: {
    vehicle?: string;
    driver?: string;
    logDate?: string;
    outgoingTime?: string;
    incomingTime?: string;
  };
  parsed?: {
    outgoingAtIso: string;
    incomingAtIso: string | null;
    salesmanName: string | null;
    notes: string | null;
  };
}

export interface FormattedGatekeeperReportRow {
  id: string;
  logDate: string;
  vehicleId: string | null;
  vehicleNumber: string;
  driverId: string | null;
  driverName: string;
  salesmanName: string;
  outgoingTime: string;
  incomingTime: string;
  outgoingAtIso: string;
  incomingAtIso: string | null;
  outgoingAtMs: number;
  durationMins: number | null;
  durationDisplay: string;
  status: "Out" | "Returned";
  gatekeeperName: string;
  closedByName: string;
  notes: string;
}

export interface GatekeeperReportKpis {
  totalEntries: number;
  currentlyOut: number;
  returnedCount: number;
  avgDurationMins: number | null;
  uniqueVehicles: number;
  uniqueDrivers: number;
}

/**
 * Combines YYYY-MM-DD and HH:MM (with optional :SS) in Asia/Kolkata (+05:30)
 * into a canonical ISO-8601 string. Returns null if malformed.
 */
export function combineIstDateTimeToIso(dateStr: string, timeStr: string): string | null {
  const cleanDate = (dateStr || "").trim();
  const cleanTime = (timeStr || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return null;
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(cleanTime)) return null;

  const hhmmss = cleanTime.length === 5 ? `${cleanTime}:00` : cleanTime;
  const isoCandidate = `${cleanDate}T${hhmmss}+05:30`;
  const parsed = new Date(isoCandidate);
  if (Number.isNaN(parsed.getTime())) return null;
  return isoCandidate;
}

/**
 * Validates new gate exit entry (outgoing mandatory; incoming optional).
 */
export function validateGateOutgoingEntry(input: GateOutgoingInput): GateValidationResult {
  const fieldErrors: GateValidationResult["fieldErrors"] = {};

  const veh = (input.vehicleNumber || "").trim();
  if (!veh) {
    fieldErrors.vehicle = "Please select or enter a vehicle number.";
  }

  const drv = (input.driverName || "").trim();
  if (!drv) {
    fieldErrors.driver = "Please select or enter the driver name.";
  }

  const logDate = (input.logDate || "").trim() || getTodayIstDateString();
  const outgoingTime = (input.outgoingTime || "").trim();
  const outgoingAtIso = combineIstDateTimeToIso(logDate, outgoingTime);
  if (!outgoingAtIso) {
    fieldErrors.outgoingTime = "Enter a valid outgoing time (HH:MM).";
  }

  let incomingAtIso: string | null = null;
  const rawInTime = (input.incomingTime || "").trim();
  if (rawInTime) {
    const inDate = (input.incomingDate || "").trim() || logDate;
    incomingAtIso = combineIstDateTimeToIso(inDate, rawInTime);
    if (!incomingAtIso) {
      fieldErrors.incomingTime = "Enter a valid incoming time (HH:MM).";
    } else if (outgoingAtIso && new Date(incomingAtIso).getTime() < new Date(outgoingAtIso).getTime()) {
      fieldErrors.incomingTime = "Incoming time cannot be earlier than outgoing time.";
    }
  }

  const firstError =
    fieldErrors.vehicle ||
    fieldErrors.driver ||
    fieldErrors.logDate ||
    fieldErrors.outgoingTime ||
    fieldErrors.incomingTime;

  if (firstError || !outgoingAtIso) {
    return { valid: false, error: firstError || "Invalid gate log input.", fieldErrors };
  }

  const salesmanClean = (input.salesmanName || "").trim();
  const notesClean = (input.notes || "").trim();

  return {
    valid: true,
    fieldErrors: {},
    parsed: {
      outgoingAtIso,
      incomingAtIso,
      salesmanName: salesmanClean || null,
      notes: notesClean || null,
    },
  };
}

/**
 * Validates closing an active Out entry with an incoming return timestamp.
 */
export function validateGateIncomingEntry(input: GateIncomingInput): GateValidationResult {
  const fieldErrors: GateValidationResult["fieldErrors"] = {};

  if (!input.logId) {
    return { valid: false, error: "Gate log reference missing.", fieldErrors };
  }

  const inDate = (input.incomingDate || "").trim() || getTodayIstDateString();
  const inTime = (input.incomingTime || "").trim();
  const incomingAtIso = combineIstDateTimeToIso(inDate, inTime);
  if (!incomingAtIso) {
    fieldErrors.incomingTime = "Enter a valid incoming time (HH:MM).";
    return { valid: false, error: fieldErrors.incomingTime, fieldErrors };
  }

  const outMs = new Date(input.outgoingAtIso).getTime();
  const inMs = new Date(incomingAtIso).getTime();
  if (!Number.isNaN(outMs) && inMs < outMs) {
    fieldErrors.incomingTime = "Incoming time cannot be earlier than outgoing time.";
    return { valid: false, error: fieldErrors.incomingTime, fieldErrors };
  }

  const salesmanClean = (input.salesmanName || "").trim();
  const notesClean = (input.notes || "").trim();

  return {
    valid: true,
    fieldErrors: {},
    parsed: {
      outgoingAtIso: input.outgoingAtIso,
      incomingAtIso,
      salesmanName: salesmanClean || null,
      notes: notesClean || null,
    },
  };
}

export function computeDurationMinutes(
  outgoingAtIso?: string | null,
  incomingAtIso?: string | null
): number | null {
  if (!outgoingAtIso || !incomingAtIso) return null;
  const outMs = new Date(outgoingAtIso).getTime();
  const inMs = new Date(incomingAtIso).getTime();
  if (Number.isNaN(outMs) || Number.isNaN(inMs) || inMs < outMs) return null;
  return Math.round((inMs - outMs) / 60000);
}

export function formatGateDuration(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return "Out (Open)";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

export function formatGateTimeDisplay(isoOrTime?: string | null, fallbackTime?: string | null): string {
  if (isoOrTime) {
    const dt = new Date(isoOrTime);
    if (!Number.isNaN(dt.getTime())) {
      return new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).format(dt);
    }
  }
  const clean = (fallbackTime || "").trim();
  if (!clean) return "-";
  const match = clean.match(/^(\d{2}):(\d{2})/);
  if (!match) return clean;
  const h24 = Number(match[1]);
  const mins = match[2];
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, "0")}:${mins} ${suffix}`;
}

export async function submitGateOutgoingEntry(
  supabaseClient: { rpc: (fn: string, args?: any) => any },
  input: GateOutgoingInput
): Promise<{ ok: boolean; error?: string; data?: RawVehicleGateLogRow }> {
  const check = validateGateOutgoingEntry(input);
  if (!check.valid || !check.parsed) {
    return { ok: false, error: check.error || "Invalid gate entry." };
  }

  const { data, error } = await supabaseClient.rpc("gatekeeper_record_vehicle_out", {
    p_vehicle_id: input.vehicleId || null,
    p_vehicle_number: input.vehicleNumber.trim(),
    p_driver_id: input.driverId || null,
    p_driver_name: input.driverName.trim(),
    p_salesman_name: check.parsed.salesmanName,
    p_log_date: input.logDate || getTodayIstDateString(),
    p_outgoing_at: check.parsed.outgoingAtIso,
    p_outgoing_time: input.outgoingTime.trim(),
    p_incoming_at: check.parsed.incomingAtIso,
    p_incoming_time: input.incomingTime?.trim() || null,
    p_notes: check.parsed.notes,
  });

  if (error) {
    return { ok: false, error: error.message || "Failed to record gate entry." };
  }

  return { ok: true, data: data as RawVehicleGateLogRow };
}

export async function submitGateIncomingEntry(
  supabaseClient: { rpc: (fn: string, args?: any) => any },
  input: GateIncomingInput
): Promise<{ ok: boolean; error?: string; data?: RawVehicleGateLogRow }> {
  const check = validateGateIncomingEntry(input);
  if (!check.valid || !check.parsed) {
    return { ok: false, error: check.error || "Invalid incoming time." };
  }

  const { data, error } = await supabaseClient.rpc("gatekeeper_record_vehicle_in", {
    p_log_id: input.logId,
    p_incoming_at: check.parsed.incomingAtIso,
    p_incoming_time: input.incomingTime.trim(),
    p_salesman_name: check.parsed.salesmanName,
    p_notes: check.parsed.notes,
  });

  if (error) {
    return { ok: false, error: error.message || "Failed to update incoming time." };
  }

  return { ok: true, data: data as RawVehicleGateLogRow };
}

export function buildGatekeeperReportRows(
  rawLogs: RawVehicleGateLogRow[],
  dateBounds: ReportDateBounds,
  filters?: {
    vehicleNumber?: string;
    driverName?: string;
    statusFilter?: string;
  }
): FormattedGatekeeperReportRow[] {
  const inDateRange = filterRecordsByIstRange(
    rawLogs || [],
    (row) => row.outgoing_at || (row.log_date ? `${row.log_date}T00:00:00+05:30` : null),
    dateBounds
  );

  const formatted: FormattedGatekeeperReportRow[] = [];

  for (const row of inDateRange) {
    const vehNum = (row.vehicles?.number || row.vehicle_number || "").trim() || "Unknown Vehicle";
    const drvName = (row.drivers?.name || row.driver_name || "").trim() || "Unknown Driver";
    const salesman = (row.salesman_name || "").trim() || "-";
    const status: "Out" | "Returned" =
      row.status === "Returned" || Boolean(row.incoming_at) ? "Returned" : "Out";

    if (
      filters?.vehicleNumber &&
      filters.vehicleNumber !== "All" &&
      vehNum.replace(/\s+/g, "").toUpperCase() !== filters.vehicleNumber.replace(/\s+/g, "").toUpperCase()
    ) {
      continue;
    }

    if (
      filters?.driverName &&
      filters.driverName !== "All" &&
      drvName.toLowerCase() !== filters.driverName.toLowerCase()
    ) {
      continue;
    }

    if (
      filters?.statusFilter &&
      filters.statusFilter !== "All" &&
      status.toLowerCase() !== filters.statusFilter.toLowerCase()
    ) {
      continue;
    }

    const durationMins =
      status === "Returned" ? computeDurationMinutes(row.outgoing_at, row.incoming_at) : null;

    const outgoingAtMs = row.outgoing_at ? new Date(row.outgoing_at).getTime() : 0;

    formatted.push({
      id: row.id,
      logDate: row.log_date || "-",
      vehicleId: row.vehicle_id || null,
      vehicleNumber: vehNum,
      driverId: row.driver_id || null,
      driverName: drvName,
      salesmanName: salesman,
      outgoingTime: formatGateTimeDisplay(row.outgoing_at, row.outgoing_time),
      incomingTime:
        status === "Returned"
          ? formatGateTimeDisplay(row.incoming_at, row.incoming_time)
          : "-",
      outgoingAtIso: row.outgoing_at,
      incomingAtIso: row.incoming_at || null,
      outgoingAtMs: Number.isFinite(outgoingAtMs) ? outgoingAtMs : 0,
      durationMins,
      durationDisplay: status === "Returned" ? formatGateDuration(durationMins) : "Still Out",
      status,
      gatekeeperName: (row.gatekeeper_name || "").trim() || "Gate Keeper",
      closedByName: (row.closed_by_name || row.gatekeeper_name || "").trim() || "-",
      notes: (row.notes || "").trim() || "-",
    });
  }

  return formatted.sort((a, b) => b.outgoingAtMs - a.outgoingAtMs);
}

export function computeGatekeeperReportKpis(
  rows: FormattedGatekeeperReportRow[]
): GatekeeperReportKpis {
  let currentlyOut = 0;
  let returnedCount = 0;
  let durationSum = 0;
  let durationCount = 0;
  const vehicles = new Set<string>();
  const drivers = new Set<string>();

  for (const r of rows) {
    if (r.status === "Out") currentlyOut += 1;
    else returnedCount += 1;

    if (r.durationMins != null && Number.isFinite(r.durationMins)) {
      durationSum += r.durationMins;
      durationCount += 1;
    }

    if (r.vehicleNumber && r.vehicleNumber !== "Unknown Vehicle") {
      vehicles.add(r.vehicleNumber.replace(/\s+/g, "").toUpperCase());
    }
    if (r.driverName && r.driverName !== "Unknown Driver") {
      drivers.add(r.driverName.trim().toLowerCase());
    }
  }

  return {
    totalEntries: rows.length,
    currentlyOut,
    returnedCount,
    avgDurationMins: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
    uniqueVehicles: vehicles.size,
    uniqueDrivers: drivers.size,
  };
}

function escapeCsvCell(val: unknown): string {
  const s = val == null ? "" : String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildGatekeeperReportCsv(rows: FormattedGatekeeperReportRow[]): string {
  if (!rows.length) return "";
  const headers = [
    "Date",
    "Vehicle No",
    "Driver Name",
    "Salesman Name",
    "Outgoing Time (IST)",
    "Incoming Time (IST)",
    "Duration",
    "Status",
    "Recorded By",
    "Closed By",
    "Notes",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.logDate,
        r.vehicleNumber,
        r.driverName,
        r.salesmanName,
        r.outgoingTime,
        r.incomingTime,
        r.durationDisplay,
        r.status,
        r.gatekeeperName,
        r.closedByName,
        r.notes,
      ]
        .map(escapeCsvCell)
        .join(",")
    );
  }
  return lines.join("\n");
}

export { getTodayIstDateString, getCurrentIstTimeString, formatIsoToIstTime };
