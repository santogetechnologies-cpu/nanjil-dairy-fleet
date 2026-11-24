import test from "node:test";
import assert from "node:assert/strict";
import {
  CACHE_VERSION,
  CACHE_PREFIX,
  getGeocodeCacheKey,
  isCoordinateString,
  getCachedLocation,
  saveToGeocodeCache,
  clearGeocodeCache,
  invalidateLegacyGeocodeCache,
  extractAccurateLocality,
  formatAddressHierarchy,
  reverseGeocodeCoordinate,
  getImmediateLocationDisplay,
  parseGoogleGeocoderResult,
} from "../src/lib/reverseGeocoding.ts";
import { toFleetCoord } from "../src/components/maps/mapConstants.ts";

test("1. isCoordinateString: Accurately distinguishes raw GPS coordinates from text labels", () => {
  assert.equal(isCoordinateString("8.2607, 77.2877"), true);
  assert.equal(isCoordinateString("8.3473, 77.1106"), true);
  assert.equal(isCoordinateString("8.260735,77.287706"), true);
  assert.equal(isCoordinateString(" 8.2231 , 77.4169 "), true);

  assert.equal(isCoordinateString("Suchindram Distribution Sector"), false);
  assert.equal(isCoordinateString("Monday Market Dairy Centre"), false);
  assert.equal(isCoordinateString("Nagercoil Central Depot Yard"), false);
  assert.equal(isCoordinateString("Depot Yard"), false);
  assert.equal(isCoordinateString(""), false);
  assert.equal(isCoordinateString(null), false);
  assert.equal(isCoordinateString(undefined), false);
  assert.equal(isCoordinateString("NaN, NaN"), false);
});

test("2. getGeocodeCacheKey: Uses 4 decimal places (~11m precision) to avoid excessive clustering", () => {
  const k1 = getGeocodeCacheKey(8.260735, 77.287706); // TN 75 BC 2219
  const k2 = getGeocodeCacheKey(8.260788, 77.287742); // very near k1 (~6m)
  const k3 = getGeocodeCacheKey(8.260950, 77.288300); // TN 75 F 4323 (~80m away)

  assert.equal(k1, "8.2607,77.2877");
  assert.equal(k2, "8.2608,77.2877");
  assert.equal(k3, "8.2609,77.2883");

  // Distinct locations maintain distinct cache keys
  assert.notEqual(k1, k3);

  // Different town produces a completely distinct key
  const bf0320Key = getGeocodeCacheKey(8.347316, 77.110624);
  assert.equal(bf0320Key, "8.3473,77.1106");
  assert.notEqual(bf0320Key, k1);
});

test("3. extractAccurateLocality & formatAddressHierarchy: Extracts authentic place names without taluk substitution", () => {
  // Case A: Mulagumoodu plant (sublocality preferred over nearby town Thuckalay)
  const mulagumoodu = formatAddressHierarchy({
    sublocality: "Mulagumoodu",
    locality: "Padmanabhapuram",
    district: "Kanniyakumari district",
    state: "Tamil Nadu",
    country: "India",
  });
  assert.equal(mulagumoodu, "Mulagumoodu, Tamil Nadu, India");
  assert.ok(!mulagumoodu.includes("Thuckalay"), "Must not substitute nearby town Thuckalay");

  // Case B: Suchindram (town preferred over taluk Agastiswaram)
  const suchindram = formatAddressHierarchy({
    town: "Suchindram",
    locality: null,
    district: "Agastheeswaram",
    state: "Tamil Nadu",
    country: "India",
  });
  assert.equal(suchindram, "Suchindram, Tamil Nadu, India");
  assert.ok(!suchindram.includes("Agastiswaram"), "Must not substitute taluk Agastiswaram");

  // Case C: Kanyakumari (town/locality)
  const kanyakumari = formatAddressHierarchy({
    sublocality: "Kundal",
    locality: "Kanyakumari",
    state: "Tamil Nadu",
    country: "India",
  });
  assert.equal(kanyakumari, "Kundal, Tamil Nadu, India");

  // Case D: Nagercoil Parvathipuram
  const parvathipuram = formatAddressHierarchy({
    sublocality: "Parvathipuram",
    locality: "Nagercoil",
    state: "Tamil Nadu",
    country: "India",
  });
  assert.equal(parvathipuram, "Parvathipuram, Tamil Nadu, India");

  // Case E: Thirupuram (TN 75 BF 0320)
  const thirupuram = formatAddressHierarchy({
    village: "Thirupuram",
    locality: "Neyyattinkara",
    district: "Thiruvananthapuram",
    state: "Kerala",
    country: "India",
  });
  assert.equal(thirupuram, "Thirupuram, Kerala, India");

  // Case F: No undefined or NaN in formatted output
  const cleanFallback = formatAddressHierarchy({
    sublocality: undefined,
    locality: undefined,
    state: undefined,
    country: undefined,
  });
  assert.ok(!cleanFallback.includes("undefined"));
  assert.ok(!cleanFallback.includes("NaN"));
});

test("4. parseGoogleGeocoderResult: Correctly maps Google Maps address components", () => {
  const mockGoogleResult = {
    formatted_address: "Mulagumoodu, Tamil Nadu 629167, India",
    address_components: [
      { long_name: "Mulagumoodu", short_name: "Mulagumoodu", types: ["sublocality_level_1", "sublocality", "political"] },
      { long_name: "Padmanabhapuram", short_name: "Padmanabhapuram", types: ["locality", "political"] },
      { long_name: "Kanniyakumari", short_name: "Kanniyakumari", types: ["administrative_area_level_2", "political"] },
      { long_name: "Tamil Nadu", short_name: "TN", types: ["administrative_area_level_1", "political"] },
      { long_name: "India", short_name: "IN", types: ["country", "political"] },
    ],
  };

  const parsed = parseGoogleGeocoderResult(mockGoogleResult);
  assert.equal(parsed.sublocality, "Mulagumoodu");
  assert.equal(parsed.locality, "Padmanabhapuram");
  assert.equal(parsed.district, "Kanniyakumari");
  assert.equal(parsed.state, "Tamil Nadu");
  assert.equal(parsed.country, "India");

  const formatted = formatAddressHierarchy(parsed);
  assert.equal(formatted, "Mulagumoodu, Tamil Nadu, India");
});

test("5. Cache Versioning & Invalidation: Uses v3 cache and supports clearing for manual refresh", () => {
  assert.equal(CACHE_VERSION, "v3");
  assert.equal(CACHE_PREFIX, "nanjil_revgeo_v3_");

  const lat = 8.2607;
  const lng = 77.2877;
  const key = getGeocodeCacheKey(lat, lng);

  saveToGeocodeCache(key, "Mulagumoodu, Tamil Nadu, India");
  assert.equal(getCachedLocation(lat, lng), "Mulagumoodu, Tamil Nadu, India");

  // Clear cache for refresh
  clearGeocodeCache();
  assert.equal(getCachedLocation(lat, lng), null);
});

test("6. reverseGeocodeCoordinate: Reject invalid coordinates and fall back to GPS string without fabricated data", async () => {
  // Reject (0, 0) Null Island
  const nullIsland = await reverseGeocodeCoordinate(0, 0, "Depot Yard");
  assert.equal(nullIsland, "Depot Yard");

  // Reject swapped coordinates (outside Indian geofence)
  const swapped = await reverseGeocodeCoordinate(77.2877, 8.2607, "77.2877, 8.2607");
  assert.equal(swapped, "77.2877, 8.2607");

  // Reject NaN
  const nanCoord = await reverseGeocodeCoordinate(NaN, NaN, "Depot Yard");
  assert.equal(nanCoord, "Depot Yard");

  // Returns cached value when present
  const lat = 8.3473;
  const lng = 77.1106;
  const key = getGeocodeCacheKey(lat, lng);
  saveToGeocodeCache(key, "Thirupuram, Kerala, India");

  const resolved = await reverseGeocodeCoordinate(lat, lng, "8.3473, 77.1106");
  assert.equal(resolved, "Thirupuram, Kerala, India");
});

test("7. getImmediateLocationDisplay: Derives location strictly from actual GPS coordinates", () => {
  // Vehicle with GPS coordinates: does NOT blindly trust stale v.location text!
  const lat = 8.1500;
  const lng = 77.4600;
  const key = getGeocodeCacheKey(lat, lng);
  saveToGeocodeCache(key, "Suchindram, Tamil Nadu, India");

  // Even if v.location says "Suchindram Distribution Sector", it returns the resolved GPS locality!
  const locDisplay = getImmediateLocationDisplay("Suchindram Distribution Sector", lat, lng);
  assert.equal(locDisplay, "Suchindram, Tamil Nadu, India");

  // Vehicle with coordinates not yet cached returns clean coordinates, not stale text
  const uncachedDisplay = getImmediateLocationDisplay("Aralvaimozhi Route", 8.2600, 77.5200);
  assert.equal(uncachedDisplay, "8.2600, 77.5200");

  // Only if vehicle has NO coordinates at all (null/undefined), it falls back to text
  const noCoordDisplay = getImmediateLocationDisplay("Depot Yard", null, null);
  assert.equal(noCoordDisplay, "Depot Yard");
});

test("8. Export Integration: Daily Vehicle Activity table and CSV contain resolved GPS locality names", () => {
  // Prime cache for test vehicles
  saveToGeocodeCache(getGeocodeCacheKey(8.260735, 77.287706), "Mulagumoodu, Tamil Nadu, India");
  saveToGeocodeCache(getGeocodeCacheKey(8.2106, 77.4603), "Nagercoil, Tamil Nadu, India");
  saveToGeocodeCache(getGeocodeCacheKey(8.347316, 77.110624), "Thirupuram, Kerala, India");

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
      number: "TN 75 S 9826",
      driver_name: "Ramesh P",
      model: "Tata 1109",
      type: "Milk Tanker",
      odometer: 62400,
      fuel: 78,
      status: "Moving",
      location: "8.2106, 77.4603",
      lat: 8.2106,
      lng: 77.4603,
    },
    {
      number: "TN 75 BF 0320",
      driver_name: "Anand M",
      model: "Eicher 2059",
      type: "Tanker",
      odometer: 54100,
      fuel: 90,
      status: "Moving",
      location: "8.3473, 77.1106",
      lat: 8.347316,
      lng: 77.110624,
    },
  ];

  const reportRows = mockVehicles.map((v) => ({
    vehicle: v.number,
    driver: v.driver_name,
    model: v.model,
    category: v.type,
    odometerKm: `${v.odometer.toLocaleString()} km`,
    status: v.status,
    location: getImmediateLocationDisplay(v.location, v.lat, v.lng),
  }));

  assert.equal(reportRows[0].location, "Mulagumoodu, Tamil Nadu, India");
  assert.equal(reportRows[1].location, "Nagercoil, Tamil Nadu, India");
  assert.equal(reportRows[2].location, "Thirupuram, Kerala, India");

  // Verify CSV export string
  const keys = Object.keys(reportRows[0]);
  const lines = [
    keys.join(","),
    ...reportRows.map((r) => keys.map((k) => `"${String(r[k] ?? "")}"`).join(",")),
  ];

  const csvContent = lines.join("\n");
  assert.ok(csvContent.includes('"Mulagumoodu, Tamil Nadu, India"'));
  assert.ok(csvContent.includes('"Nagercoil, Tamil Nadu, India"'));
  assert.ok(csvContent.includes('"Thirupuram, Kerala, India"'));
  assert.ok(!csvContent.includes('"Agastiswaram"'));
});
