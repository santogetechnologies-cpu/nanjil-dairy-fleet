import { 
  Gauge, 
  Activity, 
  Fuel, 
  Calendar, 
  TrendingUp, 
  Clock, 
  Info 
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui-kit";
import type { TimeRange, PerformanceTimeMetrics } from "../types";

interface VehiclePerformanceProps {
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  metrics: PerformanceTimeMetrics;
  dateRangeLabel: string;
}

export function VehiclePerformance({
  timeRange,
  onTimeRangeChange,
  metrics,
  dateRangeLabel,
}: VehiclePerformanceProps) {
  const timeRangeTabs: { id: TimeRange; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "7d", label: "Last 7 Days" },
    { id: "30d", label: "Last 30 Days" },
    { id: "90d", label: "Last 90 Days" },
    { id: "all", label: "All Time" },
  ];

  return (
    <Card className="overflow-hidden">
      {/* Header with Time Range Switcher */}
      <div className="p-5 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="font-semibold text-base text-foreground flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Performance Analytics & Driving Efficiency
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3 text-muted-foreground" />
              Period: <span className="font-semibold text-foreground">{dateRangeLabel}</span>
            </span>
          </div>
        </div>

        {/* Time Range Pills */}
        <div className="flex items-center gap-1 p-1 bg-muted/60 border border-border rounded-xl self-start md:self-auto overflow-x-auto max-w-full">
          {timeRangeTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTimeRangeChange(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                timeRange === tab.id
                  ? "bg-card text-foreground shadow-xs border border-border/80"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Big Key Performance Metrics Grid */}
      <div className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 1. Top Speed */}
          <div className="p-5 rounded-xl border border-border bg-gradient-to-br from-card to-muted/20 relative overflow-hidden shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Top Speed
              </span>
              <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Gauge className="h-4 w-4" />
              </div>
            </div>

            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-foreground tracking-tight">
                {metrics.topSpeed > 0 ? Math.round(metrics.topSpeed) : "—"}
              </span>
              <span className="text-sm font-semibold text-muted-foreground">km/h</span>
            </div>

            <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" />
              Peak recorded velocity within selected timeframe
            </p>
          </div>

          {/* 2. Average Speed */}
          <div className="p-5 rounded-xl border border-border bg-gradient-to-br from-card to-muted/20 relative overflow-hidden shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Average Speed
              </span>
              <div className="h-8 w-8 rounded-lg bg-sky-500/10 text-sky-600 flex items-center justify-center">
                <Activity className="h-4 w-4" />
              </div>
            </div>

            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-foreground tracking-tight">
                {metrics.avgSpeed != null && metrics.avgSpeed > 0 ? metrics.avgSpeed.toFixed(1) : "—"}
              </span>
              <span className="text-sm font-semibold text-muted-foreground">km/h</span>
            </div>

            <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Driving duration average (stationary periods excluded)
            </p>
          </div>

          {/* 3. Average Mileage */}
          <div className="p-5 rounded-xl border border-border bg-gradient-to-br from-card to-muted/20 relative overflow-hidden shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Average Mileage
              </span>
              <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                <Fuel className="h-4 w-4" />
              </div>
            </div>

            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-foreground tracking-tight">
                {metrics.averageMileageKmpl != null 
                  ? metrics.averageMileageKmpl.toFixed(1) 
                  : "—"}
              </span>
              <span className="text-sm font-semibold text-muted-foreground">km/L</span>
            </div>

            <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
              <Fuel className="h-3 w-3" />
              {metrics.averageMileageKmpl != null 
                ? "Computed using full-tank refill audit intervals" 
                : "Insufficient full-tank refill logs in period"}
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
