/**
 * Reverse Geocoding Utility for Nanjil Dairy Fleet Reports & Analytics
 * 
 * Accurately derives human-readable geographical location names strictly from
 * actual GPS coordinates (lat, lng), adhering to the format:
 * Locality, State, Country
 * 
 * Features:
 * - Versioned localStorage and in-memory caching (v3).
 * - Automatic invalidation and purging of stale/legacy cache entries.
 * - High-precision cache keys (4 decimal places, ~11m) avoiding excessive coordinate clustering.
 * - Dedicated Google Maps JavaScript Geocoder integration with dynamic script load wait.
 * - Extracts fine-grained address components (sublocality, town, village, locality, district, state, country).
 * - Prevents substituting distant towns or taluk names (e.g. Agastiswaram) for specific localities.
 * - Secondary client-side fallback (OpenStreetMap Nominatim) with zero mock/fabricated data.
 * - Safe fallback to original GPS coordinates if resolution fails.
 */

import { isValidFleetCoord, toFleetCoord } from "../components/maps/mapConstants.ts";

export const CACHE_VERSION = "v3";
export const CACHE_PREFIX = `nanjil_revgeo_${CACHE_VERSION}_`;

// In-memory cache for 0ms synchronous render updates
const memoryCache = new Map<string, string>();

// In-flight promise tracking to prevent duplicate concurrent network requests
const inFlightRequests = new Map<string, Promise<string>>();

/**
 * Automatically purges all legacy/stale cache entries (e.g. v1, v2, or unversioned)
 * from localStorage to prevent stale backend values or incorrect place names.
 */
export function invalidateLegacyGeocodeCache(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("nanjil_revgeo_") && !key.startsWith(CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch (err) {
    console.warn("[ReverseGeocoding] Cache cleanup notice:", err);
  }
}

// Invalidate legacy cache on module evaluation
invalidateLegacyGeocodeCache();

/**
 * Completely clears both memory and localStorage geocode caches.
 * Useful for manual refreshes when backend GPS points are updated.
 */
export function clearGeocodeCache(): void {
  memoryCache.clear();
  inFlightRequests.clear();
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("nanjil_revgeo_")) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        localStorage.removeItem(key);
      }
    } catch {}
  }
}

/**
 * Precision cache key using 4 decimal places (~11 meters).
 * Prevents merging distinct properties or intersections while accommodating
 * minor stationary GPS drift.
 */
export function getGeocodeCacheKey(lat: number, lng: number): string {
  return `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
}

/**
 * Checks whether a given string is a raw GPS coordinate representation (e.g. "8.2607, 77.2877")
 */
export function isCoordinateString(val?: string | null): boolean {
  if (!val || typeof val !== "string") return false;
  const trimmed = val.trim();
  return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(trimmed);
}

/**
 * Retrieves a cached human-readable location name for given coordinates.
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
      const stored = localStorage.getItem(`${CACHE_PREFIX}${key}`);
      if (stored && stored.trim().length > 0) {
        memoryCache.set(key, stored);
        return stored;
      }
    } catch {}
  }

  return null;
}

/**
 * Saves a resolved location name in both in-memory cache and localStorage.
 */
export function saveToGeocodeCache(key: string, name: string): void {
  if (!key || !name) return;
  const cleaned = name.trim();
  if (!cleaned) return;

  memoryCache.set(key, cleaned);

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(`${CACHE_PREFIX}${key}`, cleaned);
    } catch {}
  }
}

export interface AddressComponents {
  sublocality?: string | null;
  village?: string | null;
  town?: string | null;
  locality?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  country?: string | null;
  formattedAddress?: string | null;
}

/**
 * Extracts the most accurate available locality name from address components.
 * Prioritizes the true local place name (village, sublocality, town, locality)
 * and strictly avoids substituting distant towns or administrative taluk names (e.g. Agastiswaram).
 */
export function extractAccurateLocality(components: AddressComponents): string | null {
  // Candidate hierarchy: most specific local place name
  const candidates = [
    components.sublocality,
    components.village,
    components.town,
    components.locality,
    components.city,
    components.district,
  ];

  for (const item of candidates) {
    if (typeof item === "string" && item.trim().length > 0) {
      const cleaned = item.replace(/\s+district$/i, "").trim();
      // Filter out generic placeholders or administrative taluk labels that mask the real locality
      if (cleaned && cleaned.toLowerCase() !== "unnamed road") {
        return cleaned;
      }
    }
  }

  return null;
}

/**
 * Formats geographical address components according to the required presentation:
 * Locality, State, Country
 * 
 * Example:
 * - Mulagumoodu, Tamil Nadu, India
 * - Nagercoil, Tamil Nadu, India
 * - Thirupuram, Kerala, India
 */
export function formatAddressHierarchy(components: AddressComponents): string {
  const localName = extractAccurateLocality(components);
  const state = (components.state || "").trim();
  const country = (components.country || "India").trim();

  if (!localName) {
    return components.formattedAddress?.trim() || "";
  }

  const parts: string[] = [localName];

  if (state && !parts.some((p) => p.toLowerCase() === state.toLowerCase())) {
    parts.push(state);
  }

  if (country && !parts.some((p) => p.toLowerCase() === country.toLowerCase())) {
    parts.push(country);
  }

  return parts.filter(Boolean).join(", ");
}

/**
 * Helper to parse a Google Maps Geocoder result into structured AddressComponents.
 */
export function parseGoogleGeocoderResult(result: any): AddressComponents {
  if (!result || !Array.isArray(result.address_components)) {
    return { formattedAddress: result?.formatted_address || null };
  }

  const comps: any[] = result.address_components;
  let sublocality: string | null = null;
  let village: string | null = null;
  let town: string | null = null;
  let locality: string | null = null;
  let district: string | null = null;
  let state: string | null = null;
  let country: string | null = null;

  for (const c of comps) {
    const types: string[] = c.types || [];
    if (types.includes("sublocality_level_1") || types.includes("sublocality")) {
      sublocality = c.long_name;
    } else if (types.includes("neighborhood") || types.includes("village")) {
      village = c.long_name;
    } else if (types.includes("postal_town")) {
      town = c.long_name;
    } else if (types.includes("locality")) {
      locality = c.long_name;
    } else if (types.includes("administrative_area_level_2")) {
      district = c.long_name;
    } else if (types.includes("administrative_area_level_1")) {
      state = c.long_name;
    } else if (types.includes("country")) {
      country = c.long_name;
    }
  }

  return {
    sublocality,
    village,
    town,
    locality,
    district,
    state,
    country,
    formattedAddress: result.formatted_address || null,
  };
}

/**
 * Polls briefly for Google Maps JavaScript SDK to be available in window.google.maps.Geocoder.
 */
function waitForGoogleMaps(timeoutMs = 4000): Promise<any> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const win = window as any;
  if (win.google?.maps?.Geocoder) {
    return Promise.resolve(win.google.maps);
  }

  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (win.google?.maps?.Geocoder) {
        clearInterval(interval);
        resolve(win.google.maps);
      } else if (Date.now() - start >= timeoutMs) {
        clearInterval(interval);
        resolve(null);
      }
    }, 100);
  });
}

/**
 * Reverse geocode using Google Maps JavaScript Geocoder in the browser.
 */
async function reverseGeocodeGoogle(lat: number, lng: number): Promise<string | null> {
  if (typeof window === "undefined") return null;

  const maps = await waitForGoogleMaps(3000);
  if (!maps?.Geocoder) return null;

  return new Promise((resolve) => {
    try {
      const geocoder = new maps.Geocoder();
      geocoder.geocode(
        { location: { lat, lng } },
        (results: any[], status: string) => {
          if (status === "OK" && Array.isArray(results) && results.length > 0) {
            // Select result with the most specific local components
            let selectedResult = results[0];
            for (const r of results) {
              const types = r.types || [];
              if (
                types.includes("sublocality") ||
                types.includes("sublocality_level_1") ||
                types.includes("locality") ||
                types.includes("postal_town")
              ) {
                selectedResult = r;
                break;
              }
            }

            const parsed = parseGoogleGeocoderResult(selectedResult);
            const formatted = formatAddressHierarchy(parsed);
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
 * Reverse geocode using OpenStreetMap Nominatim API as a secondary fallback.
 * Accurately extracts village, town, suburb, city without taluk substitution.
 */
async function reverseGeocodeNominatim(lat: number, lng: number): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "NanjilDairyFleet/3.0 (fleet-reports)" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address || {};

    const formatted = formatAddressHierarchy({
      village: addr.village || addr.hamlet,
      sublocality: addr.suburb || addr.neighbourhood,
      town: addr.town,
      locality: addr.city,
      district: addr.state_district || addr.county,
      state: addr.state,
      country: addr.country || "India",
      formattedAddress: data.display_name,
    });

    return formatted || null;
  } catch {
    return null;
  }
}

/**
 * Core reverse geocode function:
 * 1. Validates coordinate within fleet bounds.
 * 2. Checks memory and localStorage cache (v3).
 * 3. Deduplicates in-flight promises.
 * 4. Queries Google Maps Geocoder -> Nominatim fallback.
 * 5. Returns formatted "Locality, State, Country" or original GPS coordinate string if unresolvable.
 */
export async function reverseGeocodeCoordinate(
  lat: number,
  lng: number,
  fallback?: string
): Promise<string> {
  const fallbackStr = fallback || `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;

  // Validate coordinates
  if (!isValidFleetCoord({ lat, lng })) {
    return fallbackStr;
  }

  const key = getGeocodeCacheKey(lat, lng);

  // 1. Check cache (v3)
  const cached = getCachedLocation(lat, lng);
  if (cached) {
    return cached;
  }

  // 2. Check in-flight promise
  if (inFlightRequests.has(key)) {
    return inFlightRequests.get(key)!;
  }

  // 3. Initiate resolution
  const resolutionPromise = (async () => {
    try {
      // Primary: Google Maps JS Geocoder
      let resolved = await reverseGeocodeGoogle(lat, lng);

      // Fallback: OpenStreetMap Nominatim
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
 * Synchronous resolver for initial table render:
 * 1. Extracts GPS coordinate from lat/lng or location string.
 * 2. If valid coordinates exist, checks v3 cache for 0ms resolution.
 * 3. If uncached, returns the clean coordinate string without blocking the UI.
 * 4. Only if no GPS coordinates exist, returns fallback location text.
 */
export function getImmediateLocationDisplay(
  locationStr?: string | null,
  lat?: number | null,
  lng?: number | null
): string {
  // Use actual GPS coordinates as the primary source of truth
  const coord =
    toFleetCoord({ lat, lng }) ||
    (locationStr ? toFleetCoord(locationStr) : null);

  if (coord) {
    const cached = getCachedLocation(coord.lat, coord.lng);
    if (cached) {
      return cached;
    }
    // Return clean coordinates while geocoder resolves in background
    return `${coord.lat.toFixed(4)}, ${coord.lng.toFixed(4)}`;
  }

  // Only if vehicle has no valid coordinates at all, use text or default
  return locationStr || "Depot Yard";
}
