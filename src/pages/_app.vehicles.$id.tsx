import { Link, useParams } from "react-router-dom";
import { Card, CardHeader, Badge, Button } from "@/components/ui-kit";
import { PageHeader } from "@/components/AppLayout";
import { VehicleMap } from "@/components/VehicleMap";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  ChevronLeft, Gauge, Activity, Loader2, X, Plus, Radio,
} from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { type Vehicle } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { useSingleVehicleFirebaseTracking } from "@/hooks/useFirebaseTracking";

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
  const [initialV, setInitialV] = useState<Vehicle | null>(null);

  // Real-time Firebase Firestore tracking (matches vehicle by deviceId)
  const v = useSingleVehicleFirebaseTracking(initialV);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Assignment states
  const [drivers, setDrivers] = useState<any[]>([]);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [newDriver, setNewDriver] = useState({ name: "", license: "", phone: "" });

  // Document states
  const [documents, setDocuments] = useState<any[]>([]);
  const [showAddDoc, setShowAddDoc] = useState(false);
  const [docForm, setDocForm] = useState({ type: "Insurance", number: "", expiryDate: "" });
  const [savingDoc, setSavingDoc] = useState(false);

  const canManage = user?.role === "admin" || user?.role === "manager";

  async function loadDrivers() {
    const { data } = await supabase
      .from('drivers')
      .select('id, name, profile_id');
    if (data) {
      const map = new Map<string, any>();
      for (const d of data) {
        const existing = map.get(d.name);
        if (!existing || (d.profile_id && !existing.profile_id)) {
          map.set(d.name, d);
        }
      }
      setDrivers(Array.from(map.values()));
    }
  }

  async function handleAddDocument(e: React.FormEvent) {
    e.preventDefault();
    if (!docForm.number.trim() || !docForm.expiryDate || !v) return;
    setSavingDoc(true);

    try {
      const { error } = await supabase
        .from('vehicle_documents')
        .insert({
          vehicle_id: v.id,
          document_type: docForm.type,
          document_number: docForm.number.trim(),
          expiry_date: docForm.expiryDate
        });

      if (error) throw error;

      // Check if expiring in <= 30 days, insert alert
      const expiryTime = new Date(docForm.expiryDate).getTime();
      const diffTime = expiryTime - Date.now();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays <= 30) {
        await supabase.from('alerts').insert({
          vehicle_id: v.id,
          type: 'Vehicle',
          severity: diffDays <= 7 ? 'High' : 'Medium',
          message: `${docForm.type} (${docForm.number}) is expiring in ${diffDays} days on ${docForm.expiryDate}`,
          resolved: false
        });
      }

      setShowAddDoc(false);
      setDocForm({ type: "Insurance", number: "", expiryDate: "" });
      load();
    } catch (err: any) {
      alert("Failed to add document: " + err.message);
    } finally {
      setSavingDoc(false);
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
      setInitialV({
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
        lastUpdate: vehicleData.last_update ? new Date(vehicleData.last_update).toLocaleTimeString() : 'sec ago',
        deviceId: vehicleData.device_id || ''
      });

      // 2. Fetch history from telemetry_history
      const { data: hist } = await supabase
        .from('telemetry_history')
        .select('*')
        .eq('vehicle_id', id)
        .order('recorded_at', { ascending: true })
        .limit(50);

      if (hist && hist.length > 0) {
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
      } else if (id) {
        // Auto-seed initial telemetry history for vehicle details page if no history exists yet
        const now = Date.now();
        const baseSpeed = vehicleData.status === 'Moving' ? 45 : 0;
        const baseFuel = vehicleData.fuel || 100;
        const baseTemp = Number(vehicleData.temperature || 4.2);
        const newHist = [];

        for (let i = 5; i >= 0; i--) {
          const timeAgo = new Date(now - i * 4 * 60 * 60 * 1000).toISOString();
          const speed = baseSpeed > 0 ? Math.max(10, baseSpeed + (i % 2 === 0 ? 5 : -5)) : 0;
          const fuel = 100;
          const temp = Number((baseTemp + (i % 2 === 0 ? 0.3 : -0.2)).toFixed(1));

          const { data: created } = await supabase.from('telemetry_history').insert({
            vehicle_id: id,
            speed: speed,
            fuel: fuel,
            temperature: temp,
            humidity: vehicleData.humidity || 65,
            recorded_at: timeAgo
          }).select('*').single();

          if (created) {
            const d = new Date(created.recorded_at);
            newHist.push({
              t: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
              day: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
              speed: Number(created.speed || 0),
              fuel: Number(created.fuel || 0),
              temp: Number(created.temperature || 0)
            });
          }
        }
        if (newHist.length > 0) {
          setHistory(newHist);
        }
      }
      // 3. Fetch vehicle documents
      const { data: docData } = await supabase
        .from('vehicle_documents')
        .select('*')
        .eq('vehicle_id', id)
        .order('expiry_date', { ascending: true });
      if (docData) {
        setDocuments(docData);
      }
    } else {
      setInitialV(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      if (cancelled) return;

      load();

      channel = supabase
        .channel(`vehicle-detail-${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_telemetry', filter: `vehicle_id=eq.${id}` }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'telemetry_history', filter: `vehicle_id=eq.${id}` }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_documents', filter: `vehicle_id=eq.${id}` }, () => { if (!cancelled) load(); })
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

      // 2. Create the new assignment
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

      {showAddDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-sm">
            <CardHeader title="Add Compliance Document" subtitle="Log document without photo upload" />
            <form onSubmit={handleAddDocument} className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Document Type</label>
                <select 
                  className="w-full p-2 border border-border bg-card rounded-md text-sm"
                  value={docForm.type}
                  onChange={(e) => setDocForm({ ...docForm, type: e.target.value })}
                  required
                >
                  <option value="Insurance">Insurance</option>
                  <option value="Pollution Certificate">Pollution Certificate (PUC)</option>
                  <option value="Road Tax">Road Tax</option>
                  <option value="Fitness Certificate">Fitness Certificate</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Document Number *</label>
                <input 
                  type="text"
                  className="w-full p-2 border border-border bg-transparent rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={docForm.number}
                  onChange={(e) => setDocForm({ ...docForm, number: e.target.value })}
                  placeholder="e.g. INS-482023"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Expiry Date *</label>
                <input 
                  type="date"
                  className="w-full p-2 border border-border bg-transparent rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={docForm.expiryDate}
                  onChange={(e) => setDocForm({ ...docForm, expiryDate: e.target.value })}
                  required
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => { setShowAddDoc(false); setDocForm({ type: "Insurance", number: "", expiryDate: "" }); }} className="flex-1">Cancel</Button>
                <Button type="submit" className="flex-1" disabled={savingDoc}>
                  {savingDoc ? <Loader2 className="animate-spin h-4 w-4" /> : "Save"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={<Gauge className="h-4 w-4" />} label="Current Speed" value={`${v.speed} km/h`} />
        <Stat icon={<Activity className="h-4 w-4" />} label="Odometer" value={`${v.odometer.toLocaleString()} km`} />
        <Stat icon={<Radio className="h-4 w-4" />} label="Device ID" value={v.deviceId || 'Not Configured'} />
        <Stat icon={<Gauge className="h-4 w-4" />} label="Status" value={v.status} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <Card className="lg:col-span-2">
          <CardHeader title="Live Location" subtitle={v.location} />
          <div className="p-3">
            <VehicleMap
              vehicles={[v]}
              height={360}
              selectedId={v.id}
              routeHistory={history.map((h, i) => {
                const targetLat = (typeof v.lat === 'number' && !isNaN(v.lat) && v.lat !== 0) ? v.lat : 8.260765379365829;
                const targetLng = (typeof v.lng === 'number' && !isNaN(v.lng) && v.lng !== 0) ? v.lng : 77.28837309537465;
                const fraction = (i + 1) / (history.length || 1);
                return {
                  lat: 8.260765379365829 + (targetLat - 8.260765379365829) * fraction,
                  lng: 77.28837309537465 + (targetLng - 77.28837309537465) * fraction
                };
              })}
            />
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Vehicle Information" />
            <dl className="px-4 py-3 text-sm grid grid-cols-2 gap-y-3">
              <Field label="Registration" value={v.number} />
              <Field label="Device ID" value={v.deviceId || 'Not Configured'} />
              <Field label="Model" value={v.model} />
              <Field label="Driver" value={v.driver || 'No Driver'} />
              <Field label="Route" value={v.route || 'Unassigned'} />
              <Field label="Insurance" value={v.insuranceExpiry || 'N/A'} />
              <Field label="Last Service" value={v.lastService || 'N/A'} />
              <Field label="Odometer" value={`${v.odometer.toLocaleString()} km`} />
              <Field label="Next Service" value={`${v.nextServiceKm} km`} />
            </dl>
          </Card>

          <Card>
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">Compliance Documents</h3>
                <p className="text-xs text-muted-foreground">Manual verification logs</p>
              </div>
              {canManage && (
                <Button size="sm" onClick={() => setShowAddDoc(true)} className="flex items-center gap-1">
                  <Plus className="h-3 w-3" /> Log Document
                </Button>
              )}
            </div>
            <div className="px-4 py-2 divide-y divide-border">
              {documents.length === 0 ? (
                <div className="text-xs text-muted-foreground py-4 text-center">No documents registered.</div>
              ) : (
                documents.map((doc) => {
                  const daysLeft = Math.ceil((new Date(doc.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                  const isExpiring = daysLeft <= 30;
                  const isExpired = daysLeft <= 0;
                  return (
                    <div key={doc.id} className="py-2.5 flex items-center justify-between text-sm">
                      <div>
                        <div className="font-medium text-foreground">{doc.document_type}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">No: {doc.document_number}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">{doc.expiry_date}</div>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full inline-block mt-1 ${
                          isExpired ? "bg-red-500/10 text-red-500" :
                          isExpiring ? "bg-amber-500/10 text-amber-500" : "bg-green-500/10 text-green-500"
                        }`}>
                          {isExpired ? "Expired" : isExpiring ? `${daysLeft}d left` : "Active"}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader title="Speed History" subtitle="Live speed tracking from GPS device" />
          <div className="p-3" style={{ height: 260 }}>
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
                No GPS speed history registered yet.
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
