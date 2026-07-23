import { type MaintenanceRecord } from "@/lib/types";
import { PageHeader } from "@/components/AppLayout";
import { Kpi, Card, Badge, Button } from "@/components/ui-kit";
import { Wrench, AlertCircle, CheckCircle2, Calendar, Plus, X, Loader2 } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

function Page() {
  const { user } = useAuth();
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ vehicleId: "", service: "", cost: 0, dueDate: "" });
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const canManage = user?.role === "admin" || user?.role === "manager";

  async function loadMaintenance() {
    const [mRes, vRes] = await Promise.all([
      supabase.from('maintenance_records').select('*'),
      supabase.from('vehicles').select('*')
    ]);

    if (vRes.data) {
      setVehicles(vRes.data);
    }

    if (mRes.data) {
      setRecords(mRes.data.map(m => {
        const vObj = vRes.data?.find(x => x.id === m.vehicle_id);
        return {
          id: m.id,
          vehicle: vObj ? vObj.number : 'Unknown',
          service: m.service,
          dueIn: m.due_in || '',
          dueDate: m.due_date || '',
          status: m.status,
          cost: Number(m.cost || 0)
        };
      }));
    }
  }

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      if (cancelled) return;

      loadMaintenance();

      channel = supabase
        .channel('maintenance-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_records' }, () => { if (!cancelled) loadMaintenance(); })
        .subscribe();
    }

    init();

    return () => {
      cancelled = true;
      channel?.unsubscribe();
    };
  }, []);

  async function markCompleted(id: string) {
    const { error } = await supabase
      .from('maintenance_records')
      .update({ status: 'Completed' })
      .eq('id', id);

    if (!error) {
      loadMaintenance();
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError("");
    setLoading(true);

    if (!form.vehicleId) {
      setSubmitError("Please select a vehicle.");
      setLoading(false);
      return;
    }

    if (!form.service.trim()) {
      setSubmitError("Service description is required.");
      setLoading(false);
      return;
    }

    const { data: newRec, error } = await supabase
      .from('maintenance_records')
      .insert({
        vehicle_id: form.vehicleId,
        service: form.service.trim(),
        cost: Number(form.cost) || 0,
        due_date: form.dueDate || new Date().toISOString().split('T')[0],
        status: 'Upcoming'
      })
      .select()
      .maybeSingle();

    if (error) {
      setSubmitError(error.message || "Failed to log maintenance record.");
      setLoading(false);
      return;
    }

    if (newRec) {
      const dueDays = Math.ceil((new Date(newRec.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      const severity = dueDays <= 3 ? 'High' : (dueDays <= 7 ? 'Medium' : 'Low');

      await supabase.from('alerts').insert({
        type: 'Maintenance',
        severity: severity,
        vehicle_id: form.vehicleId,
        message: `Maintenance scheduled: ${form.service.trim()} (Due in ${dueDays} days on ${newRec.due_date})`,
        resolved: false
      });
    }

    setLoading(false);
    setShowNew(false);
    setForm({ vehicleId: "", service: "", cost: 0, dueDate: "" });
    loadMaintenance();
  }

  const overdue = records.filter((r) => r.status === "Overdue").length;
  const upcoming = records.filter((r) => r.status === "Upcoming").length;
  const completed = records.filter((r) => r.status === "Completed").length;
  const totalCost = records.reduce((s, r) => s + r.cost, 0);

  return (
    <div>
      <PageHeader 
        title="Maintenance Management" 
        subtitle={`Service reminders · ${records.length} logs`} 
        actions={
          canManage && (
            <Button onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4" /> Log Service
            </Button>
          )
        }
      />

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

      {showNew && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div className="bg-card rounded-lg shadow-xl max-w-md w-full p-5 border border-border" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="font-semibold text-lg">Log Maintenance Service</h3>
              <button onClick={() => setShowNew(false)} className="p-1 hover:bg-muted rounded text-muted-foreground"><X className="h-4 w-4" /></button>
            </div>

            <form onSubmit={handleAdd} className="mt-4 space-y-4">
              {submitError && (
                <div className="bg-destructive/10 text-destructive text-xs p-2.5 rounded border border-destructive/20 font-medium">
                  {submitError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Select Vehicle *</label>
                <select 
                  value={form.vehicleId} 
                  onChange={(e) => setForm({ ...form, vehicleId: e.target.value })} 
                  className="h-9 px-3 w-full rounded-md border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                >
                  <option value="">-- Choose a Vehicle --</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.id}>{v.number} ({v.type})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Service / Maintenance Description *</label>
                <input 
                  type="text" 
                  value={form.service} 
                  onChange={(e) => setForm({ ...form, service: e.target.value })} 
                  placeholder="e.g. Engine Oil & Filter Replacement"
                  className="h-9 px-3 w-full rounded-md border border-border bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Estimated Cost (₹) *</label>
                <input 
                  type="number" 
                  value={form.cost} 
                  onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })} 
                  placeholder="e.g. 4500"
                  className="h-9 px-3 w-full rounded-md border border-border bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Scheduled Due Date *</label>
                <input 
                  type="date" 
                  value={form.dueDate} 
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })} 
                  className="h-9 px-3 w-full rounded-md border border-border bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
              </div>

              <div className="pt-3 border-t border-border flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowNew(false)} disabled={loading}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Logging…
                    </>
                  ) : (
                    "Schedule Service"
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

export default Page;
