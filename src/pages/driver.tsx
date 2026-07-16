import { Navigate, useNavigate } from "react-router-dom";
import { useAuth, REDIRECT_MAP } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { Truck, Fuel, Thermometer, Gauge, MapPin, Bell, ShieldCheck, Play, LogOut, Activity, Loader2, Calendar, Route } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui-kit";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

function DriverPage() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [driver, setDriver] = useState<any>(null);
  const [vehicle, setVehicle] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeShift, setActiveShift] = useState<any>(null);
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [shiftHistory, setShiftHistory] = useState<any[]>([]);

  // Fuel logging states
  const [fuelForm, setFuelForm] = useState({ liters: 0, cost: 0, odometer: 0 });
  const [submittingFuel, setSubmittingFuel] = useState(false);

  // Pre-Trip Inspection states
  const [showInspectionModal, setShowInspectionModal] = useState(false);
  const [inspectionForm, setInspectionForm] = useState({ tyres: false, brakes: false, lights: false, cleanliness: false });
  const [submittingInspection, setSubmittingInspection] = useState(false);

  // Scheduling & Dispatch states
  const [schedules, setSchedules] = useState<any[]>([]);
  const [ongoingTrip, setOngoingTrip] = useState<any>(null);
  const [endTripForm, setEndTripForm] = useState({ endKm: 0 });
  const [submittingTrip, setSubmittingTrip] = useState(false);
  const [assignedVehicles, setAssignedVehicles] = useState<any[]>([]);

  async function handleEndManualTrip(e: React.FormEvent) {
    e.preventDefault();
    if (!ongoingTrip || !driver?.id || endTripForm.endKm < (ongoingTrip.start_km || 0)) {
      alert("Invalid trip logging entries. Ending odometer must be greater than or equal to starting odometer.");
      return;
    }
    setSubmittingTrip(true);

    try {
      const elapsedMs = Date.now() - new Date(ongoingTrip.created_at || ongoingTrip.date).getTime();
      const elapsedMins = Math.round(elapsedMs / (1000 * 60));
      const durationStr = elapsedMins > 60 ? `${Math.floor(elapsedMins / 60)}h ${elapsedMins % 60}m` : `${elapsedMins}m`;

      const startKm = ongoingTrip.start_km || 0;
      const endKm = endTripForm.endKm;
      const distance = endKm - startKm;

      // 1. Update trip status
      const { error: tripErr } = await supabase
        .from('trips')
        .update({
          status: 'Completed',
          end_km: endKm,
          distance: distance,
          duration: durationStr
        })
        .eq('id', ongoingTrip.id);

      if (tripErr) throw tripErr;

      // 2. Update vehicle odometer
      if (ongoingTrip.vehicle_id) {
        await supabase
          .from('vehicles')
          .update({ odometer: endKm })
          .eq('id', ongoingTrip.vehicle_id);
      }

      alert("Trip completed and logged successfully!");
      setOngoingTrip(null);
      load();
    } catch (err: any) {
      alert("Failed to complete trip: " + err.message);
    } finally {
      setSubmittingTrip(false);
    }
  }

  async function handleLogFuelDriver(e: React.FormEvent) {
    e.preventDefault();
    if (!vehicle?.id || !driver?.id || fuelForm.liters <= 0 || fuelForm.cost <= 0 || fuelForm.odometer < 0) return;
    setSubmittingFuel(true);

    try {
      const { error } = await supabase
        .from('fuel_purchase_logs')
        .insert({
          vehicle_id: vehicle.id,
          driver_id: driver.id,
          liters: fuelForm.liters,
          cost: fuelForm.cost,
          odometer: fuelForm.odometer
        });

      if (error) throw error;
      alert("Fuel refill logged successfully!");
      setFuelForm({ liters: 0, cost: 0, odometer: 0 });
    } catch (err: any) {
      alert("Failed to log fuel: " + err.message);
    } finally {
      setSubmittingFuel(false);
    }
  }

  function handleSwitchVehicle(vehicleId: string) {
    localStorage.setItem("activeVehicleId", vehicleId);
    load();
  }

  function handleViewRoute() {
    let origin = "";
    let destination = "";
    let query = "";

    if (ongoingTrip) {
      // If we saved routeName · From in start, let's extract the "From" part (after the '·')
      const startParts = (ongoingTrip.start || "").split(" · ");
      origin = startParts.length > 1 ? startParts[1] : startParts[0];
      destination = ongoingTrip.destination || "";
    } else if (vehicle?.route && vehicle.route !== "No route assigned") {
      // Try to parse route, e.g. "Nagercoil to Kanyakumari" or "Nagercoil → Kanyakumari"
      const routeStr = vehicle.route;
      const separators = [" to ", " TO ", " -> ", " → ", " · "];
      let foundSplit = false;
      
      for (const sep of separators) {
        if (routeStr.includes(sep)) {
          const parts = routeStr.split(sep);
          origin = parts[0].trim();
          destination = parts[1].trim();
          foundSplit = true;
          break;
        }
      }
      
      if (!foundSplit) {
        query = routeStr;
      }
    }

    let url = "";
    if (origin && destination) {
      url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
    } else if (query || vehicle?.route) {
      url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || vehicle.route)}`;
    }

    if (url) {
      window.open(url, "_blank");
    } else {
      alert("No route details available to view.");
    }
  }

  async function load() {
    if (!user) return;
    
    // Guard: only query if a valid session exists to prevent 401s during HMR/load race conditions
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    
    // Get driver record mapping to current login session ID
    const { data: dData } = await supabase
      .from('drivers')
      .select('*')
      .eq('profile_id', session.user.id)
      .maybeSingle();

    const resolvedDriver = dData || { id: null, name: user.name, score: 0, rating: "Poor", trips: 0, total_km: 0, events: 0 };
    setDriver(resolvedDriver);

    // Get assigned vehicles via view
    const { data: vList } = await supabase
      .from('v_vehicles')
      .select('*')
      .eq('driver_name', resolvedDriver.name);

    const vehiclesArray = vList || [];
    setAssignedVehicles(vehiclesArray);

    const savedActiveId = localStorage.getItem("activeVehicleId");
    const activeV = vehiclesArray.find(x => x.id === savedActiveId) || vehiclesArray[0];

    const resolvedVehicle = activeV ? {
      id: activeV.id,
      number: activeV.number,
      type: activeV.type,
      model: activeV.model,
      route: activeV.route || '',
      insuranceExpiry: activeV.insurance_expiry || '',
      lastService: activeV.last_service || '',
      nextServiceKm: activeV.next_service_km || 0,
      odometer: activeV.odometer || 0,
      engineHours: Number(activeV.engine_hours || 0),
      status: activeV.status,
      location: activeV.location || '',
      lat: Number(activeV.lat || 0),
      lng: Number(activeV.lng || 0),
      speed: activeV.speed || 0,
      fuel: activeV.fuel || 0,
      temperature: Number(activeV.temperature || 0),
      humidity: activeV.humidity || 0,
      engineOn: activeV.engine_on || false,
      ignition: activeV.ignition || false,
      driver: activeV.driver_name || '',
      driverId: activeV.driver_id || '',
      lastUpdate: activeV.last_update ? new Date(activeV.last_update).toLocaleTimeString() : 'sec ago'
    } : { 
      id: null,
      number: "Unassigned", 
      type: "No Assigned Vehicle", 
      status: "Offline", 
      fuel: 0, 
      speed: 0, 
      temperature: 0, 
      engineOn: false, 
      route: "No route assigned" 
    };
    setVehicle(resolvedVehicle);

    // Get alerts
    if (resolvedVehicle.id) {
      const { data: aData } = await supabase
        .from('alerts')
        .select('*')
        .eq('vehicle_id', resolvedVehicle.id)
        .limit(4);

      if (aData) {
        setAlerts(aData.map(a => ({
          id: a.id,
          severity: a.severity,
          message: a.message,
          type: a.type,
          time: a.time ? new Date(a.time).toLocaleTimeString() : '1h ago',
          resolved: a.resolved
        })));
      } else {
        setAlerts([]);
      }
    } else {
      setAlerts([]);
    }

    // Get active shift
    if (resolvedDriver.id) {
      const { data: activeShiftData } = await supabase
        .from('driver_shifts')
        .select('*')
        .eq('driver_id', resolvedDriver.id)
        .is('ended_at', null)
        .maybeSingle();

      if (activeShiftData) {
        setActiveShift(activeShiftData);
      }

      // Get shift history
      const { data: history } = await supabase
        .from('driver_shifts')
        .select('*')
        .eq('driver_id', resolvedDriver.id)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(5);

      if (history) {
        setShiftHistory(history);
      }

      // Fetch driver schedules
      const { data: scheds } = await supabase
        .from('driver_schedules')
        .select('*, vehicles(number)')
        .eq('driver_id', resolvedDriver.id)
        .gte('date', new Date().toISOString().split('T')[0])
        .order('date', { ascending: true })
        .limit(10);
      if (scheds) {
        setSchedules(scheds);
      }

      // Fetch ongoing manual trip
      const { data: activeTrip } = await supabase
        .from('trips')
        .select('*, vehicles(number)')
        .eq('driver_id', resolvedDriver.id)
        .eq('status', 'Ongoing')
        .maybeSingle();
      if (activeTrip) {
        setOngoingTrip(activeTrip);
        setEndTripForm({ endKm: (activeTrip.start_km || 0) + 1, totalMilk: 0 });
      } else {
        setOngoingTrip(null);
      }
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

      // Subscribe to changes on assignments, telemetry, shifts, schedules, and trips in real-time
      channel = supabase
        .channel('driver-portal-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_assignments' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_telemetry' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_shifts' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_schedules' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => { if (!cancelled) load(); })
        .subscribe();
    }

    init();

    return () => {
      cancelled = true;
      channel?.unsubscribe();
    };
  }, [user]);

  // Live timer tick
  useEffect(() => {
    if (!activeShift) {
      setActiveSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - new Date(activeShift.started_at).getTime()) / 1000);
      setActiveSeconds(elapsed > 0 ? elapsed : 0);
    }, 1000);
    return () => clearInterval(interval);
  }, [activeShift]);

  if (!user) return <Navigate to="/login" />;
  if (REDIRECT_MAP[user.role] !== "/driver") return <Navigate to={REDIRECT_MAP[user.role]} />;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-lg font-medium">Loading driver portal...</div>
      </div>
    );
  }

  async function handleStartShiftWithInspection(e: React.FormEvent) {
    e.preventDefault();
    if (!driver?.id) return;
    setSubmittingInspection(true);

    try {
      const passed = inspectionForm.tyres && inspectionForm.brakes && inspectionForm.lights && inspectionForm.cleanliness;

      // 1. Log pre-trip inspection
      const { error: inspError } = await supabase
        .from('pre_trip_inspections')
        .insert({
          driver_id: driver.id,
          vehicle_id: vehicle?.id || null,
          tyres_ok: inspectionForm.tyres,
          brakes_ok: inspectionForm.brakes,
          lights_ok: inspectionForm.lights,
          cleanliness_ok: inspectionForm.cleanliness,
          passed: passed
        });

      if (inspError) throw inspError;

      // 2. Start shift
      const { data, error: shiftError } = await supabase
        .from('driver_shifts')
        .insert({
          driver_id: driver.id,
          vehicle_id: vehicle?.id || null
        })
        .select()
        .maybeSingle();

      if (shiftError) throw shiftError;

      if (data) {
        setActiveShift(data);
      }
      setShowInspectionModal(false);
      setInspectionForm({ tyres: false, brakes: false, lights: false, cleanliness: false });
      load();
    } catch (err: any) {
      alert("Failed to start shift: " + err.message);
    } finally {
      setSubmittingInspection(false);
    }
  }

  async function handleToggleShift() {
    if (!driver?.id) {
      alert("Error: Your driver account has not been registered in the fleet database yet. Please ask your Admin to assign you to a vehicle first.");
      return;
    }

    if (activeShift) {
      // End current shift
      const nowStr = new Date().toISOString();
      const elapsedHours = activeSeconds / 3600;
      
      const { error } = await supabase
        .from('driver_shifts')
        .update({
          ended_at: nowStr,
          active_hours: Number(elapsedHours.toFixed(2))
        })
        .eq('id', activeShift.id);

      if (error) {
        alert("Failed to end shift: " + error.message);
      } else {
        setActiveShift(null);
        load();
      }
    } else {
      // Show pre-trip checklist modal
      setShowInspectionModal(true);
    }
  }

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600).toString().padStart(2, '0');
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${h}h ${m}m ${s}s`;
  };

  return (
    <div className="min-h-screen bg-background pb-12">
      <header className="bg-primary text-primary-foreground px-5 py-4 flex items-center gap-3 shadow">
        <div className="bg-white rounded-md p-1.5"><Logo className="h-7" /></div>
        <div className="flex-1 leading-tight">
          <div className="text-xs opacity-80">Welcome back</div>
          <div className="font-semibold">{user.name}</div>
        </div>
        <button onClick={() => { logout(); nav("/login"); }}
          className="p-2 rounded hover:bg-white/10"><LogOut className="h-5 w-5" /></button>
      </header>

      {showInspectionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-sm">
            <CardHeader title="Pre-Trip Safety Inspection" subtitle="Verify vehicle condition before starting shift" />
            <form onSubmit={handleStartShiftWithInspection} className="p-4 space-y-4 text-left">
              <div className="space-y-3">
                <label className="flex items-center gap-3 p-2.5 bg-card border border-border rounded hover:bg-muted/40 cursor-pointer">
                  <input 
                    type="checkbox"
                    checked={inspectionForm.tyres}
                    onChange={(e) => setInspectionForm({ ...inspectionForm, tyres: e.target.checked })}
                    className="h-4 w-4 rounded text-primary border-border focus:ring-primary focus:ring-opacity-25"
                  />
                  <div>
                    <div className="text-xs font-semibold">Tyres Condition OK</div>
                    <div className="text-[10px] text-muted-foreground">Pressure, tread depth, and no visible damage</div>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-2.5 bg-card border border-border rounded hover:bg-muted/40 cursor-pointer">
                  <input 
                    type="checkbox"
                    checked={inspectionForm.brakes}
                    onChange={(e) => setInspectionForm({ ...inspectionForm, brakes: e.target.checked })}
                    className="h-4 w-4 rounded text-primary border-border focus:ring-primary focus:ring-opacity-25"
                  />
                  <div>
                    <div className="text-xs font-semibold">Brakes Working OK</div>
                    <div className="text-[10px] text-muted-foreground">Brake pads, responsiveness, and fluid levels</div>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-2.5 bg-card border border-border rounded hover:bg-muted/40 cursor-pointer">
                  <input 
                    type="checkbox"
                    checked={inspectionForm.lights}
                    onChange={(e) => setInspectionForm({ ...inspectionForm, lights: e.target.checked })}
                    className="h-4 w-4 rounded text-primary border-border focus:ring-primary focus:ring-opacity-25"
                  />
                  <div>
                    <div className="text-xs font-semibold">Lights & Indicators working</div>
                    <div className="text-[10px] text-muted-foreground">Headlights, indicators, brake lights, and hazards</div>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-2.5 bg-card border border-border rounded hover:bg-muted/40 cursor-pointer">
                  <input 
                    type="checkbox"
                    checked={inspectionForm.cleanliness}
                    onChange={(e) => setInspectionForm({ ...inspectionForm, cleanliness: e.target.checked })}
                    className="h-4 w-4 rounded text-primary border-border focus:ring-primary focus:ring-opacity-25"
                  />
                  <div>
                    <div className="text-xs font-semibold">Cabin & Cargo Clean</div>
                    <div className="text-[10px] text-muted-foreground">Free of waste and properly sanitised</div>
                  </div>
                </label>
              </div>

              <div className="flex gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" onClick={() => { setShowInspectionModal(false); setInspectionForm({ tyres: false, brakes: false, lights: false, cleanliness: false }); }} className="flex-1">Cancel</Button>
                <Button type="submit" className="flex-1" disabled={submittingInspection}>
                  {submittingInspection ? <Loader2 className="animate-spin h-4 w-4" /> : "Certify & Start"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      <div className="px-4 max-w-md mx-auto md:max-w-3xl">
        <div className="mt-4">
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-br from-primary to-[oklch(0.22_0.08_240)] text-primary-foreground p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Truck className="h-5 w-5" />
                  <div className="text-xs opacity-80">My Vehicle</div>
                </div>
                {assignedVehicles.length > 1 && (
                  <select 
                    value={vehicle?.id || ""}
                    onChange={(e) => handleSwitchVehicle(e.target.value)}
                    className="bg-white/10 text-white border border-white/20 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-white/50"
                  >
                    {assignedVehicles.map(v => (
                      <option key={v.id} value={v.id} className="text-foreground bg-card">
                        {v.number}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="text-2xl font-semibold mt-1">{vehicle.number}</div>
              <div className="text-sm opacity-90">{vehicle.type}</div>
              <div className="mt-3"><Badge status={vehicle.status}>{vehicle.status}</Badge></div>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3 text-sm">
              <Stat icon={<Fuel className="h-4 w-4" />} label="Fuel" value={`${vehicle.fuel}%`} />
              <Stat icon={<Gauge className="h-4 w-4" />} label="Speed" value={`${vehicle.speed} km/h`} />
              <Stat icon={<Thermometer className="h-4 w-4" />} label="Temp" value={`${vehicle.temperature}°C`} />
              <Stat icon={<Activity className="h-4 w-4" />} label="Engine" value={vehicle.engineOn ? "ON" : "OFF"} />
            </div>
          </Card>
        </div>

        <Card className="mt-4 p-4">
          <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /><div className="font-medium text-sm">Active Shift Tracker</div></div>
          <div className="mt-2 text-sm">{vehicle.route || "Ready to log active hours"}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {activeShift ? `Shift running: ${formatTime(activeSeconds)}` : "Start a shift to log your active driving hours."}
          </div>
          <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary" style={{ width: activeShift ? "100%" : "0%", transition: "width 0.6s" }} />
          </div>
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" onClick={handleToggleShift}>
              <Play className="h-4 w-4" /> {activeShift ? "End Active Shift" : "Start Shift"}
            </Button>
            <Button 
              variant="outline" 
              className="flex-1" 
              onClick={handleViewRoute}
              disabled={!ongoingTrip && (!vehicle?.route || vehicle.route === "No route assigned" || vehicle.route === "Ready to log active hours")}
            >
              View Route
            </Button>
          </div>
        </Card>

        {ongoingTrip ? (
          <Card className="mt-4 p-4 border border-primary/30 bg-gradient-to-br from-primary/5 to-card text-left">
            <div className="flex items-center gap-2 text-primary font-semibold text-sm">
              <Route className="h-4 w-4" />
              <span>Active Dispatch Trip</span>
            </div>
            <div className="mt-2 text-sm">
              <span className="font-semibold text-muted-foreground uppercase text-[10px] block">Route Details</span>
              <span className="font-medium">
                {ongoingTrip.destination ? `${ongoingTrip.start} → ${ongoingTrip.destination}` : ongoingTrip.start}
              </span>
            </div>
            <div className="mt-2 text-xs text-muted-foreground flex gap-4">
              <div><strong className="text-foreground">Vehicle:</strong> {ongoingTrip.vehicles?.number || 'Assigned'}</div>
              <div><strong className="text-foreground">Start Odo:</strong> {ongoingTrip.start_km} km</div>
            </div>
            <form onSubmit={handleEndManualTrip} className="mt-4 pt-3 border-t border-border/60 space-y-3">
              <div>
                <label className="block text-[10px] uppercase font-semibold text-muted-foreground mb-1">Ending Odometer (km) *</label>
                <input 
                  type="number" 
                  required
                  min={ongoingTrip.start_km || 0}
                  className="w-full p-2 border border-border bg-background rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  value={endTripForm.endKm || ""}
                  onChange={(e) => setEndTripForm({ ...endTripForm, endKm: Number(e.target.value) })}
                  placeholder="e.g. 10300"
                />
              </div>
              <Button type="submit" size="sm" className="w-full bg-primary text-primary-foreground font-semibold" disabled={submittingTrip}>
                {submittingTrip ? <Loader2 className="animate-spin h-3.5 w-3.5 mx-auto" /> : "Complete Trip & Log Data"}
              </Button>
            </form>
          </Card>
        ) : (
          <Card className="mt-4 p-4 text-center">
            <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm font-medium">
              <Route className="h-4 w-4" />
              <span>No active dispatches</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Main office will assign routes/dispatches dynamically to your profile.</p>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3 mt-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4" /> Safety Score</div>
            <div className="mt-1 text-2xl font-semibold">{driver.score}%</div>
            <div className="text-xs"><Badge status={driver.rating}>{driver.rating}</Badge></div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Bell className="h-4 w-4" /> Open Alerts</div>
            <div className="mt-1 text-2xl font-semibold">{alerts.filter((a) => !a.resolved).length}</div>
            <div className="text-xs text-muted-foreground">{alerts.length} total</div>
          </Card>
        </div>

        <Card className="mt-4 p-4">
          <div className="flex items-center gap-2">
            <Fuel className="h-4 w-4 text-primary" />
            <div className="font-medium text-sm">Log Fuel Refill</div>
          </div>
          <form onSubmit={handleLogFuelDriver} className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] uppercase font-semibold text-muted-foreground mb-1 font-sans">Liters *</label>
                <input 
                  type="number" 
                  step="0.01"
                  required
                  className="w-full p-2 border border-border bg-transparent rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  value={fuelForm.liters || ""}
                  onChange={(e) => setFuelForm({ ...fuelForm, liters: Number(e.target.value) })}
                  placeholder="e.g. 50"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase font-semibold text-muted-foreground mb-1 font-sans">Cost (INR) *</label>
                <input 
                  type="number" 
                  step="0.01"
                  required
                  className="w-full p-2 border border-border bg-transparent rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  value={fuelForm.cost || ""}
                  onChange={(e) => setFuelForm({ ...fuelForm, cost: Number(e.target.value) })}
                  placeholder="e.g. 4800"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] uppercase font-semibold text-muted-foreground mb-1 font-sans">Odometer (km) *</label>
              <input 
                type="number" 
                required
                className="w-full p-2 border border-border bg-transparent rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                value={fuelForm.odometer || ""}
                onChange={(e) => setFuelForm({ ...fuelForm, odometer: Number(e.target.value) })}
                placeholder="e.g. 10250"
              />
            </div>
            <Button type="submit" size="sm" className="w-full" disabled={submittingFuel || !vehicle?.id}>
              {submittingFuel ? <Loader2 className="animate-spin h-3.5 w-3.5 mx-auto" /> : "Save Refuel Log"}
            </Button>
          </form>
        </Card>

        <Card className="mt-4">
          <div className="px-4 py-3 border-b border-border font-medium text-sm">Recent Alerts</div>
          <div className="divide-y divide-border">
            {alerts.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted-foreground">No alerts.</div>}
            {alerts.map((a) => (
              <div key={a.id} className="px-4 py-3 flex items-start gap-3">
                <Badge status={a.severity}>{a.severity}</Badge>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{a.message}</div>
                  <div className="text-xs text-muted-foreground">{a.type} · {a.time}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="mt-4 p-4">
          <div className="font-medium text-sm">My Performance</div>
          <div className="grid grid-cols-3 gap-3 mt-3 text-center">
            <div>
              <div className="text-2xl font-semibold">{driver.trips}</div>
              <div className="text-xs text-muted-foreground">Trips</div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{(driver.total_km / 1000).toFixed(1)}k</div>
              <div className="text-xs text-muted-foreground">km driven</div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{driver.events}</div>
              <div className="text-xs text-muted-foreground">events</div>
            </div>
          </div>

          {shiftHistory.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border">
              <div className="text-xs font-semibold text-muted-foreground mb-2">Recent shifts logged</div>
              <div className="space-y-1.5 text-xs">
                {shiftHistory.map(s => (
                  <div key={s.id} className="flex justify-between text-muted-foreground">
                    <span>{new Date(s.started_at).toLocaleDateString()}</span>
                    <span className="font-semibold text-foreground">{s.active_hours} active hours</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="mt-4 p-4 text-left">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            <div className="font-medium text-sm">Duty Schedule Calendar</div>
          </div>
          <div className="mt-3 divide-y divide-border">
            {schedules.length === 0 ? (
              <div className="text-xs text-muted-foreground py-3 text-center">No upcoming scheduled shifts.</div>
            ) : (
              schedules.map((s) => (
                <div key={s.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-semibold text-foreground">{new Date(s.date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">Vehicle: {s.vehicles?.number || 'Unassigned'}</div>
                  </div>
                  <div>
                    <span className="px-2 py-0.5 rounded-full font-medium bg-primary/10 text-primary text-[10px]">
                      {s.shift_type}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="mt-0.5 font-semibold">{value}</div>
    </div>
  );
}

export default DriverPage;
