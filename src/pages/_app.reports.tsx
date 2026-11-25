import { useState, useEffect, useMemo, useRef } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Badge, Button, Card } from "@/components/ui-kit";
import {
  Calendar,
  Truck,
  Route,
  Gauge,
  FileSpreadsheet,
  Printer,
  Clock,
  Loader2,
  RotateCcw,
  Activity,
  Navigation,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { globalOverspeedManager } from "@/lib/overspeed";
import { useVehicles } from "@/hooks/useVehicleTracking";
import {
  getImmediateLocationDisplay,
  reverseGeocodeCoordinate,
  getCachedLocation,
  clearGeocodeCache,
} from "@/lib/reverseGeocoding";
import { toFleetCoord } from "@/components/maps/mapConstants";
import { isGpsVehicle, KNOWN_NANJIL_DEVICE_MAP } from "@/lib/vehicle-stop-detection";
import {
  fetchPaginatedTelemetryHistory,
  formatIstDateTime,
  isValidUuid,
} from "@/lib/tripHistoryEngine";
import {
  type ReportDateMode,
  type DailyActivityMetricsRow,
  resolveReportDateBounds,
  filterRecordsByIstRange,
  buildDailyActivityRow,
  aggregateDailyActivitySummary,
  formatDurationCompact,
} from "@/lib/dailyActivityReport";

type ReportType =
  | "daily_activity"
  | "route_completion"
  | "speeding_incidents"
  | "fuel_efficiency"
  | "maintenance_costs";

function getTodayIstString(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getYesterdayIstString(): string {
  const todayStr = getTodayIstString();
  const [y, m, d] = todayStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().split("T")[0];
}

function getStatusBadgeClass(status: string): string {
  const s = (status || "").toLowerCase();
  if (s === "moving" || s.startsWith("active") || s === "completed" || s === "resolved") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (s === "idle" || s === "stationary") {
    return "bg-amber-50 text-amber-700 border-amber-200";
  }
  if (s === "parked" || s === "scheduled") {
    return "bg-blue-50 text-blue-700 border-blue-200";
  }
  if (s.includes("open") || s.includes("alert")) {
    return "bg-red-50 text-red-700 border-red-200";
  }
  return "bg-slate-100 text-slate-600 border-slate-200";
}

export default function ReportsPage() {
  useAuth();
  const liveVehicles = useVehicles();
  const liveVehiclesRef = useRef(liveVehicles);
  liveVehiclesRef.current = liveVehicles;

  const [selectedReport, setSelectedReport] = useState<ReportType>("daily_activity");
  const [dateRange, setDateRange] = useState<ReportDateMode>("today");
  const [customStartDate, setCustomStartDate] = useState<string>(() => getTodayIstString());
  const [customEndDate, setCustomEndDate] = useState<string>(() => getTodayIstString());
  const [selectedVehicle, setSelectedVehicle] = useState("All");

  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [rawDailyRows, setRawDailyRows] = useState<DailyActivityMetricsRow[]>([]);
  const [dailyTelemetryComputed, setDailyTelemetryComputed] = useState<boolean>(true);
  const [dailyCountsMap, setDailyCountsMap] = useState<Record<string, number>>({});
  const [otherReportRows, setOtherReportRows] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const dateBounds = useMemo(() => {
    return resolveReportDateBounds(dateRange, customStartDate, customEndDate);
  }, [dateRange, customStartDate, customEndDate]);

  // Map live Firebase/Realtime telemetry by vehicle UUID and vehicle number
  const liveVehicleByKey = useMemo(() => {
    const map = new Map<string, (typeof liveVehicles)[number]>();
    liveVehicles.forEach((lv) => {
      if (!isGpsVehicle(lv)) return;
      if (lv.id) map.set(lv.id, lv);
      if (lv.number) map.set(lv.number.replace(/\s+/g, "").toUpperCase(), lv);
    });
    return map;
  }, [liveVehicles]);

  // Load registered vehicles (strictly 7 GPS units), drivers, and assignments
  useEffect(() => {
    let cancelled = false;
    async function loadMetadata() {
      const [vRes, dRes, aRes] = await Promise.all([
        supabase
          .from("v_vehicles")
          .select("id, number, driver_name, type, model, odometer, status, location, lat, lng, last_update, device_id")
          .order("number"),
        supabase.from("drivers").select("id, name, phone"),
        supabase
          .from("vehicle_assignments")
          .select("id, vehicle_id, driver_id, assigned_at, unassigned_at, is_active, drivers(id, name)"),
      ]);

      if (cancelled) return;

      // Authoritative 7 physical GPS vehicles
      const fleetMap = new Map<string, any>();
      Object.entries(KNOWN_NANJIL_DEVICE_MAP).forEach(([devId, meta]) => {
        const key = meta.number.replace(/\s+/g, "").toUpperCase();
        fleetMap.set(key, {
          id: meta.id,
          number: meta.number,
          model: meta.model,
          type: "Tanker 10KL",
          device_id: devId,
        });
      });

      if (vRes.data) {
        vRes.data.filter(isGpsVehicle).forEach((v: any) => {
          const key = (v.number || "").replace(/\s+/g, "").toUpperCase();
          if (fleetMap.has(key)) {
            const base = fleetMap.get(key);
            fleetMap.set(key, {
              ...v,
              id: base.id,
              number: base.number,
              device_id: base.device_id,
            });
          }
        });
      }

      const sortedFleet = Array.from(fleetMap.values()).sort((a, b) =>
        (a.number || "").localeCompare(b.number || "")
      );
      setVehicles(sortedFleet);
      if (dRes.data) setDrivers(dRes.data);
      if (aRes.data) setAssignments(aRes.data);
    }
    loadMetadata();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // Fetch report data based on selectedReport, IST dateBounds, and selectedVehicle
  useEffect(() => {
    let cancelled = false;
    const abortCtrl = new AbortController();

    async function fetchReportData() {
      setIsLoading(true);
      try {
        if (selectedReport === "daily_activity") {
          // Ensure we have vehicle list (fall back to KNOWN_NANJIL_DEVICE_MAP if metadata still loading)
          let targetFleet = vehicles;
          if (targetFleet.length === 0) {
            const { data } = await supabase
              .from("v_vehicles")
              .select("id, number, driver_name, type, model, odometer, status, location, lat, lng, last_update, device_id")
              .order("number");
            if (cancelled) return;
            targetFleet = (data || []).filter(isGpsVehicle);
            if (targetFleet.length === 0) {
              targetFleet = Object.entries(KNOWN_NANJIL_DEVICE_MAP)
                .map(([devId, meta]) => ({
                  id: meta.id,
                  number: meta.number,
                  model: meta.model,
                  type: "Tanker 10KL",
                  device_id: devId,
                }))
                .sort((a, b) => a.number.localeCompare(b.number));
            }
          }

          const filteredFleet =
            selectedVehicle !== "All"
              ? targetFleet.filter((v) => v.number === selectedVehicle)
              : targetFleet;

          const canComputeFullTelemetry =
            !dateBounds.isAllTime &&
            Boolean(dateBounds.startUtcIso && dateBounds.endUtcIso) &&
            dateBounds.daySpan <= 7;

          setDailyTelemetryComputed(canComputeFullTelemetry);

          if (canComputeFullTelemetry) {
            // Parallel per-vehicle telemetry fetch over exact IST [startUtcIso, endUtcIso]
            const perVehicleData = await Promise.all(
              filteredFleet.map(async (v) => {
                if (!isValidUuid(v.id)) {
                  return { vehicle: v, points: [] };
                }
                const res = await fetchPaginatedTelemetryHistory(
                  supabase,
                  v.id,
                  dateBounds.startUtcIso!,
                  dateBounds.endUtcIso!,
                  1000,
                  undefined,
                  abortCtrl.signal
                );
                return { vehicle: v, points: res.data || [] };
              })
            );
            if (cancelled) return;

            const builtRows = perVehicleData.map(({ vehicle, points }) => {
              const liveMatch =
                liveVehiclesRef.current.find(
                  (lv) =>
                    lv.id === vehicle.id ||
                    lv.number?.replace(/\s+/g, "").toUpperCase() ===
                      vehicle.number?.replace(/\s+/g, "").toUpperCase()
                ) || null;
              return buildDailyActivityRow({
                vehicle,
                liveVehicle: liveMatch,
                points,
                assignments,
                drivers,
                bounds: dateBounds,
                telemetryComputed: true,
              });
            });

            setRawDailyRows(builtRows);
            setDailyCountsMap({});

            // Background reverse-geocoding for coordinates not yet cached
            const pendingCoords = builtRows.filter(
              (r) =>
                r.coordLat != null &&
                r.coordLng != null &&
                !getCachedLocation(r.coordLat, r.coordLng)
            );
            if (pendingCoords.length > 0) {
              Promise.all(
                pendingCoords.map(async (r) => {
                  const fallback = `${r.coordLat!.toFixed(4)}, ${r.coordLng!.toFixed(4)}`;
                  const placeName = await reverseGeocodeCoordinate(r.coordLat!, r.coordLng!, fallback);
                  return { vehicle: r.vehicle, placeName };
                })
              )
                .then((resolved) => {
                  if (cancelled) return;
                  const updates = new Map<string, string>();
                  resolved.forEach((item) => {
                    if (item?.placeName) updates.set(item.vehicle, item.placeName);
                  });
                  if (updates.size > 0) {
                    setRawDailyRows((prev) =>
                      prev.map((row) =>
                        updates.has(row.vehicle) ? { ...row, location: updates.get(row.vehicle)! } : row
                      )
                    );
                  }
                })
                .catch((err) => console.warn("[Reports] Geocode notice:", err));
            }
          } else {
            // Range > 7 days (Last 30 Days or All Time): fetch fast telemetry counts & latest snapshot per vehicle
            const counts: Record<string, number> = {};
            const latestPointsMap = new Map<string, any>();

            await Promise.all(
              filteredFleet.map(async (v) => {
                if (!isValidUuid(v.id)) return;
                let q = supabase
                  .from("telemetry_history")
                  .select("lat, lng, speed, recorded_at, odometer", { count: "exact" })
                  .eq("vehicle_id", v.id)
                  .order("recorded_at", { ascending: false })
                  .limit(1);

                if (dateBounds.startUtcIso && dateBounds.endUtcIso) {
                  q = q.gte("recorded_at", dateBounds.startUtcIso).lte("recorded_at", dateBounds.endUtcIso);
                }

                const { data, count } = await q;
                counts[v.id] = count || 0;
                if (data && data.length > 0) {
                  latestPointsMap.set(v.id, data[0]);
                }
              })
            );
            if (cancelled) return;

            setDailyCountsMap(counts);
            const builtRows = filteredFleet.map((vehicle) => {
              const liveMatch =
                liveVehiclesRef.current.find(
                  (lv) =>
                    lv.id === vehicle.id ||
                    lv.number?.replace(/\s+/g, "").toUpperCase() ===
                      vehicle.number?.replace(/\s+/g, "").toUpperCase()
                ) || null;
              const latestPt = latestPointsMap.get(vehicle.id);
              const pseudoPoints = latestPt
                ? [
                    {
                      id: "latest",
                      lat: Number(latestPt.lat),
                      lng: Number(latestPt.lng),
                      speed: Number(latestPt.speed) || 0,
                      ignition: false,
                      recorded_at: latestPt.recorded_at,
                      odometer: latestPt.odometer != null ? Number(latestPt.odometer) : undefined,
                    },
                  ]
                : [];
              return buildDailyActivityRow({
                vehicle,
                liveVehicle: liveMatch,
                points: pseudoPoints,
                assignments,
                drivers,
                bounds: dateBounds,
                telemetryComputed: false,
              });
            });

            setRawDailyRows(builtRows);

            const pendingCoords = builtRows.filter(
              (r) =>
                r.coordLat != null &&
                r.coordLng != null &&
                !getCachedLocation(r.coordLat, r.coordLng)
            );
            if (pendingCoords.length > 0) {
              Promise.all(
                pendingCoords.map(async (r) => {
                  const fallback = `${r.coordLat!.toFixed(4)}, ${r.coordLng!.toFixed(4)}`;
                  const placeName = await reverseGeocodeCoordinate(r.coordLat!, r.coordLng!, fallback);
                  return { vehicle: r.vehicle, placeName };
                })
              )
                .then((resolved) => {
                  if (cancelled) return;
                  const updates = new Map<string, string>();
                  resolved.forEach((item) => {
                    if (item?.placeName) updates.set(item.vehicle, item.placeName);
                  });
                  if (updates.size > 0) {
                    setRawDailyRows((prev) =>
                      prev.map((row) =>
                        updates.has(row.vehicle) ? { ...row, location: updates.get(row.vehicle)! } : row
                      )
                    );
                  }
                })
                .catch((err) => console.warn("[Reports] Geocode notice:", err));
            }
          }
        } else if (selectedReport === "route_completion") {
          const { data, error } = await supabase
            .from("collection_routes")
            .select("*, vehicles(id, number, device_id), drivers(name)")
            .order("created_at", { ascending: false });
          if (cancelled) return;
          if (error) throw error;

          let filtered = (data || []).filter((r) => isGpsVehicle(r.vehicles));
          filtered = filterRecordsByIstRange(filtered, (r) => r.created_at, dateBounds);
          if (selectedVehicle !== "All") {
            filtered = filtered.filter((r) => r.vehicles?.number === selectedVehicle);
          }

          setOtherReportRows(
            filtered.map((r) => ({
              routeName: r.name,
              vehicle: r.vehicles?.number || "Unassigned",
              driver: r.drivers?.name || "Assigned Driver",
              scheduledStart: r.start_time || "05:30",
              estimatedEnd: r.end_time || "10:00 AM",
              collectionCentres: r.centres || 0,
              completionRate: `${r.completion || 0}%`,
              milkCollectedLiters: r.litres ? `${Number(r.litres).toLocaleString()} L` : "0 L",
              status: r.status || "Scheduled",
              date: formatIstDateTime(r.created_at),
            }))
          );
        } else if (selectedReport === "speeding_incidents") {
          const { data, error } = await supabase
            .from("alerts")
            .select("*, vehicles(id, number, device_id)")
            .order("time", { ascending: false });
          if (cancelled) return;
          if (error) throw error;

          let filtered = (data || []).filter((a) => isGpsVehicle(a.vehicles));
          filtered = filterRecordsByIstRange(filtered, (a) => a.time, dateBounds);
          if (selectedVehicle !== "All") {
            filtered = filtered.filter((a) => a.vehicles?.number === selectedVehicle);
          }

          setOtherReportRows(
            filtered.map((a) => ({
              vehicle: a.vehicles?.number || "Fleet Unit",
              alertType: a.type || "Safety",
              severity: a.severity || "Medium",
              incidentDetails: a.message,
              recordedTimestamp: formatIstDateTime(a.time),
              status: a.resolved ? "Resolved" : "Active / Open",
              resolvedAt: a.resolved_at ? formatIstDateTime(a.resolved_at) : "-",
            }))
          );
        } else if (selectedReport === "fuel_efficiency") {
          const { data, error } = await supabase
            .from("fuel_purchase_logs")
            .select("*, vehicles(id, number, device_id), drivers(name)")
            .order("logged_at", { ascending: false });
          if (cancelled) return;
          if (error) throw error;

          let filtered = (data || []).filter((f) => isGpsVehicle(f.vehicles));
          filtered = filterRecordsByIstRange(filtered, (f) => f.logged_at, dateBounds);
          if (selectedVehicle !== "All") {
            filtered = filtered.filter((f) => f.vehicles?.number === selectedVehicle);
          }

          setOtherReportRows(
            filtered.map((f) => ({
              vehicle: f.vehicles?.number || "Fleet Unit",
              driver: f.drivers?.name || "Assigned Driver",
              fillDate: formatIstDateTime(f.logged_at),
              volumeLiters: `${f.liters} L`,
              totalCost: `₹ ${Number(f.cost).toLocaleString("en-IN")}`,
              odometerAtFill: `${Number(f.odometer).toLocaleString()} km`,
              tankFillType: f.is_full_tank ? "Full Tank" : "Partial",
              ratePerLiter:
                f.liters > 0
                  ? `₹ ${(Number(f.cost) / Number(f.liters)).toFixed(2)} / L`
                  : "-",
            }))
          );
        } else if (selectedReport === "maintenance_costs") {
          const { data, error } = await supabase
            .from("maintenance_records")
            .select("*, vehicles(id, number, device_id)")
            .order("created_at", { ascending: false });
          if (cancelled) return;
          if (error) throw error;

          let filtered = (data || []).filter((m) => isGpsVehicle(m.vehicles));
          filtered = filterRecordsByIstRange(filtered, (m) => m.created_at, dateBounds);
          if (selectedVehicle !== "All") {
            filtered = filtered.filter((m) => m.vehicles?.number === selectedVehicle);
          }

          setOtherReportRows(
            filtered.map((m) => ({
              vehicle: m.vehicles?.number || "Fleet Unit",
              serviceDescription: m.service || "Periodic Maintenance",
              dueDate: m.due_date || "-",
              cost:
                Number(m.cost) > 0
                  ? `₹ ${Number(m.cost).toLocaleString("en-IN")}`
                  : "Warranty / In-House",
              status: m.status || "Completed",
              loggedDate: formatIstDateTime(m.created_at),
            }))
          );
        }
      } catch (err) {
        if (!abortCtrl.signal.aborted) {
          console.warn("Failed to fetch report backend data:", err);
          if (selectedReport === "daily_activity") setRawDailyRows([]);
          else setOtherReportRows([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchReportData();

    const channelId = `reports-alerts-realtime-${Math.random().toString(36).substring(2, 9)}`;
    const channel = supabase
      .channel(channelId)
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => {
        if (!cancelled && selectedReport === "speeding_incidents") fetchReportData();
      })
      .subscribe();

    return () => {
      cancelled = true;
      abortCtrl.abort();
      supabase.removeChannel(channel);
    };
  }, [selectedReport, dateBounds, selectedVehicle, refreshKey, vehicles, drivers, assignments]);

  // Synchronize Today & All Time live status / odometer / location with Firebase live stream without re-querying Supabase
  const enrichedDailyRows = useMemo(() => {
    const isCurrentScope = dateBounds.isAllTime || dateBounds.mode === "today";
    if (!isCurrentScope) return rawDailyRows;

    return rawDailyRows.map((row) => {
      const key = row.vehicle.replace(/\s+/g, "").toUpperCase();
      const live = liveVehicleByKey.get(row.vehicleId) || liveVehicleByKey.get(key);
      if (!live) return row;

      const updatedOdoNum =
        live.odometer != null && Number(live.odometer) > 0 ? Number(live.odometer) : row.odometerNum;
      const updatedOdoKm =
        updatedOdoNum != null ? `${Math.round(updatedOdoNum).toLocaleString()} km` : row.odometerKm;

      const liveLastMs = live.lastUpdate ? new Date(live.lastUpdate).getTime() : 0;
      const useLiveLast = liveLastMs > row.lastReportedMs;
      const updatedLastReported = useLiveLast
        ? formatIstDateTime(live.lastUpdate!)
        : row.lastReported;

      const liveCoord = toFleetCoord({ lat: live.lat, lng: live.lng });
      const cachedPlace = liveCoord ? getCachedLocation(liveCoord.lat, liveCoord.lng) : null;
      const updatedLocation =
        row.location === "No telemetry in period" || row.location === "-" || useLiveLast
          ? cachedPlace || getImmediateLocationDisplay(live.location, live.lat, live.lng)
          : row.location;

      return {
        ...row,
        driver: row.driver === "Unassigned" && live.driver ? live.driver : row.driver,
        status: live.status || row.status,
        odometerNum: updatedOdoNum,
        odometerKm: updatedOdoKm,
        location: updatedLocation,
        lastReported: updatedLastReported,
        lastReportedMs: Math.max(row.lastReportedMs, liveLastMs || 0),
      };
    });
  }, [rawDailyRows, liveVehicleByKey, dateBounds.isAllTime, dateBounds.mode]);

  const dailySummary = useMemo(
    () => aggregateDailyActivitySummary(enrichedDailyRows),
    [enrichedDailyRows]
  );

  // Format clean display / CSV rows for the table
  const reportRows = useMemo(() => {
    if (selectedReport !== "daily_activity") {
      return otherReportRows;
    }

    if (dailyTelemetryComputed) {
      return enrichedDailyRows.map((r) => ({
        vehicle: r.vehicle,
        driver: r.driver,
        model: r.model,
        distanceKm: r.distanceKm,
        trips: r.tripsCount,
        drivingTime: r.drivingTime,
        stoppedTime: r.stoppedTime,
        "Avg / Max Speed": r.speedSummary,
        odometerKm: r.odometerKm,
        status: r.status,
        location: r.location,
        lastReported: r.lastReported,
      }));
    }

    return enrichedDailyRows.map((r) => ({
      vehicle: r.vehicle,
      driver: r.driver,
      model: r.model,
      category: r.category,
      odometerKm: r.odometerKm,
      gpsReadings: (dailyCountsMap[r.vehicleId] || 0).toLocaleString(),
      status: r.status,
      location: r.location,
      lastReported: r.lastReported,
    }));
  }, [selectedReport, otherReportRows, dailyTelemetryComputed, enrichedDailyRows, dailyCountsMap]);

  function handlePresetDate(mode: ReportDateMode) {
    setDateRange(mode);
    const todayStr = getTodayIstString();
    const yestStr = getYesterdayIstString();
    if (mode === "today") {
      setCustomStartDate(todayStr);
      setCustomEndDate(todayStr);
    } else if (mode === "yesterday") {
      setCustomStartDate(yestStr);
      setCustomEndDate(yestStr);
    } else if (mode === "week") {
      const [y, m, d] = todayStr.split("-").map(Number);
      setCustomStartDate(new Date(Date.UTC(y, m - 1, d - 6)).toISOString().split("T")[0]);
      setCustomEndDate(todayStr);
    } else if (mode === "month") {
      const [y, m, d] = todayStr.split("-").map(Number);
      setCustomStartDate(new Date(Date.UTC(y, m - 1, d - 29)).toISOString().split("T")[0]);
      setCustomEndDate(todayStr);
    }
  }

  function exportCsv() {
    if (!reportRows.length) return;
    const keys = Object.keys(reportRows[0]);
    const lines = [
      keys.join(","),
      ...reportRows.map((r) =>
        keys.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(",")
      ),
    ];
    const csvContent = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `Fleet_Report_${selectedReport}_${dateBounds.startIstDate || "all"}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const [isResetting, setIsResetting] = useState(false);

  async function handleResetSpeedingAlerts() {
    if (
      !confirm(
        "Are you sure you want to reset all overspeed records? This will delete all safety speeding incidents from the database."
      )
    ) {
      return;
    }
    setIsResetting(true);
    try {
      globalOverspeedManager.reset();
      const { error } = await supabase.from("alerts").delete().eq("type", "Safety");
      if (error) {
        alert("Failed to reset: " + error.message);
      } else {
        setOtherReportRows([]);
        alert("Overspeed records successfully reset.");
      }
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setIsResetting(false);
    }
  }

  const yesterdayStr = getYesterdayIstString();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet Reports & Analytics"
        subtitle="Operational Performance Audits · Exports in CSV & Printable PDF"
        actions={
          <div className="flex items-center gap-2">
            {selectedReport === "daily_activity" && (
              <Button
                onClick={() => {
                  clearGeocodeCache();
                  setRefreshKey((k) => k + 1);
                }}
                className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer"
                title="Force re-resolve vehicle geographical locations from live GPS coordinates"
              >
                <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
                Refresh Locations
              </Button>
            )}
            <Button
              onClick={exportCsv}
              disabled={reportRows.length === 0}
              className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-slate-500" />
              Export CSV
            </Button>
            <Button
              onClick={() => window.print()}
              disabled={reportRows.length === 0}
              className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
            >
              <Printer className="h-3.5 w-3.5 text-slate-500" />
              Print / PDF
            </Button>
          </div>
        }
      />

      {/* Report Selector Pills */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { id: "daily_activity", label: "Daily Vehicle Activity" },
          { id: "route_completion", label: "Route Completion & Stops" },
          { id: "speeding_incidents", label: "Speeding & Safety Incidents" },
          { id: "fuel_efficiency", label: "Fuel Consumption & Mileage" },
          { id: "maintenance_costs", label: "Maintenance & Repair Costs" },
        ].map((r) => (
          <button
            key={r.id}
            onClick={() => setSelectedReport(r.id as ReportType)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              selectedReport === r.id
                ? "bg-indigo-600 text-white shadow-xs"
                : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Date-Wise Filter Bar */}
      <Card className="border border-slate-200/80 p-3.5 shadow-xs flex flex-col gap-3 text-xs bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 font-medium">Period:</span>
            <div className="bg-slate-100 p-0.5 rounded-lg flex flex-wrap items-center font-semibold">
              {(
                [
                  { id: "today", label: "Today" },
                  { id: "yesterday", label: "Yesterday" },
                  { id: "week", label: "Last 7 Days" },
                  { id: "month", label: "Last 30 Days" },
                  { id: "all", label: "All Time" },
                  { id: "custom", label: "Pick Date" },
                ] as const
              ).map((d) => (
                <button
                  key={d.id}
                  onClick={() => handlePresetDate(d.id)}
                  className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    dateRange === d.id
                      ? "bg-white text-slate-900 shadow-2xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>

            {/* Inline Date-Wise Picker */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg">
              <Calendar className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
              <input
                type="date"
                aria-label="Filter Start Date"
                value={customStartDate}
                max={getTodayIstString()}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  setCustomStartDate(val);
                  // Sync end date for instant single-date filtering when user selects one date
                  setCustomEndDate(val);
                  setDateRange("custom");
                }}
                className="bg-transparent text-slate-800 font-semibold outline-none cursor-pointer text-xs"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                aria-label="Filter End Date"
                value={customEndDate}
                min={customStartDate}
                max={getTodayIstString()}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  setCustomEndDate(val);
                  setDateRange("custom");
                }}
                className="bg-transparent text-slate-800 font-semibold outline-none cursor-pointer text-xs"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-medium">Vehicle:</span>
              <select
                value={selectedVehicle}
                onChange={(e) => setSelectedVehicle(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-800 cursor-pointer"
              >
                <option value="All">All GPS Fleet Vehicles ({vehicles.length || 7})</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.number}>
                    {v.number}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200 text-[11px]">
                {reportRows.length} GPS {reportRows.length === 1 ? "Record" : "Records"}
              </span>
              {selectedReport === "speeding_incidents" && (
                <button
                  type="button"
                  onClick={handleResetSpeedingAlerts}
                  disabled={isResetting || reportRows.length === 0}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-[11px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  title="Reset / Clear all overspeed records from Supabase"
                >
                  <RotateCcw className={`h-3 w-3 ${isResetting ? "animate-spin" : ""}`} />
                  <span>Reset Overspeed History</span>
                </button>
              )}
              <div className="text-slate-400 font-mono text-[11px]">
                IST: {dateBounds.displayLabel}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Daily Vehicle Activity Dashboard KPI Cards */}
      {selectedReport === "daily_activity" && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <span>Fleet Units</span>
              <Truck className="h-3.5 w-3.5 text-indigo-500" />
            </div>
            <div className="text-xl font-extrabold text-slate-900 mt-1">
              {dailySummary.activeVehicles}{" "}
              <span className="text-xs font-semibold text-slate-400">
                / {dailySummary.totalVehicles} active
              </span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {dailySummary.idleVehicles} Idle / Stationary
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <span>Distance Covered</span>
              <Navigation className="h-3.5 w-3.5 text-emerald-500" />
            </div>
            <div className="text-xl font-extrabold text-slate-900 mt-1">
              {dailyTelemetryComputed ? `${dailySummary.totalDistanceKm.toFixed(1)} km` : "Snapshot"}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 truncate" title={dateBounds.displayLabel}>
              {dailyTelemetryComputed ? dateBounds.displayLabel : "Select ≤ 7-day date for GPS km"}
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <span>Trips &amp; Stops</span>
              <Route className="h-3.5 w-3.5 text-blue-500" />
            </div>
            <div className="text-xl font-extrabold text-slate-900 mt-1">
              {dailyTelemetryComputed ? `${dailySummary.totalTrips} Trips` : "Registry"}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {dailyTelemetryComputed
                ? `${dailySummary.totalStopsCount} confirmed stops`
                : `${Object.values(dailyCountsMap).reduce((a, b) => a + b, 0).toLocaleString()} telemetry points`}
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <span>Driving Time</span>
              <Clock className="h-3.5 w-3.5 text-amber-500" />
            </div>
            <div className="text-xl font-extrabold text-slate-900 mt-1">
              {dailyTelemetryComputed ? formatDurationCompact(dailySummary.totalDrivingSeconds) : "-"}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {dailyTelemetryComputed
                ? `Stopped: ${formatDurationCompact(dailySummary.totalStoppedSeconds)}`
                : "Live + DB synchronized"}
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs col-span-2 md:col-span-1">
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <span>Speed Profile</span>
              <Gauge className="h-3.5 w-3.5 text-rose-500" />
            </div>
            <div className="text-xl font-extrabold text-slate-900 mt-1">
              {dailyTelemetryComputed ? `${dailySummary.fleetMaxSpeedKmh} km/h` : "-"}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {dailyTelemetryComputed
                ? `Avg Speed: ${dailySummary.fleetAvgSpeedKmh} km/h`
                : "60 km/h policy threshold"}
            </div>
          </div>
        </div>
      )}

      {/* Helpful 1-click notice when Today has no movement yet or when viewing >7d snapshot */}
      {selectedReport === "daily_activity" && !isLoading && dateRange === "today" && dailySummary.totalDistanceKm === 0 && (
        <div className="bg-amber-50/90 border border-amber-200/90 px-4 py-2.5 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              No road trips recorded today (<strong>{dateBounds.startIstDate}</strong>) yet — all {dailySummary.totalVehicles} GPS vehicles are currently idle.
            </span>
          </div>
          <button
            type="button"
            onClick={() => handlePresetDate("yesterday")}
            className="px-3 py-1 bg-white hover:bg-amber-100 border border-amber-300 text-amber-900 font-semibold rounded-lg text-xs cursor-pointer transition-colors"
          >
            View Yesterday ({yesterdayStr})
          </button>
        </div>
      )}

      {selectedReport === "daily_activity" && !isLoading && !dailyTelemetryComputed && (
        <div className="bg-slate-50 border border-slate-200 px-4 py-2.5 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
          <span>
            Showing live fleet status &amp; telemetry counts for <strong>{dateBounds.displayLabel}</strong>. Select <strong>Today</strong>, <strong>Yesterday</strong>, <strong>Last 7 Days</strong>, or pick any date range (≤ 7 days) for exact GPS distance &amp; trip duration analytics.
          </span>
        </div>
      )}

      {/* Report Table Card */}
      <Card className="border border-slate-200/80 p-5 shadow-xs space-y-4">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-500 text-xs">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
              <span>Computing authentic telemetry report for {dateBounds.displayLabel}...</span>
            </div>
          ) : reportRows.length > 0 ? (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                  {Object.keys(reportRows[0]).map((col) => (
                    <th key={col} className="py-2.5 px-3 capitalize whitespace-nowrap">
                      {col.replace(/([A-Z])/g, " $1")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reportRows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                    {Object.entries(row).map(([colKey, val]: [string, any], cIdx) => (
                      <td key={cIdx} className="py-3 px-3 text-slate-800 font-medium whitespace-nowrap">
                        {colKey === "status" ? (
                          <Badge
                            variant="outline"
                            className={`text-[11px] font-semibold ${getStatusBadgeClass(String(val))}`}
                          >
                            {String(val)}
                          </Badge>
                        ) : colKey === "location" ? (
                          <span className="max-w-[220px] truncate inline-block align-bottom" title={String(val)}>
                            {String(val)}
                          </span>
                        ) : colKey === "vehicle" ? (
                          <span className="font-bold text-slate-900">{String(val)}</span>
                        ) : typeof val === "boolean" ? (
                          val ? "Yes" : "No"
                        ) : (
                          String(val)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="py-12 text-center text-slate-400 text-xs space-y-1">
              <div className="font-semibold text-slate-600">
                No records found for {dateBounds.displayLabel}.
              </div>
              <div className="text-[11px]">
                Try switching the Period filter to &quot;All Time&quot; or selecting a different date.
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
