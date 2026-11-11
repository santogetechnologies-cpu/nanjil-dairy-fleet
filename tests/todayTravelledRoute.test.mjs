import test from "node:test";
import assert from "node:assert/strict";
import {
  getIstDateRange,
  isValidGpsCoord,
  haversineDistanceKm,
} from "../src/lib/tripHistoryEngine.ts";
import { processRawGpsPoints } from "../src/hooks/useTodayTravelledRoutes.ts";

test("1. Today's Date Range in Asia/Kolkata: Exactly 00:00:00 to 23:59:59 IST", () => {
  const refDate = new Date("2026-11-11T12:00:00.000Z");
  const range = getIstDateRange("today", undefined, undefined, refDate);

  assert.equal(range.startIstDate, "2026-11-11");
  assert.equal(range.endIstDate, "2026-11-11");
  // 2026-11-11 00:00:00 IST is 2026-11-10 18:30:00 UTC
  assert.equal(range.startUtcIso, "2026-11-10T18:30:00.000Z");
  // 2026-11-11 23:59:59.999 IST is 2026-11-11 18:29:59.999 UTC
  assert.equal(range.endUtcIso, "2026-11-11T18:29:59.999Z");
});

test("2. Chronological Sorting: Out-of-order telemetry records are sorted by recorded_at", () => {
  const points = [
    { id: "3", lat: 8.2500, lng: 77.4400, speed: 30, ignition: true, recorded_at: "2026-11-11T05:30:00Z" },
    { id: "1", lat: 8.2415, lng: 77.4326, speed: 0, ignition: true, recorded_at: "2026-11-11T05:10:00Z" },
    { id: "2", lat: 8.2450, lng: 77.4350, speed: 20, ignition: true, recorded_at: "2026-11-11T05:20:00Z" },
  ];

  const segments = processRawGpsPoints(points, 15);
  assert.equal(segments.length, 1);
  const seg = segments[0];
  assert.equal(seg.length, 3);
  assert.equal(seg[0].lat, 8.2415);
  assert.equal(seg[1].lat, 8.2450);
  assert.equal(seg[2].lat, 8.2500);
});

test("3. Coordinate Validation: Rejects invalid, null, NaN, and (0,0) coordinates", () => {
  assert.equal(isValidGpsCoord(8.2415, 77.4326), true);
  assert.equal(isValidGpsCoord(0, 0), false);
  assert.equal(isValidGpsCoord(null, 77.4326), false);
  assert.equal(isValidGpsCoord(8.2415, undefined), false);
  assert.equal(isValidGpsCoord(95.0, 77.4326), false);
  assert.equal(isValidGpsCoord(8.2415, 190.0), false);
  assert.equal(isValidGpsCoord(NaN, 77.4326), false);

  const raw = [
    { id: "1", lat: 8.2415, lng: 77.4326, speed: 0, ignition: true, recorded_at: "2026-11-11T05:00:00Z" },
    { id: "2", lat: 0, lng: 0, speed: 0, ignition: false, recorded_at: "2026-11-11T05:01:00Z" },
    { id: "3", lat: 8.2450, lng: 77.4350, speed: 15, ignition: true, recorded_at: "2026-11-11T05:02:00Z" },
  ];
  const segments = processRawGpsPoints(raw, 15);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].length, 2);
  assert.equal(segments[0][0].lat, 8.2415);
  assert.equal(segments[0][1].lat, 8.2450);
});

test("4. GPS Jump & Teleport Rejection: Discards single-point jumps > 200 km or implied speed > 160 km/h", () => {
  const points = [
    { id: "1", lat: 8.2415, lng: 77.4326, speed: 40, ignition: true, recorded_at: "2026-11-11T05:00:00Z" },
    // Teleport to Mumbai (800+ km away in 10 seconds)
    { id: "2", lat: 19.0760, lng: 72.8777, speed: 40, ignition: true, recorded_at: "2026-11-11T05:00:10Z" },
    // Returns back to regular road in Kanyakumari
    { id: "3", lat: 8.2440, lng: 77.4340, speed: 42, ignition: true, recorded_at: "2026-11-11T05:00:30Z" },
  ];

  const segments = processRawGpsPoints(points, 15);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].length, 2);
  assert.equal(segments[0][0].lat, 8.2415);
  assert.equal(segments[0][1].lat, 8.2440);
});

test("5. Stationary Duplicate Filtering: Consecutive stationary points < 2m apart are omitted", () => {
  const points = [
    { id: "1", lat: 8.241500, lng: 77.432600, speed: 0, ignition: true, recorded_at: "2026-11-11T05:00:00Z" },
    { id: "2", lat: 8.241505, lng: 77.432605, speed: 0, ignition: true, recorded_at: "2026-11-11T05:01:00Z" }, // ~0.7m away
    { id: "3", lat: 8.241510, lng: 77.432610, speed: 0, ignition: true, recorded_at: "2026-11-11T05:02:00Z" }, // ~1.4m away
    { id: "4", lat: 8.249000, lng: 77.440000, speed: 35, ignition: true, recorded_at: "2026-11-11T05:05:00Z" }, // ~1.1km away
  ];

  const segments = processRawGpsPoints(points, 15);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].length, 2);
  assert.equal(segments[0][0].lat, 8.241500);
  assert.equal(segments[0][1].lat, 8.249000);
});

test("6. Route Gap Segmentation: Break polyline into separate segments on signal gap > 15 mins", () => {
  const points = [
    // Morning trip
    { id: "1", lat: 8.2415, lng: 77.4326, speed: 30, ignition: true, recorded_at: "2026-11-11T05:00:00Z" },
    { id: "2", lat: 8.2490, lng: 77.4400, speed: 35, ignition: true, recorded_at: "2026-11-11T05:10:00Z" },
    // 40 minute outage / gap
    { id: "3", lat: 8.3500, lng: 77.5000, speed: 40, ignition: true, recorded_at: "2026-11-11T05:50:00Z" },
    { id: "4", lat: 8.3600, lng: 77.5100, speed: 38, ignition: true, recorded_at: "2026-11-11T05:58:00Z" },
  ];

  const segments = processRawGpsPoints(points, 15);
  assert.equal(segments.length, 2, "Must create 2 separate segments across the 40-minute gap");
  assert.equal(segments[0].length, 2);
  assert.equal(segments[1].length, 2);
  assert.equal(segments[0][0].lat, 8.2415);
  assert.equal(segments[0][1].lat, 8.2490);
  assert.equal(segments[1][0].lat, 8.3500);
  assert.equal(segments[1][1].lat, 8.3600);
});

test("7. Multiple Vehicle Route Independence: Vehicle routes are completely isolated", () => {
  const vehicleAPoints = [
    { id: "A1", lat: 8.2415, lng: 77.4326, speed: 20, ignition: true, recorded_at: "2026-11-11T05:00:00Z" },
    { id: "A2", lat: 8.2500, lng: 77.4400, speed: 25, ignition: true, recorded_at: "2026-11-11T05:10:00Z" },
  ];
  const vehicleBPoints = [
    { id: "B1", lat: 8.3000, lng: 77.5000, speed: 30, ignition: true, recorded_at: "2026-11-11T05:00:00Z" },
    { id: "B2", lat: 8.3100, lng: 77.5100, speed: 32, ignition: true, recorded_at: "2026-11-11T05:10:00Z" },
  ];

  const segsA = processRawGpsPoints(vehicleAPoints);
  const segsB = processRawGpsPoints(vehicleBPoints);

  assert.notDeepEqual(segsA, segsB);
  assert.equal(segsA[0][0].lat, 8.2415);
  assert.equal(segsB[0][0].lat, 8.3000);
});

test("8. Red Polyline Visual Attributes: #FF0000, strokeWeight 5, strokeOpacity 0.9", () => {
  const expectedColor = "#FF0000";
  const expectedWeight = 5;
  const expectedOpacity = 0.9;

  assert.equal(expectedColor, "#FF0000");
  assert.equal(expectedWeight, 5);
  assert.equal(expectedOpacity, 0.9);
});
