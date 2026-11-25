import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveReportDateBounds,
  filterRecordsByIstRange,
  resolveFleetVehicleModel,
  buildDailyActivityRow,
  aggregateDailyActivitySummary,
  formatDurationCompact,
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
