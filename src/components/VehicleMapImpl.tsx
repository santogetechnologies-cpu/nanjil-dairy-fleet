import { useState, useMemo, useEffect, useRef } from "react";
import Map, {
  Marker,
  Popup,
  NavigationControl,
  ScaleControl,
  Source,
  Layer,
  MapRef,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Vehicle } from "@/lib/types";
import { Truck, Navigation, MapPin, AlertTriangle, AlertCircle } from "lucide-react";
import { Badge } from "./ui-kit";
import { Link } from "react-router-dom";
import { getOverspeedStatus } from "@/lib/overspeed";

interface Props {
  vehicles: Vehicle[];
  height?: number;
  selectedId?: string;
  onSelectVehicle?: (vehicle: Vehicle) => void;
  routeHistory?: Array<{ lat: number; lng: number }>;
}

const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

/**
 * Safely resolves the display registration number for a vehicle.
 * Ensures that a raw device ID or 15-digit hardware ID is NEVER shown as the registration number.
 */
function getVehicleRegistrationNumber(v?: Vehicle | null): string {
  if (!v) return "Unassigned Vehicle";
  const num = (v.number || "").trim();
  const devId = (v.deviceId || "").trim();
  if (!num || num === devId || /^\d{15}$/.test(num)) {
    return "Unassigned Vehicle";
  }
  return num;
}

export default function VehicleMapImpl({
  vehicles,
  height = 520,
  selectedId,
  onSelectVehicle,
  routeHistory,
}: Props) {
  const mapRef = useRef<MapRef>(null);

  const [active, setActive] = useState<Vehicle | null>(
    selectedId ? (vehicles.find((v) => v.id === selectedId) ?? null) : null,
  );

  useEffect(() => {
    if (selectedId) {
      const match = vehicles.find((v) => v.id === selectedId);
      if (match) {
        setActive(match);
        if (typeof match.lng === "number" && typeof match.lat === "number" && mapRef.current) {
          mapRef.current.flyTo({
            center: [match.lng, match.lat],
            zoom: 13.5,
            duration: 800,
          });
        }
      }
    }
  }, [selectedId, vehicles]);

  // Only show vehicles that have actual valid numeric GPS coordinates within geographic bounds
  const mappedVehicles = useMemo(() => {
    return vehicles.filter(
      (v) =>
        v.lat != null &&
        typeof v.lat === "number" &&
        !isNaN(v.lat) &&
        v.lat >= -90 &&
        v.lat <= 90 &&
        v.lng != null &&
        typeof v.lng === "number" &&
        !isNaN(v.lng) &&
        v.lng >= -180 &&
        v.lng <= 180 &&
        (v.lat !== 0 || v.lng !== 0),
    );
  }, [vehicles]);

  const initial = useMemo(() => {
    if (selectedId) {
      const v = mappedVehicles.find((x) => x.id === selectedId);
      if (v) return { longitude: v.lng, latitude: v.lat, zoom: 13 };
    }
    if (mappedVehicles.length) {
      const lat = mappedVehicles.reduce((s, v) => s + v.lat, 0) / mappedVehicles.length;
      const lng = mappedVehicles.reduce((s, v) => s + v.lng, 0) / mappedVehicles.length;
      return { longitude: lng, latitude: lat, zoom: 11 };
    }
    // Default base point: Nanjil Dairy Plant
    return { longitude: 77.28837309537465, latitude: 8.260765379365829, zoom: 11.5 };
  }, [mappedVehicles, selectedId]);

  const [realRoadCoords, setRealRoadCoords] = useState<[number, number][] | null>(null);

  const targetVehicle =
    active || (selectedId ? mappedVehicles.find((v) => v.id === selectedId) : null);

  useEffect(() => {
    if (
      !targetVehicle ||
      typeof targetVehicle.lat !== "number" ||
      typeof targetVehicle.lng !== "number" ||
      isNaN(targetVehicle.lat) ||
      isNaN(targetVehicle.lng)
    ) {
      setRealRoadCoords(null);
      return;
    }

    let isSubscribed = true;

    if (!routeHistory || routeHistory.length === 0) {
      setRealRoadCoords(null);
      return;
    }

    const firstPt = routeHistory[0];
    if (
      !firstPt ||
      typeof firstPt.lng !== "number" ||
      typeof firstPt.lat !== "number" ||
      isNaN(firstPt.lng) ||
      isNaN(firstPt.lat)
    ) {
      setRealRoadCoords(null);
      return;
    }

    const startLng = firstPt.lng;
    const startLat = firstPt.lat;
    const endLng = targetVehicle.lng;
    const endLat = targetVehicle.lat;

    if (Math.abs(startLng - endLng) < 0.0001 && Math.abs(startLat - endLat) < 0.0001) {
      setRealRoadCoords(null);
      return;
    }

    async function fetchRealRoadRoute() {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        if (!res.ok) return;
        const json = await res.json();
        if (json.routes && json.routes.length > 0 && json.routes[0].geometry?.coordinates) {
          if (isSubscribed) {
            setRealRoadCoords(json.routes[0].geometry.coordinates);
          }
        }
      } catch (e) {
        // Fallback gracefully
      }
    }

    fetchRealRoadRoute();

    return () => {
      isSubscribed = false;
    };
  }, [targetVehicle, routeHistory]);

  // Build Route Polyline GeoJSON for the active / selected vehicle
  const routeGeoJson = useMemo(() => {
    if (
      !targetVehicle ||
      typeof targetVehicle.lat !== "number" ||
      typeof targetVehicle.lng !== "number" ||
      isNaN(targetVehicle.lat) ||
      isNaN(targetVehicle.lng)
    ) {
      return null;
    }

    let coordinates: [number, number][] = [];

    if (realRoadCoords && realRoadCoords.length > 0) {
      coordinates = realRoadCoords;
    } else if (routeHistory && routeHistory.length > 0) {
      const validPoints = routeHistory.filter(
        (pt) =>
          pt &&
          typeof pt.lat === "number" &&
          !isNaN(pt.lat) &&
          typeof pt.lng === "number" &&
          !isNaN(pt.lng),
      );
      if (validPoints.length > 0) {
        coordinates = validPoints.map((pt) => [pt.lng, pt.lat]);
        coordinates.push([targetVehicle.lng, targetVehicle.lat]);
      }
    }

    if (coordinates.length < 2) {
      return null;
    }

    return {
      type: "Feature" as const,
      properties: { number: getVehicleRegistrationNumber(targetVehicle) },
      geometry: {
        type: "LineString" as const,
        coordinates: coordinates,
      },
    };
  }, [targetVehicle, realRoadCoords, routeHistory]);

  const startPoint = useMemo(() => {
    if (!routeGeoJson || !routeGeoJson.geometry.coordinates.length) return null;
    const coords = routeGeoJson.geometry.coordinates[0];
    return { lng: coords[0], lat: coords[1] };
  }, [routeGeoJson]);

  const color = (s: Vehicle["status"]) =>
    s === "Moving"
      ? "var(--color-success)"
      : s === "Idle"
        ? "var(--color-warning)"
        : s === "Parked"
          ? "var(--color-muted-foreground)"
          : "var(--color-destructive)";

  return (
    <div className="relative rounded-lg overflow-hidden border border-border" style={{ height }}>
      <Map
        ref={mapRef}
        initialViewState={initial}
        mapStyle={MAP_STYLE}
        attributionControl={{ compact: true }}
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="top-left" />
        <ScaleControl position="bottom-right" />

        {/* Route Trajectory Polyline */}
        {routeGeoJson && (
          <Source id="route-path-source" type="geojson" data={routeGeoJson}>
            <Layer
              id="route-path-glow"
              type="line"
              paint={{
                "line-color": "#3b82f6",
                "line-width": 6,
                "line-opacity": 0.35,
              }}
            />
            <Layer
              id="route-path-line"
              type="line"
              paint={{
                "line-color": "#2563eb",
                "line-width": 3.5,
                "line-dasharray": [2, 1],
              }}
            />
          </Source>
        )}

        {/* Nanjil Dairy Plant Base Point Pin Marker */}
        <Marker longitude={77.28837309537465} latitude={8.260765379365829} anchor="bottom">
          <div className="flex items-center gap-1.5 bg-amber-600 text-white px-2 py-1 rounded-md text-[11px] font-bold shadow-lg border-2 border-white ring-2 ring-amber-600/30">
            <Truck className="h-3.5 w-3.5" />
            <span>Nanjil Dairy Plant (Base Point)</span>
          </div>
        </Marker>

        {/* Route Start Point Pin Marker */}
        {startPoint && active && (
          <Marker longitude={startPoint.lng} latitude={startPoint.lat} anchor="center">
            <div className="flex items-center gap-1 bg-primary/90 text-primary-foreground px-2 py-0.5 rounded text-[10px] font-semibold shadow-md border border-white">
              <MapPin className="h-3 w-3" />
              <span>Route Origin</span>
            </div>
          </Marker>
        )}

        {/* Live Vehicle Pins */}
        {mappedVehicles.map((v) => {
          const isSelected = active?.id === v.id || selectedId === v.id;
          const overspeed = getOverspeedStatus(v.speed);

          return (
            <Marker
              key={v.id}
              longitude={v.lng}
              latitude={v.lat}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setActive(v);
                if (onSelectVehicle) onSelectVehicle(v);
                if (typeof v.lng === "number" && typeof v.lat === "number" && mapRef.current) {
                  mapRef.current.flyTo({
                    center: [v.lng, v.lat],
                    zoom: 14,
                    duration: 800,
                  });
                }
              }}
            >
              <button className="group relative cursor-pointer focus:outline-none flex flex-col items-center">
                {v.status === "Moving" && (
                  <span
                    className="absolute -inset-1.5 rounded-full animate-ping"
                    style={{ background: color(v.status), opacity: 0.4 }}
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
                  style={{ background: color(v.status) }}
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
              </button>
            </Marker>
          );
        })}

        {active &&
          typeof active.lat === "number" &&
          active.lat >= -90 &&
          active.lat <= 90 &&
          typeof active.lng === "number" &&
          active.lng >= -180 &&
          active.lng <= 180 &&
          (() => {
          const activeOverspeed = getOverspeedStatus(active.speed);
          return (
            <Popup
              longitude={active.lng}
              latitude={active.lat}
              anchor="top"
              offset={24}
              onClose={() => setActive(null)}
              closeOnClick={false}
              maxWidth="320px"
            >
              <div className="w-68 p-1.5 space-y-2.5">
                {/* Vehicle Registration Number Header */}
                <div className="flex items-start justify-between gap-2 border-b border-border/60 pb-2">
                  <div>
                    <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1">
                      <Truck className="h-3 w-3 text-primary" />
                      <span>Vehicle Registration No.</span>
                    </div>
                    <div className="mt-1 inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-400 text-black border-2 border-black/80 font-mono font-black text-sm tracking-wider shadow-sm">
                      <span className="text-[9px] font-sans font-bold bg-black text-amber-400 px-1 py-0.5 rounded-xs leading-none">
                        IND
                      </span>
                      <span>{getVehicleRegistrationNumber(active)}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {active.type} · {active.model}
                    </div>
                  </div>
                  <Badge status={active.status}>{active.status}</Badge>
                </div>

                {/* Overspeed Warning Alert Banner */}
                {activeOverspeed.level === "warning" && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-orange-500/15 border border-orange-500/30 text-orange-700 dark:text-orange-300 text-xs font-semibold">
                    <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="leading-tight">⚠ Overspeed Warning</div>
                      <div className="text-[10px] font-normal text-orange-600/90 dark:text-orange-400/90">
                        {active.speed} km/h (Warning threshold: 80 km/h)
                      </div>
                    </div>
                  </div>
                )}
                {activeOverspeed.level === "critical" && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-red-500/15 border border-red-500/40 text-red-700 dark:text-red-300 text-xs font-bold animate-pulse">
                    <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="leading-tight">⚠ Critical Overspeed</div>
                      <div className="text-[10px] font-normal text-red-600/90 dark:text-red-400/90">
                        {active.speed} km/h (Critical threshold: 100 km/h)
                      </div>
                    </div>
                  </div>
                )}

                {/* Telemetry Metrics */}
                <div className="grid grid-cols-2 gap-2 text-xs bg-muted/40 p-2.5 rounded-md border border-border/60">
                  <div>
                    <div className="text-[10px] text-muted-foreground">Driver</div>
                    <div className="font-semibold text-foreground truncate">
                      {active.driver || "Unassigned"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Speed</div>
                    <div
                      className={`font-semibold ${
                        activeOverspeed.level === "critical"
                          ? "text-red-600 font-bold"
                          : activeOverspeed.level === "warning"
                            ? "text-orange-600 font-semibold"
                            : "text-foreground"
                      }`}
                    >
                      {active.speed} km/h
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Avg Speed</div>
                    <div className="font-semibold text-foreground">
                      {active.averageSpeed != null && active.averageSpeed > 0 ? `${active.averageSpeed.toFixed(1)} km/h` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Fuel Level</div>
                    <div className="font-semibold text-foreground">{active.fuel}%</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Odometer</div>
                    <div className="font-semibold text-foreground">
                      {active.odometer ? `${active.odometer.toLocaleString()} km` : "—"}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-[10px] text-muted-foreground">Current Sector</div>
                    <div className="font-medium text-foreground truncate">
                      {active.location || "Live GPS Location"}
                    </div>
                  </div>
                  <div className="col-span-2 text-[10px] text-muted-foreground font-mono truncate border-t border-border/40 pt-1 mt-0.5 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                    <span>Device ID: {active.deviceId || "—"}</span>
                  </div>
                </div>

                {/* Action Links */}
                <div className="flex gap-2 pt-0.5">
                  {active.id && !active.id.startsWith("unassigned-") ? (
                    <Link
                      to={`/vehicles/${active.id}`}
                      className="flex-1 text-center text-xs font-semibold bg-primary text-primary-foreground rounded-md py-1.5 hover:bg-primary/90 transition-colors shadow-sm"
                    >
                      Inspect Telemetry →
                    </Link>
                  ) : (
                    <div className="flex-1 text-center text-xs font-medium text-muted-foreground bg-muted/60 rounded-md py-1.5 border border-border/40">
                      Unassigned Device (Telemetry Only)
                    </div>
                  )}
                </div>
              </div>
            </Popup>
          );
        })()}
      </Map>

      {/* Legend & Tracking Notice */}
      <div className="absolute bottom-3 left-3 z-10 bg-card/95 backdrop-blur border border-border rounded-md px-3 py-2 text-xs flex items-center gap-3 shadow">
        {(["Moving", "Idle", "Parked", "Offline"] as const).map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: color(s) }} />
            <span className="font-medium text-foreground">{s}</span>
          </div>
        ))}
        {active && (
          <div className="pl-2 border-l border-border text-primary font-semibold flex items-center gap-1">
            <Navigation className="h-3 w-3 animate-pulse" />
            <span>
              Tracking Route:{" "}
              <strong className="font-mono">{getVehicleRegistrationNumber(active)}</strong>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
