import { useEffect, useState } from "react";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Gauge,
  History,
  Loader2,
  Play,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { Badge } from "@/components/ui-kit";
import {
  formatStatementNumber,
  getIstGreeting,
  validateClockInEligibility,
  type VehicleOperationTripRecord,
} from "@/lib/driverOperationStatement";
import type { DriverAssignedVehicle, DriverProfileData } from "./types";

interface ClockInScreenProps {
  driver: DriverProfileData;
  vehicle: DriverAssignedVehicle;
  assignedVehiclesCount: number;
  authoritativeOdometer: number;
  hasOtherDriverTrip: boolean;
  clockingIn: boolean;
  errorBanner?: string | null;
  recentTrips: VehicleOperationTripRecord[];
  onClockIn: () => void;
  onOpenTripHistory: () => void;
  onInspectTrip: (trip: VehicleOperationTripRecord) => void;
}

export function ClockInScreen({
  driver,
  vehicle,
  assignedVehiclesCount,
  authoritativeOdometer,
  hasOtherDriverTrip,
  clockingIn,
  errorBanner,
  recentTrips,
  onClockIn,
  onOpenTripHistory,
  onInspectTrip,
}: ClockInScreenProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const greeting = getIstGreeting(now);
  const formattedDate = now.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const formattedClock = now.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const hasVehicle = Boolean(vehicle?.id && assignedVehiclesCount > 0);
  const eligibility = validateClockInEligibility({
    driverId: driver?.id,
    assignedVehicleId: hasVehicle ? vehicle.id : null,
    vehicleHasOtherDriverTrip: hasOtherDriverTrip,
    vehicleStatus: vehicle?.status,
  });

  return (
    <div className="space-y-4">
      {/* ── Hero Greeting + Live IST Clock + CLOCK IN CTA ── */}
      <div
        className="rounded-3xl p-5 sm:p-6 text-white relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, oklch(0.26 0.12 260) 0%, oklch(0.38 0.20 264) 65%, oklch(0.32 0.16 250) 100%)",
          boxShadow: "0 14px 36px oklch(0.32 0.18 264 / 0.28)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-white/15 text-white/90">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" /> Nanjil VIP Duty Desk
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-3 leading-tight break-words">
              {greeting}, {driver.name}
            </h1>
            <p className="text-white/75 text-xs sm:text-sm mt-1 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              <span>{formattedDate}</span>
            </p>
          </div>
        </div>

        {/* Live IST Clock Box */}
        <div className="mt-4 p-3.5 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-between gap-3 backdrop-blur-xs">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <Clock className="h-5 w-5 text-emerald-300" />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/65">
                Current IST Time
              </div>
              <div className="text-xl sm:text-2xl font-mono font-extrabold tracking-wide text-white tabular-nums">
                {formattedClock}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/65">Duty Status</div>
            <div className="text-xs font-bold text-amber-200 mt-0.5">Not Clocked In</div>
          </div>
        </div>

        {/* Readiness Checks */}
        <div className="grid grid-cols-2 gap-2.5 mt-4 text-xs">
          <div className="rounded-xl bg-white/10 border border-white/10 px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-white/65">Assigned Vehicle</div>
            <div className="font-bold text-white mt-0.5 truncate">
              {hasVehicle ? vehicle.number : "Not Assigned"}
            </div>
          </div>
          <div className="rounded-xl bg-white/10 border border-white/10 px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-white/65">Master Odometer</div>
            <div className="font-bold text-white mt-0.5">
              {hasVehicle ? `${authoritativeOdometer.toLocaleString()} KM` : "—"}
            </div>
          </div>
        </div>

        {/* Missing Vehicle Alert or Eligibility Error */}
        {!hasVehicle && (
          <div
            role="alert"
            className="mt-4 p-3.5 rounded-2xl bg-amber-500/20 border border-amber-300/40 text-amber-50 text-xs sm:text-sm font-medium flex items-start gap-2.5"
          >
            <AlertCircle className="h-5 w-5 text-amber-300 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">No Vehicle Assigned. Please contact your administrator.</div>
              <p className="text-xs text-amber-100/85 mt-0.5">
                Trips cannot start until an administrator assigns an active vehicle to your driver account.
              </p>
            </div>
          </div>
        )}

        {errorBanner && (
          <div
            role="alert"
            className="mt-3 p-3.5 rounded-2xl bg-red-500/25 border border-red-300/40 text-white text-xs sm:text-sm font-medium flex items-start gap-2.5"
          >
            <AlertCircle className="h-5 w-5 text-red-200 shrink-0 mt-0.5" />
            <div>{errorBanner}</div>
          </div>
        )}

        {/* Primary CLOCK IN Action */}
        <button
          type="button"
          onClick={onClockIn}
          disabled={clockingIn || !eligibility.allowed}
          className="mt-5 w-full min-h-[58px] rounded-2xl bg-white text-slate-900 font-extrabold text-base tracking-wide shadow-lg flex items-center justify-center gap-2.5 transition-all active:scale-[0.99] hover:bg-slate-50 disabled:opacity-45 disabled:pointer-events-none cursor-pointer"
        >
          {clockingIn ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
              <span>Verifying Assignment…</span>
            </>
          ) : (
            <>
              <Play className="h-5 w-5 text-indigo-600 fill-indigo-600" />
              <span>CLOCK IN</span>
            </>
          )}
        </button>
      </div>

      {/* ── Assigned Vehicle & Odometer Preview Card ── */}
      <div className="bg-card border border-border rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center">
              <Truck className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-foreground uppercase tracking-wider">Assigned Vehicle</div>
              <div className="text-[11px] text-muted-foreground">Synced from Admin Directory</div>
            </div>
          </div>
          {hasVehicle ? (
            <Badge status={vehicle.status}>{vehicle.status}</Badge>
          ) : (
            <Badge status="Offline">Unassigned</Badge>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs bg-muted/40 p-3 rounded-xl border border-border/60">
          <div>
            <div className="text-[10px] font-bold uppercase text-muted-foreground">Registration</div>
            <div className="font-bold text-foreground mt-0.5">{hasVehicle ? vehicle.number : "Unassigned"}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-muted-foreground">Model</div>
            <div className="font-semibold text-foreground mt-0.5">{vehicle.model || vehicle.type || "—"}</div>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <div className="text-[10px] font-bold uppercase text-muted-foreground">Current Odometer</div>
            <div className="font-bold text-indigo-700 mt-0.5 flex items-center gap-1">
              <Gauge className="h-3.5 w-3.5" />
              {hasVehicle ? `${authoritativeOdometer.toLocaleString()} KM` : "—"}
            </div>
          </div>
          <div className="col-span-2 sm:col-span-3">
            <div className="text-[10px] font-bold uppercase text-muted-foreground">Assigned Route</div>
            <div className="font-medium text-foreground mt-0.5">{vehicle.route || "No route assigned"}</div>
          </div>
        </div>
      </div>

      {/* ── Today's Trip Status & Recent Trips Snapshot ── */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-xs">
        <div className="px-4 sm:px-5 py-3.5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-indigo-600" />
            <span className="text-sm font-bold text-foreground">Recent Trip History</span>
          </div>
          <button
            type="button"
            onClick={onOpenTripHistory}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
          >
            View All →
          </button>
        </div>

        {recentTrips.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            No completed trips recorded yet. Clock in to begin today&apos;s vehicle operation statement.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {recentTrips.slice(0, 3).map((trip) => (
              <button
                key={trip.id}
                type="button"
                onClick={() => onInspectTrip(trip)}
                className="w-full text-left p-4 hover:bg-muted/35 transition-colors flex items-center justify-between gap-3 cursor-pointer"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-extrabold text-foreground">
                      {trip.vehicles?.number || vehicle.number}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                      {formatStatementNumber(trip)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {trip.destination ? `${trip.start} → ${trip.destination}` : trip.start}
                  </div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                    <span>{trip.in_date || trip.date}</span>
                    <span>•</span>
                    <span>
                      {Number(trip.start_km || 0).toLocaleString()} → {Number(trip.end_km || 0).toLocaleString()} KM
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-extrabold text-indigo-700">
                    {Number(trip.distance || 0).toLocaleString()} KM
                  </div>
                  <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 mt-0.5">
                    <CheckCircle2 className="h-3 w-3" /> Closed
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Quick compliance note */}
      <div className="rounded-2xl p-3.5 bg-slate-50 border border-slate-200/80 flex items-center gap-2.5 text-[11px] text-slate-600">
        <FileText className="h-4 w-4 text-slate-500 shrink-0" />
        <span>
          Out KM is automatically locked from the latest vehicle odometer &amp; GPS telemetry when you confirm your vehicle.
        </span>
      </div>
    </div>
  );
}
