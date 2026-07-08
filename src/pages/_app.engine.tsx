
import { useState, useEffect } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Kpi, Card, CardHeader, Badge } from "@/components/ui-kit";
import { Cog, Power, Clock, AlertTriangle } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/lib/supabase";

function Page() {
  const [vehicles, setVehicles] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('v_vehicles').select('*');
      if (data) {
        setVehicles(data);
      }
    }
    load();
  }, []);

  const running = vehicles.filter((v) => v.engine_on).length;
  const idle = vehicles.filter((v) => v.status === "Idle").length;
  const totalHours = vehicles.reduce((s, v) => s + Number(v.engine_hours || 0), 0);
  const abnormal = 4;

  return (
    <div>
      <PageHeader title="Engine & Ignition Monitoring" subtitle="Engine status, ignition and operating hours" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Engines Running" value={running} accent="success" icon={<Cog className="h-5 w-5" />} hint={`${vehicles.length - running} off`} />
        <Kpi label="Idle Vehicles" value={idle} accent="warning" icon={<Power className="h-5 w-5" />} hint="Engine on, no motion" />
        <Kpi label="Total Engine Hours" value={`${(totalHours / 1000).toFixed(1)}k`} icon={<Clock className="h-5 w-5" />} hint="Lifetime" />
        <Kpi label="Abnormal Activity" value={abnormal} accent="destructive" icon={<AlertTriangle className="h-5 w-5" />} hint="Last 24h" />
      </div>

      <Card className="mt-4">
        <CardHeader title="Engine & Ignition Status" />
        <DataTable
          data={vehicles.map((v) => ({
            number: v.number,
            driver: v.driver_name || 'Driver',
            engine: v.engine_on ? "ON" : "OFF",
            ignition: v.ignition ? "ON" : "OFF",
            hours: Number(v.engine_hours || 0),
            usage: `${Math.round(60 + Math.random() * 220)} min today`,
            power: v.status === "Offline" ? "Low" : "OK",
          }))}
          searchKeys={["number", "driver"]}
          columns={[
            { key: "number", label: "Vehicle" },
            { key: "driver", label: "Driver" },
            { key: "engine", label: "Engine", render: (r: any) => <Badge status={r.engine === "ON" ? "Moving" : "Parked"}>{r.engine}</Badge> },
            { key: "ignition", label: "Ignition", render: (r: any) => <Badge status={r.ignition === "ON" ? "Moving" : "Parked"}>{r.ignition}</Badge> },
            { key: "hours", label: "Total Hours", render: (r: any) => `${r.hours.toLocaleString()} h` },
            { key: "usage", label: "Usage Today" },
            { key: "power", label: "Power", render: (r: any) => <Badge status={r.power === "Low" ? "High" : "Low"}>{r.power}</Badge> },
          ]}
        />
      </Card>
    </div>
  );
}

export default Page;
