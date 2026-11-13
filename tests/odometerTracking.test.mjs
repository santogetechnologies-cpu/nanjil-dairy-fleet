import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDistance,
  initVehicleOdometerState,
  processOdometerTelemetry,
  reconcileOdometerState,
  syncManualOdometerBaseline,
  notifyManualOdometerUpdate,
  persistVehicleOdometer,
  calculateMovementDistanceKm,
  calculateTodayGpsDistance,
  calculateTodayAndTripDistances,
  getTodayIstDateString,
  LOCAL_STORAGE_KEY,
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
  const todayStr = getTodayIstDateString();
  // Existing state in localStorage was classified as hardware because baseline odometer was passed
  const spuriousState = {
    vehicleId: "v21",
    totalOdometerKm: 14398.0,
    todayDistanceKm: 0.0,
    currentTripDistanceKm: 0.0,
    currentSpeedKmh: 0,
    readingSource: "hardware", // spuriously classified
    isMoving: false,
    lastUpdated: `${todayStr}T04:00:00Z`,
    todayDate: todayStr,
    baselineOdometerKm: 14398.0,
    previousLatitude: 8.2600,
    previousLongitude: 77.2880,
    previousGpsTimestamp: `${todayStr}T04:00:00Z`,
  };

  const recovered = reconcileOdometerState(spuriousState, 14398.0, todayStr);
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
    recordedAt: `${todayStr}T04:02:00Z`,
  });
  assert.ok(moved.updatedState.totalOdometerKm >= 14398.99 && moved.updatedState.totalOdometerKm <= 14399.01);
  assert.equal(moved.updatedState.readingSource, "gps_estimated");
});

test("22. Database Resilience: Persists integer to vehicles.odometer and never calls missing tables", async () => {
  const todayStr = getTodayIstDateString();
  const state = {
    vehicleId: "v-persist-1",
    deviceId: "863110086146753",
    totalOdometerKm: 14405.42,
    todayDistanceKm: 27.42,
    currentTripDistanceKm: 27.42,
    currentSpeedKmh: 15,
    readingSource: "gps_estimated",
    baselineOdometerKm: 14378.0,
    todayDate: todayStr,
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

test("23. Test 1: Vehicle Directory Odometer Edit (14,398 -> 15,000 km) Reflects in Live Tracking", () => {
  const todayStr = getTodayIstDateString();
  // Existing vehicle state in Live Tracking
  const existingCached = {
    vehicleId: "v-sync-1",
    deviceId: "863110086146753",
    totalOdometerKm: 14398.0,
    todayDistanceKm: 27.4,
    currentTripDistanceKm: 10.0,
    currentSpeedKmh: 0,
    readingSource: "gps_estimated",
    baselineOdometerKm: 14398.0,
    todayDate: todayStr,
    isMoving: false,
    previousLatitude: 8.2600,
    previousLongitude: 77.2880,
    previousGpsTimestamp: `${todayStr}T04:00:00Z`,
  };

  // Administrator edits odometer in Vehicle Directory to 15,000 km (stored in Supabase vehicles.odometer)
  const newDatabaseOdometer = 15000.0;

  // Live Tracking reconciles with the updated database baseline
  const reconciled = reconcileOdometerState(existingCached, newDatabaseOdometer, todayStr);

  // Expected Live Tracking Map reading: 15,000.00 km (NOT 14,398 km, NOT 15,027.4 km)
  assert.equal(reconciled.baselineOdometerKm, 15000.0, "Baseline must update to 15,000 km");
  assert.equal(reconciled.totalOdometerKm, 15000.0, "Total odometer must be exactly 15,000.00 km");
  assert.equal(reconciled.todayDistanceKm, 27.4, "Today's distance must be preserved");
  assert.equal(reconciled.currentTripDistanceKm, 10.0, "Current trip distance must be preserved");
  assert.equal(reconciled.previousLatitude, 8.2600, "GPS tracking coordinates must remain intact");
});

test("24. Test 2: Live Tracking Updates Instantly on Cross-Page Manual Edit Without Refresh", () => {
  const todayStr = getTodayIstDateString();
  const currentState = {
    vehicleId: "v-sync-2",
    deviceId: "863110086146985",
    totalOdometerKm: 14398.0,
    todayDistanceKm: 74.2,
    currentTripDistanceKm: 46.8,
    currentSpeedKmh: 16,
    readingSource: "gps_estimated",
    baselineOdometerKm: 14398.0,
    todayDate: todayStr,
    isMoving: true,
  };

  // Cross-page sync helper updates state directly
  const updated = syncManualOdometerBaseline(currentState, 15000.0);

  assert.equal(updated.baselineOdometerKm, 15000.0);
  assert.equal(updated.totalOdometerKm, 15000.0, "Map must immediately show 15,000.00 km without refresh");
  assert.equal(updated.todayDistanceKm, 74.2, "Today distance is preserved");
  assert.equal(updated.currentTripDistanceKm, 46.8, "Current trip is preserved");
  assert.equal(updated.isMoving, true, "Active moving state is preserved");
});

test("25. Test 3: GPS Accumulation Continues After Manual Edit (15,000.00 -> 15,000.25 -> 15,000.50 km)", () => {
  const todayStr = getTodayIstDateString();
  let state = syncManualOdometerBaseline(
    {
      vehicleId: "v-sync-3",
      deviceId: "863110086146753",
      totalOdometerKm: 14398.0,
      todayDistanceKm: 27.4,
      currentTripDistanceKm: 10.0,
      currentSpeedKmh: 20,
      readingSource: "gps_estimated",
      baselineOdometerKm: 14398.0,
      todayDate: todayStr,
      isMoving: true,
      previousLatitude: 8.2600,
      previousLongitude: 77.2880,
      previousGpsTimestamp: `${todayStr}T05:00:00Z`,
    },
    15000.0,
  );

  assert.equal(state.totalOdometerKm, 15000.0);

  // Vehicle travels another 0.25 km (~0.00225 deg north) at 30 km/h
  const ping1 = processOdometerTelemetry(state, {
    id: "move-after-edit-1",
    vehicleId: "v-sync-3",
    lat: 8.26225,
    lng: 77.2880,
    speed: 30,
    recordedAt: `${todayStr}T05:00:30Z`,
  });

  state = ping1.updatedState;
  assert.ok(ping1.distanceAddedKm >= 0.24 && ping1.distanceAddedKm <= 0.26);
  assert.equal(Math.round(state.totalOdometerKm * 100) / 100, 15000.25, "Odometer must become 15,000.25 km");
  assert.equal(Math.round(state.todayDistanceKm * 100) / 100, 27.65, "Today distance increments by 0.25 km");

  // Vehicle travels another 0.25 km
  const ping2 = processOdometerTelemetry(state, {
    id: "move-after-edit-2",
    vehicleId: "v-sync-3",
    lat: 8.26450,
    lng: 77.2880,
    speed: 30,
    recordedAt: `${todayStr}T05:01:00Z`,
  });

  state = ping2.updatedState;
  assert.equal(Math.round(state.totalOdometerKm * 100) / 100, 15000.50, "Odometer must become 15,000.50 km");
});

test("26. Test 4: Browser Refresh Preserves 15,000.25 km Without Double Counting", () => {
  const todayStr = getTodayIstDateString();
  // State saved in localStorage after 0.25 km movement
  const cachedAfterMove = {
    vehicleId: "v-sync-4",
    totalOdometerKm: 15000.25,
    todayDistanceKm: 27.65,
    currentTripDistanceKm: 10.25,
    currentSpeedKmh: 30,
    readingSource: "gps_estimated",
    baselineOdometerKm: 15000.0,
    todayDate: todayStr,
    isMoving: true,
  };

  // Database baseline returned on page refresh
  const databaseBaseline = 15000;

  // On page refresh, reconcileOdometerState runs
  const reconciled = reconcileOdometerState(cachedAfterMove, databaseBaseline, todayStr);

  // Must preserve 15,000.25 km (neither resets to 15,000 nor adds 27.65 km to make 15,027.65)
  assert.equal(reconciled.totalOdometerKm, 15000.25, "Total odometer must remain exactly 15,000.25 km on refresh");
  assert.equal(reconciled.baselineOdometerKm, 15000.0);
  assert.equal(reconciled.todayDistanceKm, 27.65);
});

test("27. Test 5: Multi-Vehicle Isolation (Editing 1 Vehicle Leaves Other 6 Vehicles Unchanged)", () => {
  const fleetStates = {
    "v1": { vehicleId: "v1", baselineOdometerKm: 14398.0, totalOdometerKm: 14398.0, todayDistanceKm: 10.0 },
    "v2": { vehicleId: "v2", baselineOdometerKm: 860.0, totalOdometerKm: 1007.2, todayDistanceKm: 74.2 },
    "v3": { vehicleId: "v3", baselineOdometerKm: 48250.0, totalOdometerKm: 48250.0, todayDistanceKm: 5.0 },
    "v4": { vehicleId: "v4", baselineOdometerKm: 62000.0, totalOdometerKm: 62000.0, todayDistanceKm: 12.0 },
    "v5": { vehicleId: "v5", baselineOdometerKm: 31500.0, totalOdometerKm: 31500.0, todayDistanceKm: 0.0 },
    "v6": { vehicleId: "v6", baselineOdometerKm: 19800.0, totalOdometerKm: 19800.0, todayDistanceKm: 15.0 },
    "v7": { vehicleId: "v7", baselineOdometerKm: 25400.0, totalOdometerKm: 25400.0, todayDistanceKm: 20.0 },
  };

  // Admin edits only v1 to 15,000 km
  const updatedV1 = syncManualOdometerBaseline(fleetStates["v1"], 15000.0, "v1");
  const nextFleet = {
    ...fleetStates,
    ["v1"]: updatedV1,
  };

  // Verify v1 is updated
  assert.equal(nextFleet["v1"].totalOdometerKm, 15000.0);
  assert.equal(nextFleet["v1"].baselineOdometerKm, 15000.0);

  // Verify other 6 vehicles are completely unchanged
  assert.equal(nextFleet["v2"].totalOdometerKm, 1007.2);
  assert.equal(nextFleet["v3"].totalOdometerKm, 48250.0);
  assert.equal(nextFleet["v4"].totalOdometerKm, 62000.0);
  assert.equal(nextFleet["v5"].totalOdometerKm, 31500.0);
  assert.equal(nextFleet["v6"].totalOdometerKm, 19800.0);
  assert.equal(nextFleet["v7"].totalOdometerKm, 25400.0);
});

test("28. Test 6: Concurrent Manual Edit While Live GPS Telemetry Is Streaming", () => {
  const todayStr = getTodayIstDateString();
  let state = {
    vehicleId: "v-race-1",
    totalOdometerKm: 14398.0,
    todayDistanceKm: 27.4,
    currentTripDistanceKm: 5.0,
    currentSpeedKmh: 35,
    readingSource: "gps_estimated",
    baselineOdometerKm: 14398.0,
    todayDate: todayStr,
    isMoving: true,
    previousLatitude: 8.2600,
    previousLongitude: 77.2880,
    previousGpsTimestamp: `${todayStr}T06:00:00Z`,
  };

  // Telemetry point 1 arrives
  state = processOdometerTelemetry(state, {
    id: "gps-pt-1",
    vehicleId: "v-race-1",
    lat: 8.2610,
    lng: 77.2880,
    speed: 35,
    recordedAt: `${todayStr}T06:00:10Z`,
  }).updatedState;

  const preEditKm = state.totalOdometerKm;
  assert.ok(preEditKm > 14398.0 && preEditKm < 14398.2);

  // Admin manual edit to 15,000 km happens concurrently
  state = syncManualOdometerBaseline(state, 15000.0, "v-race-1");
  assert.equal(state.totalOdometerKm, 15000.0);

  // Stale or duplicate telemetry packet from before the edit arrives -> rejected
  const staleAttempt = processOdometerTelemetry(state, {
    id: "gps-pt-old",
    vehicleId: "v-race-1",
    lat: 8.2605,
    lng: 77.2880,
    speed: 35,
    recordedAt: `${todayStr}T06:00:05Z`, // timestamp before 06:00:10Z
  });
  assert.equal(staleAttempt.isDuplicate, true, "Out-of-order telemetry must be rejected");
  assert.equal(staleAttempt.updatedState.totalOdometerKm, 15000.0, "Stale packet cannot revert manual edit");

  // Fresh telemetry packet arriving after the edit accumulates onto 15,000 km
  const freshMove = processOdometerTelemetry(state, {
    id: "gps-pt-2",
    vehicleId: "v-race-1",
    lat: 8.26325,
    lng: 77.2880, // ~0.25 km from 8.2610
    speed: 35,
    recordedAt: `${todayStr}T06:00:30Z`,
  });

  assert.equal(freshMove.isDuplicate, false);
  assert.equal(Math.round(freshMove.updatedState.totalOdometerKm * 100) / 100, 15000.25, "Fresh GPS movement advances 15,000.00 -> 15,000.25 km");
});



