
import { COLLECTION_ROUTES, type CollectionRoute } from "@/lib/mock-data";
import { PageHeader } from "@/components/AppLayout";
import { Badge } from "@/components/ui-kit";
import { DataTable } from "@/components/DataTable";

function Page() {
  return (
    <div>
      <PageHeader title="Dairy Collection Routes" subtitle="Milk collection loops, centres and delivery points" />
      <DataTable<CollectionRoute>
        data={COLLECTION_ROUTES}
        searchKeys={["name", "vehicle", "driver"]}
        columns={[
          { key: "name", label: "Route" },
          { key: "vehicle", label: "Vehicle" },
          { key: "driver", label: "Driver" },
          { key: "centres", label: "Centres" },
          { key: "startTime", label: "Start" },
          { key: "endTime", label: "End" },
          { key: "litres", label: "Litres", render: (r) => `${r.litres.toLocaleString()} L` },
          { key: "completion", label: "Completion", render: (r) => (
            <div className="flex items-center gap-2 min-w-[120px]">
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className={`h-full ${r.completion === 100 ? "bg-success" : r.status === "Delayed" ? "bg-destructive" : "bg-info"}`} style={{ width: `${r.completion}%` }} />
              </div>
              <span className="text-xs font-medium w-10 text-right">{r.completion}%</span>
            </div>
          )},
          { key: "status", label: "Status", render: (r) => <Badge status={r.status}>{r.status}</Badge> },
        ]}
      />
    </div>
  );
}

export default Page;
