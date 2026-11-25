/**
 * operationReport.ts — Nanjil Dairy Operation Management Report Engine
 *
 * Computes KPIs, vehicle-wise running KM / Diesel / KMPL breakdowns,
 * statement table formatting, sorting/filtering, and CSV exports
 * from authentic Driver Vehicle Operation Statements (`trips`) and
 * odometer audit trail (`odometer_audit_logs`).
 */

import {
  resolveReportDateBounds,
  filterRecordsByIstRange,
  filterAndSortReportRows,
  buildReportCsv,
  type ReportDateMode,
  type ReportDateBounds,
} from "./dailyActivityReport.ts";
import { computeRunningKm, computeTripKmpl } from "./driverOperationStatement.ts";

export interface RawOperationTripRow {
  id: string;
  vehicle_id?: string | null;
  driver_id?: string | null;
  date?: string | null;
  start?: string | null;
  destination?: string | null;
  distance?: number | null;
  duration?: string | null;
  status?: string | null;
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
  created_at?: string | null;
  vehicles?: { id?: string; number?: string; odometer?: number; route?: string } | null;
  drivers?: { id?: string; name?: string } | null;
}

export interface FormattedOperationStatementRow {
  id: string;
  vehicleId: string;
  driverId: string;
  date: string;
  vehicle: string;
  route: string;
  driver: string;
  salesman: string;
  outDateTime: string;
  inDateTime: string;
  outKmNum: number;
  inKmNum: number | null;
  runningKmNum: number;
  dieselNum: number;
  fuelAmountNum: number;
  kmplNum: number | null;
  outKm: string;
  inKm: string;
  runningKm: string;
  dieselLitres: string;
  fuelAmount: string;
  kmpl: string;
  duration: string;
  odometerSource: string;
  status: string;
  raw: RawOperationTripRow;
}

export interface OperationReportKpis {
  totalStatements: number;
  completedStatements: number;
  ongoingStatements: number;
  totalRunningKm: number;
  totalDieselLitres: number;
  totalFuelAmount: number;
  weightedKmpl: number | null;
  avgRunningKmPerTrip: number;
  activeVehiclesCount: number;
}

export interface OperationVehicleChartPoint {
  name: string;
  fullVehicle: string;
  runningKm: number;
  dieselLitres: number;
  fuelAmount: number;
  kmpl: number;
  tripsCount: number;
}

/**
 * Resolves the canonical IST reference timestamp for filtering a trip statement by date range.
 */
export function getTripStatementFilterTimestamp(t: RawOperationTripRow): string | null {
  if (t.closed_at) return t.closed_at;
  if (t.started_at) return t.started_at;
  if (t.in_date && /^\d{4}-\d{2}-\d{2}$/.test(t.in_date)) {
    return `${t.in_date}T12:00:00+05:30`;
  }
  if (t.out_date && /^\d{4}-\d{2}-\d{2}$/.test(t.out_date)) {
    return `${t.out_date}T12:00:00+05:30`;
  }
  if (t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date)) {
    return `${t.date}T12:00:00+05:30`;
  }
  return t.created_at || null;
}

/**
 * Formats raw Supabase `trips` records into standardized Nanjil Dairy Operation Statement rows.
 */
export function formatOperationStatementRows(
  rawTrips: RawOperationTripRow[],
  dateBounds: ReportDateBounds,
  filters?: { vehicleNumber?: string; driverName?: string }
): FormattedOperationStatementRow[] {
  let list = filterRecordsByIstRange(rawTrips || [], getTripStatementFilterTimestamp, dateBounds);

  if (filters?.vehicleNumber && filters.vehicleNumber !== "All") {
    list = list.filter((t) => (t.vehicles?.number || "") === filters.vehicleNumber);
  }
  if (filters?.driverName && filters.driverName !== "All") {
    list = list.filter((t) => (t.drivers?.name || "") === filters.driverName);
  }

  return list.map((t) => {
    const outKmNum = Math.round(Math.max(0, Number(t.start_km ?? 0)) * 100) / 100;
    const hasEndKm = t.end_km != null && Number.isFinite(Number(t.end_km));
    const inKmNum = hasEndKm ? Math.round(Number(t.end_km) * 100) / 100 : null;
    const runningKmNum =
      t.distance != null && Number.isFinite(Number(t.distance))
        ? Math.round(Math.max(0, Number(t.distance)) * 100) / 100
        : inKmNum != null
        ? computeRunningKm(outKmNum, inKmNum)
        : 0;

    const dieselNum =
      Math.round(Math.max(0, Number(t.diesel_liters ?? t.fuel_liters_end ?? 0)) * 100) / 100;
    const fuelAmountNum = Math.round(Math.max(0, Number(t.fuel_amount ?? 0)) * 100) / 100;
    const kmplNum =
      t.kmpl != null && Number.isFinite(Number(t.kmpl)) && Number(t.kmpl) > 0
        ? Math.round(Number(t.kmpl) * 100) / 100
        : computeTripKmpl(runningKmNum, dieselNum);

    const outDate = t.out_date || t.date || "-";
    const outTime = t.out_time || "";
    const inDate = t.in_date || (t.status === "Completed" ? t.date || "-" : "-");
    const inTime = t.in_time || "";

    const route = t.destination
      ? `${t.start || ""} -> ${t.destination}`
      : t.start || t.vehicles?.route || "-";

    return {
      id: t.id,
      vehicleId: String(t.vehicle_id || t.vehicles?.id || ""),
      driverId: String(t.driver_id || t.drivers?.id || ""),
      date: t.in_date || t.out_date || t.date || "-",
      vehicle: t.vehicles?.number || "Fleet Unit",
      route,
      driver: t.drivers?.name || "Driver",
      salesman: t.salesman_name || "-",
      outDateTime: outTime ? `${outDate} · ${outTime}` : outDate,
      inDateTime: t.status === "Completed" ? (inTime ? `${inDate} · ${inTime}` : inDate) : "Active",
      outKmNum,
      inKmNum,
      runningKmNum,
      dieselNum,
      fuelAmountNum,
      kmplNum,
      outKm: `${outKmNum.toLocaleString()} km`,
      inKm: inKmNum != null ? `${inKmNum.toLocaleString()} km` : "-",
      runningKm: inKmNum != null || runningKmNum > 0 ? `${runningKmNum.toLocaleString()} km` : "-",
      dieselLitres: `${dieselNum.toFixed(1)} L`,
      fuelAmount: `₹ ${Math.round(fuelAmountNum).toLocaleString("en-IN")}`,
      kmpl: kmplNum != null ? `${kmplNum.toFixed(2)} km/L` : "-",
      duration: t.duration || "-",
      odometerSource: t.odometer_updated_source || (t.status === "Completed" ? "DRIVER_TRIP_CLOSURE" : "OPEN"),
      status: t.status || "Ongoing",
      raw: t,
    };
  });
}

/**
 * Computes top-level Operation Management KPIs strictly from filtered statement rows.
 */
export function aggregateOperationReportKpis(
  rows: FormattedOperationStatementRow[]
): OperationReportKpis {
  const uniqueVehicles = new Set<string>();
  let completedStatements = 0;
  let ongoingStatements = 0;
  let totalRunningKm = 0;
  let totalDieselLitres = 0;
  let totalFuelAmount = 0;

  for (const r of rows) {
    if (r.vehicle) uniqueVehicles.add(r.vehicle);
    if (r.status === "Completed") completedStatements++;
    else if (r.status === "Ongoing") ongoingStatements++;
    totalRunningKm += r.runningKmNum;
    totalDieselLitres += r.dieselNum;
    totalFuelAmount += r.fuelAmountNum;
  }

  const roundedKm = Math.round(totalRunningKm * 10) / 10;
  const roundedDiesel = Math.round(totalDieselLitres * 10) / 10;
  const roundedFuelAmt = Math.round(totalFuelAmount * 100) / 100;
  const weightedKmpl =
    roundedDiesel > 0 && roundedKm > 0
      ? Math.round((roundedKm / roundedDiesel) * 100) / 100
      : null;
  const divisor = completedStatements > 0 ? completedStatements : rows.length;
  const avgRunningKmPerTrip = divisor > 0 ? Math.round((roundedKm / divisor) * 10) / 10 : 0;

  return {
    totalStatements: rows.length,
    completedStatements,
    ongoingStatements,
    totalRunningKm: roundedKm,
    totalDieselLitres: roundedDiesel,
    totalFuelAmount: roundedFuelAmt,
    weightedKmpl,
    avgRunningKmPerTrip,
    activeVehiclesCount: uniqueVehicles.size,
  };
}

/**
 * Aggregates filtered Operation Statements by vehicle for dashboard visualizations.
 */
export function buildOperationVehicleChartData(
  rows: FormattedOperationStatementRow[]
): OperationVehicleChartPoint[] {
  const byVehicle = new Map<
    string,
    { km: number; diesel: number; fuelAmt: number; trips: number }
  >();

  for (const r of rows) {
    const v = r.vehicle || "Fleet Unit";
    const cur = byVehicle.get(v) || { km: 0, diesel: 0, fuelAmt: 0, trips: 0 };
    cur.km += r.runningKmNum;
    cur.diesel += r.dieselNum;
    cur.fuelAmt += r.fuelAmountNum;
    cur.trips += 1;
    byVehicle.set(v, cur);
  }

  return Array.from(byVehicle.entries()).map(([fullVehicle, v]) => {
    const runningKm = Math.round(v.km * 10) / 10;
    const dieselLitres = Math.round(v.diesel * 10) / 10;
    const kmpl =
      dieselLitres > 0 && runningKm > 0 ? Math.round((runningKm / dieselLitres) * 100) / 100 : 0;
    return {
      name: fullVehicle.replace(/^TN\s+75\s+/i, ""),
      fullVehicle,
      runningKm,
      dieselLitres,
      fuelAmount: Math.round(v.fuelAmt),
      kmpl,
      tripsCount: v.trips,
    };
  });
}

export interface AllVehicleOperationSummaryRow {
  vehicleId: string;
  vehicle: string;
  model: string;
  driver: string;
  route: string;
  currentOdometerNum: number;
  currentOdometer: string;
  tripsCount: number;
  runningKmNum: number;
  runningKm: string;
  dieselNum: number;
  dieselLitres: string;
  fuelAmountNum: number;
  fuelAmount: string;
  kmpl: string;
  odometerSource: string;
  status: string;
}

/**
 * Builds an operation summary row for EVERY fleet vehicle (both GPS and non-GPS),
 * combining vehicle master metadata with filtered Operation Statement metrics.
 */
export function buildAllVehiclesOperationSummary(
  allVehicles: Array<{
    id: string;
    number: string;
    model?: string | null;
    type?: string | null;
    driver_name?: string | null;
    route?: string | null;
    odometer?: number | null;
    odometer_source?: string | null;
    status?: string | null;
  }>,
  statements: FormattedOperationStatementRow[]
): AllVehicleOperationSummaryRow[] {
  const byVehId = new Map<string, FormattedOperationStatementRow[]>();
  const byVehNum = new Map<string, FormattedOperationStatementRow[]>();

  for (const s of statements) {
    if (s.vehicleId) {
      const list = byVehId.get(s.vehicleId) || [];
      list.push(s);
      byVehId.set(s.vehicleId, list);
    }
    const keyNum = (s.vehicle || "").replace(/\s+/g, "").toUpperCase();
    if (keyNum) {
      const list = byVehNum.get(keyNum) || [];
      list.push(s);
      byVehNum.set(keyNum, list);
    }
  }

  return (allVehicles || [])
    .map((v) => {
      const keyNum = (v.number || "").replace(/\s+/g, "").toUpperCase();
      const matched =
        (v.id && byVehId.get(v.id)) || (keyNum && byVehNum.get(keyNum)) || [];

      let runningKmNum = 0;
      let dieselNum = 0;
      let fuelAmountNum = 0;
      let completed = 0;
      let ongoing = 0;

      for (const s of matched) {
        runningKmNum += s.runningKmNum;
        dieselNum += s.dieselNum;
        fuelAmountNum += s.fuelAmountNum;
        if (s.status === "Completed") completed++;
        else if (s.status === "Ongoing") ongoing++;
      }

      runningKmNum = Math.round(runningKmNum * 10) / 10;
      dieselNum = Math.round(dieselNum * 10) / 10;
      fuelAmountNum = Math.round(fuelAmountNum * 100) / 100;
      const kmplNum = computeTripKmpl(runningKmNum, dieselNum);
      const latest = matched[0];
      const currentOdometerNum = Math.round(Math.max(0, Number(v.odometer ?? 0)) * 100) / 100;

      let status = v.status || "Idle";
      if (ongoing > 0) status = "Ongoing";
      else if (completed > 0) status = `${completed} Closed`;

      return {
        vehicleId: v.id,
        vehicle: v.number,
        model: v.model || v.type || "-",
        driver: v.driver_name || latest?.driver || "Unassigned",
        route: v.route || latest?.route || "-",
        currentOdometerNum,
        currentOdometer: `${currentOdometerNum.toLocaleString()} km`,
        tripsCount: matched.length,
        runningKmNum,
        runningKm: `${runningKmNum.toLocaleString()} km`,
        dieselNum,
        dieselLitres: `${dieselNum.toFixed(1)} L`,
        fuelAmountNum,
        fuelAmount: `₹ ${Math.round(fuelAmountNum).toLocaleString("en-IN")}`,
        kmpl: kmplNum != null ? `${kmplNum.toFixed(2)} km/L` : "-",
        odometerSource: v.odometer_source || latest?.odometerSource || "MASTER",
        status,
      };
    })
    .sort((a, b) => a.vehicle.localeCompare(b.vehicle));
}

export function buildAllVehiclesOperationCsv(rows: AllVehicleOperationSummaryRow[]): string {
  return buildReportCsv(
    rows.map((r) => ({
      vehicle: r.vehicle,
      model: r.model,
      driver: r.driver,
      route: r.route,
      currentOdometer: r.currentOdometer,
      tripsCount: r.tripsCount,
      runningKm: r.runningKm,
      dieselLitres: r.dieselLitres,
      fuelAmount: r.fuelAmount,
      kmpl: r.kmpl,
      odometerSource: r.odometerSource,
      status: r.status,
    }))
  );
}

/**
 * Exports strictly filtered Operation Statements to RFC-4180 CSV with UTF-8 BOM.
 */
export function buildOperationReportCsv(rows: FormattedOperationStatementRow[]): string {
  const exportRows = rows.map((r) => ({
    date: r.date,
    vehicle: r.vehicle,
    route: r.route,
    driver: r.driver,
    salesman: r.salesman,
    outDateTime: r.outDateTime,
    inDateTime: r.inDateTime,
    outKm: r.outKm,
    inKm: r.inKm,
    runningKm: r.runningKm,
    dieselLitres: r.dieselLitres,
    fuelAmount: r.fuelAmount,
    kmpl: r.kmpl,
    duration: r.duration,
    odometerSource: r.odometerSource,
    status: r.status,
  }));
  return buildReportCsv(exportRows);
}

export {
  resolveReportDateBounds,
  filterAndSortReportRows,
  type ReportDateMode,
  type ReportDateBounds,
};
