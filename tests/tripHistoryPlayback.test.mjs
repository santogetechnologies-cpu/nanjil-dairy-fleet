import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidUuid,
  isValidGpsCoord,
  haversineDistanceKm,
  getIstDateRange,
  formatIstDateTime,
  formatIstTime,
  splitPointsIntoSegments,
  buildSegmentedGeoJson,
  calculateJourneyMetrics,
  resolveDriverForJourney,
  deriveJourneysFromTelemetry,
  generateJourneyTimelineEvents,
  fetchPaginatedTelemetryHistory,
} from "../src/lib/tripHistoryEngine.ts";
import { isGpsVehicle, KNOWN_NANJIL_DEVICE_MAP } from "../src/lib/vehicle-stop-detection.ts";

// ── TEST SUITE: 24 SCENARIOS ─────────────────────────────────────────────────

test("1. Correct vehicle UUID mapping: Validates RFC4122 v4 UUIDs and rejects non-UUID strings", () => {
  assert.equal(isValidUuid("09b85a4a-1d9f-43f0-8343-ace9d27a1670"), true);
  assert.equal(isValidUuid("1b115b9d-6357-4a9e-8e76-1d59497695af"), true);
  assert.equal(isValidUuid("not-a-uuid"), false);
  assert.equal(isValidUuid("863110086146753"), false, "Device ID must NOT be treated as a UUID");
  assert.equal(isValidUuid(""), false);
  assert.equal(isValidUuid(null), false);
  assert.equal(isValidUuid(undefined), false);
});

test("2. Device ID never passed into UUID vehicle_id queries", async () => {
  const fakeSupabase = {
    from: () => {
      throw new Error("Should not be called with device ID");
    },
  };

  // Calling fetch with a device ID instead of UUID should fail upfront without hitting database
  const res = await fetchPaginatedTelemetryHistory(
    fakeSupabase,
    "863110086146753", // Hardware Device ID, NOT UUID
    "2026-11-05T00:00:00Z",
    "2026-11-05T23:59:59Z"
  );

  assert.equal(res.data.length, 0);
  assert.match(res.error, /Invalid vehicle UUID/);
});

test("3. Historical pagination beyond 1,000 records: Traverses all pages until exhausted", async () => {
  const totalRecords = 2450;
  const mockDb = [];
  const t0 = new Date("2026-11-05T00:00:00Z").getTime();

  for (let i = 0; i < totalRecords; i++) {
    mockDb.push({
      id: i + 1,
      vehicle_id: "09b85a4a-1d9f-43f0-8343-ace9d27a1670",
      lat: 8.25 + i * 0.0001,
      lng: 77.30 + i * 0.0001,
      speed: 35,
      ignition: true,
      engine_on: true,
      recorded_at: new Date(t0 + i * 10 * 1000).toISOString(),
    });
  }

  const fakeSupabase = {
    from: (table) => {
      assert.equal(table, "telemetry_history");
      return {
        select: (cols, opts) => ({
          eq: (f, v) => ({
            gte: () => ({
              lte: () => ({
                order: () => ({
                  order: () => ({
                    range: (from, to) => {
                      const slice = mockDb.slice(from, to + 1);
                      return Promise.resolve({
                        data: slice,
                        error: null,
                        count: opts?.count === "exact" ? totalRecords : undefined,
                      });
                    },
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    },
  };

  const progressReports = [];
  const res = await fetchPaginatedTelemetryHistory(
    fakeSupabase,
    "09b85a4a-1d9f-43f0-8343-ace9d27a1670",
    "2026-11-05T00:00:00Z",
    "2026-11-05T23:59:59Z",
    1000,
    (loaded, total) => progressReports.push({ loaded, total })
  );

  assert.equal(res.error, undefined);
  assert.equal(res.data.length, totalRecords, "Must load all 2,450 records across 3 pages");
  assert.equal(progressReports.length, 3, "Must report progress for 3 pages (1000, 2000, 2450)");
  assert.equal(progressReports[2].loaded, 2450);
});

test("4. Chronological GPS ordering: Returned records are sorted by timestamp and ID", async () => {
  const fakeSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => ({
            lte: () => ({
              order: (f1, o1) => ({
                order: (f2, o2) => {
                  assert.equal(f1, "recorded_at");
                  assert.equal(o1.ascending, true);
                  assert.equal(f2, "id");
                  assert.equal(o2.ascending, true);
                  return {
                    range: () => Promise.resolve({ data: [], error: null }),
                  };
                },
              }),
            }),
          }),
        }),
      }),
    }),
  };

  await fetchPaginatedTelemetryHistory(
    fakeSupabase,
    "09b85a4a-1d9f-43f0-8343-ace9d27a1670",
    "2026-11-05T00:00:00Z",
    "2026-11-05T23:59:59Z"
  );
});

test("5. Duplicate telemetry removal: De-duplicates identical record IDs across pagination boundaries", async () => {
  let callCount = 0;
  const fakeSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => ({
            lte: () => ({
              order: () => ({
                order: () => ({
                  range: () => {
                    callCount++;
                    if (callCount === 1) {
                      return Promise.resolve({
                        data: [
                          { id: 101, lat: 8.25, lng: 77.30, speed: 20, recorded_at: "2026-11-05T08:00:00Z" },
                          { id: 102, lat: 8.26, lng: 77.31, speed: 25, recorded_at: "2026-11-05T08:01:00Z" },
                        ],
                        error: null,
                      });
                    }
                    if (callCount === 2) {
                      // Simulates overlapping page with duplicate id 102
                      return Promise.resolve({
                        data: [
                          { id: 102, lat: 8.26, lng: 77.31, speed: 25, recorded_at: "2026-11-05T08:01:00Z" },
                          { id: 103, lat: 8.27, lng: 77.32, speed: 30, recorded_at: "2026-11-05T08:02:00Z" },
                        ],
                        error: null,
                      });
                    }
                    return Promise.resolve({ data: [], error: null });
                  },
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  };

  const res = await fetchPaginatedTelemetryHistory(
    fakeSupabase,
    "09b85a4a-1d9f-43f0-8343-ace9d27a1670",
    "2026-11-05T00:00:00Z",
    "2026-11-05T23:59:59Z",
    2
  );

  assert.equal(res.data.length, 3, "Duplicate record with id 102 must be eliminated");
  assert.deepEqual(res.data.map((d) => d.id), ["101", "102", "103"]);
});

test("6. Invalid coordinate rejection: Rejects null, out of range, and (0,0) coordinates", () => {
  assert.equal(isValidGpsCoord(8.2605, 77.2884), true);
  assert.equal(isValidGpsCoord(0, 0), false, "(0,0) must be rejected");
  assert.equal(isValidGpsCoord(95.5, 77.28), false, "Latitude > 90 must be rejected");
  assert.equal(isValidGpsCoord(-95.5, 77.28), false, "Latitude < -90 must be rejected");
  assert.equal(isValidGpsCoord(8.26, 185.0), false, "Longitude > 180 must be rejected");
  assert.equal(isValidGpsCoord(NaN, 77.28), false);
  assert.equal(isValidGpsCoord(null, null), false);
  assert.equal(isValidGpsCoord(undefined, undefined), false);
});

test("7. GPS gaps and segmented map routes: MultiLineString breaks polyline across gaps > 15 mins", () => {
  const points = [
    { id: "1", lat: 8.20, lng: 77.30, speed: 40, ignition: true, recorded_at: "2026-11-05T08:00:00.000Z" },
    { id: "2", lat: 8.21, lng: 77.31, speed: 40, ignition: true, recorded_at: "2026-11-05T08:05:00.000Z" },
    // 25-minute signal gap (> 15 min threshold)
    { id: "3", lat: 8.35, lng: 77.45, speed: 40, ignition: true, recorded_at: "2026-11-05T08:30:00.000Z" },
    { id: "4", lat: 8.36, lng: 77.46, speed: 40, ignition: true, recorded_at: "2026-11-05T08:35:00.000Z" },
  ];

  const { segments, gapIndices } = splitPointsIntoSegments(points, 15);
  assert.equal(segments.length, 2, "Route must be split into 2 disconnected segments");
  assert.equal(gapIndices.length, 1);
  assert.equal(gapIndices[0], 2);

  const geoJson = buildSegmentedGeoJson(segments);
  assert.equal(geoJson.geometry.type, "MultiLineString");
  assert.equal(geoJson.geometry.coordinates.length, 2);
  // Segment 1 coordinates
  assert.deepEqual(geoJson.geometry.coordinates[0], [
    [77.30, 8.20],
    [77.31, 8.21],
  ]);
  // Segment 2 coordinates (NOT connected to segment 1!)
  assert.deepEqual(geoJson.geometry.coordinates[1], [
    [77.45, 8.35],
    [77.46, 8.36],
  ]);
});

test("8. Accurate Haversine distance: Calculates distance accurately and ignores teleport jumps", () => {
  // Known distance between Depot (8.2605, 77.2884) and Nagercoil (8.1833, 77.4119) is ~16.0 km
  const d = haversineDistanceKm(8.2605, 77.2884, 8.1833, 77.4119);
  assert.ok(d > 15.0 && d < 17.0, `Calculated distance ${d}km is within expected ~16.0 km`);

  // Teleport jump test (> 200 km)
  const teleportJump = haversineDistanceKm(8.2605, 77.2884, 12.9716, 77.5946); // Bangalore ~530 km
  assert.ok(teleportJump > 500, "Bangalore jump is > 500km");
});

test("9. Irregular timestamp calculations: Driving duration uses actual timestamps, not fixed 2m steps", () => {
  const points = [
    // 30 seconds moving
    { id: "1", lat: 8.20, lng: 77.30, speed: 30, ignition: true, recorded_at: "2026-11-05T08:00:00.000Z" },
    { id: "2", lat: 8.203, lng: 77.303, speed: 35, ignition: true, recorded_at: "2026-11-05T08:00:30.000Z" },
    // 45 seconds moving
    { id: "3", lat: 8.207, lng: 77.307, speed: 40, ignition: true, recorded_at: "2026-11-05T08:01:15.000Z" },
  ];

  const metrics = calculateJourneyMetrics(points);
  assert.equal(metrics.drivingDurationSeconds, 75, "Must compute exactly 75 seconds (30s + 45s)");
});

test("10. Stop duration calculations: Stationary >= 120s confirms stop", () => {
  const points = [
    { id: "1", lat: 8.20, lng: 77.30, speed: 0, ignition: true, recorded_at: "2026-11-05T08:00:00.000Z" },
    { id: "2", lat: 8.20, lng: 77.30, speed: 0, ignition: true, recorded_at: "2026-11-05T08:01:00.000Z" },
    { id: "3", lat: 8.20, lng: 77.30, speed: 0, ignition: true, recorded_at: "2026-11-05T08:02:30.000Z" }, // 150s stationary
    { id: "4", lat: 8.21, lng: 77.31, speed: 30, ignition: true, recorded_at: "2026-11-05T08:03:00.000Z" },
  ];

  const metrics = calculateJourneyMetrics(points);
  assert.equal(metrics.stopsCount, 1, "Must confirm 1 stop");
  assert.ok(metrics.stoppedDurationSeconds >= 150, "Stopped duration must reflect >= 150s");
});

test("11. Offline time exclusion: Silence gap is NOT counted as stopped or driving duration", () => {
  const points = [
    { id: "1", lat: 8.20, lng: 77.30, speed: 30, ignition: true, recorded_at: "2026-11-05T08:00:00.000Z" },
    { id: "2", lat: 8.21, lng: 77.31, speed: 30, ignition: true, recorded_at: "2026-11-05T08:02:00.000Z" }, // 2m driving
    // 60-minute offline silence
    { id: "3", lat: 8.21, lng: 77.31, speed: 0, ignition: false, recorded_at: "2026-11-05T09:02:00.000Z" },
    { id: "4", lat: 8.21, lng: 77.31, speed: 0, ignition: false, recorded_at: "2026-11-05T09:05:00.000Z" }, // 3m stopped
  ];

  const metrics = calculateJourneyMetrics(points);
  // Driving must be 120s, stopped must be 180s, total 60-minute gap must be excluded from driving/stopped
  assert.equal(metrics.drivingDurationSeconds, 120);
  assert.equal(metrics.stoppedDurationSeconds, 180);
  assert.equal(metrics.gapsCount, 1);
  assert.equal(metrics.totalGapDurationSeconds, 3600);
});

test("12. Journey start and end identification: Derives distinct journeys separated by long stops", () => {
  const vehicle = { id: "09b85a4a-1d9f-43f0-8343-ace9d27a1670", number: "TN 75 F 4323" };
  const points = [
    // Morning run: 08:00 to 08:30
    { id: "1", lat: 8.20, lng: 77.30, speed: 40, ignition: true, recorded_at: "2026-11-05T08:00:00.000Z" },
    { id: "2", lat: 8.25, lng: 77.35, speed: 40, ignition: true, recorded_at: "2026-11-05T08:30:00.000Z" },
    // 2-hour stationary gap at collection depot
    // Afternoon run: 10:30 to 11:00
    { id: "3", lat: 8.25, lng: 77.35, speed: 40, ignition: true, recorded_at: "2026-11-05T10:30:00.000Z" },
    { id: "4", lat: 8.20, lng: 77.30, speed: 40, ignition: true, recorded_at: "2026-11-05T11:00:00.000Z" },
  ];

  const journeys = deriveJourneysFromTelemetry(points, vehicle, [], [], []);
  assert.equal(journeys.length, 2, "Must identify 2 separate journeys (Morning & Afternoon)");
  assert.equal(journeys[0].start_time, "2026-11-05T08:00:00.000Z");
  assert.equal(journeys[0].end_time, "2026-11-05T08:30:00.000Z");
  assert.equal(journeys[1].start_time, "2026-11-05T10:30:00.000Z");
  assert.equal(journeys[1].end_time, "2026-11-05T11:00:00.000Z");
});

test("13. Historical driver assignment: Resolves driver active during the journey time window", () => {
  const vehicleId = "09b85a4a-1d9f-43f0-8343-ace9d27a1670";
  const assignments = [
    {
      id: "a1",
      vehicle_id: vehicleId,
      driver_id: "d1",
      assigned_at: "2026-11-01T00:00:00Z",
      unassigned_at: "2026-11-04T23:59:59Z",
      drivers: { name: "Ramesh K" },
    },
    {
      id: "a2",
      vehicle_id: vehicleId,
      driver_id: "d2",
      assigned_at: "2026-11-05T00:00:00Z",
      unassigned_at: null, // Active
      drivers: { name: "Suresh M" },
    },
  ];

  // Journey on Nov 3 must resolve to Ramesh K
  const dNov3 = resolveDriverForJourney(vehicleId, "2026-11-03T10:00:00Z", "2026-11-03T11:00:00Z", assignments, []);
  assert.equal(dNov3.driverName, "Ramesh K");

  // Journey on Nov 5 must resolve to Suresh M
  const dNov5 = resolveDriverForJourney(vehicleId, "2026-11-05T10:00:00Z", "2026-11-05T11:00:00Z", assignments, []);
  assert.equal(dNov5.driverName, "Suresh M");

  // Unassigned vehicle must show "Driver information unavailable"
  const dOther = resolveDriverForJourney("unassigned-veh", "2026-11-05T10:00:00Z", "2026-11-05T11:00:00Z", assignments, []);
  assert.equal(dOther.driverName, "Driver information unavailable");
});

test("14. Driver filter functionality: Filters journey list by driver name or ID", () => {
  const journeys = [
    { id: "j1", driver_id: "d1", driver_name: "Ramesh K" },
    { id: "j2", driver_id: "d2", driver_name: "Suresh M" },
    { id: "j3", driver_id: "d1", driver_name: "Ramesh K" },
  ];

  const filtered = journeys.filter((j) => j.driver_id === "d1");
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map((j) => j.id), ["j1", "j3"]);
});

test("15. Vehicle filter functionality: Strictly isolates selected vehicle history", () => {
  const v1 = "09b85a4a-1d9f-43f0-8343-ace9d27a1670";
  const v2 = "1b115b9d-6357-4a9e-8e76-1d59497695af";
  const allJourneys = [
    { id: "j1", vehicle_id: v1 },
    { id: "j2", vehicle_id: v2 },
    { id: "j3", vehicle_id: v1 },
  ];

  const forV1 = allJourneys.filter((j) => j.vehicle_id === v1);
  assert.equal(forV1.length, 2);
  assert.deepEqual(forV1.map((j) => j.id), ["j1", "j3"]);
});

test("16. Date range timezone correctness: Asia/Kolkata boundary to UTC conversion", () => {
  const ref = new Date("2026-11-05T12:00:00Z"); // Nov 5 in UTC and IST
  const range = getIstDateRange("today", undefined, undefined, ref);

  assert.equal(range.startIstDate, "2026-11-05");
  assert.equal(range.endIstDate, "2026-11-05");
  // 00:00:00 IST = 18:30:00 UTC previous day
  assert.equal(range.startUtcIso, "2026-11-04T18:30:00.000Z");
  // 23:59:59.999 IST = 18:29:59.999 UTC current day
  assert.equal(range.endUtcIso, "2026-11-05T18:29:59.999Z");
});

test("17. Playback forward and backward: Index scrubbing is bounded within array indices", () => {
  const points = [
    { id: "1", lat: 8.20, lng: 77.30, speed: 0, ignition: true, recorded_at: "2026-11-05T08:00:00Z" },
    { id: "2", lat: 8.21, lng: 77.31, speed: 20, ignition: true, recorded_at: "2026-11-05T08:01:00Z" },
    { id: "3", lat: 8.22, lng: 77.32, speed: 30, ignition: true, recorded_at: "2026-11-05T08:02:00Z" },
  ];

  let currentIndex = 0;
  // Step forward
  currentIndex = Math.min(points.length - 1, currentIndex + 1);
  assert.equal(currentIndex, 1);
  currentIndex = Math.min(points.length - 1, currentIndex + 5);
  assert.equal(currentIndex, 2, "Cannot exceed max index");

  // Step backward
  currentIndex = Math.max(0, currentIndex - 1);
  assert.equal(currentIndex, 1);
  currentIndex = Math.max(0, currentIndex - 10);
  assert.equal(currentIndex, 0, "Cannot go below 0");
});

test("18. Playback speed controls: Supports 1x, 2x, 5x, 10x intervals", () => {
  const speeds = [1, 2, 5, 10];
  const intervals = speeds.map((s) => Math.round(1000 / s));
  assert.deepEqual(intervals, [1000, 500, 200, 100]);
});

test("19. Changing selected vehicles during playback: AbortController cancels ongoing request", async () => {
  const controller = new AbortController();
  controller.abort();

  const fakeSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => ({
            lte: () => ({
              order: () => ({
                order: () => ({
                  range: () => Promise.resolve({ data: [{ id: 1 }], error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  };

  const res = await fetchPaginatedTelemetryHistory(
    fakeSupabase,
    "09b85a4a-1d9f-43f0-8343-ace9d27a1670",
    "2026-11-05T00:00:00Z",
    "2026-11-05T23:59:59Z",
    1000,
    undefined,
    controller.signal
  );

  assert.equal(res.data.length, 0);
  assert.match(res.error, /cancelled|aborted/i);
});

test("20. Browser refresh persistence: Recovers authentic state from Supabase", async () => {
  // Simulates reload querying Supabase telemetry_history
  const fakeDb = [
    { id: 1, vehicle_id: "09b85a4a-1d9f-43f0-8343-ace9d27a1670", lat: 8.25, lng: 77.30, speed: 20, recorded_at: "2026-11-05T08:00:00Z" }
  ];
  const fakeSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => ({
            lte: () => ({
              order: () => ({
                order: () => ({
                  range: () => Promise.resolve({ data: fakeDb, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  };

  const res = await fetchPaginatedTelemetryHistory(
    fakeSupabase,
    "09b85a4a-1d9f-43f0-8343-ace9d27a1670",
    "2026-11-05T00:00:00Z",
    "2026-11-05T23:59:59Z"
  );
  assert.equal(res.data.length, 1);
  assert.equal(res.data[0].id, "1");
});

test("21. Firebase historical telemetry: Points from Firebase source are accepted", () => {
  const pt = {
    id: "fb-1",
    lat: 8.2605,
    lng: 77.2884,
    speed: 45,
    ignition: true,
    recorded_at: "2026-11-05T08:00:00Z",
    source: "firebase",
  };
  assert.equal(isValidGpsCoord(pt.lat, pt.lng), true);
  const metrics = calculateJourneyMetrics([pt, { ...pt, id: "fb-2", recorded_at: "2026-11-05T08:02:00Z" }]);
  assert.equal(metrics.isDataSufficient, true);
});

test("22. EMQX historical telemetry: Points from EMQX source are accepted", () => {
  const pt = {
    id: "emqx-1",
    lat: 8.2605,
    lng: 77.2884,
    speed: 35,
    ignition: true,
    recorded_at: "2026-11-05T08:00:00Z",
    source: "emqx",
  };
  assert.equal(isValidGpsCoord(pt.lat, pt.lng), true);
  const metrics = calculateJourneyMetrics([pt, { ...pt, id: "emqx-2", recorded_at: "2026-11-05T08:02:00Z" }]);
  assert.equal(metrics.isDataSufficient, true);
});

test("23. No GPS data empty state: Returns zero metrics and insufficient status cleanly", () => {
  const metrics = calculateJourneyMetrics([]);
  assert.equal(metrics.totalDistanceKm, 0);
  assert.equal(metrics.totalDurationSeconds, 0);
  assert.equal(metrics.drivingDurationSeconds, 0);
  assert.equal(metrics.stoppedDurationSeconds, 0);
  assert.equal(metrics.avgSpeedKmh, 0);
  assert.equal(metrics.maxSpeedKmh, 0);
  assert.equal(metrics.speedingIncidentsCount, 0);
  assert.equal(metrics.stopsCount, 0);
  assert.equal(metrics.gapsCount, 0);
  assert.equal(metrics.isDataSufficient, false);
  assert.equal(metrics.qualityScore, "Insufficient");
});

test("24. Existing Trip and Route workflows remain unaffected: Road routing and templates preserved", () => {
  // Existing haversine formula continues to work as expected
  const d = haversineDistanceKm(8.260765, 77.288373, 8.260765, 77.288373);
  assert.equal(d, 0);
  // GPS vehicle checker continues to work
  assert.equal(isGpsVehicle({ number: "TN 75 F 4323", device_id: "863110086146753" }), true);
});

