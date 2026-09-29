import { Kpi, Card, CardHeader, Badge, Button } from "@/components/ui-kit";
import { PageHeader } from "@/components/AppLayout";
import { Fuel, TrendingDown, Gauge, AlertTriangle, Sparkles, Plus, Loader2 } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { DataTable } from "@/components/DataTable";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
  calculateFleetFuelAnalysis,
  type FleetFuelAnalysis,
  type RawFuelLog,
} from "@/lib/fuel-efficiency";

function Page() {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [eff, setEff] = useState<any[]>([]);
  const [effMap, setEffMap] = useState<Record<string, number>>({});
  const [trend, setTrend] = useState<any[]>([]);
  const [fleetAnalysis, setFleetAnalysis] = useState<FleetFuelAnalysis | null>(null);
  
  // Fuel logging states
  const [purchaseLogs, setPurchaseLogs] = useState<any[]>([]);
  const [showLogModal, setShowLogModal] = useState(false);
  const [form, setForm] = useState({ vehicleId: "", liters: 0, cost: 0, odometer: 0, isFullTank: true });
  const [saving, setSaving] = useState(false);

  async function handleLogRefill(e: React.FormEvent) {
    e.preventDefault();
    if (!form.vehicleId || form.liters <= 0 || form.cost <= 0 || form.odometer < 0) return;
    setSaving(true);

    try {
      const payload: any = {
        vehicle_id: form.vehicleId,
        liters: form.liters,
        cost: form.cost,
        odometer: form.odometer,
        is_full_tank: form.isFullTank
      };

      const { error } = await supabase
        .from('fuel_purchase_logs')
        .insert(payload);

      if (error && error.message?.includes('is_full_tank')) {
        delete payload.is_full_tank;
        const { error: retryError } = await supabase.from('fuel_purchase_logs').insert(payload);
        if (retryError) throw retryError;
      } else if (error) {
        throw error;
      }

      setShowLogModal(false);
      setForm({ vehicleId: "", liters: 0, cost: 0, odometer: 0, isFullTank: true });
      load();
    } catch (err: any) {
      alert("Failed to log fuel refill: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function load() {
    const [vRes, aRes, logRes] = await Promise.all([
      supabase.from('v_vehicles').select('*'),
      supabase.from('alerts').select('*'),
      supabase.from('fuel_purchase_logs').select('*, vehicles(number), drivers(name)').order('logged_at', { ascending: true })
    ]);

    const vList = vRes.data || [];
    if (vRes.data) setVehicles(vList);
    if (aRes.data) setAlerts(aRes.data);
    
    const rawLogs: RawFuelLog[] = logRes.data || [];
    const analysis = calculateFleetFuelAnalysis(rawLogs, vList);
    setFleetAnalysis(analysis);

    const mapping: Record<string, number> = {};
    Object.values(analysis.vehicleMap).forEach(va => {
      if (va.vehicleNumber && va.averageMileage !== null) {
        mapping[va.vehicleNumber] = va.averageMileage;
      }
    });
    setEffMap(mapping);

    const realEff = Object.values(analysis.vehicleMap)
      .filter(va => va.hasSufficientData && va.averageMileage !== null)
      .map(va => ({
        vehicle: va.vehicleNumber ? va.vehicleNumber.split("-").slice(0, 2).join("-") : 'Unknown',
        kmpl: va.averageMileage!
      }));
    setEff(realEff);

    setTrend(analysis.dailyConsumption);

    // Map interval mileage to specific log records that completed full-tank intervals
    const intervalMileageByLogId = new Map<string, number>();
    Object.values(analysis.vehicleMap).forEach(va => {
      va.intervals.forEach(inv => {
        intervalMileageByLogId.set(inv.intervalId, inv.mileageKmpl);
      });
    });

    const displayLogs = [...rawLogs].reverse().map(l => ({
      id: l.id,
      vehicle: l.vehicles?.number || 'Unknown',
      driver: l.drivers?.name || 'Admin Log',
      liters: Number(l.liters || 0),
      cost: Number(l.cost || 0),
      odometer: Number(l.odometer || 0),
      isFullTank: l.is_full_tank !== false,
      intervalMileage: intervalMileageByLogId.get(l.id) ?? null,
      date: new Date(l.logged_at).toLocaleDateString()
    }));
    setPurchaseLogs(displayLogs);
  }

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      if (cancelled) return;

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
              <div className="flex items-center gap-2 pt-1">
                <input 
                  type="checkbox" 
                  id="isFullTank"
                  checked={form.isFullTank}
                  onChange={(e) => setForm({ ...form, isFullTank: e.target.checked })}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                />
                <label htmlFor="isFullTank" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer">
                  Full Tank Refill (Enables Full-Tank Mileage Calculation)
                </label>
              </div>
              <div className="flex gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" onClick={() => { setShowLogModal(false); setForm({ vehicleId: "", liters: 0, cost: 0, odometer: 0, isFullTank: true }); }} className="flex-1">Cancel</Button>
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
          <div className="font-medium">Fuel Efficiency Analysis</div>
        </div>
        <p className="text-sm mt-2 leading-relaxed">
          {fleetAnalysis?.fleetAvgMileage !== null && fleetAnalysis?.fleetAvgMileage !== undefined ? (
            <>
              Evaluated fleet average is <span className="font-semibold text-primary">{fleetAnalysis.fleetAvgMileage} km/L</span> across {fleetAnalysis.vehiclesWithDataCount} vehicles with validated full-tank intervals.
            </>
          ) : (
            <>
              Mileage is calculated using the full-tank-to-full-tank methodology from manual refill records. Log at least two full-tank refills for a vehicle to calculate verified km/L efficiency.
            </>
          )}
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
              { key: "isFullTank", label: "Type", render: (r: any) => (
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${r.isFullTank ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                  {r.isFullTank ? "Full Tank" : "Partial"}
                </span>
              )},
              { key: "liters", label: "Liters", render: (r: any) => `${r.liters} L` },
              { key: "cost", label: "Total Cost", render: (r: any) => `₹${r.cost.toLocaleString()}` },
              { key: "odometer", label: "Odometer", render: (r: any) => `${r.odometer.toLocaleString()} km` },
              { key: "pricePerL", label: "Price / L", render: (r: any) => `₹${(r.cost / r.liters).toFixed(2)}/L` },
              { key: "intervalMileage", label: "Interval Mileage", render: (r: any) => (
                r.intervalMileage !== null ? (
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">{r.intervalMileage} km/L</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )
              )},
            ]}
          />
        </div>
      </Card>

      <div className="mt-4">
        <DataTable
          data={vehicles.slice(0, 20).map((v) => {
            const vAnalysis = fleetAnalysis?.vehicleMap[v.id];
            const mileageVal = vAnalysis?.averageMileage ?? null;
            return {
              number: v.number,
              driver: v.driver_name || 'Unassigned',
              fuel: v.fuel || 0,
              odometer: v.odometer || 0,
              mileage: mileageVal !== null ? `${mileageVal} km/L` : 'Insufficient data',
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
            { key: "mileage", label: "Mileage (km/L)", render: (r: any) => (
              r.mileage === 'Insufficient data' ? (
                <span className="text-muted-foreground text-xs italic">Insufficient data</span>
              ) : (
                <span className="font-semibold text-primary">{r.mileage}</span>
              )
            )},
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
