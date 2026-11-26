import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  Fuel,
  Home,
  LogOut,
  Plus,
  Route,
  Truck,
  User,
  X,
} from "lucide-react";
import { useAuth, REDIRECT_MAP } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { supabase } from "@/lib/supabase";
import { useVehicles } from "@/hooks/useVehicleTracking";
import {
  getTodayIstDateString,
  notifyManualOdometerUpdate,
} from "@/lib/odometerTrackingEngine";
import {
  type ValidationFieldErrors,
  type VehicleOperationTripRecord,
  formatIsoToIstTime,
  formatStatementNumber,
  getCurrentIstTimeString,
  resolveAuthoritativeOutKm,
  submitCloseDriverTripStatement,
  submitDriverClockIn,
  submitDriverClockOut,
  submitDriverFuelRefillRpc,
  submitStartDriverTripStatement,
  validateClockInEligibility,
  validateTripCloseStatement,
  validateTripStart,
} from "@/lib/driverOperationStatement";
import {
  type RouteAssignmentRecord,
  type RouteSummaryInfo,
  extractRouteSummary,
  fetchAssignmentsWithFallback,
} from "@/lib/driverRouteAssignments";
import type {
  DriverAlertItem,
  DriverAssignedVehicle,
  DriverProfileData,
  DriverTabId,
} from "@/components/driver/types";
import { ClockInScreen } from "@/components/driver/ClockInScreen";
import { VehicleConfirmCard } from "@/components/driver/VehicleConfirmCard";
import { ActiveTripDashboard } from "@/components/driver/ActiveTripDashboard";
import {
  type CloseStatementFormState,
  VehicleOperationStatementForm,
} from "@/components/driver/VehicleOperationStatementForm";
import { MyTripsTab } from "@/components/driver/MyTripsTab";
import { type DriverFuelHistoryRow, VehicleTab } from "@/components/driver/VehicleTab";
import { ProfileTab } from "@/components/driver/ProfileTab";
import { type DriverFuelFormState, DriverFuelModal } from "@/components/driver/DriverFuelModal";

const NAV_TABS: { id: DriverTabId; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "trips", label: "My Trips", icon: Route },
  { id: "vehicle", label: "Vehicle", icon: Truck },
  { id: "profile", label: "Profile", icon: User },
];

function buildDefaultVehicle(): DriverAssignedVehicle {
  return {
    id: null,
    number: "Unassigned",
    type: "No Assigned Vehicle",
    model: "",
    route: "No route assigned",
    odometer: 0,
    status: "Offline",
    speed: 0,
    fuel: 0,
    temperature: 0,
    engineOn: false,
    driver: "Driver",
    lastUpdate: "—",
  };
}

export default function DriverPage() {
  const { user, logout, ready } = useAuth();
  const nav = useNavigate();

  const [activeTab, setActiveTab] = useState<DriverTabId>("home");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [driver, setDriver] = useState<DriverProfileData>({
    id: null,
    name: user?.name || "Driver",
    score: 100,
    rating: "Good",
    trips: 0,
    total_km: 0,
    events: 0,
  });
  const [assignedVehicles, setAssignedVehicles] = useState<any[]>([]);
  const [vehicle, setVehicle] = useState<DriverAssignedVehicle>(buildDefaultVehicle);
  const [liveHardwareOdometer, setLiveHardwareOdometer] = useState<number>(0);
  const [alerts, setAlerts] = useState<DriverAlertItem[]>([]);
  const [showNotifDrawer, setShowNotifDrawer] = useState(false);

  // Shift, Assignment, Route & Trip State
  const [activeAssignment, setActiveAssignment] = useState<RouteAssignmentRecord | null>(null);
  const [upcomingAssignment, setUpcomingAssignment] = useState<RouteAssignmentRecord | null>(null);
  const [routeSummary, setRouteSummary] = useState<RouteSummaryInfo | null>(null);
  const [activeShift, setActiveShift] = useState<any>(null);
  const [ongoingTrip, setOngoingTrip] = useState<VehicleOperationTripRecord | null>(null);
  const [tripsHistory, setTripsHistory] = useState<VehicleOperationTripRecord[]>([]);
  const [hasOtherDriverTrip, setHasOtherDriverTrip] = useState(false);

  // Action & Modal States
  const [clockingIn, setClockingIn] = useState(false);
  const [startingTrip, setStartingTrip] = useState(false);
  const [closingTrip, setClosingTrip] = useState(false);
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [showCloseConfirmModal, setShowCloseConfirmModal] = useState(false);
  const [justStartedBanner, setJustStartedBanner] = useState(false);

  // Banners & Feedback
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [completionBanner, setCompletionBanner] = useState<{
    title: string;
    subtitle: string;
  } | null>(null);
  const [previewTripSlip, setPreviewTripSlip] = useState<VehicleOperationTripRecord | null>(null);

  // Start Form State (Route & Salesman on Vehicle Confirmation)
  const [startRoute, setStartRoute] = useState("");
  const [startSalesman, setStartSalesman] = useState("");

  // Close Operation Statement Form State
  const [closeForm, setCloseForm] = useState<CloseStatementFormState>({
    inKm: "",
    inDate: getTodayIstDateString(),
    inTime: getCurrentIstTimeString(),
    dieselLitres: "",
    fuelAmount: "",
    salesmanName: "",
    notes: "",
  });
  const [statementErrors, setStatementErrors] = useState<ValidationFieldErrors>({});

  // Record Fuel Transaction Modal & History State
  const [showFuelModal, setShowFuelModal] = useState(false);
  const [fuelLogs, setFuelLogs] = useState<DriverFuelHistoryRow[]>([]);
  const [fuelForm, setFuelForm] = useState<DriverFuelFormState>({
    vehicleId: "",
    liters: 60,
    pricePerLiter: 94.5,
    odometer: 0,
    isFullTank: true,
    station: "Indian Oil Swastik Station, Nagercoil",
    receiptRef: "",
  });
  const [fuelError, setFuelError] = useState<string | null>(null);
  const [fuelSuccess, setFuelSuccess] = useState<string | null>(null);
  const [submittingFuel, setSubmittingFuel] = useState(false);

  const liveVehicles = useVehicles();
  const notifContainerRef = useRef<HTMLDivElement | null>(null);

  // Compute authoritative odometer dynamically from Supabase master + live GPS hardware telemetry
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

  // Live merged speed/fuel/temp telemetry on the assigned vehicle
  const liveMergedVehicle = useMemo<DriverAssignedVehicle>(() => {
    if (!vehicle?.id) return vehicle;
    const matchedLive = liveVehicles.find(
      (lv) =>
        lv.id === vehicle.id ||
        (vehicle.deviceId && lv.deviceId === vehicle.deviceId) ||
        (vehicle.number && lv.number === vehicle.number)
    );
    if (!matchedLive) return vehicle;
    return {
      ...vehicle,
      status: matchedLive.status || vehicle.status,
      speed: Number.isFinite(Number(matchedLive.speed)) ? Number(matchedLive.speed) : vehicle.speed,
      fuel: Number.isFinite(Number(matchedLive.fuel)) ? Number(matchedLive.fuel) : vehicle.fuel,
      temperature: Number.isFinite(Number(matchedLive.temperature))
        ? Number(matchedLive.temperature)
        : vehicle.temperature,
      odometer: authoritativeVehicleOdo,
    };
  }, [vehicle, liveVehicles, authoritativeVehicleOdo]);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (notifContainerRef.current && !notifContainerRef.current.contains(e.target as Node)) {
        setShowNotifDrawer(false);
      }
    }
    if (showNotifDrawer) {
      document.addEventListener("mousedown", handleOutsideClick);
      return () => document.removeEventListener("mousedown", handleOutsideClick);
    }
  }, [showNotifDrawer]);

  async function load() {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      setLoadError(null);

      // 1. Resolve authenticated driver record
      let dData: any = null;
      if (user.id) {
        const { data } = await supabase
          .from("drivers")
          .select("*")
          .eq("profile_id", user.id)
          .maybeSingle();
        dData = data;
      }
      if (!dData && user.name) {
        const { data } = await supabase
          .from("drivers")
          .select("*")
          .ilike("name", user.name)
          .maybeSingle();
        dData = data;
      }

      const resolvedDriver: DriverProfileData = dData
        ? {
            ...dData,
            score: Number(dData.score ?? 100),
            trips: Number(dData.trips ?? 0),
            total_km: Number(dData.total_km ?? 0),
            events: Number(dData.events ?? 0),
            rating: dData.rating || "Good",
          }
        : {
            id: null,
            name: user.name,
            score: 100,
            rating: "N/A",
            trips: 0,
            total_km: 0,
            events: 0,
          };
      setDriver(resolvedDriver);

      // 2. Fetch Admin-assigned vehicles & route assignments strictly for resolvedDriver.id
      let vehiclesArray: any[] = [];
      let chosenActiveAsg: RouteAssignmentRecord | null = null;
      let chosenUpcomingAsg: RouteAssignmentRecord | null = null;
      const todayIst = getTodayIstDateString();

      if (resolvedDriver.id) {
        const { data: allAsgs } = await fetchAssignmentsWithFallback(supabase, {
          driverId: resolvedDriver.id,
          limit: 20,
        });
        chosenActiveAsg =
          allAsgs.find(
            (a) =>
              a.is_active === true ||
              a.status === "Assigned" ||
              a.status === "In Progress"
          ) || null;

        chosenUpcomingAsg =
          allAsgs
            .filter((a) => a.status === "Scheduled")
            .sort((a, b) => (a.assignment_date || "").localeCompare(b.assignment_date || ""))[0] || null;

        const eligibleList = allAsgs.filter(
          (a) =>
            a.vehicles &&
            (a.is_active === true ||
              a.status === "Assigned" ||
              a.status === "In Progress" ||
              (a.status === "Scheduled" && (a.assignment_date || "") <= todayIst))
        );

        if (eligibleList.length > 0) {
          vehiclesArray = eligibleList.map((a) => ({
            ...a.vehicles,
            assigned_at: a.assigned_at,
            driver_name: resolvedDriver.name,
            driver_id: resolvedDriver.id,
            route:
              a.route_name ||
              a.collection_routes?.name ||
              a.vehicles?.route ||
              "No route assigned",
          }));
        }
      }

      setActiveAssignment(chosenActiveAsg);
      setUpcomingAssignment(chosenUpcomingAsg);
      const effectiveAsg = chosenActiveAsg || chosenUpcomingAsg;
      const resolvedRouteSource =
        effectiveAsg?.collection_routes || effectiveAsg?.route_snapshot || null;
      setRouteSummary(resolvedRouteSource ? extractRouteSummary(resolvedRouteSource) : null);

      setAssignedVehicles(vehiclesArray);

      const savedActiveId = localStorage.getItem("activeVehicleId");
      const activeV =
        vehiclesArray.find((x: any) => x.id === savedActiveId) || vehiclesArray[0] || null;

      const resolvedVehicle: DriverAssignedVehicle = activeV
        ? {
            id: activeV.id,
            number: activeV.number || "Unassigned",
            type: activeV.type || "Tanker",
            model: activeV.model || "",
            route: activeV.route || "No route assigned",
            insuranceExpiry: activeV.insurance_expiry || "",
            lastService: activeV.last_service || "",
            nextServiceKm: Number(activeV.next_service_km || 0),
            odometer: Number(activeV.odometer || 0),
            odometerSource: activeV.odometer_source || undefined,
            odometerUpdatedAt: activeV.odometer_updated_at || null,
            engineHours: Number(activeV.engine_hours || 0),
            status: activeV.status || "Idle",
            location: activeV.location || "",
            lat: Number(activeV.lat || 0),
            lng: Number(activeV.lng || 0),
            speed: Number(activeV.speed || 0),
            fuel: Number(activeV.fuel || 0),
            temperature: Number(activeV.temperature || 0),
            humidity: Number(activeV.humidity || 0),
            engineOn: Boolean(activeV.engine_on),
            ignition: Boolean(activeV.ignition),
            driver: activeV.driver_name || resolvedDriver.name,
            driverId: resolvedDriver.id,
            deviceId: activeV.device_id || "",
            assignedAt: activeV.assigned_at || null,
            lastUpdate: activeV.last_update
              ? new Date(activeV.last_update).toLocaleTimeString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })
              : "—",
          }
        : { ...buildDefaultVehicle(), driver: resolvedDriver.name };

      setVehicle(resolvedVehicle);
      setStartRoute((prev) =>
        resolvedVehicle.route && resolvedVehicle.route !== "No route assigned"
          ? resolvedVehicle.route
          : prev
      );

      // 3. Load Telemetry, Alerts, and Other-Driver Trip Lock on Assigned Vehicle
      if (resolvedVehicle.id) {
        const [{ data: aData }, { data: vtData }, { data: vehicleOngoing }] = await Promise.all([
          supabase
            .from("alerts")
            .select("*")
            .eq("vehicle_id", resolvedVehicle.id)
            .order("time", { ascending: false })
            .limit(10),
          supabase
            .from("vehicle_telemetry")
            .select("odometer, status, speed, fuel, temperature, last_update")
            .eq("vehicle_id", resolvedVehicle.id)
            .maybeSingle(),
          supabase
            .from("trips")
            .select("id, driver_id")
            .eq("vehicle_id", resolvedVehicle.id)
            .eq("status", "Ongoing")
            .limit(1)
            .maybeSingle(),
        ]);

        setAlerts(
          aData
            ? aData.map((a: any) => ({
                id: a.id,
                severity: a.severity,
                message: a.message,
                type: a.type,
                time: a.time
                  ? new Date(a.time).toLocaleTimeString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—",
                resolved: Boolean(a.resolved),
              }))
            : []
        );

        if (vtData) {
          setLiveHardwareOdometer(vtData.odometer != null ? Number(vtData.odometer) || 0 : 0);
          setVehicle((prev) => ({
            ...prev,
            status: vtData.status || prev.status,
            speed: vtData.speed != null ? Number(vtData.speed) : prev.speed,
            fuel: vtData.fuel != null ? Number(vtData.fuel) : prev.fuel,
            temperature: vtData.temperature != null ? Number(vtData.temperature) : prev.temperature,
          }));
        } else {
          setLiveHardwareOdometer(0);
        }

        setHasOtherDriverTrip(
          Boolean(vehicleOngoing && vehicleOngoing.driver_id !== resolvedDriver.id)
        );
      } else {
        setAlerts([]);
        setLiveHardwareOdometer(0);
        setHasOtherDriverTrip(false);
      }

      // 4. Load Driver Active Shift, Active Trip, and Complete Driver Trip History
      if (resolvedDriver.id) {
        const [{ data: activeShiftData }, { data: activeTrip }, { data: historyTrips }] =
          await Promise.all([
            supabase
              .from("driver_shifts")
              .select("*")
              .eq("driver_id", resolvedDriver.id)
              .is("ended_at", null)
              .order("started_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabase
              .from("trips")
              .select("*, vehicles(number, model, route, odometer)")
              .eq("driver_id", resolvedDriver.id)
              .eq("status", "Ongoing")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabase
              .from("trips")
              .select("*, vehicles(number, model, route)")
              .eq("driver_id", resolvedDriver.id)
              .eq("status", "Completed")
              .order("date", { ascending: false })
              .order("created_at", { ascending: false })
              .limit(150),
          ]);

        setActiveShift(activeShiftData || null);

        if (activeTrip) {
          setOngoingTrip(activeTrip as VehicleOperationTripRecord);
          setCloseForm((prev) => ({
            ...prev,
            inDate: prev.inDate || getTodayIstDateString(),
            inTime: prev.inTime || getCurrentIstTimeString(),
            salesmanName: prev.salesmanName || activeTrip.salesman_name || "",
          }));
        } else {
          setOngoingTrip(null);
          setShowCloseForm(false);
        }

        setTripsHistory((historyTrips || []) as VehicleOperationTripRecord[]);

        // Fetch fuel purchase logs for assigned vehicle / driver
        if (resolvedVehicle.id) {
          const { data: fLogs } = await supabase
            .from("fuel_purchase_logs")
            .select("*")
            .eq("vehicle_id", resolvedVehicle.id)
            .order("logged_at", { ascending: false })
            .limit(15);
          setFuelLogs((fLogs || []) as DriverFuelHistoryRow[]);
        } else {
          setFuelLogs([]);
        }
      } else {
        setActiveShift(null);
        setOngoingTrip(null);
        setTripsHistory([]);
        setFuelLogs([]);
      }
    } catch (err: any) {
      setLoadError(err?.message || "Failed to load driver portal data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    load();
    const channelId = `nanjil-vip-driver-${Math.random().toString(36).substring(2, 9)}`;
    channel = supabase
      .channel(channelId)
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, () => {
        if (!cancelled) load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, () => {
        if (!cancelled) load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicle_assignments" }, () => {
        if (!cancelled) load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "collection_routes" }, () => {
        if (!cancelled) load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicle_telemetry" }, () => {
        if (!cancelled) load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_shifts" }, () => {
        if (!cancelled) load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => {
        if (!cancelled) load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => {
        if (!cancelled) load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "fuel_purchase_logs" }, () => {
        if (!cancelled) load();
      })
      .subscribe();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [user]);

  /* ── Handlers ── */

  async function handleClockIn(payload?: { openingKm?: number; notes?: string }) {
    if (clockingIn) return;
    setWorkflowError(null);
    setCompletionBanner(null);

    const eligibility = validateClockInEligibility({
      driverId: driver?.id,
      assignedVehicleId: vehicle?.id && assignedVehicles.length > 0 ? vehicle.id : null,
      hasActiveShift: Boolean(activeShift),
      hasActiveDriverTrip: Boolean(ongoingTrip),
      vehicleHasOtherDriverTrip: hasOtherDriverTrip,
      vehicleStatus: vehicle?.status,
    });

    if (!eligibility.allowed) {
      setWorkflowError(eligibility.error || "Unable to clock in.");
      return;
    }

    setClockingIn(true);
    try {
      const res = await submitDriverClockIn(supabase, {
        openingKm: payload?.openingKm,
        notes: payload?.notes,
      });
      if (!res.ok) {
        setWorkflowError(res.error || "Clock In failed.");
        return;
      }
      if (res.shift) {
        setActiveShift(
          payload?.openingKm != null && Number.isFinite(payload.openingKm)
            ? { ...res.shift, opening_km: Math.max(Number(res.shift.opening_km || 0), payload.openingKm) }
            : res.shift
        );
      }
      if (payload?.openingKm != null && Number.isFinite(payload.openingKm) && vehicle?.id) {
        notifyManualOdometerUpdate(vehicle.id, payload.openingKm, vehicle.deviceId);
      }
      if (res.activeTrip) setOngoingTrip(res.activeTrip);
      await load();
    } catch (err: any) {
      setWorkflowError(err?.message || "Clock In request failed.");
    } finally {
      setClockingIn(false);
    }
  }

  async function handleCancelVehicleConfirmation() {
    if (startingTrip) return;
    setWorkflowError(null);
    try {
      const res = await submitDriverClockOut(supabase);
      if (!res.ok) {
        setWorkflowError(res.error || "Unable to cancel shift.");
        return;
      }
      setActiveShift(null);
      await load();
    } catch (err: any) {
      setWorkflowError(err?.message || "Unable to cancel shift.");
    }
  }

  async function handleConfirmStartTrip() {
    if (startingTrip) return;
    setWorkflowError(null);
    setCompletionBanner(null);

    const outDate = getTodayIstDateString();
    const outTime = getCurrentIstTimeString();

    const check = validateTripStart({
      vehicleId: vehicle?.id,
      driverId: driver?.id,
      assignedVehicleIds: assignedVehicles.map((v) => v.id).filter(Boolean),
      vehicleOdometer: vehicle?.odometer,
      hardwareOdometer: activeLiveHardwareOdo,
      outDate,
      outTime,
      hasActiveVehicleTrip: hasOtherDriverTrip || Boolean(ongoingTrip && ongoingTrip.vehicle_id === vehicle?.id),
      hasActiveDriverTrip: Boolean(ongoingTrip),
    });

    if (!check.valid) {
      setWorkflowError(check.error || "Cannot start trip.");
      return;
    }

    setStartingTrip(true);
    try {
      const routeToUse =
        routeSummary?.name ||
        activeAssignment?.route_name ||
        (vehicle?.route && vehicle.route !== "No route assigned"
          ? vehicle.route
          : startRoute.trim() || "Collection Route");

      const effectiveOutKm = Math.max(
        Number(activeShift?.opening_km || 0),
        Number(authoritativeVehicleOdo || 0)
      );

      const res = await submitStartDriverTripStatement(supabase, {
        vehicleId: vehicle.id!,
        route: routeToUse,
        routeId: activeAssignment?.route_id || routeSummary?.id || null,
        salesmanName: startSalesman.trim(),
        outDate,
        outTime,
        outKm: effectiveOutKm > 0 ? effectiveOutKm : undefined,
        deviceId: vehicle.deviceId,
      });

      if (!res.ok) {
        setWorkflowError(res.error || "Failed to start trip.");
        return;
      }

      if (res.trip) {
        setOngoingTrip(res.trip);
      }
      setStartSalesman("");
      setJustStartedBanner(true);
      setCloseForm({
        inKm: "",
        inDate: getTodayIstDateString(),
        inTime: getCurrentIstTimeString(),
        dieselLitres: "",
        fuelAmount: "",
        salesmanName: startSalesman.trim(),
        notes: "",
      });
      setStatementErrors({});
      await load();
    } catch (err: any) {
      setWorkflowError(err?.message || "Failed to start trip.");
    } finally {
      setStartingTrip(false);
    }
  }

  function handleOpenCloseStatement() {
    setWorkflowError(null);
    setStatementErrors({});
    setCloseForm((prev) => ({
      ...prev,
      inDate: getTodayIstDateString(),
      inTime: getCurrentIstTimeString(),
      salesmanName: prev.salesmanName || ongoingTrip?.salesman_name || "",
    }));
    setShowCloseForm(true);
  }

  function handlePrepareCloseSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ongoingTrip || !driver?.id) {
      setStatementErrors({ general: "No active trip found for your account." });
      return;
    }

    const outKm = Number(ongoingTrip.start_km ?? authoritativeVehicleOdo ?? 0);
    const outDate = ongoingTrip.out_date || ongoingTrip.date || getTodayIstDateString();
    const outTime =
      ongoingTrip.out_time ||
      formatIsoToIstTime(ongoingTrip.started_at || ongoingTrip.created_at) ||
      "00:00";

    const validation = validateTripCloseStatement({
      tripId: ongoingTrip.id,
      tripStatus: ongoingTrip.status,
      tripClosedAt: ongoingTrip.closed_at,
      tripDriverId: ongoingTrip.driver_id,
      tripVehicleId: ongoingTrip.vehicle_id,
      authenticatedDriverId: driver.id,
      assignedVehicleIds: assignedVehicles.map((v) => v.id).filter(Boolean),
      outKm,
      inKmRaw: closeForm.inKm,
      currentVehicleOdometer: vehicle?.odometer,
      hardwareOdometer: activeLiveHardwareOdo,
      outDate,
      outTime,
      inDate: closeForm.inDate,
      inTime: closeForm.inTime,
      dieselLitresRaw: closeForm.dieselLitres,
      fuelAmountRaw: closeForm.fuelAmount,
    });

    if (!validation.valid) {
      setStatementErrors(validation.errors);
      return;
    }

    setStatementErrors({});
    setShowCloseConfirmModal(true);
  }

  async function handleConfirmCloseSubmit() {
    if (closingTrip || !ongoingTrip || !driver?.id) return;

    const outKm = Number(ongoingTrip.start_km ?? authoritativeVehicleOdo ?? 0);
    const outDate = ongoingTrip.out_date || ongoingTrip.date || getTodayIstDateString();
    const outTime =
      ongoingTrip.out_time ||
      formatIsoToIstTime(ongoingTrip.started_at || ongoingTrip.created_at) ||
      "00:00";

    const validation = validateTripCloseStatement({
      tripId: ongoingTrip.id,
      tripStatus: ongoingTrip.status,
      tripClosedAt: ongoingTrip.closed_at,
      tripDriverId: ongoingTrip.driver_id,
      tripVehicleId: ongoingTrip.vehicle_id,
      authenticatedDriverId: driver.id,
      assignedVehicleIds: assignedVehicles.map((v) => v.id).filter(Boolean),
      outKm,
      inKmRaw: closeForm.inKm,
      currentVehicleOdometer: vehicle?.odometer,
      hardwareOdometer: activeLiveHardwareOdo,
      outDate,
      outTime,
      inDate: closeForm.inDate,
      inTime: closeForm.inTime,
      dieselLitresRaw: closeForm.dieselLitres,
      fuelAmountRaw: closeForm.fuelAmount,
    });

    if (!validation.valid || !validation.parsed) {
      setShowCloseConfirmModal(false);
      setStatementErrors(validation.errors);
      return;
    }

    setClosingTrip(true);
    try {
      const res = await submitCloseDriverTripStatement(supabase, {
        tripId: ongoingTrip.id,
        inKm: validation.parsed.inKm,
        inDate: validation.parsed.inDate,
        inTime: validation.parsed.inTime,
        dieselLitres: validation.parsed.dieselLitres,
        fuelAmount: validation.parsed.fuelAmount,
        salesmanName: closeForm.salesmanName,
        notes: closeForm.notes,
        deviceId: vehicle?.deviceId,
      });

      if (!res.ok) {
        setShowCloseConfirmModal(false);
        setStatementErrors({ general: res.error, inKm: res.error });
        return;
      }

      // Also ensure shift is clocked out cleanly if older RPC didn't close it
      await submitDriverClockOut(supabase).catch(() => null);

      const finalOdo = res.vehicleOdometer ?? validation.parsed.inKm;
      setShowCloseConfirmModal(false);
      setShowCloseForm(false);
      setJustStartedBanner(false);
      setOngoingTrip(null);
      setActiveShift(null);
      setStatementErrors({});
      setCompletionBanner({
        title: "Trip Completed Successfully!",
        subtitle: `Vehicle Odometer Updated: ${finalOdo.toLocaleString()} KM`,
      });
      setCloseForm({
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
      setStatementErrors({
        general: err?.message || "Failed to close trip and update odometer.",
      });
    } finally {
      setClosingTrip(false);
    }
  }

  function openLogRefillModal() {
    setFuelError(null);
    setFuelForm({
      vehicleId: vehicle?.id || assignedVehicles[0]?.id || "",
      liters: 60,
      pricePerLiter: 94.5,
      odometer: authoritativeVehicleOdo > 0 ? authoritativeVehicleOdo : 0,
      isFullTank: true,
      station: "Indian Oil Swastik Station, Nagercoil",
      receiptRef: "",
    });
    setShowFuelModal(true);
  }

  async function handleLogFuelDriver(e: React.FormEvent) {
    e.preventDefault();
    setFuelError(null);
    setFuelSuccess(null);

    const targetVehicleId = fuelForm.vehicleId || vehicle?.id;
    const matchedTarget =
      assignedVehicles.find((v) => v.id === targetVehicleId) || vehicle;
    const targetBaselineOdo = resolveAuthoritativeOutKm(
      matchedTarget?.odometer,
      targetVehicleId === vehicle?.id ? activeLiveHardwareOdo : 0
    );

    if (!targetVehicleId || !driver?.id) {
      setFuelError("Vehicle or driver not assigned.");
      return;
    }
    if (!Number.isFinite(fuelForm.liters) || fuelForm.liters <= 0) {
      setFuelError("Volume (Litres) must be greater than 0.");
      return;
    }
    if (!Number.isFinite(fuelForm.pricePerLiter) || fuelForm.pricePerLiter <= 0) {
      setFuelError("Price per Litre must be greater than ₹0.");
      return;
    }

    const totalCost = Math.round(Number(fuelForm.liters) * Number(fuelForm.pricePerLiter));
    if (totalCost <= 0) {
      setFuelError("Total Estimated Cost must be greater than ₹0.");
      return;
    }
    if (!Number.isFinite(fuelForm.odometer) || fuelForm.odometer <= 0) {
      setFuelError("Please enter a valid positive Physical Odometer (km) reading.");
      return;
    }
    if (targetBaselineOdo > 0 && fuelForm.odometer < targetBaselineOdo) {
      setFuelError(
        `Odometer reading (${fuelForm.odometer.toLocaleString()} KM) is lower than current vehicle odometer (${targetBaselineOdo.toLocaleString()} KM).`
      );
      return;
    }

    setSubmittingFuel(true);
    try {
      const res = await submitDriverFuelRefillRpc(supabase, {
        vehicleId: targetVehicleId,
        liters: Number(fuelForm.liters),
        cost: totalCost,
        odometer: Math.round(Number(fuelForm.odometer) * 100) / 100,
        isFullTank: Boolean(fuelForm.isFullTank),
        pricePerLiter: Number(fuelForm.pricePerLiter),
        station: fuelForm.station,
        receiptRef: fuelForm.receiptRef,
        deviceId: matchedTarget?.device_id || vehicle?.deviceId,
      });

      if (!res.ok) {
        throw new Error(res.error || "Failed to save fuel refill log.");
      }

      const finalOdo = res.vehicleOdometer ?? fuelForm.odometer;
      setShowFuelModal(false);
      setFuelSuccess(
        `Fuel transaction submitted (${fuelForm.liters} L · ₹${totalCost.toLocaleString("en-IN")}). Vehicle Odometer: ${finalOdo.toLocaleString()} KM`
      );
      setCompletionBanner({
        title: "Fuel Transaction Recorded!",
        subtitle: `${fuelForm.liters} L · ₹${totalCost.toLocaleString("en-IN")} · Odometer: ${finalOdo.toLocaleString()} KM`,
      });
      await load();
    } catch (err: any) {
      setFuelError(err?.message || "Failed to save fuel log.");
    } finally {
      setSubmittingFuel(false);
    }
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
    } else if (query || (vehicle?.route && vehicle.route !== "No route assigned")) {
      url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || vehicle.route)}`;
    }

    if (url) window.open(url, "_blank");
    else setWorkflowError("No route configured yet for directions.");
  }

  function handleSwitchVehicle(vehicleId: string) {
    localStorage.setItem("activeVehicleId", vehicleId);
    load();
  }

  async function handleLogout() {
    await logout();
    nav("/login");
  }

  /* ── Auth Guards ── */
  if (!ready) return null;
  if (!user) return <Navigate to="/login" />;
  if (REDIRECT_MAP[user.role] !== "/driver") return <Navigate to={REDIRECT_MAP[user.role]} />;

  const openAlertsCount = alerts.filter((a) => !a.resolved).length;

  return (
    <div className="min-h-screen bg-slate-50/90 flex flex-col overflow-x-hidden">
      {/* ── TOP HEADER ── */}
      <header
        className="sticky top-0 z-30 shrink-0 border-b border-white/10"
        style={{
          background: "linear-gradient(135deg, oklch(0.16 0.07 258) 0%, oklch(0.24 0.11 264) 100%)",
        }}
      >
        <div className="max-w-xl mx-auto flex items-center gap-3 px-4 py-3">
          <div className="bg-white/12 rounded-xl p-1.5 shrink-0">
            <Logo className="h-8" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">
              Nanjil VIP · Driver Portal
            </div>
            <div className="text-white font-bold text-sm sm:text-base leading-tight truncate">
              Welcome, {driver.name || user.name}
            </div>
          </div>

          {/* Notification Bell + Profile + Logout */}
          <div className="flex items-center gap-1.5 shrink-0" ref={notifContainerRef}>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowNotifDrawer((v) => !v)}
                aria-label="Notifications"
                className="relative p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
              >
                <Bell className="h-5 w-5" />
                {openAlertsCount > 0 && (
                  <span
                    className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center"
                    style={{ background: "oklch(0.58 0.24 25)" }}
                  >
                    {openAlertsCount}
                  </span>
                )}
              </button>

              {showNotifDrawer && (
                <div className="absolute right-0 mt-2 w-72 sm:w-80 rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden z-50">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                      Vehicle Notifications
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNotifDrawer(false)}
                      className="text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                    {alerts.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-400">
                        No alerts for {vehicle.number}.
                      </div>
                    ) : (
                      alerts.slice(0, 5).map((a) => (
                        <div key={a.id} className="p-3 text-xs space-y-0.5">
                          <div className="font-semibold text-slate-800">{a.message}</div>
                          <div className="text-[10px] text-slate-400">
                            {a.type} · {a.severity} · {a.time}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setActiveTab("profile")}
              aria-label="Driver Profile"
              className="h-10 w-10 rounded-xl bg-white/15 hover:bg-white/25 text-white font-extrabold text-sm flex items-center justify-center transition-colors cursor-pointer"
              title="Profile"
            >
              {(driver.name || user.name || "D").charAt(0).toUpperCase()}
            </button>

            <button
              type="button"
              onClick={handleLogout}
              aria-label="Logout"
              className="p-2.5 rounded-xl bg-white/10 hover:bg-red-500/30 text-white transition-colors cursor-pointer"
              title="Logout"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* ── MAIN SCROLLABLE BODY ── */}
      <main className="flex-1 w-full max-w-xl mx-auto px-4 pt-4 pb-28 space-y-4">
        {loadError && (
          <div
            role="alert"
            className="rounded-2xl p-4 bg-red-50 border border-red-200 text-xs font-semibold text-red-700 flex items-center gap-2"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {completionBanner && (
          <div
            role="status"
            className="rounded-2xl p-4 bg-emerald-50 border border-emerald-200 text-emerald-950 shadow-xs flex items-start justify-between gap-3"
          >
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-extrabold">{completionBanner.title}</div>
                <div className="text-xs font-bold text-emerald-800 mt-0.5">
                  {completionBanner.subtitle}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCompletionBanner(null)}
              className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
              aria-label="Dismiss success banner"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {loading ? (
          /* Mobile-First Loading Skeleton */
          <div className="space-y-4">
            <div className="h-64 rounded-3xl bg-slate-200/80 animate-pulse" />
            <div className="h-36 rounded-2xl bg-slate-200/70 animate-pulse" />
            <div className="h-44 rounded-2xl bg-slate-200/60 animate-pulse" />
          </div>
        ) : (
          <>
            {activeTab === "home" ? (
              showCloseForm && ongoingTrip ? (
                <VehicleOperationStatementForm
                  trip={ongoingTrip}
                  driver={driver}
                  vehicle={liveMergedVehicle}
                  authoritativeOdometer={authoritativeVehicleOdo}
                  form={closeForm}
                  errors={statementErrors}
                  submitting={closingTrip}
                  showConfirmModal={showCloseConfirmModal}
                  onChangeForm={setCloseForm}
                  onClearError={(keys) =>
                    setStatementErrors((prev) => {
                      const next = { ...prev };
                      keys.forEach((k) => {
                        next[k] = undefined;
                      });
                      return next;
                    })
                  }
                  onSubmitPrepare={handlePrepareCloseSubmit}
                  onConfirmSubmit={handleConfirmCloseSubmit}
                  onCloseConfirmModal={() => setShowCloseConfirmModal(false)}
                  onBackToActiveTrip={() => {
                    setShowCloseForm(false);
                    setStatementErrors({});
                  }}
                />
              ) : ongoingTrip ? (
                <div className="space-y-4">
                  <ActiveTripDashboard
                    trip={ongoingTrip}
                    vehicle={liveMergedVehicle}
                    authoritativeOdometer={authoritativeVehicleOdo}
                    justStartedBanner={justStartedBanner}
                    onDismissStartedBanner={() => setJustStartedBanner(false)}
                    onCompleteTripClockOut={handleOpenCloseStatement}
                    onViewRoute={handleViewRoute}
                  />
                  {tripsHistory.length > 0 && (
                    <div className="bg-card border border-border rounded-2xl p-4 shadow-xs flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-foreground">
                          Recent Completed Statements ({tripsHistory.length})
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Last closed: {tripsHistory[0].in_date || tripsHistory[0].date} ·{" "}
                          {Number(tripsHistory[0].distance || 0).toLocaleString()} KM
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab("trips")}
                        className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-800 cursor-pointer"
                      >
                        My Trips →
                      </button>
                    </div>
                  )}
                </div>
              ) : activeShift ? (
                <VehicleConfirmCard
                  driver={driver}
                  vehicle={liveMergedVehicle}
                  activeAssignment={activeAssignment}
                  routeSummary={routeSummary}
                  assignedVehicles={assignedVehicles}
                  authoritativeOdometer={Math.max(
                    Number(activeShift?.opening_km || 0),
                    Number(authoritativeVehicleOdo || 0)
                  )}
                  outDate={getTodayIstDateString()}
                  outTime={getCurrentIstTimeString()}
                  routeValue={startRoute}
                  salesmanValue={startSalesman}
                  submitting={startingTrip}
                  errorBanner={workflowError}
                  onChangeVehicle={handleSwitchVehicle}
                  onChangeRoute={setStartRoute}
                  onChangeSalesman={setStartSalesman}
                  onConfirmStartTrip={handleConfirmStartTrip}
                  onCancelClockIn={handleCancelVehicleConfirmation}
                />
              ) : (
                <ClockInScreen
                  driver={driver}
                  vehicle={liveMergedVehicle}
                  activeAssignment={activeAssignment}
                  upcomingAssignment={upcomingAssignment}
                  routeSummary={routeSummary}
                  assignedVehiclesCount={assignedVehicles.length}
                  authoritativeOdometer={authoritativeVehicleOdo}
                  hasOtherDriverTrip={hasOtherDriverTrip}
                  clockingIn={clockingIn}
                  errorBanner={workflowError}
                  recentTrips={tripsHistory}
                  onClockIn={handleClockIn}
                  onOpenTripHistory={() => setActiveTab("trips")}
                  onInspectTrip={(trip) => {
                    setPreviewTripSlip(trip);
                  }}
                />
              )
            ) : null}

            {/* Quick 1-Tap Log Refill bar on Home whenever vehicle is assigned */}
            {activeTab === "home" && !showCloseForm && vehicle?.id && (
              <div className="bg-card border border-border rounded-2xl p-4 shadow-xs flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-9 w-9 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                    <Fuel className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-foreground">Diesel Refill &amp; Receipt</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      Log refill with physical odometer &amp; invoice
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openLogRefillModal}
                  className="px-4 min-h-[40px] rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs flex items-center gap-1.5 shrink-0 shadow-xs cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" /> Log Refill
                </button>
              </div>
            )}

            {activeTab === "trips" ? (
              <MyTripsTab
                ongoingTrip={ongoingTrip}
                tripsHistory={tripsHistory}
                defaultVehicleNumber={vehicle.number}
                driverName={driver.name}
              />
            ) : activeTab === "vehicle" ? (
              <VehicleTab
                vehicle={liveMergedVehicle}
                authoritativeOdometer={authoritativeVehicleOdo}
                liveHardwareOdometer={activeLiveHardwareOdo}
                alerts={alerts}
                fuelLogs={fuelLogs}
                fuelSuccess={fuelSuccess}
                onOpenLogRefill={openLogRefillModal}
              />
            ) : activeTab === "profile" ? (
              <ProfileTab
                driver={driver}
                vehicle={liveMergedVehicle}
                userEmail={user.email}
                onLogout={handleLogout}
              />
            ) : null}
          </>
        )}
      </main>

      <DriverFuelModal
        open={showFuelModal}
        driver={driver}
        vehicle={liveMergedVehicle}
        assignedVehicles={assignedVehicles}
        authoritativeOdometer={authoritativeVehicleOdo}
        form={fuelForm}
        error={fuelError}
        submitting={submittingFuel}
        onChangeForm={setFuelForm}
        onClose={() => {
          setShowFuelModal(false);
          setFuelError(null);
        }}
        onSubmit={handleLogFuelDriver}
      />

      {/* Quick Read-Only Statement Preview from Home Recent Trips */}
      {previewTripSlip && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 z-50">
          <div className="w-full max-w-md rounded-3xl bg-white overflow-hidden shadow-2xl">
            <div
              className="px-5 py-4 text-white flex items-center justify-between"
              style={{ background: "linear-gradient(135deg, oklch(0.16 0.07 258), oklch(0.24 0.10 264))" }}
            >
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/70">
                  Read-Only Statement
                </div>
                <div className="text-base font-extrabold">{formatStatementNumber(previewTripSlip)}</div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewTripSlip(null)}
                className="p-2 rounded-xl bg-white/10 text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Vehicle</div>
                  <div className="font-bold text-slate-900">
                    {previewTripSlip.vehicles?.number || vehicle.number}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Date</div>
                  <div className="font-semibold text-slate-800">
                    {previewTripSlip.in_date || previewTripSlip.date}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-[10px] font-bold uppercase text-slate-400">Route</div>
                  <div className="font-semibold text-slate-800">
                    {previewTripSlip.destination
                      ? `${previewTripSlip.start} → ${previewTripSlip.destination}`
                      : previewTripSlip.start}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Out → In KM</div>
                  <div className="font-bold text-slate-900">
                    {Number(previewTripSlip.start_km || 0).toLocaleString()} →{" "}
                    {Number(previewTripSlip.end_km || 0).toLocaleString()} KM
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Running KMs</div>
                  <div className="font-extrabold text-indigo-700">
                    {Number(previewTripSlip.distance || 0).toLocaleString()} KM
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewTripSlip(null)}
                className="w-full min-h-[46px] rounded-xl bg-slate-900 text-white font-bold text-xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── STICKY BOTTOM NAVIGATION ── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200/90"
        style={{
          background: "rgba(255,255,255,0.96)",
          backdropFilter: "blur(16px) saturate(180%)",
          WebkitBackdropFilter: "blur(16px) saturate(180%)",
          boxShadow: "0 -4px 20px rgba(10,20,60,0.08)",
        }}
      >
        <div className="max-w-xl mx-auto grid grid-cols-4">
          {NAV_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            const showDot = tab.id === "vehicle" && openAlertsCount > 0;
            const showActiveTripDot = tab.id === "trips" && Boolean(ongoingTrip);

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id !== "home") setShowCloseForm(false);
                }}
                className="flex flex-col items-center justify-center py-2.5 gap-1 relative min-h-[60px] cursor-pointer transition-colors"
              >
                <div className="relative">
                  <Icon
                    className="h-5 w-5 transition-colors"
                    style={{ color: isActive ? "oklch(0.38 0.20 264)" : "oklch(0.55 0.02 250)" }}
                    strokeWidth={isActive ? 2.4 : 1.8}
                  />
                  {showDot && (
                    <span
                      className="absolute -top-1 -right-1.5 h-2.5 w-2.5 rounded-full"
                      style={{ background: "oklch(0.58 0.24 25)" }}
                    />
                  )}
                  {showActiveTripDot && (
                    <span className="absolute -top-1 -right-1.5 h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  )}
                </div>
                <span
                  className="text-[11px] font-bold transition-colors"
                  style={{ color: isActive ? "oklch(0.38 0.20 264)" : "oklch(0.52 0.02 250)" }}
                >
                  {tab.label}
                </span>
                {isActive && (
                  <div
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-9 rounded-full"
                    style={{ background: "oklch(0.38 0.20 264)" }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
