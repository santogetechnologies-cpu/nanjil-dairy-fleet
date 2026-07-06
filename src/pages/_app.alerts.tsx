
import { useState } from "react";
import { ALERTS, type AlertItem } from "@/lib/mock-data";
import { PageHeader } from "@/components/AppLayout";
import { Card, Badge, Button } from "@/components/ui-kit";
import { DataTable } from "@/components/DataTable";
import { CheckCircle2 } from "lucide-react";

function Page() {
  const [alerts, setAlerts] = useState<AlertItem[]>(ALERTS);
  const [type, setType] = useState<string>("All");
  const [severity, setSeverity] = useState<string>("All");
  const [resolved, setResolved] = useState<"All" | "Open" | "Resolved">("Open");

  function resolve(id: string) {
    setAlerts((arr) => arr.map((a) => (a.id === id ? { ...a, resolved: true } : a)));
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
          <button key={t} onClick={() => setType(t)}
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
