import { Shield, ShieldAlert, ShieldCheck, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { Card, CardHeader } from "@/components/ui-kit";
import type { HealthScoreResult } from "../types";

interface VehicleHealthScoreProps {
  health: HealthScoreResult;
}

export function VehicleHealthScore({ health }: VehicleHealthScoreProps) {
  const isInsufficient = health.score === null;

  // Rating color map
  const ratingColorMap: Record<string, { badge: string; text: string; bg: string; ring: string }> = {
    Excellent: { badge: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500", ring: "ring-emerald-500/20" },
    Good: { badge: "bg-sky-500/10 text-sky-600 border-sky-500/20", text: "text-sky-600 dark:text-sky-400", bg: "bg-sky-500", ring: "ring-sky-500/20" },
    Fair: { badge: "bg-amber-500/10 text-amber-600 border-amber-500/20", text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500", ring: "ring-amber-500/20" },
    "Needs Attention": { badge: "bg-rose-500/10 text-rose-600 border-rose-500/20", text: "text-rose-600 dark:text-rose-400", bg: "bg-rose-500", ring: "ring-rose-500/20" },
    "Data Insufficient": { badge: "bg-muted text-muted-foreground border-border", text: "text-muted-foreground", bg: "bg-muted-foreground", ring: "ring-muted" }
  };

  const currentTheme = ratingColorMap[health.label] || ratingColorMap["Good"];

  return (
    <Card className="p-5 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between border-b border-border/70 pb-3">
          <div className="flex items-center gap-2">
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
              isInsufficient ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
            }`}>
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <span className="font-semibold text-sm text-foreground block">Vehicle Operational Health</span>
              <span className="text-[11px] text-muted-foreground">Composite engineering index</span>
            </div>
          </div>

          <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${currentTheme.badge}`}>
            {health.label}
          </span>
        </div>

        {/* Score Display */}
        <div className="mt-4 flex items-center gap-4">
          <div className="relative flex items-center justify-center">
            {isInsufficient ? (
              <div className="h-20 w-20 rounded-full border-4 border-dashed border-muted-foreground/30 flex items-center justify-center text-center p-2">
                <span className="text-[10px] font-semibold text-muted-foreground leading-tight">
                  No Data
                </span>
              </div>
            ) : (
              <div className={`h-20 w-20 rounded-full border-4 flex flex-col items-center justify-center shadow-xs ${
                health.score! >= 85 
                  ? "border-emerald-500 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400" 
                  : health.score! >= 70
                  ? "border-amber-500 bg-amber-500/5 text-amber-600"
                  : "border-rose-500 bg-rose-500/5 text-rose-600"
              }`}>
                <span className="text-2xl font-black tracking-tight">{health.score}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider -mt-0.5">/ 100</span>
              </div>
            )}
          </div>

          <div className="flex-1 space-y-1">
            <div className="font-bold text-base text-foreground">
              {isInsufficient ? "Data Insufficient" : `${health.label} Operational Condition`}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {isInsufficient 
                ? "Insufficient telemetry, alert, or maintenance history records exist to compute an audit-grade health score." 
                : `Computed dynamically across service schedule compliance, open incident alerts, overspeed events, and certified fuel mileage.`}
            </p>
          </div>
        </div>

        {/* Deductions Breakdown */}
        {health.deductions.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border/60 space-y-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
              Active Health Factors & Penalties
            </span>
            {health.deductions.map((d, i) => (
              <div key={i} className="flex items-center justify-between text-xs py-0.5">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                  {d.reason}
                </span>
                <span className="font-mono text-rose-600 font-semibold text-[11px]">
                  -{d.points} pts
                </span>
              </div>
            ))}
          </div>
        )}

        {!isInsufficient && health.deductions.length === 0 && (
          <div className="mt-4 pt-3 border-t border-border/60 flex items-center gap-2 text-xs text-emerald-600 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            No open alerts, overspeed violations, or overdue service intervals detected.
          </div>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-border/50 text-[11px] text-muted-foreground flex items-center justify-between">
        <span>Deterministic calculation formula</span>
        <span className="font-medium text-foreground">{isInsufficient ? "Status: N/A" : `Score: ${health.score}%`}</span>
      </div>
    </Card>
  );
}
