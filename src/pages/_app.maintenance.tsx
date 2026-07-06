
import { MAINTENANCE, type MaintenanceRecord } from "@/lib/mock-data";
import { PageHeader } from "@/components/AppLayout";
import { Kpi, Card, Badge, Button } from "@/components/ui-kit";
import { Wrench, AlertCircle, CheckCircle2, Calendar } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { useState } from "react";

function Page() {
  const [records, setRecords] = useState(MAINTENANCE);
  const overdue = records.filter((r) => r.status === "Overdue").length;
  const upcoming = records.filter((r) => r.status === "Upcoming").length;
  const completed = records.filter((r) => r.status === "Completed").length;
  const totalCost = records.reduce((s, r) => s + r.cost, 0);

  function markCompleted(id: string) {
    setRecords((arr) => arr.map((r) => (r.id === id ? { ...r, status: "Completed" } : r)));
  }

  return (
    <div>
      <PageHeader title="Maintenance Management" subtitle="Service reminders, history and schedules" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Overdue" value={overdue} accent="destructive" icon={<AlertCircle className="h-5 w-5" />} />
        <Kpi label="Upcoming" value={upcoming} accent="warning" icon={<Calendar className="h-5 w-5" />} hint="Next 30 days" />
        <Kpi label="Completed" value={completed} accent="success" icon={<CheckCircle2 className="h-5 w-5" />} />
        <Kpi label="Estimated Cost" value={`₹${totalCost.toLocaleString()}`} icon={<Wrench className="h-5 w-5" />} />
      </div>

      <div className="mt-4">
        <DataTable<MaintenanceRecord>
          data={records}
          searchKeys={["vehicle", "service"]}
          columns={[
            { key: "vehicle", label: "Vehicle" },
            { key: "service", label: "Service" },
            { key: "dueIn", label: "Due In" },
            { key: "dueDate", label: "Due Date" },
            { key: "cost", label: "Est. Cost", render: (r) => `₹${r.cost.toLocaleString()}` },
            { key: "status", label: "Status", render: (r) => <Badge status={r.status}>{r.status}</Badge> },
            { key: "actions", label: "", render: (r) => (
              r.status !== "Completed" && (
                <Button size="sm" variant="outline" onClick={() => markCompleted(r.id)}>Mark complete</Button>
              )
            )},
          ]}
        />
      </div>
    </div>
  );
}

export default Page;
