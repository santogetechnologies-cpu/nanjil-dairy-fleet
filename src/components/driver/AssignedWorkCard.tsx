import { useState } from "react";
import { Calendar, Clock, Eye, MapPin, Route as RouteIcon, Truck, X } from "lucide-react";
import { Badge } from "@/components/ui-kit";
import type { RouteAssignmentRecord, RouteSummaryInfo } from "@/lib/driverRouteAssignments";
import type { DriverAssignedVehicle, DriverProfileData } from "./types";

interface AssignedWorkCardProps {
  driver: DriverProfileData;
  vehicle: DriverAssignedVehicle;
  assignment: RouteAssignmentRecord | null;
  upcomingAssignment?: RouteAssignmentRecord | null;
  routeSummary: RouteSummaryInfo | null;
  authoritativeOdometer: number;
}

export function AssignedWorkCard({
  driver,
  vehicle,
  assignment,
  upcomingAssignment,
  routeSummary,
  authoritativeOdometer,
}: AssignedWorkCardProps) {
  const [showRouteDetailsModal, setShowRouteDetailsModal] = useState(false);

  const effectiveAssignment = assignment || upcomingAssignment;
  const hasVehicle = Boolean(vehicle?.id || effectiveAssignment?.vehicle_id);
  const regNumber = effectiveAssignment?.vehicles?.number || (hasVehicle ? vehicle.number : "Unassigned");
  const vehLabel = effectiveAssignment?.vehicles
    ? `${effectiveAssignment.vehicles.type || "Tanker"}${
        effectiveAssignment.vehicles.model ? ` · ${effectiveAssignment.vehicles.model}` : ""
      }`
    : vehicle.model || vehicle.type || "—";

  const routeName =
    routeSummary?.name ||
    effectiveAssignment?.route_name ||
    (vehicle.route && vehicle.route !== "No route assigned" ? vehicle.route : "No route assigned");
  const startPoint = routeSummary?.startPoint || "—";
  const destination = routeSummary?.destination || "—";
  const outboundStops = routeSummary?.outboundStops || routeSummary?.stops || [];
  const returnStops = routeSummary?.returnStops || [];
  const totalStopsCount = outboundStops.length + returnStops.length;
  const centresCount = totalStopsCount > 0 ? totalStopsCount : routeSummary?.centresCount ?? 0;
  const totalDistanceKm = routeSummary?.totalDistanceKm ?? null;
  const totalDurationMins = routeSummary?.totalDurationMins ?? null;

  const assignStatus = effectiveAssignment?.status || (hasVehicle ? "Assigned" : "Unassigned");
  const assignDate = effectiveAssignment?.assignment_date || "Today";
  const departureTime =
    effectiveAssignment?.departure_time || routeSummary?.departureTime || "05:30";

  return (
    <div className="bg-card border border-border rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
            <RouteIcon className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-foreground uppercase tracking-wider">
              Assigned Work &amp; Collection Route
            </div>
            <div className="text-[11px] text-muted-foreground">
              Driver: <strong>{driver.name}</strong> · Synced from Admin Dispatch
            </div>
          </div>
        </div>
        <Badge status={assignStatus === "In Progress" || assignStatus === "Assigned" ? "Moving" : "Idle"}>
          {assignStatus}
        </Badge>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs bg-muted/40 p-3 rounded-xl border border-border/60">
        <div>
          <div className="text-[10px] font-bold uppercase text-muted-foreground">Vehicle Reg No</div>
          <div className="font-extrabold text-foreground mt-0.5 flex items-center gap-1">
            <Truck className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
            <span>{regNumber}</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase text-muted-foreground">Vehicle Model</div>
          <div className="font-semibold text-foreground mt-0.5 truncate">{vehLabel}</div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase text-muted-foreground">Odometer</div>
          <div className="font-bold text-indigo-700 mt-0.5">
            {hasVehicle ? `${authoritativeOdometer.toLocaleString()} KM` : "—"}
          </div>
        </div>

        <div className="col-span-2 sm:col-span-3 pt-1 border-t border-border/60">
          <div className="text-[10px] font-bold uppercase text-muted-foreground">Assigned Collection Route</div>
          <div className="font-bold text-slate-900 mt-0.5">{routeName}</div>
        </div>

        <div>
          <div className="text-[10px] font-bold uppercase text-muted-foreground">Starting Point</div>
          <div className="font-semibold text-foreground mt-0.5 truncate">{startPoint}</div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase text-muted-foreground">Destination</div>
          <div className="font-semibold text-foreground mt-0.5 truncate">{destination}</div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase text-muted-foreground">Collection Centres</div>
          <div className="font-bold text-indigo-700 mt-0.5">
            {centresCount > 0 ? `${centresCount} Centres` : "—"}
          </div>
        </div>

        <div>
          <div className="text-[10px] font-bold uppercase text-muted-foreground">Assignment Date</div>
          <div className="font-semibold text-foreground mt-0.5 flex items-center gap-1">
            <Calendar className="h-3 w-3 text-slate-400" />
            <span>{assignDate}</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase text-muted-foreground">Departure Time</div>
          <div className="font-semibold text-foreground mt-0.5 flex items-center gap-1">
            <Clock className="h-3 w-3 text-slate-400" />
            <span>{departureTime} IST</span>
          </div>
        </div>
        {(totalDistanceKm != null || totalDurationMins != null) && (
          <div>
            <div className="text-[10px] font-bold uppercase text-muted-foreground">Distance / Est.</div>
            <div className="font-semibold text-foreground mt-0.5">
              {totalDistanceKm != null ? `${totalDistanceKm} km` : "—"}
              {totalDurationMins != null ? ` · ${totalDurationMins}m` : ""}
            </div>
          </div>
        )}
        {effectiveAssignment?.notes && (
          <div className="col-span-2 sm:col-span-3 pt-1 border-t border-border/60 text-slate-600">
            <span className="text-[10px] font-bold uppercase text-muted-foreground mr-1">Notes:</span>
            {effectiveAssignment.notes}
          </div>
        )}
      </div>

      {hasVehicle && (
        <button
          type="button"
          onClick={() => setShowRouteDetailsModal(true)}
          className="w-full min-h-[42px] rounded-xl border border-indigo-200 bg-indigo-50/80 hover:bg-indigo-100 text-indigo-800 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Eye className="h-3.5 w-3.5" /> View Assigned Route Details
        </button>
      )}

      {/* Route Details Modal */}
      {showRouteDetailsModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-white overflow-hidden shadow-2xl">
            <div
              className="px-5 py-4 text-white flex items-center justify-between"
              style={{ background: "linear-gradient(135deg, oklch(0.18 0.08 258), oklch(0.28 0.14 264))" }}
            >
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/70">
                  Assigned Route &amp; Centres
                </div>
                <div className="text-sm font-extrabold">{routeName}</div>
              </div>
              <button
                type="button"
                onClick={() => setShowRouteDetailsModal(false)}
                className="p-2 rounded-xl bg-white/10 text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-2.5 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Starting Point</div>
                  <div className="font-bold text-slate-900">{startPoint}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Destination</div>
                  <div className="font-bold text-slate-900">{destination}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Schedule</div>
                  <div className="font-semibold text-slate-800">
                    {assignDate} · {departureTime} IST
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Vehicle</div>
                  <div className="font-bold text-indigo-700">{regNumber}</div>
                </div>
                {(totalDistanceKm != null || totalDurationMins != null) && (
                  <div className="col-span-2 pt-2 border-t border-slate-200 flex items-center justify-between text-[11px]">
                    <span className="text-slate-500 font-semibold uppercase">Distance / Estimated Time</span>
                    <span className="font-bold text-slate-900">
                      {totalDistanceKm != null ? `${totalDistanceKm} km` : "—"}
                      {totalDurationMins != null ? ` · ${totalDurationMins} mins` : ""}
                    </span>
                  </div>
                )}
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Outbound Stops Sequence ({outboundStops.length || centresCount})
                </div>
                {outboundStops.length === 0 ? (
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-500">
                    Route stop sequence configured under route summary ({centresCount} stops).
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {outboundStops.map((s, idx) => (
                      <div
                        key={s.id || idx}
                        className="flex items-center justify-between gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="h-5 w-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                            {idx + 1}
                          </span>
                          <MapPin className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-800 truncate">{s.name}</div>
                            {typeof s.lat === "number" && typeof s.lng === "number" && (
                              <div className="text-[10px] text-slate-400 font-mono">
                                {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                              </div>
                            )}
                          </div>
                        </div>
                        {typeof s.isMandatory === "boolean" && (
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 ${
                              s.isMandatory
                                ? "bg-red-50 text-red-700 border border-red-200"
                                : "bg-slate-200/70 text-slate-600"
                            }`}
                          >
                            {s.isMandatory ? "Mandatory" : "Optional"}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {returnStops.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 mb-2">
                    Return Stops Sequence ({returnStops.length})
                  </div>
                  <div className="space-y-1.5">
                    {returnStops.map((s, idx) => (
                      <div
                        key={s.id || idx}
                        className="flex items-center justify-between gap-2.5 p-2.5 rounded-xl bg-emerald-50/50 border border-emerald-200/80"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="h-5 w-5 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                            R{idx + 1}
                          </span>
                          <MapPin className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-800 truncate">{s.name}</div>
                            {typeof s.lat === "number" && typeof s.lng === "number" && (
                              <div className="text-[10px] text-slate-400 font-mono">
                                {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowRouteDetailsModal(false)}
                className="w-full min-h-[46px] rounded-xl bg-slate-900 text-white font-bold text-xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
