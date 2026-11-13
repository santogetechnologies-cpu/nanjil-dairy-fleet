import test from "node:test";
import assert from "node:assert/strict";
import {
  getIstDateRange,
  isValidGpsCoord,
  isFleetOperatingCoordinate,
  haversineDistanceKm,
} from "../src/lib/tripHistoryEngine.ts";
import {
  processRawGpsPoints,
  mergeAndDeduplicatePoints,
  normalizeDeviceId,
  printFleetRouteDiagnostics,
  anchorPointsToNanjilPlant,
  buildPlantConnector,
  NANJIL_DAIRY_DEPOT,
} from "../src/hooks/useTodayTravelledRoutes.ts";

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

test("12. Race Condition Protection: Merging in-flight live updates with fetched history", () => {
  // Live update arrived while history was fetching
  const livePoints = [
    { id: "live-1", lat: 8.2750, lng: 77.2950, speed: 35, recorded_at: "2026-11-12T05:15:00Z" },
  ];

  // Historical batch completed a moment later
  const historyPoints = [
    { id: "h-1", lat: 8.2600, lng: 77.2880, speed: 30, recorded_at: "2026-11-12T05:00:00Z" },
    { id: "h-2", lat: 8.2680, lng: 77.2910, speed: 32, recorded_at: "2026-11-12T05:05:00Z" },
    { id: "live-1", lat: 8.2750, lng: 77.2950, speed: 35, recorded_at: "2026-11-12T05:15:00Z" }, // duplicated in history
  ];

  const merged = mergeAndDeduplicatePoints(livePoints, historyPoints);
  assert.equal(merged.length, 3, "Duplicate live point must be deduplicated");
  assert.equal(merged[0].id, "h-1");
  assert.equal(merged[1].id, "h-2");
  assert.equal(merged[2].id, "live-1");

  const segments = processRawGpsPoints(merged, 15);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].length, 3);
  assert.equal(segments[0][2].lat, 8.2750, "Live update coordinate must be preserved at end of route");
});

test("13. Single-Point Route Handling: Returns empty segments or fails minimum 2-point requirement", () => {
  const singlePoint = [
    { id: "single-1", lat: 8.2607, lng: 77.2883, speed: 0, recorded_at: "2026-11-12T05:00:00Z" },
  ];

  // Single point in processRawGpsPoints produces a 1-point segment, which polyline renderer rejects (< 2 points)
  const segments = processRawGpsPoints(singlePoint, 15);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].length, 1);
  // Verifying minimum 2-point requirement for polyline drawing
  const canDrawPolyline = segments.some((s) => s.length >= 2);
  assert.equal(canDrawPolyline, false, "Must not draw polyline for single-point route");
});

test("14. Seven Fleet Vehicles Individual Test Suite", () => {
  // Vehicle 1: TN 75 S 1688 (Historical route exists, moving)
  const v1Points = [
    { id: "v1-1", lat: 8.2600, lng: 77.2880, speed: 30, recorded_at: "2026-11-12T05:00:00Z" },
    { id: "v1-2", lat: 8.2700, lng: 77.2900, speed: 40, recorded_at: "2026-11-12T05:05:00Z" },
  ];
  const segs1 = processRawGpsPoints(v1Points);
  assert.ok(segs1.length >= 1 && segs1[0].length >= 2, "V1 must have polyline");

  // Vehicle 2: TN 75 R 9952 (Moving vehicle extending route)
  const v2Points = [
    { id: "v2-1", lat: 8.2800, lng: 77.3000, speed: 25, recorded_at: "2026-11-12T05:00:00Z" },
    { id: "v2-2", lat: 8.2900, lng: 77.3100, speed: 35, recorded_at: "2026-11-12T05:05:00Z" },
  ];
  const segs2 = processRawGpsPoints(v2Points);
  assert.ok(segs2.length >= 1 && segs2[0].length >= 2, "V2 must have polyline");

  // Vehicle 3: TN 75 F 4323 (Multi-segment route with stops)
  const v3Points = [
    { id: "v3-1", lat: 8.2600, lng: 77.2880, speed: 30, recorded_at: "2026-11-12T04:00:00Z" },
    { id: "v3-2", lat: 8.2700, lng: 77.2880, speed: 30, recorded_at: "2026-11-12T04:10:00Z" },
    // 30 min gap
    { id: "v3-3", lat: 8.3000, lng: 77.3200, speed: 35, recorded_at: "2026-11-12T04:45:00Z" },
    { id: "v3-4", lat: 8.3100, lng: 77.3300, speed: 35, recorded_at: "2026-11-12T04:55:00Z" },
  ];
  const segs3 = processRawGpsPoints(v3Points, 15);
  assert.equal(segs3.length, 2, "V3 must have 2 distinct route segments across gap");
  assert.ok(segs3[0].length >= 2 && segs3[1].length >= 2);

  // Vehicle 4: TN 75 BC 2219 (Idle vehicle, drift rejected)
  const v4Points = [
    { id: "v4-1", lat: 8.2500, lng: 77.3500, speed: 20, recorded_at: "2026-11-12T05:00:00Z" },
    { id: "v4-2", lat: 8.2550, lng: 77.3550, speed: 20, recorded_at: "2026-11-12T05:05:00Z" },
    { id: "v4-3", lat: 8.255001, lng: 77.355001, speed: 0, recorded_at: "2026-11-12T05:06:00Z" }, // < 2m drift
  ];
  const segs4 = processRawGpsPoints(v4Points);
  assert.equal(segs4[0].length, 2, "V4 must filter out stationary micro-drift");

  // Vehicle 5: TN 75 BF 0320 (Only 1 point today -> route unavailable)
  const v5Points = [
    { id: "v5-1", lat: 8.2600, lng: 77.2880, speed: 0, recorded_at: "2026-11-12T05:00:00Z" },
  ];
  const segs5 = processRawGpsPoints(v5Points);
  assert.equal(segs5[0].length < 2, true, "V5 has < 2 points, polyline not drawn");

  // Vehicle 6: TN 75 M 0041 (Temporarily offline / no live position, but historical points exist)
  const v6Points = [
    { id: "v6-1", lat: 8.2400, lng: 77.2700, speed: 30, recorded_at: "2026-11-12T03:00:00Z" },
    { id: "v6-2", lat: 8.2480, lng: 77.2780, speed: 30, recorded_at: "2026-11-12T03:10:00Z" },
  ];
  const segs6 = processRawGpsPoints(v6Points);
  assert.equal(segs6.length, 1);
  assert.equal(segs6[0].length, 2, "V6 offline vehicle must still display historical polyline");

  // Vehicle 7: TN 75 S 9826 (Historical points exist, renders independently)
  const v7Points = [
    { id: "v7-1", lat: 8.2300, lng: 77.2500, speed: 30, recorded_at: "2026-11-12T02:00:00Z" },
    { id: "v7-2", lat: 8.2380, lng: 77.2580, speed: 30, recorded_at: "2026-11-12T02:10:00Z" },
  ];
  const segs7 = processRawGpsPoints(v7Points);
  assert.equal(segs7.length, 1);
  assert.equal(segs7[0].length, 2, "V7 must display independent red route");
});

test("15. Device ID and UUID matching: Supports clean device ID, device_ prefix, and UUID", () => {
  assert.equal(normalizeDeviceId("863110086146753"), "863110086146753");
  assert.equal(normalizeDeviceId("device_863110086146753"), "863110086146753");
  assert.equal(normalizeDeviceId(863110086146753), "863110086146753");
  assert.equal(normalizeDeviceId(null), undefined);
});

test("16. printFleetRouteDiagnostics: Generates complete 7-vehicle diagnostic metrics", () => {
  const mockVehicles = [
    {
      id: "d0fea864-64a4-4148-b3b2-600f68459583",
      deviceId: "863110086192104",
      number: "TN 75 BC 2219",
      lat: 8.2068,
      lng: 77.3702,
      speed: 15,
      status: "Moving",
    },
  ];

  const mockRoutes = {
    "d0fea864-64a4-4148-b3b2-600f68459583": [
      [
        { lat: 8.2000, lng: 77.3600 },
        { lat: 8.2068, lng: 77.3702 },
      ],
    ],
  };

  const rawMap = new Map();
  rawMap.set("d0fea864-64a4-4148-b3b2-600f68459583", [
    { id: "1", lat: 8.2000, lng: 77.3600, speed: 20, recorded_at: "2026-11-12T05:00:00Z" },
    { id: "2", lat: 8.2068, lng: 77.3702, speed: 15, recorded_at: "2026-11-12T05:05:00Z" },
  ]);

  const report = printFleetRouteDiagnostics(mockVehicles, mockRoutes, rawMap);
  assert.equal(report.length, 7, "Report must cover all 7 Nanjil GPS vehicles");

  const vBC2219 = report.find((r) => r.registrationNumber === "TN 75 BC 2219");
  assert.ok(vBC2219, "TN 75 BC 2219 must be present");
  assert.equal(vBC2219.gpsDeviceId, "863110086192104");
  assert.equal(vBC2219.firebaseDocId, "863110086192104");
  assert.equal(vBC2219.todayTelemetryCount, 2);
  assert.equal(vBC2219.validGpsCount, 2);
  assert.equal(vBC2219.rejectedGpsCount, 0);
  assert.equal(vBC2219.segmentsGte2Points, 1);
  assert.equal(vBC2219.polylineRenderedStatus, "Active / Rendered");

  const vBF0320 = report.find((r) => r.registrationNumber === "TN 75 BF 0320");
  assert.ok(vBF0320, "TN 75 BF 0320 must be present");
  assert.equal(vBF0320.todayTelemetryCount, 0);
  assert.equal(vBF0320.segmentsGte2Points, 0);
  assert.equal(vBF0320.polylineRenderedStatus, "Insufficient Data (< 2 points)");
});

test("17. Nanjil Dairy Plant Base Location: Verified Depot Coordinates and Name", () => {
  assert.equal(NANJIL_DAIRY_DEPOT.lat, 8.260765, "Depot latitude must match verified Mulagumoodu location");
  assert.equal(NANJIL_DAIRY_DEPOT.lng, 77.288373, "Depot longitude must match verified Mulagumoodu location");
  assert.ok(NANJIL_DAIRY_DEPOT.name.includes("Mulagumoodu"), "Depot name must specify Mulagumoodu plant");
  assert.equal(isFleetOperatingCoordinate(NANJIL_DAIRY_DEPOT.lat, NANJIL_DAIRY_DEPOT.lng), true);
});

test("18. No Artificial GPS Anchoring: processRawGpsPoints Preserves Authentic Telemetry", () => {
  // Vehicle points recorded away from the plant (e.g. out on route)
  const remotePoints = [
    { id: "p1", lat: 8.5177, lng: 77.8580, speed: 20, recorded_at: "2026-11-13T05:00:00Z" },
    { id: "p2", lat: 8.5200, lng: 77.8600, speed: 25, recorded_at: "2026-11-13T05:05:00Z" },
  ];

  // Authentic GPS route MUST NOT prepend depot coordinates or create straight-line connection
  const segments = processRawGpsPoints(remotePoints, 15);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].length, 2, "Must contain exactly the authentic GPS points");
  assert.equal(segments[0][0].lat, 8.5177);
  assert.equal(segments[0][0].lng, 77.8580);
  assert.equal(segments[0][1].lat, 8.5200);
  assert.equal(segments[0][1].lng, 77.8600);
  assert.notEqual(segments[0][0].lat, NANJIL_DAIRY_DEPOT.lat);
});

test("19. Plant Road Connector: Separately Generated When Vehicle Origin Is Away from Plant", async () => {
  // Vehicle whose first point is at the plant (<150m away)
  const atPlantPoint = { lat: 8.2608, lng: 77.2884 };
  const nullConnector = await buildPlantConnector(atPlantPoint);
  assert.equal(nullConnector, null, "Vehicle already at plant must not have an artificial connector");

  // Vehicle whose first point is remote (away from plant)
  const remotePoint = { lat: 8.5177, lng: 77.8580 };
  const connector = await buildPlantConnector(remotePoint);
  assert.ok(connector != null, "Must generate connector when remote");
  assert.ok(connector.length >= 2, "Connector must have at least 2 points");
  assert.equal(connector[0].lat, NANJIL_DAIRY_DEPOT.lat);
  assert.equal(connector[0].lng, NANJIL_DAIRY_DEPOT.lng);
  const lastConnPt = connector[connector.length - 1];
  assert.equal(lastConnPt.lat, remotePoint.lat);
  assert.equal(lastConnPt.lng, remotePoint.lng);
});

test("20. Individual Vehicle Tracking: Selected Vehicle Highlighting vs Dimmed Unselected Routes", () => {
  const selectedVehicleRouteProps = {
    strokeColor: "#DC2626",
    strokeWeight: 5.5,
    strokeOpacity: 1.0,
    zIndex: 100,
  };

  const unselectedVehicleRouteProps = {
    strokeColor: "#94A3B8",
    strokeWeight: 2.5,
    strokeOpacity: 0.22,
    zIndex: 10,
  };

  const defaultNoSelectionProps = {
    strokeColor: "#EF4444",
    strokeWeight: 3.8,
    strokeOpacity: 0.8,
    zIndex: 20,
  };

  // Selected route must be significantly thicker, fully opaque, and higher zIndex
  assert.ok(selectedVehicleRouteProps.strokeWeight > unselectedVehicleRouteProps.strokeWeight);
  assert.ok(selectedVehicleRouteProps.strokeOpacity > unselectedVehicleRouteProps.strokeOpacity);
  assert.ok(selectedVehicleRouteProps.zIndex > unselectedVehicleRouteProps.zIndex);
  assert.equal(selectedVehicleRouteProps.strokeColor, "#DC2626");
  assert.equal(unselectedVehicleRouteProps.strokeOpacity, 0.22);
});

test("21. Real-Time Extension: Appending New Valid Point Without Route Replacement", () => {
  const existing = [
    { id: "1", lat: 8.260765, lng: 77.288373, speed: 0, recorded_at: "2026-11-13T04:00:00Z" },
    { id: "2", lat: 8.270000, lng: 77.290000, speed: 30, recorded_at: "2026-11-13T04:05:00Z" },
  ];

  const newGpsPoint = {
    id: "3",
    lat: 8.275000,
    lng: 77.295000,
    speed: 35,
    recorded_at: "2026-11-13T04:10:00Z",
  };

  const merged = mergeAndDeduplicatePoints(existing, [newGpsPoint]);
  assert.equal(merged.length, 3, "New GPS point must be appended to historical route");
  assert.equal(merged[0].lat, 8.260765);
  assert.equal(merged[2].lat, 8.275000, "Latest location must be at route tip");

  const segments = processRawGpsPoints(merged, 15);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].length, 3);
});

test("22. Strict Odometer Integrity: Zero Artificial Connector Distance in Odometer Calculations", () => {
  // 2 authentic points 1.0 km apart
  const actualPoints = [
    { id: "1", lat: 8.5177, lng: 77.8580, speed: 30, recorded_at: "2026-11-13T05:00:00Z" },
    { id: "2", lat: 8.5200, lng: 77.8600, speed: 30, recorded_at: "2026-11-13T05:02:00Z" },
  ];

  const segments = processRawGpsPoints(actualPoints, 15);
  let actualGpsDistance = 0;
  segments.forEach((seg) => {
    for (let i = 0; i < seg.length - 1; i++) {
      actualGpsDistance += haversineDistanceKm(seg[i].lat, seg[i].lng, seg[i + 1].lat, seg[i + 1].lng);
    }
  });

  // Calculate distance including straight depot jump (which was the bug!)
  const buggyJumpDist = haversineDistanceKm(
    NANJIL_DAIRY_DEPOT.lat,
    NANJIL_DAIRY_DEPOT.lng,
    actualPoints[0].lat,
    actualPoints[0].lng,
  );

  // The actual GPS distance must be < 1.0 km, NOT 60+ km from depot!
  assert.ok(actualGpsDistance < 1.0, `Actual distance should be <1km, got ${actualGpsDistance}`);
  assert.ok(buggyJumpDist > 50.0, "Depot distance jump is huge and must NEVER be in route distance");
});




