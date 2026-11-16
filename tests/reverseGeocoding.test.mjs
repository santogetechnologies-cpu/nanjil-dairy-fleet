import test from "node:test";
import assert from "node:assert/strict";
import {
  getGeocodeCacheKey,
  isCoordinateString,
  getCachedLocation,
  saveToGeocodeCache,
  formatAddressHierarchy,
  reverseGeocodeCoordinate,
  getImmediateLocationDisplay,
} from "../src/lib/reverseGeocoding.ts";
import { toFleetCoord } from "../src/components/maps/mapConstants.ts";

test("1. isCoordinateString: Accurately distinguishes raw GPS coordinates from authentic named locations", () => {
  // Raw GPS coordinate strings should return true
  assert.equal(isCoordinateString("8.2607, 77.2877"), true);
  assert.equal(isCoordinateString("8.3473, 77.1106"), true);
  assert.equal(isCoordinateString("8.260735,77.287706"), true);
  assert.equal(isCoordinateString(" 8.2231 , 77.4169 "), true);
  assert.equal(isCoordinateString("8.26, 77.52"), true);

  // Authentic human-readable named locations must return false
  assert.equal(isCoordinateString("Suchindram Distribution Sector"), false);
  assert.equal(isCoordinateString("Monday Market Dairy Centre"), false);
  assert.equal(isCoordinateString("Nagercoil Central Depot Yard"), false);
  assert.equal(isCoordinateString("Chunkankadai Junction"), false);
  assert.equal(isCoordinateString("Colachel Coastal Distribution Base"), false);
  assert.equal(isCoordinateString("Aralvaimozhi Route"), false);
  assert.equal(isCoordinateString("Depot Yard"), false);

  // Edge cases and empty values
  assert.equal(isCoordinateString(""), false);
  assert.equal(isCoordinateString("   "), false);
  assert.equal(isCoordinateString(null), false);
  assert.equal(isCoordinateString(undefined), false);
  assert.equal(isCoordinateString("NaN, NaN"), false);
});

test("2. getGeocodeCacheKey: Rounds GPS coordinates to 3 decimal places (~100m) to group co-located vehicles", () => {
  // Two vehicles parked at Nanjil Central Processing Plant / Mulagumoodu Depot
  const vehicle1Key = getGeocodeCacheKey(8.260735, 77.287706); // TN 75 BC 2219
  const vehicle2Key = getGeocodeCacheKey(8.260778, 77.287839); // TN 75 M 0041
  const vehicle3Key = getGeocodeCacheKey(8.260756, 77.288239); // TN 75 S 1688

  assert.equal(vehicle1Key, "8.261,77.288");
  assert.equal(vehicle2Key, "8.261,77.288");
  assert.equal(vehicle3Key, "8.261,77.288");

  // All three vehicles share the exact same rounded cache key
  assert.equal(vehicle1Key, vehicle2Key);
  assert.equal(vehicle2Key, vehicle3Key);

  // Vehicle in a different location produces a distinct key
  const bf0320Key = getGeocodeCacheKey(8.347316, 77.110624);
  assert.equal(bf0320Key, "8.347,77.111");
  assert.notEqual(bf0320Key, vehicle1Key);
});

test("3. formatAddressHierarchy: Adheres to Locality/Town -> District -> State -> Country hierarchy", () => {
  // Case A: Full address with Locality, State, Country
  const formattedA = formatAddressHierarchy({
    locality: "Nagercoil",
    district: "Kanniyakumari district",
    state: "Tamil Nadu",
    country: "India",
  });
  assert.equal(formattedA, "Nagercoil, Tamil Nadu, India");

  // Case B: Town / Suburb as primary locality
  const formattedB = formatAddressHierarchy({
    town: "Thuckalay",
    district: "Kanniyakumari",
    state: "Tamil Nadu",
    country: "India",
  });
  assert.equal(formattedB, "Thuckalay, Tamil Nadu, India");

  // Case C: Locality is null, falls down hierarchy to District
  const formattedC = formatAddressHierarchy({
    locality: null,
    district: "Kanniyakumari district",
    state: "Tamil Nadu",
    country: "India",
  });
  assert.equal(formattedC, "Kanniyakumari, Tamil Nadu, India");

  // Case D: Both locality and district null, falls down hierarchy to State
  const formattedD = formatAddressHierarchy({
    locality: null,
    district: null,
    state: "Tamil Nadu",
    country: "India",
  });
  assert.equal(formattedD, "Tamil Nadu, India");

  // Case E: Formatting prevents duplicated entries
  const formattedE = formatAddressHierarchy({
    locality: "Tamil Nadu",
    state: "Tamil Nadu",
    country: "India",
  });
  assert.equal(formattedE, "Tamil Nadu, India");

  // Case F: Never outputs "undefined" or "NaN"
  const formattedF = formatAddressHierarchy({
    locality: undefined,
    district: undefined,
    state: undefined,
    country: undefined,
  });
  assert.ok(!formattedF.includes("undefined"));
  assert.ok(!formattedF.includes("NaN"));
});

test("4. getCachedLocation & saveToGeocodeCache: In-memory and persistent caching prevents duplicate requests", () => {
  const lat = 8.2607;
  const lng = 77.2877;
  const key = getGeocodeCacheKey(lat, lng);

  // Save resolved place name
  saveToGeocodeCache(key, "Nagercoil, Tamil Nadu, India");

  // Synchronous retrieval must return the cached place name instantly (0ms)
  const cached = getCachedLocation(lat, lng);
  assert.equal(cached, "Nagercoil, Tamil Nadu, India");

  // Retrieval with slight GPS variation within ~100m must also hit the cache
  const cachedNear = getCachedLocation(8.26074, 77.28772);
  assert.equal(cachedNear, "Nagercoil, Tamil Nadu, India");
});

test("5. reverseGeocodeCoordinate: Graceful fallback and rejection of invalid / Null Island coordinates", async () => {
  // Reject (0, 0) Null Island
  const nullIsland = await reverseGeocodeCoordinate(0, 0, "Depot Yard");
  assert.equal(nullIsland, "Depot Yard");

  // Reject swapped coordinates (outside Indian geofence)
  const swapped = await reverseGeocodeCoordinate(77.2877, 8.2607, "77.2877, 8.2607");
  assert.equal(swapped, "77.2877, 8.2607");

  // Reject NaN / non-finite coordinates
  const nanCoord = await reverseGeocodeCoordinate(NaN, NaN, "Depot Yard");
  assert.equal(nanCoord, "Depot Yard");

  // Return cached value if present
  const lat = 8.3473;
  const lng = 77.1106;
  const key = getGeocodeCacheKey(lat, lng);
  saveToGeocodeCache(key, "Kuzhithurai, Tamil Nadu, India");

  const resolved = await reverseGeocodeCoordinate(lat, lng, "8.3473, 77.1106");
  assert.equal(resolved, "Kuzhithurai, Tamil Nadu, India");
});

test("6. getImmediateLocationDisplay: Preserves named locations and resolves cached coordinates synchronously", () => {
  // Named text location: untouched
  const named1 = getImmediateLocationDisplay("Suchindram Distribution Sector");
  assert.equal(named1, "Suchindram Distribution Sector");

  const named2 = getImmediateLocationDisplay("Monday Market Dairy Centre");
  assert.equal(named2, "Monday Market Dairy Centre");

  // Cached coordinates: returns resolved name synchronously (0ms, non-blocking)
  const cachedDisplay = getImmediateLocationDisplay("8.2607, 77.2877", 8.2607, 77.2877);
  assert.equal(cachedDisplay, "Nagercoil, Tamil Nadu, India");

  // Uncached coordinate string: returns clean coordinate string fallback without undefined or NaN
  const uncachedDisplay = getImmediateLocationDisplay("8.9999, 77.9999", 8.9999, 77.9999);
  assert.equal(uncachedDisplay, "8.9999, 77.9999");
});

test("7. Export Integration: Daily Vehicle Activity report rows contain resolved place names in table and CSV", () => {
  // Simulated report rows as produced by _app.reports.tsx
  const mockVehicles = [
    {
      number: "TN 75 BC 2219",
      driver_name: "Murugan S",
      model: "Eicher Pro 2049",
      type: "Tanker",
      odometer: 48250,
      fuel: 85,
      status: "Idle",
      location: "8.2607, 77.2877",
      lat: 8.260735,
      lng: 77.287706,
    },
    {
      number: "TN75AT-4566",
      driver_name: "Suresh K",
      model: "Tata 407",
      type: "Insulated Van",
      odometer: 112400,
      fuel: 62,
      status: "Moving",
      location: "Suchindram Distribution Sector",
      lat: 8.15,
      lng: 77.46,
    },
  ];

  // Map rows using getImmediateLocationDisplay
  const reportRows = mockVehicles.map((v) => ({
    vehicle: v.number,
    driver: v.driver_name || "Unassigned",
    model: v.model,
    category: v.type,
    odometerKm: `${v.odometer.toLocaleString()} km`,
    fuelLevel: `${v.fuel}%`,
    status: v.status,
    location: getImmediateLocationDisplay(v.location, v.lat, v.lng),
  }));

  // Verify that TN 75 BC 2219 uses resolved human-readable name instead of raw lat/long
  assert.equal(reportRows[0].location, "Nagercoil, Tamil Nadu, India");

  // Verify that TN75AT-4566 preserves its authentic named location
  assert.equal(reportRows[1].location, "Suchindram Distribution Sector");

  // Verify CSV export formatting
  const keys = Object.keys(reportRows[0]);
  const lines = [
    keys.join(","),
    ...reportRows.map((r) => keys.map((k) => `"${String(r[k] ?? "")}"`).join(",")),
  ];

  const csvContent = lines.join("\n");
  assert.ok(csvContent.includes('"Nagercoil, Tamil Nadu, India"'), "CSV must contain resolved place name");
  assert.ok(csvContent.includes('"Suchindram Distribution Sector"'), "CSV must preserve authentic named locations");
  assert.ok(!csvContent.includes('"8.2607, 77.2877"'), "CSV must not contain raw coordinates when resolved");
});
