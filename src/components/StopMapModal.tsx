/**
 * StopMapModal.tsx — Interactive GPS Map Modal for Vehicle Stops
 *
 * Displays exact stop location, coordinates, duration, vehicle, and driver
 * information using MapLibre GL.
 */

import { useRef, useEffect } from "react";
import Map, { Marker, NavigationControl, ScaleControl, MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  X,
  MapPin,
  Truck,
  User,
  Clock,
  Gauge,
  Calendar,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui-kit";
import type { VehicleStopEvent } from "@/lib/vehicle-stop-detection";

interface Props {
  stop: VehicleStopEvent | null;
  onClose: () => void;
}

const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

export function formatStopDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function StopMapModal({ stop, onClose }: Props) {
  const mapRef = useRef<MapRef>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!stop) return null;

  const lat = stop.start_lat || 8.1833;
  const lng = stop.start_lng || 77.4119;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-4xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <MapPin className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">
                  {stop.vehicle_number || "Fleet Vehicle"}
                </h3>
                <Badge
                  variant="outline"
                  className={
                    stop.status === "ACTIVE"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-300 font-bold animate-pulse"
                      : stop.status === "COMPLETED"
                      ? "bg-slate-100 text-slate-700 border-slate-200"
                      : "bg-amber-50 text-amber-700 border-amber-300 font-semibold"
                  }
                >
                  {stop.status}
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    stop.engine_on
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "bg-blue-50 text-blue-700 border-blue-200"
                  }
                >
                  {stop.engine_on ? "Idle (Engine ON)" : "Parked (Engine OFF)"}
                </Badge>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Stop Location & Telemetry Audit · {stop.location || "Nagercoil District"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content: Map & Info Panel */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0">
          {/* Map Area */}
          <div className="flex-1 h-[360px] md:h-[480px] relative bg-slate-100">
            <Map
              ref={mapRef}
              initialViewState={{
                longitude: lng,
                latitude: lat,
                zoom: 14,
              }}
              mapStyle={MAP_STYLE}
              style={{ width: "100%", height: "100%" }}
            >
              <NavigationControl position="top-right" />
              <ScaleControl position="bottom-left" />

              <Marker longitude={lng} latitude={lat} anchor="bottom">
                <div className="relative flex flex-col items-center group cursor-pointer">
                  <div className="px-2 py-1 rounded-md bg-slate-900 text-white text-[11px] font-bold shadow-md whitespace-nowrap mb-1">
                    {stop.vehicle_number || "Vehicle"} ({formatStopDuration(stop.duration_seconds)})
                  </div>
                  <div className="h-8 w-8 rounded-full bg-red-600 border-2 border-white text-white flex items-center justify-center shadow-lg animate-bounce">
                    <MapPin className="h-4 w-4" />
                  </div>
                </div>
              </Marker>
            </Map>

            {/* Coordinates Pill */}
            <div className="absolute bottom-3 right-3 bg-white/90 backdrop-blur-xs px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] font-mono text-slate-600 shadow-sm">
              {lat.toFixed(6)}° N, {lng.toFixed(6)}° E
            </div>
          </div>

          {/* Details Sidebar */}
          <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-slate-100 p-5 space-y-4 overflow-y-auto bg-white">
            <div>
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Stop Telemetry Summary
              </div>
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Duration:</span>
                  <span className="font-bold text-slate-900 text-sm">
                    {formatStopDuration(stop.duration_seconds)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Started:</span>
                  <span className="font-semibold text-slate-800">
                    {new Date(stop.started_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Ended:</span>
                  <span className="font-semibold text-slate-800">
                    {stop.ended_at
                      ? new Date(stop.ended_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })
                      : "Currently Stationary"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Date:</span>
                  <span className="font-medium text-slate-700">
                    {new Date(stop.started_at).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Asset & Driver
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-100">
                  <Truck className="h-4 w-4 text-indigo-600 shrink-0" />
                  <div>
                    <div className="font-bold text-slate-900">{stop.vehicle_number}</div>
                    <div className="text-[11px] text-slate-400">{stop.vehicle_model || "Fleet Unit"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-100">
                  <User className="h-4 w-4 text-emerald-600 shrink-0" />
                  <div>
                    <div className="font-bold text-slate-900">{stop.driver_name || "Unassigned"}</div>
                    <div className="text-[11px] text-slate-400">Assigned Operator</div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Location Details
              </div>
              <div className="p-3 rounded-xl bg-slate-50 text-xs space-y-1">
                <div className="font-semibold text-slate-800">{stop.location || "En Route"}</div>
                <div className="text-[11px] font-mono text-slate-500">
                  GPS: {lat.toFixed(5)}, {lng.toFixed(5)}
                </div>
                <div className="text-[11px] text-slate-400 pt-1">
                  Source: <span className="capitalize">{stop.source || "GPS Telemetry"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold text-xs hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Close Map
          </button>
        </div>
      </div>
    </div>
  );
}

