import { useState, useEffect } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Kpi, Card, CardHeader } from "@/components/ui-kit";
import { Truck, Route, Fuel, Gauge } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/lib/supabase";

function Page() {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [tripStats, setTripStats] = useState<Record<string, { count: number; totalKm: number; lastDate: string }>>({});
  const [fuelStats, setFuelStats] = useState<Record<string, { count: number; totalLiters: number }>>({});

  async function load() {
    const [vRes, tRes, fRes] = await Promise.all([
      supabase.from('v_vehicles').select('*'),
      supabase.from('trips').select('vehicle_id, distance, date, status'),
      supabase.from('fuel_purchase_logs').select('vehicle_id, liters')
    ]);

    if (vRes.data) setVehicles(vRes.data);

    if (tRes.data) {
      const stats: Record<string, { count: number; totalKm: number; lastDate: string }> = {};
      tRes.data.forEach((t: any) => {
        if (!t.vehicle_id) return;
        if (!stats[t.vehicle_id]) stats[t.vehicle_id] = { count: 0, totalKm: 0, lastDate: '' };
        stats[t.vehicle_id].count++;
        stats[t.vehicle_id].totalKm += Number(t.distance || 0);
        if (!stats[t.vehicle_id].lastDate || t.date > stats[t.vehicle_id].lastDate) {
          stats[t.vehicle_id].lastDate = t.date;
        }
      });
      setTripStats(stats);
    }

    if (fRes.data) {
      const stats: Record<string, { count: number; totalLiters: number }> = {};
      fRes.data.forEach((f: any) => {
        if (!f.vehicle_id) return;
        if (!stats[f.vehicle_id]) stats[f.vehicle_id] = { count: 0, totalLiters: 0 };
        stats[f.vehicle_id].count++;
        stats[f.vehicle_id].totalLiters += Number(f.liters || 0);
      });
      setFuelStats(stats);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      if (cancelled) return;
      load();
      channel = supabase
        .channel('vehicle-activity-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'fuel_purchase_logs' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => { if (!cancelled) load(); })
        .subscribe();
    }

    init();
    return () => { cancelled = true; channel?.unsubscribe(); };
  }, []);

  // Aggregate KPIs from real data
  const totalTrips = Object.values(tripStats).reduce((s, t) => s + t.count, 0);
  const totalDistanceKm = Math.round(Object.values(tripStats).reduce((s, t) => s + t.totalKm, 0));
  const totalFuelLiters = Math.round(Object.values(fuelStats).reduce((s, f) => s + f.totalLiters, 0));
  const activeVehicles = vehicles.filter(v => tripStats[v.id]?.count > 0).length;

  const tableData = vehicles.map(v => ({
    id: v.id,
    number: v.number,
    driver: v.driver_name || 'Unassigned',
    status: v.status,
    odometer: Number(v.odometer || 0),
    trips: tripStats[v.id]?.count || 0,
    totalKm: Math.round(tripStats[v.id]?.totalKm || 0),
    fuelFillUps: fuelStats[v.id]?.count || 0,
    totalLiters: Math.round((fuelStats[v.id]?.totalLiters || 0) * 10) / 10,
    lastTrip: tripStats[v.id]?.lastDate || '—',
    kmpl: (fuelStats[v.id]?.totalLiters || 0) > 0 && (tripStats[v.id]?.totalKm || 0) > 0
      ? Math.round(((tripStats[v.id]?.totalKm || 0) / (fuelStats[v.id]?.totalLiters || 1)) * 10) / 10
      : null,
  }));

  return (
    <div>
      <PageHeader
        title="Vehicle Activity Log"
        subtitle={`Trip & fuel records · ${vehicles.length} vehicles · No sensor data required`}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total Fleet Trips" value={totalTrips} accent="success" icon={<Route className="h-5 w-5" />} hint="All logged trips" />
        <Kpi label="Total Distance" value={`${totalDistanceKm.toLocaleString()} km`} icon={<Gauge className="h-5 w-5" />} hint="From trip logs" />
        <Kpi label="Total Fuel Used" value={`${totalFuelLiters.toLocaleString()} L`} accent="warning" icon={<Fuel className="h-5 w-5" />} hint="From refuel logs" />
        <Kpi label="Active Vehicles" value={activeVehicles} accent="info" icon={<Truck className="h-5 w-5" />} hint={`of ${vehicles.length} total`} />
      </div>

      <Card className="mt-4">
        <CardHeader title="Fleet Activity Summary" subtitle="Trips and fuel data calculated from manual logs — no sensors required" />
        <DataTable
          data={tableData}
          searchKeys={["number", "driver"]}
          columns={[
            { key: "number", label: "Vehicle" },
            { key: "driver", label: "Assigned Driver" },
            {
              key: "status", label: "Status",
              render: (r: any) => (
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  r.status === 'Moving' ? 'bg-emerald-100 text-emerald-700' :
                  r.status === 'Idle' ? 'bg-amber-100 text-amber-700' :
                  r.status === 'Parked' ? 'bg-slate-100 text-slate-600' :
                  'bg-red-100 text-red-600'
                }`}>{r.status || 'Unknown'}</span>
              )
            },
            { key: "odometer", label: "Odometer", render: (r: any) => r.odometer > 0 ? `${r.odometer.toLocaleString()} km` : '—' },
            { key: "trips", label: "Total Trips", render: (r: any) => r.trips > 0 ? r.trips : <span className="text-muted-foreground">—</span> },
            { key: "totalKm", label: "Distance (km)", render: (r: any) => r.totalKm > 0 ? `${r.totalKm.toLocaleString()} km` : '—' },
            { key: "fuelFillUps", label: "Fuel Fill-ups", render: (r: any) => r.fuelFillUps > 0 ? r.fuelFillUps : <span className="text-muted-foreground">—</span> },
            { key: "totalLiters", label: "Fuel (L)", render: (r: any) => r.totalLiters > 0 ? `${r.totalLiters} L` : '—' },
            { key: "kmpl", label: "Mileage (km/L)", render: (r: any) => r.kmpl !== null ? <span className="font-semibold text-primary">{r.kmpl}</span> : <span className="text-muted-foreground">—</span> },
            { key: "lastTrip", label: "Last Trip", render: (r: any) => r.lastTrip !== '—' ? new Date(r.lastTrip).toLocaleDateString() : '—' },
          ]}
        />
        {vehicles.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No vehicles found. Add vehicles in the Vehicles section.
          </div>
        )}
      </Card>
    </div>
  );
}

export default Page;
