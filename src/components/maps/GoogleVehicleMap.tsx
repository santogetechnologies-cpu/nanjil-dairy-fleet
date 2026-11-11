import { useState, useMemo, useEffect } from "react";
import {
  Map,
  AdvancedMarker,
  InfoWindow,
  Polyline,
  useMap,
} from "@vis.gl/react-google-maps";
import type { Vehicle } from "@/lib/types";
import { Truck, Navigation, MapPin, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui-kit";
import { Link } from "react-router-dom";
import { getOverspeedStatus } from "@/lib/overspeed";
import { isFleetOperatingCoordinate } from "@/lib/tripHistoryEngine";
import {
  NANJIL_DAIRY_DEPOT,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  GOOGLE_MAPS_MAP_ID,
  GOOGLE_MAPS_API_KEY,
  getVehicleStatusColor,
  getVehicleRegistrationNumber,
} from "./mapConstants";

export interface GoogleVehicleMapProps {
  vehicles: Vehicle[];
  height?: number;
  selectedId?: string;
  onSelectVehicle?: (vehicle: Vehicle) => void;
  routeHistory?: Array<{ lat: number; lng: number }>;
  todayRoutes?: Record<string, Array<Array<{ lat: number; lng: number }>>>;
}

export function GoogleVehicleMap({
  vehicles,
  height = 520,
  selectedId,
  onSelectVehicle,
  routeHistory,
  todayRoutes,
}: GoogleVehicleMapProps) {
  const map = useMap();

  const [active, setActive] = useState<Vehicle | null>(
    selectedId ? (vehicles.find((v) => v.id === selectedId) ?? null) : null,
  );

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div
        className="flex flex-col items-center justify-center w-full p-6 text-center bg-slate-50 border border-slate-200 rounded-xl"
        style={{ height }}
      >
        <div className="h-10 w-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center mb-2">
          <MapPin className="h-5 w-5" />
        </div>
        <h4 className="text-xs font-bold text-slate-800">Google Maps API Key Required</h4>
        <p className="text-[11px] text-slate-500 max-w-sm mt-1">
          Configure <code className="bg-slate-200 px-1 py-0.5 rounded text-[10px] font-mono">VITE_GOOGLE_MAPS_API_KEY</code> in <code className="bg-slate-200 px-1 py-0.5 rounded text-[10px] font-mono">.env</code>.
        </p>
      </div>
    );
  }

  // Only show vehicles that have actual valid numeric GPS coordinates within the fleet operating geofence
  const mappedVehicles = useMemo(() => {
    return vehicles.filter(
      (v) =>
        v.lat != null &&
        v.lng != null &&
        isFleetOperatingCoordinate(v.lat, v.lng),
    );
  }, [vehicles]);

  const initialCenter = useMemo(() => {
    if (selectedId) {
      const v = mappedVehicles.find((x) => x.id === selectedId);
      if (v) return { lat: v.lat, lng: v.lng };
    }
    if (mappedVehicles.length) {
      const lat = mappedVehicles.reduce((s, v) => s + v.lat, 0) / mappedVehicles.length;
      const lng = mappedVehicles.reduce((s, v) => s + v.lng, 0) / mappedVehicles.length;
      return { lat, lng };
    }
    return DEFAULT_MAP_CENTER;
  }, [mappedVehicles, selectedId]);

  // Handle selectedId camera pan
  useEffect(() => {
    if (selectedId && map) {
      const match = mappedVehicles.find((v) => v.id === selectedId);
      if (match) {
        setActive(match);
        map.panTo({ lat: match.lat, lng: match.lng });
        map.setZoom(14);
      }
    }
  }, [selectedId, mappedVehicles, map]);

  // Prepare Today's Travelled GPS Route Segments (Red Polyline, 5px, 0.9 opacity)
  const renderedRouteSegments = useMemo(() => {
    const list: Array<{
      key: string;
      path: Array<{ lat: number; lng: number }>;
      isSelected: boolean;
    }> = [];

    // 1. If todayRoutes map is provided, render all vehicle routes
    if (todayRoutes && Object.keys(todayRoutes).length > 0) {
      const renderedKeys = new Set<string>();

      mappedVehicles.forEach((v) => {
        const isSelected = v.id === selectedId || active?.id === v.id;
        const segments =
          todayRoutes[v.id] ||
          (v.deviceId ? todayRoutes[v.deviceId] : undefined);

        if (!segments || segments.length === 0) return;

        renderedKeys.add(v.id);
        if (v.deviceId) renderedKeys.add(v.deviceId);

        segments.forEach((seg, sIdx) => {
          if (seg && seg.length >= 2) {
            const cleanSeg = seg.filter((p) => isFleetOperatingCoordinate(p.lat, p.lng));
            if (cleanSeg.length >= 2) {
              list.push({
                key: `today-route-${v.id}-${sIdx}`,
                path: cleanSeg,
                isSelected,
              });
            }
          }
        });
      });

      // Also render any routes for vehicles in todayRoutes not explicitly in mappedVehicles (e.g. offline vehicles)
      if (!selectedId && mappedVehicles.length === vehicles.length) {
        Object.entries(todayRoutes).forEach(([key, segments]) => {
          if (renderedKeys.has(key)) return;
          renderedKeys.add(key);
          segments.forEach((seg, sIdx) => {
            if (seg && seg.length >= 2) {
              const cleanSeg = seg.filter((p) => isFleetOperatingCoordinate(p.lat, p.lng));
              if (cleanSeg.length >= 2) {
                list.push({
                  key: `today-route-extra-${key}-${sIdx}`,
                  path: cleanSeg,
                  isSelected: false,
                });
              }
            }
          });
        });
      }
    } else if (routeHistory && routeHistory.length >= 2) {
      // 2. Fallback to routeHistory for single-vehicle profiles / backward compatibility
      const cleanHistory = routeHistory.filter((p) => isFleetOperatingCoordinate(p.lat, p.lng));
      if (cleanHistory.length >= 2) {
        list.push({
          key: "legacy-route-history",
          path: cleanHistory,
          isSelected: Boolean(selectedId),
        });
      }
    }

    return list;
  }, [todayRoutes, mappedVehicles, vehicles.length, selectedId, active, routeHistory]);

  return (
    <div className="relative rounded-lg overflow-hidden border border-border" style={{ height }}>
      <Map
        defaultCenter={initialCenter}
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
        {/* Today's Travelled GPS Routes (Continuous RED Polylines) */}
        {renderedRouteSegments.map(({ key, path, isSelected }) => (
          <Polyline
            key={key}
            path={path}
            strokeColor="#FF0000"
            strokeOpacity={0.9}
            strokeWeight={5}
            geodesic={true}
            zIndex={isSelected ? 50 : 20}
          />
        ))}

        {/* Nanjil Dairy Plant Base Point Pin Marker */}
        <AdvancedMarker position={NANJIL_DAIRY_DEPOT}>
          <div className="flex items-center gap-1.5 bg-amber-600 text-white px-2 py-1 rounded-md text-[11px] font-bold shadow-lg border-2 border-white ring-2 ring-amber-600/30">
            <Truck className="h-3.5 w-3.5" />
            <span>Nanjil Dairy Plant (Base Point)</span>
          </div>
        </AdvancedMarker>

        {/* Live Vehicle Markers */}
        {mappedVehicles.map((v) => {
          const isSelected = active?.id === v.id || selectedId === v.id;
          const overspeed = getOverspeedStatus(v.speed);
          const statusBg = getVehicleStatusColor(v.status);

          return (
            <AdvancedMarker
              key={v.id}
              position={{ lat: v.lat, lng: v.lng }}
              onClick={() => {
                setActive(v);
                if (onSelectVehicle) onSelectVehicle(v);
                if (map) {
                  map.panTo({ lat: v.lat, lng: v.lng });
                  map.setZoom(14);
                }
              }}
            >
              <div className="group relative cursor-pointer focus:outline-none flex flex-col items-center">
                {v.status === "Moving" && (
                  <span
                    className="absolute -inset-1.5 rounded-full animate-ping pointer-events-none"
                    style={{ background: statusBg, opacity: 0.4 }}
                  />
                )}

                {/* Overspeed Pulsing Halo Ring */}
                {overspeed.level === "critical" && (
                  <span
                    className="absolute -inset-2.5 rounded-full animate-ping border-2 border-red-500 pointer-events-none"
                    style={{ background: "rgba(239, 68, 68, 0.35)" }}
                  />
                )}
                {overspeed.level === "warning" && (
                  <span
                    className="absolute -inset-2 rounded-full animate-pulse border-2 border-orange-500 pointer-events-none"
                    style={{ background: "rgba(249, 115, 22, 0.3)" }}
                  />
                )}

                <span
                  className={`relative flex items-center justify-center rounded-full text-white shadow-lg transition-transform ${
                    isSelected
                      ? "h-9 w-9 ring-4 ring-primary scale-110"
                      : overspeed.level === "critical"
                        ? "h-8 w-8 ring-4 ring-red-500 ring-offset-1 scale-105"
                        : overspeed.level === "warning"
                          ? "h-7.5 w-7.5 ring-3 ring-orange-500 ring-offset-1"
                          : "h-7 w-7 ring-2 ring-white"
                  }`}
                  style={{ background: statusBg }}
                >
                  <Truck className={isSelected ? "h-4 w-4" : "h-3.5 w-3.5"} />

                  {/* Warning Dot Badge on Pin */}
                  {overspeed.level === "critical" && (
                    <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-red-600 text-white flex items-center justify-center text-[9px] font-black shadow-sm ring-1 ring-white">
                      !
                    </span>
                  )}
                  {overspeed.level === "warning" && (
                    <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-orange-500 text-white flex items-center justify-center text-[8px] font-bold shadow-sm ring-1 ring-white">
                      !
                    </span>
                  )}
                </span>

                {/* Vehicle Registration Number Tag on Pin */}
                <span
                  className={`mt-1 whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] font-bold font-mono tracking-tight shadow-md border transition-all flex items-center gap-1 ${
                    isSelected
                      ? "bg-amber-400 text-black border-black ring-2 ring-amber-400/50 z-20 scale-105"
                      : overspeed.level === "critical"
                        ? "bg-red-50 text-red-700 border-red-500 ring-1 ring-red-500/50 z-20 dark:bg-red-950 dark:text-red-200"
                        : overspeed.level === "warning"
                          ? "bg-orange-50 text-orange-800 border-orange-500 ring-1 ring-orange-500/40 z-20 dark:bg-orange-950 dark:text-orange-200"
                          : "bg-background/95 text-foreground border-border/80 group-hover:bg-amber-400 group-hover:text-black group-hover:border-black z-10"
                  }`}
                >
                  <span
                    className={`text-[8px] px-0.5 rounded-xs font-sans ${
                      overspeed.level === "critical"
                        ? "bg-red-600 text-white font-bold"
                        : "bg-black text-amber-400"
                    }`}
                  >
                    IND
                  </span>
                  <span>{getVehicleRegistrationNumber(v)}</span>
                  {overspeed.level === "critical" && (
                    <span className="text-[9px] text-red-600 font-bold font-sans">⚡{Math.round(v.speed)}</span>
                  )}
                  {overspeed.level === "warning" && (
                    <span className="text-[9px] text-orange-600 font-semibold font-sans">⚠{Math.round(v.speed)}</span>
                  )}
                </span>
              </div>
            </AdvancedMarker>
          );
        })}

        {/* Active Vehicle InfoWindow */}
        {active &&
          typeof active.lat === "number" &&
          typeof active.lng === "number" &&
          (() => {
            const activeOverspeed = getOverspeedStatus(active.speed);
            return (
              <InfoWindow
                position={{ lat: active.lat, lng: active.lng }}
                onCloseClick={() => setActive(null)}
                pixelOffset={[0, -28]}
              >
                <div className="w-68 p-1 text-slate-900 space-y-2">
                  {/* Vehicle Registration Number Header */}
                  <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-2">
                    <div>
                      <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 flex items-center gap-1">
                        <Truck className="h-3 w-3 text-indigo-600" />
                        <span>Vehicle Registration No.</span>
                      </div>
                      <div className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-400 text-black border border-black/80 font-mono font-black text-xs tracking-wider shadow-xs">
                        <span className="text-[8px] font-sans font-bold bg-black text-amber-400 px-1 py-0.5 rounded-xs leading-none">
                          IND
                        </span>
                        <span>{getVehicleRegistrationNumber(active)}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        {active.type} · {active.model}
                      </div>
                    </div>
                    <Badge status={active.status}>{active.status}</Badge>
                  </div>

                  {/* Overspeed Warning Alert Banner */}
                  {activeOverspeed.level === "warning" && (
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-orange-50 border border-orange-200 text-orange-700 text-xs font-semibold">
                      <AlertTriangle className="h-3.5 w-3.5 text-orange-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="leading-tight text-[11px]">⚠ Overspeed Warning</div>
                        <div className="text-[10px] font-normal text-orange-600/90">
                          {active.speed} km/h (Limit: 60 km/h)
                        </div>
                      </div>
                    </div>
                  )}

                  {activeOverspeed.level === "critical" && (
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
                      <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="leading-tight text-[11px]">⚠ Critical Overspeed</div>
                        <div className="text-[10px] font-normal text-red-600/90">
                          {active.speed} km/h (Limit: 100 km/h)
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Telemetry Metrics */}
                  <div className="grid grid-cols-2 gap-1.5 text-xs bg-slate-50 p-2 rounded border border-slate-200">
                    <div>
                      <div className="text-[10px] text-slate-500">Driver</div>
                      <div className="font-semibold text-slate-800 truncate">
                        {active.driver || "Unassigned"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">Speed</div>
                      <div
                        className={`font-semibold ${
                          activeOverspeed.level === "critical"
                            ? "text-red-600 font-bold"
                            : activeOverspeed.level === "warning"
                              ? "text-orange-600 font-semibold"
                              : "text-slate-800"
                        }`}
                      >
                        {active.speed} km/h
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">Avg Speed</div>
                      <div className="font-semibold text-slate-800">
                        {active.averageSpeed != null && active.averageSpeed > 0 ? `${active.averageSpeed.toFixed(1)} km/h` : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">Fuel Level</div>
                      <div className="font-semibold text-slate-800">{active.fuel}%</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">Odometer</div>
                      <div className="font-semibold text-slate-800">
                        {active.odometer ? `${active.odometer.toLocaleString()} km` : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">Sector</div>
                      <div className="font-medium text-slate-800 truncate" title={active.location || "Live Location"}>
                        {active.location || "Live Location"}
                      </div>
                    </div>
                    <div className="col-span-2 text-[10px] text-slate-500 font-mono truncate border-t border-slate-200 pt-1 flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                      <span>Device ID: {active.deviceId || "—"}</span>
                    </div>
                  </div>

                  {/* Action Link */}
                  <div className="pt-1">
                    {active.id && !active.id.startsWith("unassigned-") ? (
                      <Link
                        to={`/vehicles/${active.id}`}
                        className="block text-center text-xs font-semibold bg-indigo-600 text-white rounded py-1 hover:bg-indigo-700 transition-colors shadow-xs"
                      >
                        Inspect Telemetry →
                      </Link>
                    ) : (
                      <div className="text-center text-xs text-slate-400 bg-slate-100 rounded py-1">
                        Unassigned Device
                      </div>
                    )}
                  </div>
                </div>
              </InfoWindow>
            );
          })()}
      </Map>

      {/* Legend & Tracking Notice */}
      <div className="absolute bottom-3 left-3 z-10 bg-card/95 backdrop-blur border border-border rounded-md px-3 py-2 text-xs flex items-center gap-3 shadow">
        {(["Moving", "Idle", "Parked", "Offline"] as const).map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: getVehicleStatusColor(s) }} />
            <span className="font-medium text-foreground">{s}</span>
          </div>
        ))}
        {active && (
          <div className="pl-2 border-l border-border text-primary font-semibold flex items-center gap-1">
            <Navigation className="h-3 w-3 animate-pulse" />
            <span>
              Tracking: <strong className="font-mono">{getVehicleRegistrationNumber(active)}</strong>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

