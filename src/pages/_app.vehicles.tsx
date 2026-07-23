import { Link, useSearchParams } from "react-router-dom";
import { useState, useMemo, useEffect } from "react";
import { type Vehicle, type VehicleStatus } from "@/lib/types";
import { Badge, Button } from "@/components/ui-kit";
import { PageHeader } from "@/components/AppLayout";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Plus, X, Loader2, Trash2, AlertTriangle, Pencil } from "lucide-react";

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

  // Edit vehicle states
  const [editTarget, setEditTarget] = useState<Vehicle | null>(null);
  const [editForm, setEditForm] = useState({
    id: "",
    number: "",
    type: "Tanker",
    model: "",
    route: "",
    insuranceExpiry: "",
    odometer: 0,
    engineHours: 0
  });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");

  // Delete vehicle states
  const [deleteTarget, setDeleteTarget] = useState<Vehicle | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const canAdd = user?.role === "admin";

  async function load() {
    const { data } = await supabase.from('v_vehicles').select('*');
    if (data && data.length > 0) {
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
    } else {
      setVehicles([
        { id: 'v1', number: 'TN-74-V-1001', type: 'Tanker 10KL', model: 'Ashok Leyland', route: 'Nagercoil - Kanyakumari', insuranceExpiry: '2027-01-15', lastService: '2026-06-10', nextServiceKm: 15000, odometer: 42350, engineHours: 1240, status: 'Moving', location: 'Nagercoil Route', lat: 8.1833, lng: 77.4119, speed: 45, fuel: 82, temperature: 4.2, humidity: 85, engineOn: true, ignition: true, driver: 'Muthu Kumar', driverId: 'd1', lastUpdate: 'Just now' },
        { id: 'v2', number: 'TN-74-V-1002', type: 'Chilled Van', model: 'Tata 407', route: 'Marthandam Milk Collection', insuranceExpiry: '2026-11-20', lastService: '2026-05-18', nextServiceKm: 12000, odometer: 68120, engineHours: 2150, status: 'Moving', location: 'Marthandam Sector 4', lat: 8.3000, lng: 77.2000, speed: 38, fuel: 65, temperature: 3.8, humidity: 82, engineOn: true, ignition: true, driver: 'Selvan P', driverId: 'd2', lastUpdate: 'Just now' },
        { id: 'v3', number: 'TN-74-V-1003', type: 'Refrigerated Truck', model: 'BharatBenz 1217', route: 'Thuckalay Dairy Line', insuranceExpiry: '2027-03-05', lastService: '2026-06-25', nextServiceKm: 20000, odometer: 31400, engineHours: 980, status: 'Idle', location: 'Thuckalay Chilling Centre', lat: 8.2500, lng: 77.3333, speed: 0, fuel: 90, temperature: 5.1, humidity: 88, engineOn: true, ignition: false, driver: 'Rajan S', driverId: 'd3', lastUpdate: '2 mins ago' },
        { id: 'v4', number: 'TN-74-V-1004', type: 'Tanker 15KL', model: 'Eicher Pro 3015', route: 'Valliyur Inter-district Route', insuranceExpiry: '2026-09-30', lastService: '2026-04-12', nextServiceKm: 18000, odometer: 89500, engineHours: 3410, status: 'Parked', location: 'Valliyur Depot Base', lat: 8.3833, lng: 77.6167, speed: 0, fuel: 50, temperature: 18.5, humidity: 60, engineOn: false, ignition: false, driver: 'Karthik M', driverId: 'd4', lastUpdate: '10 mins ago' },
        { id: 'v5', number: 'TN-74-V-1005', type: 'Delivery Van', model: 'Mahindra Bolero', route: 'Colachel Local Distribution', insuranceExpiry: '2026-12-10', lastService: '2026-07-01', nextServiceKm: 10000, odometer: 24100, engineHours: 720, status: 'Offline', location: 'Colachel Branch Garage', lat: 8.1764, lng: 77.2611, speed: 0, fuel: 30, temperature: 22.0, humidity: 70, engineOn: false, ignition: false, driver: 'Arun V', driverId: 'd5', lastUpdate: '1 hr ago' },
      ]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      if (cancelled) return;

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

    try {
      const { data: inserted, error: insertError } = await supabase
        .from('vehicles')
        .insert({
          number: vehicleNumber,
          type: form.type,
          model: form.model.trim() || "Unknown Model",
          odometer: Number(form.odometer) || 0,
          engine_hours: Number(form.engineHours) || 0
        })
        .select()
        .single();

      if (insertError) {
        if (insertError.code === '23505') {
          throw new Error(`Vehicle number "${vehicleNumber}" already exists.`);
        }
        throw insertError;
      }

      if (inserted) {
        await supabase.from('vehicle_telemetry').insert({
          vehicle_id: inserted.id,
          status: 'Parked',
          speed: 0,
          fuel: 100,
          temperature: 4.0,
          humidity: 85,
          engine_on: false,
          ignition: false,
          location: 'Main Yard, Nanjil Dairy, Nagercoil'
        });
      }

      setShowNew(false);
      setForm({ number: "", type: "Tanker", model: "", odometer: 0, engineHours: 0 });
      load();
    } catch (err: any) {
      setSubmitError(err.message || "Failed to add vehicle.");
    } finally {
      setLoading(false);
    }
  }

  function openEditModal(v: Vehicle) {
    setEditTarget(v);
    setEditForm({
      id: v.id,
      number: v.number,
      type: v.type || "Tanker",
      model: v.model || "",
      route: v.route || "",
      insuranceExpiry: v.insuranceExpiry || "",
      odometer: v.odometer || 0,
      engineHours: v.engineHours || 0
    });
    setEditError("");
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;

    const vehicleNumber = editForm.number.trim().toUpperCase();
    if (!vehicleNumber) {
      setEditError("Vehicle registration number is required.");
      return;
    }

    setEditLoading(true);
    setEditError("");

    try {
      const { error } = await supabase
        .from('vehicles')
        .update({
          number: vehicleNumber,
          type: editForm.type,
          model: editForm.model.trim() || "Unknown Model",
          route: editForm.route.trim() || null,
          insurance_expiry: editForm.insuranceExpiry || null,
          odometer: Number(editForm.odometer) || 0,
          engine_hours: Number(editForm.engineHours) || 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', editTarget.id);

      if (error) throw error;

      setEditTarget(null);
      load();
    } catch (err: any) {
      setEditError(err.message || "Failed to update vehicle.");
    } finally {
      setEditLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");

    try {
      const { error } = await supabase
        .from('vehicles')
        .delete()
        .eq('id', deleteTarget.id);

      if (error) throw error;

      setDeleteTarget(null);
      load();
    } catch (err: any) {
      setDeleteError(err.message || "Failed to delete vehicle.");
    } finally {
      setDeleting(false);
    }
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
          ...(canAdd ? [{
            key: "actions",
            label: "Actions",
            render: (v: Vehicle) => (
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); openEditModal(v); }}
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-primary transition-colors"
                  title="Edit vehicle"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(v); setDeleteError(""); }}
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  title="Delete vehicle"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          }] : []),
        ]}
      />

      {/* Add New Vehicle Modal */}
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
                  className="h-9 px-3 w-full rounded-md border border-border bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-primary uppercase"
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

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Initial Odometer (km)</label>
                <input 
                  type="number" 
                  value={form.odometer} 
                  onChange={(e) => setForm({ ...form, odometer: Number(e.target.value) })} 
                  className="h-9 px-3 w-full rounded-md border border-border bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
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

      {/* Edit Vehicle Modal */}
      {editTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => !editLoading && setEditTarget(null)}>
          <div className="bg-card rounded-lg shadow-xl max-w-md w-full p-5 border border-border" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2 font-semibold text-lg">
                <Pencil className="h-5 w-5 text-primary" />
                Edit Vehicle Details
              </div>
              <button onClick={() => setEditTarget(null)} disabled={editLoading} className="p-1 hover:bg-muted rounded text-muted-foreground"><X className="h-4 w-4" /></button>
            </div>

            <form onSubmit={handleEditSubmit} className="mt-4 space-y-4">
              {editError && (
                <div className="bg-destructive/10 text-destructive text-xs p-2.5 rounded border border-destructive/20 font-medium">
                  {editError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Vehicle Number (Registration) *</label>
                <input 
                  type="text" 
                  value={editForm.number} 
                  onChange={(e) => setEditForm({ ...editForm, number: e.target.value })} 
                  placeholder="e.g. TN-74-Z-1234"
                  className="h-9 px-3 w-full rounded-md border border-border bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-primary uppercase"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Vehicle Type *</label>
                <select 
                  value={editForm.type} 
                  onChange={(e) => setEditForm({ ...editForm, type: e.target.value })} 
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
                  value={editForm.model} 
                  onChange={(e) => setEditForm({ ...editForm, model: e.target.value })} 
                  placeholder="e.g. Ashok Leyland Ecomet"
                  className="h-9 px-3 w-full rounded-md border border-border bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Assigned Route</label>
                <input 
                  type="text" 
                  value={editForm.route} 
                  onChange={(e) => setEditForm({ ...editForm, route: e.target.value })} 
                  placeholder="e.g. Route A (Nagercoil - Thuckalay)"
                  className="h-9 px-3 w-full rounded-md border border-border bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Odometer (km)</label>
                <input 
                  type="number" 
                  value={editForm.odometer} 
                  onChange={(e) => setEditForm({ ...editForm, odometer: Number(e.target.value) })} 
                  className="h-9 px-3 w-full rounded-md border border-border bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="pt-3 border-t border-border flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditTarget(null)} disabled={editLoading}>
                  Cancel
                </Button>
                <Button type="submit" disabled={editLoading}>
                  {editLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Updating…
                    </>
                  ) : (
                    "Update Vehicle"
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => { if (!deleting) { setDeleteTarget(null); setDeleteError(""); } }}>
          <div className="bg-card rounded-lg shadow-2xl max-w-sm w-full p-6 border border-border" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h3 className="font-semibold text-base">Delete Vehicle</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Are you sure you want to permanently delete{" "}
                  <span className="font-semibold text-foreground">{deleteTarget.number}</span>?
                  This will remove all telemetry data and cannot be undone.
                </p>
              </div>
            </div>

            {deleteError && (
              <div className="bg-destructive/10 text-destructive text-xs p-2.5 rounded border border-destructive/20 font-medium mb-4">
                {deleteError}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setDeleteTarget(null); setDeleteError(""); }}
                disabled={deleting}
              >
                Cancel
              </Button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-destructive text-white text-sm font-medium hover:bg-destructive/90 disabled:opacity-50 transition-colors"
              >
                {deleting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</>
                ) : (
                  <><Trash2 className="h-4 w-4" /> Delete Vehicle</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default VehiclesPage;
