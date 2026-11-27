import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PLAUSIBLE_SPEED_KMH,
  isPlausibleSpeed,
  sanitizePlausibleSpeed,
  getOverspeedStatus,
  OverspeedManager,
} from "../src/lib/overspeed.ts";
import {
  normalizeFirebaseDocument,
  normalizeEmqxRow,
} from "../src/lib/telemetry-ingestion.ts";

test("isPlausibleSpeed and sanitizePlausibleSpeed reject 333 km/h corrupt GPS spikes and negative values", () => {
  assert.equal(MAX_PLAUSIBLE_SPEED_KMH, 150);
  assert.equal(isPlausibleSpeed(61), true);
  assert.equal(isPlausibleSpeed(150), true);
  assert.equal(isPlausibleSpeed(333), false);
  assert.equal(isPlausibleSpeed("333"), false);
  assert.equal(isPlausibleSpeed(-12), false);
  assert.equal(isPlausibleSpeed(NaN), false);

  assert.equal(sanitizePlausibleSpeed(333, 42), 42);
  assert.equal(sanitizePlausibleSpeed(333, 0), 0);
  assert.equal(sanitizePlausibleSpeed(61, 42), 61);
  assert.equal(sanitizePlausibleSpeed(85, 0), 85);
});

test("getOverspeedStatus rejects 333 km/h GPS glitch as normal while flagging real 61-150 km/h overspeed", () => {
  const spike = getOverspeedStatus(333, 60);
  assert.equal(spike.isOverspeed, false);
  assert.equal(spike.level, "normal");
  assert.equal(spike.speed, 0);

  const realWarning = getOverspeedStatus(61, 60);
  assert.equal(realWarning.isOverspeed, true);
  assert.equal(realWarning.level, "warning");
  assert.equal(realWarning.speed, 61);

  const realCritical = getOverspeedStatus(85, 60);
  assert.equal(realCritical.isOverspeed, true);
  assert.equal(realCritical.level, "critical");
  assert.equal(realCritical.excessSpeed, 25);
});

test("OverspeedManager ignores 333 km/h spikes during evaluation and persistence and uses atomic dedupe RPC", async () => {
  const rpcCalls = [];
  const insertedRows = [];
  const mockSupabase = {
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      return { data: { ok: true, inserted: true }, error: null };
    },
    from: () => ({
      insert: async (row) => {
        insertedRows.push(row);
        return { error: null };
      },
    }),
  };

  const manager = new OverspeedManager(mockSupabase);
  const vehId = "11111111-1111-4111-8111-111111111111";

  // 1. Corrupt 333 km/h spike produces zero transition events
  const spikeEvents = manager.evaluateTransitions([
    {
      id: vehId,
      number: "TN 75 R 9952",
      speed: 333,
    },
  ]);
  assert.equal(spikeEvents.length, 0);

  // Even if manually passed to persistAlerts, 333 km/h is blocked before DB write
  await manager.persistAlerts([
    {
      vehicleId: vehId,
      vehicleNumber: "TN 75 R 9952",
      previousLevel: "normal",
      currentLevel: "critical",
      speed: 333,
      timestamp: Date.now(),
    },
  ]);
  assert.equal(rpcCalls.length, 0);
  assert.equal(insertedRows.length, 0);

  // 2. Genuine 88 km/h overspeed calls record_safety_overspeed_alert RPC cleanly
  const realEvents = manager.evaluateTransitions([
    {
      id: vehId,
      number: "TN 75 R 9952",
      speed: 88,
    },
  ]);
  assert.equal(realEvents.length, 1);
  await manager.persistAlerts(realEvents);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fn, "record_safety_overspeed_alert");
  assert.equal(rpcCalls[0].args.p_speed, 88);
  assert.equal(rpcCalls[0].args.p_severity, "High");
});

test("normalizeFirebaseDocument and normalizeEmqxRow sanitize corrupt 333 km/h telemetry speed", () => {
  const fb = normalizeFirebaseDocument(
    "123456789012345",
    {
      lat: 8.21,
      lng: 77.31,
      speed: 333,
      engine_on: true,
      ignition: true,
      last_update: "2026-11-26T11:15:07Z",
    },
    { id: "veh-1", number: "TN 75 R 9952" }
  );
  assert.ok(fb);
  assert.equal(fb.speed, 0);

  const emqx = normalizeEmqxRow({
    vehicle_id: "veh-2",
    lat: 8.22,
    lng: 77.32,
    speed: 61,
    engine_on: true,
    ignition: true,
    recorded_at: "2026-11-26T06:02:11Z",
  });
  assert.ok(emqx);
  assert.equal(emqx.speed, 61);
});
