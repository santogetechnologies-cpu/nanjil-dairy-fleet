import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Fuel,
  Gauge,
  Plus,
  Radio,
  Receipt,
  ShieldCheck,
  Thermometer,
  Truck,
} from "lucide-react";
import { Badge } from "@/components/ui-kit";
import type { DriverAlertItem, DriverAssignedVehicle } from "./types";

export interface DriverFuelHistoryRow {
  id: string;
  liters: number;
  cost: number;
  odometer: number;
  is_full_tank?: boolean | null;
  price_per_liter?: number | null;
  station?: string | null;
  receipt_ref?: string | null;
  receipt_photo_url?: string | null;
  logged_at?: string | null;
}

interface VehicleTabProps {
  vehicle: DriverAssignedVehicle;
  authoritativeOdometer: number;
  liveHardwareOdometer: number;
  alerts: DriverAlertItem[];
  fuelLogs: DriverFuelHistoryRow[];
  fuelSuccess: string | null;
  onOpenLogRefill: () => void;
}

export function VehicleTab({
  vehicle,
  authoritativeOdometer,
  liveHardwareOdometer,
  alerts,
  fuelLogs,
  fuelSuccess,
  onOpenLogRefill,
}: VehicleTabProps) {
  const hasVehicle = Boolean(vehicle?.id);

  return (
    <div className="space-y-4">
      {/* Assigned Vehicle Hero */}
      <div
        className="rounded-3xl p-5 text-white space-y-4"
        style={{
          background: "linear-gradient(135deg, oklch(0.22 0.10 260) 0%, oklch(0.36 0.18 264) 100%)",
          boxShadow: "0 10px 28px oklch(0.36 0.18 264 / 0.25)",
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-white/65">
              Assigned Fleet Asset
            </div>
            <div className="text-2xl font-extrabold tracking-tight flex items-center gap-2 mt-1">
              <Truck className="h-6 w-6 text-indigo-200" />
              <span>{vehicle.number}</span>
            </div>
            <div className="text-xs text-white/75 mt-0.5">
              {vehicle.type} {vehicle.model ? `· ${vehicle.model}` : ""}
            </div>
          </div>
          <Badge status={vehicle.status}>{vehicle.status}</Badge>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="rounded-xl bg-white/10 p-2.5">
            <div className="text-[10px] text-white/60 flex items-center gap-1">
              <Gauge className="h-3 w-3" /> Master Odo
            </div>
            <div className="font-extrabold text-sm mt-0.5">
              {hasVehicle ? `${authoritativeOdometer.toLocaleString()} km` : "—"}
            </div>
          </div>
          <div className="rounded-xl bg-white/10 p-2.5">
            <div className="text-[10px] text-white/60 flex items-center gap-1">
              <Radio className="h-3 w-3" /> GPS Odo
            </div>
            <div className="font-bold text-sm mt-0.5">
              {liveHardwareOdometer > 0 ? `${liveHardwareOdometer.toLocaleString()} km` : "Manual"}
            </div>
          </div>
          <div className="rounded-xl bg-white/10 p-2.5">
            <div className="text-[10px] text-white/60 flex items-center gap-1">
              <Fuel className="h-3 w-3" /> Fuel
            </div>
            <div className="font-bold text-sm mt-0.5">{vehicle.fuel}%</div>
          </div>
          <div className="rounded-xl bg-white/10 p-2.5">
            <div className="text-[10px] text-white/60 flex items-center gap-1">
              <Thermometer className="h-3 w-3" /> Temp
            </div>
            <div className="font-bold text-sm mt-0.5">{vehicle.temperature}°C</div>
          </div>
        </div>

        <div className="text-xs bg-white/10 rounded-xl p-3 space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-white/60">Assigned Route</div>
          <div className="font-semibold">{vehicle.route || "No route assigned"}</div>
          {vehicle.odometerSource && (
            <div className="text-[10px] text-white/60 pt-0.5">
              Last Odometer Source:{" "}
              <span className="font-mono text-white/90">{vehicle.odometerSource}</span>
            </div>
          )}
        </div>
      </div>

      {/* Record Fuel Transaction Card & CTA */}
      <div className="bg-card border border-border rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
              <Fuel className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-foreground">Fuel Refill &amp; Receipt Log</div>
              <div className="text-xs text-muted-foreground">
                Record station refill with physical odometer &amp; invoice ref
              </div>
            </div>
          </div>
          <button
            type="button"
            disabled={!hasVehicle}
            onClick={onOpenLogRefill}
            className="px-4 min-h-[42px] rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs disabled:opacity-50 shrink-0 cursor-pointer"
          >
            <Plus className="h-4 w-4" /> Log Refill
          </button>
        </div>

        {fuelSuccess && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800">
            {fuelSuccess}
          </div>
        )}
      </div>

      {/* Recent Fuel Transactions */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-xs">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-foreground">
            <Receipt className="h-4 w-4 text-blue-600" /> Recent Fuel Transactions ({fuelLogs.length})
          </div>
        </div>
        {fuelLogs.length === 0 ? (
          <div className="p-5 text-center text-xs text-muted-foreground">
            No fuel refill transactions recorded for {vehicle.number} yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {fuelLogs.slice(0, 8).map((log) => (
              <div key={log.id} className="p-3.5 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-foreground">
                    {Number(log.liters || 0).toFixed(1)} L · ₹{" "}
                    {Math.round(Number(log.cost || 0)).toLocaleString("en-IN")}
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                      log.is_full_tank !== false
                        ? "bg-indigo-100 text-indigo-800"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {log.is_full_tank !== false ? "Full Tank" : "Partial Fill"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span>Odo: {Number(log.odometer || 0).toLocaleString()} km</span>
                  {log.station && <span>{log.station}</span>}
                  {log.receipt_ref && <span className="font-mono">Ref: {log.receipt_ref}</span>}
                  {log.receipt_photo_url && (
                    <a
                      href={log.receipt_photo_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-indigo-600 hover:underline font-semibold"
                    >
                      <Receipt className="h-3 w-3" />
                      View Receipt
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Compliance & Service Details */}
      {hasVehicle && (
        <div className="bg-card border border-border rounded-2xl p-4 shadow-xs grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-[10px] font-bold uppercase text-muted-foreground">Next Service Due</div>
            <div className="font-bold text-foreground mt-0.5">
              {vehicle.nextServiceKm ? `${vehicle.nextServiceKm.toLocaleString()} KM` : "Not Scheduled"}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-muted-foreground">Insurance Expiry</div>
            <div className="font-bold text-foreground mt-0.5 flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              <span>{vehicle.insuranceExpiry || "On File"}</span>
            </div>
          </div>
        </div>
      )}

      {/* Vehicle Alerts */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-xs">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-foreground">
            <Bell className="h-4 w-4 text-amber-600" /> Vehicle Alerts ({alerts.length})
          </div>
        </div>
        {alerts.length === 0 ? (
          <div className="p-5 text-center text-xs text-muted-foreground">
            All clear — no active alerts for {vehicle.number}.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {alerts.map((a) => (
              <div key={a.id} className="p-3.5 flex items-start gap-2.5 text-xs">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-foreground">{a.message}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {a.type} · {a.severity} · {a.time}
                  </div>
                </div>
                {a.resolved && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
