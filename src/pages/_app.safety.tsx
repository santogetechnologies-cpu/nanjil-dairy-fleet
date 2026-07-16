import { useState, useEffect } from "react";
import { type Driver } from "@/lib/types";
import { PageHeader } from "@/components/AppLayout";
import { Kpi, Card, CardHeader, Badge } from "@/components/ui-kit";
import { ShieldCheck, AlertTriangle, TrendingUp, UsersRound } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { supabase } from "@/lib/supabase";

function Page() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [eventsChart, setEventsChart] = useState<{ name: string; value: number }[]>([]);
  const [radarData, setRadarData] = useState<{ metric: string; score: number }[]>([]);

  async function load() {
    // 1. Fetch safety ranking
    const { data: dData } = await supabase.from('v_driver_safety_ranking').select('*');
    
    let resolvedDrivers: Driver[] = [];
    if (dData) {
      resolvedDrivers = dData.map(d => ({
        id: d.id,
        name: d.name,
        vehicle: d.vehicle || 'Unknown',
        phone: '',
        license: '',
        score: d.score,
        events: d.events,
        rating: d.rating,
        trips: d.trips,
        totalKm: d.total_km
      }));
      setDrivers(resolvedDrivers);
    }

    // 2. Fetch safety alerts to calculate safety events chart
    const { data: aData } = await supabase
      .from('alerts')
      .select('message')
      .eq('type', 'Safety');

    const counts: Record<string, number> = {
      "Overspeed": 0,
      "Harsh Braking": 0,
      "Sudden Accel.": 0,
      "Sharp Turn": 0,
      "Rash Driving": 0
    };

    if (aData) {
      aData.forEach(a => {
        const msg = a.message.toLowerCase();
        if (msg.includes('speed') || msg.includes('overspeed')) counts["Overspeed"]++;
        else if (msg.includes('brake') || msg.includes('braking')) counts["Harsh Braking"]++;
        else if (msg.includes('acceleration') || msg.includes('accel')) counts["Sudden Accel."]++;
        else if (msg.includes('turn') || msg.includes('cornering')) counts["Sharp Turn"]++;
        else counts["Rash Driving"]++;
      });
    }
    setEventsChart(Object.keys(counts).map(name => ({ name, value: counts[name] })));

    // 3. Radar safety profile: compute per-dimension safety event counts from alerts
    // Each dimension is derived from real alert message keywords in the database
    const speedCount = aData ? aData.filter(a => /speed|overspeed/i.test(a.message)).length : 0;
    const brakeCount = aData ? aData.filter(a => /brake|braking/i.test(a.message)).length : 0;
    const accelCount = aData ? aData.filter(a => /accel/i.test(a.message)).length : 0;
    const turnCount  = aData ? aData.filter(a => /turn|corner/i.test(a.message)).length : 0;
    const rashCount  = aData ? aData.filter(a => !/speed|brake|accel|turn|corner/i.test(a.message)).length : 0;
    const totalEvents = speedCount + brakeCount + accelCount + turnCount + rashCount || 1;

    // Convert incident counts to a 0-100 safety score per dimension (fewer events = higher score)
    const toScore = (count: number) => Math.max(0, Math.round(100 - (count / totalEvents) * 100));

    setRadarData([
      { metric: "Speed Control", score: aData && aData.length > 0 ? toScore(speedCount) : 100 },
      { metric: "Smooth Braking", score: aData && aData.length > 0 ? toScore(brakeCount) : 100 },
      { metric: "Acceleration", score: aData && aData.length > 0 ? toScore(accelCount) : 100 },
      { metric: "Cornering", score: aData && aData.length > 0 ? toScore(turnCount) : 100 },
      { metric: "Safe Driving", score: aData && aData.length > 0 ? toScore(rashCount) : 100 },
    ]);
  }

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled || !session) return;

      load();

      channel = supabase
        .channel('safety-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => { if (!cancelled) load(); })
        .subscribe();
    }

    init();

    return () => {
      cancelled = true;
      channel?.unsubscribe();
    };
  }, []);

  const sorted = [...drivers].sort((a, b) => b.score - a.score);
  const topPerformer = sorted[0] || { name: "None", score: 0, vehicle: "N/A" };
  const needsImprovement = sorted.filter((d) => d.score < 80).length;
  const avgScore = drivers.length > 0 ? Math.round(drivers.reduce((s, d) => s + d.score, 0) / drivers.length) : 0;

  return (
    <div>
      <PageHeader title="Driver Safety" subtitle="Real-time scoring, events and ranking" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Average Safety Score" value={`${avgScore}%`} accent="success" icon={<ShieldCheck className="h-5 w-5" />} />
        <Kpi label="Top Performer" value={topPerformer.name} hint={`${topPerformer.score}% · ${topPerformer.vehicle}`} icon={<TrendingUp className="h-5 w-5" />} />
        <Kpi label="Needs Improvement" value={needsImprovement} accent="warning" icon={<AlertTriangle className="h-5 w-5" />} hint="Score < 80%" />
        <Kpi label="Total Drivers" value={drivers.length} icon={<UsersRound className="h-5 w-5" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card>
          <CardHeader title="Safety Events" subtitle="Aggregated from real-time vehicle alerts" />
          <div className="p-3" style={{ height: 280 }}>
            {eventsChart.some(item => item.value > 0) ? (
              <ResponsiveContainer>
                <BarChart data={eventsChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="value" fill="oklch(0.6 0.22 25)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No safety alerts registered in the system.
              </div>
            )}
          </div>
        </Card>
        
        <Card>
          <CardHeader title="Fleet Safety Profile" subtitle="Average safety dimension scores" />
          <div className="p-3" style={{ height: 280 }}>
            {drivers.length > 0 ? (
              <ResponsiveContainer>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="oklch(0.9 0.01 240)" />
                  <PolarAngleAxis dataKey="metric" fontSize={11} />
                  <Radar dataKey="score" stroke="oklch(0.45 0.15 255)" fill="oklch(0.45 0.15 255 / 0.3)" />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No driver safety profiles to compile.
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <DataTable<Driver>
          data={sorted}
          searchKeys={["name", "vehicle"]}
          columns={[
            { key: "name", label: "Driver" },
            { key: "vehicle", label: "Vehicle" },
            { key: "score", label: "Safety Score", render: (d) => (
              <div className="flex items-center gap-2">
                <span className="font-semibold">{d.score}%</span>
                <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full ${d.score >= 85 ? "bg-success" : d.score >= 75 ? "bg-warning" : "bg-destructive"}`} style={{ width: `${d.score}%` }} />
                </div>
              </div>
            )},
            { key: "events", label: "Safety Alerts", render: (d) => (
              <span className={`font-semibold ${d.events > 5 ? "text-destructive" : d.events > 2 ? "text-warning" : "text-muted-foreground"}`}>
                {d.events} alerts
              </span>
            )},
            { key: "rating", label: "Rating", render: (d) => <Badge status={d.rating}>{d.rating}</Badge> },
            { key: "trips", label: "Trips logged", render: (d) => `${d.trips} trips` },
            { key: "totalKm", label: "Total Distance", render: (d) => `${d.totalKm.toLocaleString()} km` },
          ]}
        />
      </div>
    </div>
  );
}

export default Page;
