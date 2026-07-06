import { Link, useSearchParams } from "react-router-dom";
import { useState, useMemo } from "react";
import { VEHICLES, type Vehicle, type VehicleStatus } from "@/lib/mock-data";
import { Badge } from "@/components/ui-kit";
import { PageHeader } from "@/components/AppLayout";
import { DataTable } from "@/components/DataTable";

function VehiclesPage() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const [filter, setFilter] = useState<VehicleStatus | "All">("All");

  const data = useMemo(() => {
    if (filter === "All") return VEHICLES;
    return VEHICLES.filter((v) => v.status === filter);
  }, [filter]);

  return (
    <div>
      <PageHeader title="Vehicles" subtitle={`${VEHICLES.length} vehicles in the fleet`} />

      <div className="flex flex-wrap gap-2 mb-3">
        {(["All", "Moving", "Idle", "Parked", "Offline"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 h-8 rounded-md text-sm border transition-colors ${
              filter === s ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-muted"
            }`}
          >
            {s} {s !== "All" && <span className="opacity-60 ml-1">({VEHICLES.filter((v) => v.status === s).length})</span>}
          </button>
        ))}
      </div>

      <DataTable<Vehicle>
        data={data}
        initialQuery={q}
        searchKeys={["number", "driver", "type", "location", "route"]}
        columns={[
          { key: "number", label: "Vehicle #", render: (v) => (
            <Link to={`/vehicles/${v.id}`} className="font-medium text-primary hover:underline">{v.number}</Link>
          )},
          { key: "type", label: "Type" },
          { key: "driver", label: "Driver" },
          { key: "status", label: "Status", render: (v) => <Badge status={v.status}>{v.status}</Badge> },
          { key: "location", label: "Location" },
          { key: "fuel", label: "Fuel %", render: (v) => (
            <div className="flex items-center gap-2 min-w-[100px]">
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className={`h-full ${v.fuel < 25 ? "bg-destructive" : v.fuel < 50 ? "bg-warning" : "bg-success"}`} style={{ width: `${v.fuel}%` }} />
              </div>
              <span className="text-xs font-medium w-10 text-right">{v.fuel}%</span>
            </div>
          )},
          { key: "temperature", label: "Temp", render: (v) => `${v.temperature}°C` },
          { key: "engineOn", label: "Engine", render: (v) => (
            <Badge status={v.engineOn ? "Moving" : "Parked"}>{v.engineOn ? "ON" : "OFF"}</Badge>
          )},
          { key: "lastUpdate", label: "Updated" },
        ]}
      />
    </div>
  );
}

export default VehiclesPage;
