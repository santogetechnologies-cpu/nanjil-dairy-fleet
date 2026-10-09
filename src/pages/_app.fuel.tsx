import { Kpi, Card, CardHeader, Badge, Button } from "@/components/ui-kit";
import { PageHeader } from "@/components/AppLayout";
import { Fuel, TrendingDown, Gauge, AlertTriangle, Plus, Loader2 } from "lucide-react";
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
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Derive selected vehicle's last recorded physical odometer
  const selectedVehicleObj = vehicles.find((v) => v.id === form.vehicleId);
  const vehiclePrevOdometer = (() => {
    if (!form.vehicleId) return 0;
    const vOdo = Number(selectedVehicleObj?.odometer || 0);
    const logsOdo = purchaseLogs
      .filter((l) => l.vehicle_id === form.vehicleId || (selectedVehicleObj?.number && l.vehicle === selectedVehicleObj.number))
      .map((l) => Number(l.odometer || 0));
    return Math.max(vOdo, ...logsOdo, 0);
  })();

  const isOdometerRollback = form.odometer > 0 && vehiclePrevOdometer > 0 && form.odometer < vehiclePrevOdometer;

  async function handleLogRefill(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!form.vehicleId) {
      setFormError("Please select a vehicle.");
      return;
    }
    if (form.liters <= 0) {
      setFormError("Fuel volume must be greater than 0 litres.");
      return;
    }
    if (form.cost <= 0) {
      setFormError("Total refill cost must be greater than ₹0.");
      return;
    }
    if (form.odometer < 0) {
      setFormError("Odometer reading cannot be negative.");
      return;
    }
    if (vehiclePrevOdometer > 0 && form.odometer < vehiclePrevOdometer) {
      setFormError(
        `Odometer reading (${form.odometer.toLocaleString()} km) is lower than the vehicle's last recorded odometer (${vehiclePrevOdometer.toLocaleString()} km). Decreasing odometer readings make fuel mileage calculations invalid. Please verify physical reading.`
      );
      return;
    }

    setSaving(true);

    try {
      const payload: any = {
        vehicle_id: form.vehicleId,
        liters: Number(form.liters),
        cost: Number(form.cost),
        odometer: Math.round(Number(form.odometer)),
        is_full_tank: Boolean(form.isFullTank)
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

      // Update vehicle physical odometer if entered reading is higher
      if (form.odometer > Number(selectedVehicleObj?.odometer || 0)) {
        await supabase
          .from('vehicles')
          .update({ odometer: Math.round(Number(form.odometer)) })
          .eq('id', form.vehicleId);
      }

      setShowLogModal(false);
      setForm({ vehicleId: "", liters: 0, cost: 0, odometer: 0, isFullTank: true });
      setFormError(null);
      await load();
    } catch (err: any) {
      setFormError("Failed to save fuel refill: " + (err.message || "Database insert error"));
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
        vehicle: va.vehicleNumber || 'Unknown',
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
      vehicle_id: l.vehicle_id,
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
              {formError && (
                <div className="p-2.5 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive font-medium">
                  {formError}
                </div>
              )}
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
                {form.vehicleId && vehiclePrevOdometer > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Last recorded physical odometer: <span className="font-semibold text-foreground">{vehiclePrevOdometer.toLocaleString()} km</span>
                  </p>
                )}
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
                {isOdometerRollback && (
                  <div className="mt-1.5 p-2 rounded bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-600 dark:text-amber-400 font-medium leading-relaxed">
                    ⚠️ Validation Notice: Entered odometer ({form.odometer.toLocaleString()} km) is lower than previous recorded reading ({vehiclePrevOdometer.toLocaleString()} km). Odometer rollbacks make mileage intervals invalid.
                  </div>
                )}
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
                <Button type="button" variant="outline" onClick={() => { setShowLogModal(false); setForm({ vehicleId: "", liters: 0, cost: 0, odometer: 0, isFullTank: true }); setFormError(null); }} className="flex-1">Cancel</Button>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card>
          <CardHeader title="Daily Refills" subtitle="Litres refilled across the fleet (fuel added)" />
          <div className="p-3" style={{ height: 280 }}>
            {trend.length > 0 ? (
              <ResponsiveContainer>
                <BarChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                  <XAxis dataKey="day" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={(val: any) => [`${val} L`, "Fuel Refilled"]} />
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
          <CardHeader title="Fleet Mileage Trend" subtitle="km/L by interval completion date" />
          <div className="p-3" style={{ height: 280 }}>
            {trend.length > 0 ? (
              <ResponsiveContainer>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                  <XAxis dataKey="day" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip 
                    formatter={(val: any) => [
                      val !== null && val !== undefined ? `${val} km/L` : "No intervals completed", 
                      "Interval Mileage"
                    ]} 
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="mileage" 
                    name="Completed Interval Mileage (km/L)"
                    stroke="oklch(0.62 0.18 150)" 
                    strokeWidth={2} 
                    connectNulls={false}
                  />
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
                <YAxis dataKey="vehicle" type="category" fontSize={12} width={110} />
                <Tooltip formatter={(val: any) => [`${val} km/L`, "Average Mileage"]} />
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
