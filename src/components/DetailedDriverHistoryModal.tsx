import { useState } from "react";
import { Calendar, Clock, FileText, Gauge, History, MapPin, Route as RouteIcon, Truck, User, X } from "lucide-react";
import { Badge } from "@/components/ui-kit";
import type { DetailedDriverHistoryBundle } from "@/lib/driverAttendanceReports";

interface DetailedDriverHistoryModalProps {
  bundle: DetailedDriverHistoryBundle | null;
  onClose: () => void;
}

export function DetailedDriverHistoryModal({ bundle, onClose }: DetailedDriverHistoryModalProps) {
  const [section, setSection] = useState<"timeline" | "shifts" | "assignments" | "trips">("timeline");

  if (!bundle) return null;
  const { driver, shifts, assignments, routes, vehicles, trips, totalDistanceKm, totalWorkingHours, timeline } =
    bundle;

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-white/15 flex items-center justify-center font-extrabold text-sm shrink-0">
              {(driver?.name || "D").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                Driver Operational Audit &amp; History
              </div>
              <div className="text-base font-extrabold truncate">{driver?.name || "Driver"}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Summary Strip & Profile Info */}
        <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/70 space-y-3 shrink-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <div className="bg-white p-3 rounded-xl border border-slate-200">
              <div className="text-[10px] font-bold uppercase text-slate-400">Contact &amp; License</div>
              <div className="font-bold text-slate-900 mt-0.5">{driver?.phone || "No contact"}</div>
              <div className="text-[11px] text-slate-500">{driver?.license || "—"}</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200">
              <div className="text-[10px] font-bold uppercase text-slate-400">Working Hours</div>
              <div className="text-lg font-extrabold text-indigo-700 mt-0.5">
                {totalWorkingHours.toFixed(2)} h
              </div>
              <div className="text-[11px] text-slate-500">{shifts.length} total shifts</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200">
              <div className="text-[10px] font-bold uppercase text-slate-400">Distance Travelled</div>
              <div className="text-lg font-extrabold text-emerald-700 mt-0.5">
                {totalDistanceKm.toLocaleString()} km
              </div>
              <div className="text-[11px] text-slate-500">{trips.length} trip statements</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200">
              <div className="text-[10px] font-bold uppercase text-slate-400">Assets &amp; Routes</div>
              <div className="font-bold text-slate-900 mt-0.5 truncate" title={vehicles.join(", ")}>
                {vehicles.length > 0 ? vehicles.join(", ") : "None"}
              </div>
              <div className="text-[11px] text-slate-500 truncate" title={routes.join(", ")}>
                {routes.length} routes driven
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {[
              { id: "timeline", label: `Chronological Timeline (${timeline.length})` },
              { id: "shifts", label: `Clock-In / Out Log (${shifts.length})` },
              { id: "assignments", label: `Vehicle & Route History (${assignments.length})` },
              { id: "trips", label: `Trips & Statements (${trips.length})` },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSection(t.id as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                  section === t.id
                    ? "bg-slate-900 text-white"
                    : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable Detail Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 text-xs">
          {section === "timeline" && (
            timeline.length === 0 ? (
              <div className="py-10 text-center text-slate-400">No historical activity recorded yet.</div>
            ) : (
              <div className="space-y-2.5">
                {timeline.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-2xl border border-slate-200 bg-white flex items-start justify-between gap-3"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                        {item.kind === "SHIFT" ? (
                          <Clock className="h-4 w-4 text-indigo-600" />
                        ) : item.kind === "ASSIGNMENT" ? (
                          <RouteIcon className="h-4 w-4 text-amber-600" />
                        ) : (
                          <FileText className="h-4 w-4 text-emerald-600" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900">{item.title}</div>
                        <div className="text-slate-600 mt-0.5">{item.subtitle}</div>
                        <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-3 w-3" /> {item.dateIst}
                          </span>
                          <span>·</span>
                          <span>{item.timeIst}</span>
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {item.badge}
                    </Badge>
                  </div>
                ))}
              </div>
            )
          )}

          {section === "shifts" && (
            shifts.length === 0 ? (
              <div className="py-10 text-center text-slate-400">No clock-in / clock-out records found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px]">
                      <th className="py-2 px-3">Date (IST)</th>
                      <th className="py-2 px-3">Clock-In</th>
                      <th className="py-2 px-3">Clock-Out</th>
                      <th className="py-2 px-3">Working Hours</th>
                      <th className="py-2 px-3">Vehicle</th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shifts.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2.5 px-3 font-semibold text-slate-800">{s.date}</td>
                        <td className="py-2.5 px-3 text-slate-700">{s.clockInTime}</td>
                        <td className="py-2.5 px-3 text-slate-700">{s.clockOutTime}</td>
                        <td className="py-2.5 px-3 font-bold text-indigo-700">{s.totalWorkingHours}</td>
                        <td className="py-2.5 px-3 font-bold text-slate-900">{s.vehicleRegistration}</td>
                        <td className="py-2.5 px-3">
                          <Badge variant="outline" className="text-[10px]">{s.attendanceStatus}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {section === "assignments" && (
            assignments.length === 0 ? (
              <div className="py-10 text-center text-slate-400">No vehicle or route assignments found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px]">
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Vehicle</th>
                      <th className="py-2 px-3">Collection Route</th>
                      <th className="py-2 px-3">Departure</th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {assignments.map((a: any) => (
                      <tr key={a.id}>
                        <td className="py-2.5 px-3 font-semibold text-slate-800">{a.assignment_date || "—"}</td>
                        <td className="py-2.5 px-3 font-bold text-slate-900">{a.vehicles?.number || "—"}</td>
                        <td className="py-2.5 px-3 text-slate-700">
                          {a.route_name || a.collection_routes?.name || "—"}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">{a.departure_time || "—"} IST</td>
                        <td className="py-2.5 px-3">
                          <Badge variant="outline" className="text-[10px]">{a.status || (a.is_active ? "Assigned" : "Completed")}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {section === "trips" && (
            trips.length === 0 ? (
              <div className="py-10 text-center text-slate-400">No trip statements recorded yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px]">
                      <th className="py-2 px-3">Statement</th>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Vehicle</th>
                      <th className="py-2 px-3">Route</th>
                      <th className="py-2 px-3">Out → In KM</th>
                      <th className="py-2 px-3">Distance</th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {trips.map((t) => (
                      <tr key={t.id}>
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-700">{t.statementNumber}</td>
                        <td className="py-2.5 px-3 text-slate-700">{t.tripDate}</td>
                        <td className="py-2.5 px-3 font-bold text-slate-900">{t.vehicleRegistration}</td>
                        <td className="py-2.5 px-3 text-slate-700">
                          {t.routeName} ({t.startingPoint} → {t.destination})
                        </td>
                        <td className="py-2.5 px-3 text-slate-700">{t.outKm} → {t.inKm}</td>
                        <td className="py-2.5 px-3 font-extrabold text-indigo-700">{t.distanceTravelled}</td>
                        <td className="py-2.5 px-3">
                          <Badge variant="outline" className="text-[10px]">{t.tripStatus}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
