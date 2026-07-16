import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Truck, Activity, ParkingSquare, Pause, Fuel, Thermometer, Wrench, Sparkles, ArrowUpRight,
} from "lucide-react";
import { Kpi, Card, CardHeader, Badge } from "@/components/ui-kit";
import { PageHeader } from "@/components/AppLayout";
import { VehicleMap } from "@/components/VehicleMap";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { supabase } from "@/lib/supabase";

const STATUS_COLORS: Record<string, string> = {
  Moving: "oklch(0.62 0.16 150)",
  Idle: "oklch(0.78 0.16 75)",
  Parked: "oklch(0.5 0.02 250)",
  Offline: "oklch(0.6 0.22 25)",
};

function DashboardPage() {
  const [now, setNow] = useState(new Date());
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [maintenance, setMaintenance] = useState<any[]>([]);
  const [eff, setEff] = useState<any[]>([]);
  const [fuelData, setFuelData] = useState<any[]>([]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function load() {
      const [vRes, aRes, mRes, effRes, fuelRes] = await Promise.all([
        supabase.from('v_vehicles').select('*'),
        supabase.from('alerts').select('*'),
        supabase.from('maintenance_records').select('*'),
        supabase.from('v_fuel_efficiency_by_vehicle').select('*').limit(10),
        supabase.from('v_daily_fuel_fleet').select('*')
      ]);
      if (cancelled) return;
      if (vRes.data) setVehicles(vRes.data);
      if (aRes.data) setAlerts(aRes.data);
      if (mRes.data) setMaintenance(mRes.data);
      if (effRes.data) {
        setEff(effRes.data.map(e => ({
          vehicle: e.number ? e.number.split("-").slice(0, 2).join("-") : 'Unknown',
          kmpl: Number(e.kmpl)
        })));
      }
      if (fuelRes.data) {
        setFuelData(fuelRes.data.map(f => ({
          day: f.log_date ? new Date(f.log_date).toLocaleDateString([], { weekday: 'short' }) : 'Unknown',
          consumed: Number(f.total_consumed_l)
        })));
      }
    }

    async function init() {
      // Guard: only query if a valid session exists to prevent 401s on StrictMode double-invoke
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled || !session) return;

      load();

      // Register ALL handlers before calling subscribe() — supabase-js requires this order
      channel = supabase
        .channel('dashboard-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_telemetry' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_records' }, () => { if (!cancelled) load(); })
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

  const mappedVehicles = vehicles.map(v => ({
    id: v.id,
    number: v.number,
    type: v.type,
    model: v.model,
    route: v.route,
    insuranceExpiry: v.insurance_expiry,
    lastService: v.last_service,
    nextServiceKm: v.next_service_km,
    odometer: v.odometer,
    engineHours: Number(v.engine_hours),
    status: v.status,
    location: v.location,
    lat: Number(v.lat),
    lng: Number(v.lng),
    speed: v.speed,
    fuel: v.fuel,
    temperature: Number(v.temperature),
    humidity: v.humidity,
    engineOn: v.engine_on,
    ignition: v.ignition,
    driver: v.driver_name || '',
    driverId: v.driver_id || '',
    lastUpdate: v.last_update ? new Date(v.last_update).toLocaleTimeString() : 'sec ago'
  }));

  const mappedAlerts = alerts.map(a => {
    const vObj = vehicles.find(x => x.id === a.vehicle_id);
    return {
      id: a.id,
      type: a.type,
      severity: a.severity,
      vehicle: vObj ? vObj.number : 'Unknown',
      message: a.message,
      time: a.time ? new Date(a.time).toLocaleTimeString() : '1h ago',
      resolved: a.resolved
    };
  });

  const recentAlerts = mappedAlerts.filter((a) => !a.resolved).slice(0, 6);

  const kpiData = {
    totalVehicles: mappedVehicles.length,
    moving: mappedVehicles.filter(v => v.status === 'Moving').length,
    idle: mappedVehicles.filter(v => v.status === 'Idle').length,
    parked: mappedVehicles.filter(v => v.status === 'Parked').length,
    offline: mappedVehicles.filter(v => v.status === 'Offline').length,
    fuelAlerts: mappedAlerts.filter(a => a.type === 'Fuel' && !a.resolved).length,
    tempAlerts: mappedAlerts.filter(a => a.type === 'Temperature' && !a.resolved).length,
    maintenanceDue: maintenance.filter(m => m.status !== 'Completed').length,
  };

  const statusData = [
    { name: "Moving", value: kpiData.moving },
    { name: "Idle", value: kpiData.idle },
    { name: "Parked", value: kpiData.parked },
    { name: "Offline", value: kpiData.offline },
  ];

  return (
    <div>
      <PageHeader
        title="Fleet Operations Overview"
        subtitle={`Live data · ${now.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "medium" })}`}
        actions={
          <Link to="/tracking" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 text-sm font-medium hover:bg-primary/90">
            Open live tracking <ArrowUpRight className="h-4 w-4" />
          </Link>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-3">
        <Kpi label="Total Vehicles" value={kpiData.totalVehicles} icon={<Truck className="h-5 w-5" />} hint="Fleet size" />
        <Kpi label="Currently Moving" value={kpiData.moving} accent="success" icon={<Activity className="h-5 w-5" />} hint={`${kpiData.totalVehicles > 0 ? Math.round((kpiData.moving/kpiData.totalVehicles)*100) : 0}% of fleet`} />
        <Kpi label="Idle Vehicles" value={kpiData.idle} accent="warning" icon={<Pause className="h-5 w-5" />} hint="Engine on, no motion" />
        <Kpi label="Parked Vehicles" value={kpiData.parked} icon={<ParkingSquare className="h-5 w-5" />} hint="Engine off" />
        <Kpi label="Fuel Alerts" value={kpiData.fuelAlerts} accent="destructive" icon={<Fuel className="h-5 w-5" />} hint="Open issues" />
        <Kpi label="Temperature Alerts" value={kpiData.tempAlerts} accent="info" icon={<Thermometer className="h-5 w-5" />} hint="Cold-chain" />
        <Kpi label="Maintenance Due" value={kpiData.maintenanceDue} accent="warning" icon={<Wrench className="h-5 w-5" />} hint="Next 30 days" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-5">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Live Vehicle Map" subtitle={`Kanyakumari district · ${mappedVehicles.length} vehicles tracked`}
              action={<Link to="/tracking" className="text-xs font-medium text-primary hover:underline">View full map →</Link>} />
            <div className="p-3">
              <VehicleMap vehicles={mappedVehicles} height={420} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">

          <Card>
            <CardHeader title="Fleet Status" />
            <div className="p-3" style={{ height: 220 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {statusData.map((d) => <Cell key={d.name} fill={STATUS_COLORS[d.name]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <Card className="lg:col-span-2">
          <CardHeader title="Daily Fuel Consumption" subtitle="Litres consumed across the fleet" />
          <div className="p-3" style={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={fuelData}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                <XAxis dataKey="day" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Bar dataKey="consumed" fill="oklch(0.45 0.15 255)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Open Alerts" action={<Link to="/alerts" className="text-xs text-primary hover:underline">View all →</Link>} />
          <div className="divide-y divide-border max-h-[260px] overflow-y-auto">
            {recentAlerts.map((a) => (
              <div key={a.id} className="px-4 py-3 flex items-start gap-3">
                <Badge status={a.severity}>{a.severity}</Badge>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{a.message}</div>
                  <div className="text-xs text-muted-foreground">{a.vehicle} · {a.type} · {a.time}</div>
                </div>
              </div>
            ))}
            {recentAlerts.length === 0 && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No active alerts.
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Fuel Efficiency by Vehicle" subtitle="km/L · top 10 vehicles" />
        <div className="p-3" style={{ height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={eff}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
              <XAxis dataKey="vehicle" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Bar dataKey="kmpl" fill="oklch(0.62 0.18 150)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

export default DashboardPage;
