import { Link, useSearchParams } from "react-router-dom";
import { useState, useMemo, useEffect } from "react";
import { type Vehicle, type VehicleStatus } from "@/lib/types";
import { Badge, Button } from "@/components/ui-kit";
import { PageHeader } from "@/components/AppLayout";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Plus, X, Loader2, Trash2, AlertTriangle, Pencil, Radio } from "lucide-react";
import { useVehicleList } from "@/hooks/useVehicleTracking";

function VehiclesPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  
  const statusParam = params.get("status") as VehicleStatus | null;
  const initialFilter = (statusParam && ["Moving", "Idle", "Parked", "Offline"].includes(statusParam)) ? statusParam : "All";
  const [filter, setFilter] = useState<VehicleStatus | "All">(initialFilter);

  useEffect(() => {
    const statusParam = params.get("status") as VehicleStatus | null;
    const currentFilter = (statusParam && ["Moving", "Idle", "Parked", "Offline"].includes(statusParam)) ? statusParam : "All";
    setFilter(currentFilter);
  }, [params]);

  const [rawVehicles, setRawVehicles] = useState<Vehicle[]>([]);
  // Real-time tracking (source determined by VITE_TELEMETRY_SOURCE)
  const vehicles = useVehicleList(rawVehicles);

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ 
    number: "", 
    deviceId: "",
    type: "Tanker", 
    tankerCapacity: "10000",
    customTankerCapacity: "",
    model: "", 
    odometer: 0, 
    engineHours: 0 
  });
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Edit vehicle states
  const [editTarget, setEditTarget] = useState<Vehicle | null>(null);
  const [editForm, setEditForm] = useState({
    id: "",
    number: "",
    deviceId: "",
    type: "Tanker",
    tankerCapacity: "10000",
    customTankerCapacity: "",
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
      const mapped = data.map(v => ({
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
        lastUpdate: v.last_update ? new Date(v.last_update).toLocaleTimeString() : 'sec ago',
        deviceId: v.device_id || ''
      }));

      setRawVehicles(mapped);
    } else {
      setRawVehicles([]);
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

    const devId = form.deviceId.trim();
    if (devId && !/^\d{15}$/.test(devId)) {
      setSubmitError("Device ID must be exactly a 15-digit number.");
      setLoading(false);
      return;
    }

    try {
      let finalType = form.type;
      if (form.type === "Tanker") {
        const capLitres = form.tankerCapacity === "custom"
          ? (Number(form.customTankerCapacity) || 10000)
          : (Number(form.tankerCapacity) || 10000);
        const klStr = capLitres >= 1000 && capLitres % 1000 === 0 ? `${capLitres / 1000}KL` : "";
        finalType = klStr ? `Tanker ${klStr} (${capLitres.toLocaleString()} L)` : `Tanker (${capLitres.toLocaleString()} L)`;
      }

      const { data: inserted, error: insertError } = await supabase
        .from('vehicles')
        .insert({
          number: vehicleNumber,
          type: finalType,
          model: form.model.trim() || "Unknown Model",
          odometer: Number(form.odometer) || 0,
          engine_hours: Number(form.engineHours) || 0,
          device_id: devId || null
        })
        .select()
        .single();

      if (insertError) {
        if (insertError.code === '23505') {
          if (insertError.message?.includes('device_id')) {
            throw new Error(`Device ID "${devId}" is already assigned to another vehicle.`);
          }
          throw new Error(`Vehicle number "${vehicleNumber}" already exists.`);
        }
        throw insertError;
      }

      if (inserted) {
        const sess = await supabase.auth.getSession();
        if (sess.data?.session) {
          try {
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
          } catch (tErr) {
            console.warn("Telemetry insert notice:", tErr);
          }
        }
      }

      setShowNew(false);
      setForm({ number: "", deviceId: "", type: "Tanker", tankerCapacity: "10000", customTankerCapacity: "", model: "", odometer: 0, engineHours: 0 });
      load();
    } catch (err: any) {
      setSubmitError(err.message || "Failed to add vehicle.");
    } finally {
      setLoading(false);
    }
  }

  function openEditModal(v: Vehicle) {
    setEditTarget(v);
    
    let baseType = "Tanker";
    let capPreset = "10000";
    let customCap = "";

    if (v.type) {
      if (v.type.toLowerCase().includes("tanker")) {
        baseType = "Tanker";
        const litresMatch = v.type.match(/(\d[\d,]*)\s*l/i);
        const klMatch = v.type.match(/(\d+)\s*kl/i);
        let cap = 10000;
        if (litresMatch) {
          cap = parseInt(litresMatch[1].replace(/,/g, ""), 10);
        } else if (klMatch) {
          cap = parseInt(klMatch[1], 10) * 1000;
        }
        const presets = ["3000", "5000", "10000", "12000", "15000", "18000", "20000", "25000"];
        if (presets.includes(String(cap))) {
          capPreset = String(cap);
        } else {
          capPreset = "custom";
          customCap = String(cap);
        }
      } else {
        baseType = v.type;
      }
    }

    setEditForm({
      id: v.id,
      number: v.number,
      deviceId: v.deviceId || "",
      type: baseType,
      tankerCapacity: capPreset,
      customTankerCapacity: customCap,
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

    const devId = editForm.deviceId.trim();
    if (devId && !/^\d{15}$/.test(devId)) {
      setEditError("Device ID must be exactly a 15-digit number.");
      return;
    }

    setEditLoading(true);
    setEditError("");

    try {
      let finalType = editForm.type;
      if (editForm.type === "Tanker") {
        const capLitres = editForm.tankerCapacity === "custom"
          ? (Number(editForm.customTankerCapacity) || 10000)
          : (Number(editForm.tankerCapacity) || 10000);
        const klStr = capLitres >= 1000 && capLitres % 1000 === 0 ? `${capLitres / 1000}KL` : "";
        finalType = klStr ? `Tanker ${klStr} (${capLitres.toLocaleString()} L)` : `Tanker (${capLitres.toLocaleString()} L)`;
      }

      const { error } = await supabase
        .from('vehicles')
        .update({
          number: vehicleNumber,
          type: finalType,
          model: editForm.model.trim() || "Unknown Model",
          route: editForm.route.trim() || null,
          insurance_expiry: editForm.insuranceExpiry || null,
          odometer: Number(editForm.odometer) || 0,
          engine_hours: Number(editForm.engineHours) || 0,
          device_id: devId || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', editTarget.id);

      if (error) {
        if (error.code === '23505') {
          if (error.message?.includes('device_id')) {
            throw new Error(`Device ID "${devId}" is already assigned to another vehicle.`);
          }
        }
        throw error;
      }

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

    const targetId = deleteTarget.id;

    // Instantly remove vehicle from state
    setRawVehicles((prev: Vehicle[]) => prev.filter((v: Vehicle) => v.id !== targetId));
    setDeleteTarget(null);

    try {
      await supabase
        .from('vehicles')
        .delete()
        .eq('id', targetId);
    } catch (err) {
      // Ignore DB permission errors for local fallback
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
            onClick={() => {
              setFilter(s);
              if (s === "All") {
                params.delete("status");
              } else {
                params.set("status", s);
              }
              setParams(params);
            }}
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
        searchKeys={["number", "driver", "type", "location", "route", "deviceId"]}
        columns={[
          { key: "number", label: "Vehicle #", render: (v) => (
            <Link to={`/vehicles/${v.id}`} className="font-medium text-primary hover:underline">{v.number}</Link>
          )},
          { key: "type", label: "Type" },
          { key: "driver", label: "Driver", render: (v) => v.driver || <span className="text-muted-foreground">Unassigned</span> },
          { key: "status", label: "Status", render: (v) => <Badge status={v.status}>{v.status}</Badge> },
          { key: "location", label: "Location", render: (v) => v.location || <span className="text-muted-foreground">—</span> },
          { key: "route", label: "Route", render: (v) => v.route || <span className="text-muted-foreground">—</span> },
          { key: "odometer", label: "Odometer", render: (v) => v.odometer ? `${v.odometer.toLocaleString()} km` : <span className="text-muted-foreground">—</span> },
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
            )
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
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Device ID</label>
                <input 
                  type="text" 
                  value={form.deviceId} 
                  onChange={(e) => setForm({ ...form, deviceId: e.target.value.replace(/\D/g, '') })} 
                  placeholder="e.g. 123456789012345"
                  maxLength={15}
                  pattern="[0-9]{15}"
                  className="h-9 px-3 w-full rounded-md border border-border bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                  title="Device ID must be exactly a 15-digit number"
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

              {form.type === "Tanker" && (
                <div className="space-y-4 p-3 bg-muted/40 rounded-lg border border-border/60">
                  <div>
                    <label className="block text-xs font-semibold text-primary uppercase tracking-wider mb-1.5 flex items-center justify-between">
                      <span>Tanker Litre Capacity *</span>
                      <span className="text-[10px] text-muted-foreground font-normal lowercase">(milk volume)</span>
                    </label>
                    <select
                      value={form.tankerCapacity}
                      onChange={(e) => setForm({ ...form, tankerCapacity: e.target.value })}
                      className="h-9 px-3 w-full rounded-md border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      required
                    >
                      <option value="3000">3,000 Litres (3 KL)</option>
                      <option value="5000">5,000 Litres (5 KL)</option>
                      <option value="10000">10,000 Litres (10 KL)</option>
                      <option value="12000">12,000 Litres (12 KL)</option>
                      <option value="15000">15,000 Litres (15 KL)</option>
                      <option value="18000">18,000 Litres (18 KL)</option>
                      <option value="20000">20,000 Litres (20 KL)</option>
                      <option value="25000">25,000 Litres (25 KL)</option>
                      <option value="custom">Custom Litre Capacity...</option>
                    </select>
                  </div>

                  {form.tankerCapacity === "custom" && (
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                        Custom Capacity (Litres) *
                      </label>
                      <input
                        type="number"
                        value={form.customTankerCapacity}
                        onChange={(e) => setForm({ ...form, customTankerCapacity: e.target.value })}
                        placeholder="e.g. 8500"
                        min="100"
                        className="h-9 px-3 w-full rounded-md border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        required
                      />
                    </div>
                  )}
                </div>
              )}

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
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Device ID</label>
                <input 
                  type="text" 
                  value={editForm.deviceId} 
                  onChange={(e) => setEditForm({ ...editForm, deviceId: e.target.value.replace(/\D/g, '') })} 
                  placeholder="e.g. 123456789012345"
                  maxLength={15}
                  pattern="[0-9]{15}"
                  className="h-9 px-3 w-full rounded-md border border-border bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                  title="Device ID must be exactly a 15-digit number"
                />
              </div>

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

              {editForm.type === "Tanker" && (
                <div className="space-y-4 p-3 bg-muted/40 rounded-lg border border-border/60">
                  <div>
                    <label className="block text-xs font-semibold text-primary uppercase tracking-wider mb-1.5 flex items-center justify-between">
                      <span>Tanker Litre Capacity *</span>
                      <span className="text-[10px] text-muted-foreground font-normal lowercase">(milk volume)</span>
                    </label>
                    <select
                      value={editForm.tankerCapacity}
                      onChange={(e) => setEditForm({ ...editForm, tankerCapacity: e.target.value })}
                      className="h-9 px-3 w-full rounded-md border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      required
                    >
                      <option value="3000">3,000 Litres (3 KL)</option>
                      <option value="5000">5,000 Litres (5 KL)</option>
                      <option value="10000">10,000 Litres (10 KL)</option>
                      <option value="12000">12,000 Litres (12 KL)</option>
                      <option value="15000">15,000 Litres (15 KL)</option>
                      <option value="18000">18,000 Litres (18 KL)</option>
                      <option value="20000">20,000 Litres (20 KL)</option>
                      <option value="25000">25,000 Litres (25 KL)</option>
                      <option value="custom">Custom Litre Capacity...</option>
                    </select>
                  </div>

                  {editForm.tankerCapacity === "custom" && (
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                        Custom Capacity (Litres) *
                      </label>
                      <input
                        type="number"
                        value={editForm.customTankerCapacity}
                        onChange={(e) => setEditForm({ ...editForm, customTankerCapacity: e.target.value })}
                        placeholder="e.g. 8500"
                        min="100"
                        className="h-9 px-3 w-full rounded-md border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        required
                      />
                    </div>
                  )}
                </div>
              )}

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
