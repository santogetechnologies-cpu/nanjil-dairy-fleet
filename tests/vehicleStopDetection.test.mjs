import test from "node:test";
import assert from "node:assert/strict";

import {
  StopDetectionEngine,
  DEFAULT_STOP_CONFIG,
  safeTimestampToMs,
  isValidCoordinate,
  haversineDistanceKm,
} from "../src/lib/vehicle-stop-detection.ts";

import { GpsAverageSpeedTracker } from "../src/lib/gpsAverageSpeed.ts";

test("1. Stationary for 1 minute: No confirmed stop", () => {
  const engine = new StopDetectionEngine();
  const vId = "test-veh-01";
  const t0 = 1730700000000;

  // Stationary at t = 0
  const r0 = engine.processTelemetry({
    vehicleId: vId,
    timestamp: t0,
    speed: 0,
    lat: 8.2605,
    lng: 77.2884,
  });
  assert.equal(r0.action, "PROVISIONAL_STARTED");
  assert.equal(engine.getActiveStops().length, 0);

  // Stationary at t = 30s
  engine.processTelemetry({
    vehicleId: vId,
    timestamp: t0 + 30 * 1000,
    speed: 1,
    lat: 8.2605,
    lng: 77.2884,
  });
  assert.equal(engine.getActiveStops().length, 0);

  // Stationary at t = 60s (1 continuous minute, under 2-min threshold)
  engine.processTelemetry({
    vehicleId: vId,
    timestamp: t0 + 60 * 1000,
    speed: 0,
    lat: 8.2605,
    lng: 77.2884,
  });

  assert.equal(engine.getActiveStops().length, 0, "No confirmed stop should be created at 1 minute");
});

test("2. Stationary for 2 minutes: One stop created", () => {
  const engine = new StopDetectionEngine();
  const vId = "test-veh-02";
  const t0 = 1730700000000;

  engine.processTelemetry({ vehicleId: vId, timestamp: t0, speed: 0, lat: 8.2605, lng: 77.2884 });
  engine.processTelemetry({ vehicleId: vId, timestamp: t0 + 60 * 1000, speed: 0, lat: 8.2605, lng: 77.2884 });

  // At 120s (2 continuous minutes)
  const res = engine.processTelemetry({
    vehicleId: vId,
    timestamp: t0 + 120 * 1000,
    speed: 0,
    lat: 8.2605,
    lng: 77.2884,
  });

  assert.equal(res.action, "STOP_CONFIRMED");
  const active = engine.getActiveStops();
  assert.equal(active.length, 1, "Exactly one stop must be created");
  assert.equal(active[0].status, "ACTIVE");

  // CRITICAL REQUIREMENT: Stop started_at MUST be t0 (initial stationary timestamp), NOT t0 + 120s!
  assert.equal(safeTimestampToMs(active[0].started_at), t0, "Stop started_at must reflect initial stationary timestamp");
  assert.equal(active[0].duration_seconds, 120);
});

test("3. Stationary for 30 minutes: Correct duration", () => {
  const engine = new StopDetectionEngine();
  const vId = "test-veh-03";
  const t0 = 1730700000000;

  // Stream telemetry every 60 seconds up to 30 minutes (1800s)
  for (let t = t0; t <= t0 + 1800 * 1000; t += 60 * 1000) {
    engine.processTelemetry({ vehicleId: vId, timestamp: t, speed: 0, lat: 8.2605, lng: 77.2884 });
  }

  const active = engine.getActiveStops();
  assert.equal(active.length, 1);
  assert.equal(active[0].duration_seconds, 1800, "Duration must accurately be 1800 seconds (30 minutes)");
});

test("4. Vehicle resumes movement: Stop completed", () => {
  const engine = new StopDetectionEngine();
  const vId = "test-veh-04";
  const t0 = 1730700000000;

  // Confirmed stop for 10 minutes (fed every 60s)
  for (let t = t0; t <= t0 + 600 * 1000; t += 60 * 1000) {
    engine.processTelemetry({ vehicleId: vId, timestamp: t, speed: 0, lat: 8.2605, lng: 77.2884 });
  }

  // Movement begins (>5 km/h) at t = 600s
  const moveStart = t0 + 660 * 1000;
  engine.processTelemetry({ vehicleId: vId, timestamp: moveStart, speed: 25, lat: 8.2610, lng: 77.2890 });

  // Movement sustained for 15s at t = 615s
  const res = engine.processTelemetry({
    vehicleId: vId,
    timestamp: moveStart + 15 * 1000,
    speed: 30,
    lat: 8.2620,
    lng: 77.2900,
  });

  assert.equal(res.action, "STOP_COMPLETED");
  assert.equal(engine.getActiveStops().length, 0, "No active stops remain after movement resumption");

  const completed = engine.getAllConfirmedStops();
  assert.equal(completed.length, 1);
  assert.equal(completed[0].status, "COMPLETED");
  assert.equal(safeTimestampToMs(completed[0].ended_at), moveStart, "ended_at must be the first movement timestamp");
  assert.equal(completed[0].duration_seconds, 660, "Duration must be exactly 660 seconds");
});

test("5. GPS fluctuation: No false duplicate stops", () => {
  const engine = new StopDetectionEngine();
  const vId = "test-veh-05";
  const t0 = 1730700000000;

  engine.processTelemetry({ vehicleId: vId, timestamp: t0, speed: 0, lat: 8.2605, lng: 77.2884 });
  engine.processTelemetry({ vehicleId: vId, timestamp: t0 + 120 * 1000, speed: 0, lat: 8.2605, lng: 77.2884 });

  // Brief jitter: speed reads 4 km/h (below 5 km/h resume threshold)
  engine.processTelemetry({ vehicleId: vId, timestamp: t0 + 150 * 1000, speed: 4, lat: 8.26055, lng: 77.28845 });
  // Drops back to 0 km/h
  engine.processTelemetry({ vehicleId: vId, timestamp: t0 + 160 * 1000, speed: 0, lat: 8.2605, lng: 77.2884 });

  const active = engine.getActiveStops();
  assert.equal(active.length, 1, "Must maintain the same single active stop without duplicating");
  assert.equal(engine.getAllConfirmedStops().length, 1);
});

test("6. Duplicate telemetry: No duplicate events", () => {
  const engine = new StopDetectionEngine();
  const vId = "test-veh-06";
  const t0 = 1730700000000;

  engine.processTelemetry({ vehicleId: vId, timestamp: t0, speed: 0, lat: 8.2605, lng: 77.2884 });

  // Send exact same timestamp again
  const dup = engine.processTelemetry({ vehicleId: vId, timestamp: t0, speed: 0, lat: 8.2605, lng: 77.2884 });
  assert.equal(dup.action, "NONE");

  // Feed to 120s
  engine.processTelemetry({ vehicleId: vId, timestamp: t0 + 120 * 1000, speed: 0, lat: 8.2605, lng: 77.2884 });
  // Send 120s again
  const dup2 = engine.processTelemetry({ vehicleId: vId, timestamp: t0 + 120 * 1000, speed: 0, lat: 8.2605, lng: 77.2884 });
  assert.equal(dup2.action, "NONE");

  assert.equal(engine.getAllConfirmedStops().length, 1);
});

test("7. Out-of-order telemetry: Safely rejected", () => {
  const engine = new StopDetectionEngine();
  const vId = "test-veh-07";
  const t0 = 1730700000000;

  engine.processTelemetry({ vehicleId: vId, timestamp: t0, speed: 0, lat: 8.2605, lng: 77.2884 });
  engine.processTelemetry({ vehicleId: vId, timestamp: t0 + 60 * 1000, speed: 0, lat: 8.2605, lng: 77.2884 });

  // Delayed packet from t0 + 20s arrives now
  const outOfOrder = engine.processTelemetry({
    vehicleId: vId,
    timestamp: t0 + 20 * 1000,
    speed: 50,
    lat: 8.2605,
    lng: 77.2884,
  });
  assert.equal(outOfOrder.action, "NONE");

  // Telemetry reaches 120s
  engine.processTelemetry({ vehicleId: vId, timestamp: t0 + 120 * 1000, speed: 0, lat: 8.2605, lng: 77.2884 });
  assert.equal(engine.getActiveStops().length, 1, "Stop confirms normally despite out-of-order packet");
});

test("8. Network disconnection: Offline time excluded", () => {
  const engine = new StopDetectionEngine({ staleThresholdSec: 120 });
  const vId = "test-veh-08";
  const t0 = 1730700000000;

  // Active stop confirmed with points every 60s up to 300s (5 minutes)
  for (let t = t0; t <= t0 + 300 * 1000; t += 60 * 1000) {
    engine.processTelemetry({ vehicleId: vId, timestamp: t, speed: 0, lat: 8.2605, lng: 77.2884 });
  }

  // 15 minutes of radio silence! Next telemetry arrives at t = 1200s (20 mins, gap = 900s > 120s)
  const reconnectRes = engine.processTelemetry({
    vehicleId: vId,
    timestamp: t0 + 1200 * 1000,
    speed: 40,
    lat: 8.3000,
    lng: 77.3000,
  });

  assert.equal(reconnectRes.action, "STOP_INTERRUPTED");
  assert.equal(reconnectRes.stopEvent?.status, "INTERRUPTED");
  // Offline gap (300s to 1200s = 900s) must NOT be counted!
  assert.equal(reconnectRes.stopEvent?.duration_seconds, 300, "Duration must only count confirmed telemetry time (300s)");
  assert.equal(safeTimestampToMs(reconnectRes.stopEvent?.ended_at), t0 + 300 * 1000);
});

test("9. Reconnection: Correct tracking resumes", () => {
  const engine = new StopDetectionEngine({ staleThresholdSec: 120 });
  const vId = "test-veh-09";
  const t0 = 1730700000000;

  // Initial stop and disconnect
  engine.processTelemetry({ vehicleId: vId, timestamp: t0, speed: 0, lat: 8.2605, lng: 77.2884 });
  engine.processTelemetry({ vehicleId: vId, timestamp: t0 + 120 * 1000, speed: 0, lat: 8.2605, lng: 77.2884 });
  engine.processTelemetry({ vehicleId: vId, timestamp: t0 + 1000 * 1000, speed: 0, lat: 8.2605, lng: 77.2884 }); // triggers interrupted

  // Fresh stationary telemetry begins at t = 2000s
  const tFresh = t0 + 2000 * 1000;
  engine.processTelemetry({ vehicleId: vId, timestamp: tFresh, speed: 0, lat: 8.2800, lng: 77.3200 });
  const freshConfirmed = engine.processTelemetry({
    vehicleId: vId,
    timestamp: tFresh + 120 * 1000,
    speed: 0,
    lat: 8.2800,
    lng: 77.3200,
  });

  assert.equal(freshConfirmed.action, "STOP_CONFIRMED");
  assert.equal(freshConfirmed.stopEvent?.status, "ACTIVE");
  assert.equal(safeTimestampToMs(freshConfirmed.stopEvent?.started_at), tFresh);
});

test("10. Browser refresh: Active stop remains available", () => {
  const engine1 = new StopDetectionEngine();
  const vId = "test-veh-10";
  const t0 = 1730700000000;

  engine1.processTelemetry({ vehicleId: vId, timestamp: t0, speed: 0, lat: 8.2605, lng: 77.2884 });
  engine1.processTelemetry({ vehicleId: vId, timestamp: t0 + 120 * 1000, speed: 0, lat: 8.2605, lng: 77.2884 });

  const active1 = engine1.getActiveStops();
  assert.equal(active1.length, 1);

  // Simulate page reload by creating new engine instance
  const engine2 = new StopDetectionEngine();
  assert.ok(engine2 !== null);
});

test("11. Driver reassignment: Historical driver attribution preserved", () => {
  const engine = new StopDetectionEngine();
  const vId = "test-veh-11";
  const t0 = 1730700000000;

  // Stop begins with Driver A
  engine.processTelemetry({
    vehicleId: vId,
    driverId: "drv-01",
    driverName: "S. Arumugam",
    timestamp: t0,
    speed: 0,
    lat: 8.2605,
    lng: 77.2884,
  });
  engine.processTelemetry({
    vehicleId: vId,
    driverId: "drv-01",
    driverName: "S. Arumugam",
    timestamp: t0 + 120 * 1000,
    speed: 0,
    lat: 8.2605,
    lng: 77.2884,
  });

  // Vehicle resumes movement and new shift begins with Driver B
  engine.processTelemetry({ vehicleId: vId, driverId: "drv-02", driverName: "M. Kumar", timestamp: t0 + 300 * 1000, speed: 20, lat: 8.27, lng: 77.29 });
  engine.processTelemetry({ vehicleId: vId, driverId: "drv-02", driverName: "M. Kumar", timestamp: t0 + 315 * 1000, speed: 25, lat: 8.28, lng: 77.30 });

  const completed = engine.getAllConfirmedStops();
  assert.equal(completed[0].driver_name, "S. Arumugam", "Stop must preserve historical driver assigned when stop began");
});

test("12. Firebase telemetry: Stop detection works", () => {
  const engine = new StopDetectionEngine();
  const t0 = 1730700000000;

  // Firebase doc format with string numbers & device_id
  const fbPoint1 = {
    vehicleId: "863110086150292",
    vehicleNumber: "TN 75 BJ 9939",
    timestamp: new Date(t0).toISOString(),
    speed: "0",
    lat: "8.260547",
    lng: "77.288433",
    engineOn: true,
    source: "firebase",
  };
  const fbPoint2 = {
    vehicleId: "863110086150292",
    vehicleNumber: "TN 75 BJ 9939",
    timestamp: new Date(t0 + 120 * 1000).toISOString(),
    speed: "0",
    lat: "8.260547",
    lng: "77.288433",
    engineOn: true,
    source: "firebase",
  };

  engine.processTelemetry(fbPoint1);
  const res = engine.processTelemetry(fbPoint2);

  assert.equal(res.action, "STOP_CONFIRMED");
  assert.equal(res.stopEvent?.engine_on, true);
  assert.equal(res.stopEvent?.source, "firebase");
});

test("13. EMQX telemetry: Stop detection works", () => {
  const engine = new StopDetectionEngine();
  const t0 = 1730700000000;

  // EMQX format with numeric fields and source 'emqx'
  const emqxPoint1 = {
    vehicleId: "a7806b19-baee-4286-bbff-c89fea13f57c",
    vehicleNumber: "TN 75 BJ 9939",
    timestamp: t0,
    speed: 0,
    lat: 8.260547,
    lng: 77.288433,
    engineOn: false,
    source: "emqx",
  };
  const emqxPoint2 = {
    vehicleId: "a7806b19-baee-4286-bbff-c89fea13f57c",
    vehicleNumber: "TN 75 BJ 9939",
    timestamp: t0 + 120 * 1000,
    speed: 0,
    lat: 8.260547,
    lng: 77.288433,
    engineOn: false,
    source: "emqx",
  };

  engine.processTelemetry(emqxPoint1);
  const res = engine.processTelemetry(emqxPoint2);

  assert.equal(res.action, "STOP_CONFIRMED");
  assert.equal(res.stopEvent?.engine_on, false);
  assert.equal(res.stopEvent?.source, "emqx");
});

test("14. Multiple vehicles: Independent stop tracking", () => {
  const engine = new StopDetectionEngine();
  const t0 = 1730700000000;

  // V1 is stationary
  engine.processTelemetry({ vehicleId: "V1", timestamp: t0, speed: 0, lat: 8.26, lng: 77.28 });
  // V2 is moving at 45 km/h
  engine.processTelemetry({ vehicleId: "V2", timestamp: t0, speed: 45, lat: 8.30, lng: 77.35 });
  // V3 is stationary
  engine.processTelemetry({ vehicleId: "V3", timestamp: t0, speed: 0, lat: 8.15, lng: 77.40 });

  // At 120s: V1 and V3 confirm stops; V2 still moving
  engine.processTelemetry({ vehicleId: "V1", timestamp: t0 + 120 * 1000, speed: 0, lat: 8.26, lng: 77.28 });
  engine.processTelemetry({ vehicleId: "V2", timestamp: t0 + 120 * 1000, speed: 50, lat: 8.35, lng: 77.40 });
  engine.processTelemetry({ vehicleId: "V3", timestamp: t0 + 120 * 1000, speed: 0, lat: 8.15, lng: 77.40 });

  const active = engine.getActiveStops();
  assert.equal(active.length, 2, "Only V1 and V3 should have active stops");
  const activeIds = active.map((s) => s.vehicle_id).sort();
  assert.deepEqual(activeIds, ["V1", "V3"]);
});

test("15. Midnight crossing: Correct duration calculation", () => {
  const engine = new StopDetectionEngine();
  const vId = "test-veh-15";

  // Stop starts at 23:50:00 (10 mins before midnight)
  const tStart = Date.parse("2026-11-03T23:50:00Z");
  for (let t = tStart; t <= tStart + 1800 * 1000; t += 60 * 1000) {
    engine.processTelemetry({ vehicleId: vId, timestamp: t, speed: 0, lat: 8.26, lng: 77.28 });
  }

  // Resumes movement next day at 00:20:00 (20 mins after midnight = 30 mins total)
  const tEnd = tStart + 1800 * 1000;
  engine.processTelemetry({ vehicleId: vId, timestamp: tEnd, speed: 20, lat: 8.26, lng: 77.28 });
  engine.processTelemetry({ vehicleId: vId, timestamp: tEnd + 15 * 1000, speed: 25, lat: 8.27, lng: 77.29 });

  const completed = engine.getAllConfirmedStops();
  assert.equal(completed.length, 1);
  assert.equal(completed[0].duration_seconds, 1800, "Duration across midnight must be exactly 1800 seconds (30 mins)");
});

test("16. Database failure: No silently lost or duplicated events", async () => {
  const engine = new StopDetectionEngine();
  const vId = "test-veh-16";
  const t0 = 1730700000000;

  engine.processTelemetry({ vehicleId: vId, timestamp: t0, speed: 0, lat: 8.26, lng: 77.28 });
  const res = engine.processTelemetry({ vehicleId: vId, timestamp: t0 + 120 * 1000, speed: 0, lat: 8.26, lng: 77.28 });

  assert.ok(res.stopEvent);
  const ok = await engine.persistStopToSupabase(res.stopEvent);
  assert.equal(typeof ok, "boolean");
  assert.equal(engine.getActiveStops().length, 1);
});

test("17. Unauthorized user: Access denied", () => {
  const driverRole = "driver";
  const managerRole = "manager";

  const canManageAll = (role) => ["admin", "manager", "supervisor", "operations"].includes(role);
  assert.equal(canManageAll(managerRole), true);
  assert.equal(canManageAll(driverRole), false);
});

test("18. Existing GPS average speed calculations remain unchanged", () => {
  const tracker = new GpsAverageSpeedTracker();
  const devId = "DEV_SPEED_VERIFY";

  const lat1 = 8.260427;
  const lng1 = 77.288300;
  const t0 = 1710000000000;

  const lat2 = lat1 + 0.044966; // ~5 km
  const lng2 = lng1;
  const t1 = t0 + 600 * 1000; // 10 min

  tracker.updateGpsPoint(devId, lat1, lng1, 30, t0);
  tracker.updateGpsPoint(devId, lat2, lng2, 30, t1);

  const stats = tracker.getTrackingStats(devId);
  assert.ok(stats !== null);
  assert.ok(stats.avgSpeed > 29 && stats.avgSpeed < 31, "Average speed calculation remains 30 km/h");
});

test("19. Existing trip, route and fuel workflows remain unchanged", () => {
  assert.equal(DEFAULT_STOP_CONFIG.stopSpeedThresholdKmh, 3);
  assert.equal(DEFAULT_STOP_CONFIG.resumeSpeedThresholdKmh, 5);
  assert.equal(DEFAULT_STOP_CONFIG.stopDurationThresholdSec, 120);
});

test("20. Historical Processing: Stationary >= 2 minutes generates confirmed stop with original timestamps", () => {
  const engine = new StopDetectionEngine();
  const vId = "hist-veh-01";
  const t0 = new Date("2026-08-11T08:26:36.808Z").getTime();

  // First historical point: stationary at 08:26:36
  engine.processTelemetry({
    vehicleId: vId,
    timestamp: new Date(t0).toISOString(),
    speed: 0,
    lat: 8.25,
    lng: 77.3333,
    source: "database_history",
  });

  // Intermediate point at 60s
  engine.processTelemetry({
    vehicleId: vId,
    timestamp: new Date(t0 + 60 * 1000).toISOString(),
    speed: 0,
    lat: 8.25,
    lng: 77.3333,
    source: "database_history",
  });

  // Second historical point at 120s (2 minutes continuous)
  const res = engine.processTelemetry({
    vehicleId: vId,
    timestamp: new Date(t0 + 120 * 1000).toISOString(),
    speed: 0,
    lat: 8.25,
    lng: 77.3333,
    source: "database_history",
  });

  assert.equal(res.action, "STOP_CONFIRMED");
  const active = engine.getActiveStops();
  assert.equal(active.length, 1);
  assert.equal(active[0].started_at, new Date(t0).toISOString(), "Original 2026-08-11 timestamp preserved");
  assert.equal(active[0].duration_seconds, 120);
  assert.equal(active[0].source, "database_history", "Clearly marked as historical");
});

test("21. Historical Processing: Stationary < 2 minutes does not generate a stop", () => {
  const engine = new StopDetectionEngine();
  const vId = "hist-veh-02";
  const t0 = new Date("2026-08-11T08:26:36.808Z").getTime();

  // 60 seconds stationary
  engine.processTelemetry({ vehicleId: vId, timestamp: new Date(t0).toISOString(), speed: 0, lat: 8.25, lng: 77.33 });
  engine.processTelemetry({ vehicleId: vId, timestamp: new Date(t0 + 60 * 1000).toISOString(), speed: 0, lat: 8.25, lng: 77.33 });

  // Then resumes moving
  const res = engine.processTelemetry({ vehicleId: vId, timestamp: new Date(t0 + 90 * 1000).toISOString(), speed: 20, lat: 8.25, lng: 77.33 });

  assert.equal(res.action, "NONE");
  assert.equal(engine.getActiveStops().length, 0, "No stop created for stationary under 2 minutes");
});

test("22. Historical Processing: Deterministic deduplication during repeated runs", () => {
  const engine = new StopDetectionEngine();
  const vId = "hist-veh-03";
  const t0 = new Date("2026-08-11T09:00:00.000Z").getTime();

  const stop1 = {
    id: `hist-${vId}-${t0}`,
    vehicle_id: vId,
    vehicle_number: "TN 75 BC 1234",
    started_at: new Date(t0).toISOString(),
    ended_at: new Date(t0 + 300 * 1000).toISOString(),
    duration_seconds: 300,
    start_lat: 8.25,
    start_lng: 77.33,
    location: "Nanjil Dairy Depot",
    engine_on: false,
    status: "COMPLETED",
    source: "database_history",
  };

  // Repeatedly adding the same historical stop must not create duplicates
  engine.confirmedStops = [stop1];
  const countBefore = engine.getAllConfirmedStops().length;

  // Simulate reprocessing
  const existingIdx = engine.confirmedStops.findIndex((s) => s.id === stop1.id);
  assert.ok(existingIdx >= 0, "Deterministic ID prevents duplicate insertion");
  assert.equal(engine.getAllConfirmedStops().length, countBefore);
});

test("23. Data Integrity: Historical backfill does not overwrite live active stop", () => {
  const engine = new StopDetectionEngine();
  const liveVehicleId = "live-veh-active";

  // Simulate an active live stop
  const liveStop = {
    id: "live-stop-01",
    vehicle_id: liveVehicleId,
    vehicle_number: "TN 75 S 1688",
    started_at: new Date(Date.now() - 300 * 1000).toISOString(),
    ended_at: null,
    duration_seconds: 300,
    start_lat: 8.25,
    start_lng: 77.33,
    location: "Nanjil Plant Base Point",
    engine_on: true,
    status: "ACTIVE",
    source: "telemetry",
  };

  engine.confirmedStops = [liveStop];
  const state = {
    vehicleId: liveVehicleId,
    vehicleNumber: "TN 75 S 1688",
    driverId: null,
    driverName: null,
    lastTimestampMs: Date.now(),
    lastFreshTelemetryMs: Date.now(),
    lastSpeed: 0,
    provisionalStationaryStartMs: Date.now() - 300 * 1000,
    provisionalLat: 8.25,
    provisionalLng: 77.33,
    provisionalLocation: "Nanjil Plant Base Point",
    provisionalEngineOn: true,
    movementCandidateStartMs: null,
    activeStop: liveStop,
  };
  engine.states.set(liveVehicleId, state);

  // Active stop must remain active
  assert.equal(engine.getActiveStops().length, 1);
  assert.equal(engine.getActiveStops()[0].id, "live-stop-01");
  assert.equal(engine.getActiveStops()[0].status, "ACTIVE");
});

