import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { type AlertItem } from "@/lib/types";
import { PageHeader } from "@/components/AppLayout";
import { Card, Badge, Button } from "@/components/ui-kit";
import { DataTable } from "@/components/DataTable";
import { CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

function Page() {
  const [params, setParams] = useSearchParams();
  const typeParam = params.get("type");
  const initialType = (typeParam && ["Fuel", "Safety", "Temperature", "Vehicle", "Maintenance"].includes(typeParam)) ? typeParam : "All";

  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [type, setType] = useState<string>(initialType);

  useEffect(() => {
    const typeParam = params.get("type");
    const currentType = (typeParam && ["Fuel", "Safety", "Temperature", "Vehicle", "Maintenance"].includes(typeParam)) ? typeParam : "All";
    setType(currentType);
  }, [params]);
  const [severity, setSeverity] = useState<string>("All");
  const [resolved, setResolved] = useState<"All" | "Open" | "Resolved">("Open");

  async function loadAlerts() {
    const [aRes, vRes] = await Promise.all([
      supabase.from('alerts').select('*'),
      supabase.from('vehicles').select('*')
    ]);

    if (aRes.data) {
      setAlerts(aRes.data.map(a => {
        const vObj = vRes.data?.find(x => x.id === a.vehicle_id);
        return {
          id: a.id,
          type: a.type,
          severity: a.severity,
          vehicle: vObj ? vObj.number : 'Unknown',
          message: a.message,
          time: a.time ? new Date(a.time).toLocaleTimeString() : '1h ago',
          resolved: a.resolved
        };
      }));
    }
  }

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      if (cancelled) return;

      loadAlerts();

      channel = supabase
        .channel('alerts-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => { if (!cancelled) loadAlerts(); })
        .subscribe();
    }

    init();

    return () => {
      cancelled = true;
      channel?.unsubscribe();
    };
  }, []);

  async function resolve(id: string) {
    const { error } = await supabase
      .from('alerts')
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq('id', id);

    if (!error) {
      loadAlerts();
    }
  }

  const data = alerts.filter((a) => {
    if (type !== "All" && a.type !== type) return false;
    if (severity !== "All" && a.severity !== severity) return false;
    if (resolved === "Open" && a.resolved) return false;
    if (resolved === "Resolved" && !a.resolved) return false;
    return true;
  });

  return (
    <div>
      <PageHeader title="Alerts Center" subtitle={`${alerts.filter((a) => !a.resolved).length} open · ${alerts.length} total`} />

      <div className="flex flex-wrap gap-2 mb-3">
        {["All", "Fuel", "Safety", "Temperature", "Vehicle", "Maintenance"].map((t) => (
          <button key={t} onClick={() => {
            setType(t);
            if (t === "All") {
              params.delete("type");
            } else {
              params.set("type", t);
            }
            setParams(params);
          }}
            className={`px-3 h-8 rounded-md text-sm border ${type === t ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-muted"}`}>
            {t}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          {(["All", "Open", "Resolved"] as const).map((r) => (
            <button key={r} onClick={() => setResolved(r)}
              className={`px-3 h-8 rounded-md text-sm border ${resolved === r ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-muted"}`}>
              {r}
            </button>
          ))}
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}
                  className="h-8 px-3 rounded-md text-sm border border-border bg-card">
            <option>All</option><option>High</option><option>Medium</option><option>Low</option>
          </select>
        </div>
      </div>

      <DataTable<AlertItem>
        data={data}
        searchKeys={["vehicle", "message", "type"]}
        columns={[
          { key: "severity", label: "Severity", render: (a) => <Badge status={a.severity}>{a.severity}</Badge> },
          { key: "type", label: "Type" },
          { key: "vehicle", label: "Vehicle" },
          { key: "message", label: "Message" },
          { key: "time", label: "Time" },
          { key: "resolved", label: "Status", render: (a) => (
            <Badge status={a.resolved ? "Completed" : "High"}>{a.resolved ? "Resolved" : "Open"}</Badge>
          )},
          { key: "actions", label: "", render: (a) => (
            !a.resolved && (
              <Button size="sm" variant="outline" onClick={() => resolve(a.id)}>
                <CheckCircle2 className="h-3 w-3" /> Resolve
              </Button>
            )
          )},
        ]}
      />
    </div>
  );
}

export default Page;
