import { useEffect, useMemo, useCallback } from "react";
import {
  Map,
  AdvancedMarker,
  Polyline,
  useMap,
} from "@vis.gl/react-google-maps";
import type { GpsPoint, RouteSegment, TimelineEvent } from "@/lib/tripHistoryEngine";
import type { Vehicle } from "@/lib/types";
import { Truck, Navigation } from "lucide-react";
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  GOOGLE_MAPS_MAP_ID,
  GOOGLE_MAPS_API_KEY,
} from "./mapConstants";

export interface GoogleTripHistoryMapProps {
  currentPoint?: GpsPoint | null;
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
    if (currentPoint && typeof currentPoint.lat === "number" && typeof currentPoint.lng === "number") {
      return { lat: currentPoint.lat, lng: currentPoint.lng };
    }
    if (vehicleCurrentPosition && typeof vehicleCurrentPosition.lat === "number" && typeof vehicleCurrentPosition.lng === "number") {
      return { lat: vehicleCurrentPosition.lat, lng: vehicleCurrentPosition.lng };
    }
    return DEFAULT_MAP_CENTER;
  }, [currentPoint, vehicleCurrentPosition]);

  // Fit bounds function for the entire route
  const fitRouteBounds = useCallback(() => {
    if (!map || activeGpsPoints.length === 0) return;

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;

    activeGpsPoints.forEach((p) => {
      if (typeof p.lat === "number" && typeof p.lng === "number" && !isNaN(p.lat) && !isNaN(p.lng)) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLng) minLng = p.lng;
        if (p.lng > maxLng) maxLng = p.lng;
      }
    });

    if (minLat !== Infinity && maxLat !== -Infinity && minLng !== Infinity && maxLng !== -Infinity) {
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
  }, [map, activeGpsPoints]);

  // Register fit bounds with parent if requested
  useEffect(() => {
    if (onRegisterFitBounds) {
      onRegisterFitBounds(fitRouteBounds);
    }
  }, [onRegisterFitBounds, fitRouteBounds]);

  // Auto-pan camera as playback progresses
  useEffect(() => {
    if (map && isPlaying && currentPoint && typeof currentPoint.lat === "number" && typeof currentPoint.lng === "number") {
      map.panTo({ lat: currentPoint.lat, lng: currentPoint.lng });
    }
  }, [map, isPlaying, currentPoint]);

  // Convert RouteSegments into Polyline coordinate arrays
  const segmentPaths = useMemo(() => {
    return activeSegments
      .map((segment) =>
        segment.points
          .filter(
            (p) =>
              p &&
              typeof p.lat === "number" &&
              typeof p.lng === "number" &&
              !isNaN(p.lat) &&
              !isNaN(p.lng)
          )
          .map((p) => ({ lat: p.lat, lng: p.lng }))
      )
      .filter((coords) => coords.length >= 2);
  }, [activeSegments]);

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
      {/* Segmented Historical GPS Trails (Breaks polyline at signal gaps!) */}
      {segmentPaths.map((coords, idx) => (
        <div key={`seg-wrapper-${idx}`}>
          {/* Casing / Shadow */}
          <Polyline
            key={`casing-${idx}`}
            path={coords}
            strokeColor="#1E293B"
            strokeOpacity={0.35}
            strokeWeight={5.5}
          />
          {/* Primary GPS Line */}
          <Polyline
            key={`line-${idx}`}
            path={coords}
            strokeColor="#2563EB"
            strokeOpacity={0.95}
            strokeWeight={3.8}
          />
        </div>
      ))}

      {/* Start Marker A (Emerald) */}
      {activeGpsPoints.length > 0 &&
        typeof activeGpsPoints[0]?.lng === "number" &&
        typeof activeGpsPoints[0]?.lat === "number" &&
        !isNaN(activeGpsPoints[0].lng) &&
        !isNaN(activeGpsPoints[0].lat) && (
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
      {activeGpsPoints.length > 1 &&
        typeof activeGpsPoints[activeGpsPoints.length - 1]?.lng === "number" &&
        typeof activeGpsPoints[activeGpsPoints.length - 1]?.lat === "number" &&
        !isNaN(activeGpsPoints[activeGpsPoints.length - 1].lng) &&
        !isNaN(activeGpsPoints[activeGpsPoints.length - 1].lat) && (
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
        .filter(
          (e) =>
            e.type === "stop" &&
            typeof e.lng === "number" &&
            typeof e.lat === "number" &&
            !isNaN(e.lng) &&
            !isNaN(e.lat)
        )
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
        .filter(
          (e) =>
            e.type === "gap" &&
            typeof e.lng === "number" &&
            typeof e.lat === "number" &&
            !isNaN(e.lng) &&
            !isNaN(e.lat)
        )
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
        vehicleCurrentPosition &&
        typeof vehicleCurrentPosition.lng === "number" &&
        typeof vehicleCurrentPosition.lat === "number" &&
        !isNaN(vehicleCurrentPosition.lng) &&
        !isNaN(vehicleCurrentPosition.lat) && (
          <AdvancedMarker
            position={{ lat: vehicleCurrentPosition.lat, lng: vehicleCurrentPosition.lng }}
          >
            <div className="relative flex items-center justify-center group cursor-pointer">
              <div className="h-9 w-9 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-2xl border-2 border-white ring-4 ring-indigo-200">
                <Truck className="h-4 w-4" />
              </div>
              <div className="absolute -top-7 bg-slate-900 text-white text-[10px] font-semibold px-2 py-0.5 rounded shadow whitespace-nowrap pointer-events-none">
                {selectedVehicle?.number || "Vehicle"} ({vehicleCurrentPosition.status})
              </div>
            </div>
          </AdvancedMarker>
        )}

      {/* ACTIVE PLAYBACK VEHICLE MARKER */}
      {currentPoint &&
        typeof currentPoint.lng === "number" &&
        typeof currentPoint.lat === "number" &&
        !isNaN(currentPoint.lng) &&
        !isNaN(currentPoint.lat) && (
          <AdvancedMarker position={{ lat: currentPoint.lat, lng: currentPoint.lng }}>
            <div className="relative flex items-center justify-center">
              <div className="h-9 w-9 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-2xl border-2 border-white ring-4 ring-indigo-300 animate-pulse">
                <Navigation className="h-5 w-5" />
              </div>
            </div>
          </AdvancedMarker>
        )}
    </Map>
  );
}

