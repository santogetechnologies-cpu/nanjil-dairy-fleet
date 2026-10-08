import { 
  Wrench, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  IndianRupee, 
  ArrowRight, 
  FileText,
  AlertTriangle
} from "lucide-react";
import { Card, CardHeader, Badge } from "@/components/ui-kit";
import type { MaintenanceRecordItem, MaintenanceHealthStatus } from "../types";
import type { Vehicle } from "@/lib/types";

interface VehicleMaintenanceProps {
  vehicle: Vehicle;
  records: MaintenanceRecordItem[];
  healthStatus: MaintenanceHealthStatus;
}

export function VehicleMaintenance({ vehicle, records, healthStatus }: VehicleMaintenanceProps) {
  // Sort records: newest first
  const sortedRecords = [...records].sort((a, b) => {
    const da = a.due_date ? new Date(a.due_date).getTime() : 0;
    const db = b.due_date ? new Date(b.due_date).getTime() : 0;
    return db - da;
  });

  const completedRecords = records.filter((r) => r.status === "Completed");
  const upcomingRecords = records.filter((r) => r.status === "Upcoming" || r.status === "Overdue");

  // Last service
  const lastCompleted = completedRecords.length > 0
    ? [...completedRecords].sort((a, b) => {
        const da = a.due_date ? new Date(a.due_date).getTime() : 0;
        const db = b.due_date ? new Date(b.due_date).getTime() : 0;
        return db - da;
      })[0]
    : null;

  // Next service
  const nextScheduled = upcomingRecords.length > 0
    ? [...upcomingRecords].sort((a, b) => {
        const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
        const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
        return da - db;
      })[0]
    : null;

  // Days until service
  let daysUntilService: number | null = null;
  if (nextScheduled?.due_date) {
    const target = new Date(nextScheduled.due_date).getTime();
    const today = new Date().setHours(0, 0, 0, 0);
    daysUntilService = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
  }

  // Total expenditure
  const totalCost = records.reduce((acc, r) => acc + (Number(r.cost) || 0), 0);

  // Status badge style
  const healthBadgeColor: Record<string, string> = {
    Good: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    "Due Soon": "bg-amber-500/10 text-amber-600 border-amber-500/20",
    Due: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    Overdue: "bg-rose-500/10 text-rose-600 border-rose-500/20",
    "Under Maintenance": "bg-purple-500/10 text-purple-600 border-purple-500/20",
  };

  return (
    <div className="space-y-5">
      {/* ── 1. Top Maintenance Status Summary Cards ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bold text-base text-foreground tracking-tight flex items-center gap-2">
              <Wrench className="h-4 w-4 text-primary" />
              Maintenance Health & Service Summary
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Service history, upcoming intervals, and cost tracking
            </p>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${healthBadgeColor[healthStatus] || "bg-muted text-muted-foreground"}`}>
            Status: {healthStatus}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Last Service */}
          <Card className="p-3 bg-card shadow-2xs">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
              Last Service
            </span>
            <div className="mt-1 font-bold text-sm text-foreground truncate" title={lastCompleted?.service || vehicle.lastService || "None logged"}>
              {lastCompleted?.due_date || vehicle.lastService || "None logged"}
            </div>
            <span className="text-[10px] text-muted-foreground block truncate">
              {lastCompleted?.service || "Routine Service"}
            </span>
          </Card>

          {/* Next Service */}
          <Card className="p-3 bg-card shadow-2xs">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
              Next Service
            </span>
            <div className="mt-1 font-bold text-sm text-foreground truncate" title={nextScheduled?.due_date || (vehicle.nextServiceKm ? `${vehicle.nextServiceKm.toLocaleString()} km` : "Scheduled")}>
              {nextScheduled?.due_date || (vehicle.nextServiceKm ? `${vehicle.nextServiceKm.toLocaleString()} km` : "Scheduled")}
            </div>
            <span className="text-[10px] text-muted-foreground block truncate">
              {nextScheduled?.service || "General Inspection"}
            </span>
          </Card>

          {/* Days Until Service */}
          <Card className="p-3 bg-card shadow-2xs">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
              Days to Service
            </span>
            <div className="mt-1 font-bold text-sm text-foreground">
              {daysUntilService !== null ? (
                daysUntilService < 0 ? (
                  <span className="text-rose-600 font-extrabold">{Math.abs(daysUntilService)}d Overdue</span>
                ) : daysUntilService === 0 ? (
                  <span className="text-amber-600 font-extrabold">Due Today</span>
                ) : (
                  <span className="text-emerald-600">{daysUntilService} days</span>
                )
              ) : (
                "—"
              )}
            </div>
            <span className="text-[10px] text-muted-foreground block">
              Target due interval
            </span>
          </Card>

          {/* Maintenance Status */}
          <Card className="p-3 bg-card shadow-2xs">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
              Health Status
            </span>
            <div className="mt-1 font-bold text-sm">
              <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold border ${healthBadgeColor[healthStatus] || "bg-muted text-muted-foreground"}`}>
                {healthStatus}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground block truncate">
              Current vehicle state
            </span>
          </Card>

          {/* Total Records */}
          <Card className="p-3 bg-card shadow-2xs">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
              Total Records
            </span>
            <div className="mt-1 font-bold text-sm text-foreground">
              {records.length} {records.length === 1 ? "record" : "records"}
            </div>
            <span className="text-[10px] text-muted-foreground block">
              {completedRecords.length} completed
            </span>
          </Card>

          {/* Total Cost */}
          <Card className="p-3 bg-card shadow-2xs">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
              Total Cost
            </span>
            <div className="mt-1 font-bold text-sm text-foreground">
              {totalCost > 0 ? `₹${totalCost.toLocaleString()}` : "₹0"}
            </div>
            <span className="text-[10px] text-muted-foreground block truncate">
              Cumulative service spend
            </span>
          </Card>
        </div>
      </div>

      {/* ── 2. Visual Maintenance Timeline & History Table ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Timeline Column (1/3) */}
        <Card className="p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-border/70 pb-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm text-foreground">Service Timeline</span>
              </div>
              <span className="text-xs text-muted-foreground">
                Chronological
              </span>
            </div>

            {records.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                <Wrench className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                No maintenance timeline available
              </div>
            ) : (
              <div className="relative pl-6 pt-4 pb-2 space-y-6 before:absolute before:left-2.5 before:top-4 before:bottom-3 before:w-0.5 before:bg-border">
                {sortedRecords.slice(0, 5).map((rec, idx) => {
                  const isUpcoming = rec.status === "Upcoming" || rec.status === "Overdue";
                  return (
                    <div key={rec.id || idx} className="relative group">
                      {/* Node Dot */}
                      <span
                        className={`absolute -left-6 top-1 h-3.5 w-3.5 rounded-full border-2 border-card ${
                          rec.status === "Completed"
                            ? "bg-emerald-500"
                            : rec.status === "Overdue"
                            ? "bg-rose-500"
                            : "bg-amber-500"
                        }`}
                      />

                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold text-foreground">
                            {rec.due_date || "Date N/A"}
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                              rec.status === "Completed"
                                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                : rec.status === "Overdue"
                                ? "bg-rose-500/10 text-rose-600 border-rose-500/20"
                                : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                            }`}
                          >
                            {rec.status}
                          </span>
                        </div>

                        <div className="text-xs font-semibold text-foreground">
                          {rec.service}
                        </div>

                        {rec.cost > 0 && (
                          <div className="text-[11px] text-muted-foreground font-mono">
                            Cost: ₹{Number(rec.cost).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-border/50 text-[11px] text-muted-foreground">
            Showing recent 5 maintenance entries
          </div>
        </Card>

        {/* Maintenance History Table Column (2/3) */}
        <Card className="lg:col-span-2 overflow-hidden flex flex-col justify-between">
          <div>
            <div className="p-4 border-b border-border/70 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm text-foreground">All Maintenance History</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {records.length} records logged
              </span>
            </div>

            {records.length === 0 ? (
              <div className="py-16 text-center text-xs text-muted-foreground">
                <Wrench className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
                <div className="font-semibold text-foreground">No maintenance records</div>
                <p className="mt-1 text-muted-foreground">
                  No maintenance history has been recorded for this vehicle.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/40 border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3">Service Description</th>
                      <th className="py-2.5 px-3">Date / Due</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Cost (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {sortedRecords.map((r, i) => (
                      <tr key={r.id || i} className="hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-foreground">{r.service}</div>
                          {r.due_in && (
                            <div className="text-[11px] text-muted-foreground">Due in: {r.due_in}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap text-muted-foreground">
                          {r.due_date || "—"}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                              r.status === "Completed"
                                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                : r.status === "Overdue"
                                ? "bg-rose-500/10 text-rose-600 border-rose-500/20"
                                : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                            }`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono font-semibold text-foreground">
                          {r.cost > 0 ? `₹${Number(r.cost).toLocaleString()}` : "₹0"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="p-3 border-t border-border/50 text-[11px] text-muted-foreground bg-muted/20 flex justify-between items-center">
            <span>Official fleet maintenance log registry</span>
            <span className="font-mono font-semibold">Total: ₹{totalCost.toLocaleString()}</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
