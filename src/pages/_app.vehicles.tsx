import { Link, useSearchParams } from "react-router-dom";
import { useState, useMemo, useEffect } from "react";
import { type Vehicle, type VehicleStatus } from "@/lib/types";
import { Badge, Button } from "@/components/ui-kit";
import { PageHeader } from "@/components/AppLayout";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Plus, X, Loader2 } from "lucide-react";

function VehiclesPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const [filter, setFilter] = useState<VehicleStatus | "All">("All");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ number: "", type: "Tanker", model: "", odometer: 0, engineHours: 0 });
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const canAdd = user?.role === "admin";

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

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled || !session) return;

      load();

      channel = supabase
        .channel('vehicles-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_telemetry' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_assignments' }, () => { if (!cancelled) load(); })
        .subscribe();
    }

    init();

    return () => {
      cancelled = true;
      channel?.unsubscribe();
    };
  }, []);

  const data = useMemo(() => {
    if (filter === "All") return vehicles;
    return vehicles.filter((v) => v.status === filter);
  }, [filter, vehicles]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError("");
    setLoading(true);

    const vehicleNumber = form.number.trim().toUpperCase();
    if (!vehicleNumber) {
      setSubmitError("Vehicle registration number is required.");
      setLoading(false);
      return;
    }

    // 1. Insert vehicle into public.vehicles
    const { data: newV, error: vError } = await supabase
      .from('vehicles')
      .insert({
        number: vehicleNumber,
        type: form.type,
        model: form.model.trim() || 'Unknown Model',
        odometer: Number(form.odometer) || 0,
        engine_hours: Number(form.engineHours) || 0.0,
      })
      .select()
      .maybeSingle();

    if (vError) {
      setSubmitError(vError.message || "Failed to create vehicle record.");
      setLoading(false);
      return;
    }

    if (newV) {
      // 2. Initialize default telemetry state
      const { error: tError } = await supabase
        .from('vehicle_telemetry')
        .insert({
          vehicle_id: newV.id,
          status: 'Offline',
          fuel: 100,
          speed: 0,
          temperature: 4.0,
          humidity: 60,
          engine_on: false,
          ignition: false,
        });

      if (tError) {
        console.error("Telemetry initialization warning:", tError.message);
      }
    }

    setLoading(false);
    setShowNew(false);
    setForm({ number: "", type: "Tanker", model: "", odometer: 0, engineHours: 0 });
    load();
  }

  return (
    <div>
      <PageHeader 
        title="Vehicles" 
        subtitle={`${vehicles.length} vehicles in the fleet`} 
        actions={
          canAdd && (
            <Button onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4" /> Add Vehicle
            </Button>
          )
        }
      />

      <div className="flex flex-wrap gap-2 mb-3">
        {(["All", "Moving", "Idle", "Parked", "Offline"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 h-8 rounded-md text-sm border transition-colors ${
              filter === s ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-muted"
            }`}
          >
            {s} {s !== "All" && <span className="opacity-60 ml-1">({vehicles.filter((v) => v.status === s).length})</span>}
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

      {showNew && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div className="bg-card rounded-lg shadow-xl max-w-md w-full p-5 border border-border" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="font-semibold text-lg">Add New Vehicle</h3>
              <button onClick={() => setShowNew(false)} className="p-1 hover:bg-muted rounded text-muted-foreground"><X className="h-4 w-4" /></button>
            </div>

            <form onSubmit={handleAdd} className="mt-4 space-y-4">
              {submitError && (
                <div className="bg-destructive/10 text-destructive text-xs p-2.5 rounded border border-destructive/20 font-medium">
                  {submitError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Vehicle Number (Registration) *</label>
                <input 
                  type="text" 
                  value={form.number} 
                  onChange={(e) => setForm({ ...form, number: e.target.value })} 
                  placeholder="e.g. TN-74-Z-1234"
                  className="h-9 px-3 w-full rounded-md border border-border bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Vehicle Type *</label>
                <select 
                  value={form.type} 
                  onChange={(e) => setForm({ ...form, type: e.target.value })} 
                  className="h-9 px-3 w-full rounded-md border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                >
                  <option value="Tanker">Tanker</option>
                  <option value="Truck">Truck</option>
                  <option value="Pick-up">Pick-up</option>
                  <option value="Delivery Van">Delivery Van</option>
                  <option value="Container">Container</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Vehicle Model</label>
                <input 
                  type="text" 
                  value={form.model} 
                  onChange={(e) => setForm({ ...form, model: e.target.value })} 
                  placeholder="e.g. Ashok Leyland Ecomet"
                  className="h-9 px-3 w-full rounded-md border border-border bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Initial Odometer (km)</label>
                  <input 
                    type="number" 
                    value={form.odometer} 
                    onChange={(e) => setForm({ ...form, odometer: Number(e.target.value) })} 
                    className="h-9 px-3 w-full rounded-md border border-border bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Engine Hours</label>
                  <input 
                    type="number" 
                    step="0.1"
                    value={form.engineHours} 
                    onChange={(e) => setForm({ ...form, engineHours: Number(e.target.value) })} 
                    className="h-9 px-3 w-full rounded-md border border-border bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-border flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowNew(false)} disabled={loading}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Creating…
                    </>
                  ) : (
                    "Create Vehicle"
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default VehiclesPage;
