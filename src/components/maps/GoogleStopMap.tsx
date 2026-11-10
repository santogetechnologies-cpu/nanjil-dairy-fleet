import { useMemo } from "react";
import { Map, AdvancedMarker } from "@vis.gl/react-google-maps";
import { MapPin } from "lucide-react";
import { GOOGLE_MAPS_MAP_ID, GOOGLE_MAPS_API_KEY } from "./mapConstants";

export interface GoogleStopMapProps {
  lat: number;
  lng: number;
  vehicleNumber?: string;
  status?: string;
  engineOn?: boolean;
  location?: string;
  height?: number | string;
}

export function GoogleStopMap({
  lat,
  lng,
  vehicleNumber = "Fleet Vehicle",
  status = "COMPLETED",
  engineOn = false,
  location,
  height = "100%",
}: GoogleStopMapProps) {
  const center = useMemo(() => ({ lat, lng }), [lat, lng]);

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full p-4 text-center bg-slate-50 border border-slate-200">
        <p className="text-xs text-slate-500">Google Maps API key required to view stop map.</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ height }}>
      <Map
        defaultCenter={center}
        defaultZoom={15}
        mapId={GOOGLE_MAPS_MAP_ID}
        gestureHandling="greedy"
        disableDefaultUI={false}
        mapTypeControl={true}
        streetViewControl={false}
        fullscreenControl={true}
        zoomControl={true}
        style={{ width: "100%", height: "100%" }}
      >
        <AdvancedMarker position={center} title={`${vehicleNumber} (${status})`}>
          <div className="flex flex-col items-center group cursor-pointer">
            <div className="flex items-center gap-1.5 bg-slate-900 text-white px-2.5 py-1 rounded-xl text-xs font-bold shadow-xl border-2 border-white ring-4 ring-indigo-500/20 whitespace-nowrap">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
              <span>{vehicleNumber}</span>
              <span className="text-[10px] font-normal text-slate-400">({status})</span>
            </div>
            <div className="h-7 w-7 rounded-full bg-amber-500 text-white flex items-center justify-center shadow-lg border-2 border-white mt-1">
              <MapPin className="h-4 w-4" />
            </div>
          </div>
        </AdvancedMarker>
      </Map>

      {/* Coordinate Badge */}
      <div className="absolute bottom-3 right-3 bg-white/90 backdrop-blur-xs px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] font-mono text-slate-600 shadow-sm pointer-events-none z-10">
        {lat.toFixed(6)}° N, {lng.toFixed(6)}° E
      </div>
    </div>
  );
}

