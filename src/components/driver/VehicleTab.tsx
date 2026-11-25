import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Droplets,
  Fuel,
  Gauge,
  Loader2,
  Radio,
  ShieldCheck,
  Thermometer,
  Truck,
} from "lucide-react";
import { Badge } from "@/components/ui-kit";
import type { DriverAlertItem, DriverAssignedVehicle } from "./types";

interface VehicleTabProps {
  vehicle: DriverAssignedVehicle;
  authoritativeOdometer: number;
  liveHardwareOdometer: number;
  alerts: DriverAlertItem[];
  fuelForm: { liters: number; cost: number; odometer: number; isFullTank: boolean };
  fuelError: string | null;
  fuelSuccess: string | null;
  submittingFuel: boolean;
  onChangeFuelForm: (next: { liters: number; cost: number; odometer: number; isFullTank: boolean }) => void;
  onSubmitFuel: (e: React.FormEvent) => void;
}

export function VehicleTab({
  vehicle,
  authoritativeOdometer,
  liveHardwareOdometer,
  alerts,
  fuelForm,
  fuelError,
  fuelSuccess,
  submittingFuel,
  onChangeFuelForm,
  onSubmitFuel,
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
              Last Odometer Source: <span className="font-mono text-white/90">{vehicle.odometerSource}</span>
            </div>
          )}
        </div>
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

      {/* Fuel Refill Logger (Preserved) */}
      <div className="bg-card border border-border rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <Fuel className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="text-sm font-bold text-foreground">Log Fuel Refill</div>
            <div className="text-xs text-muted-foreground">Record station refueling with odometer check</div>
          </div>
        </div>

        <form onSubmit={onSubmitFuel} className="space-y-3">
          {fuelSuccess && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800">
              {fuelSuccess}
            </div>
          )}
          {fuelError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
              {fuelError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                Litres *
              </label>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                required
                value={fuelForm.liters || ""}
                onChange={(e) => onChangeFuelForm({ ...fuelForm, liters: Number(e.target.value) })}
                placeholder="e.g. 50"
                className="w-full h-12 px-3 rounded-xl border border-border bg-background text-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                Cost (INR) *
              </label>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                required
                value={fuelForm.cost || ""}
                onChange={(e) => onChangeFuelForm({ ...fuelForm, cost: Number(e.target.value) })}
                placeholder="e.g. 4800"
                className="w-full h-12 px-3 rounded-xl border border-border bg-background text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
              Odometer (KM) *
            </label>
            <input
              type="number"
              inputMode="decimal"
              required
              value={fuelForm.odometer || ""}
              onChange={(e) => onChangeFuelForm({ ...fuelForm, odometer: Number(e.target.value) })}
              placeholder={hasVehicle ? `>= ${authoritativeOdometer}` : "e.g. 66800"}
              className="w-full h-12 px-3 rounded-xl border border-border bg-background text-sm"
            />
          </div>
          <label className="flex items-center gap-2.5 p-3 rounded-xl border border-border bg-muted/30 cursor-pointer">
            <input
              type="checkbox"
              checked={fuelForm.isFullTank}
              onChange={(e) => onChangeFuelForm({ ...fuelForm, isFullTank: e.target.checked })}
              className="h-4 w-4 rounded accent-indigo-600"
            />
            <span className="text-xs font-semibold text-foreground">
              Full Tank Refuel (used for fleet KMPL verification)
            </span>
          </label>
          <button
            type="submit"
            disabled={submittingFuel || !hasVehicle}
            className="w-full min-h-[48px] rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            style={{ background: "linear-gradient(135deg, oklch(0.44 0.22 264), oklch(0.36 0.18 258))" }}
          >
            {submittingFuel ? (
              <Loader2 className="animate-spin h-4 w-4" />
            ) : (
              <>
                <Droplets className="h-4 w-4" /> Save Refuel Log
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
