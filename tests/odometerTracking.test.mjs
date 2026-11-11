import test from "node:test";
import assert from "node:assert/strict";
import {
  initVehicleOdometerState,
  processOdometerTelemetry,
  calculateMovementDistanceKm,
  calculateTodayGpsDistance,
  getTodayIstDateString,
} from "../src/lib/odometerTrackingEngine.ts";

test("1. Vehicle Moving Continuously: Odometer and Today Distance increase accurately", () => {
  const vehicle = {
    id: "v1-moving",
    number: "TN 75 F 4323",
    odometer: 14250,
  };

  let state = initVehicleOdometerState(vehicle);
  assert.equal(state.totalOdometerKm, 14250);
  assert.equal(state.todayDistanceKm, 0);
  assert.equal(state.readingSource, "gps_estimated");

  // Step 1: Vehicle starts moving at (8.2607, 77.2883) at 30 km/h
  const step1 = processOdometerTelemetry(state, {
    id: "1",
    vehicleId: vehicle.id,
    lat: 8.2607,
    lng: 77.2883,
    speed: 30,
    recordedAt: "2026-11-11T05:00:00Z",
  });
  state = step1.updatedState;
  assert.equal(state.isMoving, true);
  assert.equal(state.totalOdometerKm, 14250); // first point establishes baseline position

  // Step 2: Moves 1.2 km down the road at 40 km/h 2 minutes later
  const step2 = processOdometerTelemetry(state, {
    id: "2",
    vehicleId: vehicle.id,
    lat: 8.2700,
    lng: 77.2950,
    speed: 40,
    recordedAt: "2026-11-11T05:02:00Z",
  });
  state = step2.updatedState;
  assert.equal(state.isMoving, true);
  assert.ok(step2.distanceAddedKm > 1.0 && step2.distanceAddedKm < 1.5);
  assert.ok(state.totalOdometerKm > 14251.0);
  assert.ok(state.todayDistanceKm > 1.0);
  assert.equal(state.currentTripDistanceKm, state.todayDistanceKm);

  // Step 3: Moves another 2.5 km
  const prevOdo = state.totalOdometerKm;
  const step3 = processOdometerTelemetry(state, {
    id: "3",
    vehicleId: vehicle.id,
    lat: 8.2900,
    lng: 77.3050,
    speed: 45,
    recordedAt: "2026-11-11T05:05:00Z",
  });
  state = step3.updatedState;
  assert.ok(state.totalOdometerKm > prevOdo);
  assert.ok(state.todayDistanceKm > 3.0);
});

test("2. Vehicle Stopping and Restarting: Odometer freezes and rejects stationary GPS drift", () => {
  const vehicle = { id: "v2-stop", number: "TN 75 S 1688", odometer: 461961 };
  let state = initVehicleOdometerState(vehicle);

  // Initialize moving position
  state = processOdometerTelemetry(state, {
    id: "1",
    vehicleId: vehicle.id,
    lat: 8.2607,
    lng: 77.2883,
    speed: 35,
    recordedAt: "2026-11-11T05:00:00Z",
  }).updatedState;

  // Move 1 km
  state = processOdometerTelemetry(state, {
    id: "2",
    vehicleId: vehicle.id,
    lat: 8.2690,
    lng: 77.2883,
    speed: 35,
    recordedAt: "2026-11-11T05:02:00Z",
  }).updatedState;

  const odoAtStop = state.totalOdometerKm;
  assert.ok(odoAtStop > 461961);

  // Vehicle STOPS (speed = 0)
  const stopStep = processOdometerTelemetry(state, {
    id: "3",
    vehicleId: vehicle.id,
    lat: 8.2690,
    lng: 77.2883,
    speed: 0,
    recordedAt: "2026-11-11T05:03:00Z",
  });
  state = stopStep.updatedState;
  assert.equal(state.isMoving, false);
  assert.equal(state.totalOdometerKm, odoAtStop);

  // Stationary GPS jitter while parked (e.g. 2 meters drift)
  const jitterStep = processOdometerTelemetry(state, {
    id: "4",
    vehicleId: vehicle.id,
    lat: 8.26902,
    lng: 77.28831,
    speed: 1, // < 3 km/h
    recordedAt: "2026-11-11T05:05:00Z",
  });
  state = jitterStep.updatedState;
  assert.equal(jitterStep.distanceAddedKm, 0, "Must not add stationary GPS jitter to odometer");
  assert.equal(state.totalOdometerKm, odoAtStop, "Odometer must remain frozen while stopped");

  // Vehicle RESTARTS and moves 2 km
  const restartStep = processOdometerTelemetry(state, {
    id: "5",
    vehicleId: vehicle.id,
    lat: 8.2870,
    lng: 77.2883,
    speed: 40,
    recordedAt: "2026-11-11T05:10:00Z",
  });
  state = restartStep.updatedState;
  assert.equal(state.isMoving, true);
  assert.ok(restartStep.distanceAddedKm > 1.8);
  assert.ok(state.totalOdometerKm > odoAtStop);
});

test("3. Signal Loss and Gap Handling: Signal gap > 15m does not draw fake jump distance", () => {
  const vehicle = { id: "v3-gap", number: "TN 75 BC 2219", odometer: 345553 };
  let state = initVehicleOdometerState(vehicle);

  // Point A at 05:00
  state = processOdometerTelemetry(state, {
    id: "1",
    vehicleId: vehicle.id,
    lat: 8.2607,
    lng: 77.2883,
    speed: 30,
    recordedAt: "2026-11-11T05:00:00Z",
  }).updatedState;

  // Signal outage for 45 minutes, reappears 15 km away
  const afterGapStep = processOdometerTelemetry(state, {
    id: "2",
    vehicleId: vehicle.id,
    lat: 8.3900,
    lng: 77.2883,
    speed: 35,
    recordedAt: "2026-11-11T05:45:00Z",
  });

  assert.equal(afterGapStep.distanceAddedKm, 0, "Outage gap > 15 mins must not be added as straight-line travel distance");
  assert.equal(afterGapStep.updatedState.totalOdometerKm, 345553);
});

test("4. Duplicate Telemetry Rejection: Identical timestamps/IDs are safely ignored", () => {
  const vehicle = { id: "v4-dup", number: "TN 75 BF 0320", odometer: 10000 };
  let state = initVehicleOdometerState(vehicle);

  const step1 = processOdometerTelemetry(state, {
    id: "packet-101",
    vehicleId: vehicle.id,
    lat: 8.2607,
    lng: 77.2883,
    speed: 30,
    recordedAt: "2026-11-11T05:00:00Z",
  });
  state = step1.updatedState;
  assert.equal(step1.isDuplicate, false);

  // Duplicate packet arrives
  const dupStep = processOdometerTelemetry(state, {
    id: "packet-101",
    vehicleId: vehicle.id,
    lat: 8.2607,
    lng: 77.2883,
    speed: 30,
    recordedAt: "2026-11-11T05:00:00Z",
  });
  assert.equal(dupStep.isDuplicate, true);
  assert.equal(dupStep.distanceAddedKm, 0);
});

test("5. Vehicle Isolation: Multiple vehicles accumulate distance independently", () => {
  const vehicleA = { id: "vA", number: "TN 75 F 4323", odometer: 10000 };
  const vehicleB = { id: "vB", number: "TN 75 S 1688", odometer: 50000 };

  let stateA = initVehicleOdometerState(vehicleA);
  let stateB = initVehicleOdometerState(vehicleB);

  // Initialize both
  stateA = processOdometerTelemetry(stateA, {
    id: "A1",
    vehicleId: "vA",
    lat: 8.2607,
    lng: 77.2883,
    speed: 40,
    recordedAt: "2026-11-11T05:00:00Z",
  }).updatedState;

  stateB = processOdometerTelemetry(stateB, {
    id: "B1",
    vehicleId: "vB",
    lat: 8.1833,
    lng: 77.4119,
    speed: 0, // vehicle B is parked
    recordedAt: "2026-11-11T05:00:00Z",
  }).updatedState;

  // Vehicle A moves 2 km
  stateA = processOdometerTelemetry(stateA, {
    id: "A2",
    vehicleId: "vA",
    lat: 8.2787,
    lng: 77.2883,
    speed: 40,
    recordedAt: "2026-11-11T05:03:00Z",
  }).updatedState;

  assert.ok(stateA.todayDistanceKm > 1.8);
  assert.equal(stateB.todayDistanceKm, 0, "Parked vehicle B must have zero distance");
  assert.equal(stateB.totalOdometerKm, 50000);
});

test("6. Daily Distance Rollover: Midnight Asia/Kolkata resets today distance but preserves total odometer", () => {
  const vehicle = { id: "v6-daily", number: "TN 75 S 9826", odometer: 20000 };
  let state = initVehicleOdometerState(vehicle, 45.5, "2026-11-11");
  assert.equal(state.todayDistanceKm, 45.5);
  assert.equal(state.totalOdometerKm, 20045.5);

  // Next local day arrives ("2026-11-12")
  const nextDayStep = processOdometerTelemetry(
    state,
    {
      id: "day2-pt1",
      vehicleId: vehicle.id,
      lat: 8.2607,
      lng: 77.2883,
      speed: 0,
      recordedAt: "2026-11-11T18:31:00Z", // Past midnight IST
    },
    "2026-11-12",
  );

  state = nextDayStep.updatedState;
  assert.equal(state.todayDate, "2026-11-12");
  assert.equal(state.todayDistanceKm, 0, "Today distance must reset to 0 at local midnight");
  assert.equal(state.totalOdometerKm, 20045.5, "Total odometer must NEVER reset on day transition");
});

test("7. Hardware vs GPS Estimated Priority: Hardware odometer takes precedence", () => {
  const vehicle = { id: "v7-hw", number: "TN 75 M 0041", odometer: 80000 };
  let state = initVehicleOdometerState(vehicle);
  assert.equal(state.readingSource, "gps_estimated");

  // Hardware OBD reading arrives
  const hwStep = processOdometerTelemetry(state, {
    id: "hw-1",
    vehicleId: vehicle.id,
    odometer: 80120, // 120 km higher
    speed: 45,
    lat: 8.2607,
    lng: 77.2883,
    recordedAt: "2026-11-11T05:00:00Z",
  });

  state = hwStep.updatedState;
  assert.equal(state.readingSource, "hardware");
  assert.equal(state.totalOdometerKm, 80120);
});

test("8. Baseline Protection: Never roll back or silently decrease verified baseline odometer", () => {
  const vehicle = { id: "v8-base", number: "TN 75 BC 2219", odometer: 345553 };
  let state = initVehicleOdometerState(vehicle);

  // Bad hardware packet with lower odometer (e.g. 0 or corrupt sensor)
  const badStep = processOdometerTelemetry(state, {
    id: "bad-1",
    vehicleId: vehicle.id,
    odometer: 100, // Glitch attempt to roll back 345,553 km
    speed: 30,
    lat: 8.2607,
    lng: 77.2883,
    recordedAt: "2026-11-11T05:00:00Z",
  });

  state = badStep.updatedState;
  assert.equal(state.totalOdometerKm, 345553, "Must reject odometer rollback below verified baseline");
});

test("9. Outlier Rejection: Teleports > 200 km or implied speed > 160 km/h add zero distance", () => {
  const vehicle = { id: "v9-jump", number: "TN 75 R 9952", odometer: 15000 };
  let state = initVehicleOdometerState(vehicle);

  state = processOdometerTelemetry(state, {
    id: "1",
    vehicleId: vehicle.id,
    lat: 8.2607,
    lng: 77.2883,
    speed: 40,
    recordedAt: "2026-11-11T05:00:00Z",
  }).updatedState;

  // Jump to Mumbai (800+ km away in 10s)
  const jumpStep = processOdometerTelemetry(state, {
    id: "2",
    vehicleId: vehicle.id,
    lat: 19.0760,
    lng: 72.8777,
    speed: 40,
    recordedAt: "2026-11-11T05:00:10Z",
  });

  assert.equal(jumpStep.distanceAddedKm, 0, "Must not add teleport jump distance");
  assert.equal(jumpStep.updatedState.totalOdometerKm, 15000);
});
