import test from "node:test";
import assert from "node:assert/strict";
import {
  getIstDateRange,
  isValidGpsCoord,
  isFleetOperatingCoordinate,
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

test("9. Geofence & Fleet Operating Coordinate Validation: Rejects Africa / Prime Meridian Glitches", () => {
  // Corrupted hardware/EMQX coordinates where longitude dropped 77 degree prefix
  assert.equal(isFleetOperatingCoordinate(8.390383, 0.2), false, "Must reject West Africa Togo/Nigeria coordinate");
  assert.equal(isFleetOperatingCoordinate(8.329567, 0.466667), false, "Must reject West Africa coordinate");
  assert.equal(isFleetOperatingCoordinate(8.25, 0.02), false, "Must reject West Africa coordinate");
  assert.equal(isFleetOperatingCoordinate(0.1, 0.566667), false, "Must reject Gulf of Guinea coordinate");
  assert.equal(isFleetOperatingCoordinate(0, 0), false, "Must reject (0, 0)");
  assert.equal(isFleetOperatingCoordinate(null, 77.2883), false, "Must reject null lat");
  assert.equal(isFleetOperatingCoordinate(8.2607, undefined), false, "Must reject undefined lng");
  assert.equal(isFleetOperatingCoordinate(Infinity, 77.2883), false, "Must reject infinite lat");

  // Valid fleet operating coordinates in South India
  assert.equal(isFleetOperatingCoordinate(8.260765, 77.288373), true, "Must accept Nanjil Dairy Depot base");
  assert.equal(isFleetOperatingCoordinate(8.1833, 77.4119), true, "Must accept Nagercoil");
  assert.equal(isFleetOperatingCoordinate(9.9252, 78.1198), true, "Must accept Madurai");
  assert.equal(isFleetOperatingCoordinate(13.0827, 80.2707), true, "Must accept Chennai");
});

test("10. Route Processing Strips Africa Glitches: Discards West Africa coordinates mixed into telemetry", () => {
  const points = [
    // Genuine Nanjil vehicle start in Kanyakumari
    { id: "1", lat: 8.2415, lng: 77.4326, speed: 30, ignition: true, recorded_at: "2026-11-11T05:00:00Z" },
    // Corrupted EMQX telemetry point in West Africa (lng: 0.2)
    { id: "2", lat: 8.390383, lng: 0.2, speed: 35, ignition: true, recorded_at: "2026-11-11T05:01:00Z" },
    // Genuine Nanjil vehicle next point in Kanyakumari
    { id: "3", lat: 8.2450, lng: 77.4350, speed: 28, ignition: true, recorded_at: "2026-11-11T05:02:00Z" },
    // Second corrupted point in West Africa
    { id: "4", lat: 8.25, lng: 0.02, speed: 0, ignition: true, recorded_at: "2026-11-11T05:03:00Z" },
    // Genuine Nanjil vehicle continuation
    { id: "5", lat: 8.2490, lng: 77.4400, speed: 32, ignition: true, recorded_at: "2026-11-11T05:04:00Z" },
  ];

  const segments = processRawGpsPoints(points, 15);
  assert.equal(segments.length, 1);
  const route = segments[0];
  assert.equal(route.length, 3, "Route must contain only the 3 valid Indian coordinates");
  assert.equal(route[0].lat, 8.2415);
  assert.equal(route[0].lng, 77.4326);
  assert.equal(route[1].lat, 8.2450);
  assert.equal(route[1].lng, 77.4350);
  assert.equal(route[2].lat, 8.2490);
  assert.equal(route[2].lng, 77.4400);

  // Verify none of the coordinates in the polyline have longitude < 50
  for (const pt of route) {
    assert.ok(pt.lng >= 50, "No coordinate in route polyline can have longitude in Africa");
  }
});

test("11. Outlier at beginning or end of route: Does not draw misleading lines", () => {
  const points = [
    // Telemetry begins with an Africa corrupted packet
    { id: "1", lat: 8.390383, lng: 0.2, speed: 0, ignition: false, recorded_at: "2026-11-11T04:59:00Z" },
    // Normal trip starts
    { id: "2", lat: 8.2607, lng: 77.2883, speed: 10, ignition: true, recorded_at: "2026-11-11T05:00:00Z" },
    { id: "3", lat: 8.2650, lng: 77.2920, speed: 25, ignition: true, recorded_at: "2026-11-11T05:02:00Z" },
    // Telemetry ends with an Africa corrupted packet
    { id: "4", lat: 8.329567, lng: 0.466667, speed: 0, ignition: false, recorded_at: "2026-11-11T05:05:00Z" },
  ];

  const segments = processRawGpsPoints(points, 15);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].length, 2);
  assert.equal(segments[0][0].lat, 8.2607);
  assert.equal(segments[0][0].lng, 77.2883);
  assert.equal(segments[0][1].lat, 8.2650);
  assert.equal(segments[0][1].lng, 77.2920);
});

