import { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
  RotateCcw,
  Activity,
  Navigation,
  Search,
  AlertTriangle,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  X,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { globalOverspeedManager } from "@/lib/overspeed";
import { useVehicles } from "@/hooks/useVehicleTracking";
import {
  getImmediateLocationDisplay,
  reverseGeocodeCoordinate,
  getCachedLocation,
  clearGeocodeCache,
  getGeocodeCacheKey,
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
  buildVehicleDailyHistoryRows,
  aggregateDailyActivitySummary,
  filterAndSortReportRows,
  buildReportCsv,
  computeOtherReportInsights,
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

  // Primary report & filter controls
  const [selectedReport, setSelectedReport] = useState<ReportType>("daily_activity");
  const [dateRange, setDateRange] = useState<ReportDateMode>("today");
  const [customStartDate, setCustomStartDate] = useState<string>(() => getTodayIstString());
  const [customEndDate, setCustomEndDate] = useState<string>(() => getTodayIstString());
  const [selectedVehicle, setSelectedVehicle] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Master data & fetched report state
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [rawDailyRows, setRawDailyRows] = useState<DailyActivityMetricsRow[]>([]);
  const [dailyTelemetryComputed, setDailyTelemetryComputed] = useState<boolean>(true);
  const [dailyCountsMap, setDailyCountsMap] = useState<Record<string, number>>({});
  const [otherReportRows, setOtherReportRows] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const dateBounds = useMemo(() => {
    return resolveReportDateBounds(dateRange, customStartDate, customEndDate);
  }, [dateRange, customStartDate, customEndDate]);

  // Reset sort/pagination when switching report tabs
  useEffect(() => {
    setStatusFilter("All");
    setSortKey(null);
    setSortDir("asc");
    setCurrentPage(1);
  }, [selectedReport]);

  useEffect(() => {
    setCurrentPage(1);
  }, [dateBounds, selectedVehicle, statusFilter, searchQuery, pageSize]);

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

  // Deduplicated background geocoder for a list of DailyActivityMetricsRow coordinates
  const resolveCoordinatesInBackground = useCallback(
    (rows: DailyActivityMetricsRow[], isCancelled: () => boolean) => {
      const uniqueCoords = new Map<string, { lat: number; lng: number }>();
      for (const r of rows) {
        if (r.coordLat != null && r.coordLng != null && !getCachedLocation(r.coordLat, r.coordLng)) {
          uniqueCoords.set(getGeocodeCacheKey(r.coordLat, r.coordLng), {
            lat: r.coordLat,
            lng: r.coordLng,
          });
        }
        if (r.startLat != null && r.startLng != null && !getCachedLocation(r.startLat, r.startLng)) {
          uniqueCoords.set(getGeocodeCacheKey(r.startLat, r.startLng), {
            lat: r.startLat,
            lng: r.startLng,
          });
        }
      }

      if (uniqueCoords.size === 0) return;

      Promise.all(
        Array.from(uniqueCoords.entries()).map(async ([key, coord]) => {
          const fallback = `${coord.lat.toFixed(4)}, ${coord.lng.toFixed(4)}`;
          const placeName = await reverseGeocodeCoordinate(coord.lat, coord.lng, fallback);
          return { key, placeName };
        })
      )
        .then((resolved) => {
          if (isCancelled()) return;
          const byKey = new Map<string, string>();
          resolved.forEach((item) => {
            if (item?.placeName) byKey.set(item.key, item.placeName);
          });
          if (byKey.size === 0) return;

          setRawDailyRows((prev) =>
            prev.map((row) => {
              let nextLoc = row.location;
              let nextStartLoc = row.startLocation;
              if (row.coordLat != null && row.coordLng != null) {
                const k = getGeocodeCacheKey(row.coordLat, row.coordLng);
                if (byKey.has(k)) nextLoc = byKey.get(k)!;
              }
              if (row.startLat != null && row.startLng != null) {
                const sk = getGeocodeCacheKey(row.startLat, row.startLng);
                if (byKey.has(sk)) nextStartLoc = byKey.get(sk)!;
              }
              return nextLoc !== row.location || nextStartLoc !== row.startLocation
                ? { ...row, location: nextLoc, startLocation: nextStartLoc }
                : row;
            })
          );
        })
        .catch((err) => console.warn("[Reports] Geocode notice:", err));
    },
    []
  );

  // Fetch report data based on selectedReport, IST dateBounds, and selectedVehicle
  useEffect(() => {
    let cancelled = false;
    const abortCtrl = new AbortController();

    async function fetchReportData() {
      setIsLoading(true);
      setFetchError(null);

      try {
        if (selectedReport === "daily_activity") {
          let targetFleet = vehicles;
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

          const filteredFleet =
            selectedVehicle !== "All"
              ? targetFleet.filter((v) => v.number === selectedVehicle)
              : targetFleet;

          const isSingleVehicle = selectedVehicle !== "All";
          // Always fetch complete historical telemetry for both single-vehicle and all-vehicle views
          // (including Last 30 Days & All Time) so old & new daily activity rows always appear.
          const canComputeFullTelemetry = true;

          setDailyTelemetryComputed(canComputeFullTelemetry);

          if (canComputeFullTelemetry) {
            const queryStartIso = dateBounds.startUtcIso || "2020-01-01T00:00:00.000Z";
            const queryEndIso = dateBounds.endUtcIso || new Date().toISOString();

            const perVehicleData = await Promise.all(
              filteredFleet.map(async (v) => {
                if (!isValidUuid(v.id)) {
                  return { vehicle: v, points: [], error: null as string | null };
                }
                const res = await fetchPaginatedTelemetryHistory(
                  supabase,
                  v.id,
                  queryStartIso,
                  queryEndIso,
                  1000,
                  undefined,
                  abortCtrl.signal
                );
                return { vehicle: v, points: res.data || [], error: res.error || null };
              })
            );
            if (cancelled) return;

            const firstErr = perVehicleData.find((p) => p.error && p.error !== "Fetch cancelled by user")?.error;
            if (firstErr) {
              setFetchError(`Telemetry query warning: ${firstErr}`);
            }

            const expandByDay = isSingleVehicle || dateBounds.isAllTime || dateBounds.daySpan > 1;
            const builtRows: DailyActivityMetricsRow[] = [];

            for (const { vehicle, points } of perVehicleData) {
              const liveMatch =
                liveVehiclesRef.current.find(
                  (lv) =>
                    lv.id === vehicle.id ||
                    lv.number?.replace(/\s+/g, "").toUpperCase() ===
                      vehicle.number?.replace(/\s+/g, "").toUpperCase()
                ) || null;

              if (expandByDay) {
                const dayRows = buildVehicleDailyHistoryRows({
                  vehicle,
                  liveVehicle: liveMatch,
                  points,
                  assignments,
                  drivers,
                  bounds: dateBounds,
                });
                builtRows.push(...dayRows);
              } else {
                builtRows.push(
                  buildDailyActivityRow({
                    vehicle,
                    liveVehicle: liveMatch,
                    points,
                    assignments,
                    drivers,
                    bounds: dateBounds,
                    telemetryComputed: true,
                    activityDate: dateBounds.startIstDate,
                  })
                );
              }
            }

            // Default sort: newest date first, then vehicle registration
            builtRows.sort((a, b) =>
              a.activityDate !== b.activityDate
                ? b.activityDate.localeCompare(a.activityDate)
                : a.vehicle.localeCompare(b.vehicle)
            );

            setRawDailyRows(builtRows);
            setDailyCountsMap({});
            resolveCoordinatesInBackground(builtRows, () => cancelled);
          } else {
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

                const { data, count, error } = await q;
                if (error && !cancelled) {
                  setFetchError(error.message);
                }
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
            resolveCoordinatesInBackground(builtRows, () => cancelled);
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
      } catch (err: any) {
        if (!abortCtrl.signal.aborted && !cancelled) {
          console.warn("Failed to fetch report backend data:", err);
          setFetchError(err?.message || "Failed to load report data from backend.");
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
  }, [
    selectedReport,
    dateBounds,
    selectedVehicle,
    refreshKey,
    vehicles,
    drivers,
    assignments,
    resolveCoordinatesInBackground,
  ]);

  // Synchronize today's live status / odometer / location with Firebase live stream without overwriting old days
  const enrichedDailyRows = useMemo(() => {
    const todayIst = getTodayIstString();
    const isLiveCandidate =
      dateBounds.mode === "today" ||
      dateBounds.isAllTime ||
      dateBounds.endIstDate >= todayIst ||
      !dailyTelemetryComputed;
    if (!isLiveCandidate) return rawDailyRows;

    return rawDailyRows.map((row) => {
      if (dailyTelemetryComputed && row.activityDate !== todayIst) {
        return row;
      }
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
        coordLat: row.coordLat ?? (liveCoord ? liveCoord.lat : null),
        coordLng: row.coordLng ?? (liveCoord ? liveCoord.lng : null),
        lastReported: updatedLastReported,
        lastReportedMs: Math.max(row.lastReportedMs, liveLastMs || 0),
      };
    });
  }, [rawDailyRows, liveVehicleByKey, dateBounds.isAllTime, dateBounds.mode]);

  // Filter Daily Activity rich rows so KPIs, charts, map inspector, and table stay strictly synchronized
  const filteredDailyRichRows = useMemo(() => {
    return filterAndSortReportRows(enrichedDailyRows, {
      searchQuery,
      statusFilter,
    });
  }, [enrichedDailyRows, searchQuery, statusFilter]);

  const dailySummary = useMemo(
    () => aggregateDailyActivitySummary(filteredDailyRichRows),
    [filteredDailyRichRows]
  );

  const earliestDailyDate = useMemo(() => {
    let minDate = "";
    for (const r of enrichedDailyRows) {
      if (r.activityDate && (!minDate || r.activityDate < minDate)) {
        minDate = r.activityDate;
      }
    }
    return minDate;
  }, [enrichedDailyRows]);

  // Build Daily Activity charts strictly from filtered rows
  const dailyChartData = useMemo(() => {
    if (selectedVehicle !== "All") {
      // Single vehicle across days: plot one bar per date chronologically (old -> new)
      return [...filteredDailyRichRows]
        .sort((a, b) => a.activityDate.localeCompare(b.activityDate))
        .map((r) => ({
          vehicleId: r.vehicleId,
          name: r.activityDate.slice(5), // MM-DD
          fullVehicle: `${r.vehicle} (${r.activityDate})`,
          rawVehicle: r.vehicle,
          distanceKm: r.distanceKmNum,
          drivingMins: Math.round(r.drivingSeconds / 60),
          idlingMins: Math.round(r.idlingSeconds / 60),
          parkedMins: Math.round(r.parkedSeconds / 60),
        }));
    }

    // All vehicles: aggregate across days in period so each vehicle has one clean bar
    const byVehicle = new Map<
      string,
      {
        vehicleId: string;
        name: string;
        fullVehicle: string;
        rawVehicle: string;
        distanceKm: number;
        drivingMins: number;
        idlingMins: number;
        parkedMins: number;
      }
    >();

    for (const r of filteredDailyRichRows) {
      const existing = byVehicle.get(r.vehicleId);
      if (existing) {
        existing.distanceKm = Math.round((existing.distanceKm + r.distanceKmNum) * 10) / 10;
        existing.drivingMins += Math.round(r.drivingSeconds / 60);
        existing.idlingMins += Math.round(r.idlingSeconds / 60);
        existing.parkedMins += Math.round(r.parkedSeconds / 60);
      } else {
        byVehicle.set(r.vehicleId, {
          vehicleId: r.vehicleId,
          name: r.vehicle.replace(/^TN\s+75\s+/i, ""),
          fullVehicle: r.vehicle,
          rawVehicle: r.vehicle,
          distanceKm: r.distanceKmNum,
          drivingMins: Math.round(r.drivingSeconds / 60),
          idlingMins: Math.round(r.idlingSeconds / 60),
          parkedMins: Math.round(r.parkedSeconds / 60),
        });
      }
    }

    return Array.from(byVehicle.values());
  }, [filteredDailyRichRows, selectedVehicle]);

  // Format clean table rows & apply search/status/sort/pagination consistently
  const baseTableRows = useMemo(() => {
    if (selectedReport !== "daily_activity") {
      return otherReportRows;
    }

    if (dailyTelemetryComputed) {
      return enrichedDailyRows.map((r) => ({
        date: r.activityDate,
        vehicle: r.vehicle,
        driver: r.driver,
        model: r.model,
        distanceKm: r.distanceKm,
        trips: r.tripsCount,
        drivingTime: r.drivingTime,
        idlingTime: r.idlingTime,
        parkedTime: r.parkedTime,
        avgMaxSpeed: r.speedSummary,
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

  const filteredAndSortedRows = useMemo(() => {
    return filterAndSortReportRows(baseTableRows, {
      searchQuery,
      statusFilter,
      sortKey,
      sortDir,
    });
  }, [baseTableRows, searchQuery, statusFilter, sortKey, sortDir]);

  const otherReportInsights = useMemo(() => {
    if (selectedReport === "daily_activity") return null;
    return computeOtherReportInsights(selectedReport, filteredAndSortedRows);
  }, [selectedReport, filteredAndSortedRows]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredAndSortedRows.slice(start, start + pageSize);
  }, [filteredAndSortedRows, safePage, pageSize]);

  // Status dropdown options tailored to active report
  const statusOptions = useMemo(() => {
    if (selectedReport === "daily_activity") {
      return ["All", "Active", "Idle", "Parked", "No Telemetry"];
    }
    const set = new Set<string>(["All"]);
    baseTableRows.forEach((r) => {
      if (r.status) set.add(String(r.status));
    });
    return Array.from(set);
  }, [selectedReport, baseTableRows]);

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
    } else if (mode === "all") {
      setCustomEndDate(todayStr);
    }
  }

  function handleResetFilters() {
    handlePresetDate("today");
    setSelectedVehicle("All");
    setStatusFilter("All");
    setSearchQuery("");
    setSortKey(null);
    setSortDir("asc");
    setCurrentPage(1);
  }

  function handleSortColumn(colKey: string) {
    if (sortKey === colKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(colKey);
      setSortDir("asc");
    }
  }

  function handleDrillDownToVehicleActivity(vehicleNumber: string) {
    if (!vehicleNumber || vehicleNumber === "Unassigned" || vehicleNumber === "Fleet Unit") return;
    setSelectedVehicle(vehicleNumber);
    setSelectedReport("daily_activity");
    setStatusFilter("All");
    setSearchQuery("");
  }

  function exportCsv() {
    if (!filteredAndSortedRows.length) return;
    const csvContent = buildReportCsv(filteredAndSortedRows);
    if (!csvContent) return;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateSuffix = dateBounds.isAllTime
      ? "all_time"
      : dateBounds.startIstDate === dateBounds.endIstDate
      ? dateBounds.startIstDate
      : `${dateBounds.startIstDate}_to_${dateBounds.endIstDate}`;
    const vehSuffix =
      selectedVehicle !== "All" ? `_${selectedVehicle.replace(/\s+/g, "")}` : "";
    link.href = url;
    link.setAttribute("download", `Fleet_Report_${selectedReport}_${dateSuffix}${vehSuffix}.csv`);
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
  const hasActiveFilters =
    selectedVehicle !== "All" ||
    statusFilter !== "All" ||
    searchQuery.trim().length > 0 ||
    dateRange !== "today";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fleet Reports & Analytics"
        subtitle={`Operational Performance Audits · ${dateBounds.displayLabel} · Exports in CSV & Printable PDF`}
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
              disabled={filteredAndSortedRows.length === 0}
              className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-slate-500" />
              Export CSV ({filteredAndSortedRows.length})
            </Button>
            <Button
              onClick={() => window.print()}
              disabled={filteredAndSortedRows.length === 0}
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

      {/* Unified Date-Wise, Search & Status Filter Bar */}
      <Card className="border border-slate-200/80 p-3.5 shadow-xs flex flex-col gap-3 text-xs bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Date presets + inline calendar picker */}
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

            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg">
              <Calendar className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
              <input
                type="date"
                aria-label="Filter Start Date"
                value={dateRange === "all" && earliestDailyDate ? earliestDailyDate : customStartDate}
                max={getTodayIstString()}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  setCustomStartDate(val);
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

          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200 text-[11px]">
              {filteredAndSortedRows.length} {filteredAndSortedRows.length === 1 ? "Record" : "Records"}
            </span>
            {selectedReport === "speeding_incidents" && (
              <button
                type="button"
                onClick={handleResetSpeedingAlerts}
                disabled={isResetting || filteredAndSortedRows.length === 0}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-[11px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                title="Reset / Clear all overspeed records from Supabase"
              >
                <RotateCcw className={`h-3 w-3 ${isResetting ? "animate-spin" : ""}`} />
                <span>Reset Overspeed History</span>
              </button>
            )}
            <div className="text-slate-400 font-mono text-[11px]">IST: {dateBounds.displayLabel}</div>
          </div>
        </div>

        {/* Second Filter Row: Vehicle, Status, Search & Reset */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2.5">
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

            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-medium">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-800 cursor-pointer"
              >
                {statusOptions.map((st) => (
                  <option key={st} value={st}>
                    {st === "All" ? "All Statuses" : st}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 flex-1 sm:flex-initial justify-end">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 min-w-[200px] sm:w-64">
              <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search vehicle, driver, location..."
                className="bg-transparent outline-none text-xs text-slate-800 w-full"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="text-slate-400 hover:text-slate-700 cursor-pointer"
                  aria-label="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="h-3 w-3 text-slate-500" />
                Reset Filters
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* API Error Banner with Retry */}
      {fetchError && (
        <div className="bg-red-50 border border-red-200 px-4 py-2.5 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-xs text-red-900">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
            <span>{fetchError}</span>
          </div>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="px-3 py-1 bg-white hover:bg-red-100 border border-red-300 text-red-800 font-semibold rounded-lg cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading Skeletons or KPIs + Charts */}
      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-white border border-slate-200/80 p-3.5 rounded-2xl animate-pulse space-y-2">
                <div className="h-3 w-20 bg-slate-200 rounded" />
                <div className="h-6 w-24 bg-slate-200 rounded" />
                <div className="h-3 w-28 bg-slate-100 rounded" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Daily Vehicle Activity KPI Cards */}
          {selectedReport === "daily_activity" && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
                <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  <span>{selectedVehicle !== "All" && dailyTelemetryComputed ? "Days Logged" : "Fleet Units"}</span>
                  <Truck className="h-3.5 w-3.5 text-indigo-500" />
                </div>
                <div className="text-xl font-extrabold text-slate-900 mt-1">
                  {selectedVehicle !== "All" && dailyTelemetryComputed ? (
                    <>
                      {dailySummary.activeDays}{" "}
                      <span className="text-xs font-semibold text-slate-400">
                        / {dailySummary.totalDays} days active
                      </span>
                    </>
                  ) : (
                    <>
                      {dailySummary.activeVehicles}{" "}
                      <span className="text-xs font-semibold text-slate-400">
                        / {dailySummary.totalVehicles} active
                      </span>
                    </>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {selectedVehicle !== "All" && dailyTelemetryComputed
                    ? `${Math.max(0, dailySummary.totalDays - dailySummary.activeDays)} Stationary days`
                    : dailySummary.totalDays > 1
                    ? `${dailySummary.idleVehicles} inactive · ${dailySummary.totalDays} days logged`
                    : `${dailySummary.idleVehicles} Idle / Stationary`}
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
                  <span>Time Breakdown</span>
                  <Clock className="h-3.5 w-3.5 text-amber-500" />
                </div>
                <div className="text-xl font-extrabold text-slate-900 mt-1">
                  {dailyTelemetryComputed ? formatDurationCompact(dailySummary.totalDrivingSeconds) : "-"}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                  {dailyTelemetryComputed
                    ? `Idle: ${formatDurationCompact(dailySummary.totalIdlingSeconds)} · Park: ${formatDurationCompact(dailySummary.totalParkedSeconds)}`
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

          {/* Other Report Tabs KPI Strip */}
          {selectedReport !== "daily_activity" && otherReportInsights && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {otherReportInsights.kpis.map((kpi) => (
                <div key={kpi.label} className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    {kpi.label}
                  </div>
                  <div className="text-xl font-extrabold text-slate-900 mt-1">{kpi.value}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{kpi.hint}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Quick shortcut when Today has 0 km or snapshot banner for >7d */}
      {selectedReport === "daily_activity" &&
        !isLoading &&
        dateRange === "today" &&
        dailySummary.totalDistanceKm === 0 && (
          <div className="bg-amber-50/90 border border-amber-200/90 px-4 py-2.5 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-amber-600 shrink-0" />
              <span>
                No road trips recorded today (<strong>{dateBounds.startIstDate}</strong>) yet — all{" "}
                {dailySummary.totalVehicles} GPS vehicles are currently idle.
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
            Showing live fleet status &amp; telemetry counts for <strong>{dateBounds.displayLabel}</strong>. Select{" "}
            any single vehicle above to inspect all of its old &amp; new daily reports one by one, or choose{" "}
            <strong>Today</strong>, <strong>Yesterday</strong>, or <strong>Last 7 Days</strong> for exact GPS distance and driving/idling breakdown.
          </span>
        </div>
      )}

      {/* Responsive Visualizations */}
      {!isLoading && selectedReport === "daily_activity" && dailyTelemetryComputed && dailyChartData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="border border-slate-200/80 p-4 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-indigo-600" />
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  {selectedVehicle !== "All"
                    ? `Daily Distance Covered · ${selectedVehicle} (km)`
                    : "Distance Travelled by Vehicle (km)"}
                </h3>
              </div>
              <span className="text-[11px] text-slate-400">
                {selectedVehicle !== "All" ? "Day-by-day chronological" : "Click a bar to filter vehicle"}
              </span>
            </div>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyChartData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#475569" }} unit=" km" />
                  <Tooltip
                    formatter={(val: any) => [`${Number(val).toFixed(1)} km`, "Distance"]}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.fullVehicle || ""}
                  />
                  <Bar
                    dataKey="distanceKm"
                    fill="#4F46E5"
                    radius={[6, 6, 0, 0]}
                    className={selectedVehicle === "All" ? "cursor-pointer" : ""}
                    onClick={(entry: any) => {
                      if (selectedVehicle === "All" && entry?.rawVehicle) {
                        setSelectedVehicle(entry.rawVehicle);
                      }
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="border border-slate-200/80 p-4 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-600" />
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Driving vs Idling vs Parked (Minutes)
                </h3>
              </div>
              <span className="text-[11px] text-slate-400">{dateBounds.displayLabel}</span>
            </div>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyChartData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#475569" }} unit="m" />
                  <Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.fullVehicle || ""} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar dataKey="drivingMins" name="Driving (m)" stackId="time" fill="#10B981" />
                  <Bar dataKey="idlingMins" name="Idling (m)" stackId="time" fill="#F59E0B" />
                  <Bar dataKey="parkedMins" name="Parked (m)" stackId="time" fill="#64748B" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {!isLoading && selectedReport !== "daily_activity" && otherReportInsights && otherReportInsights.chartData.length > 0 && (
        <Card className="border border-slate-200/80 p-4 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-indigo-600" />
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                {otherReportInsights.chartTitle}
              </h3>
            </div>
            <span className="text-[11px] text-slate-400">Filtered dataset</span>
          </div>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={otherReportInsights.chartData} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} />
                <YAxis tick={{ fontSize: 11, fill: "#475569" }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Bar
                  dataKey="primary"
                  name={otherReportInsights.chartData[0]?.primaryLabel || "Primary"}
                  fill="#4F46E5"
                  radius={[6, 6, 0, 0]}
                />
                {otherReportInsights.chartData[0]?.secondaryLabel && (
                  <Bar
                    dataKey="secondary"
                    name={otherReportInsights.chartData[0].secondaryLabel}
                    fill="#10B981"
                    radius={[6, 6, 0, 0]}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Sortable, Searchable, Paginated Report Table Card */}
      <Card className="border border-slate-200/80 p-5 shadow-xs space-y-4">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="space-y-2.5 py-2">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="h-9 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : paginatedRows.length > 0 ? (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                  {Object.keys(paginatedRows[0]).map((col) => (
                    <th
                      key={col}
                      onClick={() => handleSortColumn(col)}
                      className="py-2.5 px-3 capitalize whitespace-nowrap cursor-pointer select-none hover:text-slate-700 transition-colors"
                    >
                      <span className="inline-flex items-center gap-1">
                        <span>{col.replace(/([A-Z])/g, " $1")}</span>
                        <ArrowUpDown className="h-3 w-3 opacity-60" />
                        {sortKey === col && (
                          <span className="text-indigo-600 font-bold">
                            {sortDir === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                      </span>
                    </th>
                  ))}
                  {selectedReport !== "daily_activity" && (
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Drill-Down</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedRows.map((row, idx) => (
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
                      {selectedReport !== "daily_activity" && (
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDrillDownToVehicleActivity(String(row.vehicle));
                            }}
                            className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-md border border-indigo-200 cursor-pointer"
                          >
                            Daily Activity →
                          </button>
                        </td>
                      )}
                    </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="py-12 text-center text-slate-400 text-xs space-y-2">
              <div className="font-semibold text-slate-600">
                No records found for {dateBounds.displayLabel}.
              </div>
              <div className="text-[11px]">
                Try resetting search/status filters or switching the date period.
              </div>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="px-3 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs cursor-pointer"
                >
                  Reset Filters
                </button>
              )}
            </div>
          )}
        </div>

        {/* Pagination Controls */}
        {!isLoading && filteredAndSortedRows.length > 0 && (
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <span>
                Showing {(safePage - 1) * pageSize + 1}–
                {Math.min(safePage * pageSize, filteredAndSortedRows.length)} of{" "}
                {filteredAndSortedRows.length} rows
              </span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="px-2 py-1 rounded border border-slate-200 bg-white text-slate-700 font-medium cursor-pointer"
                aria-label="Rows per page"
              >
                {[10, 25, 50].map((sz) => (
                  <option key={sz} value={sz}>
                    {sz} / page
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer flex items-center gap-1"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </button>
              <span className="px-2 font-semibold text-slate-700">
                Page {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer flex items-center gap-1"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
