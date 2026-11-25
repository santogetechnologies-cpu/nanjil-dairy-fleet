import { useMemo, useState } from "react";
import { Calendar, Eye, FileText, Lock, Route, X } from "lucide-react";
import { Badge } from "@/components/ui-kit";
import {
  filterDriverTripsByPeriod,
  formatIsoToIstTime,
  formatStatementNumber,
  type DriverTripPeriodFilter,
  type VehicleOperationTripRecord,
} from "@/lib/driverOperationStatement";
import { getTodayIstDateString } from "@/lib/odometerTrackingEngine";

interface MyTripsTabProps {
  ongoingTrip: VehicleOperationTripRecord | null;
  tripsHistory: VehicleOperationTripRecord[];
  defaultVehicleNumber?: string;
  driverName: string;
}

export function MyTripsTab({
  ongoingTrip,
  tripsHistory,
  defaultVehicleNumber,
  driverName,
}: MyTripsTabProps) {
  const [period, setPeriod] = useState<DriverTripPeriodFilter>("month");
  const [customStart, setCustomStart] = useState(() => getTodayIstDateString());
  const [customEnd, setCustomEnd] = useState(() => getTodayIstDateString());
  const [inspectTrip, setInspectTrip] = useState<VehicleOperationTripRecord | null>(null);

  const combinedTrips = useMemo(() => {
    const map = new Map<string, VehicleOperationTripRecord>();
    if (ongoingTrip) map.set(ongoingTrip.id, ongoingTrip);
    tripsHistory.forEach((t) => {
      if (!map.has(t.id)) map.set(t.id, t);
    });
    return Array.from(map.values());
  }, [ongoingTrip, tripsHistory]);

  const filteredTrips = useMemo(
    () => filterDriverTripsByPeriod(combinedTrips, period, customStart, customEnd),
    [combinedTrips, period, customStart, customEnd]
  );

  const summaryStats = useMemo(() => {
    let totalKm = 0;
    let totalDiesel = 0;
    filteredTrips.forEach((t) => {
      totalKm += Number(t.distance || 0);
      totalDiesel += Number(t.diesel_liters || 0);
    });
    return {
      count: filteredTrips.length,
      totalKm: Math.round(totalKm * 10) / 10,
      totalDiesel: Math.round(totalDiesel * 10) / 10,
    };
  }, [filteredTrips]);

  return (
    <div className="space-y-4">
      {/* Period Filters */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600">
            <Calendar className="h-3.5 w-3.5 text-indigo-600" />
            <span>Trip Period</span>
          </div>
          <span className="text-[11px] font-semibold text-indigo-700">
            {summaryStats.count} {summaryStats.count === 1 ? "Trip" : "Trips"} ·{" "}
            {summaryStats.totalKm.toLocaleString()} KM
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {[
            { id: "today" as const, label: "Today" },
            { id: "week" as const, label: "This Week" },
            { id: "month" as const, label: "This Month" },
            { id: "custom" as const, label: "Custom" },
          ].map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => setPeriod(btn.id)}
              className={`min-h-[40px] rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                period === btn.id
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>

        {period === "custom" && (
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">From</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-border bg-background text-xs font-semibold"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">To</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-border bg-background text-xs font-semibold"
              />
            </div>
          </div>
        )}
      </div>

      {/* Trip Cards List */}
      {filteredTrips.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-8 text-center space-y-2 shadow-xs">
          <Route className="h-10 w-10 text-slate-300 mx-auto" />
          <div className="text-sm font-bold text-foreground">No Trips Found</div>
          <p className="text-xs text-muted-foreground">
            No Vehicle Operation Statements match the selected period.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTrips.map((t) => {
            const isOngoing = t.status === "Ongoing";
            const outTime = t.out_time || formatIsoToIstTime(t.started_at || t.created_at) || "—";
            const inTime = t.in_time || formatIsoToIstTime(t.closed_at) || "—";
            const diesel = Number(t.diesel_liters || 0);
            const amount = Number(t.fuel_amount || 0);
            const kmplDisplay = diesel > 0 && t.kmpl != null ? `${Number(t.kmpl).toFixed(2)} km/L` : "N/A";
            const statementNo = formatStatementNumber(t);

            return (
              <div
                key={t.id}
                className="bg-card border border-border rounded-2xl p-4 shadow-xs space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-extrabold text-foreground">
                        {t.vehicles?.number || defaultVehicleNumber || "Assigned Vehicle"}
                      </span>
                      <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                        {statementNo}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {t.destination ? `${t.start} → ${t.destination}` : t.start}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge status={isOngoing ? "Moving" : "Completed"}>
                      {isOngoing ? "IN PROGRESS" : t.status}
                    </Badge>
                    {!isOngoing && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400">
                        <Lock className="h-2.5 w-2.5" /> Read-Only
                      </span>
                    )}
                  </div>
                </div>

                {/* Timestamps Grid */}
                <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-200/70">
                  <div>
                    <div className="text-[10px] font-bold uppercase text-slate-400">Out Date &amp; Time</div>
                    <div className="font-semibold text-slate-800 mt-0.5">
                      {t.out_date || t.date} · {outTime}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase text-slate-400">In Date &amp; Time</div>
                    <div className="font-semibold text-slate-800 mt-0.5">
                      {isOngoing ? "Ongoing" : `${t.in_date || t.date} · ${inTime}`}
                    </div>
                  </div>
                </div>

                {/* Odometer & Fuel Grid */}
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-muted/35 p-2.5 rounded-xl">
                    <div className="text-[10px] text-muted-foreground">Out KM</div>
                    <div className="font-bold text-foreground mt-0.5">
                      {Number(t.start_km || 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-muted/35 p-2.5 rounded-xl">
                    <div className="text-[10px] text-muted-foreground">In KM</div>
                    <div className="font-bold text-foreground mt-0.5">
                      {t.end_km != null ? Number(t.end_km).toLocaleString() : "—"}
                    </div>
                  </div>
                  <div className="bg-indigo-50 p-2.5 rounded-xl border border-indigo-100">
                    <div className="text-[10px] text-indigo-700 font-semibold">Running KM</div>
                    <div className="font-extrabold text-indigo-900 mt-0.5">
                      {t.distance != null ? `${Number(t.distance).toLocaleString()} KM` : "—"}
                    </div>
                  </div>

                  <div className="bg-muted/35 p-2.5 rounded-xl">
                    <div className="text-[10px] text-muted-foreground">Diesel</div>
                    <div className="font-semibold text-foreground mt-0.5">
                      {diesel > 0 ? `${diesel.toFixed(1)} L` : "0 L"}
                    </div>
                  </div>
                  <div className="bg-muted/35 p-2.5 rounded-xl">
                    <div className="text-[10px] text-muted-foreground">Amount</div>
                    <div className="font-semibold text-foreground mt-0.5">
                      ₹ {Math.round(amount).toLocaleString("en-IN")}
                    </div>
                  </div>
                  <div className="bg-emerald-50/80 p-2.5 rounded-xl border border-emerald-100">
                    <div className="text-[10px] text-emerald-700 font-semibold">KMPL</div>
                    <div className="font-bold text-emerald-900 mt-0.5">{kmplDisplay}</div>
                  </div>
                </div>

                {!isOngoing && (
                  <button
                    type="button"
                    onClick={() => setInspectTrip(t)}
                    className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Eye className="h-3.5 w-3.5 text-indigo-600" /> View Read-Only Operation Statement
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Read-Only Statement Details Modal */}
      {inspectTrip && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 z-50">
          <div className="w-full max-w-md rounded-3xl bg-white overflow-hidden shadow-2xl">
            <div
              className="px-5 py-4 text-white flex items-center justify-between"
              style={{ background: "linear-gradient(135deg, oklch(0.16 0.07 258), oklch(0.24 0.10 264))" }}
            >
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/70">
                  Read-Only Operation Statement
                </div>
                <div className="text-base font-extrabold flex items-center gap-1.5">
                  <FileText className="h-4 w-4" />
                  <span>{formatStatementNumber(inspectTrip)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectTrip(null)}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Vehicle</div>
                  <div className="font-bold text-slate-900">
                    {inspectTrip.vehicles?.number || defaultVehicleNumber}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Driver</div>
                  <div className="font-semibold text-slate-800">{driverName}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-[10px] font-bold uppercase text-slate-400">Route</div>
                  <div className="font-semibold text-slate-800">
                    {inspectTrip.destination
                      ? `${inspectTrip.start} → ${inspectTrip.destination}`
                      : inspectTrip.start}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Out</div>
                  <div className="font-semibold text-slate-800">
                    {inspectTrip.out_date || inspectTrip.date} ·{" "}
                    {inspectTrip.out_time || formatIsoToIstTime(inspectTrip.started_at)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">In</div>
                  <div className="font-semibold text-slate-800">
                    {inspectTrip.in_date || inspectTrip.date} ·{" "}
                    {inspectTrip.in_time || formatIsoToIstTime(inspectTrip.closed_at)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Out KM</div>
                  <div className="font-bold text-slate-800">
                    {Number(inspectTrip.start_km || 0).toLocaleString()} KM
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">In KM</div>
                  <div className="font-bold text-slate-900">
                    {Number(inspectTrip.end_km || 0).toLocaleString()} KM
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Running KMs</div>
                  <div className="font-extrabold text-indigo-700">
                    {Number(inspectTrip.distance || 0).toLocaleString()} KM
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Diesel &amp; Amount</div>
                  <div className="font-semibold text-slate-800">
                    {Number(inspectTrip.diesel_liters || 0).toFixed(1)} L · ₹{" "}
                    {Math.round(Number(inspectTrip.fuel_amount || 0)).toLocaleString("en-IN")}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">KMPL</div>
                  <div className="font-bold text-emerald-700">
                    {Number(inspectTrip.diesel_liters || 0) > 0 && inspectTrip.kmpl != null
                      ? `${Number(inspectTrip.kmpl).toFixed(2)} km/L`
                      : "N/A"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Odo Source</div>
                  <div className="font-mono text-[10px] text-slate-600">
                    {inspectTrip.odometer_updated_source || "DRIVER_TRIP_CLOSURE"}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                <span>Completed statements are locked. Contact Fleet Admin for authorized edits.</span>
              </div>

              <button
                type="button"
                onClick={() => setInspectTrip(null)}
                className="w-full min-h-[46px] rounded-xl bg-slate-900 text-white font-bold text-xs cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
