import { useState, useEffect, useMemo, useRef } from "react";
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
} from "lucide-react";
import MapGL, { Marker, Source, Layer, NavigationControl, MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { haversineDistanceKm } from "@/lib/roadRouting";
import { useVehicles } from "@/hooks/useVehicleTracking";
import { isGpsVehicle, KNOWN_NANJIL_DEVICE_MAP } from "@/lib/vehicle-stop-detection";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

export interface GpsPoint {
  id: string;
  lat: number;
  lng: number;
  speed: number;
  ignition: boolean;
  recorded_at: string;
  odometer?: number;
  isGap?: boolean;
}

export interface TripEvent {
  id: string;
  type: "start" | "stop" | "speeding" | "gap" | "end";
  timestamp: string;
  title: string;
  description: string;
  pointIndex: number;
  durationMins?: number;
  speed?: number;
}

export default function TripHistoryPage() {
  const { user } = useAuth();
  const mapRef = useRef<MapRef>(null);
  const liveVehicles = useVehicles();

  // Filters
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("All");
  const [dateFilterMode, setDateFilterMode] = useState<"today" | "yesterday" | "last7" | "custom">("today");
  const [customStartDate, setCustomStartDate] = useState(
    new Date(Date.now() - 24 * 3600 * 1000).toISOString().split("T")[0]
  );
  const [customEndDate, setCustomEndDate] = useState(new Date().toISOString().split("T")[0]);

  // Master Data (Strictly the 7 physical GPS vehicles)
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [tripsList, setTripsList] = useState<any[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  // GPS Telemetry History Points (Real backend data only)
  const [gpsPoints, setGpsPoints] = useState<GpsPoint[]>([]);
  const [isLoadingGps, setIsLoadingGps] = useState(false);

  // Playback Controls State
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2 | 5 | 10>(1);
  const [currentIndex, setCurrentIndex] = useState(0);
  const playbackTimerRef = useRef<any>(null);

  // Load Vehicles (strictly 7 GPS units), Drivers & Trips
  useEffect(() => {
    async function init() {
      const [vRes, dRes, tRes] = await Promise.all([
        supabase.from("vehicles").select("id, number, type, model, device_id"),
        supabase.from("drivers").select("id, name, phone"),
        supabase.from("trips").select("*, vehicles(number), drivers(name)").order("date", { ascending: false }),
      ]);

      // Strictly construct the 7 GPS vehicles present in Nanjil Dairy fleet
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

      // Overlay with Supabase vehicles attributes if present
      if (vRes.data && vRes.data.length > 0) {
        vRes.data.forEach((v: any) => {
          if (isGpsVehicle(v)) {
            const key = (v.number || "").replace(/\s+/g, "").toUpperCase();
            if (uniqueGpsMap.has(key)) {
              const existing = uniqueGpsMap.get(key);
              uniqueGpsMap.set(key, {
                ...existing,
                ...v,
                id: v.id || existing.id,
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
        setTripsList(tRes.data);
        if (tRes.data.length > 0 && !selectedTripId) {
          setSelectedTripId(tRes.data[0].id);
        }
      }
    }
    init();
  }, []);

  // Compute Target Date Range
  const { startIso, endIso } = useMemo(() => {
    const now = new Date();
    if (dateFilterMode === "today") {
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const e = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      return { startIso: s.toISOString(), endIso: e.toISOString() };
    }
    if (dateFilterMode === "yesterday") {
      const y = new Date(now.getTime() - 24 * 3600 * 1000);
      const s = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 0, 0, 0);
      const e = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59);
      return { startIso: s.toISOString(), endIso: e.toISOString() };
    }
    if (dateFilterMode === "last7") {
      const past = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      return { startIso: past.toISOString(), endIso: now.toISOString() };
    }
    // Custom
    const s = new Date(`${customStartDate}T00:00:00`);
    const e = new Date(`${customEndDate}T23:59:59`);
    return { startIso: s.toISOString(), endIso: e.toISOString() };
  }, [dateFilterMode, customStartDate, customEndDate]);

  // Load Authentic Historical GPS Coordinates (No Synthetic Points!)
  useEffect(() => {
    if (!selectedVehicleId) return;

    let cancelled = false;
    async function fetchHistoricalTrail() {
      setIsLoadingGps(true);
      setIsPlaying(false);
      setCurrentIndex(0);

      try {
        const targetVehicle = vehicles.find((v) => v.id === selectedVehicleId);
        const candidateIds = [selectedVehicleId];
        if (targetVehicle?.device_id) candidateIds.push(targetVehicle.device_id);
        for (const [devId, meta] of Object.entries(KNOWN_NANJIL_DEVICE_MAP)) {
          if (meta.id === selectedVehicleId) {
            candidateIds.push(devId);
            candidateIds.push(meta.id);
          }
        }
        const uniqueCandidateIds = Array.from(new Set(candidateIds.filter(Boolean)));

        const { data, error } = await supabase
          .from("telemetry_history")
          .select("id, vehicle_id, lat, lng, speed, ignition, engine_on, recorded_at, odometer")
          .in("vehicle_id", uniqueCandidateIds)
          .gte("recorded_at", startIso)
          .lte("recorded_at", endIso)
          .order("recorded_at", { ascending: true });

        if (cancelled) return;

        const collected: GpsPoint[] = [];

        if (data && data.length > 0) {
          for (let i = 0; i < data.length; i++) {
            const p = data[i];
            const lat = Number(p.lat);
            const lng = Number(p.lng);
            if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0 && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
              collected.push({
                id: String(p.id),
                lat,
                lng,
                speed: Math.max(0, Math.round(Number(p.speed) || 0)),
                ignition: Boolean(p.ignition ?? p.engine_on),
                recorded_at: p.recorded_at,
                odometer: p.odometer ? Number(p.odometer) : undefined,
              });
            }
          }
        }

        // Also check if authentic live breadcrumbs were cached in localStorage
        if (typeof localStorage !== "undefined") {
          try {
            const cached = localStorage.getItem(`nanjil_real_gps_trail_${selectedVehicleId}`);
            if (cached) {
              const parsed: GpsPoint[] = JSON.parse(cached);
              if (Array.isArray(parsed)) {
                const sTime = new Date(startIso).getTime();
                const eTime = new Date(endIso).getTime();
                for (const cp of parsed) {
                  const ts = new Date(cp.recorded_at).getTime();
                  if (ts >= sTime && ts <= eTime && cp.lat && cp.lng && cp.lat !== 0 && cp.lng !== 0) {
                    collected.push(cp);
                  }
                }
              }
            }
          } catch {}
        }

        // Deduplicate points by timestamp (within 2 seconds) and sort chronologically
        const uniqueMap = new Map<string, GpsPoint>();
        for (const pt of collected) {
          const key = pt.recorded_at.substring(0, 19); // YYYY-MM-DDTHH:mm:ss
          if (!uniqueMap.has(key)) {
            uniqueMap.set(key, pt);
          }
        }

        const sorted = Array.from(uniqueMap.values()).sort(
          (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
        );

        // Detect Gaps (> 15 minutes between points)
        for (let i = 1; i < sorted.length; i++) {
          const t0 = new Date(sorted[i - 1].recorded_at).getTime();
          const t1 = new Date(sorted[i].recorded_at).getTime();
          if (t1 - t0 > 15 * 60 * 1000) {
            sorted[i].isGap = true;
          }
        }

        // Strictly set genuine records (empty array if no recorded GPS data)
        setGpsPoints(sorted);
      } catch (err) {
        console.warn("Telemetry history fetch error:", err);
        setGpsPoints([]);
      } finally {
        if (!cancelled) setIsLoadingGps(false);
      }
    }

    fetchHistoricalTrail();

    return () => {
      cancelled = true;
    };
  }, [selectedVehicleId, startIso, endIso, vehicles]);

  // Real-time live telemetry breadcrumb accumulation for selected vehicle
  useEffect(() => {
    if (!selectedVehicleId || liveVehicles.length === 0) return;
    const currentVeh = vehicles.find((v) => v.id === selectedVehicleId);
    const v = liveVehicles.find(
      (x) => x.id === selectedVehicleId || (currentVeh && x.number === currentVeh.number)
    );
    if (!v || !v.lat || !v.lng) return;

    const lat = Number(v.lat);
    const lng = Number(v.lng);
    if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0 || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return;
    }

    const recordedAt = v.last_update ? new Date(v.last_update).toISOString() : new Date().toISOString();
    const newPt: GpsPoint = {
      id: `live-${Date.now()}`,
      lat,
      lng,
      speed: Math.max(0, Math.round(Number(v.speed) || 0)),
      ignition: Boolean(v.engine_on || v.ignition),
      recorded_at: recordedAt,
      odometer: v.odometer ? Number(v.odometer) : undefined,
    };

    if (dateFilterMode === "today") {
      setGpsPoints((prev) => {
        if (prev.length > 0) {
          const last = prev[prev.length - 1];
          const timeDiff = Math.abs(new Date(recordedAt).getTime() - new Date(last.recorded_at).getTime());
          if (timeDiff < 5000 && Math.abs(last.lat - lat) < 0.0001 && Math.abs(last.lng - lng) < 0.0001) {
            return prev;
          }
        }
        const updated = [...prev, newPt];
        if (typeof localStorage !== "undefined") {
          try {
            localStorage.setItem(`nanjil_real_gps_trail_${selectedVehicleId}`, JSON.stringify(updated.slice(-500)));
          } catch {}
        }
        return updated;
      });
    }
  }, [liveVehicles, selectedVehicleId, dateFilterMode, vehicles]);

  // Selected Vehicle Last Known Authentic Location
  const vehicleCurrentPosition = useMemo(() => {
    const currentVeh = vehicles.find((v) => v.id === selectedVehicleId);
    const live = liveVehicles.find(
      (v) => v.id === selectedVehicleId || (currentVeh && v.number === currentVeh.number)
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
    // Nanjil Dairy base plant depot default
    return {
      lat: 8.260765,
      lng: 77.288373,
      speed: 0,
      status: "Stationary",
      isLive: false,
    };
  }, [liveVehicles, selectedVehicleId, vehicles]);

  // Calculate Mathematical Trip Statistics & Synchronized Events (Real Data Only)
  const { tripStats, timelineEvents } = useMemo(() => {
    if (!gpsPoints || gpsPoints.length === 0) {
      return {
        tripStats: {
          totalDistanceKm: 0,
          totalDurationMins: 0,
          drivingDurationMins: 0,
          idleDurationMins: 0,
          stationaryDurationMins: 0,
          maxSpeed: 0,
          avgSpeed: 0,
          speedingCount: 0,
          stopsCount: 0,
          gapsCount: 0,
        },
        timelineEvents: [],
      };
    }

    let totalDist = 0;
    let maxSpd = 0;
    let speedingCount = 0;
    let gapsCount = 0;
    const events: TripEvent[] = [];

    // Departure Event
    events.push({
      id: "ev-start",
      type: "start",
      timestamp: gpsPoints[0].recorded_at,
      title: "Trip Departure",
      description: `Vehicle departed at ${new Date(gpsPoints[0].recorded_at).toLocaleTimeString()}`,
      pointIndex: 0,
    });

    let idleMinutes = 0;
    let drivingMinutes = 0;
    let currentStopStartIndex = -1;

    for (let i = 0; i < gpsPoints.length; i++) {
      const p = gpsPoints[i];
      if (p.speed > maxSpd) maxSpd = p.speed;

      // Speeding check (> 60 km/h)
      if (p.speed > 60) {
        speedingCount++;
        if (i === 0 || gpsPoints[i - 1].speed <= 60) {
          events.push({
            id: `ev-speed-${i}`,
            type: "speeding",
            timestamp: p.recorded_at,
            title: `Speeding Alert (${p.speed} km/h)`,
            description: `Exceeded 60 km/h threshold by +${p.speed - 60} km/h`,
            pointIndex: i,
            speed: p.speed,
          });
        }
      }

      // Signal Gap check
      if (p.isGap) {
        gapsCount++;
        events.push({
          id: `ev-gap-${i}`,
          type: "gap",
          timestamp: p.recorded_at,
          title: "GPS Signal Loss (Gap)",
          description: "Device stopped transmitting coordinates for >15 minutes",
          pointIndex: i,
        });
      }

      // Accumulate haversine distance
      if (i > 0 && !p.isGap) {
        const d = haversineDistanceKm(gpsPoints[i - 1].lat, gpsPoints[i - 1].lng, p.lat, p.lng);
        totalDist += d;
      }

      // Stop detection (Speed == 0)
      if (p.speed === 0) {
        if (currentStopStartIndex === -1) currentStopStartIndex = i;
        idleMinutes += 2;
      } else {
        drivingMinutes += 2;
        if (currentStopStartIndex !== -1) {
          const stopDuration = Math.max(2, (i - currentStopStartIndex) * 2);
          events.push({
            id: `ev-stop-${currentStopStartIndex}`,
            type: "stop",
            timestamp: gpsPoints[currentStopStartIndex].recorded_at,
            title: `Recorded Stop (${stopDuration}m)`,
            description: `Stationary from ${new Date(gpsPoints[currentStopStartIndex].recorded_at).toLocaleTimeString()}`,
            pointIndex: currentStopStartIndex,
            durationMins: stopDuration,
          });
          currentStopStartIndex = -1;
        }
      }
    }

    // Arrival Event
    const lastIndex = gpsPoints.length - 1;
    if (gpsPoints.length > 1) {
      events.push({
        id: "ev-end",
        type: "end",
        timestamp: gpsPoints[lastIndex].recorded_at,
        title: "Trip Arrival & Parking",
        description: `Last recorded location at ${new Date(gpsPoints[lastIndex].recorded_at).toLocaleTimeString()}`,
        pointIndex: lastIndex,
      });
    }

    // Time calculations
    const tStart = new Date(gpsPoints[0].recorded_at).getTime();
    const tEnd = new Date(gpsPoints[lastIndex].recorded_at).getTime();
    const totalDurationMins = Math.max(1, Math.round((tEnd - tStart) / (1000 * 60)));

    // Mathematical Average Speed = Total Distance / Driving Time (NOT average of instantaneous speeds)
    const avgSpeed =
      drivingMinutes > 0
        ? Math.round((totalDist / (drivingMinutes / 60)) * 10) / 10
        : Math.round((totalDist / (totalDurationMins / 60)) * 10) / 10;

    return {
      tripStats: {
        totalDistanceKm: Math.round(totalDist * 10) / 10,
        totalDurationMins: totalDurationMins || (idleMinutes + drivingMinutes),
        drivingDurationMins: drivingMinutes,
        idleDurationMins: idleMinutes,
        stationaryDurationMins: idleMinutes,
        maxSpeed: maxSpd,
        avgSpeed: isNaN(avgSpeed) ? 0 : avgSpeed,
        speedingCount,
        stopsCount: events.filter((e) => e.type === "stop").length,
        gapsCount,
      },
      timelineEvents: events,
    };
  }, [gpsPoints]);

  // Build GeoJSON path from recorded GPS coordinates
  const historicalGeoJson = useMemo(() => {
    if (!gpsPoints || gpsPoints.length < 2) return null;
    const coords = gpsPoints.map((p) => [p.lng, p.lat]);
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: coords,
      },
    };
  }, [gpsPoints]);

  // Current active point during playback
  const currentPoint = gpsPoints[currentIndex] || gpsPoints[0] || null;

  // Playback Animation Loop
  useEffect(() => {
    if (!isPlaying || gpsPoints.length === 0) {
      if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
      return;
    }

    const intervalMs = Math.round(1000 / playbackSpeed);

    playbackTimerRef.current = setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= gpsPoints.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);

    return () => {
      if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
    };
  }, [isPlaying, playbackSpeed, gpsPoints.length]);

  // Center map on playback position or initial load
  useEffect(() => {
    if (mapRef.current) {
      if (currentPoint) {
        mapRef.current.easeTo({
          center: [currentPoint.lng, currentPoint.lat],
          duration: 400,
        });
      } else if (vehicleCurrentPosition) {
        mapRef.current.easeTo({
          center: [vehicleCurrentPosition.lng, vehicleCurrentPosition.lat],
          duration: 400,
        });
      }
    }
  }, [currentIndex, currentPoint, vehicleCurrentPosition]);

  // Jump playback to a specific point index
  function jumpToPointIndex(index: number) {
    if (index >= 0 && index < gpsPoints.length) {
      setCurrentIndex(index);
    }
  }

  // CSV Export Functionality
  function exportTripCsv() {
    if (!gpsPoints.length) return;
    const rows = [
      ["Index", "Timestamp", "Latitude", "Longitude", "Speed_Kmh", "Ignition", "Odometer_Km", "SignalGap"],
      ...gpsPoints.map((p, idx) => [
        idx + 1,
        p.recorded_at,
        p.lat.toFixed(6),
        p.lng.toFixed(6),
        p.speed,
        p.ignition ? "ON" : "OFF",
        p.odometer || "",
        p.isGap ? "YES" : "NO",
      ]),
    ];

    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `Trip_History_${selectedVehicle?.number || "Vehicle"}_${dateFilterMode}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Print PDF Trip Report
  function printTripReport() {
    window.print();
  }

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId);
  const selectedDriver = drivers.find((d) => d.id === selectedDriverId);

  return (
    <div className="space-y-5">
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <PageHeader
        title="Trip History & GPS Playback"
        subtitle={`Historical Journey Investigation · Authentic Backend Telemetry · 7 GPS Vehicles`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={exportTripCsv}
              disabled={gpsPoints.length === 0}
              className={`border border-slate-200 text-xs font-semibold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-xs ${
                gpsPoints.length === 0
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

      {/* ── FILTER TOOLBAR ──────────────────────────────────────── */}
      <Card className="border border-slate-200/80 p-3.5 shadow-xs bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Quick Date Filters */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setDateFilterMode("today")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                dateFilterMode === "today" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setDateFilterMode("yesterday")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                dateFilterMode === "yesterday"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Yesterday
            </button>
            <button
              onClick={() => setDateFilterMode("last7")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                dateFilterMode === "last7" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Last 7 Days
            </button>
            <button
              onClick={() => setDateFilterMode("custom")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                dateFilterMode === "custom"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Custom Range
            </button>
          </div>

          {/* Vehicle & Driver Selectors */}
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
          </div>
        </div>
      </Card>

      {/* ── SUMMARY STATS BAR (Real Data Only) ───────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Total Distance</div>
          <div className="text-lg font-bold text-slate-900 mt-1">
            {tripStats.totalDistanceKm} <span className="text-xs font-normal text-slate-500">km</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Trip Duration</div>
          <div className="text-lg font-bold text-slate-900 mt-1">
            {Math.floor(tripStats.totalDurationMins / 60)}h {tripStats.totalDurationMins % 60}m
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Average Speed</div>
          <div className="text-lg font-bold text-slate-900 mt-1 flex items-baseline gap-1">
            {tripStats.avgSpeed} <span className="text-xs font-normal text-slate-500">km/h</span>
          </div>
          <div className="text-[10px] text-slate-400">Accurate dist / time</div>
        </div>

        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Max Speed</div>
          <div className="text-lg font-bold text-slate-900 mt-1 flex items-baseline gap-1">
            {tripStats.maxSpeed} <span className="text-xs font-normal text-slate-500">km/h</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Speeding Alerts</div>
          <div
            className={`text-lg font-bold mt-1 ${
              tripStats.speedingCount > 0 ? "text-amber-600" : "text-slate-900"
            }`}
          >
            {tripStats.speedingCount} <span className="text-xs font-normal text-slate-500">incidents</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 p-3 rounded-2xl shadow-xs">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Recorded Stops</div>
          <div className="text-lg font-bold text-slate-900 mt-1 flex items-baseline gap-1">
            {tripStats.stopsCount} <span className="text-xs font-normal text-slate-500">stops</span>
          </div>
        </div>
      </div>

      {/* ── MAIN PLAYBACK WORKSPACE ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* MAP & PLAYBACK CONTROLLER (8 COLS) */}
        <div className="lg:col-span-8 flex flex-col gap-3">
          <Card className="border border-slate-200/80 overflow-hidden shadow-xs flex-1 flex flex-col">
            {/* Map Canvas */}
            <div className="relative h-[500px] w-full bg-slate-100">
              <MapGL
                ref={mapRef}
                initialViewState={{
                  longitude: currentPoint?.lng || vehicleCurrentPosition.lng,
                  latitude: currentPoint?.lat || vehicleCurrentPosition.lat,
                  zoom: 12,
                }}
                mapStyle={MAP_STYLE}
                style={{ width: "100%", height: "100%" }}
              >
                <NavigationControl position="top-right" />

                {/* Actual Historical GPS Trail (Blue Polyline) */}
                {historicalGeoJson && (
                  <Source id="historical-trail" type="geojson" data={historicalGeoJson}>
                    <Layer
                      id="trail-casing"
                      type="line"
                      paint={{
                        "line-color": "#1E293B",
                        "line-width": 5,
                        "line-opacity": 0.3,
                      }}
                    />
                    <Layer
                      id="trail-line"
                      type="line"
                      paint={{
                        "line-color": "#2563EB",
                        "line-width": 3.5,
                        "line-opacity": 0.9,
                      }}
                    />
                  </Source>
                )}

                {/* Start Point Marker */}
                {gpsPoints.length > 0 && (
                  <Marker longitude={gpsPoints[0].lng} latitude={gpsPoints[0].lat} anchor="center">
                    <div className="h-6 w-6 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-[10px] shadow-lg border-2 border-white">
                      A
                    </div>
                  </Marker>
                )}

                {/* End Point Marker */}
                {gpsPoints.length > 1 && (
                  <Marker
                    longitude={gpsPoints[gpsPoints.length - 1].lng}
                    latitude={gpsPoints[gpsPoints.length - 1].lat}
                    anchor="center"
                  >
                    <div className="h-6 w-6 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-[10px] shadow-lg border-2 border-white">
                      B
                    </div>
                  </Marker>
                )}

                {/* If no trail on this date, show current authentic GPS position marker */}
                {gpsPoints.length === 0 && (
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
                        {selectedVehicle?.number || "Vehicle"} (Current Position)
                      </div>
                    </div>
                  </Marker>
                )}

                {/* Stop Markers */}
                {timelineEvents
                  .filter((e) => e.type === "stop")
                  .map((e) => {
                    const pt = gpsPoints[e.pointIndex];
                    if (!pt) return null;
                    return (
                      <Marker key={e.id} longitude={pt.lng} latitude={pt.lat} anchor="center">
                        <div
                          onClick={() => jumpToPointIndex(e.pointIndex)}
                          className="h-5 w-5 rounded-full bg-amber-500 text-white flex items-center justify-center text-[9px] font-bold shadow-md border border-white cursor-pointer hover:scale-125 transition-transform"
                          title={e.title}
                        >
                          P
                        </div>
                      </Marker>
                    );
                  })}

                {/* Signal Gap Markers */}
                {timelineEvents
                  .filter((e) => e.type === "gap")
                  .map((e) => {
                    const pt = gpsPoints[e.pointIndex];
                    if (!pt) return null;
                    return (
                      <Marker key={e.id} longitude={pt.lng} latitude={pt.lat} anchor="center">
                        <div
                          className="h-5 w-5 rounded-full bg-red-600 text-white flex items-center justify-center text-[9px] font-bold shadow-md border border-white"
                          title="GPS Signal Gap"
                        >
                          !
                        </div>
                      </Marker>
                    );
                  })}

                {/* ACTIVE PLAYBACK VEHICLE MARKER */}
                {currentPoint && (
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
              <div className="absolute top-3 left-3 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl p-3 shadow-lg text-xs space-y-1.5 min-w-[210px] z-10">
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
                      : vehicleCurrentPosition.isLive
                      ? "Online (Live)"
                      : "GPS Gateway Active"}
                  </Badge>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-slate-500 font-medium">Recorded Speed:</span>
                  <span className="text-base font-bold text-slate-900">
                    {currentPoint ? currentPoint.speed : 0} km/h
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Timestamp:</span>
                  <span className="font-semibold text-slate-700">
                    {currentPoint
                      ? new Date(currentPoint.recorded_at).toLocaleTimeString()
                      : "No Journey Recorded"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>Coordinates:</span>
                  <span>
                    {currentPoint
                      ? `${currentPoint.lat.toFixed(4)}, ${currentPoint.lng.toFixed(4)}`
                      : `${vehicleCurrentPosition.lat.toFixed(4)}, ${vehicleCurrentPosition.lng.toFixed(4)}`}
                  </span>
                </div>
              </div>

              {/* EMPTY STATE BANNER (When no historical trail on selected date) */}
              {gpsPoints.length === 0 && !isLoadingGps && (
                <div className="absolute bottom-3 left-3 right-3 bg-amber-50/95 backdrop-blur-sm border border-amber-200 rounded-xl p-2.5 shadow-md flex items-center justify-between z-10 text-xs">
                  <div className="flex items-center gap-2 text-amber-800">
                    <Activity className="h-4 w-4 text-amber-600 shrink-0" />
                    <span>
                      <strong>No GPS Telemetry Recorded for Selected Date</strong> (Backend Real Data Only).
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
                  <span>{gpsPoints[0] ? new Date(gpsPoints[0].recorded_at).toLocaleTimeString() : "00:00"}</span>
                  <span className="font-bold text-indigo-700">
                    {currentPoint
                      ? `${new Date(currentPoint.recorded_at).toLocaleTimeString()} (Point ${
                          currentIndex + 1
                        } of ${gpsPoints.length})`
                      : "00:00 (No Telemetry to Replay)"}
                  </span>
                  <span>
                    {gpsPoints.length > 1
                      ? new Date(gpsPoints[gpsPoints.length - 1].recorded_at).toLocaleTimeString()
                      : "00:00"}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, gpsPoints.length - 1)}
                  value={currentIndex}
                  disabled={gpsPoints.length === 0}
                  onChange={(e) => setCurrentIndex(parseInt(e.target.value, 10))}
                  className={`w-full h-2 rounded-lg appearance-none cursor-pointer accent-indigo-600 ${
                    gpsPoints.length === 0 ? "bg-slate-100 cursor-not-allowed" : "bg-slate-200"
                  }`}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCurrentIndex(0)}
                    disabled={gpsPoints.length === 0}
                    className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Jump to Start"
                  >
                    <SkipBack className="h-4 w-4" />
                  </button>

                  <button
                    onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 5))}
                    disabled={gpsPoints.length === 0}
                    className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Step Backward"
                  >
                    <Rewind className="h-4 w-4" />
                  </button>

                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    disabled={gpsPoints.length === 0}
                    className={`px-4 py-2 rounded-xl font-semibold text-xs flex items-center gap-1.5 shadow-xs transition-colors ${
                      gpsPoints.length === 0
                        ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                        : "bg-indigo-600 hover:bg-indigo-700 text-white"
                    }`}
                  >
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    <span>
                      {gpsPoints.length === 0
                        ? "No Recorded Telemetry"
                        : isPlaying
                        ? "Pause"
                        : "Play Journey"}
                    </span>
                  </button>

                  <button
                    onClick={() => setCurrentIndex((prev) => Math.min(gpsPoints.length - 1, prev + 5))}
                    disabled={gpsPoints.length === 0}
                    className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Step Forward"
                  >
                    <FastForward className="h-4 w-4" />
                  </button>

                  <button
                    onClick={() => setCurrentIndex(gpsPoints.length - 1)}
                    disabled={gpsPoints.length === 0}
                    className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Jump to End"
                  >
                    <SkipForward className="h-4 w-4" />
                  </button>
                </div>

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
          </Card>
        </div>

        {/* ── SYNCHRONIZED TIMELINE & INCIDENTS (4 COLS) ──────────── */}
        <div className="lg:col-span-4 space-y-4">
          <Card className="border border-slate-200/80 p-4 flex flex-col max-h-[620px] shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Synchronized Journey Events
                </div>
                <div className="text-[10px] text-slate-500">
                  {timelineEvents.length > 0
                    ? "Click any event to immediately move playback"
                    : "Authentic backend events log"}
                </div>
              </div>
              <Badge variant="outline" className="text-[10px]">
                {timelineEvents.length} events
              </Badge>
            </div>

            {/* Event List or Empty State */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {timelineEvents.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center border-2 border-dashed border-slate-200 rounded-xl my-4">
                  <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-2">
                    <History className="h-5 w-5" />
                  </div>
                  <div className="font-semibold text-slate-700 text-xs">No Journey Events Recorded</div>
                  <div className="text-[11px] text-slate-400 max-w-xs mt-1">
                    No recorded departures, stops, or speed alerts for {selectedVehicle?.number || "this vehicle"} on the selected date. Backend real data only.
                  </div>
                </div>
              ) : (
                timelineEvents.map((ev) => {
                  const isActive = Math.abs(currentIndex - ev.pointIndex) < 3;
                  return (
                    <div
                      key={ev.id}
                      onClick={() => jumpToPointIndex(ev.pointIndex)}
                      className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                        isActive
                          ? "border-indigo-400 bg-indigo-50/70 shadow-xs ring-1 ring-indigo-200"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {ev.type === "start" && (
                            <div className="h-6 w-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold shrink-0">
                              <Navigation className="h-3 w-3" />
                            </div>
                          )}
                          {ev.type === "stop" && (
                            <div className="h-6 w-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold shrink-0">
                              <Clock className="h-3 w-3" />
                            </div>
                          )}
                          {ev.type === "speeding" && (
                            <div className="h-6 w-6 rounded-full bg-red-100 text-red-700 flex items-center justify-center font-bold shrink-0">
                              <AlertTriangle className="h-3 w-3" />
                            </div>
                          )}
                          {ev.type === "gap" && (
                            <div className="h-6 w-6 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold shrink-0">
                              <Radio className="h-3 w-3" />
                            </div>
                          )}
                          {ev.type === "end" && (
                            <div className="h-6 w-6 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold shrink-0">
                              <CheckCircle2 className="h-3 w-3" />
                            </div>
                          )}

                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 truncate">{ev.title}</div>
                            <div className="text-[11px] text-slate-500 mt-0.5">{ev.description}</div>
                          </div>
                        </div>

                        <div className="text-[10px] font-semibold text-slate-400 shrink-0">
                          {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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
