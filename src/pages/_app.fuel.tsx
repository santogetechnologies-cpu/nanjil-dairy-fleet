import { Kpi, Card, CardHeader, Badge, Button } from "@/components/ui-kit";
import { PageHeader } from "@/components/AppLayout";
import { Fuel, TrendingDown, Gauge, AlertTriangle, Sparkles, Plus, Loader2 } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { DataTable } from "@/components/DataTable";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

function Page() {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [eff, setEff] = useState<any[]>([]);
  const [effMap, setEffMap] = useState<Record<string, number>>({});
  const [trend, setTrend] = useState<any[]>([]);
  
  // Fuel logging states
  const [purchaseLogs, setPurchaseLogs] = useState<any[]>([]);
  const [showLogModal, setShowLogModal] = useState(false);
  const [form, setForm] = useState({ vehicleId: "", liters: 0, cost: 0, odometer: 0 });
  const [saving, setSaving] = useState(false);

  async function handleLogRefill(e: React.FormEvent) {
    e.preventDefault();
    if (!form.vehicleId || form.liters <= 0 || form.cost <= 0 || form.odometer < 0) return;
    setSaving(true);

    try {
      const { error } = await supabase
        .from('fuel_purchase_logs')
        .insert({
          vehicle_id: form.vehicleId,
          liters: form.liters,
          cost: form.cost,
          odometer: form.odometer
        });

      if (error) throw error;
      setShowLogModal(false);
      setForm({ vehicleId: "", liters: 0, cost: 0, odometer: 0 });
      load();
    } catch (err: any) {
      alert("Failed to log fuel refill: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function load() {
    const [vRes, aRes, effRes, trendRes, logRes] = await Promise.all([
      supabase.from('v_vehicles').select('*'),
      supabase.from('alerts').select('*'),
      supabase.from('v_fuel_efficiency_by_vehicle').select('*').limit(10),
      supabase.from('v_daily_fuel_fleet').select('*'),
      supabase.from('fuel_purchase_logs').select('*, vehicles(number), drivers(name)').order('logged_at', { ascending: false })
    ]);

    if (vRes.data) setVehicles(vRes.data);
    if (aRes.data) setAlerts(aRes.data);
    
    if (effRes.data) {
      const mapping: Record<string, number> = {};
      effRes.data.forEach(e => {
        if (e.number) mapping[e.number] = Number(e.kmpl || 0);
      });
      setEffMap(mapping);

      setEff(effRes.data.map(e => ({ 
        vehicle: e.number ? e.number.split("-").slice(0, 2).join("-") : 'Unknown', 
        kmpl: Number(e.kmpl) 
      })));
    }
    
    if (trendRes.data) {
      setTrend(trendRes.data.map(f => ({
        day: f.log_date ? new Date(f.log_date).toLocaleDateString([], { weekday: 'short' }) : 'Unknown',
        consumed: Number(f.total_consumed_l || 0),
        mileage: Number(f.avg_mileage_kmpl || 0)
      })));
    }

    if (logRes.data) {
      setPurchaseLogs(logRes.data.map(l => ({
        id: l.id,
        vehicle: l.vehicles?.number || 'Unknown',
        driver: l.drivers?.name || 'Admin Log',
        liters: Number(l.liters || 0),
        cost: Number(l.cost || 0),
        odometer: Number(l.odometer || 0),
        date: new Date(l.logged_at).toLocaleDateString()
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
        .channel('fuel-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_telemetry' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'fuel_purchase_logs' }, () => { if (!cancelled) load(); })
        .subscribe();
    }

    init();

    return () => {
      cancelled = true;
      channel?.unsubscribe();
    };
  }, []);

  const totalConsumed = trend.reduce((s, t) => s + (t.consumed || 0), 0);
  const avgKmpl = eff.reduce((s, e) => s + (e.kmpl || 0), 0) / (eff.length || 1);
  const totalLitersManual = purchaseLogs.reduce((s, p) => s + p.liters, 0);
  const totalCostManual = purchaseLogs.reduce((s, p) => s + p.cost, 0);
  const avgPricePerLiter = totalLitersManual > 0 ? (totalCostManual / totalLitersManual) : 0;
  const fuelAlerts = alerts.filter((a) => a.type === 'Fuel');

  return (
    <div>
      <PageHeader 
        title="Fuel Intelligence" 
        subtitle="Live consumption, efficiency and manual purchase logs" 
        actions={
          <Button onClick={() => setShowLogModal(true)} className="flex items-center gap-1">
            <Plus className="h-4 w-4" /> Log Refill
          </Button>
        }
      />

      {showLogModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader title="Log Fuel Purchase" subtitle="Record manual fuel refill" />
            <form onSubmit={handleLogRefill} className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Select Vehicle *</label>
                <select 
                  className="w-full p-2 border border-border bg-card rounded-md text-sm"
                  value={form.vehicleId}
                  onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
                  required
                >
                  <option value="">Choose vehicle...</option>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.number}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Liters *</label>
                  <input 
                    type="number" 
                    step="0.01"
                    className="w-full p-2 border border-border bg-transparent rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    value={form.liters || ""}
                    onChange={(e) => setForm({ ...form, liters: Number(e.target.value) })}
                    placeholder="e.g. 45"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Total Cost (INR) *</label>
                  <input 
                    type="number" 
                    step="0.01"
                    className="w-full p-2 border border-border bg-transparent rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    value={form.cost || ""}
                    onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })}
                    placeholder="e.g. 4500"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Odometer (km) *</label>
                <input 
                  type="number" 
                  className="w-full p-2 border border-border bg-transparent rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={form.odometer || ""}
                  onChange={(e) => setForm({ ...form, odometer: Number(e.target.value) })}
                  placeholder="e.g. 10450"
                  required
                />
              </div>
              <div className="flex gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" onClick={() => { setShowLogModal(false); setForm({ vehicleId: "", liters: 0, cost: 0, odometer: 0 }); }} className="flex-1">Cancel</Button>
                <Button type="submit" className="flex-1" disabled={saving}>
                  {saving ? <Loader2 className="animate-spin h-4 w-4" /> : "Save Refill"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total Cost (Manual)" value={`₹${totalCostManual.toLocaleString()}`} hint="From purchase logs" icon={<Fuel className="h-5 w-5" />} />
        <Kpi label="Liters Logged" value={`${totalLitersManual.toLocaleString()} L`} accent="success" icon={<Gauge className="h-5 w-5" />} hint="Refills volume" />
        <Kpi label="Avg Fuel Cost" value={`₹${avgPricePerLiter.toFixed(2)}/L`} accent="info" icon={<TrendingDown className="h-5 w-5" />} hint="Average refill rate" />
        <Kpi label="Open Fuel Alerts" value={fuelAlerts.filter((a) => !a.resolved).length} accent="destructive" icon={<AlertTriangle className="h-5 w-5" />} hint={`${fuelAlerts.length} total`} />
      </div>

      <div className="rounded-lg border border-info/40 bg-gradient-to-br from-info/5 to-primary/5 p-4 mt-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center"><Sparkles className="h-4 w-4" /></div>
          <div className="font-medium">AI Fuel Analysis</div>
        </div>
        <p className="text-sm mt-2 leading-relaxed">
          The database reports <span className="font-semibold">{fuelAlerts.filter((a) => !a.resolved).length} active fuel alerts</span>.
          Vehicles underperforming average fuel efficiency thresholds are highlighted in comparison details below.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card>
          <CardHeader title="Daily Consumption" subtitle="Litres consumed across the fleet" />
          <div className="p-3" style={{ height: 280 }}>
            {trend.length > 0 ? (
              <ResponsiveContainer>
                <BarChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                  <XAxis dataKey="day" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="consumed" fill="oklch(0.45 0.15 255)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No daily consumption logs registered.
              </div>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Fleet Mileage Trend" subtitle="km/L weekly" />
          <div className="p-3" style={{ height: 280 }}>
            {trend.length > 0 ? (
              <ResponsiveContainer>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                  <XAxis dataKey="day" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="mileage" stroke="oklch(0.62 0.18 150)" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No mileage logs registered.
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Vehicle Comparison" subtitle="Fuel efficiency km/L" />
        <div className="p-3" style={{ height: 300 }}>
          {eff.length > 0 ? (
            <ResponsiveContainer>
              <BarChart data={eff} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                <XAxis type="number" fontSize={12} />
                <YAxis dataKey="vehicle" type="category" fontSize={12} width={80} />
                <Tooltip />
                <Bar dataKey="kmpl" fill="oklch(0.45 0.15 255)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              No comparative vehicle efficiency data exists.
            </div>
          )}
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Manual Refill History" subtitle="Manual entries logged by drivers and admins" />
        <div className="p-2">
          <DataTable
            data={purchaseLogs}
            pageSize={5}
            searchKeys={["vehicle", "driver"]}
            columns={[
              { key: "date", label: "Date" },
              { key: "vehicle", label: "Vehicle" },
              { key: "driver", label: "Logged By" },
              { key: "liters", label: "Liters", render: (r: any) => `${r.liters} L` },
              { key: "cost", label: "Total Cost", render: (r: any) => `₹${r.cost.toLocaleString()}` },
              { key: "odometer", label: "Odometer", render: (r: any) => `${r.odometer.toLocaleString()} km` },
              { key: "pricePerL", label: "Price / L", render: (r: any) => `₹${(r.cost / r.liters).toFixed(2)}/L` },
            ]}
          />
        </div>
      </Card>

      <div className="mt-4">
        <DataTable
          data={vehicles.slice(0, 20).map((v) => {
            const mileage = effMap[v.number] || 0;
            return {
              number: v.number,
              driver: v.driver_name || 'Unassigned',
              fuel: v.fuel || 0,
              odometer: v.odometer || 0,
              mileage: mileage,
              status: v.fuel < 25 ? "Low Fuel" : v.fuel < 50 ? "Half Tank" : "OK",
            };
          })}
          searchKeys={["number", "driver"]}
          columns={[
            { key: "number", label: "Vehicle" },
            { key: "driver", label: "Driver" },
            { key: "fuel", label: "Tank %", render: (r: any) => (
              <div className="flex items-center gap-2 min-w-[100px]">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full ${r.fuel < 25 ? "bg-destructive" : r.fuel < 50 ? "bg-warning" : "bg-success"}`} style={{ width: `${r.fuel}%` }} />
                </div>
                <span className="text-xs font-medium w-10 text-right">{r.fuel}%</span>
              </div>
            )},
            { key: "odometer", label: "Odometer", render: (r: any) => `${r.odometer.toLocaleString()} km` },
            { key: "mileage", label: "Mileage", render: (r: any) => r.mileage > 0 ? `${r.mileage} km/L` : '—' },
            { key: "status", label: "Status", render: (r: any) => (
              <Badge status={r.status === "Low Fuel" ? "High" : r.status === "Half Tank" ? "Medium" : "Low"}>{r.status}</Badge>
            )},
          ]}
        />
      </div>
    </div>
  );
}

export default Page;
