/**
 * driverOperationStatement.ts — Nanjil Dairy Vehicle Operation Statement Engine
 *
 * Implements pure validation rules, automatic Running KM & KMPL calculations,
 * hardware-odometer reconciliation, and secure Supabase RPC invocation for
 * Driver Trip Start & Trip Closing with atomic vehicle odometer updates.
 */

import { notifyManualOdometerUpdate, getTodayIstDateString } from "./odometerTrackingEngine.ts";

export interface VehicleOperationTripRecord {
  id: string;
  vehicle_id: string;
  driver_id: string;
  route_id?: string | null;
  statement_number?: string | null;
  date: string;
  start: string;
  destination: string;
  distance?: number | null;
  duration?: string | null;
  status: "Ongoing" | "Completed" | "Delayed";
  start_km?: number | null;
  end_km?: number | null;
  out_date?: string | null;
  in_date?: string | null;
  out_time?: string | null;
  in_time?: string | null;
  started_at?: string | null;
  closed_at?: string | null;
  salesman_name?: string | null;
  diesel_liters?: number | null;
  fuel_liters_end?: number | null;
  fuel_amount?: number | null;
  kmpl?: number | null;
  odometer_updated_source?: string | null;
  notes?: string | null;
  created_at?: string;
  vehicles?: { number?: string; model?: string; route?: string; odometer?: number } | null;
}

export interface ClockInEligibilityInput {
  driverId?: string | null;
  assignedVehicleId?: string | null;
  hasActiveShift?: boolean;
  hasActiveDriverTrip?: boolean;
  vehicleHasOtherDriverTrip?: boolean;
  vehicleStatus?: string | null;
}

export type DriverTripPeriodFilter = "today" | "week" | "month" | "custom";

export interface TripStartValidationInput {
  vehicleId?: string | null;
  driverId?: string | null;
  assignedVehicleIds?: string[];
  vehicleOdometer?: number | null;
  hardwareOdometer?: number | null;
  outDate: string;
  outTime: string;
  hasActiveVehicleTrip?: boolean;
  hasActiveDriverTrip?: boolean;
}

export interface TripCloseValidationInput {
  tripId?: string | null;
  tripStatus?: string | null;
  tripClosedAt?: string | null;
  tripDriverId?: string | null;
  tripVehicleId?: string | null;
  authenticatedDriverId?: string | null;
  assignedVehicleIds?: string[];
  outKm: number;
  inKmRaw: string | number | null | undefined;
  currentVehicleOdometer?: number | null;
  hardwareOdometer?: number | null;
  outDate: string;
  outTime: string;
  inDate: string;
  inTime: string;
  dieselLitresRaw?: string | number | null | undefined;
  fuelAmountRaw?: string | number | null | undefined;
}

export interface ValidationFieldErrors {
  inKm?: string;
  inDate?: string;
  inTime?: string;
  dieselLitres?: string;
  fuelAmount?: string;
  general?: string;
}

export interface TripCloseValidationResult {
  valid: boolean;
  errors: ValidationFieldErrors;
  parsed?: {
    inKm: number;
    runningKm: number;
    dieselLitres: number;
    fuelAmount: number;
    kmpl: number | null;
    inDate: string;
    inTime: string;
    durationMinutes: number;
    durationLabel: string;
  };
}

/**
 * Formats current time in Asia/Kolkata as HH:MM (24-hour) for form inputs.
 */
export function getCurrentIstTimeString(refDate = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(refDate);
    const hour = parts.find((p) => p.type === "hour")?.value || "00";
    const minute = parts.find((p) => p.type === "minute")?.value || "00";
    return `${hour}:${minute}`;
  } catch {
    return refDate.toISOString().slice(11, 16);
  }
}

/**
 * Formats an ISO timestamp or date into Asia/Kolkata HH:MM string.
 */
export function formatIsoToIstTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return getCurrentIstTimeString(d);
}

/**
 * Parses a strict finite non-negative or positive numeric string (rejecting invalid chars).
 */
export function parseStrictNumericInput(
  raw: string | number | null | undefined
): { empty: boolean; valid: boolean; value: number } {
  if (raw === null || raw === undefined) {
    return { empty: true, valid: false, value: NaN };
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { empty: false, valid: false, value: NaN };
    return { empty: false, valid: true, value: Math.round(raw * 100) / 100 };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { empty: true, valid: false, value: NaN };
  }
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { empty: false, valid: false, value: NaN };
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return { empty: false, valid: false, value: NaN };
  }
  return { empty: false, valid: true, value: Math.round(num * 100) / 100 };
}

/**
 * Resolves authoritative starting Out KM from the higher of vehicle master odometer
 * and verified live hardware GPS odometer (never allowing downward tampering).
 */
export function resolveAuthoritativeOutKm(
  vehicleOdometer?: number | null,
  hardwareOdometer?: number | null
): number {
  const base = Number.isFinite(Number(vehicleOdometer)) ? Math.max(0, Number(vehicleOdometer)) : 0;
  const hw = Number.isFinite(Number(hardwareOdometer)) ? Math.max(0, Number(hardwareOdometer)) : 0;
  return Math.round(Math.max(base, hw) * 100) / 100;
}

/**
 * Parses an IST YYYY-MM-DD date and HH:MM[:SS] time into epoch ms.
 */
export function parseIstDateTimeToMs(dateStr?: string | null, timeStr?: string | null): number | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) return null;
  if (!timeStr || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(timeStr.trim())) return null;
  const normalizedTime = timeStr.trim().length === 5 ? `${timeStr.trim()}:00` : timeStr.trim();
  const ms = Date.parse(`${dateStr.trim()}T${normalizedTime}+05:30`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Calculates Running KM = In KM - Out KM safely.
 */
export function computeRunningKm(outKm: number, inKm: number): number {
  if (!Number.isFinite(outKm) || !Number.isFinite(inKm)) return 0;
  return Math.round(Math.max(0, inKm - outKm) * 100) / 100;
}

/**
 * Calculates KMPL = Running KM / Diesel Litres when diesel > 0, else null (never fabricated).
 */
export function computeTripKmpl(runningKm: number, dieselLitres: number): number | null {
  if (!Number.isFinite(runningKm) || !Number.isFinite(dieselLitres)) return null;
  if (runningKm < 0 || dieselLitres <= 0) return null;
  return Math.round((runningKm / dieselLitres) * 100) / 100;
}

export function formatDurationMinutes(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  if (mins >= 60) {
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }
  return `${mins}m`;
}

/**
 * Formats an authoritative or fallback Nanjil VIP Statement Number.
 */
export function formatStatementNumber(trip?: Partial<VehicleOperationTripRecord> | null): string {
  if (!trip) return "NVIP-PENDING";
  if (trip.statement_number && trip.statement_number.trim()) {
    return trip.statement_number.trim();
  }
  const datePart = (trip.out_date || trip.date || getTodayIstDateString()).replace(/-/g, "");
  const suffix = trip.id ? trip.id.slice(0, 4).toUpperCase() : "NEW";
  return `NVIP-${datePart}-${suffix}`;
}

/**
 * Returns IST time-of-day greeting for the Driver Clock-In header.
 */
export function getIstGreeting(refDate = new Date()): "Good Morning" | "Good Afternoon" | "Good Evening" {
  try {
    const hourStr = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).format(refDate);
    const hour = Number(hourStr);
    if (hour >= 17) return "Good Evening";
    if (hour >= 12) return "Good Afternoon";
    return "Good Morning";
  } catch {
    return "Good Morning";
  }
}

/**
 * Validates driver eligibility before clocking in.
 */
export function validateClockInEligibility(input: ClockInEligibilityInput): {
  allowed: boolean;
  error?: string;
} {
  if (!input.driverId) {
    return { allowed: false, error: "Authenticated driver profile not found. Please contact your administrator." };
  }
  if (!input.assignedVehicleId) {
    return { allowed: false, error: "No Vehicle Assigned. Please contact your administrator." };
  }
  if (input.hasActiveShift) {
    return { allowed: false, error: "Duplicate Clock In prevented: You are already clocked in." };
  }
  if (input.hasActiveDriverTrip) {
    return { allowed: false, error: "You already have an active trip in progress. Complete it first." };
  }
  if (input.vehicleHasOtherDriverTrip) {
    return { allowed: false, error: "Assigned vehicle is unavailable because another active trip is in progress." };
  }
  return { allowed: true };
}

/**
 * Filters driver trips cleanly in Asia/Kolkata timezone for Today, This Week, This Month, or Custom Date.
 */
export function filterDriverTripsByPeriod(
  trips: VehicleOperationTripRecord[],
  period: DriverTripPeriodFilter,
  customStartDate?: string,
  customEndDate?: string,
  refTodayIst?: string
): VehicleOperationTripRecord[] {
  const todayIst = refTodayIst || getTodayIstDateString();
  const [yr, mo, dy] = todayIst.split("-").map(Number);

  let startIst = todayIst;
  let endIst = todayIst;

  if (period === "week") {
    const dt = new Date(Date.UTC(yr, mo - 1, dy));
    const dayOfWeek = dt.getUTCDay(); // 0=Sun..6=Sat
    const diffToMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    dt.setUTCDate(dt.getUTCDate() - diffToMon);
    startIst = dt.toISOString().slice(0, 10);
    endIst = todayIst;
  } else if (period === "month") {
    startIst = `${String(yr)}-${String(mo).padStart(2, "0")}-01`;
    endIst = todayIst;
  } else if (period === "custom") {
    const s = (customStartDate || todayIst).trim();
    const e = (customEndDate || s).trim();
    startIst = s <= e ? s : e;
    endIst = s <= e ? e : s;
  }

  return (trips || []).filter((t) => {
    const tripDate = (t.in_date || t.out_date || t.date || "").slice(0, 10);
    if (!tripDate) return false;
    return tripDate >= startIst && tripDate <= endIst;
  });
}

/**
 * Validates whether a driver is allowed to start a new trip on the assigned vehicle.
 */
export function validateTripStart(input: TripStartValidationInput): {
  valid: boolean;
  error?: string;
  outKm: number;
} {
  if (!input.driverId) {
    return { valid: false, error: "Driver profile not found. Please contact fleet admin.", outKm: 0 };
  }
  if (!input.vehicleId) {
    return { valid: false, error: "No assigned vehicle found for your account.", outKm: 0 };
  }
  if (input.assignedVehicleIds && !input.assignedVehicleIds.includes(input.vehicleId)) {
    return { valid: false, error: "Unauthorized: You are not assigned to this vehicle.", outKm: 0 };
  }
  if (input.hasActiveVehicleTrip) {
    return {
      valid: false,
      error: "An active trip is already open for this vehicle. Close it before starting another trip.",
      outKm: 0,
    };
  }
  if (input.hasActiveDriverTrip) {
    return {
      valid: false,
      error: "You already have an ongoing trip in progress. Close it before starting a new trip.",
      outKm: 0,
    };
  }
  if (!parseIstDateTimeToMs(input.outDate, input.outTime)) {
    return { valid: false, error: "Valid Out Date and Out Time (HH:MM) are required.", outKm: 0 };
  }

  const outKm = resolveAuthoritativeOutKm(input.vehicleOdometer, input.hardwareOdometer);
  return { valid: true, outKm };
}

/**
 * Validates Trip Closing & Vehicle Operation Statement before database submission.
 * Mirrors the exact server-side PL/pgSQL RPC checks for instant UX feedback.
 */
export function validateTripCloseStatement(
  input: TripCloseValidationInput
): TripCloseValidationResult {
  const errors: ValidationFieldErrors = {};

  if (!input.tripId) {
    errors.general = "Active trip not found.";
    return { valid: false, errors };
  }

  if (input.tripStatus === "Completed" || Boolean(input.tripClosedAt)) {
    errors.general = "Duplicate submission rejected: This trip has already been closed.";
    return { valid: false, errors };
  }

  if (!input.authenticatedDriverId || input.tripDriverId !== input.authenticatedDriverId) {
    errors.general = "Unauthorized: You cannot close another driver's trip.";
    return { valid: false, errors };
  }

  if (
    input.assignedVehicleIds &&
    input.tripVehicleId &&
    !input.assignedVehicleIds.includes(input.tripVehicleId)
  ) {
    errors.general = "Unauthorized: Your vehicle assignment is not active.";
    return { valid: false, errors };
  }

  // 1. Validate In KM
  const parsedInKm = parseStrictNumericInput(input.inKmRaw);
  if (parsedInKm.empty) {
    errors.inKm = "In KM is mandatory.";
  } else if (!parsedInKm.valid) {
    errors.inKm = "In KM must contain only valid digits.";
  } else if (parsedInKm.value <= 0) {
    errors.inKm = "Invalid Odometer Reading! In KM cannot be zero or negative.";
  } else {
    const outKm = Math.round(Math.max(0, Number(input.outKm || 0)) * 100) / 100;
    const masterOdo = Math.round(
      Math.max(0, Number(input.currentVehicleOdometer || 0)) * 100
    ) / 100;
    const hwOdo = Math.round(
      Math.max(0, Number(input.hardwareOdometer || 0)) * 100
    ) / 100;

    if (parsedInKm.value < outKm) {
      errors.inKm = "Invalid Odometer Reading! In KM cannot be less than Out KM.";
    } else if (parsedInKm.value < masterOdo) {
      errors.inKm = `Invalid Odometer Reading! In KM cannot be less than vehicle's current odometer (${masterOdo.toLocaleString()} KM).`;
    } else if (hwOdo > 0 && hwOdo > parsedInKm.value) {
      errors.inKm = `Stale odometer reading: GPS hardware odometer (${hwOdo.toLocaleString()} KM) has already advanced beyond submitted In KM (${parsedInKm.value.toLocaleString()} KM). Reconciliation required.`;
    }
  }

  // 2. Validate In Date & In Time vs Out Date & Out Time
  const outMs = parseIstDateTimeToMs(input.outDate, input.outTime);
  const inMs = parseIstDateTimeToMs(input.inDate, input.inTime);
  if (!input.inDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.inDate.trim())) {
    errors.inDate = "Valid In Date is required.";
  }
  if (!input.inTime || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(input.inTime.trim())) {
    errors.inTime = "Valid In Time is required.";
  }
  if (input.inDate && input.outDate && input.inDate.trim() < input.outDate.trim()) {
    errors.inDate = "In Date cannot be earlier than Out Date.";
  }
  if (outMs !== null && inMs !== null && Math.floor(inMs / 60000) < Math.floor(outMs / 60000)) {
    errors.inTime = "In Date and In Time cannot be earlier than Out Date and Out Time.";
  }

  // 3. Validate Diesel & Fuel Amount (optional, must be >= 0)
  let dieselLitres = 0;
  const parsedDiesel = parseStrictNumericInput(input.dieselLitresRaw);
  if (!parsedDiesel.empty) {
    if (!parsedDiesel.valid || parsedDiesel.value < 0) {
      errors.dieselLitres = "Please enter a valid non-negative diesel quantity.";
    } else {
      dieselLitres = parsedDiesel.value;
    }
  }

  let fuelAmount = 0;
  const parsedAmount = parseStrictNumericInput(input.fuelAmountRaw);
  if (!parsedAmount.empty) {
    if (!parsedAmount.valid || parsedAmount.value < 0) {
      errors.fuelAmount = "Please enter a valid non-negative fuel amount.";
    } else {
      fuelAmount = parsedAmount.value;
    }
  }

  const hasErrors = Object.values(errors).some(Boolean);
  if (hasErrors || !parsedInKm.valid) {
    return { valid: false, errors };
  }

  const runningKm = computeRunningKm(Number(input.outKm || 0), parsedInKm.value);
  const kmpl = computeTripKmpl(runningKm, dieselLitres);
  const durationMinutes =
    outMs !== null && inMs !== null ? Math.max(0, Math.round((inMs - outMs) / 60000)) : 0;

  return {
    valid: true,
    errors: {},
    parsed: {
      inKm: parsedInKm.value,
      runningKm,
      dieselLitres,
      fuelAmount,
      kmpl,
      inDate: input.inDate.trim(),
      inTime: input.inTime.trim().slice(0, 5),
      durationMinutes,
      durationLabel: formatDurationMinutes(durationMinutes),
    },
  };
}

/**
 * Clocks in an authenticated driver after verifying admin vehicle assignment & availability.
 */
export async function submitDriverClockIn(supabaseClient: any): Promise<{
  ok: boolean;
  shift?: any;
  vehicle?: any;
  authoritativeOdometer?: number;
  hasActiveTrip?: boolean;
  activeTrip?: VehicleOperationTripRecord | null;
  error?: string;
}> {
  const { data, error } = await supabaseClient.rpc("driver_clock_in");
  if (error) {
    return { ok: false, error: formatRpcErrorMessage(error.message) };
  }
  return {
    ok: true,
    shift: data?.shift,
    vehicle: data?.vehicle,
    authoritativeOdometer:
      data?.authoritative_odometer != null ? Number(data.authoritative_odometer) : undefined,
    hasActiveTrip: Boolean(data?.has_active_trip),
    activeTrip: (data?.active_trip as VehicleOperationTripRecord) || null,
  };
}

/**
 * Clocks out an authenticated driver shift when no Ongoing trip remains unclosed.
 */
export async function submitDriverClockOut(supabaseClient: any): Promise<{
  ok: boolean;
  shift?: any;
  error?: string;
}> {
  const { data, error } = await supabaseClient.rpc("driver_clock_out");
  if (error) {
    return { ok: false, error: formatRpcErrorMessage(error.message) };
  }
  return { ok: true, shift: data?.shift };
}

/**
 * Starts a driver trip statement exclusively via the authenticated server RPC.
 */
export async function submitStartDriverTripStatement(
  supabaseClient: any,
  params: {
    vehicleId: string;
    route?: string;
    routeId?: string | null;
    salesmanName?: string;
    outDate?: string;
    outTime?: string;
    notes?: string;
  }
): Promise<{
  ok: boolean;
  trip?: VehicleOperationTripRecord;
  outKm?: number;
  error?: string;
}> {
  const { data, error } = await supabaseClient.rpc("start_driver_trip_statement", {
    p_vehicle_id: params.vehicleId,
    p_route: params.route || null,
    p_route_id: params.routeId || null,
    p_salesman_name: params.salesmanName?.trim() || null,
    p_out_date: params.outDate || getTodayIstDateString(),
    p_out_time: params.outTime || getCurrentIstTimeString(),
    p_notes: params.notes?.trim() || null,
  });

  if (error) {
    return { ok: false, error: formatRpcErrorMessage(error.message) };
  }

  return {
    ok: true,
    trip: data?.trip as VehicleOperationTripRecord | undefined,
    outKm: data?.out_km != null ? Number(data.out_km) : undefined,
  };
}

/**
 * Closes a driver trip statement atomically via the authenticated server RPC
 * and notifies local odometer tracking state so GPS tracking continues seamlessly
 * from the updated baseline without double accumulation.
 */
export async function submitCloseDriverTripStatement(
  supabaseClient: any,
  params: {
    tripId: string;
    inKm: number;
    inDate: string;
    inTime: string;
    dieselLitres?: number;
    fuelAmount?: number;
    salesmanName?: string;
    notes?: string;
    deviceId?: string;
  }
): Promise<{
  ok: boolean;
  trip?: VehicleOperationTripRecord;
  vehicleId?: string;
  vehicleOdometer?: number;
  runningKm?: number;
  kmpl?: number | null;
  error?: string;
}> {
  const { data, error } = await supabaseClient.rpc("close_driver_trip_statement", {
    p_trip_id: params.tripId,
    p_in_km: params.inKm,
    p_in_date: params.inDate,
    p_in_time: params.inTime,
    p_diesel_liters: params.dieselLitres ?? 0,
    p_fuel_amount: params.fuelAmount ?? 0,
    p_salesman_name: params.salesmanName?.trim() || null,
    p_notes: params.notes?.trim() || null,
  });

  if (error) {
    return { ok: false, error: formatRpcErrorMessage(error.message) };
  }

  const updatedOdo = data?.vehicle_odometer != null ? Number(data.vehicle_odometer) : params.inKm;
  const vId = data?.vehicle_id as string | undefined;

  if (vId && Number.isFinite(updatedOdo)) {
    notifyManualOdometerUpdate(vId, updatedOdo, params.deviceId);
  }

  return {
    ok: true,
    trip: data?.trip as VehicleOperationTripRecord | undefined,
    vehicleId: vId,
    vehicleOdometer: updatedOdo,
    runningKm: data?.running_km != null ? Number(data.running_km) : undefined,
    kmpl: data?.kmpl != null ? Number(data.kmpl) : null,
  };
}

/**
 * Logs driver fuel refill via authenticated server RPC and synchronizes local odometer state.
 */
export async function submitDriverFuelRefillRpc(
  supabaseClient: any,
  params: {
    vehicleId: string;
    liters: number;
    cost: number;
    odometer: number;
    isFullTank: boolean;
    pricePerLiter?: number;
    station?: string;
    receiptRef?: string;
    deviceId?: string;
  }
): Promise<{ ok: boolean; vehicleOdometer?: number; fuelLog?: any; error?: string }> {
  let { data, error } = await supabaseClient.rpc("log_driver_fuel_refill", {
    p_vehicle_id: params.vehicleId,
    p_liters: params.liters,
    p_cost: params.cost,
    p_odometer: params.odometer,
    p_is_full_tank: params.isFullTank,
    p_price_per_liter: params.pricePerLiter ?? null,
    p_station: params.station?.trim() || null,
    p_receipt_ref: params.receiptRef?.trim() || null,
  });

  // Backwards-compatible fallback if remote DB only has the earlier 5-parameter RPC deployed
  if (
    error &&
    (error.message?.includes("Could not find the function") || error.message?.includes("PGRST202"))
  ) {
    const legacyRes = await supabaseClient.rpc("log_driver_fuel_refill", {
      p_vehicle_id: params.vehicleId,
      p_liters: params.liters,
      p_cost: params.cost,
      p_odometer: params.odometer,
      p_is_full_tank: params.isFullTank,
    });
    data = legacyRes.data;
    error = legacyRes.error;
  }

  if (error) {
    return { ok: false, error: formatRpcErrorMessage(error.message) };
  }

  const updatedOdo = data?.vehicle_odometer != null ? Number(data.vehicle_odometer) : params.odometer;
  if (params.vehicleId && Number.isFinite(updatedOdo)) {
    notifyManualOdometerUpdate(params.vehicleId, updatedOdo, params.deviceId);
  }

  return { ok: true, vehicleOdometer: updatedOdo, fuelLog: data?.fuel_log };
}

function formatRpcErrorMessage(raw?: string): string {
  if (!raw) return "Operation failed due to a server validation error.";
  if (raw.includes("Could not find the function") || raw.includes("PGRST202")) {
    return "Database RPC is not deployed yet. Apply migration 20261125163000_driver_dashboard_vip_workflow.sql in Supabase.";
  }
  return raw;
}
