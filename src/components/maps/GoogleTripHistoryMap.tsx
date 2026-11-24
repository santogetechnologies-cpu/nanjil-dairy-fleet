import { useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import {
  Map,
  AdvancedMarker,
  Polyline,
  useMap,
} from "@vis.gl/react-google-maps";
import {
  type GpsPoint,
  type RouteSegment,
  type TimelineEvent,
  haversineDistanceKm,
  splitPointsIntoSegments,
} from "@/lib/tripHistoryEngine";
import type { Vehicle } from "@/lib/types";
import { getFleetVehicleRouteColor } from "@/lib/vehicle-stop-detection";
import { Truck, Navigation } from "lucide-react";
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  GOOGLE_MAPS_MAP_ID,
  GOOGLE_MAPS_API_KEY,
  isValidFleetCoord,
} from "./mapConstants";

export interface GoogleTripHistoryMapProps {
  currentPoint?: GpsPoint | null;
  currentIndex?: number;
  selectedJourneyId?: string;
  vehicleCurrentPosition?: { lat: number; lng: number; status: string } | null;
  selectedVehicle?: Vehicle | null;
  activeGpsPoints: GpsPoint[];
  activeSegments: RouteSegment[];
  timelineEvents: TimelineEvent[];
  jumpToPointIndex: (index: number) => void;
  formatIstTime: (iso: string) => string;
  isPlaying: boolean;
  onRegisterFitBounds?: (fitFn: () => void) => void;
}

export function GoogleTripHistoryMap({
  currentPoint,
  currentIndex = 0,
  selectedJourneyId = "all",
  vehicleCurrentPosition,
  selectedVehicle,
  activeGpsPoints,
  activeSegments,
  timelineEvents,
  jumpToPointIndex,
  formatIstTime,
  isPlaying,
  onRegisterFitBounds,
}: GoogleTripHistoryMapProps) {
  const map = useMap();

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full p-6 text-center bg-slate-50 border border-slate-200 rounded-xl">
        <p className="text-xs text-slate-500">Google Maps API key required to view trip playback.</p>
      </div>
    );
  }

  const defaultCenter = useMemo(() => {
    if (isValidFleetCoord(currentPoint)) {
      return { lat: currentPoint.lat, lng: currentPoint.lng };
    }
    if (isValidFleetCoord(vehicleCurrentPosition)) {
      return { lat: vehicleCurrentPosition.lat, lng: vehicleCurrentPosition.lng };
    }
    return DEFAULT_MAP_CENTER;
  }, [currentPoint, vehicleCurrentPosition]);

  const vehicleRouteColor = useMemo(() => {
    return getFleetVehicleRouteColor(selectedVehicle?.id);
  }, [selectedVehicle?.id]);

  // Fit bounds function for the entire route
  const fitRouteBounds = useCallback(() => {
    if (!map) return;

    if (activeGpsPoints.length === 0) {
      if (isValidFleetCoord(vehicleCurrentPosition)) {
        map.setCenter({ lat: vehicleCurrentPosition.lat, lng: vehicleCurrentPosition.lng });
        map.setZoom(15);
      } else {
        map.setCenter(DEFAULT_MAP_CENTER);
        map.setZoom(DEFAULT_MAP_ZOOM);
      }
      return;
    }

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    let validCount = 0;

    activeGpsPoints.forEach((p) => {
      if (isValidFleetCoord(p)) {
        validCount++;
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLng) minLng = p.lng;
        if (p.lng > maxLng) maxLng = p.lng;
      }
    });

    if (validCount === 0) {
      map.setCenter(DEFAULT_MAP_CENTER);
      map.setZoom(DEFAULT_MAP_ZOOM);
      return;
    }

    const latSpan = maxLat - minLat;
    const lngSpan = maxLng - minLng;
    const isClustered = latSpan < 0.002 && lngSpan < 0.002; // < ~200m (e.g. parked at depot)

    if (isClustered) {
      map.setCenter({ lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 });
      map.setZoom(15);
    } else {
      map.fitBounds(
        {
          north: maxLat,
          south: minLat,
          east: maxLng,
          west: minLng,
        },
        50 // padding
      );
    }
  }, [map, activeGpsPoints, vehicleCurrentPosition]);

  // Register fit bounds with parent if requested
  useEffect(() => {
    if (onRegisterFitBounds) {
      onRegisterFitBounds(fitRouteBounds);
    }
  }, [onRegisterFitBounds, fitRouteBounds]);

  // Auto-fit bounds whenever map becomes available or points/selected journey changes
  useEffect(() => {
    if (map) {
      fitRouteBounds();
    }
  }, [map, activeGpsPoints, selectedJourneyId, fitRouteBounds]);

  const isInitialMountRef = useRef(true);
  const prevPointRef = useRef<{ lat: number; lng: number } | null>(null);

  // Reset initial mount flag whenever active route/points change
  useEffect(() => {
    isInitialMountRef.current = true;
    prevPointRef.current = null;
  }, [activeGpsPoints]);

  // Pan camera as playback progresses or when user seeks/clicks points
  useEffect(() => {
    if (!map || !isValidFleetCoord(currentPoint)) return;

    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      prevPointRef.current = { lat: currentPoint.lat, lng: currentPoint.lng };
      return;
    }

    // Pan when playing or when the point coordinate changed (user seek/click)
    const hasCoordChanged =
      !prevPointRef.current ||
      prevPointRef.current.lat !== currentPoint.lat ||
      prevPointRef.current.lng !== currentPoint.lng;

    if (isPlaying || hasCoordChanged) {
      map.panTo({ lat: currentPoint.lat, lng: currentPoint.lng });
      prevPointRef.current = { lat: currentPoint.lat, lng: currentPoint.lng };
    }
  }, [map, isPlaying, currentPoint]);

  // Convert RouteSegments into clean Polyline coordinate arrays (filtering stationary jitter < 50m)
  const segmentPaths = useMemo(() => {
    return activeSegments
      .map((segment) => {
        const validCoords = segment.points
          .filter((p) => isValidFleetCoord(p))
          .map((p) => ({ lat: p.lat, lng: p.lng }));

        // Deduplicate consecutive identical or sub-pixel points (< 5m)
        const deduped: { lat: number; lng: number }[] = [];
        for (const pt of validCoords) {
          if (deduped.length === 0) {
            deduped.push(pt);
          } else {
            const last = deduped[deduped.length - 1];
            const dist = haversineDistanceKm(last.lat, last.lng, pt.lat, pt.lng);
            if (dist >= 0.005) {
              deduped.push(pt);
            }
          }
        }
        if (validCoords.length > 1) {
          const lastValid = validCoords[validCoords.length - 1];
          const lastDedup = deduped[deduped.length - 1];
          if (lastValid && lastDedup && (lastValid.lat !== lastDedup.lat || lastValid.lng !== lastDedup.lng)) {
            deduped.push(lastValid);
          }
        }
        return deduped;
      })
      .filter((coords) => {
        if (coords.length < 2) return false;
        // Bounding box span check: reject stationary yard jitter (< 50m total span)
        let minLat = coords[0].lat, maxLat = coords[0].lat;
        let minLng = coords[0].lng, maxLng = coords[0].lng;
        for (const c of coords) {
          if (c.lat < minLat) minLat = c.lat;
          if (c.lat > maxLat) maxLat = c.lat;
          if (c.lng < minLng) minLng = c.lng;
          if (c.lng > maxLng) maxLng = c.lng;
        }
        const spanDist = haversineDistanceKm(minLat, minLng, maxLat, maxLng);
        return spanDist >= 0.05; // At least 50m of actual road travel
      });
  }, [activeSegments]);

  // Compute traversed polyline path up to currentIndex for dynamic playback progress
  const traversedPaths = useMemo(() => {
    if (!currentIndex || currentIndex <= 0 || activeGpsPoints.length < 2) {
      return [];
    }
    const traversedSlice = activeGpsPoints.slice(0, currentIndex + 1);
    const { segments } = splitPointsIntoSegments(traversedSlice, 15);
    return segments
      .map((seg) =>
        seg.points
          .filter((p) => isValidFleetCoord(p))
          .map((p) => ({ lat: p.lat, lng: p.lng }))
      )
      .filter((coords) => coords.length >= 2);
  }, [activeGpsPoints, currentIndex]);

  const vehicleKeyPrefix = selectedVehicle?.id || "v";

  return (
    <Map
      defaultCenter={defaultCenter}
      defaultZoom={DEFAULT_MAP_ZOOM}
      mapId={GOOGLE_MAPS_MAP_ID}
      gestureHandling="greedy"
      disableDefaultUI={false}
      mapTypeControl={true}
      streetViewControl={false}
      fullscreenControl={true}
      zoomControl={true}
      style={{ width: "100%", height: "100%" }}
    >
      {/* Base Segmented Historical GPS Trails */}
      {segmentPaths.map((coords, idx) => (
        <Fragment key={`base-seg-${vehicleKeyPrefix}-${selectedJourneyId}-${idx}`}>
          {/* Casing / Halo */}
          <Polyline
            key={`casing-${vehicleKeyPrefix}-${selectedJourneyId}-${idx}`}
            path={coords}
            strokeColor="#1E293B"
            strokeOpacity={0.35}
            strokeWeight={5.5}
            geodesic={true}
            zIndex={40}
          />
          {/* Primary GPS Line */}
          <Polyline
            key={`line-${vehicleKeyPrefix}-${selectedJourneyId}-${idx}`}
            path={coords}
            strokeColor={vehicleRouteColor}
            strokeOpacity={0.85}
            strokeWeight={4}
            geodesic={true}
            zIndex={50}
          />
        </Fragment>
      ))}

      {/* Traversed Playback Progress Polyline (Traces behind moving vehicle) */}
      {traversedPaths.map((coords, idx) => (
        <Fragment key={`trav-seg-${vehicleKeyPrefix}-${selectedJourneyId}-${idx}`}>
          <Polyline
            key={`trav-casing-${vehicleKeyPrefix}-${selectedJourneyId}-${idx}`}
            path={coords}
            strokeColor="#0F172A"
            strokeOpacity={0.6}
            strokeWeight={6.5}
            geodesic={true}
            zIndex={60}
          />
          <Polyline
            key={`trav-line-${vehicleKeyPrefix}-${selectedJourneyId}-${idx}`}
            path={coords}
            strokeColor="#1E1B4B"
            strokeOpacity={1.0}
            strokeWeight={4.8}
            geodesic={true}
            zIndex={70}
          />
        </Fragment>
      ))}

      {/* Stationary at Depot Marker (when vehicle points exist but no road polyline >= 50m) */}
      {segmentPaths.length === 0 && activeGpsPoints.length > 0 && isValidFleetCoord(activeGpsPoints[0]) && (
        <AdvancedMarker position={{ lat: activeGpsPoints[0].lat, lng: activeGpsPoints[0].lng }}>
          <div className="relative flex flex-col items-center justify-center cursor-pointer">
            <div
              className="h-9 w-9 rounded-full text-white flex items-center justify-center shadow-2xl border-2 border-white ring-4 ring-slate-200"
              style={{ backgroundColor: vehicleRouteColor }}
            >
              <Truck className="h-4 w-4" />
            </div>
            <div className="mt-1 bg-slate-900 text-white text-[10px] font-semibold px-2 py-0.5 rounded shadow whitespace-nowrap">
              {selectedVehicle?.number || "Vehicle"} · Stationary at Depot
            </div>
          </div>
        </AdvancedMarker>
      )}

      {/* Start Marker A (Emerald) */}
      {segmentPaths.length > 0 && activeGpsPoints.length > 0 &&
        isValidFleetCoord(activeGpsPoints[0]) && (
          <AdvancedMarker
            position={{ lat: activeGpsPoints[0].lat, lng: activeGpsPoints[0].lng }}
            title={`Journey Departure: ${formatIstTime(activeGpsPoints[0].recorded_at)}`}
          >
            <div className="h-6 w-6 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-[10px] shadow-lg border-2 border-white cursor-pointer hover:scale-125 transition-transform">
              A
            </div>
          </AdvancedMarker>
        )}

      {/* End Marker B (Slate) */}
      {segmentPaths.length > 0 && activeGpsPoints.length > 1 &&
        isValidFleetCoord(activeGpsPoints[activeGpsPoints.length - 1]) && (
          <AdvancedMarker
            position={{
              lat: activeGpsPoints[activeGpsPoints.length - 1].lat,
              lng: activeGpsPoints[activeGpsPoints.length - 1].lng,
            }}
            title={`Journey End: ${formatIstTime(
              activeGpsPoints[activeGpsPoints.length - 1].recorded_at
            )}`}
          >
            <div className="h-6 w-6 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-[10px] shadow-lg border-2 border-white cursor-pointer hover:scale-125 transition-transform">
              B
            </div>
          </AdvancedMarker>
        )}

      {/* Stop Markers (P, Amber) */}
      {timelineEvents
        .filter((e) => e.type === "stop" && isValidFleetCoord(e))
        .map((e) => (
          <AdvancedMarker
            key={e.id}
            position={{ lat: e.lat, lng: e.lng }}
            onClick={() => jumpToPointIndex(e.pointIndex)}
            title={e.title}
          >
            <div className="h-5 w-5 rounded-full bg-amber-500 text-white flex items-center justify-center text-[9px] font-bold shadow-md border border-white cursor-pointer hover:scale-125 transition-transform">
              P
            </div>
          </AdvancedMarker>
        ))}

      {/* Signal Gap Markers (!, Red) */}
      {timelineEvents
        .filter((e) => e.type === "gap" && isValidFleetCoord(e))
        .map((e) => (
          <AdvancedMarker
            key={e.id}
            position={{ lat: e.lat, lng: e.lng }}
            onClick={() => jumpToPointIndex(e.pointIndex)}
            title={e.title}
          >
            <div className="h-5 w-5 rounded-full bg-red-600 text-white flex items-center justify-center text-[9px] font-bold shadow-md border border-white cursor-pointer hover:scale-125 transition-transform">
              !
            </div>
          </AdvancedMarker>
        ))}

      {/* Vehicle Current Position Marker (when no playback points or stationary) */}
      {activeGpsPoints.length === 0 &&
        isValidFleetCoord(vehicleCurrentPosition) && (
          <AdvancedMarker
            position={{ lat: vehicleCurrentPosition.lat, lng: vehicleCurrentPosition.lng }}
          >
            <div className="relative flex items-center justify-center group cursor-pointer">
              <div
                className="h-9 w-9 rounded-full text-white flex items-center justify-center shadow-2xl border-2 border-white ring-4 ring-indigo-200"
                style={{ backgroundColor: vehicleRouteColor }}
              >
                <Truck className="h-4 w-4" />
              </div>
              <div className="absolute -top-7 bg-slate-900 text-white text-[10px] font-semibold px-2 py-0.5 rounded shadow whitespace-nowrap pointer-events-none">
                {selectedVehicle?.number || "Vehicle"} ({vehicleCurrentPosition.status})
              </div>
            </div>
          </AdvancedMarker>
        )}

      {/* ACTIVE PLAYBACK VEHICLE MARKER */}
      {isValidFleetCoord(currentPoint) && (
        <AdvancedMarker position={{ lat: currentPoint.lat, lng: currentPoint.lng }}>
          <div className="relative flex items-center justify-center">
            <div
              className="h-9 w-9 rounded-full text-white flex items-center justify-center shadow-2xl border-2 border-white ring-4 ring-indigo-300 animate-pulse"
              style={{ backgroundColor: vehicleRouteColor }}
            >
              <Navigation className="h-5 w-5" />
            </div>
          </div>
        </AdvancedMarker>
      )}
    </Map>
  );
}
