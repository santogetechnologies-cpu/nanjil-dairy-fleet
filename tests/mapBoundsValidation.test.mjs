import test from "node:test";
import assert from "node:assert/strict";
import { isValidFleetCoord, NANJIL_DAIRY_DEPOT } from "../src/components/maps/mapConstants.ts";
import { KNOWN_NANJIL_DEVICE_MAP } from "../src/lib/vehicle-stop-detection.ts";
import { isFleetOperatingCoordinate } from "../src/lib/tripHistoryEngine.ts";

/**
 * Pure simulation of the bounds & center calculation algorithm implemented in GoogleVehicleMap.tsx
 */
function calculateMapTarget({
  selectedId,
  vehicles,
  todayRoutes,
  plantConnectors,
  directionsConnectors = {},
}) {
  const match = vehicles.find((v) => v.id === selectedId || v.deviceId === selectedId);
  if (!match) return { action: "none" };

  const cleanDev = match.deviceId ? match.deviceId.replace(/^device_/, "") : undefined;
  const segs =
    todayRoutes?.[match.id] ||
    (match.deviceId ? todayRoutes?.[match.deviceId] : undefined) ||
    (cleanDev ? todayRoutes?.[cleanDev] : undefined) ||
    (cleanDev ? todayRoutes?.[`device_${cleanDev}`] : undefined) ||
    (cleanDev && KNOWN_NANJIL_DEVICE_MAP[cleanDev] ? todayRoutes?.[KNOWN_NANJIL_DEVICE_MAP[cleanDev].id] : undefined);

  const connPts =
    directionsConnectors[match.id] ||
    (match.deviceId ? directionsConnectors[match.deviceId] : undefined) ||
    (cleanDev ? directionsConnectors[cleanDev] : undefined) ||
    plantConnectors?.[match.id]?.[0] ||
    (match.deviceId ? plantConnectors?.[match.deviceId]?.[0] : undefined) ||
    (cleanDev ? plantConnectors?.[cleanDev]?.[0] : undefined);

  const validPoints = [];

  // 1. Current position
  if (isValidFleetCoord({ lat: match.lat, lng: match.lng })) {
    validPoints.push({ lat: Number(match.lat), lng: Number(match.lng) });
  }

  // 2. Travelled route points
  if (segs && Array.isArray(segs)) {
    segs.forEach((seg) => {
      if (Array.isArray(seg)) {
        seg.forEach((pt) => {
          if (isValidFleetCoord(pt)) {
            validPoints.push({ lat: Number(pt.lat), lng: Number(pt.lng) });
          }
        });
      }
    });
  }

  // 3. Include Nanjil Dairy Plant and connector points ONLY when displaying its relevant connector
  const hasValidConnector = Boolean(connPts && Array.isArray(connPts) && connPts.length >= 2);
  if (hasValidConnector) {
    if (isValidFleetCoord(NANJIL_DAIRY_DEPOT)) {
      validPoints.push(NANJIL_DAIRY_DEPOT);
    }
    connPts.forEach((pt) => {
      if (isValidFleetCoord(pt)) {
        validPoints.push({ lat: Number(pt.lat), lng: Number(pt.lng) });
      }
    });
  }

  if (validPoints.length === 0) {
    return { action: "setCenter", center: NANJIL_DAIRY_DEPOT, zoom: 14, pointCount: 0 };
  }

  if (validPoints.length === 1) {
    return { action: "setCenter", center: validPoints[0], zoom: 15, pointCount: 1 };
  }

  let minLat = validPoints[0].lat;
  let maxLat = validPoints[0].lat;
  let minLng = validPoints[0].lng;
  let maxLng = validPoints[0].lng;

  for (let i = 1; i < validPoints.length; i++) {
    const p = validPoints[i];
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  const spanLat = maxLat - minLat;
  const spanLng = maxLng - minLng;

  if (spanLat < 0.002 && spanLng < 0.002) {
    return {
      action: "setCenter",
      center: { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 },
      zoom: 15,
      pointCount: validPoints.length,
      spanLat,
      spanLng,
    };
  }

  return {
    action: "fitBounds",
    bounds: { south: minLat, north: maxLat, west: minLng, east: maxLng },
    pointCount: validPoints.length,
    spanLat,
    spanLng,
  };
}

test("1. Coordinate Validation: Rejects (0, 0) Null Island and near-zero coordinates", () => {
  assert.equal(isValidFleetCoord({ lat: 0, lng: 0 }), false);
  assert.equal(isValidFleetCoord({ lat: 0.00001, lng: 0.00001 }), false);
  assert.equal(isValidFleetCoord({ lat: -0.0001, lng: -0.0001 }), false);
  assert.equal(isValidFleetCoord({ lat: 0, lng: 77.2883 }), false);
  assert.equal(isValidFleetCoord({ lat: 8.2607, lng: 0 }), false);
});

test("2. Coordinate Validation: Detects and rejects accidentally swapped latitude and longitude", () => {
  // Swapped: Lat ~ 77.28, Lng ~ 8.26 (Lat > 50 && Lng < 25)
  assert.equal(isValidFleetCoord({ lat: 77.2883, lng: 8.2607 }), false);
  assert.equal(isValidFleetCoord({ lat: 77.4426, lng: 8.2415 }), false);
  assert.equal(isValidFleetCoord({ lat: 80.1234, lng: 13.0456 }), false);
});

test("3. Coordinate Validation: Rejects hardware corruption / Africa glitches", () => {
  // Longitude dropped degree prefix: e.g. 0.2883 instead of 77.2883
  assert.equal(isValidFleetCoord({ lat: 8.2607, lng: 0.2883 }), false);
  assert.equal(isValidFleetCoord({ lat: 8.2607, lng: 12.5000 }), false);
  assert.equal(isValidFleetCoord({ lat: 8.2607, lng: 140.0000 }), false);
});

test("4. Coordinate Validation: Rejects null, undefined, NaN, and non-finite values", () => {
  assert.equal(isValidFleetCoord(null), false);
  assert.equal(isValidFleetCoord(undefined), false);
  assert.equal(isValidFleetCoord({ lat: null, lng: 77.2883 }), false);
  assert.equal(isValidFleetCoord({ lat: 8.2607, lng: undefined }), false);
  assert.equal(isValidFleetCoord({ lat: NaN, lng: 77.2883 }), false);
  assert.equal(isValidFleetCoord({ lat: 8.2607, lng: Infinity }), false);
  assert.equal(isValidFleetCoord("8.2607, 77.2883"), false);
});

test("5. Coordinate Validation: Accepts authentic Nanjil Dairy operational coordinates in Tamil Nadu", () => {
  // Nanjil Dairy Plant, Mulagumoodu
  assert.equal(isValidFleetCoord(NANJIL_DAIRY_DEPOT), true);
  assert.equal(isValidFleetCoord({ lat: 8.260765, lng: 77.288373 }), true);
  // Nagercoil
  assert.equal(isValidFleetCoord({ lat: 8.1833, lng: 77.4119 }), true);
  // Kanyakumari
  assert.equal(isValidFleetCoord({ lat: 8.0883, lng: 77.5385 }), true);
  // Tirunelveli
  assert.equal(isValidFleetCoord({ lat: 8.7139, lng: 77.7567 }), true);
  // Marthandam
  assert.equal(isValidFleetCoord({ lat: 8.3056, lng: 77.2217 }), true);
});

test("6. Auto-Fit Bounds: Single location uses setCenter() + zoom 15 instead of fitBounds()", () => {
  const result = calculateMapTarget({
    selectedId: "v-1",
    vehicles: [
      { id: "v-1", number: "TN 75 S 9826", lat: 8.5177, lng: 77.8580 },
    ],
    todayRoutes: {},
    plantConnectors: {},
  });

  // Requirement: "If only one valid location exists, use setCenter() and an appropriate zoom level instead of fitBounds()"
  assert.equal(result.action, "setCenter");
  assert.equal(result.zoom, 15);
  assert.equal(result.center.lat, 8.5177);
  assert.equal(result.center.lng, 77.8580);
});

test("7. Auto-Fit Bounds: Clustered points (< 200m) uses setCenter() + zoom 15 instead of fitBounds()", () => {
  const result = calculateMapTarget({
    selectedId: "v-1",
    vehicles: [
      { id: "v-1", number: "TN 75 S 9826", lat: 8.2607, lng: 77.2883 },
    ],
    todayRoutes: {
      "v-1": [
        [
          { lat: 8.2607, lng: 77.2883 },
          { lat: 8.2608, lng: 77.2884 },
          { lat: 8.26075, lng: 77.28835 },
        ],
      ],
    },
    plantConnectors: {},
  });

  assert.equal(result.action, "setCenter");
  assert.equal(result.zoom, 15);
  assert.ok(result.spanLat < 0.002);
  assert.ok(result.spanLng < 0.002);
});

test("8. Auto-Fit Bounds: Nanjil Dairy Depot included ONLY when connector is present", () => {
  // Vehicle away from plant without connector: bounds must NOT include depot
  const withoutConn = calculateMapTarget({
    selectedId: "v-1",
    vehicles: [
      { id: "v-1", number: "TN 75 S 9826", lat: 8.5177, lng: 77.8580 },
    ],
    todayRoutes: {
      "v-1": [
        [
          { lat: 8.5177, lng: 77.8580 },
          { lat: 8.5250, lng: 77.8650 },
        ],
      ],
    },
    plantConnectors: {},
  });

  assert.equal(withoutConn.action, "fitBounds");
  // West boundary should be around 77.858, NOT 77.288 (depot)
  assert.ok(withoutConn.bounds.west > 77.80);
  assert.ok(withoutConn.bounds.south > 8.50);

  // Vehicle with connector: bounds MUST include depot
  const withConn = calculateMapTarget({
    selectedId: "v-1",
    vehicles: [
      { id: "v-1", number: "TN 75 S 9826", lat: 8.5177, lng: 77.8580 },
    ],
    todayRoutes: {
      "v-1": [
        [
          { lat: 8.5177, lng: 77.8580 },
          { lat: 8.5250, lng: 77.8650 },
        ],
      ],
    },
    plantConnectors: {
      "v-1": [
        [
          { lat: NANJIL_DAIRY_DEPOT.lat, lng: NANJIL_DAIRY_DEPOT.lng },
          { lat: 8.5177, lng: 77.8580 },
        ],
      ],
    },
  });

  assert.equal(withConn.action, "fitBounds");
  // Bounds now expands to encompass depot
  assert.ok(withConn.bounds.west <= NANJIL_DAIRY_DEPOT.lng);
  assert.ok(withConn.bounds.south <= NANJIL_DAIRY_DEPOT.lat);
});

test("9. Auto-Fit Bounds: Unrelated vehicles are strictly excluded from selected vehicle bounds", () => {
  const result = calculateMapTarget({
    selectedId: "v-1",
    vehicles: [
      { id: "v-1", number: "TN 75 S 9826", lat: 8.2607, lng: 77.2883 },
      { id: "v-2", number: "TN 75 F 4323", lat: 8.7139, lng: 77.7567 }, // far away vehicle
    ],
    todayRoutes: {
      "v-1": [
        [
          { lat: 8.2607, lng: 77.2883 },
          { lat: 8.2700, lng: 77.2950 },
        ],
      ],
      "v-2": [
        [
          { lat: 8.7139, lng: 77.7567 },
          { lat: 8.7300, lng: 77.7700 },
        ],
      ],
    },
    plantConnectors: {},
  });

  assert.equal(result.action, "fitBounds");
  // Bounds must be tight around v-1 (~8.26, 77.28), NOT including v-2 (~8.71, 77.75)
  assert.ok(result.bounds.north < 8.30);
  assert.ok(result.bounds.east < 77.35);
});

test("10. Fleet Vehicles Suite: Tests bounds for all 7 registered Nanjil Dairy GPS vehicles", () => {
  const sampleVehicleCoordinates = {
    "863110086146753": { lat: 8.2609, lng: 77.2880 }, // TN 75 F 4323
    "863110086146985": { lat: 8.5177, lng: 77.8580 }, // TN 75 S 9826
    "863110086150292": { lat: 8.2415, lng: 77.4326 }, // TN 75 R 9952
    "863110086162107": { lat: 8.2607, lng: 77.2883 }, // TN 75 S 1688
    "863110086164111": { lat: 8.1833, lng: 77.4119 }, // TN 75 BF 0320
    "863110086186932": { lat: 8.3056, lng: 77.2217 }, // TN 75 M 0041
    "863110086192104": { lat: 8.0883, lng: 77.5385 }, // TN 75 BC 2219
  };

  const vehicleList = Object.entries(KNOWN_NANJIL_DEVICE_MAP).map(([devId, meta]) => ({
    id: meta.id,
    number: meta.number,
    deviceId: devId,
    lat: sampleVehicleCoordinates[devId].lat,
    lng: sampleVehicleCoordinates[devId].lng,
    status: "Moving",
  }));

  assert.equal(vehicleList.length, 7);

  vehicleList.forEach((v) => {
    // 1. Verify coordinate validity
    assert.equal(isValidFleetCoord({ lat: v.lat, lng: v.lng }), true, `${v.number} coordinate must be valid`);
    assert.equal(isFleetOperatingCoordinate(v.lat, v.lng), true, `${v.number} must be within fleet operating zone`);

    // 2. Verify target calculation without route (single point)
    const targetSingle = calculateMapTarget({
      selectedId: v.id,
      vehicles: vehicleList,
      todayRoutes: {},
      plantConnectors: {},
    });
    assert.equal(targetSingle.action, "setCenter", `${v.number} with single point must use setCenter`);
    assert.equal(targetSingle.zoom, 15, `${v.number} zoom must be 15`);
    assert.equal(targetSingle.center.lat, v.lat);
    assert.equal(targetSingle.center.lng, v.lng);

    // 3. Verify target calculation with multi-point route
    const targetWithRoute = calculateMapTarget({
      selectedId: v.id,
      vehicles: vehicleList,
      todayRoutes: {
        [v.id]: [
          [
            { lat: v.lat, lng: v.lng },
            { lat: v.lat + 0.015, lng: v.lng + 0.015 },
          ],
        ],
      },
      plantConnectors: {},
    });
    assert.equal(targetWithRoute.action, "fitBounds", `${v.number} with route must fit bounds`);
    assert.ok(targetWithRoute.bounds.south >= 8.0 && targetWithRoute.bounds.north <= 9.0, `${v.number} bounds in TN`);
    assert.ok(targetWithRoute.bounds.west >= 77.0 && targetWithRoute.bounds.east <= 78.5, `${v.number} bounds in TN`);
  });
});
