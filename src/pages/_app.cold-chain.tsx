import { useState, useEffect } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Kpi, Card, CardHeader, Badge } from "@/components/ui-kit";
import { Thermometer, ShieldAlert, CheckCircle2, AlertCircle } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceArea } from "recharts";
import { supabase } from "@/lib/supabase";

function Page() {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [tempRange, setTempRange] = useState<Record<string, { min: number; max: number }>>({});

  async function load() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [vRes, aRes, histRes, rangeRes] = await Promise.all([
      supabase.from('v_vehicles').select('*'),
      supabase.from('alerts').select('*'),
      supabase.from('telemetry_history').select('recorded_at, temperature').order('recorded_at', { ascending: true }).limit(50),
      supabase.from('telemetry_history').select('vehicle_id, temperature').gte('recorded_at', since24h)
    ]);

    if (vRes.data) setVehicles(vRes.data);
    if (aRes.data) setAlerts(aRes.data);
    if (histRes.data) {
      setHistory(histRes.data.map(h => ({
        t: new Date(h.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        temp: Number(h.temperature || 0)
      })));
    }
    if (rangeRes.data) {
      const map: Record<string, { min: number; max: number }> = {};
      rangeRes.data.forEach(r => {
        const t = Number(r.temperature);
        if (!map[r.vehicle_id]) map[r.vehicle_id] = { min: t, max: t };
        else {
          if (t < map[r.vehicle_id].min) map[r.vehicle_id].min = t;
          if (t > map[r.vehicle_id].max) map[r.vehicle_id].max = t;
        }
      });
      setTempRange(map);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      if (cancelled) return;
      load();
      channel = supabase
        .channel('coldchain-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'telemetry_history' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => { if (!cancelled) load(); })
        .subscribe();
    }

    init();
    return () => { cancelled = true; channel?.unsubscribe(); };
  }, []);

  const displayVehicles = vehicles.map(v => ({
    id: v.id,
    number: v.number,
    route: v.route || '',
    temperature: Number(v.temperature || 0),
  }));

  const tempAlerts = alerts.filter((a) => a.type === "Temperature");
  const compliant = displayVehicles.filter((v) => v.temperature >= 2 && v.temperature <= 6).length;
  const outOfRange = displayVehicles.filter((v) => v.temperature !== 0 && (v.temperature < 2 || v.temperature > 6)).length;
  const compliance = displayVehicles.length > 0 ? Math.round((compliant / displayVehicles.length) * 100) : 0;
  const avgTemp = displayVehicles.length > 0
    ? (displayVehicles.reduce((s, v) => s + v.temperature, 0) / displayVehicles.length).toFixed(1)
    : '—';

  return (
    <div>
      <PageHeader title="Cold Chain Monitoring" subtitle={`Temperature compliance · target 2°C – 6°C · ${displayVehicles.length} cold chain vehicles`} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Compliance Rate" value={`${compliance}%`} accent="success" icon={<CheckCircle2 className="h-5 w-5" />} hint={`${compliant}/${displayVehicles.length} within 2–6°C`} />
        <Kpi label="Average Temperature" value={avgTemp !== '—' ? `${avgTemp}°C` : '—'} icon={<Thermometer className="h-5 w-5" />} hint="Across all vehicles" />
        <Kpi label="Vehicles In Range" value={compliant} accent="info" icon={<CheckCircle2 className="h-5 w-5" />} hint="Between 2°C and 6°C" />
        <Kpi label="Temp Alerts" value={tempAlerts.filter((a) => !a.resolved).length} accent="destructive" icon={<ShieldAlert className="h-5 w-5" />} hint={`${tempAlerts.length} total alerts`} />
      </div>

      {outOfRange > 0 && (
        <div className="mt-3 flex items-start gap-2 px-4 py-3 rounded-xl border border-destructive/30 bg-destructive/5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span><strong>{outOfRange} vehicle{outOfRange > 1 ? 's' : ''}</strong> out of target temperature range (2°C – 6°C). Check storage conditions immediately.</span>
        </div>
      )}

      <Card className="mt-4">
        <CardHeader title="Fleet Temperature History (24h)" subtitle="Green band shows compliance window 2°C – 6°C" />
        <div className="p-3" style={{ height: 280 }}>
          {history.length > 0 ? (
            <ResponsiveContainer>
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                <XAxis dataKey="t" fontSize={11} />
                <YAxis domain={[0, 10]} fontSize={11} tickFormatter={(v) => `${v}°C`} />
                <Tooltip formatter={(v) => [`${v}°C`, 'Temp']} />
                <ReferenceArea y1={2} y2={6} fill="oklch(0.62 0.18 150 / 0.15)" label={{ value: 'Safe Zone', position: 'insideRight', fontSize: 10, fill: 'oklch(0.48 0.16 155)' }} />
                <Line type="monotone" dataKey="temp" stroke="oklch(0.6 0.22 25)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
              <Thermometer className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No temperature history recorded yet.</p>
              <p className="text-xs text-muted-foreground/60">Temperature logs appear here once vehicles report readings.</p>
            </div>
          )}
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Vehicle Temperature Log" subtitle="Current temperature readings per vehicle" />
        <DataTable
          data={displayVehicles.map((v) => ({
            number: v.number,
            route: v.route || 'Unassigned',
            temperature: v.temperature,
            min: tempRange[v.id]?.min?.toFixed(1) ?? '—',
            max: tempRange[v.id]?.max?.toFixed(1) ?? '—',
            compliance: v.temperature >= 2 && v.temperature <= 6 ? "Compliant" : v.temperature === 0 ? "No Data" : "Violation",
          }))}
          searchKeys={["number", "route"]}
          columns={[
            { key: "number", label: "Vehicle" },
            { key: "route", label: "Route" },
            { key: "temperature", label: "Temperature", render: (r: any) => `${r.temperature}°C` },
            { key: "min", label: "Min (24h)", render: (r: any) => r.min !== '—' ? `${r.min}°C` : '—' },
            { key: "max", label: "Max (24h)", render: (r: any) => r.max !== '—' ? `${r.max}°C` : '—' },
            {
              key: "compliance", label: "Status", render: (r: any) => (
                <Badge status={r.compliance === "Compliant" ? "Moving" : r.compliance === "No Data" ? "Parked" : "Offline"}>
                  {r.compliance}
                </Badge>
              )
            },
          ]}
        />
      </Card>
    </div>
  );
}

export default Page;
