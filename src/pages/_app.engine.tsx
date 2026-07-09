import { useState, useEffect } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Kpi, Card, CardHeader, Badge } from "@/components/ui-kit";
import { Cog, Power, Clock, AlertTriangle } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/lib/supabase";

function Page() {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);

  async function load() {
    const [vRes, aRes] = await Promise.all([
      supabase.from('v_vehicles').select('*'),
      supabase.from('alerts').select('*')
    ]);
    if (vRes.data) {
      setVehicles(vRes.data);
    }
    if (aRes.data) {
      setAlerts(aRes.data);
    }
  }

  useEffect(() => {
    load();

    // Subscribe to telemetry changes for real-time engine statistics
    const channel = supabase
      .channel('engine-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_telemetry' }, () => { load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => { load(); })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, []);

  const displayVehicles = vehicles.map(v => ({
    number: v.number,
    driver_name: v.driver_name,
    engine_on: v.engine_on,
    ignition: v.ignition,
    engine_hours: Number(v.engine_hours || 0),
    status: v.status,
    odometer: v.odometer || 0
  }));

  const running = displayVehicles.filter((v) => v.engine_on).length;
  const idle = displayVehicles.filter((v) => v.status === "Idle").length;
  const totalHours = displayVehicles.reduce((s, v) => s + v.engine_hours, 0);
  const abnormal = alerts.filter(a => a.type === 'Vehicle' && !a.resolved).length;

  return (
    <div>
      <PageHeader title="Engine & Ignition Monitoring" subtitle={`Engine diagnostics · ${displayVehicles.length} vehicles`} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Engines Running" value={running} accent="success" icon={<Cog className="h-5 w-5" />} hint={`${displayVehicles.length - running} off`} />
        <Kpi label="Idle Vehicles" value={idle} accent="warning" icon={<Power className="h-5 w-5" />} hint="Engine on, no motion" />
        <Kpi label="Total Engine Hours" value={`${(totalHours / 1000).toFixed(1)}k`} icon={<Clock className="h-5 w-5" />} hint="Lifetime" />
        <Kpi label="Abnormal Activity" value={abnormal} accent="destructive" icon={<AlertTriangle className="h-5 w-5" />} hint="Open alerts" />
      </div>

      <Card className="mt-4">
        <CardHeader title="Engine & Ignition Status" />
        <DataTable
          data={displayVehicles.map((v) => ({
            number: v.number,
            driver: v.driver_name || 'Unassigned',
            engine: v.engine_on ? "ON" : "OFF",
            ignition: v.ignition ? "ON" : "OFF",
            hours: v.engine_hours,
            power: v.status === "Offline" ? "Low" : "OK",
          }))}
          searchKeys={["number", "driver"]}
          columns={[
            { key: "number", label: "Vehicle" },
            { key: "driver", label: "Driver" },
            { key: "engine", label: "Engine", render: (r: any) => <Badge status={r.engine === "ON" ? "Moving" : "Parked"}>{r.engine}</Badge> },
            { key: "ignition", label: "Ignition", render: (r: any) => <Badge status={r.ignition === "ON" ? "Moving" : "Parked"}>{r.ignition}</Badge> },
            { key: "hours", label: "Total Engine Hours", render: (r: any) => `${r.hours.toLocaleString()} h` },
            { key: "power", label: "Power State", render: (r: any) => <Badge status={r.power === "Low" ? "High" : "Low"}>{r.power}</Badge> },
          ]}
        />
      </Card>
    </div>
  );
}

export default Page;
