
import { useState, useEffect } from "react";
import { DRIVERS, type Driver } from "@/lib/mock-data";
import { PageHeader } from "@/components/AppLayout";
import { Kpi, Card, CardHeader, Badge } from "@/components/ui-kit";
import { ShieldCheck, AlertTriangle, TrendingUp, UsersRound } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { supabase } from "@/lib/supabase";

const eventTypes = [
  { name: "Overspeed", value: 42 },
  { name: "Harsh Braking", value: 31 },
  { name: "Sudden Accel.", value: 19 },
  { name: "Sharp Turn", value: 12 },
  { name: "Rash Driving", value: 7 },
];

function Page() {
  const [drivers, setDrivers] = useState<Driver[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('v_driver_safety_ranking').select('*');
      if (data) {
        setDrivers(data.map(d => ({
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
        })));
      }
    }
    load();
  }, []);

  const displayDrivers = drivers.length > 0 ? drivers : DRIVERS;
  const sorted = [...displayDrivers].sort((a, b) => b.score - a.score);
  const topPerformer = sorted[0] || { name: "None", score: 0, vehicle: "N/A" };
  const needsImprovement = sorted.filter((d) => d.score < 80).length;
  const avgScore = displayDrivers.length > 0 ? Math.round(displayDrivers.reduce((s, d) => s + d.score, 0) / displayDrivers.length) : 86;

  const radar = [
    { metric: "Speed", score: 88 },
    { metric: "Braking", score: 78 },
    { metric: "Acceleration", score: 84 },
    { metric: "Cornering", score: 91 },
    { metric: "Idling", score: 82 },
  ];

  return (
    <div>
      <PageHeader title="Driver Safety" subtitle="Real-time scoring, events and ranking" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Average Safety Score" value={`${avgScore}%`} accent="success" icon={<ShieldCheck className="h-5 w-5" />} />
        <Kpi label="Top Performer" value={topPerformer.name} hint={`${topPerformer.score}% · ${topPerformer.vehicle}`} icon={<TrendingUp className="h-5 w-5" />} />
        <Kpi label="Needs Improvement" value={needsImprovement} accent="warning" icon={<AlertTriangle className="h-5 w-5" />} hint="Score < 80%" />
        <Kpi label="Total Drivers" value={displayDrivers.length} icon={<UsersRound className="h-5 w-5" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card>
          <CardHeader title="Safety Events This Week" subtitle="Across all drivers" />
          <div className="p-3" style={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={eventTypes}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Bar dataKey="value" fill="oklch(0.6 0.22 25)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHeader title="Fleet Safety Profile" subtitle="Average across all metrics" />
          <div className="p-3" style={{ height: 280 }}>
            <ResponsiveContainer>
              <RadarChart data={radar}>
                <PolarGrid stroke="oklch(0.9 0.01 240)" />
                <PolarAngleAxis dataKey="metric" fontSize={11} />
                <Radar dataKey="score" stroke="oklch(0.45 0.15 255)" fill="oklch(0.45 0.15 255 / 0.3)" />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <DataTable<Driver>
          data={sorted}
          searchKeys={["name", "vehicle"]}
          columns={[
            { key: "rank", label: "#", render: (_d) => <span className="text-muted-foreground">{sorted.indexOf(_d) + 1}</span> },
            { key: "name", label: "Driver" },
            { key: "vehicle", label: "Vehicle" },
            { key: "score", label: "Score", render: (d) => (
              <div className="flex items-center gap-2 min-w-[120px]">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full ${d.score >= 90 ? "bg-success" : d.score >= 80 ? "bg-info" : d.score >= 75 ? "bg-warning" : "bg-destructive"}`} style={{ width: `${d.score}%` }} />
                </div>
                <span className="font-medium text-sm w-10 text-right">{d.score}%</span>
              </div>
            )},
            { key: "events", label: "Events", render: (d) => `${d.events}` },
            { key: "trips", label: "Trips" },
            { key: "totalKm", label: "Distance", render: (d) => `${d.totalKm.toLocaleString()} km` },
            { key: "rating", label: "Rating", render: (d) => <Badge status={d.rating}>{d.rating}</Badge> },
          ]}
        />
      </div>
    </div>
  );
}

export default Page;
