
import { useState, useEffect } from "react";
import { type Trip } from "@/lib/mock-data";
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

  useEffect(() => {
    async function load() {
      const [tRes, vRes] = await Promise.all([
        supabase.from('trips').select('*'),
        supabase.from('vehicles').select('*')
      ]);

      if (vRes.data) {
        setVehicles(vRes.data);
      }

      if (tRes.data) {
        setTrips(tRes.data.map(t => {
          const vObj = vRes.data?.find(x => x.id === t.vehicle_id);
          const dName = t.driver_id ? 'Driver' : ''; // fallback
          return {
            id: t.id,
            vehicle: vObj ? vObj.number : 'Unknown',
            driver: t.driver_id ? 'Assigned Driver' : 'No Driver', // will be resolved or mock
            date: t.date,
            start: t.start,
            destination: t.destination,
            distance: Number(t.distance),
            duration: t.duration,
            status: t.status
          };
        }));
      }
    }
    load();
  }, []);

  const data = trips.filter((t) => {
    if (vehicle !== "All" && t.vehicle !== vehicle) return false;
    if (date && t.date !== date) return false;
    return true;
  });

  return (
    <div>
      <PageHeader title="Trips & Routes" subtitle={`${trips.length} trips logged · last 19 days`} />

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
                <div className="font-semibold">Route Playback · {playback.vehicle}</div>
                <div className="text-xs text-muted-foreground">{playback.start} → {playback.destination} · {playback.date}</div>
              </div>
              <button onClick={() => setPlayback(null)} className="p-1 hover:bg-muted rounded"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 h-2 bg-muted rounded-full overflow-hidden">
              <motion.div className="h-full bg-primary" initial={{ width: 0 }} animate={{ width: "100%" }}
                transition={{ duration: 6, ease: "linear" }} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div><div className="text-xs text-muted-foreground">Distance</div><div className="font-medium">{playback.distance} km</div></div>
              <div><div className="text-xs text-muted-foreground">Duration</div><div className="font-medium">{playback.duration}</div></div>
              <div><div className="text-xs text-muted-foreground">Driver</div><div className="font-medium">{playback.driver}</div></div>
            </div>
            <div className="mt-4 text-xs text-muted-foreground">Animating route playback at 6× speed…</div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

export default TripsPage;
