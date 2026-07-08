
import { Kpi, Card, CardHeader, Badge } from "@/components/ui-kit";
import { PageHeader } from "@/components/AppLayout";
import { dailyFuel, fuelEfficiencyByVehicle } from "@/lib/mock-data";
import { Fuel, TrendingDown, Gauge, AlertTriangle, Sparkles } from "lucide-react";
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
  const [trend, setTrend] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const [vRes, aRes, effRes, trendRes] = await Promise.all([
        supabase.from('v_vehicles').select('*'),
        supabase.from('alerts').select('*'),
        supabase.from('v_fuel_efficiency_by_vehicle').select('*').limit(10),
        supabase.from('v_daily_fuel_fleet').select('*')
      ]);

      if (vRes.data) setVehicles(vRes.data);
      if (aRes.data) setAlerts(aRes.data);
      if (effRes.data && effRes.data.length > 0) {
        setEff(effRes.data.map(e => ({ vehicle: e.number.split("-").slice(0, 2).join("-"), kmpl: Number(e.kmpl) })));
      }
      if (trendRes.data && trendRes.data.length > 0) {
        setTrend(trendRes.data.map(f => ({
          day: f.log_date,
          consumed: Number(f.total_consumed_l),
          mileage: Number(f.avg_mileage_kmpl)
        })));
      }
    }
    load();
  }, []);

  const fuelAlerts = alerts.filter((a) => a.type === "Fuel");
  const totalConsumed = trend.reduce((s, t) => s + (t.consumed || 0), 0) || 4280;
  const avgKmpl = eff.reduce((s, e) => s + (e.kmpl || 0), 0) / (eff.length || 1) || 4.8;

  const efficiency = eff.length > 0 ? eff : fuelEfficiencyByVehicle();
  const finalTrend = trend.length > 0 ? trend : dailyFuel().map((d) => ({ ...d, mileage: +(3 + Math.random() * 3).toFixed(2) }));

  return (
    <div>
      <PageHeader title="Fuel Intelligence" subtitle="Live consumption, efficiency and theft detection" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total Fuel Consumed" value={`${totalConsumed.toLocaleString()} L`} hint="This week" icon={<Fuel className="h-5 w-5" />} />
        <Kpi label="Average Mileage" value={`${avgKmpl} km/L`} accent="success" icon={<Gauge className="h-5 w-5" />} hint="Fleet average" />
        <Kpi label="Efficiency Index" value="86%" accent="info" icon={<TrendingDown className="h-5 w-5" />} hint="vs target 90%" />
        <Kpi label="Open Fuel Alerts" value={fuelAlerts.filter((a) => !a.resolved).length} accent="destructive" icon={<AlertTriangle className="h-5 w-5" />} hint={`${fuelAlerts.length} total`} />
      </div>

      <div className="rounded-lg border border-info/40 bg-gradient-to-br from-info/5 to-primary/5 p-4 mt-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center"><Sparkles className="h-4 w-4" /></div>
          <div className="font-medium">AI Fuel Analysis</div>
        </div>
        <p className="text-sm mt-2 leading-relaxed">
          Vehicle <span className="font-semibold">TN-01-AC-1037</span> consumed <span className="font-semibold">15% more fuel</span> compared with similar routes.
          Drivers <span className="font-semibold">Suresh Babu</span> and <span className="font-semibold">Vijay Anand</span> show consistent over-revving patterns. Estimated saving if corrected: ₹ 18,400/month.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card>
          <CardHeader title="Daily Consumption" subtitle="Litres consumed across the fleet" />
          <div className="p-3" style={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={finalTrend}>
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
          <CardHeader title="Fleet Mileage Trend" subtitle="km/L weekly" />
          <div className="p-3" style={{ height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={finalTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                <XAxis dataKey="day" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="mileage" stroke="oklch(0.62 0.18 150)" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Vehicle Comparison" subtitle="Fuel efficiency km/L" />
        <div className="p-3" style={{ height: 300 }}>
          <ResponsiveContainer>
            <BarChart data={efficiency} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
              <XAxis type="number" fontSize={12} />
              <YAxis dataKey="vehicle" type="category" fontSize={12} width={80} />
              <Tooltip />
              <Bar dataKey="kmpl" fill="oklch(0.45 0.15 255)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="mt-4">
        <DataTable
          data={vehicles.slice(0, 20).map((v) => ({
            number: v.number,
            driver: v.driver_name || 'Driver',
            fuel: v.fuel || 0,
            consumed: Math.round(40 + Math.random() * 80),
            mileage: +(3 + Math.random() * 3).toFixed(2),
            status: v.fuel < 25 ? "Low Fuel" : v.fuel < 50 ? "Half Tank" : "OK",
          }))}
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
            { key: "consumed", label: "Consumed Today", render: (r: any) => `${r.consumed} L` },
            { key: "mileage", label: "Mileage", render: (r: any) => `${r.mileage} km/L` },
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
