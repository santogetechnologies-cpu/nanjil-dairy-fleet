import { useState, useEffect } from "react";
import { type Trip } from "@/lib/types";
import { PageHeader } from "@/components/AppLayout";
import { Card, CardHeader, Badge, Button } from "@/components/ui-kit";
import { DataTable } from "@/components/DataTable";
import { Play, X, Calendar, Route, Clipboard, Trash2, Plus, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

function TripsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"trips" | "schedules">("trips");
  
  // Existing state
  const [vehicle, setVehicle] = useState("All");
  const [date, setDate] = useState("");
  const [playback, setPlayback] = useState<any | null>(null);
  const [trips, setTrips] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  
  // Scheduling states
  const [schedules, setSchedules] = useState<any[]>([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [schedForm, setSchedForm] = useState({ driverId: "", vehicleId: "", date: "", shift: "Morning Shift" });
  const [savingSched, setSavingSched] = useState(false);

  // Dispatch states
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [dispForm, setDispForm] = useState({ driverId: "", vehicleId: "", routeId: "", routeName: "", start: "", destination: "" });
  const [savingDisp, setSavingDisp] = useState(false);

  const canManage = user?.role === "admin" || user?.role === "manager";

  async function load() {
    const [tRes, vRes, dRes, rRes, sRes] = await Promise.all([
      supabase.from('trips').select('*, vehicles(number), drivers(name)').order('date', { ascending: false }),
      supabase.from('vehicles').select('*'),
      supabase.from('drivers').select('*'),
      supabase.from('collection_routes').select('*'),
      supabase.from('driver_schedules').select('*, drivers(name), vehicles(number)').order('date', { ascending: false })
    ]);

    if (tRes.data) {
      setTrips(tRes.data.map(t => ({
        id: t.id,
        vehicle: t.vehicles?.number || 'Unknown',
        vehicleId: t.vehicle_id,
        driver: t.drivers?.name || 'Unassigned',
        driverId: t.driver_id,
        date: t.date,
        start: t.start,
        destination: t.destination,
        startKm: t.start_km,
        endKm: t.end_km,
        totalMilk: Number(t.total_milk_collected || 0),
        status: t.status
      })));
    }
    if (vRes.data) setVehicles(vRes.data);
    if (dRes.data) setDrivers(dRes.data);
    if (rRes.data) setRoutes(rRes.data);
    
    if (sRes.data) {
      setSchedules(sRes.data.map(s => ({
        id: s.id,
        date: s.date,
        driver: s.drivers?.name || 'Unassigned',
        vehicle: s.vehicles?.number || 'No Vehicle',
        shift: s.shift_type
      })));
    }
  }

  useEffect(() => {
    let cancelled = false;
    let channelTrips: ReturnType<typeof supabase.channel> | null = null;
    let channelSchedules: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled || !session) return;

      load();

      channelTrips = supabase
        .channel('trips-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => { if (!cancelled) load(); })
        .subscribe();

      channelSchedules = supabase
        .channel('schedules-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_schedules' }, () => { if (!cancelled) load(); })
        .subscribe();
    }

    init();

    return () => {
      cancelled = true;
      if (channelTrips) supabase.removeChannel(channelTrips);
      if (channelSchedules) supabase.removeChannel(channelSchedules);
    };
  }, []);

  async function handleCreateSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!schedForm.driverId || !schedForm.date || !schedForm.shift) return;
    setSavingSched(true);

    try {
      const { error } = await supabase
        .from('driver_schedules')
        .insert({
          driver_id: schedForm.driverId,
          vehicle_id: schedForm.vehicleId || null,
          date: schedForm.date,
          shift_type: schedForm.shift
        });

      if (error) throw error;
      setShowScheduleModal(false);
      setSchedForm({ driverId: "", vehicleId: "", date: "", shift: "Morning Shift" });
      load();
    } catch (err: any) {
      alert("Failed to create schedule: " + err.message);
    } finally {
      setSavingSched(false);
    }
  }

  async function handleDeleteSchedule(id: string) {
    if (!confirm("Are you sure you want to delete this schedule slot?")) return;

    try {
      const { error } = await supabase
        .from('driver_schedules')
        .delete()
        .eq('id', id);

      if (error) throw error;
      load();
    } catch (err: any) {
      alert("Failed to delete schedule: " + err.message);
    }
  }

  async function handleDispatchTrip(e: React.FormEvent) {
    e.preventDefault();
    if (!dispForm.driverId || !dispForm.vehicleId || !dispForm.routeName.trim() || !dispForm.start.trim() || !dispForm.destination.trim()) return;
    setSavingDisp(true);

    try {
      // Find starting odometer for the vehicle
      const vObj = vehicles.find(x => x.id === dispForm.vehicleId);
      const startingOdo = vObj ? (vObj.odometer || 0) : 0;
      
      const fullStart = `${dispForm.routeName.trim()} · ${dispForm.start.trim()}`;

      const { error } = await supabase
        .from('trips')
        .insert({
          vehicle_id: dispForm.vehicleId,
          driver_id: dispForm.driverId,
          route_id: null,
          date: new Date().toISOString().split('T')[0],
          start: fullStart,
          destination: dispForm.destination.trim(),
          start_km: startingOdo,
          status: 'Ongoing',
          distance: 0,
          duration: '0m'
        });

      if (error) throw error;
      setShowDispatchModal(false);
      setDispForm({ driverId: "", vehicleId: "", routeId: "", routeName: "", start: "", destination: "" });
      load();
    } catch (err: any) {
      alert("Failed to dispatch trip: " + err.message);
    } finally {
      setSavingDisp(false);
    }
  }

  const data = trips.filter((t) => {
    if (vehicle !== "All" && t.vehicle !== vehicle) return false;
    if (date && t.date !== date) return false;
    return true;
  });

  return (
    <div>
      <PageHeader 
        title={activeTab === "trips" ? "Trips & Dispatches" : "Driver Scheduling Calendar"} 
        subtitle={activeTab === "trips" ? `${trips.length} trips logged` : `${schedules.length} active shift schedule slots`} 
        actions={
          canManage && (
            <div className="flex gap-2">
              {activeTab === "trips" ? (
                <Button onClick={() => setShowDispatchModal(true)} className="flex items-center gap-1">
                  <Plus className="h-4 w-4" /> Dispatch Trip
                </Button>
              ) : (
                <Button onClick={() => setShowScheduleModal(true)} className="flex items-center gap-1">
                  <Plus className="h-4 w-4" /> Assign Schedule
                </Button>
              )}
            </div>
          )
        }
      />

      <div className="flex gap-4 border-b border-border mb-4">
        <button 
          onClick={() => setActiveTab("trips")} 
          className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "trips" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Trips & Dispatches
        </button>
        <button 
          onClick={() => setActiveTab("schedules")} 
          className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "schedules" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Driver Scheduling
        </button>
      </div>

      {activeTab === "trips" ? (
        <>
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

          <DataTable<any>
            data={data}
            searchKeys={["vehicle", "driver", "start", "destination"]}
            columns={[
              { key: "vehicle", label: "Vehicle" },
              { key: "driver", label: "Driver" },
              { key: "date", label: "Date" },
              { key: "start", label: "Route & From" },
              { key: "destination", label: "To" },
              { key: "startKm", label: "Start Odo", render: (t) => t.startKm !== null ? `${t.startKm} km` : '—' },
              { key: "endKm", label: "End Odo", render: (t) => t.endKm !== null ? `${t.endKm} km` : '—' },
              { key: "status", label: "Status", render: (t) => <Badge status={t.status}>{t.status}</Badge> },
              { key: "actions", label: "", render: (t) => (
                <button onClick={() => setPlayback(t)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  <Play className="h-3 w-3" /> Details
                </button>
              )},
            ]}
          />
        </>
      ) : (
        <DataTable<any>
          data={schedules}
          searchKeys={["driver", "vehicle", "shift"]}
          columns={[
            { key: "date", label: "Date" },
            { key: "driver", label: "Driver" },
            { key: "vehicle", label: "Vehicle" },
            { key: "shift", label: "Shift Type" },
            { key: "actions", label: "", render: (s) => (
              canManage && (
                <Button 
                  size="xs" 
                  variant="destructive" 
                  onClick={() => handleDeleteSchedule(s.id)}
                  className="p-1.5 rounded-full"
                  title="Delete schedule"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )
            )},
          ]}
        />
      )}

      {/* Dispatch Trip Modal */}
      {showDispatchModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader title="Dispatch Manual Trip" subtitle="Assign route and driver to start trip logs" />
            <form onSubmit={handleDispatchTrip} className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Select Vehicle *</label>
                <select 
                  className="w-full p-2 border border-border bg-card rounded-md text-sm"
                  value={dispForm.vehicleId}
                  onChange={(e) => setDispForm({ ...dispForm, vehicleId: e.target.value })}
                  required
                >
                  <option value="">Choose vehicle...</option>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.number}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Select Driver *</label>
                <select 
                  className="w-full p-2 border border-border bg-card rounded-md text-sm"
                  value={dispForm.driverId}
                  onChange={(e) => setDispForm({ ...dispForm, driverId: e.target.value })}
                  required
                >
                  <option value="">Choose driver...</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Route Name *</label>
                <input 
                  type="text" 
                  className="w-full p-2 border border-border bg-transparent rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={dispForm.routeName}
                  onChange={(e) => setDispForm({ ...dispForm, routeName: e.target.value })}
                  placeholder="e.g. Route 1"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">From *</label>
                  <input 
                    type="text" 
                    className="w-full p-2 border border-border bg-transparent rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    value={dispForm.start}
                    onChange={(e) => setDispForm({ ...dispForm, start: e.target.value })}
                    placeholder="e.g. Main Yard"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">To *</label>
                  <input 
                    type="text" 
                    className="w-full p-2 border border-border bg-transparent rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    value={dispForm.destination}
                    onChange={(e) => setDispForm({ ...dispForm, destination: e.target.value })}
                    placeholder="e.g. Center Point"
                    required
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" onClick={() => { setShowDispatchModal(false); setDispForm({ driverId: "", vehicleId: "", routeId: "", start: "", destination: "" }); }} className="flex-1">Cancel</Button>
                <Button type="submit" className="flex-1" disabled={savingDisp}>
                  {savingDisp ? <Loader2 className="animate-spin h-4 w-4" /> : "Dispatch"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Assign Schedule Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader title="Create Shift Schedule" subtitle="Assign duty shift calendar slot to driver" />
            <form onSubmit={handleCreateSchedule} className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Select Driver *</label>
                <select 
                  className="w-full p-2 border border-border bg-card rounded-md text-sm"
                  value={schedForm.driverId}
                  onChange={(e) => setSchedForm({ ...schedForm, driverId: e.target.value })}
                  required
                >
                  <option value="">Choose driver...</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Select Vehicle (Optional)</label>
                <select 
                  className="w-full p-2 border border-border bg-card rounded-md text-sm"
                  value={schedForm.vehicleId}
                  onChange={(e) => setSchedForm({ ...schedForm, vehicleId: e.target.value })}
                >
                  <option value="">No Vehicle Assigned</option>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.number}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Duty Date *</label>
                  <input 
                    type="date" 
                    className="w-full p-2 border border-border bg-transparent rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    value={schedForm.date}
                    onChange={(e) => setSchedForm({ ...schedForm, date: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Shift Type *</label>
                  <select 
                    className="w-full p-2 border border-border bg-card rounded-md text-sm"
                    value={schedForm.shift}
                    onChange={(e) => setSchedForm({ ...schedForm, shift: e.target.value })}
                    required
                  >
                    <option value="Morning Shift">Morning Shift</option>
                    <option value="Evening Shift">Evening Shift</option>
                    <option value="Night Shift">Night Shift</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" onClick={() => { setShowScheduleModal(false); setSchedForm({ driverId: "", vehicleId: "", date: "", shift: "Morning Shift" }); }} className="flex-1">Cancel</Button>
                <Button type="submit" className="flex-1" disabled={savingSched}>
                  {savingSched ? <Loader2 className="animate-spin h-4 w-4" /> : "Save Shift"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {playback && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPlayback(null)}>
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="bg-card rounded-lg shadow-xl max-w-2xl w-full p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-lg">Trip Dispatch Details</h3>
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
                <span className="text-muted-foreground font-medium">Starting Odometer</span>
                <span>{playback.startKm !== null ? `${playback.startKm} km` : '—'}</span>
              </div>
              <div className="flex justify-between border-b border-border/60 pb-1.5">
                <span className="text-muted-foreground font-medium">Ending Odometer</span>
                <span>{playback.endKm !== null ? `${playback.endKm} km` : '—'}</span>
              </div>
               <div className="flex justify-between border-b border-border/60 pb-1.5">
                <span className="text-muted-foreground font-medium">Distance Traveled</span>
                <span>{playback.startKm !== null && playback.endKm !== null ? `${playback.endKm - playback.startKm} km` : `${playback.distance} km`}</span>
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
