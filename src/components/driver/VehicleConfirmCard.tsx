import { CheckCircle2, Gauge, Loader2, Lock, MapPin, ShieldCheck, Truck, X } from "lucide-react";
import { Badge } from "@/components/ui-kit";
import type { DriverAssignedVehicle, DriverProfileData } from "./types";

interface VehicleConfirmCardProps {
  driver: DriverProfileData;
  vehicle: DriverAssignedVehicle;
  assignedVehicles: any[];
  authoritativeOdometer: number;
  outDate: string;
  outTime: string;
  routeValue: string;
  salesmanValue: string;
  submitting: boolean;
  errorBanner?: string | null;
  onChangeVehicle: (vehicleId: string) => void;
  onChangeRoute: (route: string) => void;
  onChangeSalesman: (salesman: string) => void;
  onConfirmStartTrip: () => void;
  onCancelClockIn: () => void;
}

export function VehicleConfirmCard({
  driver,
  vehicle,
  assignedVehicles,
  authoritativeOdometer,
  outDate,
  outTime,
  routeValue,
  salesmanValue,
  submitting,
  errorBanner,
  onChangeVehicle,
  onChangeRoute,
  onChangeSalesman,
  onConfirmStartTrip,
  onCancelClockIn,
}: VehicleConfirmCardProps) {
  const assignedDateLabel = vehicle.assignedAt
    ? new Date(vehicle.assignedAt).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Active Assignment";

  return (
    <div className="space-y-4">
      <div
        className="rounded-3xl overflow-hidden border border-indigo-200 bg-card shadow-md"
        style={{ boxShadow: "0 12px 32px oklch(0.38 0.20 264 / 0.14)" }}
      >
        {/* Top Highlight Banner */}
        <div
          className="px-5 py-5 text-white"
          style={{
            background: "linear-gradient(135deg, oklch(0.24 0.12 260) 0%, oklch(0.38 0.20 264) 100%)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 px-2.5 py-1 rounded-full">
              <CheckCircle2 className="h-3.5 w-3.5" /> Clocked In · Step 2 of 2
            </span>
            <Badge status={vehicle.status}>{vehicle.status}</Badge>
          </div>

          <h2 className="text-lg sm:text-xl font-extrabold mt-3 tracking-tight">
            Is this your assigned vehicle?
          </h2>
          <p className="text-xs text-white/75 mt-0.5">
            Verify vehicle registration, route, and starting odometer before departing.
          </p>

          {assignedVehicles.length > 1 && (
            <div className="mt-3">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-white/70 mb-1">
                Select Assigned Vehicle
              </label>
              <select
                value={vehicle.id || ""}
                onChange={(e) => onChangeVehicle(e.target.value)}
                className="w-full h-11 px-3 rounded-xl bg-white/15 border border-white/25 text-white text-sm font-bold focus:outline-none"
              >
                {assignedVehicles.map((v) => (
                  <option key={v.id} value={v.id} className="text-slate-900 bg-white">
                    {v.number} {v.model ? `(${v.model})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Vehicle Details Card Body */}
        <div className="p-5 space-y-4">
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-200/80">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
                  <Truck className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Vehicle Registration
                  </div>
                  <div className="text-xl font-extrabold text-slate-900 tracking-tight">
                    {vehicle.number}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Model</div>
                <div className="text-xs font-bold text-slate-700 mt-0.5">
                  {vehicle.model || vehicle.type || "Dairy Tanker"}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Driver Name</div>
                <div className="font-bold text-slate-800 mt-0.5">{driver.name}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Assignment Info</div>
                <div className="font-semibold text-slate-700 mt-0.5 flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  <span>{assignedDateLabel}</span>
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                  <MapPin className="h-3 w-3 text-indigo-500" /> Assigned Route
                </div>
                <div className="font-bold text-slate-800 mt-0.5">
                  {vehicle.route || routeValue || "Collection Route"}
                </div>
              </div>
            </div>

            {/* Locked Out KM + Automatic Date/Time */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200/80">
              <div className="col-span-3 sm:col-span-1 rounded-xl bg-indigo-50 border border-indigo-200 p-2.5">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase text-indigo-700">
                  <span>Current Odo (Out KM)</span>
                  <Lock className="h-3 w-3" />
                </div>
                <div className="text-base font-extrabold text-indigo-950 mt-0.5 flex items-center gap-1">
                  <Gauge className="h-4 w-4 text-indigo-600 shrink-0" />
                  {authoritativeOdometer.toLocaleString()} KM
                </div>
              </div>
              <div className="rounded-xl bg-white border border-slate-200 p-2.5">
                <div className="text-[10px] font-bold uppercase text-slate-400">Out Date</div>
                <div className="text-xs font-bold text-slate-800 mt-0.5">{outDate}</div>
              </div>
              <div className="rounded-xl bg-white border border-slate-200 p-2.5">
                <div className="text-[10px] font-bold uppercase text-slate-400">Out Time</div>
                <div className="text-xs font-bold text-slate-800 mt-0.5">{outTime} IST</div>
              </div>
            </div>
          </div>

          {/* Route Override ONLY if admin hasn't configured one, plus optional Salesman */}
          {(!vehicle.route || vehicle.route === "No route assigned") && (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                Collection Route *
              </label>
              <input
                type="text"
                value={routeValue}
                onChange={(e) => onChangeRoute(e.target.value)}
                placeholder="e.g. Nagercoil Plant to Kolachal"
                className="w-full h-12 px-3.5 rounded-xl border border-border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
              Salesman Name <span className="normal-case font-normal text-slate-400">(optional)</span>
            </label>
            <input
              type="text"
              value={salesmanValue}
              onChange={(e) => onChangeSalesman(e.target.value)}
              placeholder="Enter salesman name if accompanied"
              className="w-full h-12 px-3.5 rounded-xl border border-border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {errorBanner && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700"
            >
              {errorBanner}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
            <button
              type="button"
              onClick={onConfirmStartTrip}
              disabled={submitting || !vehicle.id}
              className="flex-1 min-h-[54px] rounded-2xl text-sm sm:text-base font-extrabold text-white flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.99] disabled:opacity-50 cursor-pointer"
              style={{
                background: "linear-gradient(135deg, oklch(0.46 0.20 155) 0%, oklch(0.40 0.18 150) 100%)",
              }}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Starting Trip…</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5" />
                  <span>Confirm &amp; Start Trip</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onCancelClockIn}
              disabled={submitting}
              className="sm:w-36 min-h-[50px] rounded-2xl text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
            >
              <X className="h-4 w-4" /> Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
