import test from "node:test";
import assert from "node:assert/strict";

// Import core calculation logic from src/lib/gpsAverageSpeed
import {
  GpsAverageSpeedTracker,
  calculateAverageSpeedFromPoints,
  extractTelemetryTimestamp,
  formatAverageSpeed,
  haversineDistanceKm,
  isValidCoord,
  isValidTimestamp,
  parseTimestampToEpochMs,
  MOVING_SPEED_THRESHOLD_KMH,
  MAX_GAP_SECONDS,
  MAX_REALISTIC_SPEED_KMH,
  MAX_SEGMENT_DISTANCE_KM,
} from "../src/lib/gpsAverageSpeed.ts";

test("1. Basic distance/time average (Distance / Time, NOT average of speed readings)", () => {
  const tracker = new GpsAverageSpeedTracker();
  const devId = "TEST_DEV_01";

  // Base location
  const lat1 = 8.260427;
  const lng1 = 77.288300;
  const t0 = 1710000000000;

  // Move 5 km north: 5 km / 600s (10 min = 1/6 hr) => 30.0 km/h
  // 5 km latitude delta ≈ 5 / 111.195 ≈ 0.044966
  const lat2 = lat1 + 0.044966;
  const lng2 = lng1;
  const t1 = t0 + 600 * 1000; // 10 minutes later

  const actualDist = haversineDistanceKm(lat1, lng1, lat2, lng2); // ~5.00 km

  // Point A: telemetry speed reading says 80 km/h
  tracker.updateGpsPoint(devId, lat1, lng1, 80, t0);

  // Point B: telemetry speed reading says 10 km/h
  tracker.updateGpsPoint(devId, lat2, lng2, 10, t1);

  const stats = tracker.getTrackingStats(devId);
  assert.ok(stats !== null);

  const expectedAvgSpeed = Math.round((actualDist / (600 / 3600)) * 10) / 10; // ~30.0 km/h

  // Mathematical verification:
  // Speed is ~30.0 km/h (5 km in 10 mins).
  // It MUST NOT be (80 + 10) / 2 = 45 km/h!
  assert.equal(stats.avgSpeed, expectedAvgSpeed);
  assert.notEqual(stats.avgSpeed, 45); // Confirms instantaneous speeds are not averaged
});

test("2. Multiple GPS points accumulation", () => {
  const tracker = new GpsAverageSpeedTracker();
  const devId = "TEST_DEV_02";
  const baseLat = 8.260427;
  const baseLng = 77.288300;
  const t0 = 1710000000000;

  tracker.updateGpsPoint(devId, baseLat, baseLng, 40, t0);

  // 3 segments of ~1 km each over 90 seconds each
  let curLat = baseLat;
  let curTime = t0;
  let totalCalculatedDist = 0;

  for (let i = 1; i <= 3; i++) {
    const nextLat = curLat + 0.009;
    curTime += 90 * 1000;
    totalCalculatedDist += haversineDistanceKm(curLat, baseLng, nextLat, baseLng);
    curLat = nextLat;
    tracker.updateGpsPoint(devId, curLat, baseLng, 40, curTime);
  }

  const stats = tracker.getTrackingStats(devId);
  assert.ok(stats !== null);
  assert.equal(stats.segmentCount, 3);
  assert.equal(stats.drivingTimeSec, 270);

  const expectedAvg = Math.round((totalCalculatedDist / (270 / 3600)) * 10) / 10;
  assert.equal(stats.avgSpeed, expectedAvg);
});

test("3. Idle period exclusion (stationary periods do NOT accrue driving time)", () => {
  const tracker = new GpsAverageSpeedTracker();
  const devId = "TEST_DEV_03";
  const baseLat = 8.260427;
  const baseLng = 77.288300;
  const t0 = 1710000000000;

  // Point 1
  tracker.updateGpsPoint(devId, baseLat, baseLng, 40, t0);

  // Point 2: travel ~1 km in 60s
  const lat2 = baseLat + 0.009;
  const t1 = t0 + 60 * 1000;
  tracker.updateGpsPoint(devId, lat2, baseLng, 40, t1);

  const statsMoving = tracker.getTrackingStats(devId);
  const initialDrivingTime = statsMoving.drivingTimeSec;
  const initialAvgSpeed = statsMoving.avgSpeed;

  // Vehicle parks/idles for 300 seconds (5 minutes) with speed = 0 at same location
  const t2 = t1 + 300 * 1000;
  tracker.updateGpsPoint(devId, lat2, baseLng, 0, t2);

  const statsAfterIdle = tracker.getTrackingStats(devId);
  // Driving time must NOT have increased by 300 seconds
  assert.equal(statsAfterIdle.drivingTimeSec, initialDrivingTime);
  // Average speed must NOT be diluted by idle period
  assert.equal(statsAfterIdle.avgSpeed, initialAvgSpeed);
});

test("4. Duplicate timestamps rejection", () => {
  const tracker = new GpsAverageSpeedTracker();
  const devId = "TEST_DEV_04";
  const t0 = 1710000000000;

  tracker.updateGpsPoint(devId, 8.260427, 77.288300, 30, t0);
  // Same timestamp with different coordinates
  tracker.updateGpsPoint(devId, 8.265000, 77.288300, 30, t0);

  const stats = tracker.getTrackingStats(devId);
  assert.equal(stats.segmentCount, 0);
  assert.equal(stats.distanceKm, 0);
});

test("5. Out-of-order timestamps rejection", () => {
  const tracker = new GpsAverageSpeedTracker();
  const devId = "TEST_DEV_05";
  const t0 = 1710000000000;

  tracker.updateGpsPoint(devId, 8.260427, 77.288300, 30, t0);
  tracker.updateGpsPoint(devId, 8.265000, 77.288300, 30, t0 + 60000);

  const stats1 = tracker.getTrackingStats(devId);
  assert.equal(stats1.segmentCount, 1);

  // Send an old point from before t0
  tracker.updateGpsPoint(devId, 8.270000, 77.288300, 30, t0 - 10000);

  const stats2 = tracker.getTrackingStats(devId);
  // Segment count must remain 1 (out-of-order point ignored)
  assert.equal(stats2.segmentCount, 1);
});

test("6. 10-minute+ signal gap exclusion", () => {
  const tracker = new GpsAverageSpeedTracker();
  const devId = "TEST_DEV_06";
  const baseLat = 8.260427;
  const baseLng = 77.288300;
  const t0 = 1710000000000;

  tracker.updateGpsPoint(devId, baseLat, baseLng, 40, t0);
  const lat2 = baseLat + 0.009;
  const t1 = t0 + 60 * 1000;
  tracker.updateGpsPoint(devId, lat2, baseLng, 40, t1);

  const statsBeforeGap = tracker.getTrackingStats(devId);
  assert.equal(statsBeforeGap.drivingTimeSec, 60);

  // Next update arrives 15 minutes later (> 600s gap)
  const lat3 = lat2 + 0.01;
  const t2 = t1 + 900 * 1000;
  tracker.updateGpsPoint(devId, lat3, baseLng, 40, t2);

  const statsAfterGap = tracker.getTrackingStats(devId);
  // The 15-minute gap must NOT be added to driving time
  assert.equal(statsAfterGap.drivingTimeSec, 60);
  assert.equal(statsAfterGap.segmentCount, 1);
});

test("7. GPS teleport/jump rejection (>200 km)", () => {
  const tracker = new GpsAverageSpeedTracker();
  const devId = "TEST_DEV_07";
  const t0 = 1710000000000;

  tracker.updateGpsPoint(devId, 8.260427, 77.288300, 40, t0);

  // Teleport jump to Delhi (~2200 km away) 60 seconds later
  tracker.updateGpsPoint(devId, 28.6139, 77.2090, 40, t0 + 60000);

  const stats = tracker.getTrackingStats(devId);
  assert.equal(stats.segmentCount, 0);
  assert.equal(stats.distanceKm, 0);
});

test("8. Impossible implied speed rejection (>150 km/h)", () => {
  const tracker = new GpsAverageSpeedTracker();
  const devId = "TEST_DEV_08";
  const t0 = 1710000000000;

  tracker.updateGpsPoint(devId, 8.260427, 77.288300, 40, t0);

  // 1 km jump in 5 seconds = (1 / 5) * 3600 = 720 km/h (multipath glitch)
  const lat2 = 8.260427 + 0.009;
  tracker.updateGpsPoint(devId, lat2, 77.288300, 40, t0 + 5000);

  const stats = tracker.getTrackingStats(devId);
  assert.equal(stats.segmentCount, 0);
  assert.equal(stats.distanceKm, 0);
});

test("9. Per-vehicle isolation", () => {
  const tracker = new GpsAverageSpeedTracker();
  const devA = "VEHICLE_A";
  const devB = "VEHICLE_B";
  const t0 = 1710000000000;

  // Vehicle A travels at ~40 km/h
  tracker.updateGpsPoint(devA, 8.260427, 77.288300, 40, t0);
  tracker.updateGpsPoint(devA, 8.269427, 77.288300, 40, t0 + 90000);

  // Vehicle B travels at ~20 km/h
  tracker.updateGpsPoint(devB, 10.000000, 78.000000, 20, t0);
  tracker.updateGpsPoint(devB, 10.004500, 78.000000, 20, t0 + 90000);

  const statsA = tracker.getTrackingStats(devA);
  const statsB = tracker.getTrackingStats(devB);

  assert.ok(statsA !== null);
  assert.ok(statsB !== null);
  assert.notEqual(statsA.avgSpeed, statsB.avgSpeed);
  assert.notEqual(statsA.distanceKm, statsB.distanceKm);
});

test("10. Date-range filtering", () => {
  const points = [
    // Yesterday: 1 km in 60s
    { lat: 8.260427, lng: 77.288300, speed: 40, timestamp: 1710000000000 },
    { lat: 8.269427, lng: 77.288300, speed: 40, timestamp: 1710000060000 },
    // Today: 2 km in 120s
    { lat: 8.300000, lng: 77.300000, speed: 60, timestamp: 1710086400000 },
    { lat: 8.318000, lng: 77.300000, speed: 60, timestamp: 1710086520000 },
  ];

  // Calculate with filter for Today only (timestamp >= 1710086400000)
  const resultToday = calculateAverageSpeedFromPoints(points, {
    minTimestampMs: 1710086400000,
  });

  assert.equal(resultToday.segmentCount, 1);
  assert.equal(resultToday.totalDrivingTimeSec, 120);

  // Calculate all
  const resultAll = calculateAverageSpeedFromPoints(points);
  assert.equal(resultAll.segmentCount, 2);
  assert.equal(resultAll.totalDrivingTimeSec, 180);
});

test("11. Realtime duplicate snapshot protection", () => {
  const tracker = new GpsAverageSpeedTracker();
  const devId = "TEST_DEV_11";
  const t0 = 1710000000000;

  // First snapshot
  tracker.updateGpsPoint(devId, 8.260427, 77.288300, 40, t0);
  tracker.updateGpsPoint(devId, 8.269427, 77.288300, 40, t0 + 60000);

  const stats1 = tracker.getTrackingStats(devId);
  assert.equal(stats1.segmentCount, 1);

  // Firestore snapshot re-fires with identical document (same timestamp t0 + 60000)
  tracker.updateGpsPoint(devId, 8.269427, 77.288300, 40, t0 + 60000);

  const stats2 = tracker.getTrackingStats(devId);
  // State must remain strictly unchanged
  assert.equal(stats2.segmentCount, 1);
  assert.equal(stats2.drivingTimeSec, 60);
  assert.equal(stats2.avgSpeed, stats1.avgSpeed);
});

test("12. Vehicle switching & alias resolution", () => {
  const tracker = new GpsAverageSpeedTracker();
  const vehicleUuid = "1b115b9d-6357-4a9e-8e76-1d59497695af";
  const hardwareDeviceId = "863110086146985";
  const t0 = 1710000000000;

  // Register alias mapping UUID to device ID
  tracker.registerAlias(vehicleUuid, hardwareDeviceId);

  // Feed telemetry under hardware device ID
  tracker.updateGpsPoint(hardwareDeviceId, 8.260427, 77.288300, 45, t0);
  tracker.updateGpsPoint(hardwareDeviceId, 8.269427, 77.288300, 45, t0 + 60000);

  // Query using vehicle UUID
  const speedByUuid = tracker.getAverageSpeed(vehicleUuid);
  // Query using hardware device ID
  const speedByDeviceId = tracker.getAverageSpeed(hardwareDeviceId);

  assert.ok(speedByUuid !== null);
  assert.equal(speedByUuid, speedByDeviceId);
});

test("13. No-data behavior (insufficient points returns null)", () => {
  const tracker = new GpsAverageSpeedTracker();
  const devId = "TEST_DEV_13";

  // 0 points
  assert.equal(tracker.getAverageSpeed(devId), null);
  assert.equal(formatAverageSpeed(tracker.getAverageSpeed(devId)), "—");

  // Only 1 point
  tracker.updateGpsPoint(devId, 8.260427, 77.288300, 40, 1710000000000);
  assert.equal(tracker.getAverageSpeed(devId), null);
  assert.equal(formatAverageSpeed(tracker.getAverageSpeed(devId)), "—");

  // Batch calculation on empty / single point
  assert.equal(calculateAverageSpeedFromPoints([]).averageSpeed, null);
  assert.equal(calculateAverageSpeedFromPoints([{ lat: 8.26, lng: 77.28, timestamp: 1000 }]).averageSpeed, null);
});

test("14. Zero hardcoded fallback (never returns 42)", () => {
  const devId = "TEST_DEV_14";
  const tracker = new GpsAverageSpeedTracker();

  // If no GPS data exists, tracker returns null, NEVER 42
  assert.notEqual(tracker.getAverageSpeed(devId), 42);
  assert.equal(tracker.getAverageSpeed(devId), null);

  // Format utility returns "—", NEVER "42 km/h"
  assert.notEqual(formatAverageSpeed(null), "42 km/h");
  assert.equal(formatAverageSpeed(null), "—");
});

test("15. Firebase timestamp preservation in extractTelemetryTimestamp", () => {
  // Test 1: Explicit recorded_at field
  const data1 = { recorded_at: "2026-10-08T09:00:00Z" };
  assert.equal(extractTelemetryTimestamp(data1), Date.parse("2026-10-08T09:00:00Z"));

  // Test 2: timestamp field
  const data2 = { timestamp: 1710000000000 };
  assert.equal(extractTelemetryTimestamp(data2), 1710000000000);

  // Test 3: Firestore snapshot version timestamp
  const mockDocSnap = {
    _document: {
      version: {
        timestamp: {
          seconds: 1791453574,
          nanoseconds: 912000000,
        },
      },
    },
  };
  const expectedMs = 1791453574 * 1000 + 912;
  assert.equal(extractTelemetryTimestamp({}, mockDocSnap), expectedMs);
});

test("16. Supabase recorded_at timestamp preservation", () => {
  const row = {
    recorded_at: "2026-10-08T10:30:00.000Z",
    last_update: "2026-10-08T10:35:00.000Z",
  };
  // recorded_at is given higher priority over last_update
  assert.equal(extractTelemetryTimestamp(row), Date.parse("2026-10-08T10:30:00.000Z"));

  const rowOnlyLastUpdate = {
    last_update: "2026-10-08T10:35:00.000Z",
  };
  assert.equal(extractTelemetryTimestamp(rowOnlyLastUpdate), Date.parse("2026-10-08T10:35:00.000Z"));
});
