import { useMemo, useEffect } from "react";
import {
  Map,
  AdvancedMarker,
  Polyline,
  useMap,
  type MapMouseEvent,
} from "@vis.gl/react-google-maps";
import { MapPin, CheckCircle2, Navigation } from "lucide-react";
import {
  NANJIL_DAIRY_DEPOT,
  DEFAULT_MAP_ZOOM,
  GOOGLE_MAPS_MAP_ID,
  GOOGLE_MAPS_API_KEY,
} from "./mapConstants";

export interface RouteStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  serviceDurationMins?: number;
  isMandatory?: boolean;
  status?: string;
}

export type CoordinateInput = { lat: number; lng: number } | [number, number];

export interface GoogleRoutePlannerMapProps {
  outboundCoordinates?: CoordinateInput[] | null;
  returnCoordinates?: CoordinateInput[] | null;
  startPoint?: { lat: number; lng: number; name?: string };
  destinationPoint?: { lat: number; lng: number; name?: string };
  outboundStops?: RouteStop[];
  returnStops?: RouteStop[];
  roundTripType?: "same_path" | "different_path" | "one_way";
  activeStopId?: string | null;
  onSelectStop?: (id: string) => void;
  onMapClick?: (e: { lngLat: { lng: number; lat: number } }) => void;
  interactive?: boolean;
  activeVehicle?: { lat: number; lng: number; [key: string]: any } | null;
  height?: number | string;
}

function normalizeCoords(coords?: CoordinateInput[] | null): Array<{ lat: number; lng: number }> {
  if (!coords || !coords.length) return [];
  return coords
    .map((c) => {
      if (Array.isArray(c)) {
        return { lng: c[0], lat: c[1] };
      }
      return c;
    })
    .filter((c) => typeof c.lat === "number" && typeof c.lng === "number" && !isNaN(c.lat) && !isNaN(c.lng));
}

function RouteBoundsFitter({ points }: { points: Array<{ lat: number; lng: number }> }) {
  const map = useMap();
  useEffect(() => {
    if (!map || points.length < 2) return;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;

    points.forEach((p) => {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    });

    if (minLat !== Infinity && maxLat !== -Infinity && minLng !== Infinity && maxLng !== -Infinity) {
      map.fitBounds(
        {
          north: maxLat,
          south: minLat,
          east: maxLng,
          west: minLng,
        },
        50
      );
    }
  }, [map, points]);

  return null;
}

export function GoogleRoutePlannerMap({
  outboundCoordinates = [],
  returnCoordinates = [],
  startPoint = NANJIL_DAIRY_DEPOT,
  destinationPoint,
  outboundStops = [],
  returnStops = [],
  roundTripType = "same_path",
  activeStopId,
  onSelectStop,
  onMapClick,
  interactive = true,
  activeVehicle,
  height = "100%",
}: GoogleRoutePlannerMapProps) {
  const normalizedOutbound = useMemo(() => normalizeCoords(outboundCoordinates), [outboundCoordinates]);
  const normalizedReturn = useMemo(() => normalizeCoords(returnCoordinates), [returnCoordinates]);

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div
        className="flex flex-col items-center justify-center w-full p-6 text-center bg-slate-50 border border-slate-200 rounded-xl"
        style={{ height }}
      >
        <p className="text-xs text-slate-500">Google Maps API key required for route planning.</p>
      </div>
    );
  }

  const allPointsToFit = useMemo(() => {
    const list: Array<{ lat: number; lng: number }> = [];
    if (normalizedOutbound.length > 0) {
      list.push(...normalizedOutbound);
    } else {
      if (startPoint) list.push({ lat: startPoint.lat, lng: startPoint.lng });
      if (destinationPoint) list.push({ lat: destinationPoint.lat, lng: destinationPoint.lng });
      outboundStops.forEach((s) => list.push({ lat: s.lat, lng: s.lng }));
    }
    if (roundTripType === "different_path" && normalizedReturn.length > 0) {
      list.push(...normalizedReturn);
    }
    if (activeVehicle && typeof activeVehicle.lat === "number" && typeof activeVehicle.lng === "number") {
      list.push({ lat: activeVehicle.lat, lng: activeVehicle.lng });
    }
    return list;
  }, [normalizedOutbound, normalizedReturn, startPoint, destinationPoint, outboundStops, roundTripType, activeVehicle]);

  const handleMapClick = (e: MapMouseEvent) => {
    if (!interactive || !onMapClick || !e.detail.latLng) return;
    onMapClick({
      lngLat: {
        lat: e.detail.latLng.lat,
        lng: e.detail.latLng.lng,
      },
    });
  };

  return (
    <div className="relative w-full overflow-hidden" style={{ height }}>
      <Map
        defaultCenter={startPoint ? { lat: startPoint.lat, lng: startPoint.lng } : NANJIL_DAIRY_DEPOT}
        defaultZoom={DEFAULT_MAP_ZOOM}
        mapId={GOOGLE_MAPS_MAP_ID}
        gestureHandling="greedy"
        disableDefaultUI={false}
        mapTypeControl={true}
        streetViewControl={false}
        fullscreenControl={true}
        zoomControl={true}
        onClick={handleMapClick}
        style={{ width: "100%", height: "100%" }}
      >
        <RouteBoundsFitter points={allPointsToFit} />

        {/* Outbound Road Polyline */}
        {normalizedOutbound.length >= 2 && (
          <>
            <Polyline
              path={normalizedOutbound}
              strokeColor="#1E1B4B"
              strokeOpacity={0.4}
              strokeWeight={6}
            />
            <Polyline
              path={normalizedOutbound}
              strokeColor="#3B82F6"
              strokeOpacity={0.95}
              strokeWeight={4}
            />
          </>
        )}

        {/* Return Road Polyline (Different Path) */}
        {roundTripType === "different_path" && normalizedReturn.length >= 2 && (
          <>
            <Polyline
              path={normalizedReturn}
              strokeColor="#064E3B"
              strokeOpacity={0.35}
              strokeWeight={5}
            />
            <Polyline
              path={normalizedReturn}
              strokeColor="#10B981"
              strokeOpacity={0.95}
              strokeWeight={3.5}
            />
          </>
        )}

        {/* Start Point Marker (Depot) */}
        {startPoint && (
          <AdvancedMarker position={{ lat: startPoint.lat, lng: startPoint.lng }}>
            <div className="flex flex-col items-center group cursor-pointer">
              <div className="bg-slate-900 text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow-md border border-slate-700 whitespace-nowrap">
                DEPOT (ORIGIN)
              </div>
              <div className="h-6 w-6 rounded-full bg-slate-900 text-white flex items-center justify-center shadow-lg border-2 border-white">
                <MapPin className="h-3.5 w-3.5" />
              </div>
            </div>
          </AdvancedMarker>
        )}

        {/* Destination Marker */}
        {destinationPoint && (
          <AdvancedMarker position={{ lat: destinationPoint.lat, lng: destinationPoint.lng }}>
            <div className="flex flex-col items-center group cursor-pointer">
              <div className="bg-amber-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow-md border border-amber-700 whitespace-nowrap">
                DESTINATION
              </div>
              <div className="h-6 w-6 rounded-full bg-amber-600 text-white flex items-center justify-center shadow-lg border-2 border-white">
                <CheckCircle2 className="h-3.5 w-3.5" />
              </div>
            </div>
          </AdvancedMarker>
        )}

        {/* Outbound Stops */}
        {outboundStops.map((stop, idx) => {
          const isSelected = activeStopId === stop.id;
          return (
            <AdvancedMarker
              key={stop.id}
              position={{ lat: stop.lat, lng: stop.lng }}
              onClick={() => onSelectStop?.(stop.id)}
              title={`${idx + 1}. ${stop.name} (${stop.isMandatory ? "Mandatory" : "Optional"})`}
            >
              <div
                className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold shadow-md cursor-pointer transition-transform hover:scale-125 border-2 ${
                  isSelected
                    ? "bg-indigo-700 text-white border-white ring-2 ring-indigo-400 scale-125"
                    : stop.isMandatory
                    ? "bg-indigo-600 text-white border-white"
                    : "bg-amber-100 text-amber-800 border-amber-500"
                }`}
              >
                {idx + 1}
              </div>
            </AdvancedMarker>
          );
        })}

        {/* Return Specific Stops */}
        {roundTripType === "different_path" &&
          returnStops.map((stop, idx) => (
            <AdvancedMarker
              key={stop.id}
              position={{ lat: stop.lat, lng: stop.lng }}
              onClick={() => onSelectStop?.(stop.id)}
              title={`Return #${idx + 1}: ${stop.name}`}
            >
              <div className="h-6 w-6 rounded-full bg-emerald-600 text-white border-2 border-white flex items-center justify-center text-[10px] font-bold shadow-md cursor-pointer transition-transform hover:scale-125">
                R{idx + 1}
              </div>
            </AdvancedMarker>
          ))}

        {/* Active Vehicle Marker (for Execution view) */}
        {activeVehicle &&
          typeof activeVehicle.lat === "number" &&
          typeof activeVehicle.lng === "number" && (
            <AdvancedMarker position={{ lat: activeVehicle.lat, lng: activeVehicle.lng }}>
              <div className="h-8 w-8 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-lg ring-4 ring-emerald-300 animate-pulse">
                <Navigation className="h-4 w-4" />
              </div>
            </AdvancedMarker>
          )}
      </Map>
    </div>
  );
}
