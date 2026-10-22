import { 
  User, 
  Phone, 
  Award, 
  ShieldCheck, 
  Route, 
  CheckCircle2, 
  Clock, 
  Calendar 
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui-kit";
import type { Driver, Trip } from "@/lib/types";

interface VehicleDriverInfoProps {
  driver: Driver | null;
  recentTrips: Trip[];
  canViewPhone?: boolean;
}

export function VehicleDriverInfo({
  driver,
  recentTrips,
  canViewPhone = true,
}: VehicleDriverInfoProps) {
  return (
    <Card className="overflow-hidden flex flex-col justify-between">
      <div>
        <div className="p-4 border-b border-border/70 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-sky-500/10 text-sky-600 flex items-center justify-center">
              <User className="h-4 w-4" />
            </div>
            <div>
              <span className="font-semibold text-sm text-foreground block">Assigned Driver & Duty Roster</span>
              <span className="text-[11px] text-muted-foreground">Active operator profile and recent dispatches</span>
            </div>
          </div>

          {driver && (
            <span className="text-xs font-semibold text-sky-600 bg-sky-500/10 px-2 py-0.5 rounded-full border border-sky-500/20">
              {driver.rating || "Driver Assigned"}
            </span>
          )}
        </div>

        <div className="p-4">
          {!driver ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              <User className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <div className="font-semibold text-foreground">No Driver Currently Assigned</div>
              <p className="mt-0.5 text-muted-foreground">This vehicle is currently unassigned in the fleet roster.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Profile Card */}
              <div className="p-3.5 rounded-xl border border-border bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 text-primary font-bold text-sm flex items-center justify-center border border-primary/20 shrink-0">
                    {driver.name ? driver.name.slice(0, 2).toUpperCase() : "DR"}
                  </div>
                  <div>
                    <div className="font-bold text-sm text-foreground">{driver.name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
                      {driver.license && <span>Licence: {driver.license}</span>}
                      {canViewPhone && driver.phone && (
                        <span className="flex items-center gap-1 font-mono text-[11px]">
                          <Phone className="h-3 w-3 text-muted-foreground" />
                          {driver.phone}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-auto">
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">Safety Score</span>
                    <span className="font-extrabold text-sm text-emerald-600 dark:text-emerald-400">
                      {driver.score || 95}%
                    </span>
                  </div>
                  <div className="text-right border-l border-border pl-3">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">Total Trips</span>
                    <span className="font-bold text-sm text-foreground">
                      {driver.trips || recentTrips.length}
                    </span>
                  </div>
                </div>
              </div>

              {/* Recent Trips Section */}
              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
                  Recent Trips by this Driver
                </span>

                {recentTrips.length === 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    No recent trip dispatches recorded.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recentTrips.slice(0, 3).map((trip) => (
                      <div
                        key={trip.id}
                        className="p-2.5 rounded-lg border border-border/70 bg-card hover:bg-muted/30 transition-colors flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-foreground truncate flex items-center gap-1.5">
                            <Route className="h-3 w-3 text-primary shrink-0" />
                            {trip.start} → {trip.destination}
                          </div>
                          <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {trip.date}
                            </span>
                            {trip.distance > 0 && <span>{trip.distance} km</span>}
                          </div>
                        </div>

                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${
                            trip.status === "Completed"
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                              : "bg-sky-500/10 text-sky-600 border-sky-500/20"
                          }`}
                        >
                          {trip.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="p-3 border-t border-border/50 text-[11px] text-muted-foreground bg-muted/20 flex justify-between">
        <span>Integrated driver roster</span>
        <span>{recentTrips.length} trips on record</span>
      </div>
    </Card>
  );
}
