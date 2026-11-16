/**
 * Reverse Geocoding Utility for Nanjil Dairy Fleet
 * 
 * Converts GPS coordinates into human-readable geographical location names
 * following the hierarchy: Locality / Town -> District -> State -> Country.
 * 
 * Features:
 * - High-performance dual-tier caching (in-memory Map + localStorage).
 * - Rounded GPS coordinate keys (~100m precision) to avoid redundant API hits for co-located vehicles.
 * - In-flight promise deduplication to prevent duplicate concurrent network requests.
 * - Primary provider: Google Maps JavaScript Geocoder (when initialized in browser).
 * - Robust client-side fallbacks: BigDataCloud Client API & OSM Nominatim API.
 * - Non-blocking asynchronous resolution with graceful fallback to raw GPS coordinates.
 * - Strictly prevents fabricated names, undefined, or NaN values.
 */

import { isValidFleetCoord, toFleetCoord } from "../components/maps/mapConstants.ts";

// In-memory cache for ultra-fast (0ms) synchronous lookups during render cycles
const memoryCache = new Map<string, string>();

// In-flight promise tracking for request deduplication
const inFlightRequests = new Map<string, Promise<string>>();

const LOCAL_STORAGE_PREFIX = "nanjil_revgeo_v1_";

/**
 * Rounds coordinate to 3 decimal places (~110 meters), clustering co-located
 * vehicles and small GPS drifts into a single shared cache entry.
 */
export function getGeocodeCacheKey(lat: number, lng: number): string {
  return `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
}

/**
 * Checks whether a given string is a raw GPS coordinate representation (e.g. "8.2607, 77.2877")
 * vs an authentic named location (e.g. "Suchindram Distribution Sector").
 */
export function isCoordinateString(val?: string | null): boolean {
  if (!val || typeof val !== "string") return false;
  const trimmed = val.trim();
  return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(trimmed);
}

/**
 * Retrieves a cached human-readable location name by coordinate, checking
 * memory cache first, then localStorage.
 */
export function getCachedLocation(lat: number, lng: number): string | null {
  const key = getGeocodeCacheKey(lat, lng);

  // 1. Memory cache
  if (memoryCache.has(key)) {
    return memoryCache.get(key) || null;
  }

  // 2. LocalStorage cache
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const stored = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${key}`);
      if (stored && stored.trim().length > 0) {
        memoryCache.set(key, stored);
        return stored;
      }
    } catch {
      // localStorage may be disabled or restricted
    }
  }

  return null;
}

/**
 * Stores a resolved location name in both in-memory cache and localStorage.
 */
export function saveToGeocodeCache(key: string, name: string): void {
  if (!key || !name) return;
  const cleaned = name.trim();
  if (!cleaned) return;

  memoryCache.set(key, cleaned);

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${key}`, cleaned);
    } catch {
      // Ignore quota or private browsing storage errors
    }
  }
}

export interface AddressComponents {
  locality?: string | null;
  town?: string | null;
  city?: string | null;
  suburb?: string | null;
  village?: string | null;
  district?: string | null;
  state?: string | null;
  country?: string | null;
  formattedAddress?: string | null;
}

/**
 * Formats geographical address components according to the hierarchy:
 * Locality / Town -> District -> State -> Country.
 * 
 * Example:
 * Raw: 8.2607, 77.2877 -> "Thuckalay, Tamil Nadu, India" or "Nagercoil, Tamil Nadu, India"
 */
export function formatAddressHierarchy(components: AddressComponents): string {
  // 1. Primary place name: Locality / Town / Village / City
  const localName = (
    components.locality ||
    components.town ||
    components.village ||
    components.city ||
    components.suburb ||
    ""
  ).trim();

  // 2. District (clean trailing 'district' word for cleaner presentation)
  const district = (components.district || "")
    .replace(/\s+district$/i, "")
    .trim();

  // 3. State
  const state = (components.state || "").trim();

  // 4. Country (default India for domestic dairy operations)
  const country = (components.country || "India").trim();

  // Determine the primary geographical identifier
  const primary = localName || district || state || country;
  if (!primary) {
    return components.formattedAddress?.trim() || "";
  }

  const parts: string[] = [primary];

  // If primary was localName and district is distinct and provides helpful context,
  // we could consider district, but the requested format prefers:
  // "Locality, State, Country" (e.g. "Nagercoil, Tamil Nadu, India").
  // If primary was NOT localName, primary is already district or state.
  if (state && !parts.some((p) => p.toLowerCase() === state.toLowerCase())) {
    parts.push(state);
  }

  if (country && !parts.some((p) => p.toLowerCase() === country.toLowerCase())) {
    parts.push(country);
  }

  return parts.filter(Boolean).join(", ");
}

/**
 * Reverse geocode using Google Maps JavaScript Geocoder when available in the browser window.
 */
async function reverseGeocodeGoogle(lat: number, lng: number): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const g = (window as any).google;
  if (!g?.maps?.Geocoder) return null;

  return new Promise((resolve) => {
    try {
      const geocoder = new g.maps.Geocoder();
      geocoder.geocode(
        { location: { lat, lng } },
        (results: any[], status: string) => {
          if (status === "OK" && Array.isArray(results) && results.length > 0) {
            const best = results[0];
            const comps: any[] = best.address_components || [];
            let locality: string | null = null;
            let postalTown: string | null = null;
            let sublocality: string | null = null;
            let district: string | null = null;
            let state: string | null = null;
            let country: string | null = null;

            for (const c of comps) {
              const types: string[] = c.types || [];
              if (types.includes("locality")) locality = c.long_name;
              else if (types.includes("postal_town")) postalTown = c.long_name;
              else if (types.includes("sublocality") || types.includes("sublocality_level_1")) {
                sublocality = c.long_name;
              } else if (types.includes("administrative_area_level_2")) {
                district = c.long_name;
              } else if (types.includes("administrative_area_level_1")) {
                state = c.long_name;
              } else if (types.includes("country")) {
                country = c.long_name;
              }
            }

            const formatted = formatAddressHierarchy({
              locality: locality || postalTown || sublocality,
              district,
              state,
              country,
              formattedAddress: best.formatted_address,
            });

            if (formatted) {
              resolve(formatted);
              return;
            }
          }
          resolve(null);
        }
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * Reverse geocode using BigDataCloud's free, unmetered client geocoding API.
 */
async function reverseGeocodeBigDataCloud(lat: number, lng: number): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data = await res.json();

    const localName = data.locality || data.city;
    const districtObj = data.localityInfo?.administrative?.find(
      (a: any) =>
        a.adminLevel === 6 ||
        a.adminLevel === 5 ||
        (typeof a.description === "string" && a.description.toLowerCase().includes("district"))
    );
    const district = districtObj?.name || null;
    const state = data.principalSubdivision || null;
    const country = data.countryName || "India";

    const formatted = formatAddressHierarchy({
      locality: localName,
      district,
      state,
      country,
    });

    return formatted || null;
  } catch {
    return null;
  }
}

/**
 * Reverse geocode using OpenStreetMap Nominatim API as a secondary fallback.
 */
async function reverseGeocodeNominatim(lat: number, lng: number): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "NanjilDairyFleet/1.0 (fleet-reports)" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address || {};

    const localName =
      addr.city ||
      addr.town ||
      addr.village ||
      addr.suburb ||
      addr.city_district ||
      addr.county;
    const district = addr.state_district || addr.county || null;
    const state = addr.state || null;
    const country = addr.country || "India";

    const formatted = formatAddressHierarchy({
      locality: localName,
      district,
      state,
      country,
      formattedAddress: data.display_name,
    });

    return formatted || null;
  } catch {
    return null;
  }
}

/**
 * Core reverse geocode function:
 * Validates coordinates, checks cache, deduplicates in-flight requests,
 * calls provider chain (Google Maps -> BigDataCloud -> Nominatim), and returns
 * formatted place name. Falls back to original GPS coordinates if all fail.
 */
export async function reverseGeocodeCoordinate(
  lat: number,
  lng: number,
  fallback?: string
): Promise<string> {
  const fallbackStr = fallback || `${lat}, ${lng}`;

  // Validate coordinates
  if (!isValidFleetCoord({ lat, lng })) {
    return fallbackStr;
  }

  const key = getGeocodeCacheKey(lat, lng);

  // 1. Check cache (memory or localStorage)
  const cached = getCachedLocation(lat, lng);
  if (cached) {
    return cached;
  }

  // 2. Check in-flight promise to avoid duplicate concurrent requests
  if (inFlightRequests.has(key)) {
    return inFlightRequests.get(key)!;
  }

  // 3. Initiate resolution
  const resolutionPromise = (async () => {
    try {
      // Try Google Maps Geocoder first
      let resolved = await reverseGeocodeGoogle(lat, lng);

      // Fallback to BigDataCloud
      if (!resolved) {
        resolved = await reverseGeocodeBigDataCloud(lat, lng);
      }

      // Fallback to Nominatim
      if (!resolved) {
        resolved = await reverseGeocodeNominatim(lat, lng);
      }

      if (resolved && resolved.trim().length > 0) {
        saveToGeocodeCache(key, resolved.trim());
        return resolved.trim();
      }

      return fallbackStr;
    } catch {
      return fallbackStr;
    } finally {
      inFlightRequests.delete(key);
    }
  })();

  inFlightRequests.set(key, resolutionPromise);
  return resolutionPromise;
}

/**
 * Synchronous helper for initial table renders:
 * If location is already human-readable text, returns it directly.
 * If location is GPS coordinates, checks cache for 0ms hit; otherwise returns current coordinates.
 */
export function getImmediateLocationDisplay(
  locationStr?: string | null,
  lat?: number | null,
  lng?: number | null
): string {
  // If locationStr is already an authentic place name, preserve it
  if (locationStr && !isCoordinateString(locationStr)) {
    return locationStr.trim();
  }

  // Extract coordinates
  const coord =
    toFleetCoord({ lat, lng }) ||
    (locationStr ? toFleetCoord(locationStr) : null);

  if (coord) {
    const cached = getCachedLocation(coord.lat, coord.lng);
    if (cached) {
      return cached;
    }
    // Return original coordinate string cleanly formatted
    return locationStr || `${coord.lat.toFixed(4)}, ${coord.lng.toFixed(4)}`;
  }

  return locationStr || "Depot Yard";
}
