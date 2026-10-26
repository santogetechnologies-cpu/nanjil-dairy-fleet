import { Navigate, useNavigate } from "react-router-dom";
import { useAuth, REDIRECT_MAP } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import {
  Truck, Fuel, Thermometer, Gauge, MapPin, Bell, ShieldCheck, Play,
  LogOut, Loader2, Calendar, Route, Home, StopCircle,
  CheckCircle2, ChevronRight, Droplets,
} from "lucide-react";
import { Badge } from "@/components/ui-kit";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

/* ─── Types ─── */
type TabId = "home" | "trip" | "fuel" | "alerts" | "schedule";

const TABS: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: "home",     label: "Home",     icon: Home },
  { id: "trip",     label: "Trip",     icon: Route },
  { id: "fuel",     label: "Fuel",     icon: Fuel },
  { id: "alerts",   label: "Alerts",   icon: Bell },
  { id: "schedule", label: "Schedule", icon: Calendar },
];

function DriverPage() {
  const { user, logout, ready } = useAuth();
  const nav = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [driver, setDriver] = useState<any>(null);
  const [vehicle, setVehicle] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeShift, setActiveShift] = useState<any>(null);
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [shiftHistory, setShiftHistory] = useState<any[]>([]);

  // Fuel logging states
  const [fuelForm, setFuelForm] = useState({ liters: 0, cost: 0, odometer: 0, isFullTank: true });
  const [driverFuelError, setDriverFuelError] = useState<string | null>(null);
  const [submittingFuel, setSubmittingFuel] = useState(false);

  // Pre-Trip Inspection states
  const [showInspectionModal, setShowInspectionModal] = useState(false);
  const [inspectionForm, setInspectionForm] = useState({
    tyres: false, brakes: false, lights: false, cleanliness: false, openingKm: 0,
  });
  const [submittingInspection, setSubmittingInspection] = useState(false);

  // Scheduling & Dispatch states
  const [schedules, setSchedules] = useState<any[]>([]);
  const [ongoingTrip, setOngoingTrip] = useState<any>(null);
  const [endTripForm, setEndTripForm] = useState({ endKm: 0, endFuelLiters: 0 });
  const [submittingTrip, setSubmittingTrip] = useState(false);
  const [assignedVehicles, setAssignedVehicles] = useState<any[]>([]);

  async function handleEndManualTrip(e: React.FormEvent) {
    e.preventDefault();
    if (!ongoingTrip || !driver?.id || endTripForm.endKm < (ongoingTrip.start_km || 0)) {
      alert("Invalid trip logging entries. Ending odometer must be >= starting odometer.");
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

      const updateData: Record<string, any> = { status: 'Completed', end_km: endKm, distance, duration: durationStr };
      if (endTripForm.endFuelLiters > 0) updateData.fuel_liters_end = endTripForm.endFuelLiters;

      const { error: tripErr } = await supabase
        .from('trips')
        .update(updateData)
        .eq('id', ongoingTrip.id);
      if (tripErr) throw tripErr;

      if (ongoingTrip.vehicle_id) {
        await supabase.from('vehicles').update({ odometer: endKm }).eq('id', ongoingTrip.vehicle_id);
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
    setDriverFuelError(null);

    if (!vehicle?.id || !driver?.id) {
      setDriverFuelError("Vehicle or driver not assigned.");
      return;
    }
    if (fuelForm.liters <= 0) {
      setDriverFuelError("Fuel volume must be greater than 0 litres.");
      return;
    }
    if (fuelForm.cost <= 0) {
      setDriverFuelError("Total cost must be greater than ₹0.");
      return;
    }
    if (fuelForm.odometer < 0) {
      setDriverFuelError("Odometer reading cannot be negative.");
      return;
    }

    const currentVehicleOdo = Number(vehicle.odometer || 0);
    if (currentVehicleOdo > 0 && fuelForm.odometer < currentVehicleOdo) {
      setDriverFuelError(
        `Odometer reading (${fuelForm.odometer.toLocaleString()} km) is lower than vehicle's current odometer (${currentVehicleOdo.toLocaleString()} km). Decreasing odometer readings make fuel mileage calculations invalid. Please verify physical reading.`
      );
      return;
    }

    setSubmittingFuel(true);
    try {
      const payload: any = {
        vehicle_id: vehicle.id,
        driver_id: driver.id,
        liters: Number(fuelForm.liters),
        cost: Number(fuelForm.cost),
        odometer: Math.round(Number(fuelForm.odometer)),
        is_full_tank: Boolean(fuelForm.isFullTank),
      };

      const { error } = await supabase.from('fuel_purchase_logs').insert(payload);
      if (error && error.message?.includes('is_full_tank')) {
        delete payload.is_full_tank;
        const { error: retryError } = await supabase.from('fuel_purchase_logs').insert(payload);
        if (retryError) throw retryError;
      } else if (error) {
        throw error;
      }

      // Update vehicle physical odometer if entered reading is higher
      if (fuelForm.odometer > currentVehicleOdo) {
        await supabase
          .from('vehicles')
          .update({ odometer: Math.round(Number(fuelForm.odometer)) })
          .eq('id', vehicle.id);
      }

      alert("Fuel refill logged successfully!");
      setFuelForm({ liters: 0, cost: 0, odometer: 0, isFullTank: true });
      setDriverFuelError(null);
      load();
    } catch (err: any) {
      setDriverFuelError("Failed to log fuel: " + err.message);
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
      const startParts = (ongoingTrip.start || "").split(" · ");
      origin = startParts.length > 1 ? startParts[1] : startParts[0];
      destination = ongoingTrip.destination || "";
    } else if (vehicle?.route && vehicle.route !== "No route assigned") {
      const routeStr = vehicle.route;
      for (const sep of [" to ", " TO ", " -> ", " → ", " · "]) {
        if (routeStr.includes(sep)) {
          const parts = routeStr.split(sep);
          origin = parts[0].trim();
          destination = parts[1].trim();
          break;
        }
      }
      if (!origin) query = routeStr;
    }
    let url = "";
    if (origin && destination) {
      url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
    } else if (query || vehicle?.route) {
      url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || vehicle.route)}`;
    }
    if (url) window.open(url, "_blank");
    else alert("No route details available to view.");
  }

  async function load() {
    if (!user) { setLoading(false); return; }

    // Find driver record by profile_id (authenticated user) or driver name
    let dData: any = null;
    if (user.id) {
      const { data } = await supabase
        .from('drivers').select('*').eq('profile_id', user.id).maybeSingle();
      dData = data;
    }
    if (!dData && user.name) {
      const { data } = await supabase
        .from('drivers').select('*').ilike('name', user.name).maybeSingle();
      dData = data;
    }

    const resolvedDriver = dData ? {
      ...dData,
      score: Number(dData.score ?? 0),
      trips: Number(dData.trips ?? 0),
      total_km: Number(dData.total_km ?? 0),
      events: Number(dData.events ?? 0),
      rating: dData.rating || "N/A"
    } : { id: null, name: user.name, score: 0, rating: "N/A", trips: 0, total_km: 0, events: 0 };
    setDriver(resolvedDriver);

    let vehiclesArray: any[] = [];
    if (resolvedDriver.id) {
      try {
        const { data: assignments } = await supabase
          .from('vehicle_assignments')
          .select('vehicle_id, vehicles(*)')
          .eq('driver_id', resolvedDriver.id)
          .eq('is_active', true);

        if (assignments && assignments.length > 0) {
          vehiclesArray = assignments
            .filter((a: any) => a.vehicles)
            .map((a: any) => ({
              ...a.vehicles,
              driver_name: resolvedDriver.name,
              driver_id: resolvedDriver.id,
            }));
        }
      } catch (err) {
        // fallback
      }
    }

    if (vehiclesArray.length === 0) {
      try {
        const { data: vList } = await supabase
          .from('v_vehicles')
          .select('*')
          .ilike('driver_name', resolvedDriver.name);
        if (vList && vList.length > 0) {
          vehiclesArray = vList;
        }
      } catch (err) {
        // fallback
      }
    }

    setAssignedVehicles(vehiclesArray);

    const savedActiveId = localStorage.getItem("activeVehicleId");
    const activeV = vehiclesArray.find((x: any) => x.id === savedActiveId) || vehiclesArray[0];

    const resolvedVehicle = activeV ? {
      id: activeV.id, number: activeV.number || "Unassigned", type: activeV.type || "Tanker", model: activeV.model || "",
      route: activeV.route || '', insuranceExpiry: activeV.insurance_expiry || '',
      lastService: activeV.last_service || '', nextServiceKm: Number(activeV.next_service_km || 0),
      odometer: Number(activeV.odometer || 0), engineHours: Number(activeV.engine_hours || 0),
      status: activeV.status || "Idle", location: activeV.location || '',
      lat: Number(activeV.lat || 0), lng: Number(activeV.lng || 0),
      speed: Number(activeV.speed || 0), fuel: Number(activeV.fuel || 0),
      temperature: Number(activeV.temperature || 0), humidity: Number(activeV.humidity || 0),
      engineOn: activeV.engine_on || false, ignition: activeV.ignition || false,
      driver: activeV.driver_name || resolvedDriver.name, driverId: activeV.driver_id || resolvedDriver.id,
      lastUpdate: activeV.last_update ? new Date(activeV.last_update).toLocaleTimeString() : 'sec ago',
    } : {
      id: null, number: "Unassigned", type: "No Assigned Vehicle",
      status: "Offline", fuel: 0, speed: 0, temperature: 0, engineOn: false, route: "No route assigned", odometer: 0,
    };
    setVehicle(resolvedVehicle);

    if (resolvedVehicle.id) {
      const { data: aData } = await supabase
        .from('alerts').select('*').eq('vehicle_id', resolvedVehicle.id).limit(4);
      setAlerts(aData ? aData.map((a: any) => ({
        id: a.id, severity: a.severity, message: a.message, type: a.type,
        time: a.time ? new Date(a.time).toLocaleTimeString() : '1h ago', resolved: a.resolved,
      })) : []);
    } else {
      setAlerts([]);
    }

    if (resolvedDriver.id) {
      const { data: activeShiftData } = await supabase
        .from('driver_shifts').select('*').eq('driver_id', resolvedDriver.id).is('ended_at', null).maybeSingle();
      if (activeShiftData) setActiveShift(activeShiftData);

      const { data: history } = await supabase
        .from('driver_shifts').select('*').eq('driver_id', resolvedDriver.id)
        .is('ended_at', null).order('started_at', { ascending: false }).limit(5);
      if (history) setShiftHistory(history);

      const { data: scheds } = await supabase
        .from('driver_schedules').select('*, vehicles(number)').eq('driver_id', resolvedDriver.id)
        .gte('date', new Date().toISOString().split('T')[0]).order('date', { ascending: true }).limit(10);
      if (scheds) setSchedules(scheds);

      const { data: activeTrip } = await supabase
        .from('trips').select('*, vehicles(number)').eq('driver_id', resolvedDriver.id)
        .eq('status', 'Ongoing').maybeSingle();
      if (activeTrip) {
        setOngoingTrip(activeTrip);
        setEndTripForm({ endKm: (activeTrip.start_km || 0) + 1, endFuelLiters: 0 });
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
      if (cancelled) return;
      load();
      const channelId = `driver-portal-realtime-${Math.random().toString(36).substring(2, 9)}`;
      channel = supabase
        .channel(channelId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_assignments' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_telemetry' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_shifts' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_schedules' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => { if (!cancelled) load(); })
        .subscribe();
    }
    init();
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [user]);

  useEffect(() => {
    if (!activeShift) { setActiveSeconds(0); return; }
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - new Date(activeShift.started_at).getTime()) / 1000);
      setActiveSeconds(elapsed > 0 ? elapsed : 0);
    }, 1000);
    return () => clearInterval(interval);
  }, [activeShift]);

  async function handleStartShiftWithInspection(e: React.FormEvent) {
    e.preventDefault();
    if (!driver?.id) {
      alert("Error: Driver profile not found. Please contact admin.");
      return;
    }
    setSubmittingInspection(true);
    try {
      const passed = inspectionForm.tyres && inspectionForm.brakes && inspectionForm.lights && inspectionForm.cleanliness;
      
      // If a vehicle is assigned, log the pre-trip inspection
      if (vehicle?.id) {
        try {
          const { error: inspError } = await supabase.from('pre_trip_inspections').insert({
            driver_id: driver.id,
            vehicle_id: vehicle.id,
            tyres_ok: inspectionForm.tyres,
            brakes_ok: inspectionForm.brakes,
            lights_ok: inspectionForm.lights,
            cleanliness_ok: inspectionForm.cleanliness,
            passed,
            opening_km: inspectionForm.openingKm || null,
          });

          // If opening_km column doesn't exist yet on remote DB, retry without opening_km
          if (inspError && inspError.message?.includes('opening_km')) {
            await supabase.from('pre_trip_inspections').insert({
              driver_id: driver.id,
              vehicle_id: vehicle.id,
              tyres_ok: inspectionForm.tyres,
              brakes_ok: inspectionForm.brakes,
              lights_ok: inspectionForm.lights,
              cleanliness_ok: inspectionForm.cleanliness,
              passed,
            });
          }
        } catch (err) {
          console.warn("Pre-trip inspection notice:", err);
        }
      }

      // Start the driver shift
      let shiftData: any = null;
      try {
        const { data, error: shiftError } = await supabase.from('driver_shifts')
          .insert({
            driver_id: driver.id,
            vehicle_id: vehicle?.id || null,
            opening_km: inspectionForm.openingKm || null,
          })
          .select()
          .maybeSingle();

        if (shiftError && shiftError.message?.includes('opening_km')) {
          const { data: fallbackData } = await supabase.from('driver_shifts')
            .insert({ driver_id: driver.id, vehicle_id: vehicle?.id || null })
            .select()
            .maybeSingle();
          shiftData = fallbackData;
        } else {
          shiftData = data;
        }
      } catch (err: any) {
        throw new Error("Failed to start shift: " + err.message);
      }

      if (shiftData) setActiveShift(shiftData);
      setShowInspectionModal(false);
      setInspectionForm({ tyres: false, brakes: false, lights: false, cleanliness: false, openingKm: 0 });
      load();
    } catch (err: any) {
      alert("Notice: " + (err.message || "Failed to start shift"));
    } finally {
      setSubmittingInspection(false);
    }
  }

  async function handleToggleShift() {
    if (!driver?.id) {
      alert("Error: Your driver account has not been registered. Please ask your Admin to assign you to a vehicle first.");
      return;
    }
    if (activeShift) {
      const nowStr = new Date().toISOString();
      const elapsedHours = activeSeconds / 3600;
      const { error } = await supabase.from('driver_shifts')
        .update({ ended_at: nowStr, active_hours: Number(elapsedHours.toFixed(2)) })
        .eq('id', activeShift.id);
      if (error) alert("Failed to end shift: " + error.message);
      else { setActiveShift(null); load(); }
    } else {
      setShowInspectionModal(true);
    }
  }

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600).toString().padStart(2, '0');
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  if (!ready) return null;
  if (!user) return <Navigate to="/login" />;
  if (REDIRECT_MAP[user.role] !== "/driver") return <Navigate to={REDIRECT_MAP[user.role]} />;

  if (loading) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ background: "linear-gradient(160deg, oklch(0.14 0.06 258) 0%, oklch(0.20 0.09 265) 100%)" }}
      >
        <div className="bg-white/10 rounded-2xl p-4">
          <Logo className="h-12" />
        </div>
        <Loader2 className="h-6 w-6 text-white animate-spin" />
        <p className="text-white/60 text-sm">Loading driver portal…</p>
      </div>
    );
  }

  const openAlerts = alerts.filter((a) => !a.resolved).length;

  /* ─── TABS ─── */
  function renderTab() {
    switch (activeTab) {
      case "home":    return <HomeTab />;
      case "trip":    return <TripTab />;
      case "fuel":    return <FuelTab />;
      case "alerts":  return <AlertsTab />;
      case "schedule":return <ScheduleTab />;
    }
  }

  /* ─────────────── HOME TAB ─────────────── */
  function HomeTab() {
    return (
      <div className="space-y-4">
        {/* Vehicle card */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: "linear-gradient(135deg, oklch(0.38 0.20 264) 0%, oklch(0.28 0.14 255) 100%)",
            boxShadow: "0 8px 32px oklch(0.38 0.20 264 / 0.30)",
          }}
        >
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-white/70" />
                <span className="text-white/70 text-xs font-medium">My Vehicle</span>
              </div>
              {assignedVehicles.length > 1 && (
                <select
                  value={vehicle?.id || ""}
                  onChange={(e) => handleSwitchVehicle(e.target.value)}
                  className="bg-white/15 text-white text-xs border border-white/20 rounded-lg px-2 py-1 focus:outline-none"
                >
                  {assignedVehicles.map((v: any) => (
                    <option key={v.id} value={v.id} className="text-foreground bg-card">{v.number}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="text-white text-2xl font-bold tracking-tight">{vehicle.number}</div>
            <div className="text-white/60 text-sm mt-0.5">{vehicle.type} {vehicle.model ? `· ${vehicle.model}` : ''}</div>
            <div className="mt-3">
              <Badge status={vehicle.status}>{vehicle.status}</Badge>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 border-t border-white/10">
            {[
              { icon: Fuel, label: "Fuel", value: `${vehicle.fuel}%` },
              { icon: Gauge, label: "Speed", value: `${vehicle.speed}km/h` },
              { icon: Thermometer, label: "Temp", value: `${vehicle.temperature}°C` },
              { icon: Gauge, label: "Odometer", value: vehicle.odometer ? `${Number(vehicle.odometer).toLocaleString()}km` : '—' },
            ].map((s, i) => (
              <div key={i} className="flex flex-col items-center py-3 gap-0.5 border-r border-white/10 last:border-r-0">
                <s.icon className="h-4 w-4 text-white/50" />
                <div className="text-white font-bold text-sm">{s.value}</div>
                <div className="text-white/45 text-[10px]">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Shift card */}
        <div className="bg-card border border-border rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(10,20,60,0.06)" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${activeShift ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"}`} />
              <span className="text-sm font-semibold text-foreground">Active Shift</span>
            </div>
            {activeShift && (
              <div
                className="font-mono text-sm font-bold px-3 py-1 rounded-lg"
                style={{ background: "oklch(0.60 0.18 155 / 0.12)", color: "oklch(0.48 0.16 155)" }}
              >
                {formatTime(activeSeconds)}
              </div>
            )}
          </div>

          <div className="text-sm text-muted-foreground mb-4">
            {vehicle.route && vehicle.route !== "No route assigned"
              ? vehicle.route
              : activeShift ? "Shift in progress" : "Start a shift to log active hours"}
          </div>

          {/* Fuel progress */}
          <div className="mb-4">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-muted-foreground font-medium">Fuel level</span>
              <span className="font-semibold">{vehicle.fuel}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${vehicle.fuel}%`,
                  background: vehicle.fuel < 25
                    ? "oklch(0.58 0.24 25)"
                    : vehicle.fuel < 50
                    ? "oklch(0.76 0.17 72)"
                    : "oklch(0.60 0.18 155)",
                }}
              />
            </div>
          </div>

          <div className="flex gap-2.5">
            <button
              onClick={handleToggleShift}
              className="flex-1 h-11 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5"
              style={{
                background: activeShift
                  ? "linear-gradient(135deg, oklch(0.58 0.24 25), oklch(0.50 0.20 20))"
                  : "linear-gradient(135deg, oklch(0.44 0.22 264), oklch(0.36 0.18 258))",
                boxShadow: activeShift
                  ? "0 4px 12px oklch(0.58 0.24 25 / 0.30)"
                  : "0 4px 12px oklch(0.44 0.22 264 / 0.30)",
              }}
            >
              {activeShift
                ? <><StopCircle className="h-4 w-4" /> End Shift</>
                : <><Play className="h-4 w-4" /> Start Shift</>
              }
            </button>
            <button
              onClick={handleViewRoute}
              disabled={!ongoingTrip && (!vehicle?.route || vehicle.route === "No route assigned")}
              className="flex-1 h-11 rounded-xl text-sm font-semibold border border-border bg-card text-foreground flex items-center justify-center gap-2 hover:bg-muted/60 transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              <MapPin className="h-4 w-4" /> View Route
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Safety Score", value: `${driver.score}%`, sub: driver.rating, color: "oklch(0.60 0.18 155)" },
            { label: "Open Alerts", value: openAlerts, sub: `${alerts.length} total`, color: "oklch(0.58 0.24 25)" },
            { label: "Total Trips", value: driver.trips, sub: `${(driver.total_km / 1000).toFixed(1)}k km`, color: "oklch(0.42 0.18 264)" },
          ].map((s, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-4 text-center" style={{ boxShadow: "0 1px 3px rgba(10,20,60,0.06)" }}>
              <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[10px] font-semibold text-muted-foreground mt-0.5 leading-tight">{s.label}</div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Recent shift history */}
        {shiftHistory.length > 0 && (
          <div className="bg-card border border-border rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(10,20,60,0.06)" }}>
            <div className="px-5 py-3.5 border-b border-border">
              <div className="text-sm font-semibold text-foreground">Recent Shifts</div>
            </div>
            <div className="divide-y divide-border">
              {shiftHistory.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between px-5 py-3">
                  <div className="text-sm text-foreground">{new Date(s.started_at).toLocaleDateString()}</div>
                  <div className="text-sm font-semibold text-primary">{s.active_hours}h</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ─────────────── TRIP TAB ─────────────── */
  function TripTab() {
    return (
      <div className="space-y-4">
        {ongoingTrip ? (
          <div
            className="rounded-2xl p-5 border"
            style={{
              background: "linear-gradient(135deg, oklch(0.42 0.18 264 / 0.08), oklch(1 0 0))",
              borderColor: "oklch(0.42 0.18 264 / 0.25)",
              boxShadow: "0 1px 3px rgba(10,20,60,0.06)",
            }}
          >
            <div className="flex items-center gap-2 mb-4">
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span className="text-sm font-bold text-primary">Active Dispatch Trip</span>
            </div>

            <div className="space-y-3 mb-5">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Route</div>
                <div className="text-base font-semibold text-foreground">
                  {ongoingTrip.destination ? `${ongoingTrip.start} → ${ongoingTrip.destination}` : ongoingTrip.start}
                </div>
              </div>
              <div className="flex gap-6">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Vehicle</div>
                  <div className="text-sm font-semibold">{ongoingTrip.vehicles?.number || 'Assigned'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Start Odo</div>
                  <div className="text-sm font-semibold">{ongoingTrip.start_km} km</div>
                </div>
              </div>
            </div>

            <form onSubmit={handleEndManualTrip} className="space-y-3 pt-4 border-t border-border/60">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                  Closing Odometer (km) *
                </label>
                <input
                  type="number"
                  required
                  min={ongoingTrip.start_km || 0}
                  className="w-full h-12 px-4 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60"
                  value={endTripForm.endKm || ""}
                  onChange={(e) => setEndTripForm({ ...endTripForm, endKm: Number(e.target.value) })}
                  placeholder="e.g. 10300"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                  Ending Fuel (Liters) <span className="text-muted-foreground/50 normal-case font-normal">– optional</span>
                </label>
                <input
                  type="number" step="0.01"
                  min={0}
                  className="w-full h-12 px-4 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60"
                  value={endTripForm.endFuelLiters || ""}
                  onChange={(e) => setEndTripForm({ ...endTripForm, endFuelLiters: Number(e.target.value) })}
                  placeholder="e.g. 45.5"
                />
              </div>
              <button
                type="submit"
                disabled={submittingTrip}
                className="w-full h-12 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all"
                style={{ background: "linear-gradient(135deg, oklch(0.44 0.22 264), oklch(0.36 0.18 258))" }}
              >
                {submittingTrip ? <Loader2 className="animate-spin h-4 w-4" /> : <><CheckCircle2 className="h-4 w-4" /> Complete Trip & Log Data</>}
              </button>
            </form>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl p-8 text-center" style={{ boxShadow: "0 1px 3px rgba(10,20,60,0.06)" }}>
            <Route className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <div className="text-base font-semibold text-foreground mb-1">No Active Trip</div>
            <p className="text-sm text-muted-foreground">Main office will assign dispatches dynamically to your profile.</p>
          </div>
        )}
      </div>
    );
  }

  /* ─────────────── FUEL TAB ─────────────── */
  function FuelTab() {
    return (
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(10,20,60,0.06)" }}>
          <div className="flex items-center gap-2 mb-5">
            <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: "oklch(0.76 0.17 72 / 0.12)" }}>
              <Fuel className="h-4.5 w-4.5" style={{ color: "oklch(0.60 0.17 72)" }} />
            </div>
            <div>
              <div className="text-sm font-bold text-foreground">Log Fuel Refill</div>
              <div className="text-xs text-muted-foreground">Record vehicle refueling</div>
            </div>
          </div>

          <form onSubmit={handleLogFuelDriver} className="space-y-4">
            {driverFuelError && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive font-medium leading-relaxed">
                {driverFuelError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Liters *</label>
                <input
                  type="number" step="0.01" required
                  className="w-full h-12 px-4 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60"
                  value={fuelForm.liters || ""}
                  onChange={(e) => setFuelForm({ ...fuelForm, liters: Number(e.target.value) })}
                  placeholder="e.g. 50"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Cost (INR) *</label>
                <input
                  type="number" step="0.01" required
                  className="w-full h-12 px-4 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60"
                  value={fuelForm.cost || ""}
                  onChange={(e) => setFuelForm({ ...fuelForm, cost: Number(e.target.value) })}
                  placeholder="e.g. 4800"
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Odometer (km) *</label>
                {vehicle?.odometer ? (
                  <span className="text-[10px] text-muted-foreground">Current: {Number(vehicle.odometer).toLocaleString()} km</span>
                ) : null}
              </div>
              <input
                type="number" required
                className="w-full h-12 px-4 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60"
                value={fuelForm.odometer || ""}
                onChange={(e) => setFuelForm({ ...fuelForm, odometer: Number(e.target.value) })}
                placeholder="e.g. 10250"
              />
              {vehicle?.odometer && fuelForm.odometer > 0 && fuelForm.odometer < vehicle.odometer && (
                <div className="mt-1.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-600 dark:text-amber-400 font-medium leading-relaxed">
                  ⚠️ Warning: Entered odometer ({fuelForm.odometer.toLocaleString()} km) is lower than current vehicle odometer ({Number(vehicle.odometer).toLocaleString()} km).
                </div>
              )}
            </div>
            <div className="flex items-center gap-2.5 p-3 rounded-xl border border-border bg-muted/30">
              <input 
                type="checkbox" 
                id="driverIsFullTank"
                checked={fuelForm.isFullTank}
                onChange={(e) => setFuelForm({ ...fuelForm, isFullTank: e.target.checked })}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
              />
              <label htmlFor="driverIsFullTank" className="text-xs font-semibold text-foreground cursor-pointer select-none">
                Full Tank Refuel (Complete fill to auto-calculate mileage)
              </label>
            </div>
            <button
              type="submit"
              disabled={submittingFuel || !vehicle?.id}
              className="w-full h-12 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
              style={{ background: "linear-gradient(135deg, oklch(0.44 0.22 264), oklch(0.36 0.18 258))" }}
            >
              {submittingFuel ? <Loader2 className="animate-spin h-4 w-4" /> : <><Droplets className="h-4 w-4" /> Save Refuel Log</>}
            </button>
          </form>
        </div>

        {/* Current fuel stat */}
        <div className="bg-card border border-border rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(10,20,60,0.06)" }}>
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Current Level</div>
          <div className="flex items-end gap-2 mb-2">
            <div className="text-4xl font-bold" style={{ color: vehicle.fuel < 25 ? "oklch(0.58 0.24 25)" : vehicle.fuel < 50 ? "oklch(0.76 0.17 72)" : "oklch(0.60 0.18 155)" }}>
              {vehicle.fuel}%
            </div>
            <div className="text-muted-foreground text-sm mb-1.5">remaining</div>
          </div>
          <div className="h-3 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${vehicle.fuel}%`,
                background: vehicle.fuel < 25 ? "oklch(0.58 0.24 25)" : vehicle.fuel < 50 ? "oklch(0.76 0.17 72)" : "oklch(0.60 0.18 155)",
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  /* ─────────────── ALERTS TAB ─────────────── */
  function AlertsTab() {
    return (
      <div className="space-y-3">
        {alerts.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-8 text-center" style={{ boxShadow: "0 1px 3px rgba(10,20,60,0.06)" }}>
            <Bell className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <div className="text-base font-semibold text-foreground mb-1">No Alerts</div>
            <p className="text-sm text-muted-foreground">All clear — no active alerts for your vehicle.</p>
          </div>
        ) : (
          alerts.map((a) => (
            <div
              key={a.id}
              className="bg-card border border-border rounded-2xl p-4 flex items-start gap-3"
              style={{ boxShadow: "0 1px 3px rgba(10,20,60,0.06)", opacity: a.resolved ? 0.55 : 1 }}
            >
              <Badge status={a.severity}>{a.severity}</Badge>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground">{a.message}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{a.type} · {a.time}</div>
              </div>
              {a.resolved && <CheckCircle2 className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />}
            </div>
          ))
        )}
      </div>
    );
  }

  /* ─────────────── SCHEDULE TAB ─────────────── */
  function ScheduleTab() {
    return (
      <div className="space-y-3">
        {schedules.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-8 text-center" style={{ boxShadow: "0 1px 3px rgba(10,20,60,0.06)" }}>
            <Calendar className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <div className="text-base font-semibold text-foreground mb-1">No Upcoming Shifts</div>
            <p className="text-sm text-muted-foreground">Scheduled shifts will appear here.</p>
          </div>
        ) : (
          schedules.map((s: any) => (
            <div key={s.id} className="bg-card border border-border rounded-2xl p-4 flex items-center gap-4" style={{ boxShadow: "0 1px 3px rgba(10,20,60,0.06)" }}>
              <div
                className="h-12 w-12 rounded-xl flex flex-col items-center justify-center shrink-0"
                style={{ background: "oklch(0.42 0.18 264 / 0.08)" }}
              >
                <div className="text-[10px] font-bold uppercase" style={{ color: "oklch(0.42 0.18 264)" }}>
                  {new Date(s.date).toLocaleDateString([], { month: 'short' })}
                </div>
                <div className="text-lg font-bold" style={{ color: "oklch(0.42 0.18 264)" }}>
                  {new Date(s.date).getDate()}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground">{s.shift_type}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Vehicle: {s.vehicles?.number || 'Unassigned'}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
            </div>
          ))
        )}
      </div>
    );
  }

  /* ─── PRE-TRIP INSPECTION MODAL ─── */
  const INSPECTION_ITEMS = [
    { key: "tyres" as const, label: "Tyres Condition OK", desc: "Pressure, tread depth, no visible damage" },
    { key: "brakes" as const, label: "Brakes Working OK", desc: "Pads, responsiveness & fluid levels" },
    { key: "lights" as const, label: "Lights & Indicators OK", desc: "Headlights, indicators, brake lights" },
    { key: "cleanliness" as const, label: "Cabin & Cargo Clean", desc: "Free of waste, properly sanitised" },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">

      {/* ── TOP HEADER ── */}
      <header
        className="safe-top shrink-0"
        style={{
          background: "linear-gradient(135deg, oklch(0.16 0.07 258) 0%, oklch(0.22 0.09 265) 100%)",
        }}
      >
        <div className="flex items-center gap-3 px-4 py-3.5">
          <div className="bg-white/12 rounded-xl p-2 shrink-0">
            <Logo className="h-8" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white/55 text-[10px] font-semibold uppercase tracking-widest">Driver Portal</div>
            <div className="text-white font-bold text-base leading-tight truncate">{user.name}</div>
          </div>
          <div className="flex items-center gap-2">
            {openAlerts > 0 && (
              <button
                onClick={() => setActiveTab("alerts")}
                className="relative p-2 rounded-xl bg-white/10 text-white transition-colors hover:bg-white/20 min-h-0 min-w-0"
              >
                <Bell className="h-5 w-5" />
                <span
                  className="absolute -top-1 -right-1 h-4.5 w-4.5 text-white text-[9px] font-bold flex items-center justify-center rounded-full"
                  style={{ background: "oklch(0.58 0.24 25)", minWidth: "18px", height: "18px" }}
                >
                  {openAlerts}
                </span>
              </button>
            )}
            <button
              onClick={() => { logout(); nav("/login"); }}
              className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors min-h-0 min-w-0"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* ── SCROLLABLE BODY ── */}
      <main className="flex-1 overflow-y-auto px-4 pt-4 pb-24 max-w-lg mx-auto w-full">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-foreground">
            {TABS.find((t) => t.id === activeTab)?.label}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        {renderTab()}
      </main>

      {/* ── BOTTOM NAV ── */}
      <nav
        className="fixed bottom-0 left-0 right-0 safe-bottom z-40 flex"
        style={{
          background: "rgba(255,255,255,0.94)",
          backdropFilter: "blur(16px) saturate(180%)",
          WebkitBackdropFilter: "blur(16px) saturate(180%)",
          borderTop: "1px solid oklch(0.90 0.012 240)",
          boxShadow: "0 -4px 20px rgba(10,20,60,0.08)",
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          const badge = tab.id === "alerts" && openAlerts > 0;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex-1 flex flex-col items-center justify-center py-2.5 gap-1 transition-all relative min-h-0"
              style={{ minHeight: "56px" }}
            >
              <div className="relative">
                <Icon
                  className="h-5 w-5 transition-all"
                  style={{ color: isActive ? "oklch(0.42 0.18 264)" : "oklch(0.60 0.02 240)" }}
                  strokeWidth={isActive ? 2.3 : 1.8}
                />
                {badge && (
                  <span
                    className="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 text-white text-[8px] font-bold flex items-center justify-center rounded-full"
                    style={{ background: "oklch(0.58 0.24 25)" }}
                  >
                    {openAlerts}
                  </span>
                )}
              </div>
              <span
                className="text-[10px] font-semibold transition-all"
                style={{ color: isActive ? "oklch(0.42 0.18 264)" : "oklch(0.60 0.02 240)" }}
              >
                {tab.label}
              </span>
              {isActive && (
                <div
                  className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full"
                  style={{ background: "oklch(0.42 0.18 264)" }}
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* ── PRE-TRIP INSPECTION MODAL ── */}
      {showInspectionModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 z-50">
          <div
            className="w-full max-w-sm rounded-2xl overflow-hidden"
            style={{
              background: "white",
              boxShadow: "0 24px 64px rgba(10,20,60,0.25)",
            }}
          >
            {/* Modal header */}
            <div
              className="px-5 py-4"
              style={{ background: "linear-gradient(135deg, oklch(0.16 0.07 258), oklch(0.22 0.09 265))" }}
            >
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-white" />
                <div>
                  <div className="text-white font-bold text-base">Pre-Trip Inspection</div>
                  <div className="text-white/60 text-xs">Verify vehicle condition before starting</div>
                </div>
              </div>
            </div>

            <form onSubmit={handleStartShiftWithInspection} className="p-5 space-y-3">
              {INSPECTION_ITEMS.map((item) => (
                <label
                  key={item.key}
                  className="flex items-start gap-3 p-3.5 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={inspectionForm[item.key]}
                    onChange={(e) => setInspectionForm({ ...inspectionForm, [item.key]: e.target.checked })}
                    className="h-4.5 w-4.5 mt-0.5 rounded text-primary accent-primary shrink-0"
                  />
                  <div>
                    <div className="text-sm font-semibold text-foreground">{item.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{item.desc}</div>
                  </div>
                </label>
              ))}

              {/* Opening Odometer Field */}
              <div className="p-3.5 rounded-xl border border-border bg-muted/30">
                <label className="block text-sm font-semibold text-foreground mb-1">Opening Odometer (km) *</label>
                <p className="text-xs text-muted-foreground mb-2">Enter current vehicle odometer reading before departure</p>
                <input
                  type="number"
                  required
                  min={0}
                  className="w-full h-11 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60"
                  value={inspectionForm.openingKm || ""}
                  onChange={(e) => setInspectionForm({ ...inspectionForm, openingKm: Number(e.target.value) })}
                  placeholder="e.g. 10250"
                />
              </div>

              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowInspectionModal(false);
                    setInspectionForm({ tyres: false, brakes: false, lights: false, cleanliness: false, openingKm: 0 });
                  }}
                  className="flex-1 h-12 rounded-xl text-sm font-semibold border border-border bg-card text-foreground hover:bg-muted/60 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingInspection}
                  className="flex-1 h-12 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all"
                  style={{ background: "linear-gradient(135deg, oklch(0.44 0.22 264), oklch(0.36 0.18 258))" }}
                >
                  {submittingInspection
                    ? <Loader2 className="animate-spin h-4 w-4" />
                    : <><CheckCircle2 className="h-4 w-4" /> Certify & Start</>
                  }
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default DriverPage;
