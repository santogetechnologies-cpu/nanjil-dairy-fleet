/**
 * _app.stops.tsx — Vehicle Stop Tracking & Stop History Page
 *
 * Full production-ready interface for monitoring vehicle stops:
 * - Section A: OVERVIEW (8 Fleet Stop KPIs)
 * - Section B: LIVE STOP TRACKING (Real-time ticking duration for stopped vehicles)
 * - Section C: STOP HISTORY (Full tabular log with multi-parameter filtering, search, pagination)
 * - Section D: STOP ANALYTICS (Daily vehicle durations, weekly trend, threshold brackets, idling vs parked)
 * - Section E: EXPORT (CSV / Excel export and Printable PDF view)
 */

import { useState, useMemo, useEffect } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Badge, Button, Card } from "@/components/ui-kit";
import {
  Clock,
  MapPin,
  Truck,
  UsersRound,
  Calendar,
  Filter,
  Search,
  FileSpreadsheet,
  Printer,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Zap,
  Activity,
  Layers,
  Loader2,
  ExternalLink,
  ChevronDown,
  Sparkles,
  BarChart3,
  Eye,
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
  Cell,
  PieChart,
  Pie,
} from "recharts";
import { useVehicleStopTracking } from "@/hooks/useVehicleStopTracking";
import { useVehicles, TELEMETRY_LABEL } from "@/hooks/useVehicleTracking";
import { StopMapModal, formatStopDuration } from "@/components/StopMapModal";
import type { VehicleStopEvent, StopStatus } from "@/lib/vehicle-stop-detection";
import { safeTimestampToMs } from "@/lib/vehicle-stop-detection";

type ActiveTab = "live" | "history" | "analytics";
type DateFilter = "all" | "today" | "yesterday" | "week" | "month";
type DurationFilter = "all" | "short" | "medium" | "long" | "extended";
type EngineFilter = "all" | "idle" | "parked";
type StatusFilter = "all" | "ACTIVE" | "COMPLETED" | "INTERRUPTED";

export default function VehicleStopHistoryPage() {
  const { stops, activeStops, overviewKPIs, isLoading, isTableAvailable, refreshStops } = useVehicleStopTracking();
  const liveVehicles = useVehicles();

  // Active sub-tab
  const [activeTab, setActiveTab] = useState<ActiveTab>("live");

  // Filter States
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const [vehicleFilter, setVehicleFilter] = useState<string>("All");
  const [driverFilter, setDriverFilter] = useState<string>("All");
  const [durationFilter, setDurationFilter] = useState<DurationFilter>("all");
  const [engineFilter, setEngineFilter] = useState<EngineFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Map inspection modal
  const [inspectStop, setInspectStop] = useState<VehicleStopEvent | null>(null);

  // Derive unique vehicles and drivers list for dropdown filters
  const vehicleOptions = useMemo(() => {
    const map = new Map<string, string>();
    liveVehicles.forEach((v) => {
      if (v.number) map.set(v.number, v.number);
    });
    stops.forEach((s) => {
      if (s.vehicle_number) map.set(s.vehicle_number, s.vehicle_number);
    });
    return Array.from(map.values()).sort();
  }, [liveVehicles, stops]);

  const driverOptions = useMemo(() => {
    const set = new Set<string>();
    liveVehicles.forEach((v) => {
      if (v.driver && v.driver !== "Unassigned") set.add(v.driver);
    });
    stops.forEach((s) => {
      if (s.driver_name && s.driver_name !== "Unassigned") set.add(s.driver_name);
    });
    return Array.from(set).sort();
  }, [liveVehicles, stops]);

  // ── FILTERING STOP HISTORY ──────────────────────────────────────────────────
  const filteredStops = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400 * 1000;
    const startOfWeek = startOfToday - now.getDay() * 86400 * 1000;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    return stops.filter((stop) => {
      const startMs = safeTimestampToMs(stop.started_at);

      // Date Range Filter
      if (dateFilter === "today") {
        if (!startMs || startMs < startOfToday) return false;
      } else if (dateFilter === "yesterday") {
        if (!startMs || startMs < startOfYesterday || startMs >= startOfToday) return false;
      } else if (dateFilter === "week") {
        if (!startMs || startMs < startOfWeek) return false;
      } else if (dateFilter === "month") {
        if (!startMs || startMs < startOfMonth) return false;
      }

      // Vehicle Filter
      if (vehicleFilter !== "All" && stop.vehicle_number !== vehicleFilter) {
        return false;
      }

      // Driver Filter
      if (driverFilter !== "All" && stop.driver_name !== driverFilter) {
        return false;
      }

      // Duration Filter
      const durSec = stop.duration_seconds || 0;
      if (durationFilter === "short" && (durSec >= 15 * 60)) return false; // < 15m
      if (durationFilter === "medium" && (durSec < 15 * 60 || durSec >= 30 * 60)) return false; // 15-30m
      if (durationFilter === "long" && (durSec < 30 * 60 || durSec >= 60 * 60)) return false; // 30-60m
      if (durationFilter === "extended" && durSec < 60 * 60) return false; // > 60m

      // Engine Status Filter
      if (engineFilter === "idle" && !stop.engine_on) return false;
      if (engineFilter === "parked" && stop.engine_on) return false;

      // Status Filter
      if (statusFilter !== "all" && stop.status !== statusFilter) return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesVeh = (stop.vehicle_number || "").toLowerCase().includes(q);
        const matchesDrv = (stop.driver_name || "").toLowerCase().includes(q);
        const matchesLoc = (stop.location || "").toLowerCase().includes(q);
        if (!matchesVeh && !matchesDrv && !matchesLoc) return false;
      }

      return true;
    });
  }, [stops, dateFilter, vehicleFilter, driverFilter, durationFilter, engineFilter, statusFilter, searchQuery]);

  // Paginated Slices
  const totalPages = Math.max(1, Math.ceil(filteredStops.length / pageSize));
  const paginatedStops = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredStops.slice(start, start + pageSize);
  }, [filteredStops, currentPage, pageSize]);

  // Reset page when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [dateFilter, vehicleFilter, driverFilter, durationFilter, engineFilter, statusFilter, searchQuery, pageSize]);

  // ── ANALYTICS AGGREGATIONS ──────────────────────────────────────────────────
  const analyticsData = useMemo(() => {
    const vehicleDurations: Record<string, { durationSec: number; count: number }> = {};
    const driverDurations: Record<string, { durationSec: number; count: number }> = {};
    let exceeding15m = 0;
    let exceeding30m = 0;
    let exceeding60m = 0;
    let totalIdleSec = 0;
    let totalParkedSec = 0;

    const dailyTrendMap: Record<string, number> = {
      Mon: 0,
      Tue: 0,
      Wed: 0,
      Thu: 0,
      Fri: 0,
      Sat: 0,
      Sun: 0,
    };

    filteredStops.forEach((s) => {
      const dur = s.duration_seconds || 0;
      const vNum = s.vehicle_number || "Other";
      const dName = s.driver_name || "Unassigned";

      // By Vehicle
      if (!vehicleDurations[vNum]) vehicleDurations[vNum] = { durationSec: 0, count: 0 };
      vehicleDurations[vNum].durationSec += dur;
      vehicleDurations[vNum].count += 1;

      // By Driver
      if (!driverDurations[dName]) driverDurations[dName] = { durationSec: 0, count: 0 };
      driverDurations[dName].durationSec += dur;
      driverDurations[dName].count += 1;

      // Threshold Brackets
      if (dur >= 60 * 60) exceeding60m++;
      if (dur >= 30 * 60) exceeding30m++;
      if (dur >= 15 * 60) exceeding15m++;

      // Engine Status
      if (s.engine_on) {
        totalIdleSec += dur;
      } else {
        totalParkedSec += dur;
      }

      // 7-day trend
      const day = new Date(s.started_at).toLocaleDateString([], { weekday: "short" });
      if (dailyTrendMap[day] !== undefined) {
        dailyTrendMap[day] += Math.round(dur / 60); // in minutes
      }
    });

    const topVehicles = Object.entries(vehicleDurations)
      .map(([vehicle, val]) => ({
        vehicle,
        stoppedHours: +(val.durationSec / 3600).toFixed(1),
        count: val.count,
      }))
      .sort((a, b) => b.stoppedHours - a.stoppedHours)
      .slice(0, 8);

    const topDrivers = Object.entries(driverDurations)
      .map(([driver, val]) => ({
        driver,
        stoppedHours: +(val.durationSec / 3600).toFixed(1),
        count: val.count,
      }))
      .sort((a, b) => b.stoppedHours - a.stoppedHours)
      .slice(0, 8);

    const weeklyTrend = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => ({
      day,
      minutes: dailyTrendMap[day] || 0,
    }));

    const enginePie = [
      { name: "Idle (Engine ON)", value: Math.round(totalIdleSec / 60), color: "#F59E0B" },
      { name: "Parked (Engine OFF)", value: Math.round(totalParkedSec / 60), color: "#3B82F6" },
    ];

    return {
      topVehicles,
      topDrivers,
      weeklyTrend,
      enginePie,
      exceeding15m,
      exceeding30m,
      exceeding60m,
      totalIdleHours: (totalIdleSec / 3600).toFixed(1),
      totalParkedHours: (totalParkedSec / 3600).toFixed(1),
    };
  }, [filteredStops]);

  // ── EXPORT HANDLERS ─────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    if (filteredStops.length === 0) {
      alert("No stop records available for the selected filters.");
      return;
    }

    const headers = [
      "Vehicle Registration",
      "Driver Name",
      "Start Time",
      "End Time",
      "Duration (Seconds)",
      "Duration (Formatted)",
      "Start Coordinates",
      "End Coordinates",
      "Location",
      "Engine Status",
      "Stop Status",
    ];

    const rows = filteredStops.map((s) => [
      `"${s.vehicle_number || "Vehicle"}"`,
      `"${s.driver_name || "Unassigned"}"`,
      `"${s.started_at}"`,
      `"${s.ended_at || "In Progress"}"`,
      s.duration_seconds || 0,
      `"${formatStopDuration(s.duration_seconds)}"`,
      `"${s.start_lat}, ${s.start_lng}"`,
      `"${s.end_lat ?? s.start_lat}, ${s.end_lng ?? s.start_lng}"`,
      `"${(s.location || "En Route").replace(/"/g, '""')}"`,
      s.engine_on ? '"Idle (Engine ON)"' : '"Parked (Engine OFF)"',
      `"${s.status}"`,
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `nanjil-vehicle-stops-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* ── HEADER ──────────────────────────────────────────────── */}
      <PageHeader
        title="Vehicle Stop History"
        subtitle={`Automated Stationary Telemetry Tracking · 2-Min Confirmation Threshold · ${activeStops.length} Stopped (${overviewKPIs.currentlyIdleCount} Idle, ${overviewKPIs.currentlyParkedCount} Parked)`}
        actions={
          <div className="flex items-center gap-2">
            <div className="bg-slate-100 p-1 rounded-xl flex items-center text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab("live")}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === "live"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span>Live Stopped</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">
                  {activeStops.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("history")}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === "history"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Stop History Log
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("analytics")}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === "analytics"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Stop Analytics
              </button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              className="gap-1.5 text-xs font-semibold shadow-2xs"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
              <span>Export CSV</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="gap-1.5 text-xs font-semibold shadow-2xs"
            >
              <Printer className="h-3.5 w-3.5 text-slate-500" />
              <span>Print</span>
            </Button>
          </div>
        }
      />

      {/* ── AUTONOMOUS PERSISTENCE ENGINE NOTICE (When remote DB table is pending) ── */}
      {!isTableAvailable && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-amber-950">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 bg-amber-100 text-amber-800 rounded-lg shrink-0">
              <Clock className="h-4 w-4" />
            </span>
            <div>
              <p className="font-bold text-amber-950">
                Autonomous Stop Tracking Engine Active (Persistent Local Cache)
              </p>
              <p className="text-amber-800/90 text-[11px] mt-0.5">
                Stops and live duration timers are running locally without loss. Run migration <code>20261104143000_create_vehicle_stop_events.sql</code> in the Supabase Dashboard SQL Editor to sync fleet-wide.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(`CREATE TABLE IF NOT EXISTS public.vehicle_stop_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id        UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  driver_id         UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  started_at        TIMESTAMP WITH TIME ZONE NOT NULL,
  ended_at          TIMESTAMP WITH TIME ZONE,
  duration_seconds  INTEGER,
  start_lat         NUMERIC(9,6),
  start_lng         NUMERIC(9,6),
  end_lat           NUMERIC(9,6),
  end_lng           NUMERIC(9,6),
  location          TEXT,
  engine_on         BOOLEAN DEFAULT false,
  status            TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED', 'INTERRUPTED')),
  source            TEXT NOT NULL DEFAULT 'telemetry',
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vehicle_stop_events_vehicle_started ON public.vehicle_stop_events(vehicle_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_stop_events_status ON public.vehicle_stop_events(status);
CREATE INDEX IF NOT EXISTS idx_vehicle_stop_events_driver ON public.vehicle_stop_events(driver_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_stop_events_started_at ON public.vehicle_stop_events(started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_stop_events_one_active ON public.vehicle_stop_events(vehicle_id) WHERE (status = 'ACTIVE');
ALTER TABLE public.vehicle_stop_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow select stop events" ON public.vehicle_stop_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow insert stop events" ON public.vehicle_stop_events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow update stop events" ON public.vehicle_stop_events FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.vehicle_stop_events TO anon, authenticated;`);
              alert("Supabase SQL migration copied to clipboard! Paste and run it in your Supabase Dashboard SQL Editor.");
            }}
            className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-900 rounded-xl font-semibold transition-colors cursor-pointer shrink-0"
          >
            Copy SQL Migration
          </button>
        </div>
      )}

      {/* ── SECTION A: OVERVIEW TILES (8 KPIs) ──────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-3">
        {/* 1. Total Stopped Vehicles */}
        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Stopped Now</span>
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
          </div>
          <div className="text-xl font-extrabold text-slate-900 mt-1">
            {overviewKPIs.totalStoppedVehicles}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Live stationary units</div>
        </div>

        {/* 2. Total Stops Today */}
        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Stops Today
          </div>
          <div className="text-xl font-extrabold text-indigo-600 mt-1">
            {overviewKPIs.totalStopsToday}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Confirmed ≥ 2 min</div>
        </div>

        {/* 3. Total Stopped Duration Today */}
        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Total Stopped
          </div>
          <div className="text-lg font-extrabold text-slate-900 mt-1 truncate" title={formatStopDuration(overviewKPIs.totalStoppedDurationTodaySec)}>
            {formatStopDuration(overviewKPIs.totalStoppedDurationTodaySec)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Cumulative today</div>
        </div>

        {/* 4. Average Stop Duration */}
        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Avg Stop Time
          </div>
          <div className="text-lg font-extrabold text-slate-900 mt-1 truncate">
            {formatStopDuration(overviewKPIs.avgStopDurationSec)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Mean per stop</div>
        </div>

        {/* 5. Longest Individual Stop */}
        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Longest Stop
          </div>
          <div className="text-lg font-extrabold text-red-600 mt-1 truncate" title={overviewKPIs.longestStopToday ? `${overviewKPIs.longestStopToday.vehicleNumber} (${formatStopDuration(overviewKPIs.longestStopToday.durationSeconds)})` : "None"}>
            {overviewKPIs.longestStopToday ? formatStopDuration(overviewKPIs.longestStopToday.durationSeconds) : "—"}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 truncate">
            {overviewKPIs.longestStopToday ? overviewKPIs.longestStopToday.vehicleNumber : "No events"}
          </div>
        </div>

        {/* 6. Currently Idle (Engine ON) */}
        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wider flex items-center justify-between">
            <span>Active Idle</span>
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          </div>
          <div className="text-xl font-extrabold text-amber-600 mt-1">
            {overviewKPIs.currentlyIdleCount}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Engine ON (Idling)</div>
        </div>

        {/* 7. Currently Parked (Engine OFF) */}
        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-bold text-blue-600 uppercase tracking-wider flex items-center justify-between">
            <span>Parked</span>
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          </div>
          <div className="text-xl font-extrabold text-blue-600 mt-1">
            {overviewKPIs.currentlyParkedCount}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Engine OFF</div>
        </div>

        {/* 8. Interrupted Tracking Events */}
        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Interrupted</span>
            <AlertTriangle className="h-3 w-3 text-slate-400" />
          </div>
          <div className="text-xl font-extrabold text-slate-700 mt-1">
            {overviewKPIs.interruptedCount}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Signal dropouts</div>
        </div>
      </div>

      {/* ── SECTION B: LIVE STOP TRACKING TAB ───────────────────── */}
      {activeTab === "live" && (
        <Card className="border border-slate-200/80 shadow-xs p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Currently Stationary Vehicles ({activeStops.length})
                </h3>
                <p className="text-[11px] text-slate-500">
                  Live stop timer updates every second · Automatic movement detection at &gt;5 km/h
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-500 font-medium">Source:</span>
              <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200 text-[11px]">
                {TELEMETRY_LABEL}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                  <th className="py-2.5 px-3">Vehicle</th>
                  <th className="py-2.5 px-3">Driver</th>
                  <th className="py-2.5 px-3">Stop Began</th>
                  <th className="py-2.5 px-3">Live Duration</th>
                  <th className="py-2.5 px-3">GPS Location</th>
                  <th className="py-2.5 px-3">Engine Status</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Map View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeStops.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <div className="h-10 w-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
                          <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                        </div>
                        <div className="font-semibold text-slate-700 text-sm">
                          No Vehicles Currently Stopped
                        </div>
                        <div className="text-xs text-slate-400 max-w-sm">
                          All active connected fleet units are in transit or completing collection circuits.
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  activeStops.map((stop) => {
                    const isLongStop = stop.duration_seconds >= 30 * 60; // 30 min+
                    return (
                      <tr key={stop.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-3">
                          <div className="font-bold text-slate-900 flex items-center gap-1.5">
                            <Truck className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                            <span>{stop.vehicle_number}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[140px]">
                            {stop.vehicle_model || "Fleet Asset"}
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <div className="font-semibold text-slate-800">
                            {stop.driver_name || "Unassigned"}
                          </div>
                          <div className="text-[10px] text-slate-400">Assigned Driver</div>
                        </td>

                        <td className="py-3 px-3">
                          <div className="text-slate-800 font-medium">
                            {new Date(stop.started_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {new Date(stop.started_at).toLocaleDateString([], {
                              month: "short",
                              day: "numeric",
                            })}
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <div
                            className={`font-mono text-sm font-bold flex items-center gap-1 ${
                              isLongStop ? "text-amber-600 font-extrabold" : "text-emerald-700"
                            }`}
                          >
                            <Clock className="h-3.5 w-3.5" />
                            <span>{formatStopDuration(stop.duration_seconds)}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {isLongStop ? "Exceeds 30m" : "Live Ticking"}
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1 text-slate-700 truncate max-w-[180px]" title={stop.location}>
                            <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                            <span className="truncate">{stop.location || "En Route"}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                            {stop.start_lat.toFixed(4)}°, {stop.start_lng.toFixed(4)}°
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          {stop.engine_on ? (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 font-semibold">
                              Idle (Engine ON)
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                              Parked (Engine OFF)
                            </Badge>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 font-bold animate-pulse">
                            ACTIVE
                          </Badge>
                        </td>

                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => setInspectStop(stop)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-indigo-600 font-semibold text-xs shadow-2xs transition-colors cursor-pointer"
                          >
                            <Eye className="h-3 w-3" />
                            <span>Map</span>
                          </button>
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

      {/* ── SECTION C: STOP HISTORY LOG TAB ─────────────────────── */}
      {activeTab === "history" && (
        <Card className="border border-slate-200/80 shadow-xs p-4 space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {/* Date Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Period:</span>
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value as DateFilter)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-800 outline-none cursor-pointer"
                >
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="all">All Time</option>
                </select>
              </div>

              {/* Vehicle Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Vehicle:</span>
                <select
                  value={vehicleFilter}
                  onChange={(e) => setVehicleFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 outline-none cursor-pointer max-w-[140px] truncate"
                >
                  <option value="All">All Vehicles</option>
                  {vehicleOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              {/* Driver Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Driver:</span>
                <select
                  value={driverFilter}
                  onChange={(e) => setDriverFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 outline-none cursor-pointer max-w-[130px] truncate"
                >
                  <option value="All">All Drivers</option>
                  {driverOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              {/* Duration Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Duration:</span>
                <select
                  value={durationFilter}
                  onChange={(e) => setDurationFilter(e.target.value as DurationFilter)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 outline-none cursor-pointer"
                >
                  <option value="all">All Durations</option>
                  <option value="short">&lt; 15 mins</option>
                  <option value="medium">15 - 30 mins</option>
                  <option value="long">30 - 60 mins</option>
                  <option value="extended">&gt; 60 mins</option>
                </select>
              </div>

              {/* Engine Status Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Engine:</span>
                <select
                  value={engineFilter}
                  onChange={(e) => setEngineFilter(e.target.value as EngineFilter)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 outline-none cursor-pointer"
                >
                  <option value="all">All Engine</option>
                  <option value="idle">Idle (ON)</option>
                  <option value="parked">Parked (OFF)</option>
                </select>
              </div>

              {/* Stop Status Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Status:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 outline-none cursor-pointer"
                >
                  <option value="all">All Statuses</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="ACTIVE">Active</option>
                  <option value="INTERRUPTED">Interrupted</option>
                </select>
              </div>
            </div>

            {/* Search Box */}
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search vehicle, driver, place..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-52"
              />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                  <th className="py-2.5 px-3">Vehicle</th>
                  <th className="py-2.5 px-3">Driver</th>
                  <th className="py-2.5 px-3">Start Time</th>
                  <th className="py-2.5 px-3">End Time</th>
                  <th className="py-2.5 px-3">Total Duration</th>
                  <th className="py-2.5 px-3">Coordinates (Start / End)</th>
                  <th className="py-2.5 px-3">Location / Address</th>
                  <th className="py-2.5 px-3">Engine</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedStops.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-12 text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Clock className="h-8 w-8 text-slate-300" />
                        <div className="font-semibold text-slate-700">No Stop Records Found</div>
                        <div className="text-xs text-slate-400 max-w-sm">
                          Try switching your period filter to "All Time" or resetting vehicle/duration filters.
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedStops.map((stop) => (
                    <tr key={stop.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3 font-bold text-slate-900">
                        {stop.vehicle_number}
                      </td>

                      <td className="py-3 px-3 text-slate-700 font-medium">
                        {stop.driver_name || "—"}
                      </td>

                      <td className="py-3 px-3 text-slate-600 whitespace-nowrap">
                        {new Date(stop.started_at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>

                      <td className="py-3 px-3 text-slate-600 whitespace-nowrap">
                        {stop.ended_at ? (
                          new Date(stop.ended_at).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        ) : (
                          <span className="text-emerald-600 font-semibold">Active</span>
                        )}
                      </td>

                      <td className="py-3 px-3 font-semibold text-slate-900">
                        {formatStopDuration(stop.duration_seconds)}
                      </td>

                      <td className="py-3 px-3 font-mono text-[11px] text-slate-500">
                        {stop.start_lat.toFixed(4)}, {stop.start_lng.toFixed(4)}
                      </td>

                      <td className="py-3 px-3 text-slate-600 max-w-[180px] truncate" title={stop.location}>
                        {stop.location || "Nagercoil District"}
                      </td>

                      <td className="py-3 px-3">
                        {stop.engine_on ? (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
                            Idle (ON)
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">
                            Parked (OFF)
                          </Badge>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <Badge
                          variant="outline"
                          className={
                            stop.status === "ACTIVE"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-300 font-bold animate-pulse"
                              : stop.status === "COMPLETED"
                              ? "bg-slate-100 text-slate-700 border-slate-200"
                              : "bg-red-50 text-red-700 border-red-200"
                          }
                        >
                          {stop.status}
                        </Badge>
                      </td>

                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => setInspectStop(stop)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-indigo-600 font-semibold text-xs shadow-2xs transition-colors cursor-pointer"
                        >
                          <Eye className="h-3 w-3" />
                          <span>Map</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
            <div>
              Showing {filteredStops.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} to{" "}
              {Math.min(currentPage * pageSize, filteredStops.length)} of {filteredStops.length} recorded stops
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 font-semibold cursor-pointer"
              >
                Previous
              </button>
              <span className="font-semibold text-slate-700">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 font-semibold cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* ── SECTION D: STOP ANALYTICS TAB ───────────────────────── */}
      {activeTab === "analytics" && (
        <div className="space-y-5">
          {/* Top Duration Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* 1. Daily Vehicle-Wise Stopped Duration */}
            <Card className="border border-slate-200/80 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Vehicle-Wise Stop Duration</h4>
                  <p className="text-xs text-slate-500">Total stationary hours per vehicle</p>
                </div>
                <Truck className="h-4 w-4 text-indigo-600" />
              </div>

              <div className="h-64 w-full">
                {analyticsData.topVehicles.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                    No data available for current filter
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analyticsData.topVehicles}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                      <XAxis dataKey="vehicle" tick={{ fontSize: 10, fill: "#64748B" }} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#64748B" }} unit="h" axisLine={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#FFFFFF",
                          borderRadius: "12px",
                          border: "1px solid #E2E8F0",
                          fontSize: "12px",
                        }}
                      />
                      <Bar dataKey="stoppedHours" fill="#6366F1" radius={[6, 6, 0, 0]} name="Stopped Hours" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            {/* 2. Weekly Stopped Duration Trend */}
            <Card className="border border-slate-200/80 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Weekly Stopped Trend</h4>
                  <p className="text-xs text-slate-500">Cumulative stationary minutes per day</p>
                </div>
                <Activity className="h-4 w-4 text-emerald-600" />
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={analyticsData.weeklyTrend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#64748B" }} unit="m" axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#FFFFFF",
                        borderRadius: "12px",
                        border: "1px solid #E2E8F0",
                        fontSize: "12px",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="minutes"
                      stroke="#10B981"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: "#10B981" }}
                      name="Stopped Minutes"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* Breakdown Tables & Threshold Brackets */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* 3. Duration Thresholds Audit */}
            <Card className="border border-slate-200/80 p-5 shadow-xs space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5 border-b border-slate-100 pb-2.5">
                <Clock className="h-4 w-4 text-indigo-600" />
                <span>Stop Duration Thresholds</span>
              </div>
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div>
                    <div className="font-semibold text-slate-800">&gt; 15 Minutes</div>
                    <div className="text-[10px] text-slate-400">Loading / Unloading candidate</div>
                  </div>
                  <span className="font-extrabold text-slate-900 text-sm">
                    {analyticsData.exceeding15m} stops
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50/50 border border-amber-200/60">
                  <div>
                    <div className="font-semibold text-amber-900">&gt; 30 Minutes</div>
                    <div className="text-[10px] text-amber-600">Extended turnaround audit</div>
                  </div>
                  <span className="font-extrabold text-amber-700 text-sm">
                    {analyticsData.exceeding30m} stops
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-red-50/50 border border-red-200/60">
                  <div>
                    <div className="font-semibold text-red-900">&gt; 60 Minutes</div>
                    <div className="text-[10px] text-red-600">Long halt / depot resting</div>
                  </div>
                  <span className="font-extrabold text-red-700 text-sm">
                    {analyticsData.exceeding60m} stops
                  </span>
                </div>
              </div>
            </Card>

            {/* 4. Idling vs Parked Analysis */}
            <Card className="border border-slate-200/80 p-5 shadow-xs space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5 border-b border-slate-100 pb-2.5">
                <Zap className="h-4 w-4 text-amber-600" />
                <span>Engine Idling vs Parked</span>
              </div>
              <div className="h-44 w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={analyticsData.enginePie}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={65}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {analyticsData.enginePie.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: any) => [`${val} mins`, "Duration"]}
                      contentStyle={{
                        backgroundColor: "#FFFFFF",
                        borderRadius: "12px",
                        border: "1px solid #E2E8F0",
                        fontSize: "12px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center text-xs">
                <div className="p-2 rounded-xl bg-amber-50 text-amber-800">
                  <div className="font-bold">{analyticsData.totalIdleHours} hrs</div>
                  <div className="text-[10px] text-amber-600">Idle (Engine ON)</div>
                </div>
                <div className="p-2 rounded-xl bg-blue-50 text-blue-800">
                  <div className="font-bold">{analyticsData.totalParkedHours} hrs</div>
                  <div className="text-[10px] text-blue-600">Parked (Engine OFF)</div>
                </div>
              </div>
            </Card>

            {/* 5. Driver-Wise Stop Duration */}
            <Card className="border border-slate-200/80 p-5 shadow-xs space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5 border-b border-slate-100 pb-2.5">
                <UsersRound className="h-4 w-4 text-indigo-600" />
                <span>Driver-Wise Stop Audits</span>
              </div>
              <div className="space-y-2 overflow-y-auto max-h-[220px]">
                {analyticsData.topDrivers.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 text-xs">
                    No driver records found
                  </div>
                ) : (
                  analyticsData.topDrivers.map((d) => (
                    <div
                      key={d.driver}
                      className="flex items-center justify-between p-2 rounded-xl border border-slate-100 text-xs"
                    >
                      <div>
                        <div className="font-semibold text-slate-800">{d.driver}</div>
                        <div className="text-[10px] text-slate-400">{d.count} stops logged</div>
                      </div>
                      <span className="font-bold text-slate-900">{d.stoppedHours} hrs</span>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ── MAP INSPECTION MODAL ─────────────────────────────────── */}
      <StopMapModal stop={inspectStop} onClose={() => setInspectStop(null)} />
    </div>
  );
}

