
import { useState, useEffect } from "react";
import { COLLECTION_ROUTES, type CollectionRoute } from "@/lib/mock-data";
import { PageHeader } from "@/components/AppLayout";
import { Badge } from "@/components/ui-kit";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/lib/supabase";

function Page() {
  const [routes, setRoutes] = useState<CollectionRoute[]>([]);

  useEffect(() => {
    async function load() {
      const [rRes, vRes] = await Promise.all([
        supabase.from('collection_routes').select('*'),
        supabase.from('vehicles').select('*')
      ]);

      if (rRes.data) {
        setRoutes(rRes.data.map(r => {
          const vObj = vRes.data?.find(x => x.id === r.vehicle_id);
          return {
            id: r.id,
            name: r.name,
            vehicle: vObj ? vObj.number : 'Unknown',
            driver: 'Assigned Driver', // can be fetched or resolved
            centres: r.centres,
            startTime: r.start_time || '',
            endTime: r.end_time || '',
            status: r.status,
            litres: r.litres,
            completion: r.completion
          };
        }));
      }
    }
    load();
  }, []);

  return (
    <div>
      <PageHeader title="Dairy Collection Routes" subtitle="Milk collection loops, centres and delivery points" />
      <DataTable<CollectionRoute>
        data={routes.length > 0 ? routes : COLLECTION_ROUTES}
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
