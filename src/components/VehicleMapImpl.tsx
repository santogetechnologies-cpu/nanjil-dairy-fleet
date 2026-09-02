import { useState, useMemo, useEffect, useRef } from "react";
import Map, { Marker, Popup, NavigationControl, ScaleControl, Source, Layer, MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Vehicle } from "@/lib/types";
import { Truck, Navigation, MapPin } from "lucide-react";
import { Badge } from "./ui-kit";
import { Link } from "react-router-dom";

interface Props {
  vehicles: Vehicle[];
  height?: number;
  selectedId?: string;
  onSelectVehicle?: (vehicle: Vehicle) => void;
  routeHistory?: Array<{ lat: number; lng: number }>;
}

const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

export default function VehicleMapImpl({
  vehicles,
  height = 520,
  selectedId,
  onSelectVehicle,
  routeHistory
}: Props) {
  const mapRef = useRef<MapRef>(null);

  const [active, setActive] = useState<Vehicle | null>(
    selectedId ? vehicles.find((v) => v.id === selectedId) ?? null : null
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
            duration: 800
          });
        }
      }
    }
  }, [selectedId, vehicles]);

  // Only show vehicles that have actual valid numeric GPS coordinates
  const mappedVehicles = useMemo(() => {
    return vehicles.filter(v =>
      v.lat != null && typeof v.lat === "number" && !isNaN(v.lat) &&
      v.lng != null && typeof v.lng === "number" && !isNaN(v.lng) &&
      (v.lat !== 0 || v.lng !== 0)
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

  const targetVehicle = active || (selectedId ? mappedVehicles.find(v => v.id === selectedId) : null);

  useEffect(() => {
    if (!targetVehicle || typeof targetVehicle.lat !== "number" || typeof targetVehicle.lng !== "number" || isNaN(targetVehicle.lat) || isNaN(targetVehicle.lng)) {
      setRealRoadCoords(null);
      return;
    }

    let isSubscribed = true;
    const startLng = (routeHistory && routeHistory.length > 0 && typeof routeHistory[0].lng === "number") ? routeHistory[0].lng : 77.28837309537465;
    const startLat = (routeHistory && routeHistory.length > 0 && typeof routeHistory[0].lat === "number") ? routeHistory[0].lat : 8.260765379365829;
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
    if (!targetVehicle || typeof targetVehicle.lat !== "number" || typeof targetVehicle.lng !== "number" || isNaN(targetVehicle.lat) || isNaN(targetVehicle.lng)) {
      return null;
    }

    let coordinates: [number, number][] = [];

    if (realRoadCoords && realRoadCoords.length > 0) {
      coordinates = realRoadCoords;
    } else if (routeHistory && routeHistory.length > 0) {
      const validPoints = routeHistory.filter(pt =>
        pt && typeof pt.lat === "number" && !isNaN(pt.lat) &&
        typeof pt.lng === "number" && !isNaN(pt.lng)
      );
      coordinates = validPoints.map(pt => [pt.lng, pt.lat]);
      coordinates.push([targetVehicle.lng, targetVehicle.lat]);
    } else {
      // Synthesize realistic route path waypoints leading from Nanjil Dairy Plant (77.28837309537465, 8.260765379365829) to vehicle's current location
      const baseLng = 77.28837309537465;
      const baseLat = 8.260765379365829;
      const endLng = targetVehicle.lng;
      const endLat = targetVehicle.lat;
      const stepLng = (endLng - baseLng) / 4;
      const stepLat = (endLat - baseLat) / 4;

      coordinates = [
        [baseLng, baseLat], // Nanjil Dairy Plant Base Point
        [baseLng + stepLng * 1, baseLat + stepLat * 1 + 0.005],
        [baseLng + stepLng * 2 - 0.003, baseLat + stepLat * 2],
        [baseLng + stepLng * 3, baseLat + stepLat * 3 + 0.002],
        [endLng, endLat] // Current Live Location
      ];
    }

    return {
      type: "Feature" as const,
      properties: { number: targetVehicle.number },
      geometry: {
        type: "LineString" as const,
        coordinates: coordinates
      }
    };
  }, [targetVehicle, realRoadCoords, routeHistory]);

  const startPoint = useMemo(() => {
    if (!routeGeoJson || !routeGeoJson.geometry.coordinates.length) return null;
    const coords = routeGeoJson.geometry.coordinates[0];
    return { lng: coords[0], lat: coords[1] };
  }, [routeGeoJson]);

  const color = (s: Vehicle["status"]) =>
    s === "Moving" ? "var(--color-success)" :
      s === "Idle" ? "var(--color-warning)" :
        s === "Parked" ? "var(--color-muted-foreground)" : "var(--color-destructive)";

  return (
    <div
      className="relative rounded-lg overflow-hidden border border-border"
      style={{ height }}
    >
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
                "line-opacity": 0.35
              }}
            />
            <Layer
              id="route-path-line"
              type="line"
              paint={{
                "line-color": "#2563eb",
                "line-width": 3.5,
                "line-dasharray": [2, 1]
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
                    duration: 800
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
                <span
                  className={`relative flex items-center justify-center rounded-full text-white shadow-lg transition-transform ${isSelected ? "h-9 w-9 ring-4 ring-primary scale-110" : "h-7 w-7 ring-2 ring-white"
                    }`}
                  style={{ background: color(v.status) }}
                >
                  <Truck className={isSelected ? "h-4 w-4" : "h-3.5 w-3.5"} />
                </span>

                {/* Vehicle Registration Number Tag on Pin */}
                <span
                  className={`mt-1 whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] font-bold font-mono tracking-tight shadow-md border transition-all flex items-center gap-1 ${
                    isSelected
                      ? "bg-amber-400 text-black border-black ring-2 ring-amber-400/50 z-20 scale-105"
                      : "bg-background/95 text-foreground border-border/80 group-hover:bg-amber-400 group-hover:text-black group-hover:border-black z-10"
                  }`}
                >
                  <span className="text-[8px] bg-black text-amber-400 px-0.5 rounded-xs font-sans">IND</span>
                  <span>{v.number}</span>
                </span>
              </button>
            </Marker>
          );
        })}

        {active && (
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
                    <span className="text-[9px] font-sans font-bold bg-black text-amber-400 px-1 py-0.5 rounded-xs leading-none">IND</span>
                    <span>{active.number}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {active.type} · {active.model}
                  </div>
                </div>
                <Badge status={active.status}>{active.status}</Badge>
              </div>

              {/* Telemetry Metrics */}
              <div className="grid grid-cols-2 gap-2 text-xs bg-muted/40 p-2.5 rounded-md border border-border/60">
                <div>
                  <div className="text-[10px] text-muted-foreground">Driver</div>
                  <div className="font-semibold text-foreground truncate">{active.driver || 'Unassigned'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">Speed</div>
                  <div className="font-semibold text-foreground">{active.speed} km/h</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">Fuel Level</div>
                  <div className="font-semibold text-foreground">{active.fuel}%</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">Odometer</div>
                  <div className="font-semibold text-foreground">{active.odometer ? `${active.odometer.toLocaleString()} km` : '—'}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-[10px] text-muted-foreground">Current Sector</div>
                  <div className="font-medium text-foreground truncate">{active.location || 'Live GPS Location'}</div>
                </div>
                {active.deviceId && (
                  <div className="col-span-2 text-[10px] text-muted-foreground font-mono truncate border-t border-border/40 pt-1 mt-0.5 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                    <span>Device ID: {active.deviceId}</span>
                  </div>
                )}
              </div>

              {/* Action Links */}
              <div className="flex gap-2 pt-0.5">
                <Link
                  to={`/vehicles/${active.id}`}
                  className="flex-1 text-center text-xs font-semibold bg-primary text-primary-foreground rounded-md py-1.5 hover:bg-primary/90 transition-colors shadow-sm"
                >
                  Inspect Telemetry →
                </Link>
              </div>
            </div>
          </Popup>
        )}
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
            <span>Tracking Route: <strong className="font-mono">{active.number}</strong></span>
          </div>
        )}
      </div>
    </div>
  );
}
