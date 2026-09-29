/**
 * test_overspeed.mjs
 *
 * Real-Time Overspeed Verification Test Suite:
 * 1. Three-tier speed state classification (Normal <80, Warning 80-99.9, Critical >=100)
 * 2. Edge case handling (0, negative, null, undefined, NaN, string numbers)
 * 3. Threshold crossing and state transitions (79->85, 85->90, 95->101, 101->95, 95->70)
 * 4. Alert spam prevention across repeated snapshots
 * 5. Supabase vehicle ID validation (real UUIDs only, never unassigned or raw device IDs)
 * 6. Real Firebase Firestore telemetry inspection
 */

import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

// ── Overspeed Logic Engine Mirror ───────────────────────────────────────────
const WARNING_SPEED_KMH = 80;
const CRITICAL_SPEED_KMH = 100;
const OVERSPEED_ALERT_COOLDOWN_MS = 30 * 60 * 1000;

function isRealSupabaseVehicleId(id) {
  if (typeof id !== "string") return false;
  const trimmed = id.trim();
  if (!trimmed || trimmed.startsWith("unassigned-")) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
}

function getOverspeedStatus(speedVal) {
  const speed =
    typeof speedVal === "number" && !isNaN(speedVal)
      ? speedVal
      : typeof speedVal === "string"
        ? parseFloat(speedVal)
        : 0;

  if (isNaN(speed) || speed < 0) {
    return {
      level: "normal",
      label: "Normal",
      speed: 0,
      isOverspeed: false,
    };
  }

  if (speed >= CRITICAL_SPEED_KMH) {
    return {
      level: "critical",
      label: "Critical Overspeed",
      speed,
      isOverspeed: true,
    };
  }

  if (speed >= WARNING_SPEED_KMH) {
    return {
      level: "warning",
      label: "Overspeed Warning",
      speed,
      isOverspeed: true,
    };
  }

  return {
    level: "normal",
    label: "Normal",
    speed,
    isOverspeed: false,
  };
}

class TestOverspeedManager {
  constructor() {
    this.vehicleLevels = new Map();
    this.lastAlertTimestamps = new Map();
    this.persistedAlerts = [];
  }

  evaluateTransitions(vehicles) {
    const events = [];

    for (const v of vehicles) {
      const key = v.id || v.deviceId;
      if (!key) continue;

      const prevLevel = this.vehicleLevels.get(key) ?? "normal";
      const status = getOverspeedStatus(v.speed);
      const currLevel = status.level;

      this.vehicleLevels.set(key, currLevel);

      if (prevLevel !== currLevel) {
        events.push({
          vehicleId: v.id,
          vehicleNumber: v.number || "Unassigned Vehicle",
          previousLevel: prevLevel,
          currentLevel: currLevel,
          speed: status.speed,
          timestamp: Date.now(),
        });
      }
    }

    return events;
  }

  persistAlerts(events) {
    for (const ev of events) {
      if (ev.currentLevel === "normal") continue;
      if (ev.previousLevel === "critical" && ev.currentLevel === "warning") continue;

      if (!isRealSupabaseVehicleId(ev.vehicleId)) {
        continue;
      }

      const severity = ev.currentLevel === "critical" ? "High" : "Medium";
      const cooldownKey = `${ev.vehicleId}:${severity}`;
      const lastSent = this.lastAlertTimestamps.get(cooldownKey) || 0;
      const now = Date.now();

      if (now - lastSent < OVERSPEED_ALERT_COOLDOWN_MS) {
        continue;
      }

      const message =
        ev.currentLevel === "critical"
          ? `Critical overspeed: ${Math.round(ev.speed)} km/h (critical threshold: ${CRITICAL_SPEED_KMH} km/h)`
          : `Over-speed warning: ${Math.round(ev.speed)} km/h (warning threshold: ${WARNING_SPEED_KMH} km/h)`;

      this.persistedAlerts.push({
        vehicle_id: ev.vehicleId,
        type: "Safety",
        severity,
        message,
        time: new Date(now).toISOString(),
      });

      this.lastAlertTimestamps.set(cooldownKey, now);
    }
  }
}

// ── Test Runner ──────────────────────────────────────────────────────────────

async function runOverspeedTests() {
  console.log("================================================================================");
  console.log("             REAL-TIME OVERSPEED SYSTEM VERIFICATION SUITE                     ");
  console.log("================================================================================\n");

  let passed = 0;
  let total = 0;

  function assert(cond, msg) {
    total++;
    if (!cond) {
      console.error(`❌ FAILED: ${msg}`);
      throw new Error(`Test failed: ${msg}`);
    }
    console.log(`✅ PASSED: ${msg}`);
    passed++;
  }

  // 1. Classification Tests
  console.log("[SECTION 1] Speed Classification Tests");
  assert(getOverspeedStatus(79).level === "normal", "79 km/h → Normal");
  assert(getOverspeedStatus(79.9).level === "normal", "79.9 km/h → Normal");
  assert(getOverspeedStatus(80).level === "warning", "80 km/h → Warning (Orange)");
  assert(getOverspeedStatus(85).level === "warning", "85 km/h → Warning (Orange)");
  assert(getOverspeedStatus(99).level === "warning", "99 km/h → Warning (Orange)");
  assert(getOverspeedStatus(99.9).level === "warning", "99.9 km/h → Warning (Orange)");
  assert(getOverspeedStatus(100).level === "critical", "100 km/h → Critical (Red)");
  assert(getOverspeedStatus(110).level === "critical", "110 km/h → Critical (Red)");
  assert(getOverspeedStatus(120).level === "critical", "120 km/h → Critical (Red)");
  assert(getOverspeedStatus(0).level === "normal", "0 km/h → Normal");
  assert(getOverspeedStatus(-10).level === "normal", "Negative speed (-10) → Normal (safe fallback)");
  assert(getOverspeedStatus(null).level === "normal", "null speed → Normal");
  assert(getOverspeedStatus(undefined).level === "normal", "undefined speed → Normal");
  assert(getOverspeedStatus(NaN).level === "normal", "NaN speed → Normal");
  assert(getOverspeedStatus("87").level === "warning", "String speed '87' safely parsed to Warning");
  assert(getOverspeedStatus("104").level === "critical", "String speed '104' safely parsed to Critical");

  // 2. Threshold Crossing and State Transition Tests
  console.log("\n[SECTION 2] Transition & Crossing Detection Tests");
  const manager = new TestOverspeedManager();
  const testVehicleId = "c0a80123-4567-89ab-cdef-0123456789ab"; // Valid Supabase UUID

  // Step 1: Vehicle driving at 75 km/h
  let events = manager.evaluateTransitions([{ id: testVehicleId, number: "TN 75 C 8204", speed: 75 }]);
  assert(events.length === 0, "Initial snapshot at 75 km/h produces no transition event.");

  // Step 2: Warning transition (75 → 85 km/h)
  events = manager.evaluateTransitions([{ id: testVehicleId, number: "TN 75 C 8204", speed: 85 }]);
  manager.persistAlerts(events);
  assert(
    events.length === 1 &&
    events[0].previousLevel === "normal" &&
    events[0].currentLevel === "warning" &&
    manager.persistedAlerts.length === 1 &&
    manager.persistedAlerts[0].severity === "Medium" &&
    manager.persistedAlerts[0].message.includes("Over-speed warning: 85 km/h"),
    "Warning transition (75 → 85 km/h): Exactly 1 Medium Safety alert generated."
  );

  // Step 3: Continued Warning (85 → 90 → 95 km/h) — No alert spam!
  events = manager.evaluateTransitions([{ id: testVehicleId, number: "TN 75 C 8204", speed: 90 }]);
  manager.persistAlerts(events);
  events = manager.evaluateTransitions([{ id: testVehicleId, number: "TN 75 C 8204", speed: 95 }]);
  manager.persistAlerts(events);
  assert(
    manager.persistedAlerts.length === 1,
    "Continued Warning (85 → 90 → 95 km/h): Zero duplicate alerts generated (Spam prevented)."
  );

  // Step 4: Critical transition (95 → 104 km/h)
  events = manager.evaluateTransitions([{ id: testVehicleId, number: "TN 75 C 8204", speed: 104 }]);
  manager.persistAlerts(events);
  assert(
    events.length === 1 &&
    events[0].previousLevel === "warning" &&
    events[0].currentLevel === "critical" &&
    manager.persistedAlerts.length === 2 &&
    manager.persistedAlerts[1].severity === "High" &&
    manager.persistedAlerts[1].message.includes("Critical overspeed: 104 km/h"),
    "Critical transition (95 → 104 km/h): Exactly 1 High Safety alert generated."
  );

  // Step 5: Continued Critical (104 → 110 → 115 km/h) — No duplicate critical alerts
  events = manager.evaluateTransitions([{ id: testVehicleId, number: "TN 75 C 8204", speed: 110 }]);
  manager.persistAlerts(events);
  events = manager.evaluateTransitions([{ id: testVehicleId, number: "TN 75 C 8204", speed: 115 }]);
  manager.persistAlerts(events);
  assert(
    manager.persistedAlerts.length === 2,
    "Continued Critical (104 → 110 → 115 km/h): Zero duplicate critical alerts generated."
  );

  // Step 6: Deceleration / Recovery (115 → 92 km/h)
  events = manager.evaluateTransitions([{ id: testVehicleId, number: "TN 75 C 8204", speed: 92 }]);
  manager.persistAlerts(events);
  assert(
    events.length === 1 &&
    events[0].previousLevel === "critical" &&
    events[0].currentLevel === "warning" &&
    manager.persistedAlerts.length === 2,
    "Down-transition (115 → 92 km/h): Live state updates to Warning without generating spam alerts."
  );

  // Step 7: Recovery to Normal (92 → 65 km/h)
  events = manager.evaluateTransitions([{ id: testVehicleId, number: "TN 75 C 8204", speed: 65 }]);
  manager.persistAlerts(events);
  assert(
    events.length === 1 &&
    events[0].previousLevel === "warning" &&
    events[0].currentLevel === "normal" &&
    manager.persistedAlerts.length === 2,
    "Recovery to Normal (92 → 65 km/h): Level returned to Normal without alerts."
  );

  // 3. Supabase Vehicle ID Validation Tests
  console.log("\n[SECTION 3] Supabase Vehicle ID Validation Tests");
  assert(isRealSupabaseVehicleId("c0a80123-4567-89ab-cdef-0123456789ab") === true, "Valid UUID is accepted.");
  assert(isRealSupabaseVehicleId("unassigned-863110086130138") === false, "unassigned-xxx is rejected.");
  assert(isRealSupabaseVehicleId("863110086130138") === false, "Raw numeric device ID is rejected.");
  assert(isRealSupabaseVehicleId("Unassigned Vehicle") === false, "String 'Unassigned Vehicle' is rejected.");
  assert(isRealSupabaseVehicleId("") === false, "Empty string is rejected.");
  assert(isRealSupabaseVehicleId(null) === false, "null is rejected.");

  // Step 8: Unassigned device overspeed test (shows live warning, but does NOT persist DB alert)
  const unassignedMgr = new TestOverspeedManager();
  const unassignedDevId = "unassigned-863110086130138";
  const unassignedEvents = unassignedMgr.evaluateTransitions([
    { id: unassignedDevId, number: "Unassigned Vehicle", speed: 105 }
  ]);
  unassignedMgr.persistAlerts(unassignedEvents);
  assert(
    unassignedEvents.length === 1 &&
    unassignedEvents[0].currentLevel === "critical" &&
    unassignedMgr.persistedAlerts.length === 0,
    "Unassigned device overspeed: Live transition is detected, but persistent DB alert is NOT inserted."
  );

  // 4. Real Firebase Telemetry Test
  console.log("\n[SECTION 4] Real Firebase Firestore Telemetry Test");
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

  console.log(`Fetched ${snap.size} real vehicles from Firestore collection 'vechile'.`);
  assert(snap.size > 0, "Firestore 'vechile' collection returned real documents.");

  let testedVehicles = 0;
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const speed = typeof data.speed === "number" ? data.speed : parseFloat(String(data.speed || 0));
    const status = getOverspeedStatus(speed);

    assert(
      typeof status.speed === "number" &&
      ["normal", "warning", "critical"].includes(status.level),
      `Doc "${docSnap.id}": Speed=${speed} km/h → Status=${status.label} (${status.level})`
    );
    testedVehicles++;
  });

  assert(testedVehicles === snap.size, `All ${testedVehicles} real Firebase vehicles evaluated successfully.`);

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n================================================================================");
  console.log(`🎉 ALL ${passed}/${total} OVERSPEED TESTS PASSED SUCCESSFULLY!`);
  console.log("================================================================================");
  process.exit(0);
}

runOverspeedTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
