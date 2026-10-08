import { Link } from "react-router-dom";
import { 
  Truck, 
  MapPin, 
  User, 
  Gauge, 
  Activity, 
  Fuel, 
  Wrench, 
  ArrowRight, 
  Clock,
  Radio
} from "lucide-react";
import { Card, Badge } from "@/components/ui-kit";
import type { Vehicle } from "@/lib/types";
import type { VehicleSummaryMetrics } from "../types";

interface VehicleCardProps {
  vehicle: Vehicle;
  metrics?: VehicleSummaryMetrics;
}

export function VehicleCard({ vehicle, metrics }: VehicleCardProps) {
  // Status style configuration
  const statusColorMap: Record<string, { bg: string; text: string; dot: string }> = {
    Moving: { bg: "bg-emerald-500/10 border-emerald-500/20", text: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
    Idle: { bg: "bg-amber-500/10 border-amber-500/20", text: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
    Parked: { bg: "bg-slate-500/10 border-slate-500/20", text: "text-slate-600 dark:text-slate-400", dot: "bg-slate-400" },
    Offline: { bg: "bg-rose-500/10 border-rose-500/20", text: "text-rose-600 dark:text-rose-400", dot: "bg-rose-500" },
    Maintenance: { bg: "bg-purple-500/10 border-purple-500/20", text: "text-purple-600 dark:text-purple-400", dot: "bg-purple-500" },
    Active: { bg: "bg-emerald-500/10 border-emerald-500/20", text: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
    Inactive: { bg: "bg-zinc-500/10 border-zinc-500/20", text: "text-zinc-600 dark:text-zinc-400", dot: "bg-zinc-500" },
  };

  const statusConfig = statusColorMap[vehicle.status] || {
    bg: "bg-muted border-border",
    text: "text-muted-foreground",
    dot: "bg-slate-400"
  };

  // Maintenance badge color
  const maintStatus = metrics?.maintenanceStatus || "Good";
  const maintBadgeColor: Record<string, string> = {
    Good: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    "Due Soon": "bg-amber-500/10 text-amber-600 border-amber-500/20",
    Due: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    Overdue: "bg-rose-500/10 text-rose-600 border-rose-500/20",
    "Under Maintenance": "bg-purple-500/10 text-purple-600 border-purple-500/20",
  };

  // Metric displays
  const topSpeedDisplay = metrics?.topSpeed != null && metrics.topSpeed > 0 
    ? `${Math.round(metrics.topSpeed)} km/h` 
    : vehicle.speed > 0 
      ? `${Math.round(vehicle.speed)} km/h` 
      : "—";

  const avgSpeedDisplay = metrics?.avgSpeed != null && metrics.avgSpeed > 0 
    ? `${Math.round(metrics.avgSpeed)} km/h` 
    : vehicle.averageSpeed != null && vehicle.averageSpeed > 0 
      ? `${Math.round(vehicle.averageSpeed)} km/h` 
      : "—";

  const avgMileageDisplay = metrics?.avgMileage != null 
    ? `${metrics.avgMileage.toFixed(1)} km/L` 
    : "—";

  return (
    <Card className="flex flex-col justify-between overflow-hidden transition-all duration-200 hover:shadow-md hover:border-primary/40 group">
      <div>
        {/* Card Header: Vehicle Number & Status */}
        <div className="p-4 border-b border-border/60 bg-muted/20 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/15">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <div className="font-bold text-sm sm:text-base text-foreground tracking-tight group-hover:text-primary transition-colors">
                {vehicle.number}
              </div>
              <div className="text-[11px] text-muted-foreground truncate max-w-[140px] sm:max-w-[170px]">
                {vehicle.model || vehicle.type || "Commercial Fleet"}
              </div>
            </div>
          </div>

          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${statusConfig.bg} ${statusConfig.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${statusConfig.dot} animate-pulse`} />
            {vehicle.status}
          </div>
        </div>

        {/* Card Body: Info & Location */}
        <div className="p-4 space-y-3.5">
          {/* Attributes */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground block text-[11px]">Vehicle Type</span>
              <span className="font-medium text-foreground truncate block">
                {vehicle.type || "Milk Tanker"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[11px]">Assigned Driver</span>
              <div className="flex items-center gap-1 font-medium text-foreground truncate">
                <User className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="truncate">{vehicle.driver || "Unassigned"}</span>
              </div>
            </div>
          </div>

          {/* Location row */}
          {vehicle.location && (
            <div className="flex items-start gap-1.5 text-xs text-muted-foreground bg-muted/40 p-2 rounded-lg border border-border/40">
              <MapPin className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
              <span className="line-clamp-1 leading-snug">{vehicle.location}</span>
            </div>
          )}

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            {/* Top Speed */}
            <div className="bg-card border border-border/70 rounded-lg p-2.5 shadow-2xs">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Gauge className="h-3 w-3 text-primary/80" />
                  <span>Top Speed</span>
                </div>
                {vehicle.speed > 0 && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" title="Live motion active" />
                )}
              </div>
              <div className="mt-1 text-sm font-semibold text-foreground">
                {topSpeedDisplay}
              </div>
            </div>

            {/* Average Speed */}
            <div className="bg-card border border-border/70 rounded-lg p-2.5 shadow-2xs">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Activity className="h-3 w-3 text-sky-500" />
                <span>Avg Speed</span>
              </div>
              <div className="mt-1 text-sm font-semibold text-foreground">
                {avgSpeedDisplay}
              </div>
            </div>

            {/* Average Mileage */}
            <div className="bg-card border border-border/70 rounded-lg p-2.5 shadow-2xs">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Fuel className="h-3 w-3 text-emerald-500" />
                <span>Avg Mileage</span>
              </div>
              <div className="mt-1 text-sm font-semibold text-foreground">
                {avgMileageDisplay}
              </div>
            </div>

            {/* Maintenance Health */}
            <div className="bg-card border border-border/70 rounded-lg p-2.5 shadow-2xs">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Wrench className="h-3 w-3 text-amber-500" />
                <span>Maintenance</span>
              </div>
              <div className="mt-1">
                <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold border ${maintBadgeColor[maintStatus] || "bg-muted text-muted-foreground"}`}>
                  {maintStatus}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Card Footer: Last Update & CTA Button */}
      <div className="p-4 pt-1 border-t border-border/40 mt-1 flex flex-col gap-2.5">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {vehicle.lastUpdate || "Recent"}
          </span>
          {vehicle.deviceId && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground/80">
              <Radio className="h-2.5 w-2.5 text-emerald-500" />
              {vehicle.deviceId.slice(-6)}
            </span>
          )}
        </div>

        <Link
          to={`/vehicles-management/${vehicle.id}`}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-2xs group-hover:translate-x-0.5 transition-transform"
        >
          VIEW DETAILS
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
    </Card>
  );
}
