
import { useState, useEffect } from "react";
import { type Vehicle, type VehicleStatus } from "@/lib/mock-data";
import { Card } from "@/components/ui-kit";
import { PageHeader } from "@/components/AppLayout";
import { VehicleMap } from "@/components/VehicleMap";
import { Search, MapPin } from "lucide-react";
import { supabase } from "@/lib/supabase";

function TrackingPage() {
  const [filter, setFilter] = useState<VehicleStatus | "All">("All");
  const [q, setQ] = useState("");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('v_vehicles').select('*');
      if (data) {
        setVehicles(data.map(v => ({
          id: v.id,
          number: v.number,
          type: v.type,
          model: v.model,
          route: v.route || '',
          insuranceExpiry: v.insurance_expiry || '',
          lastService: v.last_service || '',
          nextServiceKm: v.next_service_km || 0,
          odometer: v.odometer || 0,
          engineHours: Number(v.engine_hours || 0),
          status: v.status,
          location: v.location || '',
          lat: Number(v.lat || 0),
          lng: Number(v.lng || 0),
          speed: v.speed || 0,
          fuel: v.fuel || 0,
          temperature: Number(v.temperature || 0),
          humidity: v.humidity || 0,
          engineOn: v.engine_on || false,
          ignition: v.ignition || false,
          driver: v.driver_name || '',
          driverId: v.driver_id || '',
          lastUpdate: v.last_update ? new Date(v.last_update).toLocaleTimeString() : 'sec ago'
        })));
      }
    }
    load();
  }, []);

  const data = vehicles.filter((v) => {
    if (filter !== "All" && v.status !== filter) return false;
    if (q && !`${v.number} ${v.driver} ${v.location}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <PageHeader title="Live Vehicle Tracking" subtitle="Real-time positions across Kanyakumari district" />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 space-y-3">
          <Card>
            <div className="p-3">
              <VehicleMap vehicles={data} height={620} />
            </div>
          </Card>
        </div>

        <div className="space-y-3">
          <Card className="p-3">
            <div className="flex items-center gap-2 px-3 h-9 bg-muted rounded-md mb-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search vehicle, driver…"
                className="bg-transparent outline-none text-sm w-full" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["All", "Moving", "Idle", "Parked", "Offline"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`px-3 h-8 text-xs rounded-md border ${
                    filter === s ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-muted"
                  }`}
                >
                  {s} ({s === "All" ? vehicles.length : vehicles.filter((v) => v.status === s).length})
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <div className="px-3 py-2 border-b border-border text-sm font-medium">Vehicles ({data.length})</div>
            <div className="max-h-[480px] overflow-y-auto divide-y divide-border">
              {data.map((v) => (
                <div key={v.id} className="px-3 py-2.5 hover:bg-muted/40">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm">{v.number}</div>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      v.status === "Moving" ? "bg-success/10 text-success" :
                      v.status === "Idle" ? "bg-warning/15 text-warning-foreground" :
                      v.status === "Parked" ? "bg-muted text-muted-foreground" :
                      "bg-destructive/10 text-destructive"
                    }`}>{v.status}</span>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <MapPin className="h-3 w-3" /> {v.location} · {v.speed} km/h · {v.fuel}%
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default TrackingPage;
