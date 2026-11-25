import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveReportDateBounds,
  formatOperationStatementRows,
  aggregateOperationReportKpis,
  buildOperationVehicleChartData,
  buildOperationReportCsv,
  buildAllVehiclesOperationSummary,
  buildAllVehiclesOperationCsv,
  filterAndSortReportRows,
} from "../src/lib/operationReport.ts";

const REF_DATE = new Date("2026-11-25T05:30:00.000Z"); // 2026-11-25 IST

const SAMPLE_TRIPS = [
  {
    id: "trip-1",
    vehicle_id: "v1",
    driver_id: "d1",
    date: "2026-11-24",
    start: "Nagercoil Plant",
    destination: "Marthandam",
    start_km: 66755,
    end_km: 66820,
    distance: 65,
    duration: "2h 15m",
    out_date: "2026-11-24",
    in_date: "2026-11-24",
    out_time: "06:00",
    in_time: "08:15",
    diesel_liters: 13,
    fuel_amount: 1235,
    kmpl: 5,
    salesman_name: "Kumar",
    odometer_updated_source: "DRIVER_TRIP_CLOSURE",
    status: "Completed",
    vehicles: { id: "v1", number: "TN 75 BE 7871" },
    drivers: { id: "d1", name: "R S Michel Raj" },
  },
  {
    id: "trip-2",
    vehicle_id: "v2",
    driver_id: "d2",
    date: "2026-11-25",
    start: "Mulagumoodu",
    destination: "Thuckalay",
    start_km: 10035,
    end_km: 10085,
    distance: 50,
    duration: "1h 40m",
    out_date: "2026-11-25",
    in_date: "2026-11-25",
    out_time: "05:30",
    in_time: "07:10",
    diesel_liters: 0,
    fuel_amount: 0,
    kmpl: null,
    status: "Completed",
    vehicles: { id: "v2", number: "TN 75 BC 2219" },
    drivers: { id: "d2", name: "SUVIN V." },
  },
  {
    id: "trip-3",
    vehicle_id: "v2",
    driver_id: "d2",
    date: "2026-11-25",
    start: "Mulagumoodu",
    destination: "Kuzhithurai",
    start_km: 10085,
    out_date: "2026-11-25",
    out_time: "11:00",
    status: "Ongoing",
    vehicles: { id: "v2", number: "TN 75 BC 2219" },
    drivers: { id: "d2", name: "SUVIN V." },
  },
];

test("1. formatOperationStatementRows respects IST date filtering, vehicle, and driver filters", () => {
  const yestBounds = resolveReportDateBounds("yesterday", undefined, undefined, REF_DATE);
  const yestRows = formatOperationStatementRows(SAMPLE_TRIPS, yestBounds);
  assert.equal(yestRows.length, 1);
  assert.equal(yestRows[0].vehicle, "TN 75 BE 7871");
  assert.equal(yestRows[0].runningKmNum, 65);
  assert.equal(yestRows[0].kmplNum, 5);
  assert.equal(yestRows[0].salesman, "Kumar");

  const monthBounds = resolveReportDateBounds("month", undefined, undefined, REF_DATE);
  const vehRows = formatOperationStatementRows(SAMPLE_TRIPS, monthBounds, {
    vehicleNumber: "TN 75 BC 2219",
  });
  assert.equal(vehRows.length, 2);
});

test("2. aggregateOperationReportKpis & buildOperationVehicleChartData compute authentic Running KM and KMPL", () => {
  const monthBounds = resolveReportDateBounds("month", undefined, undefined, REF_DATE);
  const rows = formatOperationStatementRows(SAMPLE_TRIPS, monthBounds);
  const kpis = aggregateOperationReportKpis(rows);

  assert.equal(kpis.totalStatements, 3);
  assert.equal(kpis.completedStatements, 2);
  assert.equal(kpis.ongoingStatements, 1);
  assert.equal(kpis.totalRunningKm, 115);
  assert.equal(kpis.totalDieselLitres, 13);
  assert.equal(kpis.totalFuelAmount, 1235);
  assert.equal(kpis.weightedKmpl, 8.85); // 115 / 13 = 8.846 -> 8.85
  assert.equal(kpis.activeVehiclesCount, 2);

  const chart = buildOperationVehicleChartData(rows);
  assert.equal(chart.length, 2);
  const v1Chart = chart.find((c) => c.fullVehicle === "TN 75 BE 7871");
  assert.equal(v1Chart?.runningKm, 65);
  assert.equal(v1Chart?.kmpl, 5);
});

test("3. Zero diesel statements yield '-' KMPL without fabricating mileage and export filtered CSV cleanly", () => {
  const todayBounds = resolveReportDateBounds("today", undefined, undefined, REF_DATE);
  const rows = formatOperationStatementRows(SAMPLE_TRIPS, todayBounds);
  const completedOnly = filterAndSortReportRows(rows, { statusFilter: "Completed" });

  assert.equal(completedOnly.length, 1);
  assert.equal(completedOnly[0].kmpl, "-");

  const csv = buildOperationReportCsv(completedOnly);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("TN 75 BC 2219"));
  assert.ok(!csv.includes("TN 75 BE 7871"));
});

test("4. buildAllVehiclesOperationSummary shows ALL fleet vehicles including non-GPS and zero-trip vehicles", () => {
  const monthBounds = resolveReportDateBounds("month", undefined, undefined, REF_DATE);
  const statements = formatOperationStatementRows(SAMPLE_TRIPS, monthBounds);
  const allVehicles = [
    { id: "v1", number: "TN 75 BE 7871", model: "Ashok Leyland", odometer: 66820, driver_name: "R S Michel Raj", status: "Idle" },
    { id: "v2", number: "TN 75 BC 2219", model: "Tanker 10KL", odometer: 10085, driver_name: "SUVIN V.", status: "Moving" },
    { id: "v3", number: "TN 75 BJ 9939", model: "Container", odometer: 5400, driver_name: "C.J. Pravin", status: "Idle" },
  ];

  const summary = buildAllVehiclesOperationSummary(allVehicles, statements);
  assert.equal(summary.length, 3);
  const v3 = summary.find((s) => s.vehicle === "TN 75 BJ 9939");
  assert.equal(v3?.tripsCount, 0);
  assert.equal(v3?.currentOdometer, "5,400 km");
  assert.equal(v3?.runningKm, "0 km");

  const v1 = summary.find((s) => s.vehicle === "TN 75 BE 7871");
  assert.equal(v1?.tripsCount, 1);
  assert.equal(v1?.runningKm, "65 km");
  assert.equal(v1?.kmpl, "5.00 km/L");

  const csv = buildAllVehiclesOperationCsv(summary);
  assert.ok(csv.includes("TN 75 BJ 9939"));
});
