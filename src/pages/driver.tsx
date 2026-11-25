import { Navigate, useNavigate } from "react-router-dom";
import { useAuth, REDIRECT_MAP } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import {
  Truck, Fuel, Thermometer, Gauge, MapPin, Bell, ShieldCheck, Play,
  LogOut, Loader2, Calendar, Route, Home, StopCircle,
  CheckCircle2, ChevronRight, Droplets, FileText, Lock, AlertCircle, Clock,
} from "lucide-react";
import { Badge } from "@/components/ui-kit";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useVehicles } from "@/hooks/useVehicleTracking";
import { getTodayIstDateString } from "@/lib/odometerTrackingEngine";
import {
  type VehicleOperationTripRecord,
  type ValidationFieldErrors,
  getCurrentIstTimeString,
  formatIsoToIstTime,
  resolveAuthoritativeOutKm,
  computeRunningKm,
  computeTripKmpl,
  parseStrictNumericInput,
  validateTripStart,
  validateTripCloseStatement,
  submitStartDriverTripStatement,
  submitCloseDriverTripStatement,
  submitDriverFuelRefillRpc,
} from "@/lib/driverOperationStatement";

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
  const [ongoingTrip, setOngoingTrip] = useState<VehicleOperationTripRecord | null>(null);
  const [closedTrips, setClosedTrips] = useState<VehicleOperationTripRecord[]>([]);
  const [submittingTrip, setSubmittingTrip] = useState(false);
  const [assignedVehicles, setAssignedVehicles] = useState<any[]>([]);
  const [liveHardwareOdometer, setLiveHardwareOdometer] = useState<number>(0);

  // Vehicle Operation Statement states (Start & Close)
  const [startStatementForm, setStartStatementForm] = useState({
    route: "",
    salesmanName: "",
    outDate: getTodayIstDateString(),
    outTime: getCurrentIstTimeString(),
    notes: "",
  });
  const [closeStatementForm, setCloseStatementForm] = useState({
    inKm: "",
    inDate: getTodayIstDateString(),
    inTime: getCurrentIstTimeString(),
    dieselLitres: "",
    fuelAmount: "",
    salesmanName: "",
    notes: "",
  });
  const [statementErrors, setStatementErrors] = useState<ValidationFieldErrors>({});
  const [statementBanner, setStatementBanner] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [showCloseConfirmModal, setShowCloseConfirmModal] = useState(false);

  const liveVehicles = useVehicles();

  const activeLiveHardwareOdo = useMemo(() => {
    if (!vehicle?.id) return liveHardwareOdometer;
    const matchedLive = liveVehicles.find(
      (lv) =>
        lv.id === vehicle.id ||
        (vehicle.deviceId && lv.deviceId === vehicle.deviceId) ||
        (vehicle.number && lv.number === vehicle.number)
    );
    const liveHw = Number(matchedLive?.hardwareOdometer || 0);
    return Math.max(liveHardwareOdometer, Number.isFinite(liveHw) ? liveHw : 0);
  }, [liveVehicles, vehicle?.id, vehicle?.deviceId, vehicle?.number, liveHardwareOdometer]);

  const authoritativeVehicleOdo = useMemo(
    () => resolveAuthoritativeOutKm(vehicle?.odometer, activeLiveHardwareOdo),
    [vehicle?.odometer, activeLiveHardwareOdo]
  );

  async function handleStartTripStatement(e: React.FormEvent) {
    e.preventDefault();
    setStatementBanner(null);
    setStatementErrors({});

    const check = validateTripStart({
      vehicleId: vehicle?.id,
      driverId: driver?.id,
      assignedVehicleIds: assignedVehicles.map((v) => v.id).filter(Boolean),
      vehicleOdometer: vehicle?.odometer,
      hardwareOdometer: activeLiveHardwareOdo,
      outDate: startStatementForm.outDate,
      outTime: startStatementForm.outTime,
      hasActiveVehicleTrip: Boolean(ongoingTrip && ongoingTrip.vehicle_id === vehicle?.id),
      hasActiveDriverTrip: Boolean(ongoingTrip),
    });

    if (!check.valid) {
      setStatementBanner({ type: "error", message: check.error || "Unable to start trip." });
      return;
    }

    setSubmittingTrip(true);
    try {
      const res = await submitStartDriverTripStatement(supabase, {
        vehicleId: vehicle.id,
        route: startStatementForm.route || vehicle.route,
        salesmanName: startStatementForm.salesmanName,
        outDate: startStatementForm.outDate,
        outTime: startStatementForm.outTime,
        notes: startStatementForm.notes,
      });

      if (!res.ok) {
        setStatementBanner({ type: "error", message: res.error || "Failed to start trip." });
        return;
      }

      setStatementBanner({
        type: "success",
        message: `Trip Started! Out KM locked at ${(res.outKm ?? check.outKm).toLocaleString()} KM.`,
      });
      setStartStatementForm((prev) => ({
        ...prev,
        salesmanName: "",
        notes: "",
        outDate: getTodayIstDateString(),
        outTime: getCurrentIstTimeString(),
      }));
      await load();
    } catch (err: any) {
      setStatementBanner({ type: "error", message: err?.message || "Failed to start trip." });
    } finally {
      setSubmittingTrip(false);
    }
  }

  function handlePrepareCloseStatement(e: React.FormEvent) {
    e.preventDefault();
    setStatementBanner(null);

    if (!ongoingTrip || !driver?.id) {
      setStatementErrors({ general: "No active trip found for your account." });
      return;
    }

    const outKm = Number(ongoingTrip.start_km ?? authoritativeVehicleOdo ?? 0);
    const outDate = ongoingTrip.out_date || ongoingTrip.date || getTodayIstDateString();
    const outTime =
      ongoingTrip.out_time || formatIsoToIstTime(ongoingTrip.started_at || ongoingTrip.created_at) || "00:00";

    const validation = validateTripCloseStatement({
      tripId: ongoingTrip.id,
      tripStatus: ongoingTrip.status,
      tripClosedAt: ongoingTrip.closed_at,
      tripDriverId: ongoingTrip.driver_id,
      tripVehicleId: ongoingTrip.vehicle_id,
      authenticatedDriverId: driver.id,
      assignedVehicleIds: assignedVehicles.map((v) => v.id).filter(Boolean),
      outKm,
      inKmRaw: closeStatementForm.inKm,
      currentVehicleOdometer: vehicle?.odometer,
      hardwareOdometer: activeLiveHardwareOdo,
      outDate,
      outTime,
      inDate: closeStatementForm.inDate,
      inTime: closeStatementForm.inTime,
      dieselLitresRaw: closeStatementForm.dieselLitres,
      fuelAmountRaw: closeStatementForm.fuelAmount,
    });

    if (!validation.valid) {
      setStatementErrors(validation.errors);
      if (validation.errors.general) {
        setStatementBanner({ type: "error", message: validation.errors.general });
      }
      return;
    }

    setStatementErrors({});
    setShowCloseConfirmModal(true);
  }

  async function handleConfirmCloseStatement() {
    if (submittingTrip || !ongoingTrip || !driver?.id) return;

    const outKm = Number(ongoingTrip.start_km ?? authoritativeVehicleOdo ?? 0);
    const outDate = ongoingTrip.out_date || ongoingTrip.date || getTodayIstDateString();
    const outTime =
      ongoingTrip.out_time || formatIsoToIstTime(ongoingTrip.started_at || ongoingTrip.created_at) || "00:00";

    const validation = validateTripCloseStatement({
      tripId: ongoingTrip.id,
      tripStatus: ongoingTrip.status,
      tripClosedAt: ongoingTrip.closed_at,
      tripDriverId: ongoingTrip.driver_id,
      tripVehicleId: ongoingTrip.vehicle_id,
      authenticatedDriverId: driver.id,
      assignedVehicleIds: assignedVehicles.map((v) => v.id).filter(Boolean),
      outKm,
      inKmRaw: closeStatementForm.inKm,
      currentVehicleOdometer: vehicle?.odometer,
      hardwareOdometer: activeLiveHardwareOdo,
      outDate,
      outTime,
      inDate: closeStatementForm.inDate,
      inTime: closeStatementForm.inTime,
      dieselLitresRaw: closeStatementForm.dieselLitres,
      fuelAmountRaw: closeStatementForm.fuelAmount,
    });

    if (!validation.valid || !validation.parsed) {
      setShowCloseConfirmModal(false);
      setStatementErrors(validation.errors);
      if (validation.errors.general) {
        setStatementBanner({ type: "error", message: validation.errors.general });
      }
      return;
    }

    setSubmittingTrip(true);
    try {
      const res = await submitCloseDriverTripStatement(supabase, {
        tripId: ongoingTrip.id,
        inKm: validation.parsed.inKm,
        inDate: validation.parsed.inDate,
        inTime: validation.parsed.inTime,
        dieselLitres: validation.parsed.dieselLitres,
        fuelAmount: validation.parsed.fuelAmount,
        salesmanName: closeStatementForm.salesmanName,
        notes: closeStatementForm.notes,
        deviceId: vehicle?.deviceId,
      });

      if (!res.ok) {
        setShowCloseConfirmModal(false);
        setStatementErrors({ general: res.error, inKm: res.error });
        setStatementBanner({
          type: "error",
          message: res.error || "Failed to close trip.",
        });
        return;
      }

      const finalOdo = res.vehicleOdometer ?? validation.parsed.inKm;
      setShowCloseConfirmModal(false);
      setStatementErrors({});
      setStatementBanner({
        type: "success",
        message: `Trip Closed Successfully! Vehicle Odometer Updated to ${finalOdo.toLocaleString()} KM.`,
      });
      setOngoingTrip(null);
      setCloseStatementForm({
        inKm: "",
        inDate: getTodayIstDateString(),
        inTime: getCurrentIstTimeString(),
        dieselLitres: "",
        fuelAmount: "",
        salesmanName: "",
        notes: "",
      });
      await load();
    } catch (err: any) {
      setShowCloseConfirmModal(false);
      setStatementBanner({
        type: "error",
        message: err?.message || "Database update failed while closing trip.",
      });
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
      const res = await submitDriverFuelRefillRpc(supabase, {
        vehicleId: vehicle.id,
        liters: Number(fuelForm.liters),
        cost: Number(fuelForm.cost),
        odometer: Math.round(Number(fuelForm.odometer) * 100) / 100,
        isFullTank: Boolean(fuelForm.isFullTank),
        deviceId: vehicle.deviceId,
      });

      if (!res.ok) {
        throw new Error(res.error || "Failed to log fuel refill.");
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
      deviceId: activeV.device_id || "",
      lastUpdate: activeV.last_update ? new Date(activeV.last_update).toLocaleTimeString() : 'sec ago',
    } : {
      id: null, number: "Unassigned", type: "No Assigned Vehicle",
      status: "Offline", fuel: 0, speed: 0, temperature: 0, engineOn: false, route: "No route assigned", odometer: 0,
    };
    setVehicle(resolvedVehicle);
    setStartStatementForm((prev) => ({
      ...prev,
      route: prev.route || resolvedVehicle.route || "",
    }));

    if (resolvedVehicle.id) {
      const [{ data: aData }, { data: vtData }] = await Promise.all([
        supabase.from('alerts').select('*').eq('vehicle_id', resolvedVehicle.id).limit(4),
        supabase.from('vehicle_telemetry').select('odometer').eq('vehicle_id', resolvedVehicle.id).maybeSingle(),
      ]);
      setAlerts(aData ? aData.map((a: any) => ({
        id: a.id, severity: a.severity, message: a.message, type: a.type,
        time: a.time ? new Date(a.time).toLocaleTimeString() : '1h ago', resolved: a.resolved,
      })) : []);
      setLiveHardwareOdometer(vtData?.odometer != null ? Number(vtData.odometer) || 0 : 0);
    } else {
      setAlerts([]);
      setLiveHardwareOdometer(0);
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

      const [{ data: activeTrip }, { data: completedTripsData }] = await Promise.all([
        supabase
          .from('trips')
          .select('*, vehicles(number, route, odometer)')
          .eq('driver_id', resolvedDriver.id)
          .eq('status', 'Ongoing')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('trips')
          .select('*, vehicles(number)')
          .eq('driver_id', resolvedDriver.id)
          .eq('status', 'Completed')
          .order('date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      if (activeTrip) {
        setOngoingTrip(activeTrip as VehicleOperationTripRecord);
        setCloseStatementForm((prev) => ({
          ...prev,
          inDate: prev.inDate || getTodayIstDateString(),
          inTime: getCurrentIstTimeString(),
          salesmanName: prev.salesmanName || activeTrip.salesman_name || "",
        }));
      } else {
        setOngoingTrip(null);
      }
      setClosedTrips((completedTripsData || []) as VehicleOperationTripRecord[]);
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
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => { if (!cancelled) load(); })
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
      case "trip":    return renderTripTab();
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

        {/* Unassigned vehicle explanation */}
        {!vehicle?.id && (
          <div className="rounded-2xl p-4 border border-amber-200 bg-amber-50 text-amber-900 text-xs flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">No Vehicle Assigned to {driver?.name || user?.name}</div>
              <p className="mt-0.5 text-amber-800/90 leading-relaxed">
                This driver account has no active vehicle assignment in Supabase yet. Ask your Fleet Admin to assign a vehicle to <strong>{driver?.name || user?.name}</strong> in Drivers Directory or Vehicles Directory.
              </p>
            </div>
          </div>
        )}

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

          <button
            type="button"
            onClick={() => setActiveTab("trip")}
            className="mt-2.5 w-full h-11 rounded-xl text-sm font-semibold border border-indigo-200 bg-indigo-50/80 text-indigo-800 flex items-center justify-center gap-2 hover:bg-indigo-100 transition-all"
          >
            <FileText className="h-4 w-4" />
            {ongoingTrip ? "Close Active Trip & Update Odometer" : "Open Vehicle Operation Statement"}
          </button>
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

  /* ─────────────── TRIP / VEHICLE OPERATION STATEMENT TAB ─────────────── */
  function renderTripTab() {
    const activeOutKm = Number(ongoingTrip?.start_km ?? authoritativeVehicleOdo ?? 0);
    const activeOutDate = ongoingTrip?.out_date || ongoingTrip?.date || getTodayIstDateString();
    const activeOutTime =
      ongoingTrip?.out_time ||
      formatIsoToIstTime(ongoingTrip?.started_at || ongoingTrip?.created_at) ||
      "—";
    const activeRouteLabel = ongoingTrip
      ? ongoingTrip.destination
        ? `${ongoingTrip.start} → ${ongoingTrip.destination}`
        : ongoingTrip.start
      : vehicle?.route || "No route assigned";

    const parsedInKmPreview = parseStrictNumericInput(closeStatementForm.inKm);
    const hasValidPositiveInKm = parsedInKmPreview.valid && parsedInKmPreview.value > 0;
    const isInKmBelowOut = hasValidPositiveInKm && parsedInKmPreview.value < activeOutKm;
    const liveRunningKm =
      hasValidPositiveInKm && !isInKmBelowOut
        ? computeRunningKm(activeOutKm, parsedInKmPreview.value)
        : null;

    const parsedDieselPreview = parseStrictNumericInput(closeStatementForm.dieselLitres);
    const liveDieselNum =
      parsedDieselPreview.valid && parsedDieselPreview.value > 0 ? parsedDieselPreview.value : 0;
    const liveKmpl =
      liveRunningKm !== null ? computeTripKmpl(liveRunningKm, liveDieselNum) : null;

    return (
      <div className="space-y-4">
        {statementBanner && (
          <div
            role="alert"
            className={`rounded-2xl p-4 border text-sm font-medium flex items-start gap-3 ${
              statementBanner.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-red-50 border-red-200 text-red-900"
            }`}
          >
            {statementBanner.type === "success" ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">{statementBanner.message}</div>
          </div>
        )}

        {ongoingTrip ? (
          <div
            className="rounded-2xl p-5 border bg-card space-y-5"
            style={{
              borderColor: "oklch(0.42 0.18 264 / 0.28)",
              boxShadow: "0 2px 10px rgba(10,20,60,0.06)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-border/70">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <div>
                  <div className="text-sm font-bold text-foreground">Vehicle Operation Statement</div>
                  <div className="text-[11px] text-muted-foreground">Active Trip · Close &amp; Update Odometer</div>
                </div>
              </div>
              <Badge status="Moving">Trip Open</Badge>
            </div>

            {/* Auto-populated Read-only Trip Identity Block */}
            <div className="grid grid-cols-2 gap-3 text-xs bg-muted/35 p-3.5 rounded-xl border border-border/60">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Vehicle Number</div>
                <div className="text-sm font-bold text-foreground mt-0.5">
                  {ongoingTrip.vehicles?.number || vehicle?.number || "Assigned"}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Statement Date</div>
                <div className="text-sm font-semibold text-foreground mt-0.5">{ongoingTrip.date || activeOutDate}</div>
              </div>
              <div className="col-span-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Route</div>
                <div className="text-sm font-semibold text-foreground mt-0.5">{activeRouteLabel}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Driver Name</div>
                <div className="text-sm font-semibold text-foreground mt-0.5">{driver?.name || user?.name}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Out Date · Out Time</div>
                <div className="text-sm font-semibold text-foreground mt-0.5">
                  {activeOutDate} · {activeOutTime}
                </div>
              </div>
            </div>

            <form onSubmit={handlePrepareCloseStatement} className="space-y-4">
              {/* Read-only Out KM + Highlighted In KM */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                    <span>Out KM (Starting)</span>
                    <span className="inline-flex items-center gap-1 text-[9px] text-slate-500">
                      <Lock className="h-2.5 w-2.5" /> Read-Only
                    </span>
                  </label>
                  <input
                    type="text"
                    readOnly
                    tabIndex={-1}
                    value={`${activeOutKm.toLocaleString()} km`}
                    aria-label="Out KM"
                    className="w-full h-14 px-4 rounded-xl border border-border bg-muted/70 text-base font-bold text-muted-foreground cursor-not-allowed select-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-primary mb-1.5">
                    In KM (Closing Odometer) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    required
                    aria-label="In KM"
                    value={closeStatementForm.inKm}
                    onChange={(e) => {
                      setCloseStatementForm((prev) => ({ ...prev, inKm: e.target.value }));
                      if (statementErrors.inKm || statementErrors.general) {
                        setStatementErrors((prev) => ({ ...prev, inKm: undefined, general: undefined }));
                      }
                    }}
                    placeholder={`>= ${activeOutKm}`}
                    className={`w-full h-14 px-4 rounded-xl border-2 text-lg font-extrabold bg-background focus:outline-none focus:ring-2 ${
                      statementErrors.inKm || isInKmBelowOut
                        ? "border-red-500 focus:ring-red-500/25 text-red-700"
                        : "border-primary/60 focus:border-primary focus:ring-primary/25 text-foreground"
                    }`}
                  />
                  {statementErrors.inKm ? (
                    <p className="mt-1.5 text-xs font-semibold text-red-600">{statementErrors.inKm}</p>
                  ) : isInKmBelowOut ? (
                    <p className="mt-1.5 text-xs font-semibold text-red-600">
                      Invalid Odometer Reading! In KM cannot be less than Out KM.
                    </p>
                  ) : null}
                </div>
              </div>

              {/* Instant Auto-Calculated Running KMs + KMPL Banner */}
              <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-indigo-50/80 border border-indigo-200">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">Running KMs</div>
                  <div className="text-xl font-extrabold text-indigo-950 mt-0.5">
                    {liveRunningKm !== null ? `${liveRunningKm.toLocaleString()} km` : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">Estimated KMPL</div>
                  <div className="text-xl font-extrabold text-indigo-950 mt-0.5">
                    {liveKmpl !== null ? `${liveKmpl.toFixed(2)} km/L` : "—"}
                  </div>
                </div>
              </div>

              {/* In Date & In Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                    In Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={closeStatementForm.inDate}
                    min={activeOutDate}
                    onChange={(e) => {
                      setCloseStatementForm((prev) => ({ ...prev, inDate: e.target.value }));
                      setStatementErrors((prev) => ({ ...prev, inDate: undefined, inTime: undefined }));
                    }}
                    className="w-full h-12 px-3 rounded-xl border border-border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {statementErrors.inDate && (
                    <p className="mt-1 text-xs font-semibold text-red-600">{statementErrors.inDate}</p>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                    In Time *
                  </label>
                  <input
                    type="time"
                    required
                    value={closeStatementForm.inTime}
                    onChange={(e) => {
                      setCloseStatementForm((prev) => ({ ...prev, inTime: e.target.value }));
                      setStatementErrors((prev) => ({ ...prev, inTime: undefined }));
                    }}
                    className="w-full h-12 px-3 rounded-xl border border-border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {statementErrors.inTime && (
                    <p className="mt-1 text-xs font-semibold text-red-600">{statementErrors.inTime}</p>
                  )}
                </div>
              </div>

              {/* Diesel (Litres) & Amount */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                    Diesel (Litres)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    min={0}
                    value={closeStatementForm.dieselLitres}
                    onChange={(e) => {
                      setCloseStatementForm((prev) => ({ ...prev, dieselLitres: e.target.value }));
                      setStatementErrors((prev) => ({ ...prev, dieselLitres: undefined }));
                    }}
                    placeholder="0.00"
                    className="w-full h-12 px-3 rounded-xl border border-border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {statementErrors.dieselLitres && (
                    <p className="mt-1 text-xs font-semibold text-red-600">{statementErrors.dieselLitres}</p>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                    Amount (INR)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    min={0}
                    value={closeStatementForm.fuelAmount}
                    onChange={(e) => {
                      setCloseStatementForm((prev) => ({ ...prev, fuelAmount: e.target.value }));
                      setStatementErrors((prev) => ({ ...prev, fuelAmount: undefined }));
                    }}
                    placeholder="0.00"
                    className="w-full h-12 px-3 rounded-xl border border-border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {statementErrors.fuelAmount && (
                    <p className="mt-1 text-xs font-semibold text-red-600">{statementErrors.fuelAmount}</p>
                  )}
                </div>
              </div>

              {/* Optional Salesman */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                  Salesman <span className="text-muted-foreground/60 normal-case font-normal">– optional</span>
                </label>
                <input
                  type="text"
                  value={closeStatementForm.salesmanName}
                  onChange={(e) =>
                    setCloseStatementForm((prev) => ({ ...prev, salesmanName: e.target.value }))
                  }
                  placeholder="Enter salesman name if accompanied"
                  className="w-full h-12 px-3.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              {statementErrors.general && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
                  {statementErrors.general}
                </div>
              )}

              <button
                type="submit"
                disabled={submittingTrip}
                className="w-full h-13 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all hover:opacity-95 disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, oklch(0.44 0.22 264), oklch(0.36 0.18 258))" }}
              >
                {submittingTrip ? (
                  <Loader2 className="animate-spin h-4 w-4" />
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" /> Close Trip &amp; Update Odometer
                  </>
                )}
              </button>
            </form>
          </div>
        ) : (
          <div
            className="bg-card border border-border rounded-2xl p-5 space-y-4"
            style={{ boxShadow: "0 1px 3px rgba(10,20,60,0.06)" }}
          >
            <div className="flex items-center gap-2.5 pb-3 border-b border-border/70">
              <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-foreground">Start Trip · Vehicle Operation Statement</div>
                <div className="text-xs text-muted-foreground">
                  Out KM is automatically locked from {vehicle?.number || "assigned vehicle"}
                </div>
              </div>
            </div>

            <form onSubmit={handleStartTripStatement} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3 text-xs bg-muted/35 p-3.5 rounded-xl border border-border/60">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Vehicle Number</div>
                  <div className="text-sm font-bold text-foreground mt-0.5">{vehicle?.number || "Unassigned"}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Driver Name</div>
                  <div className="text-sm font-semibold text-foreground mt-0.5">{driver?.name || user?.name}</div>
                </div>
              </div>

              <div>
                <label className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                  <span>Out KM (Auto from Vehicle Odometer)</span>
                  <span className="inline-flex items-center gap-1 text-[9px] text-slate-500">
                    <Lock className="h-2.5 w-2.5" /> Read-Only
                  </span>
                </label>
                <input
                  type="text"
                  readOnly
                  tabIndex={-1}
                  value={`${authoritativeVehicleOdo.toLocaleString()} km`}
                  aria-label="Out KM"
                  className="w-full h-12 px-3.5 rounded-xl border border-border bg-muted/70 text-base font-bold text-foreground cursor-not-allowed select-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                  Route *
                </label>
                <input
                  type="text"
                  required
                  value={startStatementForm.route}
                  onChange={(e) => setStartStatementForm((prev) => ({ ...prev, route: e.target.value }))}
                  placeholder="e.g. Nagercoil Plant to Marthandam Loop"
                  className="w-full h-12 px-3.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                    Out Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={startStatementForm.outDate}
                    onChange={(e) => setStartStatementForm((prev) => ({ ...prev, outDate: e.target.value }))}
                    className="w-full h-12 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                    Out Time *
                  </label>
                  <input
                    type="time"
                    required
                    value={startStatementForm.outTime}
                    onChange={(e) => setStartStatementForm((prev) => ({ ...prev, outTime: e.target.value }))}
                    className="w-full h-12 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                  Salesman <span className="text-muted-foreground/60 normal-case font-normal">– optional</span>
                </label>
                <input
                  type="text"
                  value={startStatementForm.salesmanName}
                  onChange={(e) =>
                    setStartStatementForm((prev) => ({ ...prev, salesmanName: e.target.value }))
                  }
                  placeholder="Enter salesman name"
                  className="w-full h-12 px-3.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <button
                type="submit"
                disabled={submittingTrip || !vehicle?.id || !driver?.id}
                className="w-full h-13 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, oklch(0.44 0.22 264), oklch(0.36 0.18 258))" }}
              >
                {submittingTrip ? (
                  <Loader2 className="animate-spin h-4 w-4" />
                ) : (
                  <>
                    <Play className="h-4 w-4" /> Start Trip &amp; Lock Out KM
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* Read-Only Closed Statements History */}
        <div
          className="bg-card border border-border rounded-2xl overflow-hidden"
          style={{ boxShadow: "0 1px 3px rgba(10,20,60,0.06)" }}
        >
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <div className="text-sm font-bold text-foreground">Closed Operation Statements</div>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Lock className="h-3 w-3" /> Read-Only
            </span>
          </div>
          {closedTrips.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No closed trip statements yet. Completed trips lock automatically here.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {closedTrips.map((t) => (
                <div key={t.id} className="p-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-foreground">
                      {t.vehicles?.number || vehicle?.number} · {t.in_date || t.date}
                    </div>
                    <Badge status="Completed">Closed</Badge>
                  </div>
                  <div className="text-muted-foreground">
                    {t.destination ? `${t.start} → ${t.destination}` : t.start}
                    {t.salesman_name ? ` · Salesman: ${t.salesman_name}` : ""}
                  </div>
                  <div className="grid grid-cols-3 gap-2 bg-muted/35 p-2.5 rounded-xl">
                    <div>
                      <div className="text-[10px] text-muted-foreground">Out → In KM</div>
                      <div className="font-semibold text-foreground">
                        {Number(t.start_km || 0).toLocaleString()} → {Number(t.end_km || 0).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Running KMs</div>
                      <div className="font-bold text-indigo-700">{Number(t.distance || 0).toLocaleString()} km</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Diesel / KMPL</div>
                      <div className="font-semibold text-foreground">
                        {Number(t.diesel_liters || 0) > 0
                          ? `${t.diesel_liters}L · ${t.kmpl != null ? `${t.kmpl} km/L` : "—"}`
                          : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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

      {/* ── TRIP CLOSURE CONFIRMATION DIALOG ── */}
      {showCloseConfirmModal && ongoingTrip && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 z-50">
          <div
            className="w-full max-w-sm rounded-2xl overflow-hidden bg-white"
            style={{ boxShadow: "0 24px 64px rgba(10,20,60,0.28)" }}
          >
            <div
              className="px-5 py-4"
              style={{ background: "linear-gradient(135deg, oklch(0.16 0.07 258), oklch(0.22 0.09 265))" }}
            >
              <div className="text-white font-bold text-base">Confirm Trip Closure</div>
              <div className="text-white/65 text-xs">
                Once closed, this Vehicle Operation Statement becomes read-only.
              </div>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2.5 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Vehicle</div>
                  <div className="font-bold text-slate-900">{ongoingTrip.vehicles?.number || vehicle?.number}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Out KM</div>
                  <div className="font-semibold text-slate-800">{Number(ongoingTrip.start_km ?? authoritativeVehicleOdo).toLocaleString()} km</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">In KM (New Master Odo)</div>
                  <div className="font-extrabold text-indigo-700">{Number(closeStatementForm.inKm).toLocaleString()} km</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Running KMs</div>
                  <div className="font-extrabold text-emerald-700">
                    {computeRunningKm(
                      Number(ongoingTrip.start_km ?? authoritativeVehicleOdo),
                      Number(closeStatementForm.inKm)
                    ).toLocaleString()} km
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">In Date &amp; Time</div>
                  <div className="font-semibold text-slate-800">
                    {closeStatementForm.inDate} · {closeStatementForm.inTime}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Diesel / KMPL</div>
                  <div className="font-semibold text-slate-800">
                    {Number(closeStatementForm.dieselLitres || 0) > 0
                      ? `${closeStatementForm.dieselLitres} L (${
                          computeTripKmpl(
                            computeRunningKm(
                              Number(ongoingTrip.start_km ?? authoritativeVehicleOdo),
                              Number(closeStatementForm.inKm)
                            ),
                            Number(closeStatementForm.dieselLitres)
                          ) ?? "—"
                        } km/L)`
                      : "0 L"}
                  </div>
                </div>
              </div>

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={submittingTrip}
                  onClick={() => setShowCloseConfirmModal(false)}
                  className="flex-1 h-12 rounded-xl text-sm font-semibold border border-border bg-card text-foreground hover:bg-muted/60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submittingTrip}
                  onClick={handleConfirmCloseStatement}
                  className="flex-1 h-12 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2"
                  style={{ background: "linear-gradient(135deg, oklch(0.44 0.22 264), oklch(0.36 0.18 258))" }}
                >
                  {submittingTrip ? <Loader2 className="animate-spin h-4 w-4" /> : "Confirm & Close"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DriverPage;
