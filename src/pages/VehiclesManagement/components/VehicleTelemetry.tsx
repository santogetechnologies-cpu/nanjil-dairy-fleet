import { 
  Radio, 
  Gauge, 
  MapPin, 
  Clock, 
  Compass,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui-kit";
import type { Vehicle } from "@/lib/types";

interface VehicleTelemetryProps {
  vehicle: Vehicle;
}

export function VehicleTelemetry({ vehicle }: VehicleTelemetryProps) {
  const hasCoordinates = vehicle.lat !== 0 || vehicle.lng !== 0;
  const isOnline = vehicle.status !== "Offline";

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Live IoT Telemetry & GPS Tracking"
        subtitle="Real-time position, velocity, and connection parameters streamed directly from GPS device"
        action={
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
            isOnline 
              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" 
              : "bg-rose-500/10 text-rose-600 border-rose-500/20"
          }`}>
            <Radio className={`h-3 w-3 ${isOnline ? "text-emerald-500 animate-pulse" : "text-rose-500"}`} />
            {isOnline ? "Telemetry Connected" : "Device Offline"}
          </div>
        }
      />

      <div className="p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* 1. Live Speed */}
          <div className="p-4 rounded-xl border border-border bg-card/60 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-semibold text-[11px] uppercase tracking-wider">Live Speed</span>
              <Gauge className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-black text-foreground">
                {Math.round(vehicle.speed || 0)}
              </span>
              <span className="text-xs text-muted-foreground font-semibold">km/h</span>
            </div>
            <span className={`text-[11px] font-semibold mt-1 inline-flex items-center gap-1 ${
              vehicle.speed > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500"
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${vehicle.speed > 0 ? "bg-emerald-500 animate-ping" : "bg-slate-400"}`} />
              {vehicle.speed > 0 ? "Vehicle in Motion" : "Vehicle Stationary"}
            </span>
          </div>

          {/* 2. GPS Coordinates */}
          <div className="p-4 rounded-xl border border-border bg-card/60 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-semibold text-[11px] uppercase tracking-wider">Coordinates</span>
              <Compass className="h-4 w-4 text-sky-500" />
            </div>
            <div className="mt-2 font-mono text-sm font-bold text-foreground truncate">
              {hasCoordinates ? `${vehicle.lat.toFixed(5)}° N` : "Fix Pending"}
            </div>
            <div className="font-mono text-xs text-muted-foreground truncate">
              {hasCoordinates ? `${vehicle.lng.toFixed(5)}° E` : "No Satellites"}
            </div>
            <span className="text-[10px] text-muted-foreground mt-1 block">
              WGS84 Coordinates
            </span>
          </div>

          {/* 3. Current Location */}
          <div className="p-4 rounded-xl border border-border bg-card/60 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-semibold text-[11px] uppercase tracking-wider">Current Location</span>
              <MapPin className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 text-sm font-semibold text-foreground line-clamp-1" title={vehicle.location || "Stationary"}>
              {vehicle.location || "Stationary at Plant / Depot"}
            </div>
            <span className="text-[10px] text-muted-foreground mt-1 block">
              {vehicle.route ? `Route: ${vehicle.route}` : "Depot / Route unassigned"}
            </span>
          </div>

          {/* 4. Last Signal & Connection */}
          <div className="p-4 rounded-xl border border-border bg-card/60 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-semibold text-[11px] uppercase tracking-wider">Last Telemetry Ping</span>
              <Clock className="h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-2 text-sm font-bold text-foreground">
              {vehicle.lastUpdate || "Recent"}
            </div>
            <span className="text-[10px] text-muted-foreground mt-1 block font-mono" title={`Hardware Device ID: ${vehicle.deviceId}`}>
              {vehicle.deviceId ? `Device ID: ${vehicle.deviceId}` : "Live Feed"}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
