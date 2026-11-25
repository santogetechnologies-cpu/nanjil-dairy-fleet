import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveReportDateBounds,
  filterRecordsByIstRange,
  resolveFleetVehicleModel,
  buildDailyActivityRow,
  buildVehicleDailyHistoryRows,
  aggregateDailyActivitySummary,
  formatDurationCompact,
  computeIdleParkedBreakdown,
  filterAndSortReportRows,
  buildReportCsv,
  computeOtherReportInsights,
} from "../src/lib/dailyActivityReport.ts";

const REF_DATE = new Date("2026-11-25T05:30:00.000Z"); // 2026-11-25 11:00:00 IST

test("1. Date-wise IST bounds: Yesterday strictly excludes Today records", () => {
  const bounds = resolveReportDateBounds("yesterday", undefined, undefined, REF_DATE);
  assert.equal(bounds.startIstDate, "2026-11-24");
  assert.equal(bounds.endIstDate, "2026-11-24");
  assert.equal(bounds.daySpan, 1);

  const records = [
    { id: "yest-early", ts: "2026-11-23T19:00:00.000Z" }, // Nov 24 00:30 IST
    { id: "yest-late", ts: "2026-11-24T18:00:00.000Z" },  // Nov 24 23:30 IST
    { id: "today-early", ts: "2026-11-24T20:53:48.000Z" }, // Nov 25 02:23 IST (MUST BE EXCLUDED)
  ];

  const filtered = filterRecordsByIstRange(records, (r) => r.ts, bounds);
  assert.deepEqual(filtered.map((r) => r.id), ["yest-early", "yest-late"]);
});

test("2. Date-wise IST bounds: Custom single date and multi-day reversed bounds normalize cleanly", () => {
  const single = resolveReportDateBounds("custom", "2026-11-19", "2026-11-19", REF_DATE);
  assert.equal(single.daySpan, 1);
  assert.equal(single.displayLabel, "Date: 2026-11-19");

  const reversed = resolveReportDateBounds("custom", "2026-11-24", "2026-11-22", REF_DATE);
  assert.equal(reversed.startIstDate, "2026-11-22");
  assert.equal(reversed.endIstDate, "2026-11-24");
  assert.equal(reversed.daySpan, 3);
});

test("3. resolveFleetVehicleModel replaces Unknown Model using KNOWN_NANJIL_DEVICE_MAP", () => {
  assert.equal(
    resolveFleetVehicleModel("Unknown Model", "Tanker 10KL", "863110086192104"),
    "Tanker 10KL"
  );
  assert.equal(
    resolveFleetVehicleModel("Unknown Model", "Container", "863110086164111"),
    "Mahindra Bolero Maxi Truck"
  );
  assert.equal(
    resolveFleetVehicleModel("Eicher Pro 2049", "Tanker", "863110086146753"),
    "Eicher Pro 2049"
  );
});

test("4. buildDailyActivityRow computes distance, trips, duration, and live Today status", () => {
  const boundsYest = resolveReportDateBounds("yesterday", undefined, undefined, REF_DATE);
  const pts = [
    { id: "1", lat: 8.2607, lng: 77.2882, speed: 40, ignition: true, recorded_at: "2026-11-24T01:00:00.000Z", odometer: 1000 },
    { id: "2", lat: 8.2807, lng: 77.3082, speed: 45, ignition: true, recorded_at: "2026-11-24T01:05:00.000Z", odometer: 1003 },
    { id: "3", lat: 8.3007, lng: 77.3282, speed: 42, ignition: true, recorded_at: "2026-11-24T01:10:00.000Z", odometer: 1006 },
  ];

  const row = buildDailyActivityRow({
    vehicle: {
      id: "325081e0-a535-4269-8239-582de0f2ba66",
      number: "TN 75 R 9952",
      device_id: "863110086150292",
      model: "20 kl",
      status: "Moving",
    },
    liveVehicle: { status: "Idle", odometer: 1200 },
    points: pts,
    assignments: [
      { vehicle_id: "325081e0-a535-4269-8239-582de0f2ba66", driver_id: "d1", assigned_at: "2026-11-01T00:00:00Z", is_active: true, drivers: { name: "Ramesh" } },
    ],
    drivers: [{ id: "d1", name: "Ramesh" }],
    bounds: boundsYest,
    telemetryComputed: true,
  });

  assert.equal(row.driver, "Ramesh");
  assert.ok(row.distanceKmNum > 5, `Expected > 5 km, got ${row.distanceKmNum}`);
  assert.equal(row.tripsCount, 1);
  assert.equal(row.status, "Active (1 trip)"); // Historical date uses historical activity status, NOT today's Idle
  assert.equal(row.maxSpeedKmh, 45);
  assert.equal(row.odometerNum, 1006); // End odometer from yesterday's telemetry

  // Now check Today mode uses liveVehicle.status ("Idle")
  const boundsToday = resolveReportDateBounds("today", undefined, undefined, REF_DATE);
  const rowToday = buildDailyActivityRow({
    vehicle: {
      id: "325081e0-a535-4269-8239-582de0f2ba66",
      number: "TN 75 R 9952",
      device_id: "863110086150292",
      status: "Moving", // stale DB status
    },
    liveVehicle: { status: "Idle", odometer: 1200, lastUpdate: "2026-11-25T05:00:00Z" },
    points: [],
    assignments: [],
    drivers: [],
    bounds: boundsToday,
    telemetryComputed: true,
  });
  assert.equal(rowToday.status, "Idle");
  assert.equal(rowToday.odometerKm, "1,200 km");
});

test("5. aggregateDailyActivitySummary & formatDurationCompact aggregate fleet KPIs accurately", () => {
  assert.equal(formatDurationCompact(0), "0m");
  assert.equal(formatDurationCompact(3660), "1h 1m");

  const bounds = resolveReportDateBounds("yesterday", undefined, undefined, REF_DATE);
  const r1 = buildDailyActivityRow({
    vehicle: { id: "v1", number: "TN 75 R 9952" },
    points: [
      { id: "1", lat: 8.26, lng: 77.28, speed: 40, ignition: true, recorded_at: "2026-11-24T01:00:00Z" },
      { id: "2", lat: 8.30, lng: 77.32, speed: 50, ignition: true, recorded_at: "2026-11-24T01:10:00Z" },
    ],
    assignments: [],
    drivers: [],
    bounds,
    telemetryComputed: true,
  });
  const r2 = buildDailyActivityRow({
    vehicle: { id: "v2", number: "TN 75 F 4323" },
    points: [],
    assignments: [],
    drivers: [],
    bounds,
    telemetryComputed: true,
  });

  const summary = aggregateDailyActivitySummary([r1, r2]);
  assert.equal(summary.totalVehicles, 2);
  assert.equal(summary.activeVehicles, 1);
  assert.equal(summary.idleVehicles, 1);
  assert.equal(summary.totalTrips, 1);
  assert.equal(summary.fleetMaxSpeedKmh, 50);
  assert.ok(summary.totalDistanceKm > 5);
});

test("6. computeIdleParkedBreakdown separates idling (engine ON) from parked (engine OFF) and skips gaps", () => {
  const pts = [
    { id: "1", lat: 8.26, lng: 77.28, speed: 0, ignition: true, recorded_at: "2026-11-24T01:00:00Z" },
    { id: "2", lat: 8.26, lng: 77.28, speed: 1, ignition: true, recorded_at: "2026-11-24T01:05:00Z" }, // +300s idling
    { id: "3", lat: 8.26, lng: 77.28, speed: 0, ignition: false, recorded_at: "2026-11-24T01:15:00Z" }, // +600s idling (prev had ignition)
    { id: "4", lat: 8.26, lng: 77.28, speed: 0, ignition: false, recorded_at: "2026-11-24T01:25:00Z" }, // +600s parked
    // 30-min signal gap (should be excluded)
    { id: "5", lat: 8.26, lng: 77.28, speed: 0, ignition: false, recorded_at: "2026-11-24T01:55:00Z" },
  ];
  const res = computeIdleParkedBreakdown(pts, 15);
  assert.equal(res.idlingSeconds, 900);
  assert.equal(res.parkedSeconds, 600);
});

test("7. filterAndSortReportRows + buildReportCsv filter, sort numerically, and export strictly filtered rows", () => {
  const sample = [
    { vehicle: "TN 75 R 9952", status: "Active (3 trips)", distanceKm: "116.9 km", drivingTime: "3h 11m", location: "Mulagumoodu" },
    { vehicle: "TN 75 S 1688", status: "Active (4 trips)", distanceKm: "123.8 km", drivingTime: "3h 13m", location: "Nagercoil, \"Main\"" },
    { vehicle: "TN 75 F 4323", status: "Idle", distanceKm: "0.0 km", drivingTime: "0m", location: "Depot" },
  ];

  const activeSorted = filterAndSortReportRows(sample, {
    statusFilter: "Active",
    sortKey: "distanceKm",
    sortDir: "desc",
  });
  assert.equal(activeSorted.length, 2);
  assert.equal(activeSorted[0].vehicle, "TN 75 S 1688");
  assert.equal(activeSorted[1].vehicle, "TN 75 R 9952");

  const searched = filterAndSortReportRows(sample, { searchQuery: "nagercoil" });
  assert.equal(searched.length, 1);
  const csv = buildReportCsv(searched);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("TN 75 S 1688"));
  assert.ok(csv.includes("\"Nagercoil, \"\"Main\"\"\""));
  assert.ok(!csv.includes("TN 75 F 4323"));
});

test("8. computeOtherReportInsights derives KPIs and chart data from filtered rows", () => {
  const fuelRows = [
    { vehicle: "TN 75 R 9952", volumeLiters: "50 L", totalCost: "₹ 4,800" },
    { vehicle: "TN 75 S 1688", volumeLiters: "100 L", totalCost: "₹ 9,600" },
  ];
  const insights = computeOtherReportInsights("fuel_efficiency", fuelRows);
  assert.equal(insights.kpis[0].value, "2");
  assert.equal(insights.kpis[1].value, "150.0 L");
  assert.equal(insights.kpis[2].value, "₹ 14,400");
  assert.equal(insights.chartData.length, 2);
});

test("9. buildVehicleDailyHistoryRows splits multi-day vehicle telemetry into old & new date-by-date rows", () => {
  const bounds = resolveReportDateBounds("month", undefined, undefined, REF_DATE);
  const pts = [
    // Old day: 2026-11-11 IST
    { id: "a1", lat: 8.2607, lng: 77.2882, speed: 35, ignition: true, recorded_at: "2026-11-11T04:00:00Z" },
    { id: "a2", lat: 8.2807, lng: 77.3082, speed: 40, ignition: true, recorded_at: "2026-11-11T04:10:00Z" },
    // Middle day: 2026-11-15 IST (stationary)
    { id: "b1", lat: 8.2607, lng: 77.2882, speed: 0, ignition: false, recorded_at: "2026-11-15T05:00:00Z" },
    // Latest day: 2026-11-17 IST
    { id: "c1", lat: 8.2607, lng: 77.2882, speed: 45, ignition: true, recorded_at: "2026-11-17T06:00:00Z" },
    { id: "c2", lat: 8.2907, lng: 77.3182, speed: 50, ignition: true, recorded_at: "2026-11-17T06:15:00Z" },
  ];

  const rows = buildVehicleDailyHistoryRows({
    vehicle: { id: "d3887a78-ac32-4b63-b3c0-61563ad9f3d7", number: "TN 75 M 0041" },
    points: pts,
    assignments: [],
    drivers: [],
    bounds,
  });

  // Returns 3 separate daily rows ordered newest to oldest
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => r.activityDate),
    ["2026-11-17", "2026-11-15", "2026-11-11"]
  );
  assert.equal(rows[1].status, "Stationary");
  assert.ok(rows[0].distanceKmNum > 3);
  assert.ok(rows[2].distanceKmNum > 2);

  // Summary counts 1 unique vehicle across 3 days (2 active days)
  const summary = aggregateDailyActivitySummary(rows);
  assert.equal(summary.totalVehicles, 1);
  assert.equal(summary.totalDays, 3);
  assert.equal(summary.activeDays, 2);

  // Chronological date sort asc (old -> new) works cleanly
  const formatted = rows.map((r) => ({ date: r.activityDate, vehicle: r.vehicle }));
  const sortedAsc = filterAndSortReportRows(formatted, { sortKey: "date", sortDir: "asc" });
  assert.deepEqual(
    sortedAsc.map((r) => r.date),
    ["2026-11-11", "2026-11-15", "2026-11-17"]
  );
});

test("10. Sub-second buffered GPS packets stay 1 continuous trip without phantom splitting", () => {
  const bounds = resolveReportDateBounds("custom", "2026-11-11", "2026-11-11", REF_DATE);
  // Buffered packets arriving 100ms-500ms apart moving 80-150m per step
  const pts = [
    { id: "p1", lat: 8.2600, lng: 77.2800, speed: 35, ignition: true, recorded_at: "2026-11-11T04:00:00.000Z" },
    { id: "p2", lat: 8.2608, lng: 77.2806, speed: 38, ignition: true, recorded_at: "2026-11-11T04:00:00.150Z" },
    { id: "p3", lat: 8.2618, lng: 77.2814, speed: 40, ignition: true, recorded_at: "2026-11-11T04:00:00.400Z" },
    { id: "p4", lat: 8.2700, lng: 77.2890, speed: 42, ignition: true, recorded_at: "2026-11-11T04:05:00.000Z" },
  ];

  const row = buildDailyActivityRow({
    vehicle: { id: "d0fea864-64a4-4148-b3b2-600f68459583", number: "TN 75 BC 2219" },
    points: pts,
    assignments: [],
    drivers: [],
    bounds,
    telemetryComputed: true,
    activityDate: "2026-11-11",
  });

  assert.equal(row.tripsCount, 1, "Must keep buffered packets in 1 continuous trip");
  assert.ok(row.distanceKmNum > 1.3, `Expected ~1.5km total distance, got ${row.distanceKmNum}`);
});

test("11. Zero-distance stationary GPS speed drift (speed 4-5 km/h) records 0 driving and Stationary", () => {
  const bounds = resolveReportDateBounds("custom", "2026-11-09", "2026-11-09", REF_DATE);
  const pts = Array.from({ length: 12 }, (_, idx) => ({
    id: `s-${idx}`,
    lat: 8.260796,
    lng: 77.287655,
    speed: 5,
    ignition: true,
    recorded_at: new Date(Date.parse("2026-11-09T04:00:00.000Z") + idx * 10 * 60 * 1000).toISOString(),
  }));

  const row = buildDailyActivityRow({
    vehicle: { id: "d0fea864-64a4-4148-b3b2-600f68459583", number: "TN 75 BC 2219" },
    points: pts,
    assignments: [],
    drivers: [],
    bounds,
    telemetryComputed: true,
    activityDate: "2026-11-09",
  });

  assert.equal(row.distanceKmNum, 0);
  assert.equal(row.drivingSeconds, 0);
  assert.equal(row.tripsCount, 0);
  assert.equal(row.maxSpeedKmh, 0);
  assert.equal(row.avgSpeedKmh, 0);
  assert.equal(row.status, "Stationary");
  assert.ok(row.parkedSeconds >= 6000, `Expected extended yard dwell in parkedSeconds, got ${row.parkedSeconds}`);
  assert.equal(row.idlingSeconds, 0);
});

test("12. Constant-ignition hardware classifies short pauses as Idling and extended blocks as Parked", () => {
  const baseMs = Date.parse("2026-11-13T04:00:00.000Z");
  const pts = [
    // 10 samples during 2-min collection halt (<= 5m -> Idling)
    { id: "1", lat: 8.260, lng: 77.280, speed: 0, ignition: true, recorded_at: new Date(baseMs).toISOString() },
    { id: "2", lat: 8.260, lng: 77.280, speed: 0, ignition: true, recorded_at: new Date(baseMs + 120_000).toISOString() },
    // Moving segment
    { id: "3", lat: 8.270, lng: 77.290, speed: 40, ignition: true, recorded_at: new Date(baseMs + 300_000).toISOString() },
    // 8 samples during 20-min extended stop (> 5m -> Parked even with ignition=true)
    ...Array.from({ length: 8 }, (_, k) => ({
      id: `p-${k}`,
      lat: 8.270,
      lng: 77.290,
      speed: k % 2 === 0 ? 0 : 4,
      ignition: true,
      recorded_at: new Date(baseMs + 300_000 + (k + 1) * 150_000).toISOString(),
    })),
  ];

  const breakdown = computeIdleParkedBreakdown(pts, 15);
  assert.equal(breakdown.idlingSeconds, 120);
  assert.equal(breakdown.parkedSeconds, 1200);
});
