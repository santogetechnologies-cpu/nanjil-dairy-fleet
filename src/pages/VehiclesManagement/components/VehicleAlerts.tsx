import { 
  Bell, 
  AlertTriangle, 
  CheckCircle2, 
  Fuel, 
  Thermometer, 
  Wrench, 
  ShieldAlert, 
  Clock 
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui-kit";
import type { AlertItem } from "@/lib/types";

interface VehicleAlertsProps {
  alerts: AlertItem[];
  onResolve?: (id: string) => void;
  canManage?: boolean;
}

export function VehicleAlerts({ alerts, onResolve, canManage = false }: VehicleAlertsProps) {
  const typeIconMap: Record<string, any> = {
    Fuel: Fuel,
    Safety: ShieldAlert,
    Temperature: Thermometer,
    Vehicle: AlertTriangle,
    Maintenance: Wrench,
  };

  const severityColorMap: Record<string, string> = {
    High: "bg-rose-500/10 text-rose-600 border-rose-500/20",
    Medium: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    Low: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  };

  const openAlerts = alerts.filter((a) => !a.resolved);

  return (
    <Card className="overflow-hidden flex flex-col justify-between">
      <div>
        <div className="p-4 border-b border-border/70 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-rose-500/10 text-rose-600 flex items-center justify-center">
              <Bell className="h-4 w-4" />
            </div>
            <div>
              <span className="font-semibold text-sm text-foreground block">Vehicle System Alerts</span>
              <span className="text-[11px] text-muted-foreground">Safety, temperature, and maintenance triggers</span>
            </div>
          </div>

          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
            openAlerts.length > 0 
              ? "bg-rose-500/10 text-rose-600 border-rose-500/20" 
              : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
          }`}>
            {openAlerts.length} Unresolved
          </span>
        </div>

        {alerts.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-emerald-500/40 mx-auto mb-2" />
            <div className="font-semibold text-foreground">All Clear</div>
            <p className="mt-0.5 text-muted-foreground">No recent alerts recorded for this vehicle.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/60 max-h-[360px] overflow-y-auto">
            {alerts.map((a) => {
              const Icon = typeIconMap[a.type] || Bell;
              return (
                <div key={a.id} className="p-3.5 hover:bg-muted/20 transition-colors flex items-start gap-3">
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 border ${
                    a.severity === "High"
                      ? "bg-rose-500/10 text-rose-600 border-rose-500/20"
                      : a.severity === "Medium"
                      ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                      : "bg-sky-500/10 text-sky-600 border-sky-500/20"
                  }`}>
                    <Icon className="h-4 w-4" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-xs text-foreground">{a.type}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${severityColorMap[a.severity] || "bg-muted text-muted-foreground"}`}>
                          {a.severity}
                        </span>
                        {a.resolved && (
                          <span className="text-[10px] font-medium text-emerald-600 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">
                            Resolved
                          </span>
                        )}
                      </div>

                      <span className="text-[11px] text-muted-foreground shrink-0 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {a.time}
                      </span>
                    </div>

                    <p className="text-xs text-foreground/90 mt-1 leading-snug">
                      {a.message}
                    </p>

                    {!a.resolved && onResolve && canManage && (
                      <button
                        onClick={() => onResolve(a.id)}
                        className="mt-2 text-[11px] text-primary hover:underline font-semibold"
                      >
                        Mark as resolved
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-border/50 text-[11px] text-muted-foreground bg-muted/20 flex justify-between">
        <span>Connected to centralized Alert Center</span>
        <span>{alerts.length} total history</span>
      </div>
    </Card>
  );
}
