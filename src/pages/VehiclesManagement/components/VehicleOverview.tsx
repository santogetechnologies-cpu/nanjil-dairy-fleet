import { 
  Truck, 
  MapPin, 
  User, 
  Clock, 
  Calendar, 
  Cpu, 
  Gauge, 
  ShieldCheck, 
  Radio 
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui-kit";
import type { Vehicle } from "@/lib/types";

interface VehicleOverviewProps {
  vehicle: Vehicle;
}

export function VehicleOverview({ vehicle }: VehicleOverviewProps) {
  // Status style
  const statusColorMap: Record<string, { bg: string; text: string; dot: string }> = {
    Moving: { bg: "bg-emerald-500/10 border-emerald-500/25", text: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
    Idle: { bg: "bg-amber-500/10 border-amber-500/25", text: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
    Parked: { bg: "bg-slate-500/10 border-slate-500/25", text: "text-slate-600 dark:text-slate-400", dot: "bg-slate-400" },
    Offline: { bg: "bg-rose-500/10 border-rose-500/25", text: "text-rose-600 dark:text-rose-400", dot: "bg-rose-500" },
    Maintenance: { bg: "bg-purple-500/10 border-purple-500/25", text: "text-purple-600 dark:text-purple-400", dot: "bg-purple-500" },
  };

  const statusConfig = statusColorMap[vehicle.status] || {
    bg: "bg-muted border-border",
    text: "text-muted-foreground",
    dot: "bg-slate-400"
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader 
        title="Vehicle Overview & Technical Profile" 
        subtitle="Core asset registration, hardware binding, and operational metadata"
        action={
          <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${statusConfig.bg} ${statusConfig.text}`}>
            <span className={`h-2 w-2 rounded-full ${statusConfig.dot} animate-pulse`} />
            {vehicle.status}
          </div>
        }
      />

      <div className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Box 1: Core Registration */}
          <div className="p-4 rounded-xl border border-border/70 bg-card/60 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Truck className="h-4 w-4 text-primary" />
              Registration & Identity
            </div>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-xs text-muted-foreground block">Vehicle Number</span>
                <span className="font-bold text-base text-foreground tracking-tight">{vehicle.number}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Model / Brand</span>
                <span className="font-medium text-foreground">{vehicle.model || "Commercial Fleet"}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Vehicle Type</span>
                <span className="font-medium text-foreground">{vehicle.type || "Milk Tanker"}</span>
              </div>
            </div>
          </div>

          {/* Box 2: Telemetry Hardware & Connection */}
          <div className="p-4 rounded-xl border border-border/70 bg-card/60 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Cpu className="h-4 w-4 text-emerald-500" />
              IoT Telemetry Hardware
            </div>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-xs text-muted-foreground block">Hardware Device ID (IMEI)</span>
                <span className="font-mono text-xs font-semibold text-foreground bg-muted/60 px-2 py-0.5 rounded border border-border inline-block">
                  {vehicle.deviceId || "Unassigned"}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Last Telemetry Sync</span>
                <span className="font-medium text-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  {vehicle.lastUpdate || "Recent"}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">GPS Telemetry Status</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 border ${
                  vehicle.status !== "Offline"
                    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                    : "bg-slate-500/10 text-slate-600 border-slate-500/20"
                }`}>
                  <Radio className="h-2.5 w-2.5" />
                  {vehicle.status !== "Offline" ? "Live Stream" : "Offline"}
                </span>
              </div>
            </div>
          </div>

          {/* Box 3: Assignment & Operations */}
          <div className="p-4 rounded-xl border border-border/70 bg-card/60 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <User className="h-4 w-4 text-sky-500" />
              Driver & Route Duty
            </div>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-xs text-muted-foreground block">Assigned Driver</span>
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  {vehicle.driver || "Unassigned"}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Assigned Route</span>
                <span className="font-medium text-foreground">
                  {vehicle.route || "General Milk Dispatch"}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Current Location</span>
                <span className="text-xs text-muted-foreground flex items-start gap-1 line-clamp-1" title={vehicle.location}>
                  <MapPin className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                  {vehicle.location || "Stationary at Plant / Depot"}
                </span>
              </div>
            </div>
          </div>

          {/* Box 4: Odometers & Inspection Compliance */}
          <div className="p-4 rounded-xl border border-border/70 bg-card/60 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Gauge className="h-4 w-4 text-amber-500" />
              Odometer & Compliance
            </div>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-xs text-muted-foreground block">Current Odometer</span>
                <span className="font-bold text-foreground">
                  {vehicle.odometer ? `${vehicle.odometer.toLocaleString()} km` : "—"}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Engine Hours</span>
                <span className="font-medium text-foreground">
                  {vehicle.engineHours ? `${vehicle.engineHours} hrs` : "—"}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Insurance Expiry</span>
                <span className="font-medium text-foreground flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3 text-emerald-500" />
                  {vehicle.insuranceExpiry || "Valid"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
