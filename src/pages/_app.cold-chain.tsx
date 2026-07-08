
import { useState, useEffect } from "react";
import { tempHistory } from "@/lib/mock-data";
import { PageHeader } from "@/components/AppLayout";
import { Kpi, Card, CardHeader, Badge } from "@/components/ui-kit";
import { Thermometer, Droplets, ShieldAlert, CheckCircle2 } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceArea } from "recharts";
import { supabase } from "@/lib/supabase";

function Page() {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const [vRes, aRes] = await Promise.all([
        supabase.from('v_vehicles').select('*'),
        supabase.from('alerts').select('*')
      ]);

      if (vRes.data) setVehicles(vRes.data);
      if (aRes.data) setAlerts(aRes.data);
    }
    load();
  }, []);

  const tempAlerts = alerts.filter((a) => a.type === "Temperature");
  const compliant = vehicles.filter((v) => Number(v.temperature || 0) >= 2 && Number(v.temperature || 0) <= 6).length;
  const compliance = vehicles.length > 0 ? Math.round((compliant / vehicles.length) * 100) : 96;

  return (
    <div>
      <PageHeader title="Cold Chain Monitoring" subtitle="Temperature, humidity and compliance for milk transport (target 2°C – 6°C)" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Compliance Rate" value={`${compliance}%`} accent="success" icon={<CheckCircle2 className="h-5 w-5" />} hint={`${compliant}/${vehicles.length || 1} within range`} />
        <Kpi label="Average Temperature" value={`${(vehicles.reduce((s, v) => s + Number(v.temperature || 0), 0) / (vehicles.length || 1)).toFixed(1)}°C`} icon={<Thermometer className="h-5 w-5" />} hint="Across the fleet" />
        <Kpi label="Average Humidity" value={`${Math.round(vehicles.reduce((s, v) => s + (v.humidity || 0), 0) / (vehicles.length || 1))}%`} accent="info" icon={<Droplets className="h-5 w-5" />} />
        <Kpi label="Temp Alerts" value={tempAlerts.filter((a) => !a.resolved).length} accent="destructive" icon={<ShieldAlert className="h-5 w-5" />} hint={`${tempAlerts.length} total`} />
      </div>

      <Card className="mt-4">
        <CardHeader title="Average Fleet Temperature · 24h" subtitle="Green band shows compliance window 2°C – 6°C" />
        <div className="p-3" style={{ height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={tempHistory()}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
              <XAxis dataKey="t" fontSize={11} />
              <YAxis domain={[0, 10]} fontSize={11} />
              <Tooltip />
              <ReferenceArea y1={2} y2={6} fill="oklch(0.62 0.18 150 / 0.15)" />
              <Line type="monotone" dataKey="temp" stroke="oklch(0.6 0.22 25)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Vehicle Sensor Readings" />
        <DataTable
          data={vehicles.map((v) => ({
            number: v.number,
            route: v.route || '',
            temperature: Number(v.temperature || 0),
            humidity: v.humidity || 0,
            min: +(Number(v.temperature || 0) - 1).toFixed(1),
            max: +(Number(v.temperature || 0) + 1.5).toFixed(1),
            compliance: Number(v.temperature || 0) >= 2 && Number(v.temperature || 0) <= 6 ? "Compliant" : "Violation",
          }))}
          searchKeys={["number", "route"]}
          columns={[
            { key: "number", label: "Vehicle" },
            { key: "route", label: "Route" },
            { key: "temperature", label: "Temp", render: (r: any) => `${r.temperature}°C` },
            { key: "min", label: "Min", render: (r: any) => `${r.min}°C` },
            { key: "max", label: "Max", render: (r: any) => `${r.max}°C` },
            { key: "humidity", label: "Humidity", render: (r: any) => `${r.humidity}%` },
            { key: "compliance", label: "Status", render: (r: any) => (
              <Badge status={r.compliance === "Compliant" ? "Moving" : "Offline"}>{r.compliance}</Badge>
            )},
          ]}
        />
      </Card>
    </div>
  );
}

export default Page;
