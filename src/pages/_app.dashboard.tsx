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
  KPI, VEHICLES, ALERTS, dailyFuel, fuelEfficiencyByVehicle,
} from "@/lib/mock-data";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";

const STATUS_COLORS: Record<string, string> = {
  Moving: "oklch(0.62 0.16 150)",
  Idle: "oklch(0.78 0.16 75)",
  Parked: "oklch(0.5 0.02 250)",
  Offline: "oklch(0.6 0.22 25)",
};

function DashboardPage() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const recentAlerts = ALERTS.filter((a) => !a.resolved).slice(0, 6);

  const statusData = [
    { name: "Moving", value: KPI.moving },
    { name: "Idle", value: KPI.idle },
    { name: "Parked", value: KPI.parked },
    { name: "Offline", value: KPI.offline },
  ];
  const fuelData = dailyFuel();
  const eff = fuelEfficiencyByVehicle();

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
        <Kpi label="Total Vehicles" value={KPI.totalVehicles} icon={<Truck className="h-5 w-5" />} hint="Fleet size" />
        <Kpi label="Currently Moving" value={KPI.moving} accent="success" icon={<Activity className="h-5 w-5" />} hint={`${Math.round((KPI.moving/KPI.totalVehicles)*100)}% of fleet`} />
        <Kpi label="Idle Vehicles" value={KPI.idle} accent="warning" icon={<Pause className="h-5 w-5" />} hint="Engine on, no motion" />
        <Kpi label="Parked Vehicles" value={KPI.parked} icon={<ParkingSquare className="h-5 w-5" />} hint="Engine off" />
        <Kpi label="Fuel Alerts" value={KPI.fuelAlerts} accent="destructive" icon={<Fuel className="h-5 w-5" />} hint="Open issues" />
        <Kpi label="Temperature Alerts" value={KPI.tempAlerts} accent="info" icon={<Thermometer className="h-5 w-5" />} hint="Cold-chain" />
        <Kpi label="Maintenance Due" value={KPI.maintenanceDue} accent="warning" icon={<Wrench className="h-5 w-5" />} hint="Next 30 days" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-5">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Live Vehicle Map" subtitle="Kanyakumari district · 40 vehicles tracked"
              action={<Link to="/tracking" className="text-xs font-medium text-primary hover:underline">View full map →</Link>} />
            <div className="p-3">
              <VehicleMap vehicles={VEHICLES} height={420} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-lg border border-info/40 bg-gradient-to-br from-info/5 to-primary/5 p-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="font-medium">AI Fleet Summary</div>
            </div>
            <p className="mt-3 text-sm leading-relaxed">
              <span className="font-semibold">3 vehicles</span> are consuming higher fuel than average.
              {" "}<span className="font-semibold">2 drivers</span> require safety improvement.
              All cold chain vehicles are within temperature limits.
            </p>
            <Link to="/ai" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Ask Nanjil AI <ArrowUpRight className="h-3 w-3" />
            </Link>
          </motion.div>

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
