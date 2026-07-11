import { Link, useParams } from "react-router-dom";
import { Card, CardHeader, Badge, Button } from "@/components/ui-kit";
import { PageHeader } from "@/components/AppLayout";
import { VehicleMap } from "@/components/VehicleMap";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  ChevronLeft, Fuel, Thermometer, Gauge, Activity, Loader2, X,
} from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { type Vehicle } from "@/lib/types";
import { useAuth } from "@/lib/auth";

interface HistoryPoint {
  t: string;
  day: string;
  speed: number;
  fuel: number;
  temp: number;
}

function VehicleDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [v, setV] = useState<Vehicle | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Assignment states
  const [drivers, setDrivers] = useState<any[]>([]);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [newDriver, setNewDriver] = useState({ name: "", license: "", phone: "" });

  const canManage = user?.role === "admin" || user?.role === "manager";

  async function loadDrivers() {
    const { data } = await supabase
      .from('drivers')
      .select('id, name');
    if (data) {
      setDrivers(data);
    }
  }

  async function load() {
    // 1. Fetch vehicle view details
    const { data: vehicleData } = await supabase
      .from('v_vehicles')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (vehicleData) {
      setV({
        id: vehicleData.id,
        number: vehicleData.number,
        type: vehicleData.type,
        model: vehicleData.model,
        route: vehicleData.route || '',
        insuranceExpiry: vehicleData.insurance_expiry || '',
        lastService: vehicleData.last_service || '',
        nextServiceKm: vehicleData.next_service_km || 0,
        odometer: vehicleData.odometer || 0,
        engineHours: Number(vehicleData.engine_hours || 0),
        status: vehicleData.status,
        location: vehicleData.location || '',
        lat: Number(vehicleData.lat || 0),
        lng: Number(vehicleData.lng || 0),
        speed: vehicleData.speed || 0,
        fuel: vehicleData.fuel || 0,
        temperature: Number(vehicleData.temperature || 0),
        humidity: vehicleData.humidity || 0,
        engineOn: vehicleData.engine_on || false,
        ignition: vehicleData.ignition || false,
        driver: vehicleData.driver_name || '',
        driverId: vehicleData.driver_id || '',
        lastUpdate: vehicleData.last_update ? new Date(vehicleData.last_update).toLocaleTimeString() : 'sec ago'
      });

      // 2. Fetch history from telemetry_history
      const { data: hist } = await supabase
        .from('telemetry_history')
        .select('*')
        .eq('vehicle_id', id)
        .order('recorded_at', { ascending: true })
        .limit(50);

      if (hist) {
        setHistory(hist.map(h => {
          const d = new Date(h.recorded_at);
          return {
            t: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
            day: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
            speed: Number(h.speed || 0),
            fuel: Number(h.fuel || 0),
            temp: Number(h.temperature || 0)
          };
        }));
      }
    } else {
      setV(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled || !session) return;

      load();

      channel = supabase
        .channel(`vehicle-detail-${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_telemetry', filter: `vehicle_id=eq.${id}` }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'telemetry_history', filter: `vehicle_id=eq.${id}` }, () => { if (!cancelled) load(); })
        .subscribe();
    }

    init();

    return () => {
      cancelled = true;
      channel?.unsubscribe();
    };
  }, [id]);

  async function handleAssignDriver(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDriverId || !v) return;
    setAssigning(true);

    try {
      // 1. Deactivate any existing active assignment for this vehicle
      await supabase
        .from('vehicle_assignments')
        .update({ is_active: false, unassigned_at: new Date().toISOString() })
        .eq('vehicle_id', v.id)
        .eq('is_active', true);

      // 2. Deactivate any existing active assignment for this driver (to prevent double assignment)
      await supabase
        .from('vehicle_assignments')
        .update({ is_active: false, unassigned_at: new Date().toISOString() })
        .eq('driver_id', selectedDriverId)
        .eq('is_active', true);

      // 3. Create the new assignment
      const { error } = await supabase
        .from('vehicle_assignments')
        .insert({
          vehicle_id: v.id,
          driver_id: selectedDriverId,
          is_active: true
        });

      if (error) throw error;
      
      setShowAssignModal(false);
      setSelectedDriverId("");
      load();
    } catch (err: any) {
      alert("Failed to assign driver: " + err.message);
    } finally {
      setAssigning(false);
    }
  }

  async function handleUnassignDriver() {
    if (!v) return;
    if (!confirm("Are you sure you want to unassign the current driver?")) return;
    setAssigning(true);

    try {
      const { error } = await supabase
        .from('vehicle_assignments')
        .update({ is_active: false, unassigned_at: new Date().toISOString() })
        .eq('vehicle_id', v.id)
        .eq('is_active', true);

      if (error) throw error;
      load();
    } catch (err: any) {
      alert("Failed to unassign driver: " + err.message);
    } finally {
      setAssigning(false);
    }
  }

  async function handleRegisterAndAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!newDriver.name.trim() || !newDriver.license.trim() || !newDriver.phone.trim() || !v) return;
    setAssigning(true);

    try {
      // 1. Insert driver
      const { data: driverData, error: driverError } = await supabase
        .from('drivers')
        .insert({
          name: newDriver.name.trim(),
          license: newDriver.license.trim().toUpperCase(),
          phone: newDriver.phone.trim(),
          score: 100,
          rating: 'Good'
        })
        .select()
        .maybeSingle();

      if (driverError) throw driverError;

      if (driverData) {
        // 2. Deactivate any existing active assignment for this vehicle
        await supabase
          .from('vehicle_assignments')
          .update({ is_active: false, unassigned_at: new Date().toISOString() })
          .eq('vehicle_id', v.id)
          .eq('is_active', true);

        // 3. Create the new assignment
        const { error: assignError } = await supabase
          .from('vehicle_assignments')
          .insert({
            vehicle_id: v.id,
            driver_id: driverData.id,
            is_active: true
          });

        if (assignError) throw assignError;
      }

      setShowAssignModal(false);
      setShowRegisterForm(false);
      setNewDriver({ name: "", license: "", phone: "" });
      load();
    } catch (err: any) {
      alert("Failed to register and assign driver: " + err.message);
    } finally {
      setAssigning(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="text-lg font-medium">Loading vehicle details...</div>
      </div>
    );
  }

  if (!v) {
    return (
      <div className="p-8 text-center">
        <div className="text-lg font-medium text-destructive">Vehicle not found</div>
        <p className="text-muted-foreground text-sm mt-1">This record does not exist in the database.</p>
        <Link to="/vehicles" className="text-primary hover:underline text-sm mt-3 inline-block">Back to vehicles</Link>
      </div>
    );
  }

  return (
    <div>
      <Link to="/vehicles" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
        <ChevronLeft className="h-4 w-4" /> Back to vehicles
      </Link>
      <PageHeader
        title={v.number}
        subtitle={`${v.type} · ${v.model}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge status={v.status}>{v.status}</Badge>
            {canManage && (
              <>
                <Button variant="primary" size="sm" onClick={() => { loadDrivers(); setShowAssignModal(true); }}>
                  Assign Driver
                </Button>
                {v.driverId && (
                  <Button variant="destructive" size="sm" onClick={handleUnassignDriver} disabled={assigning}>
                    Unassign
                  </Button>
                )}
              </>
            )}
            <Button variant="outline" size="sm">Export profile</Button>
          </div>
        }
      />

      {showAssignModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-sm">
            <CardHeader title={showRegisterForm ? "Register New Driver" : "Assign Driver"} />
            
            {!showRegisterForm ? (
              <form onSubmit={handleAssignDriver} className="p-4 space-y-4">
                {drivers.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-2">
                    No registered drivers found in the database.
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Choose Driver</label>
                    <select 
                      className="w-full p-2 border border-border bg-card rounded-md text-sm"
                      value={selectedDriverId}
                      onChange={(e) => setSelectedDriverId(e.target.value)}
                      required
                    >
                      <option value="">Select a driver...</option>
                      {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                )}
                
                <div className="text-center">
                  <button 
                    type="button" 
                    onClick={() => setShowRegisterForm(true)}
                    className="text-xs text-primary hover:underline font-medium"
                  >
                    + Register a new driver instead
                  </button>
                </div>

                <div className="flex gap-2 pt-2 border-t border-border">
                  <Button type="button" variant="outline" onClick={() => { setShowAssignModal(false); setSelectedDriverId(""); }} className="flex-1">Cancel</Button>
                  <Button type="submit" className="flex-1" disabled={assigning || drivers.length === 0}>
                    {assigning ? <Loader2 className="animate-spin h-4 w-4" /> : "Confirm"}
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleRegisterAndAssign} className="p-4 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Driver Name *</label>
                  <input 
                    type="text"
                    className="w-full p-2 border border-border bg-transparent rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    value={newDriver.name}
                    onChange={(e) => setNewDriver({ ...newDriver, name: e.target.value })}
                    placeholder="e.g. Aswin Kumar"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">License Number *</label>
                  <input 
                    type="text"
                    className="w-full p-2 border border-border bg-transparent rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    value={newDriver.license}
                    onChange={(e) => setNewDriver({ ...newDriver, license: e.target.value })}
                    placeholder="e.g. DL-142023000567"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Phone Number *</label>
                  <input 
                    type="text"
                    className="w-full p-2 border border-border bg-transparent rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    value={newDriver.phone}
                    onChange={(e) => setNewDriver({ ...newDriver, phone: e.target.value })}
                    placeholder="e.g. +919876543210"
                    required
                  />
                </div>

                <div className="text-center">
                  <button 
                    type="button" 
                    onClick={() => setShowRegisterForm(false)}
                    className="text-xs text-primary hover:underline font-medium"
                  >
                    ← Select from existing drivers
                  </button>
                </div>

                <div className="flex gap-2 pt-2 border-t border-border">
                  <Button type="button" variant="outline" onClick={() => { setShowAssignModal(false); setShowRegisterForm(false); setNewDriver({ name: "", license: "", phone: "" }); }} className="flex-1">Cancel</Button>
                  <Button type="submit" className="flex-1" disabled={assigning}>
                    {assigning ? <Loader2 className="animate-spin h-4 w-4" /> : "Register & Assign"}
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={<Gauge className="h-4 w-4" />} label="Current Speed" value={`${v.speed} km/h`} />
        <Stat icon={<Fuel className="h-4 w-4" />} label="Fuel" value={`${v.fuel}%`} />
        <Stat icon={<Thermometer className="h-4 w-4" />} label="Temperature" value={`${v.temperature}°C`} />
        <Stat icon={<Activity className="h-4 w-4" />} label="Engine" value={v.engineOn ? "Running" : "Off"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <Card className="lg:col-span-2">
          <CardHeader title="Live Location" subtitle={v.location} />
          <div className="p-3">
            <VehicleMap vehicles={[v]} height={360} selectedId={v.id} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Vehicle Information" />
          <dl className="px-4 py-3 text-sm grid grid-cols-2 gap-y-3">
            <Field label="Registration" value={v.number} />
            <Field label="Model" value={v.model} />
            <Field label="Driver" value={v.driver || 'No Driver'} />
            <Field label="Route" value={v.route || 'Unassigned'} />
            <Field label="Insurance" value={v.insuranceExpiry || 'N/A'} />
            <Field label="Last Service" value={v.lastService || 'N/A'} />
            <Field label="Odometer" value={`${v.odometer.toLocaleString()} km`} />
            <Field label="Engine Hours" value={`${v.engineHours.toLocaleString()} h`} />
            <Field label="Ignition" value={v.ignition ? "ON" : "OFF"} />
            <Field label="Next Service" value={`${v.nextServiceKm} km`} />
          </dl>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card>
          <CardHeader title="Speed History" subtitle="Live logs from telemetry history" />
          <div className="p-3" style={{ height: 240 }}>
            {history.length > 0 ? (
              <ResponsiveContainer>
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                  <XAxis dataKey="t" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Line type="monotone" dataKey="speed" stroke="oklch(0.45 0.15 255)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No telemetry history registered.
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Fuel Usage" subtitle="Live logs from telemetry history" />
          <div className="p-3" style={{ height: 240 }}>
            {history.length > 0 ? (
              <ResponsiveContainer>
                <AreaChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                  <XAxis dataKey="day" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Area type="monotone" dataKey="fuel" stroke="oklch(0.62 0.18 150)" fill="oklch(0.62 0.18 150 / 0.25)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No telemetry history registered.
              </div>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Temperature History" subtitle="Compliance window 2°C – 6°C" />
          <div className="p-3" style={{ height: 240 }}>
            {history.length > 0 ? (
              <ResponsiveContainer>
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                  <XAxis dataKey="t" fontSize={11} />
                  <YAxis domain={[0, 12]} fontSize={11} />
                  <Tooltip />
                  <Line type="monotone" dataKey="temp" stroke="oklch(0.6 0.22 25)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No telemetry history registered.
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-right">{value}</dd>
    </>
  );
}

export default VehicleDetailPage;
