import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  Gauge,
  Lock,
  MapPin,
  Navigation,
  Radio,
  Truck,
} from "lucide-react";
import {
  formatIsoToIstTime,
  formatStatementNumber,
  type VehicleOperationTripRecord,
} from "@/lib/driverOperationStatement";
import type { DriverAssignedVehicle } from "./types";

interface ActiveTripDashboardProps {
  trip: VehicleOperationTripRecord;
  vehicle: DriverAssignedVehicle;
  authoritativeOdometer: number;
  justStartedBanner?: boolean;
  onDismissStartedBanner?: () => void;
  onCompleteTripClockOut: () => void;
  onViewRoute: () => void;
}

export function ActiveTripDashboard({
  trip,
  vehicle,
  authoritativeOdometer,
  justStartedBanner,
  onDismissStartedBanner,
  onCompleteTripClockOut,
  onViewRoute,
}: ActiveTripDashboardProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startTs = trip.started_at
      ? new Date(trip.started_at).getTime()
      : trip.created_at
      ? new Date(trip.created_at).getTime()
      : Date.now();

    const updateTimer = () => {
      const diff = Math.floor((Date.now() - startTs) / 1000);
      setElapsedSeconds(diff > 0 ? diff : 0);
    };
    updateTimer();
    const id = setInterval(updateTimer, 1000);
    return () => clearInterval(id);
  }, [trip.started_at, trip.created_at]);

  const hrs = Math.floor(elapsedSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const mins = Math.floor((elapsedSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const secs = (elapsedSeconds % 60).toString().padStart(2, "0");

  const outKm = Number(trip.start_km ?? authoritativeOdometer ?? 0);
  const outDate = trip.out_date || trip.date || "Today";
  const outTime = trip.out_time || formatIsoToIstTime(trip.started_at || trip.created_at) || "—";
  const routeLabel = trip.destination ? `${trip.start} → ${trip.destination}` : trip.start || vehicle.route;
  const statementNo = formatStatementNumber(trip);
  const isGpsActive = Boolean(vehicle.deviceId);

  return (
    <div className="space-y-4">
      {/* ── TRIP STARTED SUCCESSFULLY Confirmation Banner ── */}
      {justStartedBanner && (
        <div
          role="status"
          className="rounded-2xl p-4 bg-emerald-50 border border-emerald-200 text-emerald-950 shadow-xs space-y-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              <span className="text-sm font-extrabold tracking-wide uppercase">
                TRIP STARTED SUCCESSFULLY
              </span>
            </div>
            {onDismissStartedBanner && (
              <button
                type="button"
                onClick={onDismissStartedBanner}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 cursor-pointer"
              >
                Dismiss
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-emerald-200/70">
            <div>
              <span className="text-emerald-700">Vehicle:</span>{" "}
              <strong>{trip.vehicles?.number || vehicle.number}</strong>
            </div>
            <div>
              <span className="text-emerald-700">Status:</span>{" "}
              <strong className="text-emerald-800">IN PROGRESS</strong>
            </div>
            <div>
              <span className="text-emerald-700">Start Time:</span>{" "}
              <strong>
                {outDate} · {outTime}
              </strong>
            </div>
            <div>
              <span className="text-emerald-700">Out KM:</span>{" "}
              <strong>{outKm.toLocaleString()} KM</strong>
            </div>
            <div className="col-span-2">
              <span className="text-emerald-700">Route:</span> <strong>{routeLabel}</strong>
            </div>
          </div>
        </div>
      )}

      {/* ── Main Active Trip Card ── */}
      <div
        className="rounded-3xl overflow-hidden text-white"
        style={{
          background: "linear-gradient(135deg, oklch(0.20 0.09 258) 0%, oklch(0.34 0.18 264) 100%)",
          boxShadow: "0 14px 36px oklch(0.32 0.18 264 / 0.28)",
        }}
      >
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-xs font-extrabold tracking-wider uppercase">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              IN PROGRESS
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-mono bg-white/10 border border-white/15 px-2.5 py-1 rounded-lg text-white/90">
              <FileText className="h-3 w-3" /> {statementNo}
            </span>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-white/60">Active Vehicle</div>
              <div className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2 mt-0.5">
                <Truck className="h-6 w-6 text-indigo-300 shrink-0" />
                <span>{trip.vehicles?.number || vehicle.number}</span>
              </div>
              <div className="text-xs sm:text-sm text-white/80 mt-1 flex items-center gap-1.5">
                <Navigation className="h-3.5 w-3.5 text-emerald-300 shrink-0" />
                <span className="truncate">{routeLabel}</span>
              </div>
            </div>

            <div className="text-right shrink-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-white/60">Duration</div>
              <div className="text-lg sm:text-xl font-mono font-extrabold text-emerald-300 tabular-nums mt-0.5">
                {hrs}:{mins}:{secs}
              </div>
            </div>
          </div>

          {/* 4-cell Odometer & Time Grid */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-2xl bg-white/10 border border-white/15 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/65 flex items-center justify-between">
                <span>Out KM (Locked)</span>
                <Lock className="h-3 w-3 text-white/60" />
              </div>
              <div className="text-lg font-extrabold text-white mt-0.5">
                {outKm.toLocaleString()} KM
              </div>
            </div>

            <div className="rounded-2xl bg-white/10 border border-white/15 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/65 flex items-center justify-between">
                <span>Current Vehicle Odo</span>
                <Gauge className="h-3 w-3 text-emerald-300" />
              </div>
              <div className="text-lg font-extrabold text-emerald-200 mt-0.5">
                {authoritativeOdometer.toLocaleString()} KM
              </div>
            </div>

            <div className="rounded-2xl bg-white/10 border border-white/15 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/65 flex items-center gap-1">
                <Clock className="h-3 w-3" /> Trip Start Time
              </div>
              <div className="text-xs sm:text-sm font-bold text-white mt-0.5">
                {outDate} · {outTime} IST
              </div>
            </div>

            <div className="rounded-2xl bg-white/10 border border-white/15 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/65 flex items-center gap-1">
                <Radio className="h-3 w-3" /> GPS Tracking
              </div>
              <div className="text-xs sm:text-sm font-bold text-white mt-0.5">
                {isGpsActive ? `${vehicle.status} (${vehicle.speed} km/h)` : "Manual Odometer Mode"}
              </div>
            </div>
          </div>

          {/* Primary Actions */}
          <div className="space-y-2.5 pt-1">
            <button
              type="button"
              onClick={onCompleteTripClockOut}
              className="w-full min-h-[58px] rounded-2xl bg-white text-slate-900 font-extrabold text-sm sm:text-base tracking-wide shadow-lg flex items-center justify-center gap-2.5 transition-all active:scale-[0.99] hover:bg-slate-50 cursor-pointer"
            >
              <ClipboardCheck className="h-5 w-5 text-indigo-600" />
              <span>COMPLETE TRIP / CLOCK OUT</span>
            </button>

            <button
              type="button"
              onClick={onViewRoute}
              className="w-full min-h-[44px] rounded-xl bg-white/10 border border-white/20 text-white text-xs font-bold flex items-center justify-center gap-2 hover:bg-white/15 transition-colors cursor-pointer"
            >
              <MapPin className="h-4 w-4 text-emerald-300" /> Open Route Directions in Google Maps
            </button>
          </div>
        </div>
      </div>

      {/* Lock rule note */}
      <div className="rounded-2xl p-3.5 bg-indigo-50/80 border border-indigo-200/80 text-xs text-indigo-900 flex items-start gap-2.5">
        <Lock className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
        <span>
          Only one active trip is allowed at a time. Tap <strong>COMPLETE TRIP / CLOCK OUT</strong> upon return to fill the Vehicle Operation Statement and update the vehicle&apos;s master odometer.
        </span>
      </div>
    </div>
  );
}
