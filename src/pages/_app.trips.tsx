import { useState, useEffect } from "react";
import { type Trip } from "@/lib/types";
import { PageHeader } from "@/components/AppLayout";
import { Card, Badge, Button } from "@/components/ui-kit";
import { DataTable } from "@/components/DataTable";
import { Play, X } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";

function TripsPage() {
  const [vehicle, setVehicle] = useState("All");
  const [date, setDate] = useState("");
  const [playback, setPlayback] = useState<Trip | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);

  async function load() {
    const [tRes, vRes, dRes] = await Promise.all([
      supabase.from('trips').select('*'),
      supabase.from('vehicles').select('*'),
      supabase.from('drivers').select('*')
    ]);

    if (vRes.data) {
      setVehicles(vRes.data);
    }

    if (tRes.data) {
      setTrips(tRes.data.map(t => {
        const vObj = vRes.data?.find(x => x.id === t.vehicle_id);
        const dObj = dRes.data?.find(x => x.id === t.driver_id);
        return {
          id: t.id,
          vehicle: vObj ? vObj.number : 'Unknown',
          driver: dObj ? dObj.name : 'Unassigned',
          date: t.date,
          start: t.start,
          destination: t.destination,
          distance: Number(t.distance || 0),
          duration: t.duration || 'N/A',
          status: t.status
        };
      }));
    }
  }

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled || !session) return;

      load();

      channel = supabase
        .channel('trips-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => { if (!cancelled) load(); })
        .subscribe();
    }

    init();

    return () => {
      cancelled = true;
      channel?.unsubscribe();
    };
  }, []);

  const data = trips.filter((t) => {
    if (vehicle !== "All" && t.vehicle !== vehicle) return false;
    if (date && t.date !== date) return false;
    return true;
  });

  return (
    <div>
      <PageHeader title="Trips & Routes" subtitle={`${trips.length} trips logged`} />

      <div className="flex flex-wrap gap-2 mb-3">
        <select value={vehicle} onChange={(e) => setVehicle(e.target.value)}
                className="h-9 px-3 rounded-md border border-border bg-card text-sm">
          <option value="All">All vehicles</option>
          {vehicles.map((v) => <option key={v.id} value={v.number}>{v.number}</option>)}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
               className="h-9 px-3 rounded-md border border-border bg-card text-sm" />
        {(vehicle !== "All" || date) && (
          <Button variant="ghost" size="sm" onClick={() => { setVehicle("All"); setDate(""); }}>Clear filters</Button>
        )}
      </div>

      <DataTable<Trip>
        data={data}
        searchKeys={["vehicle", "driver", "start", "destination"]}
        columns={[
          { key: "vehicle", label: "Vehicle" },
          { key: "driver", label: "Driver" },
          { key: "date", label: "Date" },
          { key: "start", label: "Start" },
          { key: "destination", label: "Destination" },
          { key: "distance", label: "Distance", render: (t) => `${t.distance} km` },
          { key: "duration", label: "Duration" },
          { key: "status", label: "Status", render: (t) => <Badge status={t.status}>{t.status}</Badge> },
          { key: "actions", label: "", render: (t) => (
            <button onClick={() => setPlayback(t)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <Play className="h-3 w-3" /> Playback
            </button>
          )},
        ]}
      />

      {playback && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPlayback(null)}>
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="bg-card rounded-lg shadow-xl max-w-2xl w-full p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-lg">Trip Playback</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{playback.vehicle} · {playback.date}</p>
              </div>
              <button onClick={() => setPlayback(null)} className="p-1 hover:bg-muted rounded"><X className="h-4 w-4" /></button>
            </div>

            <div className="mt-4 border border-border rounded-md bg-muted/40 p-3 text-sm space-y-2">
              <div className="flex justify-between border-b border-border/60 pb-1.5">
                <span className="text-muted-foreground font-medium">Route</span>
                <span className="font-semibold">{playback.start} → {playback.destination}</span>
              </div>
              <div className="flex justify-between border-b border-border/60 pb-1.5">
                <span className="text-muted-foreground font-medium">Driver</span>
                <span>{playback.driver}</span>
              </div>
              <div className="flex justify-between border-b border-border/60 pb-1.5">
                <span className="text-muted-foreground font-medium">Distance</span>
                <span>{playback.distance} km</span>
              </div>
              <div className="flex justify-between border-b border-border/60 pb-1.5">
                <span className="text-muted-foreground font-medium">Duration</span>
                <span>{playback.duration}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground font-medium">Status</span>
                <Badge status={playback.status}>{playback.status}</Badge>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setPlayback(null)}>Close</Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

export default TripsPage;
