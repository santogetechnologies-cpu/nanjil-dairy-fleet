import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Badge, Button, Card } from "@/components/ui-kit";
import {
  History,
  Play,
  Pause,
  RotateCcw,
  FastForward,
  Rewind,
  Calendar,
  Filter,
  Download,
  Printer,
  MapPin,
  Clock,
  Gauge,
  Activity,
  AlertTriangle,
  ChevronRight,
  Truck,
  User,
  Radio,
  FileSpreadsheet,
  CheckCircle2,
  Navigation,
  Loader2,
  Eye,
  SkipBack,
  SkipForward,
  Sliders,
  ShieldCheck,
  Map as MapIcon,
} from "lucide-react";
import MapGL, { Marker, Source, Layer, NavigationControl, MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useVehicles } from "@/hooks/useVehicleTracking";
import { isGpsVehicle, KNOWN_NANJIL_DEVICE_MAP } from "@/lib/vehicle-stop-detection";
import { toast } from "sonner";
import {
  GpsPoint,
  RouteSegment,
  JourneyMetrics,
  DerivedJourney,
  TimelineEvent,
  getIstDateRange,
  formatIstDateTime,
  formatIstTime,
  isValidUuid,
  fetchPaginatedTelemetryHistory,
  splitPointsIntoSegments,
  buildSegmentedGeoJson,
  calculateJourneyMetrics,
  resolveDriverForJourney,
  deriveJourneysFromTelemetry,
  generateJourneyTimelineEvents,
} from "@/lib/tripHistoryEngine";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

export default function TripHistoryPage() {
  const { user } = useAuth();
  const mapRef = useRef<MapRef>(null);
  const liveVehicles = useVehicles();

  // Filters
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("All");
  const [dateFilterMode, setDateFilterMode] = useState<"today" | "yesterday" | "last7" | "last30" | "custom">("today");
  const [customStartDate, setCustomStartDate] = useState(
    new Date(Date.now() - 24 * 3600 * 1000).toISOString().split("T")[0]
  );
  const [customEndDate, setCustomEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [journeyStatusFilter, setJourneyStatusFilter] = useState<"All" | "Completed" | "Ongoing" | "Stationary">("All");
  const [minDistanceKm, setMinDistanceKm] = useState(0);

  // Master Data
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicleAssignments, setVehicleAssignments] = useState<any[]>([]);
  const [tripsTableRecords, setTripsTableRecords] = useState<any[]>([]);

  // Telemetry Fetch State
  const [allRangeGpsPoints, setAllRangeGpsPoints] = useState<GpsPoint[]>([]);
  const [isLoadingGps, setIsLoadingGps] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<{ loaded: number; total?: number } | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queryEarliest, setQueryEarliest] = useState<string | null>(null);
  const [queryLatest, setQueryLatest] = useState<string | null>(null);

  // Derived Journeys State
  const [derivedJourneys, setDerivedJourneys] = useState<DerivedJourney[]>([]);
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | "all">("all");

  // Playback Controls State
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2 | 5 | 10>(1);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const playbackTimerRef = useRef<any>(null);

  // Active abort controller for cancelling stale async queries
  const fetchAbortRef = useRef<AbortController | null>(null);

  // 1. Load Vehicles, Drivers, Vehicle Assignments & Trips from Supabase
  useEffect(() => {
    async function init() {
      const [vRes, dRes, tRes, aRes] = await Promise.all([
        supabase.from("vehicles").select("id, number, type, model, device_id"),
        supabase.from("drivers").select("id, name, phone"),
        supabase.from("trips").select("*, vehicles(number), drivers(name)").order("date", { ascending: false }),
        supabase.from("vehicle_assignments").select("id, vehicle_id, driver_id, assigned_at, unassigned_at, is_active, drivers(id, name, phone)"),
      ]);

      // Strictly construct the 7 authentic physical GPS vehicles in Nanjil Dairy Fleet
      const uniqueGpsMap = new Map<string, any>();
      Object.entries(KNOWN_NANJIL_DEVICE_MAP).forEach(([devId, meta]) => {
        const key = meta.number.replace(/\s+/g, "").toUpperCase();
        uniqueGpsMap.set(key, {
          id: meta.id,
          number: meta.number,
          model: meta.model,
          type: "Tanker",
          device_id: devId,
        });
      });

      // Overlay with Supabase metadata matching the EXACT authentic UUID or matching hardware device_id
      if (vRes.data && vRes.data.length > 0) {
        vRes.data.forEach((v: any) => {
          const vDevId = v.device_id ? String(v.device_id).trim() : "";
          for (const [key, existing] of uniqueGpsMap.entries()) {
            if (v.id === existing.id || (vDevId && vDevId === existing.device_id)) {
              uniqueGpsMap.set(key, {
                ...existing,
                model: v.model || existing.model,
                type: v.type || existing.type,
                // Guarantee authoritative UUID is preserved
                id: existing.id,
                device_id: existing.device_id,
              });
            }
          }
        });
      }

      // Overlay live vehicle locations
      liveVehicles.forEach((lv) => {
        if (lv.id && lv.number && isGpsVehicle(lv)) {
          const key = lv.number.replace(/\s+/g, "").toUpperCase();
          if (uniqueGpsMap.has(key)) {
            const existing = uniqueGpsMap.get(key);
            uniqueGpsMap.set(key, {
              ...existing,
              lat: lv.lat,
              lng: lv.lng,
              speed: lv.speed,
              status: lv.status,
              last_update: lv.last_update,
            });
          }
        }
      });

      const listToUse = Array.from(uniqueGpsMap.values()).sort((a, b) =>
        (a.number || "").localeCompare(b.number || "")
      );

      setVehicles(listToUse);
      if (listToUse.length > 0) {
        setSelectedVehicleId((prev) => {
          const stillValid = listToUse.some((x) => x.id === prev);
          return stillValid ? prev : listToUse[0].id;
        });
      }

      if (dRes.data) {
        const uniqueD = new Map();
        dRes.data.forEach((d) => {
          if (!uniqueD.has(d.name)) uniqueD.set(d.name, d);
        });
        setDrivers(Array.from(uniqueD.values()));
      }

      if (tRes.data) {
        setTripsTableRecords(tRes.data);
      }

      if (aRes.data) {
        setVehicleAssignments(aRes.data);
      }
    }
    init();
  }, []);

  // 2. Compute Target Date Range in Asia/Kolkata (IST = UTC+05:30)
  const dateRange = useMemo(() => {
    return getIstDateRange(dateFilterMode, customStartDate, customEndDate);
  }, [dateFilterMode, customStartDate, customEndDate]);

  // Selected vehicle object
  const selectedVehicle = useMemo(() => {
    return vehicles.find((v) => v.id === selectedVehicleId);
  }, [vehicles, selectedVehicleId]);

  // 3. Paginated Historical GPS Telemetry Fetching (With strict UUID & Cancellation)
  useEffect(() => {
    if (!selectedVehicleId) return;

    // Validate that selectedVehicleId is a valid UUID
    if (!isValidUuid(selectedVehicleId)) {
      setQueryError(`Invalid vehicle ID: ${selectedVehicleId}`);
      setAllRangeGpsPoints([]);
      setDerivedJourneys([]);
      return;
    }

    // Abort any ongoing query
    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort();
    }
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    setIsLoadingGps(true);
    setQueryError(null);
    setIsPlaying(false);
    setCurrentIndex(0);
    setLoadingProgress(null);

    async function fetchHistory() {
      try {
        const res = await fetchPaginatedTelemetryHistory(
          supabase,
          selectedVehicleId, // Authoritative UUID only
          dateRange.startUtcIso,
          dateRange.endUtcIso,
          1000,
          (loaded, total) => {
            setLoadingProgress({ loaded, total });
          },
          controller.signal
        );

        if (controller.signal.aborted) return;

        if (res.error) {
          setQueryError(res.error);
          setAllRangeGpsPoints([]);
          setDerivedJourneys([]);
        } else {
          setAllRangeGpsPoints(res.data);
          setQueryEarliest(res.earliestTimestamp || null);
          setQueryLatest(res.latestTimestamp || null);

          // Derive distinct journeys or correlate with trips table
          if (selectedVehicle) {
            const derived = deriveJourneysFromTelemetry(
              res.data,
              selectedVehicle,
              tripsTableRecords,
              vehicleAssignments,
              drivers
            );
            setDerivedJourneys(derived);
            setSelectedJourneyId("all");
          }
        }
      } catch (err: any) {
        if (!controller.signal.aborted) {
          console.warn("Telemetry fetch error:", err);
          setQueryError(err?.message || "Failed to load telemetry history");
          setAllRangeGpsPoints([]);
          setDerivedJourneys([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingGps(false);
          setLoadingProgress(null);
        }
      }
    }

    fetchHistory();

    return () => {
      controller.abort();
    };
  }, [selectedVehicleId, dateRange.startUtcIso, dateRange.endUtcIso, selectedVehicle, reloadTrigger]);

  // 4. Determine Active Points for Display & Playback (Selected Journey vs All Points)
  const activeGpsPoints = useMemo(() => {
    if (selectedJourneyId === "all") {
      return allRangeGpsPoints;
    }
    const found = derivedJourneys.find((j) => j.id === selectedJourneyId);
    return found ? found.points : allRangeGpsPoints;
  }, [selectedJourneyId, derivedJourneys, allRangeGpsPoints]);

  // 5. Segment Route to prevent drawing straight lines across signal gaps
  const { segments: activeSegments, gapIndices } = useMemo(() => {
    return splitPointsIntoSegments(activeGpsPoints, 15);
  }, [activeGpsPoints]);

  // 6. Build MultiLineString GeoJSON for MapLibre
  const segmentedGeoJson = useMemo(() => {
    return buildSegmentedGeoJson(activeSegments);
  }, [activeSegments]);

  // 7. Calculate Mathematical Metrics & Events for Active Route
  const tripStats = useMemo(() => {
    return calculateJourneyMetrics(activeGpsPoints, 15, 60);
  }, [activeGpsPoints]);

  const timelineEvents = useMemo(() => {
    const activeJourney = derivedJourneys.find((j) => j.id === selectedJourneyId);
    return generateJourneyTimelineEvents(activeGpsPoints, activeJourney, 60);
  }, [activeGpsPoints, selectedJourneyId, derivedJourneys]);

  // 8. Filtered Journeys List (Respecting Driver, Status, and Min Distance Filters)
  const filteredJourneys = useMemo(() => {
    return derivedJourneys.filter((j) => {
      // Driver filter
      if (selectedDriverId !== "All") {
        if (j.driver_id !== selectedDriverId && j.driver_name !== selectedDriverId) {
          return false;
        }
      }
      // Status filter
      if (journeyStatusFilter !== "All") {
        if (j.status !== journeyStatusFilter) return false;
      }
      // Distance filter
      if (minDistanceKm > 0 && j.metrics.totalDistanceKm < minDistanceKm) {
        return false;
      }
      return true;
    });
  }, [derivedJourneys, selectedDriverId, journeyStatusFilter, minDistanceKm]);

  // 9. Selected Vehicle Authentic Position (No Fake Fallback Location!)
  const vehicleCurrentPosition = useMemo(() => {
    // Check if liveVehicles has authentic non-zero coordinates
    const live = liveVehicles.find(
      (v) => v.id === selectedVehicleId || (selectedVehicle && v.number === selectedVehicle.number)
    );
    if (live && live.lat && live.lng && Number(live.lat) !== 0 && Number(live.lng) !== 0) {
      return {
        lat: Number(live.lat),
        lng: Number(live.lng),
        speed: Math.max(0, Math.round(Number(live.speed) || 0)),
        status: live.status || "Stationary",
        isLive: true,
      };
    }
    // If no live coordinates, check latest point in historical records
    if (allRangeGpsPoints.length > 0) {
      const last = allRangeGpsPoints[allRangeGpsPoints.length - 1];
      return {
        lat: last.lat,
        lng: last.lng,
        speed: last.speed,
        status: "Historical",
        isLive: false,
      };
    }
    // No GPS data available at all (NEVER fabricate depot coordinates!)
    return null;
  }, [liveVehicles, selectedVehicleId, selectedVehicle, allRangeGpsPoints]);

  // 10. Active Point for Playback
  const currentPoint = activeGpsPoints[currentIndex] || activeGpsPoints[0] || null;

  // 11. Playback Animation Loop (accounting for actual timestamps & selected speed)
  useEffect(() => {
    if (!isPlaying || activeGpsPoints.length === 0) {
      if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
      return;
    }

    const intervalMs = Math.round(1000 / playbackSpeed);

    playbackTimerRef.current = setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= activeGpsPoints.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);

    return () => {
      if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
    };
  }, [isPlaying, playbackSpeed, activeGpsPoints.length]);

  // 12. Center map on playback position or auto-fit route bounds on load
  const fitMapToBounds = useCallback(() => {
    if (!mapRef.current) return;
    if (activeGpsPoints.length < 2) {
      const targetLng = activeGpsPoints[0]?.lng ?? 77.288373;
      const targetLat = activeGpsPoints[0]?.lat ?? 8.260765;
      mapRef.current.flyTo({ center: [targetLng, targetLat], zoom: 12, duration: 600 });
      return;
    }
    let minLng = activeGpsPoints[0].lng;
    let maxLng = activeGpsPoints[0].lng;
    let minLat = activeGpsPoints[0].lat;
    let maxLat = activeGpsPoints[0].lat;

    for (const p of activeGpsPoints) {
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    }

    mapRef.current.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 60, duration: 800 }
    );
  }, [activeGpsPoints]);

  useEffect(() => {
    if (activeGpsPoints.length >= 2) {
      fitMapToBounds();
    }
  }, [activeGpsPoints.length, selectedJourneyId]);

  // Center map smoothly on active playback marker
  useEffect(() => {
    if (mapRef.current && isPlaying && currentPoint) {
      mapRef.current.easeTo({
        center: [currentPoint.lng, currentPoint.lat],
        duration: 350,
      });
    }
  }, [currentIndex, isPlaying, currentPoint]);

  // Jump to specific point index
  function jumpToPointIndex(index: number) {
    if (index >= 0 && index < activeGpsPoints.length) {
      setCurrentIndex(index);
    }
  }

  // Select Journey Handler
  function handleSelectJourney(journeyId: string | "all") {
    setSelectedJourneyId(journeyId);
    setIsPlaying(false);
    setCurrentIndex(0);
  }

  // CSV Export Functionality (Respecting active filters & genuine points)
  function exportTripCsv() {
    if (!activeGpsPoints.length) return;
    const rows = [
      [
        "Index",
        "Timestamp_IST",
        "Timestamp_UTC",
        "Vehicle_Number",
        "Latitude",
        "Longitude",
        "Speed_Kmh",
        "Ignition",
        "Odometer_Km",
        "Engine_Hours",
        "Signal_Gap",
        "Source",
      ],
      ...activeGpsPoints.map((p, idx) => [
        idx + 1,
        formatIstDateTime(p.recorded_at),
        p.recorded_at,
        selectedVehicle?.number || "Vehicle",
        p.lat.toFixed(6),
        p.lng.toFixed(6),
        p.speed,
        p.ignition ? "ON" : "OFF",
        p.odometer != null ? p.odometer : "",
        p.engine_hours != null ? p.engine_hours : "",
        p.isGap ? `YES (${p.gapMinutes || 15}m)` : "NO",
        p.source || "telemetry",
      ]),
    ];

    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `Trip_History_${selectedVehicle?.number || "Vehicle"}_${dateRange.startIstDate}_to_${dateRange.endIstDate}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Reset playback to start, pause, reset speed to 1x and center map on start
  const handleResetPlayback = useCallback(() => {
    if (playbackTimerRef.current) {
      clearInterval(playbackTimerRef.current);
    }
    setIsPlaying(false);
    setCurrentIndex(0);
    setPlaybackSpeed(1);

    if (activeGpsPoints.length > 0 && mapRef.current) {
      const p = activeGpsPoints[0];
      mapRef.current.easeTo({
        center: [p.lng, p.lat],
        duration: 400,
      });
    } else {
      fitMapToBounds();
    }

    try {
      toast.info("Playback restarted from 00:00");
    } catch {}
  }, [activeGpsPoints, fitMapToBounds]);

  // Complete Reset: resets all filters, dates, journeys, playback, map camera and re-fetches
  const handleResetTripHistory = useCallback(() => {
    if (playbackTimerRef.current) {
      clearInterval(playbackTimerRef.current);
    }
    setIsPlaying(false);
    setCurrentIndex(0);
    setPlaybackSpeed(1);
    setDateFilterMode("today");
    setCustomStartDate(new Date(Date.now() - 24 * 3600 * 1000).toISOString().split("T")[0]);
    setCustomEndDate(new Date().toISOString().split("T")[0]);
    setSelectedDriverId("All");
    setJourneyStatusFilter("All");
    setSelectedJourneyId("all");
    setMinDistanceKm(0);

    if (vehicles.length > 0) {
      setSelectedVehicleId(vehicles[0].id);
    }

    // Force immediate telemetry re-fetch from Supabase backend
    setReloadTrigger((prev) => prev + 1);

    // Re-center map to fit route or depot
    setTimeout(() => {
      fitMapToBounds();
    }, 150);

    try {
      toast.success("Trip History & Playback reset to default (Today)");
    } catch {}
  }, [vehicles, fitMapToBounds]);

  // Print PDF Trip Report
  function printTripReport() {
    window.print();
  }

  return (
    <div className="space-y-5">
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <PageHeader
        title="Trip History & GPS Playback"
        subtitle={`Historical Journey Investigation · Segmented GPS Routes · Authentic Backend Telemetry`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={handleResetTripHistory}
              variant="outline"
              className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-xs"
              title="Reset all filters, dates, and playback to default"
            >
              <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
              Reset
            </Button>
            <Button
              onClick={exportTripCsv}
              disabled={activeGpsPoints.length === 0}
              className={`border border-slate-200 text-xs font-semibold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-xs ${
                activeGpsPoints.length === 0
                  ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                  : "bg-white hover:bg-slate-50 text-slate-700"
              }`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-slate-500" />
              Export CSV
            </Button>
            <Button
              onClick={printTripReport}
              className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-xs"
            >
              <Printer className="h-3.5 w-3.5 text-slate-500" />
              Print / PDF
            </Button>
          </div>
        }
      />

      {/* ── QUERY ERROR BANNER (If database query fails) ─────────── */}
      {queryError && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-3.5 text-xs text-red-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
            <span>
              <strong>Database Query Error:</strong> {queryError}
            </span>
          </div>
          <Badge variant="outline" className="bg-white border-red-300 text-red-700 text-[10px]">
            Check RLS Permissions
          </Badge>
        </div>
      )}

      {/* ── FILTER TOOLBAR ──────────────────────────────────────── */}
      <Card className="border border-slate-200/80 p-3.5 shadow-xs bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Quick Date Filters (Timezone: Asia/Kolkata) */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            {(["today", "yesterday", "last7", "last30", "custom"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setDateFilterMode(mode)}
                className={`px-3 py-1.5 rounded-lg transition-all capitalize ${
                  dateFilterMode === mode
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {mode === "last7" ? "Last 7 Days" : mode === "last30" ? "Last 30 Days" : mode}
              </button>
            ))}
          </div>

          {/* Vehicle, Driver & Status Selectors */}
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            {dateFilterMode === "custom" && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="px-2 py-1 rounded-lg border border-slate-200 text-xs"
                />
                <span className="text-slate-400">to</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="px-2 py-1 rounded-lg border border-slate-200 text-xs"
                />
              </div>
            )}

            {/* Vehicle Selector (Authoritative UUID only) */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-medium flex items-center gap-1">
                <Radio className="h-3.5 w-3.5 text-emerald-600 animate-pulse" />
                Vehicle:
              </span>
              <select
                value={selectedVehicleId}
                onChange={(e) => setSelectedVehicleId(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-800 outline-none"
              >
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.number} {v.model ? `(${v.model})` : `(${v.type || "GPS Asset"})`}
                  </option>
                ))}
              </select>
            </div>

            {/* Driver Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-medium">Driver:</span>
              <select
                value={selectedDriverId}
                onChange={(e) => setSelectedDriverId(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 outline-none"
              >
                <option value="All">All Drivers</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-medium">Status:</span>
              <select
                value={journeyStatusFilter}
                onChange={(e: any) => setJourneyStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 outline-none text-xs"
              >
                <option value="All">All Statuses</option>
                <option value="Completed">Completed</option>
                <option value="Ongoing">Ongoing</option>
                <option value="Stationary">Stationary</option>
              </select>
            </div>

            {/* Reset Filters Button */}
            <button
              onClick={handleResetTripHistory}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold text-xs flex items-center gap-1.5 transition-colors shadow-xs"
              title="Reset all filters, dates, and playback to default"
            >
              <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* Date & Range Diagnostics Bar */}
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between text-[11px] text-slate-500 gap-2">
          <div className="flex items-center gap-3">
            <span>
              <strong>Calendar Range (IST):</strong> {dateRange.displayLabel}
            </span>
            {queryEarliest && queryLatest && (
              <span className="text-slate-400">
                · GPS Records: {formatIstTime(queryEarliest)} to {formatIstTime(queryLatest)} ({allRangeGpsPoints.length} points)
              </span>
            )}
            {loadingProgress && (
              <span className="flex items-center gap-1 text-indigo-600 font-medium">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading {loadingProgress.loaded} {loadingProgress.total ? `of ${loadingProgress.total}` : "records"}...
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Timezone: Asia/Kolkata (IST, UTC+05:30)</span>
            <Badge variant="outline" className="text-[10px] bg-slate-50">
              {derivedJourneys.length} Journeys Detected
            </Badge>
          </div>
        </div>
      </Card>

      {/* ── SUMMARY STATS BAR (Real Mathematical Metrics) ───────── */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {/* Total Distance (GPS vs Odometer) */}
        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">GPS Distance</div>
          <div className="text-lg font-bold text-slate-900 mt-1">
            {tripStats.totalDistanceKm} <span className="text-xs font-normal text-slate-500">km</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Odometer: {tripStats.odometerDistanceKm != null ? `${tripStats.odometerDistanceKm} km` : "N/A"}
          </div>
        </div>

        {/* Total Duration */}
        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Total Duration</div>
          <div className="text-lg font-bold text-slate-900 mt-1">
            {Math.floor(tripStats.totalDurationSeconds / 3600)}h {Math.floor((tripStats.totalDurationSeconds % 3600) / 60)}m
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Driving: {Math.floor(tripStats.drivingDurationSeconds / 60)}m · Stopped: {Math.floor(tripStats.stoppedDurationSeconds / 60)}m
          </div>
        </div>

        {/* Average Speed */}
        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Average Speed</div>
          <div className="text-lg font-bold text-slate-900 mt-1 flex items-baseline gap-1">
            {tripStats.avgSpeedKmh} <span className="text-xs font-normal text-slate-500">km/h</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Distance / driving time</div>
        </div>

        {/* Max Speed */}
        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Max Speed</div>
          <div className="text-lg font-bold text-slate-900 mt-1 flex items-baseline gap-1">
            {tripStats.maxSpeedKmh} <span className="text-xs font-normal text-slate-500">km/h</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {tripStats.maxSpeedKmh > 60 ? "Over 60 km/h limit" : "Within speed policy"}
          </div>
        </div>

        {/* Speeding Incidents */}
        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Speeding Alerts</div>
          <div
            className={`text-lg font-bold mt-1 ${
              tripStats.speedingIncidentsCount > 0 ? "text-amber-600" : "text-slate-900"
            }`}
          >
            {tripStats.speedingIncidentsCount} <span className="text-xs font-normal text-slate-500">incidents</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">&gt; 60 km/h threshold</div>
        </div>

        {/* Stops & Signal Gaps */}
        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Stops & Gaps</div>
          <div className="text-lg font-bold text-slate-900 mt-1 flex items-baseline gap-1">
            {tripStats.stopsCount} <span className="text-xs font-normal text-slate-500">stops</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Gaps: {tripStats.gapsCount} ({Math.round(tripStats.totalGapDurationSeconds / 60)}m offline)
          </div>
        </div>
      </div>

      {/* ── MAIN PLAYBACK & JOURNEY WORKSPACE ───────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* MAP & PLAYBACK CONTROLLER (8 COLS) */}
        <div className="lg:col-span-8 flex flex-col gap-3">
          <Card className="border border-slate-200/80 overflow-hidden shadow-xs flex-1 flex flex-col">
            {/* Map Canvas */}
            <div className="relative h-[500px] w-full bg-slate-100">
              <MapGL
                ref={mapRef}
                initialViewState={{
                  longitude: Number(currentPoint?.lng ?? vehicleCurrentPosition?.lng ?? 77.2884),
                  latitude: Number(currentPoint?.lat ?? vehicleCurrentPosition?.lat ?? 8.2605),
                  zoom: 12,
                }}
                onError={(e) => {
                  // Suppress harmless tile-level style expression assertions from OpenFreeMap vector tiles
                  if (e?.error?.message?.includes("Expected value to be of type")) return;
                }}
                mapStyle={MAP_STYLE}
                style={{ width: "100%", height: "100%" }}
              >
                <NavigationControl position="top-right" />

                {/* Segmented Historical GPS Trail (MultiLineString - Breaks at Gaps!) */}
                {segmentedGeoJson && (
                  <Source id="historical-trail" type="geojson" data={segmentedGeoJson}>
                    <Layer
                      id="trail-casing"
                      type="line"
                      paint={{
                        "line-color": "#1E293B",
                        "line-width": 5.5,
                        "line-opacity": 0.35,
                      }}
                    />
                    <Layer
                      id="trail-line"
                      type="line"
                      paint={{
                        "line-color": "#2563EB",
                        "line-width": 3.8,
                        "line-opacity": 0.95,
                      }}
                    />
                  </Source>
                )}

                {/* Start Marker A (Emerald) */}
                {activeGpsPoints.length > 0 && typeof activeGpsPoints[0]?.lng === "number" && typeof activeGpsPoints[0]?.lat === "number" && !isNaN(activeGpsPoints[0].lng) && !isNaN(activeGpsPoints[0].lat) && (
                  <Marker longitude={activeGpsPoints[0].lng} latitude={activeGpsPoints[0].lat} anchor="center">
                    <div
                      className="h-6 w-6 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-[10px] shadow-lg border-2 border-white cursor-pointer"
                      title={`Journey Departure: ${formatIstTime(activeGpsPoints[0].recorded_at)}`}
                    >
                      A
                    </div>
                  </Marker>
                )}

                {/* End Marker B (Slate) */}
                {activeGpsPoints.length > 1 && typeof activeGpsPoints[activeGpsPoints.length - 1]?.lng === "number" && typeof activeGpsPoints[activeGpsPoints.length - 1]?.lat === "number" && !isNaN(activeGpsPoints[activeGpsPoints.length - 1].lng) && !isNaN(activeGpsPoints[activeGpsPoints.length - 1].lat) && (
                  <Marker
                    longitude={activeGpsPoints[activeGpsPoints.length - 1].lng}
                    latitude={activeGpsPoints[activeGpsPoints.length - 1].lat}
                    anchor="center"
                  >
                    <div
                      className="h-6 w-6 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-[10px] shadow-lg border-2 border-white cursor-pointer"
                      title={`Journey End: ${formatIstTime(activeGpsPoints[activeGpsPoints.length - 1].recorded_at)}`}
                    >
                      B
                    </div>
                  </Marker>
                )}

                {/* Stop Markers (P, Amber) */}
                {timelineEvents
                  .filter((e) => e.type === "stop" && typeof e.lng === "number" && typeof e.lat === "number" && !isNaN(e.lng) && !isNaN(e.lat))
                  .map((e) => (
                    <Marker key={e.id} longitude={e.lng} latitude={e.lat} anchor="center">
                      <div
                        onClick={() => jumpToPointIndex(e.pointIndex)}
                        className="h-5 w-5 rounded-full bg-amber-500 text-white flex items-center justify-center text-[9px] font-bold shadow-md border border-white cursor-pointer hover:scale-125 transition-transform"
                        title={e.title}
                      >
                        P
                      </div>
                    </Marker>
                  ))}

                {/* Signal Gap Markers (!, Red) */}
                {timelineEvents
                  .filter((e) => e.type === "gap" && typeof e.lng === "number" && typeof e.lat === "number" && !isNaN(e.lng) && !isNaN(e.lat))
                  .map((e) => (
                    <Marker key={e.id} longitude={e.lng} latitude={e.lat} anchor="center">
                      <div
                        onClick={() => jumpToPointIndex(e.pointIndex)}
                        className="h-5 w-5 rounded-full bg-red-600 text-white flex items-center justify-center text-[9px] font-bold shadow-md border border-white cursor-pointer hover:scale-125 transition-transform"
                        title={e.title}
                      >
                        !
                      </div>
                    </Marker>
                  ))}

                {/* Vehicle Current Position Marker (when no playback or stationary) */}
                {activeGpsPoints.length === 0 && vehicleCurrentPosition && typeof vehicleCurrentPosition.lng === "number" && typeof vehicleCurrentPosition.lat === "number" && !isNaN(vehicleCurrentPosition.lng) && !isNaN(vehicleCurrentPosition.lat) && (
                  <Marker
                    longitude={vehicleCurrentPosition.lng}
                    latitude={vehicleCurrentPosition.lat}
                    anchor="center"
                  >
                    <div className="relative flex items-center justify-center group cursor-pointer">
                      <div className="h-9 w-9 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-2xl border-2 border-white ring-4 ring-indigo-200">
                        <Truck className="h-4 w-4" />
                      </div>
                      <div className="absolute -top-7 bg-slate-900 text-white text-[10px] font-semibold px-2 py-0.5 rounded shadow whitespace-nowrap pointer-events-none">
                        {selectedVehicle?.number || "Vehicle"} ({vehicleCurrentPosition.status})
                      </div>
                    </div>
                  </Marker>
                )}

                {/* ACTIVE PLAYBACK VEHICLE MARKER */}
                {currentPoint && typeof currentPoint.lng === "number" && typeof currentPoint.lat === "number" && !isNaN(currentPoint.lng) && !isNaN(currentPoint.lat) && (
                  <Marker longitude={currentPoint.lng} latitude={currentPoint.lat} anchor="center">
                    <div className="relative flex items-center justify-center">
                      <div className="h-9 w-9 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-2xl border-2 border-white ring-4 ring-indigo-300 animate-pulse">
                        <Navigation className="h-5 w-5" />
                      </div>
                    </div>
                  </Marker>
                )}
              </MapGL>

              {/* HUD OVERLAY (Top-Left on Map) */}
              <div className="absolute top-3 left-3 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl p-3 shadow-lg text-xs space-y-1.5 min-w-[220px] z-10">
                <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                  <span className="font-bold text-slate-800">
                    {selectedVehicle?.number || "Vehicle"}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[9px] font-bold ${
                      currentPoint && currentPoint.speed > 0
                        ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {currentPoint
                      ? currentPoint.speed > 0
                        ? "Moving"
                        : "Stationary"
                      : vehicleCurrentPosition
                      ? vehicleCurrentPosition.status
                      : "No GPS Available"}
                  </Badge>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-slate-500 font-medium">Recorded Speed:</span>
                  <span className="text-base font-bold text-slate-900">
                    {currentPoint ? currentPoint.speed : 0} km/h
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Timestamp (IST):</span>
                  <span className="font-semibold text-slate-700">
                    {currentPoint
                      ? formatIstTime(currentPoint.recorded_at)
                      : "No Active Coordinates"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>Coordinates:</span>
                  <span>
                    {currentPoint
                      ? `${currentPoint.lat.toFixed(4)}, ${currentPoint.lng.toFixed(4)}`
                      : vehicleCurrentPosition
                      ? `${vehicleCurrentPosition.lat.toFixed(4)}, ${vehicleCurrentPosition.lng.toFixed(4)}`
                      : "Unavailable"}
                  </span>
                </div>
              </div>

              {/* MAP ACTION CONTROLS (Top-Right under Navigation) */}
              {activeGpsPoints.length >= 2 && (
                <div className="absolute top-3 right-12 z-10">
                  <button
                    onClick={fitMapToBounds}
                    className="p-1.5 rounded-lg bg-white/90 backdrop-blur-sm border border-slate-200 text-slate-700 hover:bg-white shadow-xs text-xs flex items-center gap-1 font-medium"
                    title="Fit route to map bounds"
                  >
                    <MapIcon className="h-3.5 w-3.5" />
                    <span>Fit Bounds</span>
                  </button>
                </div>
              )}

              {/* EMPTY STATE BANNER (When no records in date range) */}
              {activeGpsPoints.length === 0 && !isLoadingGps && !queryError && (
                <div className="absolute bottom-3 left-3 right-3 bg-amber-50/95 backdrop-blur-sm border border-amber-200 rounded-xl p-2.5 shadow-md flex items-center justify-between z-10 text-xs">
                  <div className="flex items-center gap-2 text-amber-800">
                    <Activity className="h-4 w-4 text-amber-600 shrink-0" />
                    <span>
                      <strong>No GPS Telemetry Recorded on Selected Date</strong> ({dateRange.displayLabel}).
                      Showing authentic backend data only.
                    </span>
                  </div>
                  <Badge variant="outline" className="text-[10px] bg-white border-amber-300 text-amber-700">
                    Authentic 0s Preserved
                  </Badge>
                </div>
              )}
            </div>

            {/* ── PLAYBACK CONTROLS PANEL ───────────────────────── */}
            <div className="p-4 bg-white border-t border-slate-200/80 space-y-3">
              {/* Timeline Scrubbing Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>
                    {activeGpsPoints[0]
                      ? formatIstTime(activeGpsPoints[0].recorded_at)
                      : "00:00"}
                  </span>
                  <span className="font-bold text-indigo-700">
                    {currentPoint
                      ? `${formatIstTime(currentPoint.recorded_at)} (Point ${currentIndex + 1} of ${
                          activeGpsPoints.length
                        })`
                      : "00:00 (No Telemetry to Replay)"}
                  </span>
                  <span>
                    {activeGpsPoints.length > 1
                      ? formatIstTime(activeGpsPoints[activeGpsPoints.length - 1].recorded_at)
                      : "00:00"}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, activeGpsPoints.length - 1)}
                  value={currentIndex}
                  disabled={activeGpsPoints.length === 0}
                  onChange={(e) => setCurrentIndex(parseInt(e.target.value, 10))}
                  className={`w-full h-2 rounded-lg appearance-none cursor-pointer accent-indigo-600 ${
                    activeGpsPoints.length === 0 ? "bg-slate-100 cursor-not-allowed" : "bg-slate-200"
                  }`}
                />
              </div>

              {/* Action Buttons & Speed Multipliers */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleResetPlayback}
                    disabled={activeGpsPoints.length === 0}
                    className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    title="Reset Playback (Restart from Beginning)"
                  >
                    <RotateCcw className="h-4 w-4 text-slate-500" />
                  </button>

                  <button
                    onClick={() => setCurrentIndex(0)}
                    disabled={activeGpsPoints.length === 0}
                    className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Jump to Start"
                  >
                    <SkipBack className="h-4 w-4" />
                  </button>

                  <button
                    onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 5))}
                    disabled={activeGpsPoints.length === 0}
                    className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Step Backward"
                  >
                    <Rewind className="h-4 w-4" />
                  </button>

                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    disabled={activeGpsPoints.length === 0}
                    className={`px-4 py-2 rounded-xl font-semibold text-xs flex items-center gap-1.5 shadow-xs transition-colors ${
                      activeGpsPoints.length === 0
                        ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                        : "bg-indigo-600 hover:bg-indigo-700 text-white"
                    }`}
                  >
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    <span>
                      {activeGpsPoints.length === 0
                        ? "No Recorded Telemetry"
                        : isPlaying
                        ? "Pause"
                        : "Play Journey"}
                    </span>
                  </button>

                  <button
                    onClick={() => setCurrentIndex((prev) => Math.min(activeGpsPoints.length - 1, prev + 5))}
                    disabled={activeGpsPoints.length === 0}
                    className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Step Forward"
                  >
                    <FastForward className="h-4 w-4" />
                  </button>

                  <button
                    onClick={() => setCurrentIndex(activeGpsPoints.length - 1)}
                    disabled={activeGpsPoints.length === 0}
                    className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Jump to End"
                  >
                    <SkipForward className="h-4 w-4" />
                  </button>
                </div>

                {/* Active Selection / Mode Pill */}
                <div className="flex items-center gap-2">
                  {selectedJourneyId !== "all" && (
                    <button
                      onClick={() => handleSelectJourney("all")}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
                    >
                      Reset to All Journeys
                    </button>
                  )}
                  {/* Speed Multipliers */}
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold text-slate-700">
                    <span className="text-[10px] text-slate-400 px-1 uppercase">Speed:</span>
                    {([1, 2, 5, 10] as const).map((spd) => (
                      <button
                        key={spd}
                        onClick={() => setPlaybackSpeed(spd)}
                        className={`px-2 py-0.5 rounded-lg transition-colors ${
                          playbackSpeed === spd
                            ? "bg-white text-indigo-700 shadow-xs"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        {spd}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* ── SIDEBAR: JOURNEYS & SYNCHRONIZED TIMELINE (4 COLS) ───── */}
        <div className="lg:col-span-4 space-y-4">
          {/* JOURNEY LIST CARD */}
          <Card className="border border-slate-200/80 p-4 flex flex-col max-h-[310px] shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
              <div className="flex items-center gap-1.5">
                <Truck className="h-4 w-4 text-indigo-600" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Journeys History ({filteredJourneys.length})
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {selectedJourneyId !== "all" && (
                  <button
                    type="button"
                    onClick={() => handleSelectJourney("all")}
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-lg border border-indigo-200 transition-colors cursor-pointer"
                  >
                    Reset to All
                  </button>
                )}
                <Badge variant="outline" className="text-[10px]">
                  {dateRange.displayLabel}
                </Badge>
              </div>
            </div>

            {/* Journeys Scroll List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {filteredJourneys.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-xs">
                  No journeys recorded for this filter selection.
                </div>
              ) : (
                filteredJourneys.map((j) => {
                  const isSelected = selectedJourneyId === j.id;
                  return (
                    <div
                      key={j.id}
                      onClick={() => handleSelectJourney(j.id)}
                      className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                        isSelected
                          ? "border-indigo-500 bg-indigo-50/80 ring-1 ring-indigo-300"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">
                          {formatIstTime(j.start_time)} → {formatIstTime(j.end_time)}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[9px] ${
                            j.status === "Completed"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                              : j.status === "Ongoing"
                              ? "bg-blue-50 text-blue-700 border-blue-300"
                              : "bg-slate-50 text-slate-600"
                          }`}
                        >
                          {j.status}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-3 gap-1 mt-1 text-[11px] text-slate-600">
                        <div>
                          <strong>{j.metrics.totalDistanceKm}</strong> km
                        </div>
                        <div>
                          <strong>{Math.round(j.metrics.drivingDurationSeconds / 60)}</strong>m driving
                        </div>
                        <div>
                          <strong>{j.metrics.stopsCount}</strong> stops
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-1 text-[10px] text-slate-400">
                        <span className="truncate max-w-[140px] flex items-center gap-1">
                          <User className="h-2.5 w-2.5" />
                          {j.driver_name}
                        </span>
                        <span>Avg: {j.metrics.avgSpeedKmh} km/h</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          {/* SYNCHRONIZED TIMELINE CARD */}
          <Card className="border border-slate-200/80 p-4 flex flex-col max-h-[300px] shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
              <div className="flex items-center gap-1.5">
                <History className="h-4 w-4 text-indigo-600" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Timeline Events ({timelineEvents.length})
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {currentIndex > 0 && (
                  <button
                    type="button"
                    onClick={handleResetPlayback}
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-lg border border-indigo-200 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                    Reset
                  </button>
                )}
                <span className="text-[10px] text-slate-400">Click to seek playback</span>
              </div>
            </div>

            {/* Event List */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {timelineEvents.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-xs">
                  No recorded events for this selection.
                </div>
              ) : (
                timelineEvents.map((ev) => {
                  const isActive = Math.abs(currentIndex - ev.pointIndex) < 3;
                  return (
                    <div
                      key={ev.id}
                      onClick={() => jumpToPointIndex(ev.pointIndex)}
                      className={`p-2 rounded-xl border text-xs cursor-pointer transition-all ${
                        isActive
                          ? "border-indigo-400 bg-indigo-50/70 ring-1 ring-indigo-200"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          {ev.type === "start" && (
                            <div className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold shrink-0">
                              <Navigation className="h-2.5 w-2.5" />
                            </div>
                          )}
                          {ev.type === "stop" && (
                            <div className="h-5 w-5 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold shrink-0">
                              <Clock className="h-2.5 w-2.5" />
                            </div>
                          )}
                          {ev.type === "resumed" && (
                            <div className="h-5 w-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold shrink-0">
                              <Play className="h-2.5 w-2.5" />
                            </div>
                          )}
                          {ev.type === "speeding" && (
                            <div className="h-5 w-5 rounded-full bg-red-100 text-red-700 flex items-center justify-center font-bold shrink-0">
                              <AlertTriangle className="h-2.5 w-2.5" />
                            </div>
                          )}
                          {ev.type === "gap" && (
                            <div className="h-5 w-5 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold shrink-0">
                              <Radio className="h-2.5 w-2.5" />
                            </div>
                          )}
                          {ev.type === "end" && (
                            <div className="h-5 w-5 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold shrink-0">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                            </div>
                          )}

                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 truncate text-[11px]">{ev.title}</div>
                            <div className="text-[10px] text-slate-500 truncate">{ev.description}</div>
                          </div>
                        </div>

                        <div className="text-[10px] font-semibold text-slate-400 shrink-0">
                          {formatIstTime(ev.timestamp)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
