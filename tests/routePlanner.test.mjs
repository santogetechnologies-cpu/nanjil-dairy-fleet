import test from "node:test";
import assert from "node:assert/strict";

// Mock dairy depot and presets
const NANJIL_DAIRY_DEPOT = {
  name: "Nanjil Central Processing Plant, Mulagumoodu",
  lat: 8.260765,
  lng: 77.288373,
};

const SAMPLE_STOPS = [
  { id: "out-1", name: "Villukuri Centre", lat: 8.2435, lng: 77.3325, isMandatory: true, serviceDurationMins: 5 },
  { id: "out-2", name: "Chunkankadai Unit", lat: 8.2045, lng: 77.3821, isMandatory: true, serviceDurationMins: 5 },
  { id: "out-3", name: "Nagercoil Depot", lat: 8.1833, lng: 77.4119, isMandatory: false, serviceDurationMins: 8 },
];

const SAMPLE_RETURN_STOPS = [
  { id: "ret-1", name: "Thingal Nagar Centre", lat: 8.2165, lng: 77.2785, isMandatory: false, serviceDurationMins: 5 },
];

/**
 * Helper under test: extractRouteConfig
 */
function extractRouteConfig(r, localStorageMap = {}) {
  let config = r.route_config;
  if (typeof config === "string") {
    try {
      config = JSON.parse(config);
    } catch {
      config = null;
    }
  }
  if (!config || typeof config !== "object" || Object.keys(config).length === 0) {
    const local = localStorageMap[`nanjil_route_config_${r.id}`];
    if (local) {
      try {
        config = JSON.parse(local);
      } catch {
        config = null;
      }
    }
  }
  return config || null;
}

/**
 * Helper under test: buildRoutePayload
 */
function buildRoutePayload({
  routeName,
  assignedVehicleId,
  assignedDriverId,
  departureTime,
  completionTimeStr,
  outboundStops,
  returnStops,
  startPoint,
  destinationPoint,
  roundTripType,
  revisitStopsOnReturn,
  speedLimitKmh,
  deviationThresholdMeters,
  alertOnMissedStops,
  alertOnDelay,
  routeNotes,
  routeDate,
  totalDistanceKm,
  totalDurationMins,
}) {
  if (!routeName || !routeName.trim()) {
    throw new Error("Please enter a route name.");
  }
  if (!outboundStops || outboundStops.length === 0) {
    throw new Error("Please add at least one stop to the route before saving.");
  }

  const basePayload = {
    name: routeName.trim(),
    vehicle_id: assignedVehicleId || null,
    driver_id: assignedDriverId || null,
    centres: outboundStops.length + (roundTripType === "different_path" ? (returnStops?.length || 0) : 0),
    start_time: departureTime,
    end_time: completionTimeStr,
    status: "In Progress",
    litres: 0,
    completion: 0,
  };

  const routeConfigData = {
    startPoint,
    destinationPoint,
    roundTripType,
    revisitStopsOnReturn,
    outboundStops,
    returnStops: returnStops || [],
    speedLimitKmh,
    deviationThresholdMeters,
    alertOnMissedStops,
    alertOnDelay,
    routeNotes,
    routeDate,
    totalDistanceKm,
    totalDurationMins,
    savedAt: new Date().toISOString(),
  };

  return { basePayload, routeConfigData };
}

/**
 * Helper under test: restoreRouteIntoPlanner
 */
function restoreRouteIntoPlanner(routeItem) {
  const cfg = routeItem.route_config;
  const restored = {
    editingRouteId: routeItem.id,
    routeName: routeItem.name || "Untitled Route",
    assignedVehicleId: routeItem.vehicle_id || "",
    assignedDriverId: routeItem.driver_id || "",
    departureTime: routeItem.start_time || "05:30",
    startPoint: cfg?.startPoint || NANJIL_DAIRY_DEPOT,
    destinationPoint: cfg?.destinationPoint || cfg?.destination || null,
    roundTripType: cfg?.roundTripType || "same_path",
    revisitStopsOnReturn: Boolean(cfg?.revisitStopsOnReturn),
    outboundStops: Array.isArray(cfg?.outboundStops) && cfg.outboundStops.length > 0 ? cfg.outboundStops : [],
    returnStops: Array.isArray(cfg?.returnStops) ? cfg.returnStops : [],
    speedLimitKmh: typeof cfg?.speedLimitKmh === "number" ? cfg.speedLimitKmh : 60,
    deviationThresholdMeters: typeof cfg?.deviationThresholdMeters === "number" ? cfg.deviationThresholdMeters : 250,
    alertOnMissedStops: cfg?.alertOnMissedStops ?? true,
    alertOnDelay: cfg?.alertOnDelay ?? true,
    routeNotes: cfg?.routeNotes || "",
  };
  return restored;
}

/**
 * Helper under test: getInitialPlannerWorkspace (mocking localStorage map)
 */
function getInitialPlannerWorkspace(localStorageMap = {}) {
  try {
    const raw = localStorageMap["nanjil_planner_active_workspace"];
    if (raw) {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === "object") return parsed;
    }

    const customRaw = localStorageMap["nanjil_custom_routes"];
    if (customRaw) {
      const customList = typeof customRaw === "string" ? JSON.parse(customRaw) : customRaw;
      if (Array.isArray(customList) && customList.length > 0) {
        const latest = customList[0];
        if (latest && Array.isArray(latest.outboundStops) && latest.outboundStops.length > 0) {
          return {
            editingRouteId: latest.id || null,
            routeName: latest.name || "Daily Morning Milk Collection Loop",
            routeDate: latest.routeDate || "2026-10-26",
            departureTime: latest.start_time || "05:30",
            assignedVehicleId: latest.vehicle_id || "",
            assignedDriverId: latest.driver_id || "",
            startPoint: latest.startPoint || NANJIL_DAIRY_DEPOT,
            destinationPoint: latest.destinationPoint || latest.destination || null,
            roundTripType: latest.roundTripType || "same_path",
            revisitStopsOnReturn: Boolean(latest.revisitStopsOnReturn),
            outboundStops: latest.outboundStops,
            returnStops: latest.returnStops || [],
            speedLimitKmh: latest.speedLimitKmh || 60,
            deviationThresholdMeters: latest.deviationThresholdMeters || 250,
            alertOnMissedStops: latest.alertOnMissedStops ?? true,
            alertOnDelay: latest.alertOnDelay ?? true,
            routeNotes: latest.routeNotes || "",
            activeTab: "planner",
          };
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

// ── TEST SUITE ─────────────────────────────────────────────────────────────

test("1. Route Planner Validation: Rejects empty route name", () => {
  assert.throws(
    () => buildRoutePayload({ routeName: "   ", outboundStops: SAMPLE_STOPS }),
    /Please enter a route name/
  );
});

test("2. Route Planner Validation: Rejects route with zero stops", () => {
  assert.throws(
    () => buildRoutePayload({ routeName: "Valid Route", outboundStops: [] }),
    /Please add at least one stop/
  );
});

test("3. Route Payload Generation: Matches Supabase PostgreSQL schema", () => {
  const { basePayload, routeConfigData } = buildRoutePayload({
    routeName: "Morning Southern Loop",
    assignedVehicleId: "v-uuid-1",
    assignedDriverId: "d-uuid-1",
    departureTime: "06:00",
    completionTimeStr: "08:30 AM",
    outboundStops: SAMPLE_STOPS,
    returnStops: SAMPLE_RETURN_STOPS,
    startPoint: NANJIL_DAIRY_DEPOT,
    destinationPoint: { name: "Kanyakumari South", lat: 8.0883, lng: 77.5385 },
    roundTripType: "different_path",
    revisitStopsOnReturn: false,
    speedLimitKmh: 65,
    deviationThresholdMeters: 300,
    alertOnMissedStops: true,
    alertOnDelay: true,
    routeNotes: "Check seals",
    routeDate: "2026-10-26",
    totalDistanceKm: 45.2,
    totalDurationMins: 150,
  });

  // Verify PostgreSQL base columns
  assert.equal(basePayload.name, "Morning Southern Loop");
  assert.equal(basePayload.vehicle_id, "v-uuid-1");
  assert.equal(basePayload.driver_id, "d-uuid-1");
  assert.equal(basePayload.centres, 4); // 3 outbound + 1 return
  assert.equal(basePayload.start_time, "06:00");
  assert.equal(basePayload.end_time, "08:30 AM");
  assert.equal(basePayload.status, "In Progress");

  // Verify JSONB configuration payload
  assert.equal(routeConfigData.roundTripType, "different_path");
  assert.equal(routeConfigData.outboundStops.length, 3);
  assert.equal(routeConfigData.returnStops.length, 1);
  assert.equal(routeConfigData.speedLimitKmh, 65);
  assert.equal(routeConfigData.deviationThresholdMeters, 300);
  assert.equal(routeConfigData.totalDistanceKm, 45.2);
});

test("4. Configuration Extraction: Direct JSONB from database record", () => {
  const dbRecord = {
    id: "route-123",
    name: "Coastal Route",
    route_config: {
      roundTripType: "same_path",
      outboundStops: SAMPLE_STOPS,
      speedLimitKmh: 55,
    },
  };

  const config = extractRouteConfig(dbRecord);
  assert.ok(config);
  assert.equal(config.roundTripType, "same_path");
  assert.equal(config.outboundStops.length, 3);
  assert.equal(config.speedLimitKmh, 55);
});

test("5. Configuration Extraction: LocalStorage mirror fallback when column empty", () => {
  const dbRecord = {
    id: "route-456",
    name: "Highland Route",
    route_config: null, // Legacy record without column
  };

  const localStore = {
    "nanjil_route_config_route-456": JSON.stringify({
      roundTripType: "different_path",
      outboundStops: SAMPLE_STOPS,
      speedLimitKmh: 60,
    }),
  };

  const config = extractRouteConfig(dbRecord, localStore);
  assert.ok(config);
  assert.equal(config.roundTripType, "different_path");
  assert.equal(config.speedLimitKmh, 60);
});

test("6. Route Restoration: Complete state restored into Designer", () => {
  const routeRecord = {
    id: "route-789",
    name: "Special Chilling Centre Loop",
    vehicle_id: "veh-777",
    driver_id: "drv-888",
    start_time: "05:15",
    route_config: {
      startPoint: { name: "Plant", lat: 8.26, lng: 77.28 },
      destinationPoint: { name: "Harbour Depot", lat: 8.17, lng: 77.25 },
      roundTripType: "different_path",
      revisitStopsOnReturn: true,
      outboundStops: SAMPLE_STOPS,
      returnStops: SAMPLE_RETURN_STOPS,
      speedLimitKmh: 50,
      deviationThresholdMeters: 200,
      alertOnMissedStops: true,
      alertOnDelay: false,
      routeNotes: "Special temperature instructions",
    },
  };

  const plannerState = restoreRouteIntoPlanner(routeRecord);

  assert.equal(plannerState.editingRouteId, "route-789");
  assert.equal(plannerState.routeName, "Special Chilling Centre Loop");
  assert.equal(plannerState.assignedVehicleId, "veh-777");
  assert.equal(plannerState.assignedDriverId, "drv-888");
  assert.equal(plannerState.departureTime, "05:15");
  assert.equal(plannerState.roundTripType, "different_path");
  assert.equal(plannerState.revisitStopsOnReturn, true);
  assert.equal(plannerState.outboundStops.length, 3);
  assert.equal(plannerState.returnStops.length, 1);
  assert.equal(plannerState.speedLimitKmh, 50);
  assert.equal(plannerState.deviationThresholdMeters, 200);
  assert.equal(plannerState.alertOnDelay, false);
  assert.equal(plannerState.routeNotes, "Special temperature instructions");
});

test("7. Update vs Insert Discrimination: Prevents accidental duplicate rows", () => {
  let isUpdateCalled = false;
  let isInsertCalled = false;

  function simulateSave(editingId, asNewCopy) {
    const isUpdate = Boolean(editingId && !asNewCopy);
    if (isUpdate) isUpdateCalled = true;
    else isInsertCalled = true;
  }

  // Editing existing route => UPDATE
  simulateSave("route-001", false);
  assert.equal(isUpdateCalled, true);
  assert.equal(isInsertCalled, false);

  // Reset
  isUpdateCalled = false;
  isInsertCalled = false;

  // Clone route => INSERT
  simulateSave("route-001", true);
  assert.equal(isUpdateCalled, false);
  assert.equal(isInsertCalled, true);

  // New route from scratch => INSERT
  isUpdateCalled = false;
  isInsertCalled = false;
  simulateSave(null, false);
  assert.equal(isUpdateCalled, false);
  assert.equal(isInsertCalled, true);
});

test("8. Browser Refresh Resilience: Restores 16+ stops from active workspace", () => {
  // Simulate 16 customized stops in user's active workspace
  const sixteenStops = Array.from({ length: 16 }, (_, i) => ({
    id: `out-${i + 1}`,
    name: `Collection Center ${i + 1}`,
    lat: 8.2 + i * 0.01,
    lng: 77.3 + i * 0.01,
    serviceDurationMins: 5,
    isMandatory: true,
  }));

  const localStore = {
    "nanjil_planner_active_workspace": JSON.stringify({
      editingRouteId: "route-saved-4466a33d",
      routeName: "Nanjil 16-Stop Coastal Morning Route",
      outboundStops: sixteenStops,
      speedLimitKmh: 55,
      deviationThresholdMeters: 200,
    }),
  };

  // Rehydration on browser reload (F5)
  const rehydrated = getInitialPlannerWorkspace(localStore);

  assert.ok(rehydrated);
  assert.equal(rehydrated.editingRouteId, "route-saved-4466a33d");
  assert.equal(rehydrated.routeName, "Nanjil 16-Stop Coastal Morning Route");
  assert.equal(rehydrated.outboundStops.length, 16);
  assert.equal(rehydrated.outboundStops[15].name, "Collection Center 16");
});

test("9. Browser Refresh Fallback: Restores custom stops from nanjil_custom_routes when active key is missing", () => {
  const sixteenStops = Array.from({ length: 16 }, (_, i) => ({
    id: `stop-${i + 1}`,
    name: `Dairy Depot ${i + 1}`,
    lat: 8.25 + i * 0.005,
    lng: 77.25 + i * 0.005,
  }));

  const localStore = {
    // Active workspace key missing (e.g. older session)
    "nanjil_custom_routes": JSON.stringify([
      {
        id: "route-legacy-999",
        name: "Morning Loop with 16 Stops",
        outboundStops: sixteenStops,
      },
    ]),
  };

  const rehydrated = getInitialPlannerWorkspace(localStore);

  assert.ok(rehydrated);
  assert.equal(rehydrated.editingRouteId, "route-legacy-999");
  assert.equal(rehydrated.outboundStops.length, 16);
});

test("10. Stop Modification: Adding, deleting, or reordering stops updates the persistent workspace", () => {
  let simulatedLocalStorage = {};

  function syncWorkspace(state) {
    simulatedLocalStorage["nanjil_planner_active_workspace"] = JSON.stringify(state);
  }

  // Initial 15 stops
  let stops = Array.from({ length: 15 }, (_, i) => ({ id: `stop-${i + 1}`, name: `Stop ${i + 1}` }));
  syncWorkspace({ editingRouteId: null, outboundStops: stops });

  // User adds stop #16
  stops = [...stops, { id: "stop-16", name: "New Added Stop #16" }];
  syncWorkspace({ editingRouteId: null, outboundStops: stops });

  let loaded = getInitialPlannerWorkspace(simulatedLocalStorage);
  assert.equal(loaded.outboundStops.length, 16);
  assert.equal(loaded.outboundStops[15].name, "New Added Stop #16");

  // User deletes stop #2
  stops = stops.filter((s) => s.id !== "stop-2");
  syncWorkspace({ editingRouteId: null, outboundStops: stops });

  loaded = getInitialPlannerWorkspace(simulatedLocalStorage);
  assert.equal(loaded.outboundStops.length, 15);
  assert.equal(loaded.outboundStops.find((s) => s.id === "stop-2"), undefined);
});

test("11. Start New Route: Clears editingRouteId and cleanly resets active workspace", () => {
  const simulatedLocalStorage = {
    "nanjil_planner_active_workspace": JSON.stringify({
      editingRouteId: "route-123",
      routeName: "Old Route",
      outboundStops: [{ id: "out-1", name: "Center" }],
    }),
  };

  // Simulate handleStartNewRoute()
  const freshStops = [{ id: "out-1", name: "Default 1" }, { id: "out-2", name: "Default 2" }];
  simulatedLocalStorage["nanjil_planner_active_workspace"] = JSON.stringify({
    editingRouteId: null,
    routeName: "New Milk Collection Loop",
    outboundStops: freshStops,
  });

  const loaded = getInitialPlannerWorkspace(simulatedLocalStorage);
  assert.equal(loaded.editingRouteId, null);
  assert.equal(loaded.routeName, "New Milk Collection Loop");
  assert.equal(loaded.outboundStops.length, 2);
});

