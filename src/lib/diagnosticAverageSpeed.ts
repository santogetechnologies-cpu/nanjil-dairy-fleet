/**
 * diagnosticAverageSpeed.ts
 *
 * Development-only diagnostic and test calculation for GPS-based Average Speed.
 * Verifies distance, driving time, and average speed using known test GPS points.
 *
 * Does not modify production vehicle values or change the UI.
 */

import {
  GpsAverageSpeedTracker,
  haversineDistanceKm,
} from "@/hooks/useAverageSpeed";

export interface DiagnosticStepResult {
  step: string;
  description: string;
  expectedDistKm: number;
  actualDistKm: number;
  expectedDrivingTimeSec: number;
  actualDrivingTimeSec: number;
  expectedAvgSpeedKmH: number | null;
  actualAvgSpeedKmH: number | null;
  passed: boolean;
}

export interface DiagnosticSuiteResult {
  allPassed: boolean;
  steps: DiagnosticStepResult[];
}

/**
 * Runs a development-only diagnostic test calculation using known GPS points.
 */
export function runAverageSpeedDiagnostic(): DiagnosticSuiteResult {
  const tracker = new GpsAverageSpeedTracker();
  const testDevId = "TEST_DIAG_DEV";
  const steps: DiagnosticStepResult[] = [];

  // Known reference GPS coordinates (Nanjil Dairy headquarters region)
  const baseLat = 8.260427;
  const baseLng = 77.288300;
  const t0 = 1710000000000; // 0s

  // Step 1: First GPS Point (reference point initialization)
  tracker.updateGpsPoint(testDevId, baseLat, baseLng, 35, t0);
  const s1 = tracker.getTrackingStats(testDevId);
  steps.push({
    step: "1. Initial GPS Point",
    description: "First point records reference position; no distance or driving time accumulated.",
    expectedDistKm: 0,
    actualDistKm: s1?.distanceKm ?? -1,
    expectedDrivingTimeSec: 0,
    actualDrivingTimeSec: s1?.drivingTimeSec ?? -1,
    expectedAvgSpeedKmH: null,
    actualAvgSpeedKmH: s1?.avgSpeed ?? null,
    passed: s1?.distanceKm === 0 && s1?.drivingTimeSec === 0 && s1?.avgSpeed === null,
  });

  // Step 2: Segment 1 — Travel ~556m north in 50 seconds at 40 km/h
  const lat2 = baseLat + 0.005;
  const lng2 = baseLng;
  const t1 = t0 + 50 * 1000; // +50s
  const seg1Dist = haversineDistanceKm(baseLat, baseLng, lat2, lng2); // ~0.556 km
  tracker.updateGpsPoint(testDevId, lat2, lng2, 40, t1);
  const s2 = tracker.getTrackingStats(testDevId);
  const s2AvgSpeedExpected = Math.round((seg1Dist / (50 / 3600)) * 10) / 10; // ~40.0 km/h
  steps.push({
    step: "2. Consistent Segment Accumulation",
    description: "Moving segment accumulates both distance and driving time consistently.",
    expectedDistKm: Math.round(seg1Dist * 1000) / 1000,
    actualDistKm: s2?.distanceKm ?? -1,
    expectedDrivingTimeSec: 50,
    actualDrivingTimeSec: s2?.drivingTimeSec ?? -1,
    expectedAvgSpeedKmH: s2AvgSpeedExpected,
    actualAvgSpeedKmH: s2?.avgSpeed ?? null,
    passed:
      Math.abs((s2?.distanceKm ?? 0) - seg1Dist) < 0.01 &&
      s2?.drivingTimeSec === 50 &&
      s2?.avgSpeed === s2AvgSpeedExpected,
  });

  // Step 3: Segment 2 — Travel another ~556m north in 50 seconds with telemetry speed reading = 80 km/h
  const lat3 = lat2 + 0.005;
  const lng3 = lng2;
  const t2 = t1 + 50 * 1000; // +50s (total 100s)
  const totalDistStep3 = seg1Dist + haversineDistanceKm(lat2, lng2, lat3, lng3); // ~1.112 km
  const s3AvgSpeedExpected = Math.round((totalDistStep3 / (100 / 3600)) * 10) / 10; // ~40.0 km/h
  tracker.updateGpsPoint(testDevId, lat3, lng3, 80, t2);
  const s3 = tracker.getTrackingStats(testDevId);
  steps.push({
    step: "3. Average Speed = Distance / Time (Not Speed Reading Average)",
    description: "Proves average speed is 40.0 km/h (GPS dist/time), not (35+40+80)/3 = 51.7 km/h.",
    expectedDistKm: Math.round(totalDistStep3 * 1000) / 1000,
    actualDistKm: s3?.distanceKm ?? -1,
    expectedDrivingTimeSec: 100,
    actualDrivingTimeSec: s3?.drivingTimeSec ?? -1,
    expectedAvgSpeedKmH: s3AvgSpeedExpected,
    actualAvgSpeedKmH: s3?.avgSpeed ?? null,
    passed:
      s3?.avgSpeed === s3AvgSpeedExpected &&
      (s3?.avgSpeed ?? 0) < 50, // Confirms speed readings are not averaged
  });

  // Step 4: Idle Exclusion — Vehicle stays at lat3, lng3 for 180 seconds with speed = 0
  const t3 = t2 + 180 * 1000; // +180s idle
  tracker.updateGpsPoint(testDevId, lat3, lng3, 0, t3);
  const s4 = tracker.getTrackingStats(testDevId);
  steps.push({
    step: "4. Idle Period Exclusion",
    description: "Idling for 180 seconds does not increase driving time or dilute average speed.",
    expectedDistKm: s3?.distanceKm ?? 0,
    actualDistKm: s4?.distanceKm ?? -1,
    expectedDrivingTimeSec: 100,
    actualDrivingTimeSec: s4?.drivingTimeSec ?? -1,
    expectedAvgSpeedKmH: s3AvgSpeedExpected,
    actualAvgSpeedKmH: s4?.avgSpeed ?? null,
    passed:
      s4?.distanceKm === s3?.distanceKm &&
      s4?.drivingTimeSec === 100 &&
      s4?.avgSpeed === s3AvgSpeedExpected,
  });

  // Step 5: Start/Stop Transition — Accelerates from rest, travels ~556m in 50 seconds at 40 km/h
  const lat4 = lat3 + 0.005;
  const lng4 = lng3;
  const t4 = t3 + 50 * 1000; // +50s driving
  const totalDistStep5 = totalDistStep3 + haversineDistanceKm(lat3, lng3, lat4, lng4); // ~1.668 km
  const s5AvgSpeedExpected = Math.round((totalDistStep5 / (150 / 3600)) * 10) / 10; // ~40.0 km/h
  tracker.updateGpsPoint(testDevId, lat4, lng4, 40, t4);
  const s5 = tracker.getTrackingStats(testDevId);
  steps.push({
    step: "5. Start/Stop Transitions",
    description: "Vehicle restarting from standstill accumulates only moving time (150s total, not 330s).",
    expectedDistKm: Math.round(totalDistStep5 * 1000) / 1000,
    actualDistKm: s5?.distanceKm ?? -1,
    expectedDrivingTimeSec: 150,
    actualDrivingTimeSec: s5?.drivingTimeSec ?? -1,
    expectedAvgSpeedKmH: s5AvgSpeedExpected,
    actualAvgSpeedKmH: s5?.avgSpeed ?? null,
    passed:
      s5?.drivingTimeSec === 150 &&
      s5?.avgSpeed === s5AvgSpeedExpected,
  });

  // Step 6: Signal Gap > 10 Minutes Exclusion
  const lat5 = lat4 + 0.02;
  const lng5 = lng4;
  const t5 = t4 + 900 * 1000; // 15-minute gap
  tracker.updateGpsPoint(testDevId, lat5, lng5, 40, t5);
  const s6 = tracker.getTrackingStats(testDevId);
  steps.push({
    step: "6. Signal Gap > 10 min Exclusion",
    description: "15-minute missing signal gap is excluded from distance and driving time.",
    expectedDistKm: s5?.distanceKm ?? 0,
    actualDistKm: s6?.distanceKm ?? -1,
    expectedDrivingTimeSec: 150,
    actualDrivingTimeSec: s6?.drivingTimeSec ?? -1,
    expectedAvgSpeedKmH: s5?.avgSpeed ?? null,
    actualAvgSpeedKmH: s6?.avgSpeed ?? null,
    passed:
      s6?.distanceKm === s5?.distanceKm &&
      s6?.drivingTimeSec === 150,
  });

  // Step 7: Outlier GPS Jump Exclusion (e.g. >200 km jump or >150 km/h teleport)
  const t6 = t5 + 5 * 1000; // 5 seconds later
  tracker.updateGpsPoint(testDevId, lat5 + 0.05, lng5, 40, t6); // 5.5 km in 5s (~3960 km/h jump)
  const s7 = tracker.getTrackingStats(testDevId);
  steps.push({
    step: "7. Outlier GPS Jump Exclusion",
    description: "Impossible GPS telemetry jumps are rejected and not counted in driving stats.",
    expectedDistKm: s6?.distanceKm ?? 0,
    actualDistKm: s7?.distanceKm ?? -1,
    expectedDrivingTimeSec: 150,
    actualDrivingTimeSec: s7?.drivingTimeSec ?? -1,
    expectedAvgSpeedKmH: s6?.avgSpeed ?? null,
    actualAvgSpeedKmH: s7?.avgSpeed ?? null,
    passed:
      s7?.distanceKm === s6?.distanceKm &&
      s7?.drivingTimeSec === 150,
  });

  const allPassed = steps.every((s) => s.passed);
  return { allPassed, steps };
}

// In development mode, expose on window for easy developer verification via browser dev console
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as { __runAverageSpeedDiagnostic: typeof runAverageSpeedDiagnostic }).__runAverageSpeedDiagnostic =
    runAverageSpeedDiagnostic;
}
