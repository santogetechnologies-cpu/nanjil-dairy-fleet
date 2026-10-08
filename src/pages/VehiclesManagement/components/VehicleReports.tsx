import { 
  Route, 
  CheckCircle2, 
  Clock, 
  MapPin, 
  Gauge, 
  AlertTriangle, 
  Fuel, 
  IndianRupee, 
  Wrench, 
  Bell, 
  Activity, 
  TrendingUp 
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui-kit";
import type { PerformanceTimeMetrics } from "../types";

interface VehicleReportsProps {
  metrics: PerformanceTimeMetrics;
  dateRangeLabel: string;
}

export function VehicleReports({ metrics, dateRangeLabel }: VehicleReportsProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-base text-foreground tracking-tight">
            Operational & Fleet Analytics Reports
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Aggregated operational metrics for period: {dateRangeLabel}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Trip Report */}
        <Card className="p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-border/70 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-sky-500/10 text-sky-600 flex items-center justify-center">
                  <Route className="h-4 w-4" />
                </div>
                <span className="font-semibold text-sm text-foreground">Trip Report</span>
              </div>
              <span className="text-xs font-bold text-sky-600 bg-sky-500/10 px-2 py-0.5 rounded-full border border-sky-500/20">
                {metrics.totalTrips} Trips
              </span>
            </div>

            <div className="mt-3.5 space-y-2.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Completed Trips</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {metrics.completedTrips}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Delayed / In Progress</span>
                <span className="font-semibold text-foreground">
                  {metrics.delayedTrips}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Total Distance Run</span>
                <span className="font-bold text-foreground">
                  {metrics.totalDistanceKm > 0 ? `${metrics.totalDistanceKm.toLocaleString()} km` : "—"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Avg Trip Distance</span>
                <span className="font-semibold text-foreground">
                  {metrics.avgTripDistanceKm > 0 ? `${metrics.avgTripDistanceKm.toFixed(1)} km` : "—"}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border/50 text-[11px] text-muted-foreground">
            Logs from milk route dispatches
          </div>
        </Card>

        {/* 2. Speed Report */}
        <Card className="p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-border/70 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <Gauge className="h-4 w-4" />
                </div>
                <span className="font-semibold text-sm text-foreground">Speed Report</span>
              </div>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                metrics.overspeedEventsCount > 0 
                  ? "bg-rose-500/10 text-rose-600 border-rose-500/20" 
                  : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
              }`}>
                {metrics.overspeedEventsCount} Overspeed
              </span>
            </div>

            <div className="mt-3.5 space-y-2.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Maximum Velocity</span>
                <span className="font-bold text-foreground">
                  {metrics.topSpeed > 0 ? `${Math.round(metrics.topSpeed)} km/h` : "—"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Driving Avg Speed</span>
                <span className="font-semibold text-foreground">
                  {metrics.avgSpeed != null && metrics.avgSpeed > 0 ? `${metrics.avgSpeed.toFixed(1)} km/h` : "—"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Speed Limit Threshold</span>
                <span className="font-semibold text-muted-foreground">
                  80 km/h (Fleet Policy)
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Overspeed Events</span>
                <span className={`font-bold ${metrics.overspeedEventsCount > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {metrics.overspeedEventsCount} events
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border/50 text-[11px] text-muted-foreground">
            Calculated from IoT telemetry stream
          </div>
        </Card>

        {/* 3. Fuel Report */}
        <Card className="p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-border/70 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                  <Fuel className="h-4 w-4" />
                </div>
                <span className="font-semibold text-sm text-foreground">Fuel Report</span>
              </div>
              <span className="text-xs font-bold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                {metrics.fuelRefillCount} Refills
              </span>
            </div>

            <div className="mt-3.5 space-y-2.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Fuel Volume Purchased</span>
                <span className="font-bold text-foreground">
                  {metrics.fuelConsumedLiters > 0 ? `${Math.round(metrics.fuelConsumedLiters)} L` : "—"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Certified Mileage</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  {metrics.averageMileageKmpl != null ? `${metrics.averageMileageKmpl.toFixed(1)} km/L` : "—"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Total Refill Expense</span>
                <span className="font-bold text-foreground">
                  {metrics.totalFuelCost > 0 ? `₹${metrics.totalFuelCost.toLocaleString()}` : "—"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Cost per km</span>
                <span className="font-semibold text-foreground">
                  {metrics.totalDistanceKm > 0 && metrics.totalFuelCost > 0
                    ? `₹${(metrics.totalFuelCost / metrics.totalDistanceKm).toFixed(2)}/km`
                    : "—"}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border/50 text-[11px] text-muted-foreground">
            Strict full-tank calculation engine
          </div>
        </Card>

        {/* 4. Operational & Health Report */}
        <Card className="p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-border/70 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center">
                  <Activity className="h-4 w-4" />
                </div>
                <span className="font-semibold text-sm text-foreground">Operations</span>
              </div>
              <span className="text-xs font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-full border border-border">
                {metrics.alertsCount} Incidents
              </span>
            </div>

            <div className="mt-3.5 space-y-2.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Driving Hours in Period</span>
                <span className="font-bold text-foreground">
                  {metrics.totalDrivingHours > 0 ? `${metrics.totalDrivingHours.toFixed(1)} hrs` : "—"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">System Alerts Raised</span>
                <span className={`font-semibold ${metrics.alertsCount > 0 ? "text-amber-600" : "text-foreground"}`}>
                  {metrics.alertsCount} alerts
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Maintenance Services</span>
                <span className="font-semibold text-foreground">
                  {metrics.maintenanceRecordsCount} records
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Fleet Operational Status</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  Active in Roster
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border/50 text-[11px] text-muted-foreground">
            Consolidated operational overview
          </div>
        </Card>
      </div>
    </div>
  );
}
