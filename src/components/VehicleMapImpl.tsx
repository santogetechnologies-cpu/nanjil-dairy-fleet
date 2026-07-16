import { useState, useMemo } from "react";
import Map, { Marker, Popup, NavigationControl, ScaleControl } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Vehicle } from "@/lib/types";
import { Truck } from "lucide-react";
import { Badge } from "./ui-kit";
import { Link } from "react-router-dom";

interface Props {
  vehicles: Vehicle[];
  height?: number;
  selectedId?: string;
}

const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

export default function VehicleMapImpl({ vehicles, height = 520, selectedId }: Props) {
  const [active, setActive] = useState<Vehicle | null>(
    selectedId ? vehicles.find((v) => v.id === selectedId) ?? null : null
  );

  // Only show vehicles that have actual GPS coordinates
  const mappedVehicles = vehicles.filter(v => v.lat != null && v.lng != null && (v.lat !== 0 || v.lng !== 0));

  const initial = useMemo(() => {
    if (selectedId) {
      const v = mappedVehicles.find((x) => x.id === selectedId);
      if (v) return { longitude: v.lng, latitude: v.lat, zoom: 12 };
    }
    if (mappedVehicles.length) {
      const lat = mappedVehicles.reduce((s, v) => s + v.lat, 0) / mappedVehicles.length;
      const lng = mappedVehicles.reduce((s, v) => s + v.lng, 0) / mappedVehicles.length;
      return { longitude: lng, latitude: lat, zoom: 10.2 };
    }
    // Default center: Nagercoil, Tamil Nadu
    return { longitude: 77.45, latitude: 8.25, zoom: 10 };
  }, [mappedVehicles, selectedId]);

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
        initialViewState={initial}
        mapStyle={MAP_STYLE}
        attributionControl={{ compact: true }}
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="top-left" />
        <ScaleControl position="bottom-right" />

        {mappedVehicles.map((v) => (
          <Marker
            key={v.id}
            longitude={v.lng}
            latitude={v.lat}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              setActive(v);
            }}
          >
            <button className="group relative cursor-pointer">
              {v.status === "Moving" && (
                <span
                  className="absolute inset-0 rounded-full animate-ping"
                  style={{ background: color(v.status), opacity: 0.4 }}
                />
              )}
              <span
                className="relative flex items-center justify-center h-7 w-7 rounded-full text-white shadow-md ring-2 ring-white"
                style={{ background: color(v.status) }}
              >
                <Truck className="h-3.5 w-3.5" />
              </span>
            </button>
          </Marker>
        ))}

        {active && (
          <Popup
            longitude={active.lng}
            latitude={active.lat}
            anchor="top"
            offset={18}
            onClose={() => setActive(null)}
            closeOnClick={false}
            maxWidth="300px"
          >
            <div className="w-64 p-1">
              <div className="font-semibold text-sm">{active.number}</div>
              <div className="text-xs text-muted-foreground">{active.type}</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-muted-foreground">Driver</div>
                  <div className="font-medium">{active.driver}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Speed</div>
                  <div className="font-medium">{active.speed} km/h</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Fuel</div>
                  <div className="font-medium">{active.fuel}%</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Temp</div>
                  <div className="font-medium">{active.temperature}°C</div>
                </div>
                <div className="col-span-2">
                  <div className="text-muted-foreground">Location</div>
                  <div className="font-medium">{active.location}</div>
                </div>
                <div className="col-span-2">
                  <Badge status={active.status}>{active.status}</Badge>
                </div>
              </div>
              <Link
                to={`/vehicles/${active.id}`}
                className="mt-3 block text-center text-xs font-medium bg-primary text-primary-foreground rounded-md py-1.5 hover:bg-primary/90"
              >
                View vehicle details
              </Link>
            </div>
          </Popup>
        )}
      </Map>

      <div className="absolute bottom-3 left-3 z-10 bg-card/95 backdrop-blur border border-border rounded-md px-3 py-2 text-xs flex gap-3 shadow">
        {(["Moving", "Idle", "Parked", "Offline"] as const).map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: color(s) }} />
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}
