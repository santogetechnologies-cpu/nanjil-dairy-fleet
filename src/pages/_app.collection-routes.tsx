import { useState, useEffect } from "react";
import { type CollectionRoute } from "@/lib/types";
import { PageHeader } from "@/components/AppLayout";
import { Badge, Button, Card, CardHeader } from "@/components/ui-kit";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Plus, X, Loader2, Route, MapPin } from "lucide-react";

function Page() {
  const { user } = useAuth();
  const [routes, setRoutes] = useState<CollectionRoute[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", startTime: "", endTime: "", centres: 0,
    vehicleId: "", driverId: "", status: "In Progress" as const
  });

  const canManage = user?.role === "admin" || user?.role === "manager";

  async function load() {
    const [rRes, vRes, dRes] = await Promise.all([
      supabase.from('collection_routes').select('*'),
      supabase.from('vehicles').select('*'),
      supabase.from('drivers').select('*')
    ]);

    if (vRes.data) setVehicles(vRes.data);
    if (dRes.data) {
      // Deduplicate drivers by name
      const map = new Map<string, any>();
      for (const d of dRes.data) {
        if (!map.has(d.name) || (d.profile_id && !map.get(d.name).profile_id)) {
          map.set(d.name, d);
        }
      }
      setDrivers(Array.from(map.values()));
    }

    if (rRes.data) {
      setRoutes(rRes.data.map(r => {
        const vObj = vRes.data?.find(x => x.id === r.vehicle_id);
        const dObj = dRes.data?.find(d => d.id === r.driver_id);
        return {
          id: r.id,
          name: r.name,
          vehicle: vObj ? vObj.number : 'Unassigned',
          driver: dObj ? dObj.name : 'Unassigned',
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

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      if (cancelled) return;
      load();
      const channelId = `routes-realtime-${Math.random().toString(36).substring(2, 9)}`;
      channel = supabase
        .channel(channelId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'collection_routes' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_assignments' }, () => { if (!cancelled) load(); })
        .subscribe();
    }

    init();
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, []);

  async function handleCreateRoute(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('collection_routes').insert({
        name: form.name.trim(),
        vehicle_id: form.vehicleId || null,
        driver_id: form.driverId || null,
        centres: form.centres || 0,
        start_time: form.startTime || null,
        end_time: form.endTime || null,
        status: form.status,
        litres: 0,
        completion: 0,
      });
      if (error) throw error;
      setShowModal(false);
      setForm({ name: "", startTime: "", endTime: "", centres: 0, vehicleId: "", driverId: "", status: "In Progress" });
      load();
    } catch (err: any) {
      alert("Failed to create route: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRoute(id: string) {
    if (!confirm("Delete this route? This is permanent.")) return;
    setRoutes(prev => prev.filter(r => r.id !== id));
    try {
      await supabase.from('collection_routes').delete().eq('id', id);
    } catch (err) { }
  }

  return (
    <div>
      <PageHeader
        title="Dairy Collection Routes"
        subtitle={`Milk collection loops · ${routes.length} active routes`}
        actions={
          canManage && (
            <Button onClick={() => setShowModal(true)} className="flex items-center gap-1">
              <Plus className="h-4 w-4" /> Add Route
            </Button>
          )
        }
      />

      {routes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <Route className="h-12 w-12 text-muted-foreground/30" />
          <div className="text-base font-semibold text-foreground">No Collection Routes</div>
          <p className="text-sm text-muted-foreground max-w-sm">
            Create routes and assign vehicles and drivers to track milk collection loops.
          </p>
          {canManage && (
            <Button onClick={() => setShowModal(true)} className="mt-2 flex items-center gap-1">
              <Plus className="h-4 w-4" /> Create First Route
            </Button>
          )}
        </div>
      ) : (
        <DataTable<CollectionRoute>
          data={routes}
          searchKeys={["name", "vehicle", "driver"]}
          columns={[
            { key: "name", label: "Route" },
            { key: "vehicle", label: "Vehicle" },
            { key: "driver", label: "Driver" },
            { key: "centres", label: "Centres" },
            { key: "startTime", label: "Start" },
            { key: "endTime", label: "End" },
            { key: "litres", label: "Litres", render: (r) => `${r.litres.toLocaleString()} L` },
            {
              key: "completion", label: "Completion", render: (r) => (
                <div className="flex items-center gap-2 min-w-[120px]">
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full ${r.completion === 100 ? "bg-success" : r.status === "Delayed" ? "bg-destructive" : "bg-info"}`}
                      style={{ width: `${r.completion}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium w-10 text-right">{r.completion}%</span>
                </div>
              )
            },
            { key: "status", label: "Status", render: (r) => <Badge status={r.status}>{r.status}</Badge> },
            {
              key: "actions", label: "", render: (r: any) => canManage && (
                <button
                  onClick={() => handleDeleteRoute(r.id)}
                  className="text-xs text-destructive hover:underline"
                >
                  Delete
                </button>
              )
            },
          ]}
        />
      )}

      {/* Create Route Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <div className="font-semibold text-base flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" /> Create Collection Route
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Assign route, vehicle and driver</div>
              </div>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateRoute} className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Route Name *</label>
                <input
                  type="text"
                  required
                  className="w-full p-2 border border-border bg-transparent rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Route A – Northern Loop"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Select Vehicle</label>
                  <select
                    className="w-full p-2 border border-border bg-card rounded-md text-sm"
                    value={form.vehicleId}
                    onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
                  >
                    <option value="">No Vehicle</option>
                    {vehicles.map(v => <option key={v.id} value={v.id}>{v.number}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Select Driver</label>
                  <select
                    className="w-full p-2 border border-border bg-card rounded-md text-sm"
                    value={form.driverId}
                    onChange={(e) => setForm({ ...form, driverId: e.target.value })}
                  >
                    <option value="">No Driver</option>
                    {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Centres</label>
                  <input
                    type="number" min={0}
                    className="w-full p-2 border border-border bg-transparent rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    value={form.centres || ""}
                    onChange={(e) => setForm({ ...form, centres: Number(e.target.value) })}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Start Time</label>
                  <input
                    type="time"
                    className="w-full p-2 border border-border bg-transparent rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    value={form.startTime}
                    onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">End Time</label>
                  <input
                    type="time"
                    className="w-full p-2 border border-border bg-transparent rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    value={form.endTime}
                    onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Initial Status</label>
                <select
                  className="w-full p-2 border border-border bg-card rounded-md text-sm"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as any })}
                >
                  <option value="In Progress">In Progress</option>
                  <option value="On Time">On Time</option>
                  <option value="Delayed">Delayed</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>

              <div className="flex gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setShowModal(false)} className="flex-1">Cancel</Button>
                <Button type="submit" className="flex-1" disabled={saving}>
                  {saving ? <Loader2 className="animate-spin h-4 w-4" /> : "Create Route"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

export default Page;
