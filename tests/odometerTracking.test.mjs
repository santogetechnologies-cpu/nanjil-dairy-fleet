import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDistance,
  initVehicleOdometerState,
  processOdometerTelemetry,
  reconcileOdometerState,
  persistVehicleOdometer,
  calculateMovementDistanceKm,
  calculateTodayGpsDistance,
  calculateTodayAndTripDistances,
  getTodayIstDateString,
} from "../src/lib/odometerTrackingEngine.ts";

test("0. Haversine Formula Verification: Calculates exact distance between user example coordinates", () => {
  // User example:
  // Previous GPS: 8.5188, 77.9216
  // New GPS: 8.5200, 77.9240
  const dist = calculateDistance(8.5188, 77.9216, 8.5200, 77.9240);
  assert.ok(dist > 0.29 && dist < 0.30, `Expected ~0.2957 km, got ${dist}`);
  assert.equal(Math.round(dist * 1000) / 1000, 0.296);
});

test("1. Test 1: Vehicle Starts Moving — Establishes baseline GPS without false distance increment", () => {
  const vehicle = { id: "v1", number: "TN 75 F 4323", odometer: 48250.0 };
  let state = initVehicleOdometerState(vehicle);
  assert.equal(state.totalOdometerKm, 48250.0);
  assert.equal(state.todayDistanceKm, 0.0);
  assert.equal(state.currentTripDistanceKm, 0.0);

  // Initial fix received while speed > 3 km/h
  const step1 = processOdometerTelemetry(state, {
    id: "tele-1",
    vehicleId: vehicle.id,
    lat: 8.2607,
    lng: 77.2883,
    speed: 25,
    recordedAt: "2026-11-11T05:00:00Z",
  });
  state = step1.updatedState;

  assert.equal(state.isMoving, true);
  assert.equal(step1.distanceAddedKm, 0, "First point establishes coordinate reference");
  assert.equal(state.totalOdometerKm, 48250.0);
});

test("2. Test 2: Vehicle Travels 1 km — Odometer and today distance increase proportionally", () => {
  const vehicle = { id: "v2", number: "TN 75 F 4323", odometer: 48250.0 };
  let state = initVehicleOdometerState(vehicle);

  // First coordinate at (8.2600, 77.2880)
  state = processOdometerTelemetry(state, {
    id: "1",
    vehicleId: vehicle.id,
    lat: 8.2600,
    lng: 77.2880,
    speed: 35,
    recordedAt: "2026-11-11T05:00:00Z",
  }).updatedState;

  // Move ~1.0 km north (0.009 deg latitude is ~0.999 km)
  const step = processOdometerTelemetry(state, {
    id: "2",
    vehicleId: vehicle.id,
    lat: 8.2690,
    lng: 77.2880,
    speed: 35,
    recordedAt: "2026-11-11T05:02:00Z",
  });
  state = step.updatedState;

  assert.ok(step.distanceAddedKm >= 0.99 && step.distanceAddedKm <= 1.01);
  assert.equal(Math.round(state.totalOdometerKm * 10) / 10, 48251.0);
  assert.equal(Math.round(state.todayDistanceKm * 10) / 10, 1.0);
  assert.equal(Math.round(state.currentTripDistanceKm * 10) / 10, 1.0);
});

test("3. Test 3: Vehicle Travels 5 km — Cumulative continuous accumulation", () => {
  const vehicle = { id: "v3", number: "TN 75 F 4323", odometer: 48250.0 };
  let state = initVehicleOdometerState(vehicle);

  state = processOdometerTelemetry(state, {
    id: "1",
    vehicleId: vehicle.id,
    lat: 8.2600,
    lng: 77.2880,
    speed: 40,
    recordedAt: "2026-11-11T05:00:00Z",
  }).updatedState;

  // Move ~5.0 km north (0.045 deg latitude is ~4.996 km)
  const step = processOdometerTelemetry(state, {
    id: "2",
    vehicleId: vehicle.id,
    lat: 8.3050,
    lng: 77.2880,
    speed: 45,
    recordedAt: "2026-11-11T05:08:00Z",
  });
  state = step.updatedState;

  assert.ok(step.distanceAddedKm >= 4.95 && step.distanceAddedKm <= 5.05);
  assert.equal(Math.round(state.totalOdometerKm * 10) / 10, 48255.0);
  assert.equal(Math.round(state.todayDistanceKm * 10) / 10, 5.0);
});

test("4. Test 4: Vehicle Stops — Odometer freezes and rejects stationary GPS drift", () => {
  const vehicle = { id: "v4", number: "TN 75 S 1688", odometer: 461961.0 };
  let state = initVehicleOdometerState(vehicle);

  // Vehicle moves to destination
  state = processOdometerTelemetry(state, {
    id: "1",
    vehicleId: vehicle.id,
    lat: 8.2600,
    lng: 77.2880,
    speed: 30,
    recordedAt: "2026-11-11T05:00:00Z",
  }).updatedState;

  state = processOdometerTelemetry(state, {
    id: "2",
    vehicleId: vehicle.id,
    lat: 8.2700,
    lng: 77.2880,
    speed: 30,
    recordedAt: "2026-11-11T05:03:00Z",
  }).updatedState;

  const odoAtStop = state.totalOdometerKm;
  assert.ok(odoAtStop > 461961.0);

  // Vehicle stops (speed = 0)
  const stopStep = processOdometerTelemetry(state, {
    id: "3",
    vehicleId: vehicle.id,
    lat: 8.2700,
    lng: 77.2880,
    speed: 0,
    recordedAt: "2026-11-11T05:04:00Z",
  });
  state = stopStep.updatedState;
  assert.equal(state.isMoving, false);
  assert.equal(state.totalOdometerKm, odoAtStop);

  // Stationary GPS jitter while parked (1-2 meters drift at speed <= 3)
  const jitterStep = processOdometerTelemetry(state, {
    id: "4",
    vehicleId: vehicle.id,
    lat: 8.27002,
    lng: 77.28801,
    speed: 1.5,
    recordedAt: "2026-11-11T05:06:00Z",
  });
  state = jitterStep.updatedState;
  assert.equal(jitterStep.distanceAddedKm, 0);
  assert.equal(state.totalOdometerKm, odoAtStop, "Odometer must remain frozen while stopped");
});

test("5. Test 5: Vehicle Starts Moving Again — Resumes accumulation seamlessly", () => {
  const vehicle = { id: "v5", number: "TN 75 BC 2219", odometer: 345553.0 };
  let state = initVehicleOdometerState(vehicle);

  // Initial stop
  state = processOdometerTelemetry(state, {
    id: "1",
    vehicleId: vehicle.id,
    lat: 8.2600,
    lng: 77.2880,
    speed: 0,
    recordedAt: "2026-11-11T05:00:00Z",
  }).updatedState;

  // Starts moving again after 2 minutes
  const resumeStep = processOdometerTelemetry(state, {
    id: "2",
    vehicleId: vehicle.id,
    lat: 8.2690,
    lng: 77.2880,
    speed: 35,
    recordedAt: "2026-11-11T05:02:00Z",
  });
  state = resumeStep.updatedState;

  assert.equal(state.isMoving, true);
  assert.ok(resumeStep.distanceAddedKm >= 0.99);
  assert.ok(state.totalOdometerKm > 345553.0);
});

test("6. Test 6: Browser Refresh — State recovery preserves total odometer and today's distance", () => {
  const vehicle = { id: "v6", number: "TN 75 F 4323", odometer: 14250.0 };
  let originalState = initVehicleOdometerState(vehicle, 12.4, "2026-11-11");
  assert.equal(originalState.todayDistanceKm, 12.4);
  assert.equal(originalState.totalOdometerKm, 14262.4);

  // Simulate serialization to localStorage and reloading on refresh
  const serialized = JSON.stringify({ [vehicle.id]: originalState });
  const restoredMap = JSON.parse(serialized);
  const restoredState = restoredMap[vehicle.id];

  assert.equal(restoredState.totalOdometerKm, 14262.4);
  assert.equal(restoredState.todayDistanceKm, 12.4);
  assert.equal(restoredState.baselineOdometerKm, 14250.0);
});

test("7. Test 7: Application Restart — Reconciles with Supabase history without loss", () => {
  // If local cache is blank, historical points from 00:00 IST reconstruct today's distance
  const historicalTodayPoints = [
    { lat: 8.2600, lng: 77.2880, speed: 30, recorded_at: "2026-11-11T01:00:00Z" },
    { lat: 8.2700, lng: 77.2880, speed: 35, recorded_at: "2026-11-11T01:05:00Z" },
    { lat: 8.2800, lng: 77.2880, speed: 40, recorded_at: "2026-11-11T01:10:00Z" },
  ];

  const calculatedToday = calculateTodayGpsDistance(historicalTodayPoints);
  assert.ok(calculatedToday >= 2.2 && calculatedToday <= 2.3);

  const vehicle = { id: "v7", number: "TN 75 S 1688", odometer: 461961.0 };
  const recoveredState = initVehicleOdometerState(vehicle, calculatedToday, "2026-11-11");

  assert.equal(recoveredState.baselineOdometerKm, 461961.0);
  assert.equal(recoveredState.todayDistanceKm, calculatedToday);
  assert.equal(recoveredState.totalOdometerKm, 461961.0 + calculatedToday);
});

test("8. Test 8: GPS Signal Interruption — Gap > 15m does not draw fake jump distance", () => {
  const vehicle = { id: "v8", number: "TN 75 M 0041", odometer: 50000.0 };
  let state = initVehicleOdometerState(vehicle);

  state = processOdometerTelemetry(state, {
    id: "1",
    vehicleId: vehicle.id,
    lat: 8.2600,
    lng: 77.2880,
    speed: 30,
    recordedAt: "2026-11-11T05:00:00Z",
  }).updatedState;

  // Signal interruption for 45 minutes
  const afterInterruption = processOdometerTelemetry(state, {
    id: "2",
    vehicleId: vehicle.id,
    lat: 8.4000,
    lng: 77.2880,
    speed: 35,
    recordedAt: "2026-11-11T05:45:00Z",
  });

  assert.equal(afterInterruption.distanceAddedKm, 0, "Gap > 15m must not add straight-line gap distance");
  assert.equal(afterInterruption.updatedState.totalOdometerKm, 50000.0);
  assert.equal(afterInterruption.updatedState.currentTripDistanceKm, 0, "New trip starts after long gap");
});

test("9. Test 9: Duplicate Telemetry Event — Same ID or timestamp rejected", () => {
  const vehicle = { id: "v9", number: "TN 75 R 9952", odometer: 20000.0 };
  let state = initVehicleOdometerState(vehicle);

  const step1 = processOdometerTelemetry(state, {
    id: "msg-999",
    vehicleId: vehicle.id,
    lat: 8.2600,
    lng: 77.2880,
    speed: 30,
    recordedAt: "2026-11-11T05:00:00Z",
  });
  state = step1.updatedState;

  const dupStep = processOdometerTelemetry(state, {
    id: "msg-999",
    vehicleId: vehicle.id,
    lat: 8.2600,
    lng: 77.2880,
    speed: 30,
    recordedAt: "2026-11-11T05:00:00Z",
  });

  assert.equal(dupStep.isDuplicate, true);
  assert.equal(dupStep.distanceAddedKm, 0);
});

test("10. Test 10: Delayed and Out-of-Order Telemetry — Stale records rejected", () => {
  const vehicle = { id: "v10", number: "TN 75 BF 0320", odometer: 10000.0 };
  let state = initVehicleOdometerState(vehicle);

  // Latest point at 05:10:00
  state = processOdometerTelemetry(state, {
    id: "pkt-latest",
    vehicleId: vehicle.id,
    lat: 8.2700,
    lng: 77.2880,
    speed: 30,
    recordedAt: "2026-11-11T05:10:00Z",
  }).updatedState;

  // Delayed / out-of-order point arriving from 05:05:00 (5 minutes in the past)
  const delayedStep = processOdometerTelemetry(state, {
    id: "pkt-delayed",
    vehicleId: vehicle.id,
    lat: 8.2650,
    lng: 77.2880,
    speed: 30,
    recordedAt: "2026-11-11T05:05:00Z",
  });

  assert.equal(delayedStep.isDuplicate, true, "Delayed/stale telemetry must be rejected");
  assert.equal(delayedStep.distanceAddedKm, 0);
});

test("11. Test 11: Multiple Vehicles Moving Simultaneously — Complete isolation", () => {
  const vehicleA = { id: "vA", number: "TN 75 F 4323", odometer: 14250.0 };
  const vehicleB = { id: "vB", number: "TN 75 S 1688", odometer: 461961.0 };

  let stateA = initVehicleOdometerState(vehicleA);
  let stateB = initVehicleOdometerState(vehicleB);

  stateA = processOdometerTelemetry(stateA, {
    id: "A1",
    vehicleId: "vA",
    lat: 8.2600,
    lng: 77.2880,
    speed: 30,
    recordedAt: "2026-11-11T05:00:00Z",
  }).updatedState;

  stateB = processOdometerTelemetry(stateB, {
    id: "B1",
    vehicleId: "vB",
    lat: 8.1833,
    lng: 77.4119,
    speed: 30,
    recordedAt: "2026-11-11T05:00:00Z",
  }).updatedState;

  // Vehicle A moves 1 km; Vehicle B moves 3 km
  stateA = processOdometerTelemetry(stateA, {
    id: "A2",
    vehicleId: "vA",
    lat: 8.2690,
    lng: 77.2880,
    speed: 35,
    recordedAt: "2026-11-11T05:02:00Z",
  }).updatedState;

  stateB = processOdometerTelemetry(stateB, {
    id: "B2",
    vehicleId: "vB",
    lat: 8.2103,
    lng: 77.4119,
    speed: 40,
    recordedAt: "2026-11-11T05:03:00Z",
  }).updatedState;

  assert.ok(stateA.todayDistanceKm >= 0.99 && stateA.todayDistanceKm <= 1.01);
  assert.ok(stateB.todayDistanceKm >= 2.95 && stateB.todayDistanceKm <= 3.05);
  assert.notEqual(stateA.todayDistanceKm, stateB.todayDistanceKm);
});

test("12. Test 12: Midnight Daily-Distance Reset — Asia/Kolkata date transition", () => {
  const vehicle = { id: "v12", number: "TN 75 S 9826", odometer: 20000.0 };
  let state = initVehicleOdometerState(vehicle, 126.4, "2026-11-11");
  assert.equal(state.todayDistanceKm, 126.4);
  assert.equal(state.totalOdometerKm, 20126.4);

  // Rollover to next local date in Asia/Kolkata ("2026-11-12")
  const nextDayStep = processOdometerTelemetry(
    state,
    {
      id: "day2-pt",
      vehicleId: vehicle.id,
      lat: 8.2600,
      lng: 77.2880,
      speed: 0,
      recordedAt: "2026-11-11T18:31:00Z", // 00:01 IST
    },
    "2026-11-12",
  );

  state = nextDayStep.updatedState;
  assert.equal(state.todayDate, "2026-11-12");
  assert.equal(state.todayDistanceKm, 0.0, "Today's distance must reset to 0 at local midnight");
  assert.equal(state.totalOdometerKm, 20126.4, "Total odometer must NEVER reset on day transition");
});

test("13. Regression Fix: Firebase Stream with Monotonic Timestamps Continuously Advances Odometer", () => {
  const vehicle = { id: "v13", number: "TN 75 F 4323", odometer: 48250.0 };
  let state = initVehicleOdometerState(vehicle);

  // Snapshot 1 at T0
  const t0 = new Date("2026-11-11T06:00:00Z");
  state = processOdometerTelemetry(state, {
    vehicleId: vehicle.id,
    lat: 8.2600,
    lng: 77.2880,
    speed: 30,
    recordedAt: t0.toISOString(),
  }).updatedState;

  // Snapshot 2 at T0 + 30s (~0.3 km north)
  const t1 = new Date(t0.getTime() + 30000);
  const step2 = processOdometerTelemetry(state, {
    vehicleId: vehicle.id,
    lat: 8.2627,
    lng: 77.2880,
    speed: 36,
    recordedAt: t1.toISOString(),
  });
  state = step2.updatedState;
  assert.equal(step2.isDuplicate, false);
  assert.ok(step2.distanceAddedKm > 0.28 && step2.distanceAddedKm < 0.32);
  assert.equal(Math.round(state.totalOdometerKm * 10) / 10, 48250.3);

  // Snapshot 3 at T0 + 60s (~0.35 km further)
  const t2 = new Date(t0.getTime() + 60000);
  const step3 = processOdometerTelemetry(state, {
    vehicleId: vehicle.id,
    lat: 8.2658,
    lng: 77.2880,
    speed: 40,
    recordedAt: t2.toISOString(),
  });
  state = step3.updatedState;
  assert.equal(step3.isDuplicate, false);
  assert.ok(step3.distanceAddedKm > 0.32 && step3.distanceAddedKm < 0.36);
  assert.equal(Math.round(state.totalOdometerKm * 10) / 10, 48250.6);

  // Duplicate snapshot with identical timestamp MUST be rejected without adding distance
  const dupStep = processOdometerTelemetry(state, {
    vehicleId: vehicle.id,
    lat: 8.2658,
    lng: 77.2880,
    speed: 40,
    recordedAt: t2.toISOString(),
  });
  assert.equal(dupStep.isDuplicate, true);
  assert.equal(dupStep.distanceAddedKm, 0);
  assert.equal(Math.round(dupStep.updatedState.totalOdometerKm * 10) / 10, 48250.6);
});

test("14. Movement Detection: GPS Distance with Realistic Implied Speed when Speed Sensor Reports 0", () => {
  const vehicle = { id: "v14", number: "TN 75 S 1688", odometer: 10000.0 };
  let state = initVehicleOdometerState(vehicle);

  // Point 1
  state = processOdometerTelemetry(state, {
    id: "p1",
    vehicleId: vehicle.id,
    lat: 8.2600,
    lng: 77.2880,
    speed: 0,
    recordedAt: "2026-11-11T06:00:00Z",
  }).updatedState;

  // Point 2: 1 minute later, moved ~0.5 km (0.0045 deg lat), speed field = 0
  // Implied speed = 0.5 km / (1/60 hr) = 30 km/h
  const step2 = processOdometerTelemetry(state, {
    id: "p2",
    vehicleId: vehicle.id,
    lat: 8.2645,
    lng: 77.2880,
    speed: 0,
    recordedAt: "2026-11-11T06:01:00Z",
  });

  assert.equal(step2.isDuplicate, false);
  assert.equal(step2.updatedState.isMoving, true, "Should detect physical movement via implied speed");
  assert.ok(step2.distanceAddedKm >= 0.49 && step2.distanceAddedKm <= 0.51);
  assert.equal(Math.round(step2.updatedState.totalOdometerKm * 10) / 10, 10000.5);
});

test("15. Exact Cumulative Odometer Progression: 48,250.0 -> 48,250.5 -> 48,251.0 -> 48,253.5 -> 48,258.5 km", () => {
  const vehicle = { id: "v15", number: "TN 75 F 4323", odometer: 48250.0 };
  let state = initVehicleOdometerState(vehicle);
  assert.equal(state.totalOdometerKm, 48250.0);

  let currentLat = 8.2600;
  const currentLng = 77.2880;
  let currentTime = new Date("2026-11-11T07:00:00Z").getTime();

  // Baseline point
  state = processOdometerTelemetry(state, {
    vehicleId: vehicle.id,
    lat: currentLat,
    lng: currentLng,
    speed: 30,
    recordedAt: new Date(currentTime).toISOString(),
  }).updatedState;

  // Step A: +0.5 km (0.0045 deg lat in 1 min)
  currentLat += 0.0045;
  currentTime += 60000;
  state = processOdometerTelemetry(state, {
    vehicleId: vehicle.id,
    lat: currentLat,
    lng: currentLng,
    speed: 30,
    recordedAt: new Date(currentTime).toISOString(),
  }).updatedState;
  assert.equal(Math.round(state.totalOdometerKm * 10) / 10, 48250.5);

  // Step B: +0.5 km (0.0045 deg lat in 1 min) -> 48,251.0
  currentLat += 0.0045;
  currentTime += 60000;
  state = processOdometerTelemetry(state, {
    vehicleId: vehicle.id,
    lat: currentLat,
    lng: currentLng,
    speed: 30,
    recordedAt: new Date(currentTime).toISOString(),
  }).updatedState;
  assert.equal(Math.round(state.totalOdometerKm * 10) / 10, 48251.0);

  // Step C: +2.5 km (0.0225 deg lat in 4 min) -> 48,253.5
  currentLat += 0.0225;
  currentTime += 240000;
  state = processOdometerTelemetry(state, {
    vehicleId: vehicle.id,
    lat: currentLat,
    lng: currentLng,
    speed: 40,
    recordedAt: new Date(currentTime).toISOString(),
  }).updatedState;
  assert.equal(Math.round(state.totalOdometerKm * 10) / 10, 48253.5);

  // Step D: +5.0 km (0.0450 deg lat in 8 min) -> 48,258.5
  currentLat += 0.0450;
  currentTime += 480000;
  state = processOdometerTelemetry(state, {
    vehicleId: vehicle.id,
    lat: currentLat,
    lng: currentLng,
    speed: 40,
    recordedAt: new Date(currentTime).toISOString(),
  }).updatedState;
  assert.equal(Math.round(state.totalOdometerKm * 10) / 10, 48258.5);
  assert.equal(Math.round(state.todayDistanceKm * 10) / 10, 8.5);
  assert.equal(Math.round(state.currentTripDistanceKm * 10) / 10, 8.5);
});

test("16. Multi-Source Deduplication: Identical Event from vehicle_telemetry & telemetry_history", () => {
  const vehicle = { id: "v16", number: "TN 75 AA 1111", odometer: 50000.0 };
  let state = initVehicleOdometerState(vehicle);

  // Baseline
  state = processOdometerTelemetry(state, {
    id: "event-1",
    vehicleId: vehicle.id,
    lat: 8.2600,
    lng: 77.2880,
    speed: 35,
    recordedAt: "2026-11-11T08:00:00Z",
  }).updatedState;

  // Event 2 arrives via vehicle_telemetry UPDATE
  const event2Time = "2026-11-11T08:02:00Z";
  const stepLive = processOdometerTelemetry(state, {
    id: "tele-row-100",
    vehicleId: vehicle.id,
    lat: 8.2690,
    lng: 77.2880,
    speed: 35,
    recordedAt: event2Time,
  });
  state = stepLive.updatedState;
  assert.equal(stepLive.isDuplicate, false);
  assert.ok(stepLive.distanceAddedKm >= 0.99 && stepLive.distanceAddedKm <= 1.01);
  assert.equal(Math.round(state.totalOdometerKm * 10) / 10, 50001.0);

  // The exact same event also arrives via telemetry_history INSERT
  const stepHist = processOdometerTelemetry(state, {
    id: "tele-row-100",
    vehicleId: vehicle.id,
    lat: 8.2690,
    lng: 77.2880,
    speed: 35,
    recordedAt: event2Time,
  });
  assert.equal(stepHist.isDuplicate, true, "Must recognize and deduplicate by telemetry ID");
  assert.equal(stepHist.distanceAddedKm, 0);
  assert.equal(Math.round(stepHist.updatedState.totalOdometerKm * 10) / 10, 50001.0);
});

test("17. Multi-Trip Segmentation & Reset: Vehicle completes Trip 1, stops >= 5m, starts Trip 2", () => {
  const vehicle = { id: "v17", number: "TN 75 F 4323", odometer: 14000.0 };
  let state = initVehicleOdometerState(vehicle);

  // --- TRIP 1: Travels 5.0 km from 08:00 to 08:10 ---
  state = processOdometerTelemetry(state, {
    id: "t1-start",
    vehicleId: vehicle.id,
    lat: 8.2600,
    lng: 77.2880,
    speed: 30,
    recordedAt: "2026-11-11T08:00:00Z",
  }).updatedState;

  // Move 5.0 km north (~0.0450 deg)
  state = processOdometerTelemetry(state, {
    id: "t1-end",
    vehicleId: vehicle.id,
    lat: 8.3050,
    lng: 77.2880,
    speed: 30,
    recordedAt: "2026-11-11T08:10:00Z",
  }).updatedState;

  assert.equal(Math.round(state.todayDistanceKm * 10) / 10, 5.0);
  assert.equal(Math.round(state.currentTripDistanceKm * 10) / 10, 5.0);
  assert.equal(Math.round(state.totalOdometerKm * 10) / 10, 14005.0);

  // --- STATIONARY STOP: Stopped for 15 minutes at customer location ---
  // Ping 1 at 08:11 (speed 0)
  state = processOdometerTelemetry(state, {
    id: "stop-1",
    vehicleId: vehicle.id,
    lat: 8.3050,
    lng: 77.2880,
    speed: 0,
    recordedAt: "2026-11-11T08:11:00Z",
  }).updatedState;
  assert.equal(state.isMoving, false);
  assert.equal(Math.round(state.todayDistanceKm * 10) / 10, 5.0);
  assert.equal(Math.round(state.currentTripDistanceKm * 10) / 10, 5.0);

  // Ping 2 at 08:20 (speed 0, 9 minutes later)
  state = processOdometerTelemetry(state, {
    id: "stop-2",
    vehicleId: vehicle.id,
    lat: 8.3050,
    lng: 77.2880,
    speed: 0,
    recordedAt: "2026-11-11T08:20:00Z",
  }).updatedState;
  assert.equal(state.isMoving, false);

  // --- TRIP 2: Starts moving again at 08:26 (stopped for 15 minutes) ---
  // Moving 2.0 km north (~0.0180 deg)
  state = processOdometerTelemetry(state, {
    id: "t2-pt1",
    vehicleId: vehicle.id,
    lat: 8.3230,
    lng: 77.2880,
    speed: 35,
    recordedAt: "2026-11-11T08:26:00Z",
  }).updatedState;

  assert.equal(state.isMoving, true);
  // Today distance must accumulate both trips: 5.0 + 2.0 = 7.0 km
  assert.equal(Math.round(state.todayDistanceKm * 10) / 10, 7.0);
  // Current Trip distance must ONLY reflect Trip 2: 2.0 km (NOT 7.0 km!)
  assert.equal(Math.round(state.currentTripDistanceKm * 10) / 10, 2.0);
  assert.equal(Math.round(state.totalOdometerKm * 10) / 10, 14007.0);
});

test("18. calculateTodayAndTripDistances: Segmenting batch GPS points into Today vs Current Trip", () => {
  const points = [
    // Trip 1: 04:00 to 04:10 (~5 km)
    { lat: 8.2600, lng: 77.2880, speed: 30, recorded_at: "2026-11-11T04:00:00Z" },
    { lat: 8.3050, lng: 77.2880, speed: 30, recorded_at: "2026-11-11T04:10:00Z" },
    // Stop at 04:11 for 30 minutes
    { lat: 8.3050, lng: 77.2880, speed: 0, recorded_at: "2026-11-11T04:11:00Z" },
    { lat: 8.3050, lng: 77.2880, speed: 0, recorded_at: "2026-11-11T04:40:00Z" },
    // Trip 2: 04:45 to 04:55 (~3 km)
    { lat: 8.3320, lng: 77.2880, speed: 35, recorded_at: "2026-11-11T04:45:00Z" },
    { lat: 8.3320, lng: 77.2880, speed: 35, recorded_at: "2026-11-11T04:55:00Z" },
  ];

  const res = calculateTodayAndTripDistances(points);
  assert.equal(res.tripsCount, 2);
  // Today's total distance: ~5.0 km + ~3.0 km = ~8.0 km
  assert.ok(res.todayDistanceKm >= 7.9 && res.todayDistanceKm <= 8.1);
  // Current trip distance: ONLY Trip 2 (~3.0 km)
  assert.ok(res.currentTripDistanceKm >= 2.9 && res.currentTripDistanceKm <= 3.1);
});

test("19. Regression Suite: Starting baseline 14,398.00 km with GPS movement (14,398.25 -> 14,398.50 -> 14,399.00 -> 14,400.25 km)", () => {
  const vehicle = { id: "v19", number: "TN 75 F 4323", odometer: 14398.0 };
  let state = initVehicleOdometerState(vehicle);

  // Requirement 1 & 5: Baseline 14,398 km with no hardware telemetry defaults to gps_estimated
  assert.equal(state.totalOdometerKm, 14398.0);
  assert.equal(state.readingSource, "gps_estimated");

  // Requirement 2: First GPS coordinate initializes coordinate reference without artificial increment
  let lat = 8.260000;
  let lng = 77.288000;
  let timeMs = new Date("2026-11-12T05:00:00.000Z").getTime();

  let res = processOdometerTelemetry(state, {
    id: "p1",
    vehicleId: vehicle.id,
    lat,
    lng,
    speed: 30,
    recordedAt: new Date(timeMs).toISOString(),
  });
  state = res.updatedState;
  assert.equal(res.distanceAddedKm, 0);
  assert.equal(state.totalOdometerKm, 14398.0);
  assert.equal(state.readingSource, "gps_estimated");

  // Requirement 3 & 9: Move +0.25 km north (~0.00225 deg lat in 30 sec) -> 14,398.25 km
  lat += 0.00225;
  timeMs += 30000;
  res = processOdometerTelemetry(state, {
    id: "p2",
    vehicleId: vehicle.id,
    lat,
    lng,
    speed: 30,
    recordedAt: new Date(timeMs).toISOString(),
  });
  state = res.updatedState;
  assert.equal(state.totalOdometerKm, 14398.25);
  assert.equal(state.todayDistanceKm, 0.25);
  assert.equal(state.readingSource, "gps_estimated");

  // Requirement 4 & 9: Move another +0.25 km north -> 14,398.50 km
  lat += 0.00225;
  timeMs += 30000;
  res = processOdometerTelemetry(state, {
    id: "p3",
    vehicleId: vehicle.id,
    lat,
    lng,
    speed: 30,
    recordedAt: new Date(timeMs).toISOString(),
  });
  state = res.updatedState;
  assert.equal(state.totalOdometerKm, 14398.5);
  assert.equal(state.todayDistanceKm, 0.5);

  // Move +0.50 km north (~0.00450 deg lat in 60 sec) -> 14,399.00 km
  lat += 0.0045;
  timeMs += 60000;
  res = processOdometerTelemetry(state, {
    id: "p4",
    vehicleId: vehicle.id,
    lat,
    lng,
    speed: 30,
    recordedAt: new Date(timeMs).toISOString(),
  });
  state = res.updatedState;
  assert.equal(state.totalOdometerKm, 14399.0);
  assert.equal(state.todayDistanceKm, 1.0);

  // Move +1.25 km north (~0.01125 deg lat in 150 sec) -> 14,400.25 km
  lat += 0.01125;
  timeMs += 150000;
  res = processOdometerTelemetry(state, {
    id: "p5",
    vehicleId: vehicle.id,
    lat,
    lng,
    speed: 30,
    recordedAt: new Date(timeMs).toISOString(),
  });
  state = res.updatedState;
  assert.equal(state.totalOdometerKm, 14400.25);
  assert.equal(state.todayDistanceKm, 2.25);
  assert.equal(state.readingSource, "gps_estimated");
});

test("20. Hardware Odometer Protection & GPS Non-Double-Counting", () => {
  const vehicle = { id: "v20", number: "TN 75 BC 2219", odometer: 345000.0 };
  let state = initVehicleOdometerState(vehicle);

  // GPS movement at 345,000 km
  state = processOdometerTelemetry(state, {
    id: "1",
    vehicleId: vehicle.id,
    lat: 8.2600,
    lng: 77.2880,
    speed: 30,
    recordedAt: "2026-11-12T06:00:00Z",
  }).updatedState;

  // Genuine hardware telemetry arrives from CAN bus (345010.00 km)
  const hwStep = processOdometerTelemetry(state, {
    id: "2",
    vehicleId: vehicle.id,
    lat: 8.2690,
    lng: 77.2880,
    speed: 30,
    hardwareOdometer: 345010.0,
    isVerifiedHardware: true,
    recordedAt: "2026-11-12T06:02:00Z",
  });
  state = hwStep.updatedState;

  // Requirement 7 & 8: Genuine hardware reading is authoritative; GPS distance in that packet is NOT double counted
  assert.equal(state.totalOdometerKm, 345010.0);
  assert.equal(state.readingSource, "hardware");

  // Requirement 8: When hardware telemetry ceases in next packet, fall back to GPS Estimated without resetting total
  const nextGps = processOdometerTelemetry(state, {
    id: "3",
    vehicleId: vehicle.id,
    lat: 8.2780, // +1.0 km north
    lng: 77.2880,
    speed: 30,
    hardwareOdometer: null, // hardware telemetry missing
    recordedAt: "2026-11-12T06:04:00Z",
  });
  state = nextGps.updatedState;

  assert.equal(state.readingSource, "gps_estimated");
  assert.ok(state.totalOdometerKm >= 345010.99 && state.totalOdometerKm <= 345011.01);
});

test("21. State Recovery & Reclassification: Rescues spurious hardware states from baseline", () => {
  // Existing state in localStorage was classified as hardware because baseline odometer was passed
  const spuriousState = {
    vehicleId: "v21",
    totalOdometerKm: 14398.0,
    todayDistanceKm: 0.0,
    currentTripDistanceKm: 0.0,
    currentSpeedKmh: 0,
    readingSource: "hardware", // spuriously classified
    isMoving: false,
    lastUpdated: "2026-11-12T04:00:00Z",
    todayDate: "2026-11-12",
    baselineOdometerKm: 14398.0,
    previousLatitude: 8.2600,
    previousLongitude: 77.2880,
    previousGpsTimestamp: "2026-11-12T04:00:00Z",
  };

  const recovered = reconcileOdometerState(spuriousState, 14398.0, "2026-11-12");
  assert.equal(recovered.readingSource, "gps_estimated", "Spurious hardware baseline must be restored to gps_estimated");
  assert.equal(recovered.totalOdometerKm, 14398.0);
  assert.equal(recovered.previousLatitude, 8.2600);

  // Now incoming movement increments odometer immediately
  const moved = processOdometerTelemetry(recovered, {
    id: "recov-move",
    vehicleId: "v21",
    lat: 8.2690,
    lng: 77.2880,
    speed: 30,
    recordedAt: "2026-11-12T04:02:00Z",
  });
  assert.ok(moved.updatedState.totalOdometerKm >= 14398.99 && moved.updatedState.totalOdometerKm <= 14399.01);
  assert.equal(moved.updatedState.readingSource, "gps_estimated");
});

test("22. Database Resilience: Persists integer to vehicles.odometer and never calls missing tables", async () => {
  const state = {
    vehicleId: "v-persist-1",
    deviceId: "863110086146753",
    totalOdometerKm: 14405.42,
    todayDistanceKm: 27.42,
    currentTripDistanceKm: 27.42,
    currentSpeedKmh: 15,
    readingSource: "gps_estimated",
    baselineOdometerKm: 14378.0,
    todayDate: "2026-11-12",
    isMoving: true,
  };

  const updateCalls = [];

  const mockSupabase = {
    from(table) {
      if (table === "vehicles") {
        return {
          update(payload) {
            updateCalls.push(payload);
            return {
              eq(col, val) {
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      throw new Error(`Unexpected call to missing database table: ${table}`);
    },
  };

  // Must write rounded integer to vehicles.odometer to prevent HTTP 400 Bad Request
  // Must NOT call vehicle_odometers table, preventing HTTP 404 Not Found errors
  await persistVehicleOdometer(mockSupabase, state);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].odometer, 14405, "Must persist rounded integer to vehicles.odometer to prevent HTTP 400");
});


