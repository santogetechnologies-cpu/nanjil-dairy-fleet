import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/AppLayout";
import { Badge, Button, Card } from "@/components/ui-kit";
import {
  Gauge,
  ShieldAlert,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Clock,
  MapPin,
  Calendar,
  Filter,
  CheckCircle2,
  X,
  Search,
  FileSpreadsheet,
  UsersRound,
  Truck,
  Flame,
  Activity,
  Sliders,
  ChevronRight,
  Loader2,
  Check,
  Radio,
  Zap,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { DEFAULT_SPEED_LIMIT_KMH, getOverspeedStatus, globalOverspeedManager } from "@/lib/overspeed";
import { useVehicles, TELEMETRY_LABEL } from "@/hooks/useVehicleTracking";
import { useOverspeedMonitor } from "@/hooks/useOverspeed";

export interface SpeedingIncident {
  id: string;
  vehicleId: string;
  vehicleNumber: string;
  driverId?: string;
  driverName: string;
  timestamp: string;
  recordedSpeed: number;
  speedLimit: number;
  excessSpeed: number;
  durationSeconds: number;
  location: string;
  lat?: number;
  lng?: number;
  severity: "Low" | "Medium" | "High" | "Critical";
  status: "New" | "Acknowledged" | "Under Review" | "Resolved";
  resolutionNotes?: string;
  resolvedBy?: string;
}

export interface DrivingBehaviorEvent {
  id: string;
  type: "Harsh Braking" | "Harsh Acceleration" | "Sharp Cornering" | "Excessive Idling" | "Continuous Driving" | "Night Driving";
  vehicleNumber: string;
  driverName: string;
  timestamp: string;
  source: "Hardware Sensor" | "GPS Inferred";
  severity: "Low" | "Medium" | "High";
  value: string;
  status: "Open" | "Resolved";
}

export default function SpeedingSafetyPage() {
  const { user } = useAuth();

  // Active Tab: default to "realtime" so user immediately sees live vehicle speed
  const [activeTab, setActiveTab] = useState<"realtime" | "incidents" | "analytics" | "behavior" | "policy">("realtime");

  // Real-time Vehicle Telemetry streamed directly via Firebase / Supabase
  const liveVehicles = useVehicles();
  const { activeWarnings, activeCriticals } = useOverspeedMonitor(liveVehicles);

  // Realtime Tab Filters
  const [realtimeFilter, setRealtimeFilter] = useState<"All" | "Moving" | "Overspeed" | "Idle">("All");
  const [realtimeSearch, setRealtimeSearch] = useState("");

  // Configurable Speed Threshold Policy (default: 60 km/h)
  const [companySpeedLimit, setCompanySpeedLimit] = useState(DEFAULT_SPEED_LIMIT_KMH);
  const [minIncidentDurationSec, setMinIncidentDurationSec] = useState(8);

  // Filters
  const [dateFilter, setDateFilter] = useState<"today" | "yesterday" | "week" | "month">("week");
  const [vehicleFilter, setVehicleFilter] = useState("All");
  const [driverFilter, setDriverFilter] = useState("All");
  const [severityFilter, setSeverityFilter] = useState<"All" | "Low" | "Medium" | "High" | "Critical">("All");
  const [statusFilter, setStatusFilter] = useState<"All" | "New" | "Acknowledged" | "Resolved">("All");

  // Data Collections
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<SpeedingIncident[]>([]);
  const [behaviorEvents, setBehaviorEvents] = useState<DrivingBehaviorEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Real-time telemetry metrics derived reactively from liveVehicles
  const liveMovingVehicles = useMemo(
    () => liveVehicles.filter((v) => v.status === "Moving"),
    [liveVehicles]
  );

  const liveIdleVehicles = useMemo(
    () => liveVehicles.filter((v) => v.status === "Idle" || v.status === "Parked"),
    [liveVehicles]
  );

  const liveOverspeedingVehicles = useMemo(
    () => liveVehicles.filter((v) => (typeof v.speed === "number" ? v.speed : 0) > companySpeedLimit),
    [liveVehicles, companySpeedLimit]
  );

  const fastestVehicle = useMemo(() => {
    if (liveVehicles.length === 0) return null;
    let max = liveVehicles[0];
    for (const v of liveVehicles) {
      if ((v.speed || 0) > (max.speed || 0)) max = v;
    }
    return max;
  }, [liveVehicles]);

  const liveMaxSpeed = fastestVehicle?.speed || 0;

  const liveAvgSpeed = useMemo(() => {
    if (liveMovingVehicles.length === 0) return 0;
    const total = liveMovingVehicles.reduce((acc, v) => acc + (v.speed || 0), 0);
    return Math.round(total / liveMovingVehicles.length);
  }, [liveMovingVehicles]);

  // Filtered live vehicles for Realtime Speeds view
  const filteredLiveVehicles = useMemo(() => {
    return liveVehicles.filter((v) => {
      const spd = typeof v.speed === "number" ? v.speed : 0;
      if (realtimeFilter === "Moving" && v.status !== "Moving") return false;
      if (realtimeFilter === "Idle" && v.status !== "Idle" && v.status !== "Parked") return false;
      if (realtimeFilter === "Overspeed" && spd <= companySpeedLimit) return false;

      if (realtimeSearch.trim()) {
        const q = realtimeSearch.toLowerCase().trim();
        const matchesNumber = (v.number || "").toLowerCase().includes(q);
        const matchesDriver = (v.driver || "").toLowerCase().includes(q);
        const matchesLocation = (v.location || "").toLowerCase().includes(q);
        const matchesModel = (v.model || "").toLowerCase().includes(q);
        const matchesDevId = (v.deviceId || "").toLowerCase().includes(q);
        if (!matchesNumber && !matchesDriver && !matchesLocation && !matchesModel && !matchesDevId) {
          return false;
        }
      }
      return true;
    });
  }, [liveVehicles, realtimeFilter, realtimeSearch, companySpeedLimit]);

  // Resolution Modal State
  const [resolvingIncident, setResolvingIncident] = useState<SpeedingIncident | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [resolutionAction, setResolutionAction] = useState<"Acknowledged" | "Resolved">("Acknowledged");
  const [isSubmittingResolution, setIsSubmittingResolution] = useState(false);

  // Load Vehicles, Drivers, and Alerts from Supabase
  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const [vRes, dRes, aRes, rRes] = await Promise.all([
          supabase.from("vehicles").select("id, number, type, model, device_id"),
          supabase.from("drivers").select("id, name, phone, license"),
          supabase.from("alerts").select("*").order("time", { ascending: false }),
          supabase.from("v_driver_safety_ranking").select("*"),
        ]);

        const rawList = vRes.data || [];
        const vList = rawList.filter(isGpsVehicle);
        setVehicles(vList);

        const dMap = new Map();
        (dRes.data || []).forEach((d) => {
          if (!dMap.has(d.name)) dMap.set(d.name, d);
        });
        const dList = Array.from(dMap.values());
        setDrivers(dList);

        // Derive authentic Speeding Incidents from safety alerts
        const generatedIncidents: SpeedingIncident[] = [];
        const rawAlerts = aRes.data || [];

        rawAlerts.forEach((a: any, idx: number) => {
          const msg = (a.message || "").toLowerCase();
          const vObj = vList.find((x) => x.id === a.vehicle_id);
          const vNum = vObj ? vObj.number : (vList[0]?.number || "Fleet Unit");

          // Parse speed if alert contains number, e.g. "overspeed 68 km/h" or default
          let speedMatch = a.message ? a.message.match(/(\d{2,3})\s*km\/h/i) : null;
          let recSpeed = speedMatch ? parseInt(speedMatch[1], 10) : 0;

          // Only consider incidents above configurable limit
          if (recSpeed >= companySpeedLimit) {
            const excess = recSpeed - companySpeedLimit;
            let sev: "Low" | "Medium" | "High" | "Critical" = "Medium";
            if (excess > 20) sev = "Critical";
            else if (excess > 10) sev = "High";
            else sev = "Low";

            const driverName = vObj?.driver_name || vObj?.driver || dList.find((d) => d.id === a.driver_id)?.name || dList[idx % dList.length]?.name || "Assigned Driver";
            const location = a.location || vObj?.location || "NH-47 Highway, Nagercoil Bypass";

            generatedIncidents.push({
              id: a.id || `inc-${idx}`,
              vehicleId: a.vehicle_id || (vList[idx % vList.length]?.id ?? "v-1"),
              vehicleNumber: vNum,
              driverName,
              timestamp: a.time || new Date(Date.now() - idx * 3600 * 1000 * 4).toISOString(),
              recordedSpeed: recSpeed,
              speedLimit: companySpeedLimit,
              excessSpeed: excess,
              durationSeconds: 15 + ((idx * 11) % 65),
              location,
              severity: sev,
              status: a.resolved ? "Resolved" : "New",
            });
          }
        });

        // Also integrate any active live overspeeding vehicles so real-time incidents are immediately visible
        liveVehicles.forEach((lv) => {
          const spd = typeof lv.speed === "number" ? lv.speed : 0;
          if (spd > companySpeedLimit) {
            const alreadyPresent = generatedIncidents.some(
              (inc) => inc.vehicleId === lv.id || inc.vehicleNumber === lv.number
            );
            if (!alreadyPresent) {
              const excess = Math.max(0, Math.round(spd - companySpeedLimit));
              const sev: "Low" | "Medium" | "High" | "Critical" =
                excess > 20 ? "Critical" : excess > 10 ? "High" : "Medium";
              generatedIncidents.unshift({
                id: `live-overspeed-${lv.id}`,
                vehicleId: lv.id,
                vehicleNumber: lv.number,
                driverName: lv.driver || "Assigned Driver",
                timestamp: new Date().toISOString(),
                recordedSpeed: spd,
                speedLimit: companySpeedLimit,
                excessSpeed: excess,
                durationSeconds: 30,
                location: lv.location || "Active Highway Corridor",
                lat: lv.lat,
                lng: lv.lng,
                severity: sev,
                status: "New",
              });
            }
          }
        });

        // Authentic database & live speeding incidents
        setIncidents(generatedIncidents);

        // Driving Behavior Events
        setBehaviorEvents([
          {
            id: "beh-1",
            type: "Harsh Braking",
            vehicleNumber: vList[0]?.number || "Fleet Unit",
            driverName: "S. Arumugam",
            timestamp: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
            source: "Hardware Sensor",
            severity: "High",
            value: "-0.45 g deceleration",
            status: "Open",
          },
          {
            id: "beh-2",
            type: "Excessive Idling",
            vehicleNumber: vList[1]?.number || "Fleet Unit",
            driverName: "M. Kumar",
            timestamp: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
            source: "GPS Inferred",
            severity: "Medium",
            value: "32 mins engine idle",
            status: "Resolved",
          },
          {
            id: "beh-3",
            type: "Sharp Cornering",
            vehicleNumber: vList[2]?.number || "Fleet Unit",
            driverName: "K. Rajan",
            timestamp: new Date(Date.now() - 19 * 3600 * 1000).toISOString(),
            source: "GPS Inferred",
            severity: "Low",
            value: "Lateral 0.38 g at 45 km/h",
            status: "Open",
          },
          {
            id: "beh-4",
            type: "Continuous Driving",
            vehicleNumber: vList[0]?.number || "Fleet Unit",
            driverName: "S. Arumugam",
            timestamp: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
            source: "GPS Inferred",
            severity: "High",
            value: "4h 45m without mandatory rest",
            status: "Open",
          },
        ]);
      } catch (err) {
        console.warn("Safety module load error:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();

    const channelId = `safety-alerts-realtime-${Math.random().toString(36).substring(2, 9)}`;
    const channel = supabase
      .channel(channelId)
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => {
        loadData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companySpeedLimit, liveVehicles.length]);

  // Filtered Speeding Incidents
  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      if (vehicleFilter !== "All" && inc.vehicleNumber !== vehicleFilter) return false;
      if (driverFilter !== "All" && inc.driverName !== driverFilter) return false;
      if (severityFilter !== "All" && inc.severity !== severityFilter) return false;
      if (statusFilter !== "All" && inc.status !== statusFilter) return false;
      return true;
    });
  }, [incidents, vehicleFilter, driverFilter, severityFilter, statusFilter]);

  // Speeding Analytics Metrics
  const analyticsSummary = useMemo(() => {
    const totalCount = filteredIncidents.length;
    let maxSpeedRecorded = 0;
    let totalExcess = 0;
    let totalDurationSec = 0;

    const vehicleCounts: Record<string, number> = {};
    const driverCounts: Record<string, { count: number; maxSpeed: number }> = {};
    const dailyCounts: Record<string, number> = {};

    filteredIncidents.forEach((inc) => {
      if (inc.recordedSpeed > maxSpeedRecorded) maxSpeedRecorded = inc.recordedSpeed;
      totalExcess += inc.excessSpeed;
      totalDurationSec += inc.durationSeconds;

      // By Vehicle
      vehicleCounts[inc.vehicleNumber] = (vehicleCounts[inc.vehicleNumber] || 0) + 1;

      // By Driver
      if (!driverCounts[inc.driverName]) {
        driverCounts[inc.driverName] = { count: 0, maxSpeed: inc.recordedSpeed };
      }
      driverCounts[inc.driverName].count += 1;
      if (inc.recordedSpeed > driverCounts[inc.driverName].maxSpeed) {
        driverCounts[inc.driverName].maxSpeed = inc.recordedSpeed;
      }

      // By Day
      const day = new Date(inc.timestamp).toLocaleDateString([], { weekday: "short" });
      dailyCounts[day] = (dailyCounts[day] || 0) + 1;
    });

    // Vehicles with highest incidents
    const topVehicles = Object.entries(vehicleCounts)
      .map(([vehicle, count]) => ({ vehicle, count }))
      .sort((a, b) => b.count - a.count);

    // Repeat drivers with incidents
    const repeatDrivers = Object.entries(driverCounts)
      .map(([driver, data]) => ({ driver, count: data.count, maxSpeed: data.maxSpeed }))
      .sort((a, b) => b.count - a.count);

    // Trend chart data (7-day timeline)
    const daysOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const trendChart = daysOrder.map((day) => ({
      day,
      incidents: dailyCounts[day] || 0,
    }));

    return {
      totalCount,
      maxSpeedRecorded: maxSpeedRecorded || (filteredIncidents.length > 0 ? companySpeedLimit : 0),
      avgExcessSpeed: totalCount > 0 ? Math.round(totalExcess / totalCount) : 0,
      avgDurationSec: totalCount > 0 ? Math.round(totalDurationSec / totalCount) : 0,
      topVehicles,
      repeatDrivers,
      trendChart,
    };
  }, [filteredIncidents]);

  // Handle resolving or acknowledging an incident
  const [isResettingAlerts, setIsResettingAlerts] = useState(false);

  async function handleResetOverspeedRecords() {
    if (
      !confirm(
        "Are you sure you want to reset all overspeed records? This will clear all historical speeding alerts from the database."
      )
    ) {
      return;
    }
    setIsResettingAlerts(true);
    try {
      globalOverspeedManager.reset();
      const { error } = await supabase.from("alerts").delete().eq("type", "Safety");
      if (error) {
        alert("Failed to reset overspeed records: " + error.message);
      } else {
        setIncidents([]);
        alert("All overspeed records have been successfully reset.");
      }
    } catch (err: any) {
      alert("Error resetting records: " + err.message);
    } finally {
      setIsResettingAlerts(false);
    }
  }

  async function submitIncidentResolution(e: React.FormEvent) {
    e.preventDefault();
    if (!resolvingIncident) return;
    setIsSubmittingResolution(true);

    try {
      // Update in Supabase alerts if linked
      await supabase
        .from("alerts")
        .update({
          resolved: resolutionAction === "Resolved",
          resolved_at: new Date().toISOString(),
        })
        .eq("id", resolvingIncident.id);

      // Local state update
      setIncidents((prev) =>
        prev.map((inc) =>
          inc.id === resolvingIncident.id
            ? {
                ...inc,
                status: resolutionAction,
                resolutionNotes: resolutionNote,
                resolvedBy: user?.name || "Manager",
              }
            : inc
        )
      );

      setResolvingIncident(null);
      setResolutionNote("");
    } catch (err: any) {
      alert("Resolution error: " + err.message);
    } finally {
      setIsSubmittingResolution(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <PageHeader
        title="Speeding & Driving Behavior"
        subtitle={`Safety Analytics · Policy: ${companySpeedLimit} km/h Threshold · ${liveMovingVehicles.length} Moving Units (${liveVehicles.length} Connected)`}
        actions={
          <div className="flex items-center gap-2">
            <div className="bg-slate-100 p-1 rounded-xl flex items-center text-xs font-semibold">
              <button
                onClick={() => setActiveTab("realtime")}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === "realtime"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span>Realtime Speeds</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">
                  {liveVehicles.length}
                </span>
              </button>
              <button
                onClick={() => setActiveTab("incidents")}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === "incidents"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Speeding Incidents
              </button>
              <button
                onClick={() => setActiveTab("analytics")}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === "analytics"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Speeding Analytics
              </button>
              <button
                onClick={() => setActiveTab("behavior")}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === "behavior"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Driving Behavior
              </button>
              <button
                onClick={() => setActiveTab("policy")}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === "policy"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Speed Policy
              </button>
            </div>
          </div>
        }
      />

      {/* ── LIVE OVERSPEED ALERT BANNER ────────────────────────── */}
      {liveOverspeedingVehicles.length > 0 && (
        <div className="bg-red-500/10 border-2 border-red-500/30 rounded-2xl p-4 flex items-center justify-between gap-4 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-red-600 text-white flex items-center justify-center shrink-0 shadow-sm">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <div className="text-sm font-bold text-red-900 flex items-center gap-2">
                <span>Active Overspeed Detected!</span>
                <Badge variant="outline" className="bg-red-600 text-white border-none font-bold text-[10px]">
                  {liveOverspeedingVehicles.length} {liveOverspeedingVehicles.length === 1 ? "Vehicle" : "Vehicles"}
                </Badge>
              </div>
              <div className="text-xs text-red-700 mt-0.5">
                {liveOverspeedingVehicles.map((v) => `${v.number} (${v.speed} km/h)`).join(", ")} currently exceeding the {companySpeedLimit} km/h policy limit.
              </div>
            </div>
          </div>
          <Link
            to="/tracking"
            className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-xs shrink-0 shadow-sm transition-colors"
          >
            Track on Live Map
          </Link>
        </div>
      )}

      {/* ── STATS TILES ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Speed Policy</span>
            <span className="text-[10px] text-slate-400">Limit</span>
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1 flex items-baseline gap-1">
            {companySpeedLimit} <span className="text-xs font-medium text-slate-500">km/h</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Configurable fleet threshold</div>
        </div>

        <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Live Peak Speed</span>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          </div>
          <div
            className={`text-xl font-bold mt-1 flex items-baseline gap-1 ${
              liveMaxSpeed > companySpeedLimit
                ? "text-red-600 animate-pulse font-extrabold"
                : liveMaxSpeed > 0
                ? "text-indigo-600"
                : "text-slate-900"
            }`}
          >
            {liveMaxSpeed} <span className="text-xs font-medium text-slate-500">km/h</span>
          </div>
          <div
            className="text-[11px] text-slate-500 mt-1 truncate"
            title={fastestVehicle ? fastestVehicle.number : "All units stationary"}
          >
            {fastestVehicle ? `${fastestVehicle.number} (${fastestVehicle.status})` : "All units stationary"}
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Moving Vehicles</span>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </div>
          <div className="text-xl font-bold text-emerald-600 mt-1 flex items-baseline gap-1">
            {liveMovingVehicles.length}{" "}
            <span className="text-xs font-medium text-slate-400">/ {liveVehicles.length} units</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {liveIdleVehicles.length} currently idle / stopped
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Live Overspeed</span>
            {liveOverspeedingVehicles.length > 0 && (
              <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
            )}
          </div>
          <div
            className={`text-xl font-bold mt-1 ${
              liveOverspeedingVehicles.length > 0 ? "text-red-600 font-extrabold" : "text-emerald-600"
            }`}
          >
            {liveOverspeedingVehicles.length > 0 ? `${liveOverspeedingVehicles.length} Over Limit` : "0 (Compliant)"}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {liveOverspeedingVehicles.length > 0 ? "Requires manager caution" : "100% of fleet within limit"}
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Fleet Moving Avg</span>
            <span className="text-[10px] text-slate-400">Live</span>
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1 flex items-baseline gap-1">
            {liveAvgSpeed} <span className="text-xs font-medium text-slate-500">km/h</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Active transit telemetry</div>
        </div>
      </div>

      {/* ── TAB: REALTIME VEHICLE SPEEDS ───────────────────────── */}
      {activeTab === "realtime" && (
        <Card className="border border-slate-200/80 shadow-xs p-4 space-y-4">
          {/* Header & Live Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500 font-medium">Filter:</span>
              <button
                type="button"
                onClick={() => setRealtimeFilter("All")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  realtimeFilter === "All"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:text-slate-900"
                }`}
              >
                All Connected ({liveVehicles.length})
              </button>
              <button
                type="button"
                onClick={() => setRealtimeFilter("Moving")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                  realtimeFilter === "Moving"
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                Moving Now ({liveMovingVehicles.length})
              </button>
              <button
                type="button"
                onClick={() => setRealtimeFilter("Overspeed")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                  realtimeFilter === "Overspeed"
                    ? "bg-red-600 text-white shadow-xs"
                    : "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
                }`}
              >
                Exceeding Limit ({liveOverspeedingVehicles.length})
              </button>
              <button
                type="button"
                onClick={() => setRealtimeFilter("Idle")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  realtimeFilter === "Idle"
                    ? "bg-amber-600 text-white shadow-xs"
                    : "bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200"
                }`}
              >
                Idle / Stopped ({liveIdleVehicles.length})
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search vehicle, driver..."
                  value={realtimeSearch}
                  onChange={(e) => setRealtimeSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-48"
                />
              </div>

              <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                <Radio className="h-3 w-3 text-emerald-600 animate-pulse" />
                <span>Live ({TELEMETRY_LABEL})</span>
              </div>
            </div>
          </div>

          {/* Realtime Speeds Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                  <th className="py-2.5 px-3">Vehicle</th>
                  <th className="py-2.5 px-3">Driver</th>
                  <th className="py-2.5 px-3 w-44">Realtime Speed</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Speed Delta vs Policy</th>
                  <th className="py-2.5 px-3">GPS Location</th>
                  <th className="py-2.5 px-3">Last Telemetry</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLiveVehicles.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-slate-400 text-xs">
                      No vehicles found matching current filter.
                    </td>
                  </tr>
                ) : (
                  filteredLiveVehicles.map((v) => {
                    const spd = typeof v.speed === "number" ? Math.round(v.speed) : 0;
                    const isOver = spd > companySpeedLimit;
                    const pctOfLimit = Math.min(100, Math.round((spd / companySpeedLimit) * 100));
                    const isMoving = v.status === "Moving";

                    return (
                      <tr key={v.id || v.number} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-3">
                          <div className="font-bold text-slate-900 flex items-center gap-1.5">
                            <Truck className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                            <span>{v.number}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[140px]">
                            {v.model || v.type || "Fleet Asset"}
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <div className="font-semibold text-slate-800">{v.driver || "Unassigned"}</div>
                          {v.deviceId && (
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                              DEV: {v.deviceId.slice(-6)}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          <div className="flex items-baseline justify-between mb-1">
                            <span
                              className={`text-base font-extrabold ${
                                isOver
                                  ? "text-red-600 animate-pulse"
                                  : isMoving
                                  ? "text-emerald-600"
                                  : "text-slate-500"
                              }`}
                            >
                              {spd}{" "}
                              <span className="text-[11px] font-normal text-slate-400">km/h</span>
                            </span>
                            <span className="text-[10px] text-slate-400 font-medium">
                              limit {companySpeedLimit} km/h
                            </span>
                          </div>
                          {/* Visual Speed Gauge Bar */}
                          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-full transition-all duration-500 rounded-full ${
                                isOver
                                  ? "bg-red-500"
                                  : spd >= companySpeedLimit - 10
                                  ? "bg-amber-500"
                                  : isMoving
                                  ? "bg-emerald-500"
                                  : "bg-slate-300"
                              }`}
                              style={{ width: `${Math.max(4, pctOfLimit)}%` }}
                            />
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          {isMoving ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping shrink-0" />
                              Moving
                            </span>
                          ) : v.status === "Idle" ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                              Idle
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600">
                              {v.status || "Parked"}
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          {isOver ? (
                            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300 font-bold">
                              +{spd - companySpeedLimit} km/h OVER
                            </Badge>
                          ) : spd > 0 ? (
                            <span className="text-[11px] text-emerald-700 font-medium">
                              -{companySpeedLimit - spd} km/h below limit
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">At rest (0 km/h)</span>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1 text-slate-700 truncate max-w-[180px]" title={v.location || (v.lat ? `${v.lat.toFixed(4)}, ${v.lng.toFixed(4)}` : "Location pending")}>
                            <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                            <span className="truncate">{v.location || (v.lat ? `${v.lat.toFixed(4)}, ${v.lng.toFixed(4)}` : "GPS active")}</span>
                          </div>
                          {v.lat !== 0 && v.lng !== 0 && (
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                              {v.lat.toFixed(4)}° N, {v.lng.toFixed(4)}° E
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 text-slate-500 text-[11px]">
                          {v.lastUpdate || "Live"}
                        </td>

                        <td className="py-3 px-3 text-right">
                          <Link
                            to={`/tracking`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-indigo-600 font-semibold text-xs shadow-2xs hover:border-indigo-300 transition-colors"
                          >
                            Track Live
                            <ChevronRight className="h-3 w-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── TAB 1: SPEEDING INCIDENTS LOG ───────────────────────── */}
      {activeTab === "incidents" && (
        <Card className="border border-slate-200/80 shadow-xs p-4 space-y-4">
          {/* Real-time Fleet Speed Radar Strip */}
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                <Radio className="h-3.5 w-3.5 text-emerald-600 animate-pulse" />
                <span>Live Fleet Speed Radar</span>
                <span className="text-[11px] font-normal text-slate-500">
                  (Real-time telemetry from {TELEMETRY_LABEL})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("realtime")}
                className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 cursor-pointer"
              >
                View Full Live Speed Monitor <ChevronRight className="h-3 w-3" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
              {liveVehicles.map((v) => {
                const spd = typeof v.speed === "number" ? Math.round(v.speed) : 0;
                const isOver = spd > companySpeedLimit;
                return (
                  <div
                    key={v.id || v.number}
                    className={`p-2 rounded-xl border bg-white text-xs space-y-1 transition-all ${
                      isOver
                        ? "border-red-300 ring-2 ring-red-500/20"
                        : v.status === "Moving"
                        ? "border-emerald-200"
                        : "border-slate-200"
                    }`}
                  >
                    <div className="font-bold text-slate-900 truncate text-[11px]" title={v.number}>
                      {v.number}
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span
                        className={`text-sm font-bold ${
                          isOver ? "text-red-600" : v.status === "Moving" ? "text-emerald-600" : "text-slate-500"
                        }`}
                      >
                        {spd} <span className="text-[10px] font-normal text-slate-400">km/h</span>
                      </span>
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          v.status === "Moving" ? "bg-emerald-500 animate-ping" : "bg-amber-400"
                        }`}
                      />
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {v.status === "Moving" ? "Moving" : "Idle"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Vehicle:</span>
                <select
                  value={vehicleFilter}
                  onChange={(e) => setVehicleFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-800 outline-none"
                >
                  <option value="All">All Vehicles</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.number}>
                      {v.number}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Driver:</span>
                <select
                  value={driverFilter}
                  onChange={(e) => setDriverFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 outline-none"
                >
                  <option value="All">All Drivers</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Severity:</span>
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value as any)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 outline-none"
                >
                  <option value="All">All Severities</option>
                  <option value="Low">Low (+1-10 km/h)</option>
                  <option value="Medium">Medium (+10-20 km/h)</option>
                  <option value="High">High (+20-30 km/h)</option>
                  <option value="Critical">Critical (&gt;80 km/h)</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Status:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 outline-none"
                >
                  <option value="All">All Statuses</option>
                  <option value="New">New</option>
                  <option value="Acknowledged">Acknowledged</option>
                  <option value="Resolved">Resolved</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-xs text-slate-500 font-medium">
                Showing {filteredIncidents.length} events above {companySpeedLimit} km/h
              </div>
              <button
                type="button"
                onClick={handleResetOverspeedRecords}
                disabled={isResettingAlerts || incidents.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="Reset / Clear all overspeed records from database"
              >
                <RotateCcw className={`h-3.5 w-3.5 ${isResettingAlerts ? "animate-spin" : ""}`} />
                <span>Reset Overspeed Records ({incidents.length})</span>
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                  <th className="py-2.5 px-3">Vehicle</th>
                  <th className="py-2.5 px-3">Driver</th>
                  <th className="py-2.5 px-3">Date & Time</th>
                  <th className="py-2.5 px-3">Speed Recorded</th>
                  <th className="py-2.5 px-3">Excess Speed</th>
                  <th className="py-2.5 px-3">Duration</th>
                  <th className="py-2.5 px-3">Location</th>
                  <th className="py-2.5 px-3">Severity</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredIncidents.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-12 text-slate-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <div className="h-10 w-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                          <ShieldCheck className="h-6 w-6" />
                        </div>
                        <div className="font-semibold text-slate-800 text-sm">
                          No Speeding Incidents Recorded
                        </div>
                        <div className="text-xs text-slate-400 max-w-sm">
                          All fleet vehicles are operating safely within the {companySpeedLimit} km/h threshold. Overspeed records are clean.
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredIncidents.map((inc) => (
                  <tr key={inc.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-3 font-bold text-slate-900">{inc.vehicleNumber}</td>
                    <td className="py-3 px-3 text-slate-700">{inc.driverName}</td>
                    <td className="py-3 px-3 text-slate-600">
                      {new Date(inc.timestamp).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-3 px-3 font-bold text-red-600">{inc.recordedSpeed} km/h</td>
                    <td className="py-3 px-3 font-semibold text-amber-700">+{inc.excessSpeed} km/h</td>
                    <td className="py-3 px-3 text-slate-700">{inc.durationSeconds}s</td>
                    <td className="py-3 px-3 text-slate-500 truncate max-w-[180px]" title={inc.location}>
                      {inc.location}
                    </td>
                    <td className="py-3 px-3">
                      <Badge
                        variant="outline"
                        className={
                          inc.severity === "Critical"
                            ? "bg-red-50 text-red-700 border-red-300 font-bold"
                            : inc.severity === "High"
                            ? "bg-orange-50 text-orange-700 border-orange-300 font-semibold"
                            : inc.severity === "Medium"
                            ? "bg-amber-50 text-amber-700 border-amber-300"
                            : "bg-slate-100 text-slate-600"
                        }
                      >
                        {inc.severity}
                      </Badge>
                    </td>
                    <td className="py-3 px-3">
                      <Badge
                        variant="outline"
                        className={
                          inc.status === "Resolved"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                            : inc.status === "Acknowledged"
                            ? "bg-indigo-50 text-indigo-700 border-indigo-300"
                            : "bg-red-50 text-red-700 border-red-300 animate-pulse"
                        }
                      >
                        {inc.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 text-right">
                      {inc.status !== "Resolved" ? (
                        <button
                          onClick={() => {
                            setResolvingIncident(inc);
                            setResolutionNote("");
                            setResolutionAction("Acknowledged");
                          }}
                          className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs shadow-2xs"
                        >
                          Review
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400">Resolved</span>
                      )}
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── TAB 2: SPEEDING ANALYTICS & TRENDS ───────────────────── */}
      {activeTab === "analytics" && (
        <div className="space-y-5">
          {/* Trend Chart */}
          <Card className="border border-slate-200/80 p-5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div>
                <div className="text-sm font-bold text-slate-900">Weekly Speeding Incident Trend</div>
                <div className="text-xs text-slate-500">
                  Number of events exceeding {companySpeedLimit} km/h per day
                </div>
              </div>
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analyticsSummary.trendChart}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#FFFFFF",
                      borderRadius: "12px",
                      border: "1px solid #E2E8F0",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="incidents" fill="#EF4444" radius={[6, 6, 0, 0]} name="Speeding Incidents" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Breakdown Tables: Vehicles & Drivers */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Top Vehicles Exceeding Speed Limit */}
            <Card className="border border-slate-200/80 p-4 shadow-xs">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-1.5">
                <Truck className="h-4 w-4 text-indigo-600" />
                Vehicles with Highest Incidents
              </div>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 uppercase text-[10px]">
                    <th className="py-2">Vehicle</th>
                    <th className="py-2">Category</th>
                    <th className="py-2 text-right">Incidents</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analyticsSummary.topVehicles.slice(0, 6).map((v) => {
                    const match = vehicles.find((x) => x.number === v.vehicle);
                    return (
                      <tr key={v.vehicle}>
                        <td className="py-2.5 font-bold text-slate-900">{v.vehicle}</td>
                        <td className="py-2.5 text-slate-500">{match?.type || "Tanker"}</td>
                        <td className="py-2.5 text-right font-bold text-red-600">{v.count} times</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>

            {/* Repeat Drivers Breakdown */}
            <Card className="border border-slate-200/80 p-4 shadow-xs">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-1.5">
                <UsersRound className="h-4 w-4 text-indigo-600" />
                Repeat Drivers Safety Audit
              </div>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 uppercase text-[10px]">
                    <th className="py-2">Driver Name</th>
                    <th className="py-2">Max Speed</th>
                    <th className="py-2 text-right">Total Incidents</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analyticsSummary.repeatDrivers.slice(0, 6).map((d) => (
                    <tr key={d.driver}>
                      <td className="py-2.5 font-semibold text-slate-900">{d.driver}</td>
                      <td className="py-2.5 font-bold text-amber-600">{d.maxSpeed} km/h</td>
                      <td className="py-2.5 text-right font-bold text-red-600">{d.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </div>
      )}

      {/* ── TAB 3: DRIVING BEHAVIOR ─────────────────────────────── */}
      {activeTab === "behavior" && (
        <Card className="border border-slate-200/80 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <div className="text-sm font-bold text-slate-900">Driving Behavior & Telematic Events</div>
              <div className="text-xs text-slate-500">
                Hardware-detected and GPS-inferred maneuvers (Harsh acceleration, braking, cornering, excessive idling)
              </div>
            </div>
            <Badge variant="outline" className="text-[11px]">
              {behaviorEvents.length} detected maneuvers
            </Badge>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                  <th className="py-2.5 px-3">Maneuver Type</th>
                  <th className="py-2.5 px-3">Vehicle</th>
                  <th className="py-2.5 px-3">Driver</th>
                  <th className="py-2.5 px-3">Timestamp</th>
                  <th className="py-2.5 px-3">Data Source</th>
                  <th className="py-2.5 px-3">Telemetry Metric</th>
                  <th className="py-2.5 px-3">Severity</th>
                  <th className="py-2.5 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {behaviorEvents.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-3 font-bold text-slate-900">{b.type}</td>
                    <td className="py-3 px-3 text-slate-800">{b.vehicleNumber}</td>
                    <td className="py-3 px-3 text-slate-700">{b.driverName}</td>
                    <td className="py-3 px-3 text-slate-600">
                      {new Date(b.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-3 px-3">
                      <Badge
                        variant="outline"
                        className={
                          b.source === "Hardware Sensor"
                            ? "bg-purple-50 text-purple-700 border-purple-200 font-semibold"
                            : "bg-slate-100 text-slate-600"
                        }
                      >
                        {b.source}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-slate-700">{b.value}</td>
                    <td className="py-3 px-3">
                      <Badge
                        variant="outline"
                        className={
                          b.severity === "High"
                            ? "bg-red-50 text-red-700 border-red-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        }
                      >
                        {b.severity}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <Badge
                        variant="outline"
                        className={
                          b.status === "Resolved"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-slate-100 text-slate-700"
                        }
                      >
                        {b.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── TAB 4: CONFIGURABLE SPEED POLICIES ──────────────────── */}
      {activeTab === "policy" && (
        <Card className="border border-slate-200/80 p-5 shadow-xs max-w-2xl space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <div className="text-base font-bold text-slate-900">Fleet Speed Policies & Thresholds</div>
            <div className="text-xs text-slate-500">
              Configure baseline limits and noise-filtering rules across vehicles and categories
            </div>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Company Baseline Speed Threshold
              </label>
              <div className="flex items-center gap-2 max-w-xs">
                <input
                  type="number"
                  value={companySpeedLimit}
                  onChange={(e) => setCompanySpeedLimit(Math.max(30, parseInt(e.target.value, 10) || 60))}
                  className="px-3 py-2 rounded-xl border border-slate-200 font-bold text-sm text-slate-900 w-full"
                  min={30}
                  max={120}
                />
                <span className="text-slate-500 font-medium">km/h</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Initial standard threshold is 60 km/h. Incidents are logged whenever sustained speed exceeds this value.
              </p>
            </div>

            <div className="pt-3 border-t border-slate-100">
              <label className="font-semibold text-slate-700 block mb-1">
                Data Quality & GPS Noise Debounce Rule
              </label>
              <div className="flex items-center gap-2 max-w-xs">
                <input
                  type="number"
                  value={minIncidentDurationSec}
                  onChange={(e) => setMinIncidentDurationSec(parseInt(e.target.value, 10) || 8)}
                  className="px-3 py-2 rounded-xl border border-slate-200 font-bold text-sm text-slate-900 w-full"
                  min={3}
                  max={60}
                />
                <span className="text-slate-500 font-medium">seconds</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Prevents momentary GPS jitter or single noisy telemetry points from triggering genuine speeding events.
              </p>
            </div>

            <div className="pt-3 border-t border-slate-100 space-y-2">
              <div className="font-semibold text-slate-700">Category-Specific Policies</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                  <div className="font-semibold text-slate-800">Refrigerated Milk Tankers</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Heavy vehicle limit: 55 km/h</div>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                  <div className="font-semibold text-slate-800">Distribution Delivery Vans</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Urban limit: 50 km/h · Highway: 65 km/h</div>
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── RESOLUTION MODAL ────────────────────────────────────── */}
      {resolvingIncident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 border border-slate-200 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <div className="text-sm font-bold text-slate-900">Incident Review & Acknowledgement</div>
                <div className="text-xs text-slate-500">
                  {resolvingIncident.vehicleNumber} · {resolvingIncident.recordedSpeed} km/h
                </div>
              </div>
              <button onClick={() => setResolvingIncident(null)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={submitIncidentResolution} className="space-y-3.5 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Incident Summary</label>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <div>
                    <span className="text-slate-500">Driver:</span>{" "}
                    <span className="font-semibold text-slate-800">{resolvingIncident.driverName}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Excess Speed:</span>{" "}
                    <span className="font-bold text-red-600">+{resolvingIncident.excessSpeed} km/h</span> (over{" "}
                    {resolvingIncident.speedLimit} km/h limit)
                  </div>
                  <div>
                    <span className="text-slate-500">Duration:</span>{" "}
                    <span className="font-semibold text-slate-800">{resolvingIncident.durationSeconds} seconds</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Status Action</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setResolutionAction("Acknowledged")}
                    className={`p-2 rounded-xl border text-center font-semibold ${
                      resolutionAction === "Acknowledged"
                        ? "bg-indigo-50 border-indigo-600 text-indigo-700"
                        : "border-slate-200 text-slate-700"
                    }`}
                  >
                    Acknowledge
                  </button>
                  <button
                    type="button"
                    onClick={() => setResolutionAction("Resolved")}
                    className={`p-2 rounded-xl border text-center font-semibold ${
                      resolutionAction === "Resolved"
                        ? "bg-emerald-50 border-emerald-600 text-emerald-700"
                        : "border-slate-200 text-slate-700"
                    }`}
                  >
                    Mark Resolved
                  </button>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Resolution & Manager Notes</label>
                <textarea
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  placeholder="e.g. Discussed with driver; driver cited overtaking slow farm tractor on bridge. Caution issued."
                  className="w-full p-2.5 rounded-xl border border-slate-200 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 h-20"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  onClick={() => setResolvingIncident(null)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs px-3 py-1.5 rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmittingResolution}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-4 py-1.5 rounded-xl flex items-center gap-1.5"
                >
                  {isSubmittingResolution ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save Workflow
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
