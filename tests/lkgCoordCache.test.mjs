/**
 * Tests for the Last-Known-Good (LKG) coordinate cache and related Africa-prevention fixes.
 * Tests 12-15 from the africa_location_fix_plan.md.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isValidFleetCoord, toFleetCoord, NANJIL_DAIRY_DEPOT } from "../src/components/maps/mapConstants.ts";

// ---------------------------------------------------------------------------
// Minimal in-memory localStorage shim (runs in Node without a DOM)
// ---------------------------------------------------------------------------
function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

// ---------------------------------------------------------------------------
// Pure functions extracted from useFirebaseTracking for unit testing
// ---------------------------------------------------------------------------
const LKG_PREFIX = "nanjil_lkg_coord_";

function makeLkgHelpers(ls) {
  function saveLkgCoord(key, coord) {
    if (!key) return;
    try { ls.setItem(LKG_PREFIX + key, JSON.stringify(coord)); } catch {}
  }
  function loadLkgCoord(key) {
    if (!key) return null;
    try {
      const raw = ls.getItem(LKG_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return isValidFleetCoord(parsed) ? parsed : null;
    } catch { return null; }
  }
  return { saveLkgCoord, loadLkgCoord };
}

// ---------------------------------------------------------------------------
// Test 12 — LKG cache saves and restores Tamil Nadu coordinates correctly
// ---------------------------------------------------------------------------
test("12. LKG cache saves and restores a valid Tamil Nadu coordinate", () => {
  const ls = makeLocalStorage();
  const { saveLkgCoord, loadLkgCoord } = makeLkgHelpers(ls);

  const coord = { lat: 8.3473, lng: 77.1106 };
  saveLkgCoord("vehicle-uuid-123", coord);

  const restored = loadLkgCoord("vehicle-uuid-123");
  assert.deepEqual(restored, coord, "Restored coord must match saved Tamil Nadu coord");
});

test("12b. LKG cache returns null for empty key", () => {
  const ls = makeLocalStorage();
  const { loadLkgCoord } = makeLkgHelpers(ls);
  assert.equal(loadLkgCoord(""), null);
  assert.equal(loadLkgCoord(null), null);
});

test("12c. LKG cache rejects stored (0,0) Africa / Null Island coordinate", () => {
  const ls = makeLocalStorage();
  const { saveLkgCoord, loadLkgCoord } = makeLkgHelpers(ls);

  // Manually store a corrupt value (simulates a bug that managed to write 0,0)
  ls.setItem(LKG_PREFIX + "bad-vehicle", JSON.stringify({ lat: 0, lng: 0 }));

  const result = loadLkgCoord("bad-vehicle");
  assert.equal(result, null, "LKG cache must reject (0,0) Null Island coordinate");
});

test("12d. LKG cache rejects stored Africa coordinate (lng ~0.2)", () => {
  const ls = makeLocalStorage();
  const { saveLkgCoord, loadLkgCoord } = makeLkgHelpers(ls);

  ls.setItem(LKG_PREFIX + "bad-vehicle", JSON.stringify({ lat: 5.123, lng: 0.456 }));
  const result = loadLkgCoord("bad-vehicle");
  assert.equal(result, null, "LKG cache must reject West Africa / near-zero longitude");
});

// ---------------------------------------------------------------------------
// Test 13 — Supabase cache strips (0,0) coords before writing to localStorage
// ---------------------------------------------------------------------------
test("13. Supabase vehicle cache sanitises (0,0) before storage", () => {
  const vehicles = [
    { id: "v1", number: "TN 75 BF 0320", lat: 8.3473, lng: 77.1106, location: null },
    { id: "v2", number: "TN 75 M 0041",  lat: 0,      lng: 0,       location: null },  // offline
    { id: "v3", number: "TN 75 F 4323",  lat: null,   lng: null,    location: "8.2607, 77.2883" },
  ];

  // Simulate the sanitisation logic added to useFirebaseTracking.ts
  const safeToCache = vehicles.map((v) => {
    const coord =
      toFleetCoord({ lat: v.lat, lng: v.lng }) ||
      (v.location ? toFleetCoord(v.location) : null);
    if (!coord) return { ...v, lat: null, lng: null };
    return { ...v, lat: coord.lat, lng: coord.lng };
  });

  // v1: should retain Tamil Nadu coords
  assert.equal(safeToCache[0].lat, 8.3473);
  assert.equal(safeToCache[0].lng, 77.1106);

  // v2: (0,0) → stripped to null
  assert.equal(safeToCache[1].lat, null, "Offline vehicle (0,0) must be stripped to null");
  assert.equal(safeToCache[1].lng, null);

  // v3: null coords but valid location string → parsed
  assert.ok(safeToCache[2].lat > 8 && safeToCache[2].lat < 9, "String location must be parsed");
  assert.ok(safeToCache[2].lng > 77 && safeToCache[2].lng < 78);
});

// ---------------------------------------------------------------------------
// Test 14 — parseFirestoreTelemetry: returns existing coord when Firestore sends 0,0
// ---------------------------------------------------------------------------
test("15. parseFirestoreTelemetry: (0,0) from Firestore falls back to existing valid coord", () => {
  // Simulate what parseFirestoreTelemetry does with the new 0 guard:
  //   lat: (lat !== 0 && !isNaN(lat)) ? lat : (existing?.lat || 0)
  function resolveCoord(firestoreLat, firestoreLng, existingLat, existingLng) {
    const liveCoord = toFleetCoord({ lat: firestoreLat, lng: firestoreLng });
    const existingCoord = toFleetCoord({ lat: existingLat, lng: existingLng });
    const coord = liveCoord || existingCoord;
    const lat = coord ? coord.lat : 0;
    const lng = coord ? coord.lng : 0;
    return {
      // New belt-and-suspenders guard
      lat: (lat !== 0 && !isNaN(lat)) ? lat : (existingLat || 0),
      lng: (lng !== 0 && !isNaN(lng)) ? lng : (existingLng || 0),
    };
  }

  // Firestore sends 0,0 for TN 75 BF 0320 (device offline)
  // existing state has last valid Tamil Nadu fix
  const result = resolveCoord(0, 0, 8.3473, 77.1106);
  assert.equal(result.lat, 8.3473, "Firestore (0,0) must fall back to existing lat");
  assert.equal(result.lng, 77.1106, "Firestore (0,0) must fall back to existing lng");

  // Firestore sends valid Tamil Nadu coordinates
  const result2 = resolveCoord(8.260, 77.288, 8.3473, 77.1106);
  assert.equal(result2.lat, 8.260, "Valid Firestore coords must be used");
  assert.equal(result2.lng, 77.288);
});

// ---------------------------------------------------------------------------
// Test 16 — Priority chain: liveCoord > supabaseCoord > lkgCoord > depot
// ---------------------------------------------------------------------------
test("16. Coordinate priority chain always produces Tamil Nadu or depot — never Africa", () => {
  const ls = makeLocalStorage();
  const { saveLkgCoord, loadLkgCoord } = makeLkgHelpers(ls);

  const depot = NANJIL_DAIRY_DEPOT;

  function resolveWithPriority({ firestoreCoord, supabaseCoord, vehicleId, cleanDevId }) {
    const liveCoord = toFleetCoord(firestoreCoord);
    const supaCoord = toFleetCoord(supabaseCoord);
    const lkgCoord = loadLkgCoord(vehicleId) || loadLkgCoord(cleanDevId);
    return liveCoord || supaCoord || lkgCoord || depot;
  }

  // Scenario A: all sources offline → depot
  const a = resolveWithPriority({ firestoreCoord: { lat: 0, lng: 0 }, supabaseCoord: { lat: 0, lng: 0 }, vehicleId: "v-new", cleanDevId: "dev-new" });
  assert.equal(a.lat, depot.lat, "No valid source → depot lat");
  assert.equal(a.lng, depot.lng, "No valid source → depot lng");

  // Scenario B: LKG has a valid coord, Firestore offline
  saveLkgCoord("v-123", { lat: 8.3473, lng: 77.1106 });
  const b = resolveWithPriority({ firestoreCoord: { lat: 0, lng: 0 }, supabaseCoord: null, vehicleId: "v-123", cleanDevId: "" });
  assert.equal(b.lat, 8.3473, "LKG coord must be used when Firestore sends 0,0");

  // Scenario C: Firestore has valid coord → that takes priority over LKG
  const c = resolveWithPriority({ firestoreCoord: { lat: 8.26, lng: 77.28 }, supabaseCoord: null, vehicleId: "v-123", cleanDevId: "" });
  assert.equal(c.lat, 8.26, "Live Firestore coord takes priority over LKG");

  // Scenario D: Final result is never in Africa (lng < 50)
  assert.ok(a.lng > 50, "Depot lng must be > 50 (not Africa)");
  assert.ok(b.lng > 50, "LKG lng must be > 50 (not Africa)");
  assert.ok(c.lng > 50, "Live lng must be > 50 (not Africa)");
});
