/**
 * Road Routing & Geodesic Navigation Engine
 * Powered by OpenStreetMap Project OSRM
 * Computes authentic road network trajectories, distances, durations, and route deviations.
 */

export interface RoutePoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  serviceDurationMins?: number;
  plannedArrival?: string;
  plannedDeparture?: string;
  isMandatory?: boolean;
  status?: "Pending" | "Reached" | "Skipped" | "Missed";
  actualArrival?: string;
  actualDeparture?: string;
}

export interface RoadRoutingResult {
  coordinates: [number, number][]; // [lng, lat]
  distanceKm: number;
  durationMins: number;
  stepsCount: number;
  isFallbackStraightLine: boolean;
  error?: string;
}

/**
 * Calculates straight line haversine distance in kilometers
 */
export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

/**
 * Calculates perpendicular distance from a point to a line segment in meters
 */
export function pointToSegmentDistanceMeters(
  px: number, py: number, // point lat, lng
  ax: number, ay: number, // segment start lat, lng
  bx: number, by: number  // segment end lat, lng
): number {
  const R = 6371000; // meters
  // Convert to equirectangular projection centered on px
  const rad = Math.PI / 180;
  const cosLat = Math.cos(px * rad);
  const p = { x: py * rad * cosLat * R, y: px * rad * R };
  const a = { x: ay * rad * cosLat * R, y: ax * rad * R };
  const b = { x: by * rad * cosLat * R, y: bx * rad * R };

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    const dX = p.x - a.x;
    const dY = p.y - a.y;
    return Math.sqrt(dX * dX + dY * dY);
  }

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  const distSq = (p.x - projX) * (p.x - projX) + (p.y - projY) * (p.y - projY);
  return Math.sqrt(distSq);
}

/**
 * Calculates minimum distance in meters from a current location to a road coordinates polyline
 */
export function calculateRouteDeviationMeters(
  currentLat: number,
  currentLng: number,
  roadCoords: [number, number][] // [lng, lat]
): number {
  if (!roadCoords || roadCoords.length < 2) return 0;
  let minDistance = Infinity;

  // Sample or iterate through segments
  for (let i = 0; i < roadCoords.length - 1; i++) {
    const [aLng, aLat] = roadCoords[i];
    const [bLng, bLat] = roadCoords[i + 1];
    const dist = pointToSegmentDistanceMeters(currentLat, currentLng, aLat, aLng, bLat, bLng);
    if (dist < minDistance) {
      minDistance = dist;
    }
  }

  return Math.round(minDistance);
}

/**
 * Fetches actual road network route from Project OSRM.
 * Efficiently handles up to 50+ stops by chunking waypoints into safe sub-segments.
 */
export async function calculateRoadRoute(points: { lat: number; lng: number }[]): Promise<RoadRoutingResult> {
  const validPoints = points.filter(
    (p) =>
      typeof p.lat === "number" &&
      !isNaN(p.lat) &&
      p.lat >= -90 &&
      p.lat <= 90 &&
      typeof p.lng === "number" &&
      !isNaN(p.lng) &&
      p.lng >= -180 &&
      p.lng <= 180 &&
      (p.lat !== 0 || p.lng !== 0)
  );

  if (validPoints.length < 2) {
    return {
      coordinates: validPoints.map((p) => [p.lng, p.lat]),
      distanceKm: 0,
      durationMins: 0,
      stepsCount: validPoints.length,
      isFallbackStraightLine: false,
    };
  }

  // Chunk waypoints into max 20 per request to guarantee OSRM response reliability
  const CHUNK_SIZE = 18;
  const accumulatedCoords: [number, number][] = [];
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;
  let failedChunks = 0;

  for (let i = 0; i < validPoints.length - 1; i += CHUNK_SIZE - 1) {
    const chunk = validPoints.slice(i, Math.min(i + CHUNK_SIZE, validPoints.length));
    if (chunk.length < 2) continue;

    const coordString = chunk.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
    const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson&steps=false`;

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
      if (!response.ok) throw new Error(`OSRM HTTP ${response.status}`);
      const data = await response.json();

      if (data.code === "Ok" && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        totalDistanceMeters += route.distance || 0;
        totalDurationSeconds += route.duration || 0;

        const coords = route.geometry?.coordinates as [number, number][];
        if (coords && coords.length > 0) {
          // Avoid duplicate connection point between chunks
          if (accumulatedCoords.length > 0) {
            accumulatedCoords.push(...coords.slice(1));
          } else {
            accumulatedCoords.push(...coords);
          }
        }
      } else {
        throw new Error(data.message || "No road route found in chunk");
      }
    } catch (err) {
      failedChunks++;
      // Fallback: connect chunk waypoints directly
      chunk.forEach((p, idx) => {
        if (accumulatedCoords.length === 0 || idx > 0) {
          accumulatedCoords.push([p.lng, p.lat]);
        }
      });
      // Estimate distance and driving duration (assumed 40 km/h average rural/town speed)
      for (let c = 0; c < chunk.length - 1; c++) {
        const d = haversineDistanceKm(chunk[c].lat, chunk[c].lng, chunk[c + 1].lat, chunk[c + 1].lng);
        totalDistanceMeters += d * 1000;
        totalDurationSeconds += (d / 40) * 3600;
      }
    }
  }

  const distanceKm = Math.round((totalDistanceMeters / 1000) * 10) / 10;
  const durationMins = Math.round(totalDurationSeconds / 60);

  return {
    coordinates: accumulatedCoords,
    distanceKm,
    durationMins,
    stepsCount: validPoints.length,
    isFallbackStraightLine: failedChunks > 0,
  };
}

/**
 * Formats duration in minutes to human readable string (e.g., "2h 35m")
 */
export function formatDurationMins(minutes: number): string {
  if (minutes < 1) return "1m";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m > 0 ? `${m}m` : ""}`.trim();
}
