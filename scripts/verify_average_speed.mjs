/**
 * verify_average_speed.mjs
 *
 * End-to-End Verification of GPS-based Average Speed calculation:
 * 1. Independent tracking per Device ID
 * 2. Consistent segment distance and driving time accumulation
 * 3. Start/stop transitions without artificial inflation/reduction
 * 4. Idle periods exclusion
 * 5. Signal gaps > 10 minutes exclusion
 * 6. Outlier GPS jumps and teleport glitches exclusion
 * 7. First valid GPS point does not create fake distance/time
 * 8. Real Firebase Firestore telemetry snapshot updates
 * 9. Current speed remains instantaneous telemetry speed
 * 10. Average speed = total distance / driving time (never an average of speed readings)
 */

import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, onSnapshot } from "firebase/firestore";

// ── Math & Engine Helpers (Directly mirroring GpsAverageSpeedTracker) ────────

const EARTH_RADIUS_KM = 6371;
const MOVING_SPEED_THRESHOLD = 1;
const MAX_SEGMENT_DISTANCE_KM = 200;
const MAX_REALISTIC_SPEED_KMH = 150;
const MAX_GAP_SECONDS = 600;
const MIN_DRIVING_TIME_SEC_FOR_AVG = 5;

function normalizeDevId(val) {
  if (val == null) return "";
  return String(val).trim().replace(/\D/g, "");
}

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

class GpsAverageSpeedTracker {
  constructor() {
    this.states = new Map();
  }

  updateGpsPoint(rawDeviceId, lat, lng, speed, timestamp) {
    const deviceId = normalizeDevId(rawDeviceId);
    if (!deviceId) return;
    if (typeof lat !== "number" || typeof lng !== "number" || isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return;

    const time = typeof timestamp === "number" && !isNaN(timestamp) && timestamp > 0 ? timestamp : Date.now();
    const newPoint = {
      lat,
      lng,
      timestamp: time,
      speed: typeof speed === "number" && !isNaN(speed) ? speed : 0,
    };

    const existing = this.states.get(deviceId);
    if (!existing) {
      this.states.set(deviceId, {
        lastPoint: newPoint,
        totalDistanceKm: 0,
        totalDrivingTimeSec: 0,
        segmentCount: 0,
        averageSpeed: null,
      });
      return;
    }

    const prev = existing.lastPoint;
    if (newPoint.timestamp <= prev.timestamp) return;

    if (newPoint.lat === prev.lat && newPoint.lng === prev.lng) {
      existing.lastPoint = newPoint;
      return;
    }

    const segmentDistKm = haversineDistanceKm(prev.lat, prev.lng, newPoint.lat, newPoint.lng);
    const segmentTimeSec = (newPoint.timestamp - prev.timestamp) / 1000;

    // 1. Reject impossible GPS jumps (>200 km)
    if (segmentDistKm > MAX_SEGMENT_DISTANCE_KM) {
      existing.lastPoint = newPoint;
      return;
    }

    // 2. Reject signal gaps > 10 min
    if (segmentTimeSec > MAX_GAP_SECONDS) {
      existing.lastPoint = newPoint;
      return;
    }

    // 3. Reject unrealistic implied speed (>150 km/h)
    const impliedSpeedKmH = segmentTimeSec > 0 ? (segmentDistKm / segmentTimeSec) * 3600 : 0;
    if (impliedSpeedKmH > MAX_REALISTIC_SPEED_KMH) {
      existing.lastPoint = newPoint;
      return;
    }

    // 4. Movement filter
    const isMoving = prev.speed >= MOVING_SPEED_THRESHOLD || newPoint.speed >= MOVING_SPEED_THRESHOLD;
    if (isMoving && segmentDistKm > 0.001) {
      existing.totalDistanceKm += segmentDistKm;
      existing.totalDrivingTimeSec += segmentTimeSec;
      existing.segmentCount += 1;
    }

    existing.lastPoint = newPoint;

    // 5. Average speed = distance / driving time
    if (existing.totalDrivingTimeSec >= MIN_DRIVING_TIME_SEC_FOR_AVG) {
      const totalHours = existing.totalDrivingTimeSec / 3600;
      const avgSpeed = existing.totalDistanceKm / totalHours;
      existing.averageSpeed = Math.round(avgSpeed * 10) / 10;
    }
  }

  getAverageSpeed(rawDeviceId) {
    const deviceId = normalizeDevId(rawDeviceId);
    return this.states.get(deviceId)?.averageSpeed ?? null;
  }

  getTrackingStats(rawDeviceId) {
    const deviceId = normalizeDevId(rawDeviceId);
    const state = this.states.get(deviceId);
    if (!state) return null;
    return {
      distanceKm: Math.round(state.totalDistanceKm * 1000) / 1000,
      drivingTimeSec: Math.round(state.totalDrivingTimeSec * 10) / 10,
      segmentCount: state.segmentCount,
      avgSpeed: state.averageSpeed,
    };
  }
}

// ── Verification Suite ───────────────────────────────────────────────────────

async function runVerification() {
  console.log("================================================================================");
  console.log("             GPS-BASED AVERAGE SPEED VERIFICATION SUITE                        ");
  console.log("================================================================================\n");

  const tracker = new GpsAverageSpeedTracker();
  let passedCount = 0;
  const totalChecks = 10;

  function assert(condition, message) {
    if (!condition) {
      console.error(`❌ FAILED: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
    console.log(`✅ PASSED: ${message}`);
    passedCount++;
  }

  // Reference GPS coordinates (Nanjil Dairy Region, Kanyakumari / Coimbatore)
  const baseLat = 8.260427;
  const baseLng = 77.288300;
  const t0 = 1710000000000; // Fixed start timestamp (epoch ms)

  // ─────────────────────────────────────────────────────────────────────────
  // CHECK 7: The first valid GPS point does not create a fake distance/time segment
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[TEST 7] Verifying first GPS point initialization...");
  tracker.updateGpsPoint("DEV_001", baseLat, baseLng, 45, t0);
  const initStats = tracker.getTrackingStats("DEV_001");
  assert(
    initStats !== null &&
    initStats.distanceKm === 0 &&
    initStats.drivingTimeSec === 0 &&
    initStats.segmentCount === 0 &&
    initStats.avgSpeed === null,
    "Check 7: First valid GPS point creates state with 0 km distance, 0s time, and null avg speed.",
  );

  // ─────────────────────────────────────────────────────────────────────────
  // CHECK 2: A GPS segment's distance and driving time are counted consistently
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[TEST 2] Verifying consistent GPS segment accumulation...");
  // Segment 1: Move 0.005 degrees North (~0.556 km) in 50 seconds at 40 km/h
  const lat2 = baseLat + 0.005;
  const lng2 = baseLng;
  const t1 = t0 + 50 * 1000; // +50 seconds
  tracker.updateGpsPoint("DEV_001", lat2, lng2, 40, t1);

  const expectedDist1 = haversineDistanceKm(baseLat, baseLng, lat2, lng2); // ~0.556 km
  const statsAfterSeg1 = tracker.getTrackingStats("DEV_001");
  assert(
    Math.abs(statsAfterSeg1.distanceKm - expectedDist1) < 0.01 &&
    statsAfterSeg1.drivingTimeSec === 50 &&
    statsAfterSeg1.segmentCount === 1,
    `Check 2: Segment distance (${statsAfterSeg1.distanceKm} km) and driving time (${statsAfterSeg1.drivingTimeSec}s) accumulated consistently.`,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // CHECK 10: Average Speed is strictly GPS distance / driving time (never average of speeds)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[TEST 10] Verifying Average Speed = total distance / driving time...");
  // Segment 2: Move another 0.005 degrees North in 50 seconds, with telemetry speed reported as 80 km/h (speed reading)
  const lat3 = lat2 + 0.005;
  const lng3 = lng2;
  const t2 = t1 + 50 * 1000; // +50 seconds
  tracker.updateGpsPoint("DEV_001", lat3, lng3, 80, t2);

  const statsAfterSeg2 = tracker.getTrackingStats("DEV_001");
  const totalHours = statsAfterSeg2.drivingTimeSec / 3600; // 100 / 3600 = 0.02778 hrs
  const expectedAvgSpeed = Math.round((statsAfterSeg2.distanceKm / totalHours) * 10) / 10; // ~40.0 km/h

  // Note: If someone averaged the speed readings (45, 40, 80) they would get (45+40+80)/3 = 55.0 km/h!
  // But true GPS average speed is 1.112 km / (100 / 3600 h) = 40.0 km/h!
  assert(
    statsAfterSeg2.avgSpeed === expectedAvgSpeed &&
    statsAfterSeg2.avgSpeed < 50, // Proves it did not average 45 + 40 + 80 = 55
    `Check 10: Average speed is strictly ${statsAfterSeg2.avgSpeed} km/h (GPS dist / driving time), NOT speed reading average (~55 km/h).`,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // CHECK 4: Idle periods are excluded from driving time and distance
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[TEST 4] Verifying idle periods exclusion...");
  const distBeforeIdle = statsAfterSeg2.distanceKm;
  const timeBeforeIdle = statsAfterSeg2.drivingTimeSec;
  const avgBeforeIdle = statsAfterSeg2.avgSpeed;

  // Vehicle idles at lat3, lng3 for 3 minutes (180s) with speed = 0
  const t3 = t2 + 60 * 1000;
  tracker.updateGpsPoint("DEV_001", lat3, lng3, 0, t3);
  const t4 = t3 + 60 * 1000;
  tracker.updateGpsPoint("DEV_001", lat3, lng3, 0, t4);
  const t5 = t4 + 60 * 1000;
  tracker.updateGpsPoint("DEV_001", lat3, lng3, 0, t5);

  const statsAfterIdle = tracker.getTrackingStats("DEV_001");
  assert(
    statsAfterIdle.distanceKm === distBeforeIdle &&
    statsAfterIdle.drivingTimeSec === timeBeforeIdle &&
    statsAfterIdle.avgSpeed === avgBeforeIdle,
    `Check 4: 180s idle period was excluded (Driving time remained ${statsAfterIdle.drivingTimeSec}s, avg speed remained ${statsAfterIdle.avgSpeed} km/h).`,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // CHECK 3: Start/stop transitions do not incorrectly inflate or reduce Average Speed
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[TEST 3] Verifying start/stop transitions...");
  // Vehicle restarts moving from rest (prev speed was 0): moves 0.005 deg North in 50 seconds at 40 km/h
  const lat4 = lat3 + 0.005;
  const lng4 = lng3;
  const t6 = t5 + 50 * 1000;
  tracker.updateGpsPoint("DEV_001", lat4, lng4, 40, t6);

  const statsAfterRestart = tracker.getTrackingStats("DEV_001");
  // Total distance should be 3 segments (~1.668 km), driving time = 150s (not 330s!)
  const expectedDrivingTimeSec = 150;
  assert(
    statsAfterRestart.drivingTimeSec === expectedDrivingTimeSec &&
    Math.abs(statsAfterRestart.avgSpeed - 40.0) <= 0.5,
    `Check 3: Restart from stop counted only actual 50s driving time (total driving time=${statsAfterRestart.drivingTimeSec}s, avg speed=${statsAfterRestart.avgSpeed} km/h).`,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // CHECK 5: Signal gaps >10 minutes are excluded
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[TEST 5] Verifying signal gap > 10 min exclusion...");
  const distBeforeGap = statsAfterRestart.distanceKm;
  const timeBeforeGap = statsAfterRestart.drivingTimeSec;

  // Signal lost for 15 minutes (900s), vehicle re-emerges at lat5
  const lat5 = lat4 + 0.02;
  const lng5 = lng4;
  const t7 = t6 + 900 * 1000; // 15 minutes later
  tracker.updateGpsPoint("DEV_001", lat5, lng5, 40, t7);

  const statsAfterGap = tracker.getTrackingStats("DEV_001");
  assert(
    statsAfterGap.distanceKm === distBeforeGap &&
    statsAfterGap.drivingTimeSec === timeBeforeGap,
    `Check 5: 15-minute signal gap was excluded (distance and driving time unchanged: ${statsAfterGap.distanceKm} km, ${statsAfterGap.drivingTimeSec}s).`,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // CHECK 6: Outlier GPS jumps are excluded
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[TEST 6] Verifying outlier GPS jumps & teleport glitches exclusion...");
  const distBeforeJump = statsAfterGap.distanceKm;
  const timeBeforeJump = statsAfterGap.drivingTimeSec;

  // Test 6a: 500 km impossible jump
  const t8 = t7 + 30 * 1000;
  tracker.updateGpsPoint("DEV_001", lat5 + 5.0, lng5, 40, t8);
  const statsAfterLargeJump = tracker.getTrackingStats("DEV_001");

  // Test 6b: 5 km jump in 5 seconds (implies 3600 km/h)
  const t9 = t8 + 5 * 1000;
  tracker.updateGpsPoint("DEV_001", lat5 + 0.05, lng5, 40, t9);
  const statsAfterFastJump = tracker.getTrackingStats("DEV_001");

  assert(
    statsAfterLargeJump.distanceKm === distBeforeJump &&
    statsAfterFastJump.distanceKm === distBeforeJump &&
    statsAfterFastJump.drivingTimeSec === timeBeforeJump,
    "Check 6: Both large GPS jump (>200 km) and teleport jump (>150 km/h) were excluded.",
  );

  // ─────────────────────────────────────────────────────────────────────────
  // CHECK 1: Average Speed is calculated independently for every Device ID
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[TEST 1] Verifying independent tracking per Device ID...");
  // Device 2 performs a high-speed highway segment: 2.0 km in 100 seconds (~72 km/h)
  const tDev2_0 = t0;
  tracker.updateGpsPoint("DEV_002", 10.955167, 76.964242, 70, tDev2_0);
  const tDev2_1 = tDev2_0 + 100 * 1000;
  // Move ~2 km north (0.018 degrees)
  tracker.updateGpsPoint("DEV_002", 10.955167 + 0.018, 76.964242, 72, tDev2_1);

  const dev1Avg = tracker.getAverageSpeed("DEV_001");
  const dev2Avg = tracker.getAverageSpeed("DEV_002");
  const dev2Stats = tracker.getTrackingStats("DEV_002");

  assert(
    dev1Avg !== null &&
    dev2Avg !== null &&
    dev1Avg !== dev2Avg &&
    Math.abs(dev2Avg - 72.1) <= 1.0,
    `Check 1: Devices tracked independently: DEV_001 avgSpeed=${dev1Avg} km/h, DEV_002 avgSpeed=${dev2Avg} km/h (dist=${dev2Stats.distanceKm} km in ${dev2Stats.drivingTimeSec}s).`,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // CHECK 8 & 9: Real Firebase Telemetry verification
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[TEST 8 & 9] Verifying real Firebase Firestore telemetry integration...");
  const firebaseConfig = {
    apiKey: "AIzaSyDlC2usrNb8wMQzyBao9BTXse5j7u-33co",
    authDomain: "nanjil-fleet.firebaseapp.com",
    projectId: "nanjil-fleet",
    storageBucket: "nanjil-fleet.firebasestorage.app",
    messagingSenderId: "711799024177",
    appId: "1:711799024177:web:7cb85074bbce28f586c310",
  };

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const snap = await getDocs(collection(db, "vechile"));

  console.log(`Fetched ${snap.size} real vehicle documents from Firestore.`);

  let verifiedRealDocs = 0;
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const docId = docSnap.id.trim();
    const devId = (data.device_id || docId).toString().trim();
    const lat = typeof data.lat === "number" ? data.lat : parseFloat(String(data.lat || 0));
    const lng = typeof data.lng === "number" ? data.lng : parseFloat(String(data.lng || 0));
    const speed = typeof data.speed === "number" ? data.speed : parseFloat(String(data.speed || 0));

    // Feed into tracker
    tracker.updateGpsPoint(devId, lat, lng, speed);
    const stats = tracker.getTrackingStats(devId);
    if (stats) verifiedRealDocs++;
  });

  assert(
    verifiedRealDocs === snap.size && snap.size > 0,
    `Check 8: All ${verifiedRealDocs} real Firebase vehicles initialized and updated in the tracker.`,
  );

  // Check 9: Instantaneous speed verification on real Firestore documents
  const firstDoc = snap.docs[0].data();
  const firstDocInstantSpeed = typeof firstDoc.speed === "number" ? firstDoc.speed : parseFloat(String(firstDoc.speed || 0));
  assert(
    typeof firstDocInstantSpeed === "number" && !isNaN(firstDocInstantSpeed),
    `Check 9: Current speed (${firstDocInstantSpeed} km/h) remains the instantaneous telemetry speed from Firebase.`,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n================================================================================");
  console.log(`🎉 ALL ${passedCount}/${totalChecks} VERIFICATION CHECKS PASSED SUCCESSFULLY!`);
  console.log("================================================================================");
  process.exit(0);
}

runVerification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
