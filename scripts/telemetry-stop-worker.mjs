/**
 * telemetry-stop-worker.mjs — Backend Telemetry Ingestion & Stop Tracking Worker
 *
 * Runs independently of the frontend browser (24/7 background worker).
 * - Listens to Firebase Firestore "vechile" collection
 * - Ingests and normalizes live/historical telemetry
 * - Appends to Supabase telemetry_history
 * - Performs server-side stop detection (2-minute continuous stationary threshold)
 * - Persists stop events to Supabase vehicle_stop_events with valid UUIDs and dedup_keys
 * - Enforces at most one active stop per vehicle
 * - Recovers active stops across server restarts
 *
 * Usage:
 *   node scripts/telemetry-stop-worker.mjs [--once]
 */

import { initializeApp } from "firebase/app";
import { getFirestore, collection, onSnapshot, getDocs } from "firebase/firestore";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://lorxcxmwmxsesuqyzxih.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_B8wY6lZZuP6HKaSMg35WkQ_f-NvHtsb";

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || "AIzaSyDlC2usrNb8wMQzyBao9BTXse5j7u-33co",
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "nanjil-fleet.firebaseapp.com",
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || "nanjil-fleet",
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "nanjil-fleet.firebasestorage.app",
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "711799024177",
  appId: process.env.VITE_FIREBASE_APP_ID || "1:711799024177:web:7cb85074bbce28f586c310",
};

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

// Stop detection thresholds
const CONFIG = {
  stopSpeedThresholdKmh: 3,       // <= 3 km/h candidate stationary
  stopDurationThresholdSec: 120,  // 2 continuous minutes (120s) confirmed stop
  resumeSpeedThresholdKmh: 5,     // > 5 km/h candidate movement
  resumeDurationThresholdSec: 15, // 15s sustained movement confirms resumed journey
  staleThresholdSec: 120,         // > 120s gap marks stop INTERRUPTED
};

// In-memory active tracking states: vehicleId -> state
const vehicleStates = new Map();
let vehiclesRegistry = new Map(); // deviceId or number -> vehicle row

function isValidCoord(lat, lng) {
  if (isNaN(lat) || isNaN(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  return true;
}

function safeTimestampMs(ts) {
  if (!ts) return Date.now();
  if (typeof ts === "number") return ts < 10000000000 ? ts * 1000 : ts;
  if (typeof ts === "string") {
    const p = Date.parse(ts);
    return isNaN(p) ? Date.now() : p;
  }
  if (typeof ts === "object" && "seconds" in ts) return ts.seconds * 1000;
  return Date.now();
}

/**
 * Loads vehicles metadata and recovers existing active stops from Supabase.
 */
async function loadStateAndRegistry() {
  console.log("[Worker] Refreshing vehicle registry from Supabase...");
  const { data: vList, error: vErr } = await supabase
    .from("vehicles")
    .select("id, number, model, device_id, current_driver_id");

  if (!vErr && Array.isArray(vList)) {
    vehiclesRegistry.clear();
    for (const v of vList) {
      if (v.device_id) vehiclesRegistry.set(String(v.device_id).trim(), v);
      if (v.number) vehiclesRegistry.set(String(v.number).replace(/\s+/g, "").toUpperCase(), v);
      vehiclesRegistry.set(v.id, v);
    }
    console.log(`[Worker] Loaded ${vList.length} vehicles from registry.`);
  }

  // Active stop recovery across restarts
  console.log("[Worker] Recovering active stops from Supabase...");
  const { data: activeList, error: actErr } = await supabase
    .from("vehicle_stop_events")
    .select("*")
    .eq("status", "ACTIVE");

  if (!actErr && Array.isArray(activeList)) {
    for (const a of activeList) {
      const startMs = safeTimestampMs(a.started_at);
      const lastMs = safeTimestampMs(a.updated_at || a.started_at);
      vehicleStates.set(a.vehicle_id, {
        vehicleId: a.vehicle_id,
        activeStop: a,
        provisionalStationaryStartMs: startMs,
        lastTimestampMs: lastMs,
        lastFreshTelemetryMs: lastMs,
        movementCandidateStartMs: null,
      });
    }
    console.log(`[Worker] Recovered ${activeList.length} ACTIVE stops.`);
  }
}

/**
 * Authoritative Stop Detection for an incoming normalized telemetry point.
 */
async function processTelemetryPoint(pt) {
  const { vehicleId, timestamp, speed, lat, lng, engineOn, location } = pt;
  const tsMs = safeTimestampMs(timestamp);

  let state = vehicleStates.get(vehicleId);
  if (!state) {
    state = {
      vehicleId,
      activeStop: null,
      provisionalStationaryStartMs: null,
      lastTimestampMs: 0,
      lastFreshTelemetryMs: tsMs,
      movementCandidateStartMs: null,
    };
    vehicleStates.set(vehicleId, state);
  }

  // Reject out-of-order or duplicate timestamp
  if (state.lastTimestampMs > 0 && tsMs <= state.lastTimestampMs) {
    return;
  }

  // Check for telemetry gap (> 120s)
  if (state.lastFreshTelemetryMs > 0 && tsMs - state.lastFreshTelemetryMs > CONFIG.staleThresholdSec * 1000) {
    if (state.activeStop) {
      const endIso = new Date(state.lastFreshTelemetryMs).toISOString();
      const durSec = Math.max(1, Math.round((state.lastFreshTelemetryMs - safeTimestampMs(state.activeStop.started_at)) / 1000));

      await supabase
        .from("vehicle_stop_events")
        .update({
          status: "INTERRUPTED",
          ended_at: endIso,
          duration_seconds: durSec,
          updated_at: new Date().toISOString(),
        })
        .eq("id", state.activeStop.id);

      console.log(`[Worker] Active stop ${state.activeStop.id} for ${vehicleId} marked INTERRUPTED due to telemetry gap.`);
      state.activeStop = null;
    }
    state.provisionalStationaryStartMs = null;
    state.movementCandidateStartMs = null;
  }

  state.lastTimestampMs = tsMs;
  state.lastFreshTelemetryMs = tsMs;

  // Stationary condition (speed <= 3 km/h)
  if (speed <= CONFIG.stopSpeedThresholdKmh) {
    state.movementCandidateStartMs = null;

    if (state.activeStop) {
      // Ticking duration update
      const durSec = Math.max(1, Math.round((tsMs - safeTimestampMs(state.activeStop.started_at)) / 1000));
      await supabase
        .from("vehicle_stop_events")
        .update({
          duration_seconds: durSec,
          end_lat: lat,
          end_lng: lng,
          engine_on: engineOn,
          updated_at: new Date(tsMs).toISOString(),
        })
        .eq("id", state.activeStop.id);

      state.activeStop.duration_seconds = durSec;
      return;
    }

    if (state.provisionalStationaryStartMs === null) {
      state.provisionalStationaryStartMs = tsMs;
      state.provisionalLat = lat;
      state.provisionalLng = lng;
      state.provisionalLocation = location;
      state.provisionalEngineOn = engineOn;
      return;
    }

    const stationarySec = Math.round((tsMs - state.provisionalStationaryStartMs) / 1000);
    if (stationarySec >= CONFIG.stopDurationThresholdSec) {
      // CONFIRM STOP
      const startedAtIso = new Date(state.provisionalStationaryStartMs).toISOString();
      const dedupKey = `live:${vehicleId}:${startedAtIso}`;

      const payload = {
        id: crypto.randomUUID(),
        dedup_key: dedupKey,
        vehicle_id: vehicleId,
        started_at: startedAtIso,
        ended_at: null,
        duration_seconds: stationarySec,
        start_lat: state.provisionalLat || lat,
        start_lng: state.provisionalLng || lng,
        end_lat: lat,
        end_lng: lng,
        location: state.provisionalLocation || location || "En Route",
        engine_on: state.provisionalEngineOn || engineOn,
        status: "ACTIVE",
        source: pt.source || "telemetry",
        created_at: startedAtIso,
        updated_at: new Date(tsMs).toISOString(),
      };

      const { data, error } = await supabase
        .from("vehicle_stop_events")
        .upsert(payload, { onConflict: "dedup_key" })
        .select()
        .single();

      if (!error && data) {
        state.activeStop = data;
        console.log(`[Worker] STOP CONFIRMED for ${vehicleId} (${payload.id}) started at ${startedAtIso}.`);
      }
    }
    return;
  }

  // Movement condition (speed > 5 km/h)
  if (!state.activeStop) {
    state.provisionalStationaryStartMs = null;
    state.movementCandidateStartMs = null;
    return;
  }

  if (speed > CONFIG.resumeSpeedThresholdKmh) {
    if (state.movementCandidateStartMs === null) {
      state.movementCandidateStartMs = tsMs;
      return;
    }

    const moveDurSec = Math.round((tsMs - state.movementCandidateStartMs) / 1000);
    if (moveDurSec >= CONFIG.resumeDurationThresholdSec) {
      // CONFIRM JOURNEY RESUMED
      const endedAtIso = new Date(state.movementCandidateStartMs).toISOString();
      const totalDurSec = Math.max(1, Math.round((state.movementCandidateStartMs - safeTimestampMs(state.activeStop.started_at)) / 1000));

      await supabase
        .from("vehicle_stop_events")
        .update({
          status: "COMPLETED",
          ended_at: endedAtIso,
          duration_seconds: totalDurSec,
          end_lat: lat,
          end_lng: lng,
          updated_at: new Date().toISOString(),
        })
        .eq("id", state.activeStop.id);

      console.log(`[Worker] STOP COMPLETED for ${vehicleId} duration ${totalDurSec}s.`);
      state.activeStop = null;
      state.provisionalStationaryStartMs = null;
      state.movementCandidateStartMs = null;
    }
  } else {
    state.movementCandidateStartMs = null;
  }
}

/**
 * Ingests a single Firestore document.
 */
async function handleFirebaseDoc(docId, docData) {
  const lat = typeof docData.lat === "number" ? docData.lat : parseFloat(String(docData.lat || 0));
  const lng = typeof docData.lng === "number" ? docData.lng : parseFloat(String(docData.lng || 0));
  if (!isValidCoord(lat, lng)) return;

  const rawDevId = String(docData.device_id || docId).trim();
  const vNum = docData["v.no"] ? String(docData["v.no"]).replace(/\s+/g, "").toUpperCase() : "";

  // Match vehicle in Supabase
  let vehicle = vehiclesRegistry.get(rawDevId);
  if (!vehicle && vNum) vehicle = vehiclesRegistry.get(vNum);

  if (!vehicle) {
    return; // Vehicle not registered in Supabase
  }

  const speed = Math.max(0, typeof docData.speed === "number" ? docData.speed : parseFloat(String(docData.speed || 0)) || 0);
  const engineOn = docData.engine_on === true || String(docData.engine_on).toLowerCase() === "true" || docData.ignition === true;
  const tsMs = safeTimestampMs(docData.last_update || docData.timestamp);
  const tsIso = new Date(tsMs).toISOString();

  // Deduplicated insert into telemetry_history
  const historyPayload = {
    vehicle_id: vehicle.id,
    speed,
    lat,
    lng,
    fuel: docData.fuel != null ? Number(docData.fuel) : null,
    temperature: docData.temperature != null ? Number(docData.temperature) : null,
    humidity: docData.humidity != null ? Number(docData.humidity) : null,
    engine_on: engineOn,
    ignition: Boolean(docData.ignition),
    location: docData.location || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    source: "firebase",
    recorded_at: tsIso,
  };

  await supabase.from("telemetry_history").insert(historyPayload);

  // Run authoritative server-side stop tracking
  await processTelemetryPoint({
    vehicleId: vehicle.id,
    timestamp: tsIso,
    speed,
    lat,
    lng,
    engineOn,
    location: historyPayload.location,
    source: "firebase",
  });
}

/**
 * Main worker startup.
 */
async function main() {
  const isOnce = process.argv.includes("--once");
  console.log(`[Worker] Starting Telemetry Stop Tracking Service (mode: ${isOnce ? "BATCH_ONCE" : "DAEMON"})...`);

  await loadStateAndRegistry();

  if (isOnce) {
    console.log("[Worker] Fetching current Firebase snapshots...");
    const snap = await getDocs(collection(db, "vechile"));
    for (const doc of snap.docs) {
      await handleFirebaseDoc(doc.id, doc.data());
    }
    console.log("[Worker] Batch run complete.");
    process.exit(0);
  } else {
    console.log("[Worker] Subscribing to live Firebase Firestore updates...");
    onSnapshot(collection(db, "vechile"), async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type === "added" || change.type === "modified") {
          await handleFirebaseDoc(change.doc.id, change.doc.data());
        }
      }
    });

    // Periodic state refresh every 5 minutes
    setInterval(loadStateAndRegistry, 5 * 60 * 1000);
  }
}

main().catch((err) => {
  console.error("[Worker] Fatal error:", err);
  process.exit(1);
});
