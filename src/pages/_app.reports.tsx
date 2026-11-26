import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
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
  ClipboardList,
  History,
  Eye,
  Fuel,
  CheckCircle2,
  UserCheck,
  UsersRound,
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
import {
  type RawOperationTripRow,
  type FormattedOperationStatementRow,
  type AllVehicleOperationSummaryRow,
  formatOperationStatementRows,
  aggregateOperationReportKpis,
  buildOperationVehicleChartData,
  buildOperationReportCsv,
  buildAllVehiclesOperationSummary,
  buildAllVehiclesOperationCsv,
} from "@/lib/operationReport";
import {
  type RawShiftRow,
  type FormattedAttendanceRow,
  type FormattedTripRouteHistoryRow,
  computeAttendanceOverviewKpis,
  buildDriverAttendanceRows,
  buildDriverTripRouteHistoryRows,
  buildDetailedDriverHistory,
  buildAttendanceCsv,
  buildTripRouteHistoryCsv,
} from "@/lib/driverAttendanceReports";
import { fetchAssignmentsWithFallback } from "@/lib/driverRouteAssignments";
import { DetailedDriverHistoryModal } from "@/components/DetailedDriverHistoryModal";

type ReportType =
  | "daily_activity"
  | "operation_management"
  | "driver_attendance"
  | "trip_route_history"
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
  const [searchParams] = useSearchParams();
  const liveVehicles = useVehicles();
  const liveVehiclesRef = useRef(liveVehicles);
  liveVehiclesRef.current = liveVehicles;

  // Primary report & filter controls
  const [selectedReport, setSelectedReport] = useState<ReportType>(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "operation_management" || tabParam === "operation") {
      return "operation_management";
    }
    if (tabParam === "driver_attendance" || tabParam === "attendance") {
      return "driver_attendance";
    }
    if (tabParam === "trip_route_history" || tabParam === "route_history") {
      return "trip_route_history";
    }
    return "daily_activity";
  });
  const [dateRange, setDateRange] = useState<ReportDateMode>("today");
  const [customStartDate, setCustomStartDate] = useState<string>(() => getTodayIstString());
  const [customEndDate, setCustomEndDate] = useState<string>(() => getTodayIstString());
  const [selectedVehicle, setSelectedVehicle] = useState("All");
  const [selectedDriverFilter, setSelectedDriverFilter] = useState("All");
  const [selectedRouteFilter, setSelectedRouteFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Driver Attendance & Trip/Route History state
  const [collectionRoutesList, setCollectionRoutesList] = useState<any[]>([]);
  const [rawShifts, setRawShifts] = useState<RawShiftRow[]>([]);
  const [rawTripsAll, setRawTripsAll] = useState<any[]>([]);
  const [inspectDriverId, setInspectDriverId] = useState<string | null>(null);

  // Operation Management Report sub-state
  const [operationSubView, setOperationSubView] = useState<"vehicles" | "statements" | "audit">("vehicles");
  const [operationRawTrips, setOperationRawTrips] = useState<RawOperationTripRow[]>([]);
  const [operationAuditLogs, setOperationAuditLogs] = useState<any[]>([]);
  const [operationAuditMissing, setOperationAuditMissing] = useState(false);
  const [inspectStatementRow, setInspectStatementRow] = useState<FormattedOperationStatementRow | null>(null);

  // Master data & fetched report state
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [allFleetVehicles, setAllFleetVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const assignmentsRef = useRef<any[]>([]);
  assignmentsRef.current = assignments;
  const [rawDailyRows, setRawDailyRows] = useState<DailyActivityMetricsRow[]>([]);
  const [dailyTelemetryComputed, setDailyTelemetryComputed] = useState<boolean>(true);
  const [dailyCountsMap, setDailyCountsMap] = useState<Record<string, number>>({});
  const [otherReportRows, setOtherReportRows] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const dateBounds = useMemo(() => {
    const isDriverAuditTab =
      selectedReport === "driver_attendance" || selectedReport === "trip_route_history";
    if (isDriverAuditTab && (dateRange === "week" || dateRange === "month")) {
      const todayStr = getTodayIstString();
      const [y, m, d] = todayStr.split("-").map(Number);
      if (dateRange === "week") {
        const dt = new Date(Date.UTC(y, m - 1, d));
        const dow = dt.getUTCDay();
        const diffToMon = dow === 0 ? 6 : dow - 1;
        dt.setUTCDate(dt.getUTCDate() - diffToMon);
        return resolveReportDateBounds("custom", dt.toISOString().slice(0, 10), todayStr);
      }
      const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
      return resolveReportDateBounds("custom", monthStart, todayStr);
    }
    return resolveReportDateBounds(dateRange, customStartDate, customEndDate);
  }, [selectedReport, dateRange, customStartDate, customEndDate]);

  // Reset sort/pagination when switching report tabs (keep Operation Management strictly on All Vehicles)
  useEffect(() => {
    setStatusFilter("All");
    setSelectedDriverFilter("All");
    setSelectedRouteFilter("All");
    if (selectedReport === "operation_management") {
      setSelectedVehicle("All");
      setOperationSubView("vehicles");
    }
    setSortKey(null);
    setSortDir("asc");
    setCurrentPage(1);
  }, [selectedReport]);

  useEffect(() => {
    setCurrentPage(1);
  }, [dateBounds, selectedVehicle, selectedDriverFilter, selectedRouteFilter, statusFilter, searchQuery, pageSize, operationSubView]);

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

  // Load registered vehicles (both GPS units and complete fleet roster), drivers, and assignments
  useEffect(() => {
    let cancelled = false;
    async function loadMetadata() {
      const [vRes, dRes, aRes, rRes] = await Promise.all([
        supabase
          .from("v_vehicles")
          .select("id, number, driver_name, type, model, route, odometer, status, location, lat, lng, last_update, device_id")
          .order("number"),
        supabase.from("drivers").select("id, name, phone, license, profile_id").order("name"),
        fetchAssignmentsWithFallback(supabase),
        supabase.from("collection_routes").select("*").order("name"),
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
        const allSorted = [...vRes.data].sort((a: any, b: any) =>
          (a.number || "").localeCompare(b.number || "")
        );
        setAllFleetVehicles(allSorted);

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
      if (dRes.data) {
        const dMap = new Map<string, any>();
        dRes.data.forEach((d: any) => {
          const k = (d.name || d.id).trim().toLowerCase();
          if (!dMap.has(k) || (d.profile_id && !dMap.get(k).profile_id)) {
            dMap.set(k, d);
          }
        });
        setDrivers(Array.from(dMap.values()));
      }
      if (aRes.data) setAssignments(aRes.data);
      if (rRes.data) setCollectionRoutesList(rRes.data);
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
                  assignments: assignmentsRef.current,
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
                    assignments: assignmentsRef.current,
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
                assignments: assignmentsRef.current,
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
        } else if (selectedReport === "operation_management") {
          const [tRes, aRes] = await Promise.all([
            supabase
              .from("trips")
              .select("*, vehicles(id, number, device_id, odometer, route), drivers(id, name)")
              .order("date", { ascending: false })
              .order("created_at", { ascending: false }),
            supabase
              .from("odometer_audit_logs")
              .select("*, vehicles(number), drivers(name)")
              .order("created_at", { ascending: false })
              .limit(200),
          ]);
          if (cancelled) return;
          if (tRes.error) throw tRes.error;

          setOperationRawTrips((tRes.data || []) as RawOperationTripRow[]);
          if (aRes.error) {
            const msg = aRes.error.message || "";
            if (msg.includes("odometer_audit_logs") || aRes.error.code === "PGRST205") {
              setOperationAuditMissing(true);
            }
            setOperationAuditLogs([]);
          } else {
            setOperationAuditMissing(false);
            setOperationAuditLogs(aRes.data || []);
          }
        } else if (
          selectedReport === "driver_attendance" ||
          selectedReport === "trip_route_history"
        ) {
          const [shRes, trRes, asgRes] = await Promise.all([
            supabase
              .from("driver_shifts")
              .select("*")
              .order("started_at", { ascending: false })
              .limit(1000),
            supabase
              .from("trips")
              .select("*, vehicles(id, number, route, odometer), drivers(id, name)")
              .order("date", { ascending: false })
              .order("created_at", { ascending: false })
              .limit(1000),
            fetchAssignmentsWithFallback(supabase),
          ]);
          if (cancelled) return;
          if (shRes.error) throw shRes.error;
          if (trRes.error) throw trRes.error;

          setRawShifts((shRes.data || []) as RawShiftRow[]);
          setRawTripsAll(trRes.data || []);
          if (asgRes.data) setAssignments(asgRes.data);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => {
        if (
          !cancelled &&
          (selectedReport === "operation_management" ||
            selectedReport === "driver_attendance" ||
            selectedReport === "trip_route_history")
        ) {
          fetchReportData();
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_shifts" }, () => {
        if (
          !cancelled &&
          (selectedReport === "driver_attendance" || selectedReport === "trip_route_history")
        ) {
          fetchReportData();
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicle_assignments" }, () => {
        if (
          !cancelled &&
          (selectedReport === "driver_attendance" || selectedReport === "trip_route_history")
        ) {
          fetchReportData();
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "odometer_audit_logs" }, () => {
        if (!cancelled && selectedReport === "operation_management") fetchReportData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, () => {
        if (!cancelled && (selectedReport === "daily_activity" || selectedReport === "operation_management")) {
          fetchReportData();
        }
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

  const operationFormattedRows = useMemo(() => {
    if (selectedReport !== "operation_management") return [];
    return formatOperationStatementRows(operationRawTrips, dateBounds, {
      driverName: selectedDriverFilter,
    });
  }, [selectedReport, operationRawTrips, dateBounds, selectedDriverFilter]);

  const operationFilteredStatements = useMemo(() => {
    return filterAndSortReportRows(operationFormattedRows, {
      searchQuery,
      statusFilter: operationSubView === "statements" ? statusFilter : "All",
      sortKey,
      sortDir,
    });
  }, [operationFormattedRows, operationSubView, searchQuery, statusFilter, sortKey, sortDir]);

  const operationAllVehiclesRows = useMemo(() => {
    if (selectedReport !== "operation_management") return [];
    return buildAllVehiclesOperationSummary(allFleetVehicles, operationFormattedRows);
  }, [selectedReport, allFleetVehicles, operationFormattedRows]);

  const operationFilteredVehicles = useMemo(() => {
    return filterAndSortReportRows(operationAllVehiclesRows, {
      searchQuery,
      statusFilter: operationSubView === "vehicles" ? statusFilter : "All",
      sortKey,
      sortDir,
    });
  }, [operationAllVehiclesRows, operationSubView, searchQuery, statusFilter, sortKey, sortDir]);

  const operationKpis = useMemo(
    () => aggregateOperationReportKpis(operationFilteredStatements),
    [operationFilteredStatements]
  );

  const operationChartData = useMemo(
    () => buildOperationVehicleChartData(operationFilteredStatements),
    [operationFilteredStatements]
  );

  const operationFilteredAuditLogs = useMemo(() => {
    return operationAuditLogs.filter((log) => {
      if (selectedDriverFilter !== "All" && log.drivers?.name !== selectedDriverFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const text = `${log.vehicles?.number || ""} ${log.drivers?.name || ""} ${log.source || ""} ${log.notes || ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [operationAuditLogs, selectedDriverFilter, searchQuery]);

  const attendanceOverviewKpis = useMemo(
    () => computeAttendanceOverviewKpis(drivers, rawShifts, getTodayIstString()),
    [drivers, rawShifts]
  );

  const attendanceRows = useMemo(() => {
    if (selectedReport !== "driver_attendance") return [];
    const selectedVehObj =
      selectedVehicle !== "All"
        ? allFleetVehicles.find((v) => v.number === selectedVehicle)
        : null;
    const rows = buildDriverAttendanceRows(
      drivers,
      rawShifts,
      allFleetVehicles,
      collectionRoutesList,
      assignments,
      dateBounds,
      {
        driverId: selectedDriverFilter,
        vehicleId: selectedVehObj?.id || "All",
        routeId: selectedRouteFilter,
        statusFilter,
        includeNotClockedIn: false,
      }
    );
    return filterAndSortReportRows(rows, {
      searchQuery,
      sortKey,
      sortDir,
    });
  }, [
    selectedReport,
    drivers,
    rawShifts,
    allFleetVehicles,
    collectionRoutesList,
    assignments,
    dateBounds,
    selectedDriverFilter,
    selectedVehicle,
    selectedRouteFilter,
    statusFilter,
    searchQuery,
    sortKey,
    sortDir,
  ]);

  const tripRouteHistoryRows = useMemo(() => {
    if (selectedReport !== "trip_route_history") return [];
    const selectedVehObj =
      selectedVehicle !== "All"
        ? allFleetVehicles.find((v) => v.number === selectedVehicle)
        : null;
    const rows = buildDriverTripRouteHistoryRows(
      rawTripsAll,
      drivers,
      allFleetVehicles,
      collectionRoutesList,
      dateBounds,
      {
        driverId: selectedDriverFilter,
        vehicleId: selectedVehObj?.id || "All",
        routeId: selectedRouteFilter,
        tripStatus: statusFilter,
      }
    );
    return filterAndSortReportRows(rows, {
      searchQuery,
      sortKey,
      sortDir,
    });
  }, [
    selectedReport,
    rawTripsAll,
    drivers,
    allFleetVehicles,
    collectionRoutesList,
    dateBounds,
    selectedDriverFilter,
    selectedVehicle,
    selectedRouteFilter,
    statusFilter,
    searchQuery,
    sortKey,
    sortDir,
  ]);

  const detailedDriverHistoryBundle = useMemo(() => {
    if (!inspectDriverId) return null;
    return buildDetailedDriverHistory(
      inspectDriverId,
      drivers,
      rawShifts,
      assignments,
      rawTripsAll,
      allFleetVehicles,
      collectionRoutesList
    );
  }, [
    inspectDriverId,
    drivers,
    rawShifts,
    assignments,
    rawTripsAll,
    allFleetVehicles,
    collectionRoutesList,
  ]);

  const filteredAndSortedRows = useMemo(() => {
    if (selectedReport === "driver_attendance") {
      return attendanceRows;
    }
    if (selectedReport === "trip_route_history") {
      return tripRouteHistoryRows;
    }
    if (selectedReport === "operation_management") {
      if (operationSubView === "vehicles") return operationFilteredVehicles;
      return operationSubView === "audit" ? operationFilteredAuditLogs : operationFilteredStatements;
    }
    return filterAndSortReportRows(baseTableRows, {
      searchQuery,
      statusFilter,
      sortKey,
      sortDir,
    });
  }, [
    selectedReport,
    attendanceRows,
    tripRouteHistoryRows,
    operationSubView,
    operationFilteredVehicles,
    operationFilteredAuditLogs,
    operationFilteredStatements,
    baseTableRows,
    searchQuery,
    statusFilter,
    sortKey,
    sortDir,
  ]);

  const otherReportInsights = useMemo(() => {
    if (
      selectedReport === "daily_activity" ||
      selectedReport === "operation_management" ||
      selectedReport === "driver_attendance" ||
      selectedReport === "trip_route_history"
    ) {
      return null;
    }
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
    if (selectedReport === "driver_attendance") {
      return ["All", "On Duty", "Completed"];
    }
    if (selectedReport === "trip_route_history") {
      return ["All", "Completed", "Ongoing", "Delayed"];
    }
    if (selectedReport === "operation_management") {
      if (operationSubView === "vehicles") {
        const set = new Set<string>(["All"]);
        operationAllVehiclesRows.forEach((r) => {
          if (r.status) set.add(String(r.status));
        });
        return Array.from(set);
      }
      return ["All", "Completed", "Ongoing", "Delayed"];
    }
    const set = new Set<string>(["All"]);
    baseTableRows.forEach((r) => {
      if (r.status) set.add(String(r.status));
    });
    return Array.from(set);
  }, [selectedReport, operationSubView, operationAllVehiclesRows, baseTableRows]);

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
    setSelectedDriverFilter("All");
    setSelectedRouteFilter("All");
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
    const csvContent =
      selectedReport === "driver_attendance"
        ? buildAttendanceCsv(attendanceRows)
        : selectedReport === "trip_route_history"
        ? buildTripRouteHistoryCsv(tripRouteHistoryRows)
        : selectedReport === "operation_management" && operationSubView === "vehicles"
        ? buildAllVehiclesOperationCsv(operationFilteredVehicles)
        : selectedReport === "operation_management" && operationSubView === "statements"
        ? buildOperationReportCsv(operationFilteredStatements)
        : buildReportCsv(filteredAndSortedRows);
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
          { id: "operation_management", label: "Operation Management Report" },
          { id: "driver_attendance", label: "Driver Attendance" },
          { id: "trip_route_history", label: "Trip & Route History" },
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
                selectedReport === "driver_attendance" || selectedReport === "trip_route_history"
                  ? ([
                      { id: "today", label: "Today" },
                      { id: "yesterday", label: "Yesterday" },
                      { id: "week", label: "This Week" },
                      { id: "month", label: "This Month" },
                      { id: "all", label: "All Time" },
                      { id: "custom", label: "Custom Date Range" },
                    ] as const)
                  : ([
                      { id: "today", label: "Today" },
                      { id: "yesterday", label: "Yesterday" },
                      { id: "week", label: "Last 7 Days" },
                      { id: "month", label: "Last 30 Days" },
                      { id: "all", label: "All Time" },
                      { id: "custom", label: "Pick Date" },
                    ] as const)
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
              {selectedReport === "operation_management" ? (
                <span className="px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 font-semibold text-indigo-800 inline-flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5" />
                  All Fleet Vehicles ({allFleetVehicles.length})
                </span>
              ) : selectedReport === "driver_attendance" || selectedReport === "trip_route_history" ? (
                <select
                  value={selectedVehicle}
                  onChange={(e) => setSelectedVehicle(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-800 cursor-pointer"
                >
                  <option value="All">All Fleet Vehicles ({allFleetVehicles.length})</option>
                  {allFleetVehicles.map((v) => (
                    <option key={v.id} value={v.number}>
                      {v.number}
                    </option>
                  ))}
                </select>
              ) : (
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
              )}
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

            {(selectedReport === "operation_management" ||
              selectedReport === "driver_attendance" ||
              selectedReport === "trip_route_history") && (
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Driver:</span>
                <select
                  value={selectedDriverFilter}
                  onChange={(e) => setSelectedDriverFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-800 cursor-pointer"
                >
                  <option value="All">All Drivers</option>
                  {drivers.map((d) => (
                    <option
                      key={d.id}
                      value={selectedReport === "operation_management" ? d.name : d.id}
                    >
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(selectedReport === "driver_attendance" || selectedReport === "trip_route_history") && (
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Route:</span>
                <select
                  value={selectedRouteFilter}
                  onChange={(e) => setSelectedRouteFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-800 cursor-pointer max-w-[180px]"
                >
                  <option value="All">All Collection Routes</option>
                  {collectionRoutesList.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
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

          {/* Operation Management Report KPIs & Sub-View Toggle */}
          {selectedReport === "operation_management" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOperationSubView("vehicles");
                    setStatusFilter("All");
                    setSortKey(null);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                    operationSubView === "vehicles"
                      ? "bg-slate-900 text-white"
                      : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <Truck className="h-3.5 w-3.5" />
                  All Fleet Vehicles ({operationFilteredVehicles.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOperationSubView("statements");
                    setStatusFilter("All");
                    setSortKey(null);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                    operationSubView === "statements"
                      ? "bg-slate-900 text-white"
                      : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <ClipboardList className="h-3.5 w-3.5" />
                  Operation Statement Ledger ({operationFilteredStatements.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOperationSubView("audit");
                    setStatusFilter("All");
                    setSortKey(null);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                    operationSubView === "audit"
                      ? "bg-slate-900 text-white"
                      : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <History className="h-3.5 w-3.5" />
                  Odometer Audit History ({operationFilteredAuditLogs.length})
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <span>Operations Logged</span>
                    <ClipboardList className="h-3.5 w-3.5 text-indigo-500" />
                  </div>
                  <div className="text-xl font-extrabold text-slate-900 mt-1">
                    {operationKpis.totalStatements}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {operationKpis.completedStatements} closed · {operationKpis.ongoingStatements} open
                  </div>
                </div>

                <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <span>Total Running KMs</span>
                    <Navigation className="h-3.5 w-3.5 text-emerald-500" />
                  </div>
                  <div className="text-xl font-extrabold text-slate-900 mt-1">
                    {operationKpis.totalRunningKm.toLocaleString()} km
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Avg {operationKpis.avgRunningKmPerTrip} km / statement
                  </div>
                </div>

                <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <span>Diesel Issued</span>
                    <Fuel className="h-3.5 w-3.5 text-amber-500" />
                  </div>
                  <div className="text-xl font-extrabold text-slate-900 mt-1">
                    {operationKpis.totalDieselLitres.toFixed(1)} L
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Spend: ₹ {Math.round(operationKpis.totalFuelAmount).toLocaleString("en-IN")}
                  </div>
                </div>

                <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <span>Overall KMPL</span>
                    <Gauge className="h-3.5 w-3.5 text-blue-500" />
                  </div>
                  <div className="text-xl font-extrabold text-slate-900 mt-1">
                    {operationKpis.weightedKmpl != null
                      ? `${operationKpis.weightedKmpl.toFixed(2)} km/L`
                      : "—"}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Running KM ÷ Diesel Litres</div>
                </div>

                <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs col-span-2 md:col-span-1">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <span>Active Fleet Units</span>
                    <Truck className="h-3.5 w-3.5 text-slate-600" />
                  </div>
                  <div className="text-xl font-extrabold text-slate-900 mt-1">
                    {operationKpis.activeVehiclesCount}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">{dateBounds.displayLabel}</div>
                </div>
              </div>
            </div>
          )}

          {/* Driver Attendance Overview (6 Real Database Cards) */}
          {selectedReport === "driver_attendance" && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: "Total Drivers", value: attendanceOverviewKpis.totalDrivers, hint: "Registered drivers", icon: UsersRound, color: "text-slate-700" },
                { label: "Clocked In Today", value: attendanceOverviewKpis.clockedInToday, hint: "IST Today", icon: UserCheck, color: "text-indigo-600" },
                { label: "Clocked Out Today", value: attendanceOverviewKpis.clockedOutToday, hint: "IST Today", icon: CheckCircle2, color: "text-emerald-600" },
                { label: "Currently On Duty", value: attendanceOverviewKpis.currentlyOnDuty, hint: "Open active shifts", icon: Activity, color: "text-emerald-700" },
                { label: "Completed Shifts", value: attendanceOverviewKpis.totalCompletedShifts, hint: "Recorded total", icon: ClipboardList, color: "text-blue-600" },
                { label: "Avg Working Hours", value: `${attendanceOverviewKpis.avgWorkingHours.toFixed(2)} h`, hint: "Completed shifts", icon: Clock, color: "text-amber-600" },
              ].map((kpi) => {
                const Icon = kpi.icon;
                return (
                  <div key={kpi.label} className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <span>{kpi.label}</span>
                      <Icon className={`h-3.5 w-3.5 ${kpi.color}`} />
                    </div>
                    <div className="text-xl font-extrabold text-slate-900 mt-1">{kpi.value}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{kpi.hint}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Other Report Tabs KPI Strip */}
          {selectedReport !== "daily_activity" &&
            selectedReport !== "operation_management" &&
            selectedReport !== "driver_attendance" &&
            selectedReport !== "trip_route_history" &&
            otherReportInsights && (
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

      {!isLoading &&
        selectedReport === "operation_management" &&
        operationSubView !== "audit" &&
        operationChartData.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border border-slate-200/80 p-4 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-indigo-600" />
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Running KMs by Vehicle (Operation Statements)
                  </h3>
                </div>
                <span className="text-[11px] text-slate-400">All Fleet Vehicles · {dateBounds.displayLabel}</span>
              </div>
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={operationChartData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#475569" }} unit=" km" />
                    <Tooltip
                      formatter={(val: any) => [`${Number(val).toFixed(1)} km`, "Running KM"]}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.fullVehicle || ""}
                    />
                    <Bar
                      dataKey="runningKm"
                      fill="#4F46E5"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="border border-slate-200/80 p-4 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Fuel className="h-4 w-4 text-amber-600" />
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Diesel (L) &amp; Mileage (km/L) by Vehicle
                  </h3>
                </div>
                <span className="text-[11px] text-slate-400">{dateBounds.displayLabel}</span>
              </div>
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={operationChartData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#475569" }} />
                    <Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.fullVehicle || ""} />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Bar dataKey="dieselLitres" name="Diesel (L)" fill="#F59E0B" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="kmpl" name="KMPL (km/L)" fill="#10B981" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        )}

      {!isLoading &&
        selectedReport !== "daily_activity" &&
        selectedReport !== "operation_management" &&
        otherReportInsights &&
        otherReportInsights.chartData.length > 0 && (
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
          ) : selectedReport === "driver_attendance" ? (
            paginatedRows.length > 0 ? (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                    {[
                      { key: "driverName", label: "Driver Name" },
                      { key: "driverPhone", label: "Driver Contact" },
                      { key: "date", label: "Date" },
                      { key: "clockInTime", label: "Clock-in Time" },
                      { key: "clockOutTime", label: "Clock-out Time" },
                      { key: "totalWorkingHoursNum", label: "Total Working Hours" },
                      { key: "vehicleRegistration", label: "Vehicle Reg" },
                      { key: "attendanceStatus", label: "Attendance Status" },
                    ].map((col) => (
                      <th
                        key={col.key}
                        onClick={() => handleSortColumn(col.key)}
                        className="py-2.5 px-3 whitespace-nowrap cursor-pointer select-none hover:text-slate-700"
                      >
                        <span className="inline-flex items-center gap-1">
                          <span>{col.label}</span>
                          <ArrowUpDown className="h-3 w-3 opacity-60" />
                        </span>
                      </th>
                    ))}
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(paginatedRows as FormattedAttendanceRow[]).map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3 font-bold text-slate-900 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setInspectDriverId(row.driverId)}
                          className="hover:text-indigo-700 hover:underline text-left cursor-pointer"
                        >
                          {row.driverName}
                        </button>
                      </td>
                      <td className="py-3 px-3 text-slate-600 whitespace-nowrap">{row.driverPhone}</td>
                      <td className="py-3 px-3 font-medium text-slate-700 whitespace-nowrap">{row.date}</td>
                      <td className="py-3 px-3 font-semibold text-slate-800 whitespace-nowrap">{row.clockInTime}</td>
                      <td className="py-3 px-3 font-semibold text-slate-800 whitespace-nowrap">{row.clockOutTime}</td>
                      <td className="py-3 px-3 font-bold text-indigo-700 whitespace-nowrap">{row.totalWorkingHours}</td>
                      <td className="py-3 px-3 font-bold text-slate-900 whitespace-nowrap">{row.vehicleRegistration}</td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            row.attendanceStatus === "On Duty"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : row.attendanceStatus === "Completed"
                              ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                              : "bg-slate-100 text-slate-600 border-slate-200"
                          }`}
                        >
                          {row.attendanceStatus}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setInspectDriverId(row.driverId)}
                          className="px-2.5 py-1 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="h-3 w-3" /> History
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="py-10 text-center text-xs text-slate-400">
                No clock-in / clock-out records found in Supabase for the selected period.
              </div>
            )
          ) : selectedReport === "trip_route_history" ? (
            paginatedRows.length > 0 ? (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                    {[
                      { key: "driverName", label: "Driver" },
                      { key: "vehicleRegistration", label: "Vehicle Reg" },
                      { key: "routeName", label: "Route Name" },
                      { key: "startingPoint", label: "Starting Point" },
                      { key: "destination", label: "Destination" },
                      { key: "tripDate", label: "Trip Date" },
                      { key: "departureTime", label: "Actual Dep" },
                      { key: "returnTime", label: "Actual Return" },
                      { key: "outKmNum", label: "Start Odo" },
                      { key: "inKmNum", label: "End Odo" },
                      { key: "distanceNum", label: "Distance" },
                      { key: "tripDuration", label: "Duration" },
                      { key: "tripStatus", label: "Status" },
                      { key: "statementNumber", label: "Statement No" },
                    ].map((col) => (
                      <th
                        key={col.key}
                        onClick={() => handleSortColumn(col.key)}
                        className="py-2.5 px-3 whitespace-nowrap cursor-pointer select-none hover:text-slate-700"
                      >
                        <span className="inline-flex items-center gap-1">
                          <span>{col.label}</span>
                          <ArrowUpDown className="h-3 w-3 opacity-60" />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(paginatedRows as FormattedTripRouteHistoryRow[]).map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3 font-bold text-slate-900 whitespace-nowrap">
                        {row.driverId ? (
                          <button
                            type="button"
                            onClick={() => setInspectDriverId(row.driverId)}
                            className="hover:text-indigo-700 hover:underline text-left cursor-pointer"
                          >
                            {row.driverName}
                          </button>
                        ) : (
                          row.driverName
                        )}
                      </td>
                      <td className="py-3 px-3 font-bold text-slate-900 whitespace-nowrap">{row.vehicleRegistration}</td>
                      <td className="py-3 px-3 font-medium text-slate-800 max-w-[160px] truncate" title={row.routeName}>
                        {row.routeName}
                      </td>
                      <td className="py-3 px-3 text-slate-600 max-w-[140px] truncate" title={row.startingPoint}>
                        {row.startingPoint}
                      </td>
                      <td className="py-3 px-3 text-slate-600 max-w-[140px] truncate" title={row.destination}>
                        {row.destination}
                      </td>
                      <td className="py-3 px-3 text-slate-700 whitespace-nowrap">{row.tripDate}</td>
                      <td className="py-3 px-3 text-slate-700 whitespace-nowrap">{row.departureTime}</td>
                      <td className="py-3 px-3 text-slate-700 whitespace-nowrap">{row.returnTime}</td>
                      <td className="py-3 px-3 text-slate-700 whitespace-nowrap">{row.outKm}</td>
                      <td className="py-3 px-3 font-semibold text-slate-900 whitespace-nowrap">{row.inKm}</td>
                      <td className="py-3 px-3 font-extrabold text-indigo-700 whitespace-nowrap">{row.distanceTravelled}</td>
                      <td className="py-3 px-3 text-slate-600 whitespace-nowrap">{row.tripDuration}</td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <Badge variant="outline" className={`text-[10px] ${getStatusBadgeClass(row.tripStatus)}`}>
                          {row.tripStatus}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-slate-700 whitespace-nowrap">{row.statementNumber}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="py-10 text-center text-xs text-slate-400">
                No trip and route history records match your filters.
              </div>
            )
          ) : selectedReport === "operation_management" && operationSubView === "audit" ? (
            operationAuditMissing ? (
              <div className="py-10 text-center space-y-2 text-xs text-amber-800 bg-amber-50 rounded-xl border border-amber-200 p-4">
                <div className="font-bold">Odometer Audit Logs table is not deployed yet.</div>
                <div>
                  Run migration <code>20261125150000_driver_trip_statement_and_odometer_rpc.sql</code> in Supabase SQL Editor to enable immutable odometer audit tracking.
                </div>
              </div>
            ) : paginatedRows.length > 0 ? (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                    <th className="py-2.5 px-3">Timestamp (IST)</th>
                    <th className="py-2.5 px-3">Vehicle</th>
                    <th className="py-2.5 px-3">Driver</th>
                    <th className="py-2.5 px-3">Previous Odo</th>
                    <th className="py-2.5 px-3">New Odo</th>
                    <th className="py-2.5 px-3">Delta KM</th>
                    <th className="py-2.5 px-3">Source</th>
                    <th className="py-2.5 px-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedRows.map((log: any) => (
                    <tr key={log.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                        {log.created_at ? formatIstDateTime(log.created_at) : "-"}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-slate-900 whitespace-nowrap">
                        {log.vehicles?.number || "-"}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                        {log.drivers?.name || "System"}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                        {Number(log.previous_odometer || 0).toLocaleString()} km
                      </td>
                      <td className="py-2.5 px-3 font-bold text-indigo-700 whitespace-nowrap">
                        {Number(log.new_odometer || 0).toLocaleString()} km
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-emerald-700 whitespace-nowrap">
                        {log.running_km != null ? `+${Number(log.running_km).toLocaleString()} km` : "-"}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[10px] text-slate-600 whitespace-nowrap">
                        {log.source}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 max-w-[220px] truncate" title={log.notes || ""}>
                        {log.notes || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="py-10 text-center text-xs text-slate-400">
                No odometer audit entries found.
              </div>
            )
          ) : selectedReport === "operation_management" && operationSubView === "vehicles" ? (
            paginatedRows.length > 0 ? (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                    {[
                      { key: "vehicle", label: "Vehicle No" },
                      { key: "model", label: "Model" },
                      { key: "driver", label: "Driver" },
                      { key: "route", label: "Route" },
                      { key: "currentOdometerNum", label: "Current Odo" },
                      { key: "tripsCount", label: "Trips" },
                      { key: "runningKmNum", label: "Running KM" },
                      { key: "dieselNum", label: "Diesel" },
                      { key: "fuelAmountNum", label: "Amount" },
                      { key: "kmpl", label: "KMPL" },
                      { key: "odometerSource", label: "Odo Source" },
                      { key: "status", label: "Status" },
                    ].map((col) => (
                      <th
                        key={col.key}
                        onClick={() => handleSortColumn(col.key)}
                        className="py-2.5 px-3 whitespace-nowrap cursor-pointer select-none hover:text-slate-700"
                      >
                        <span className="inline-flex items-center gap-1">
                          <span>{col.label}</span>
                          <ArrowUpDown className="h-3 w-3 opacity-60" />
                          {sortKey === col.key && (
                            <span className="text-indigo-600 font-bold">
                              {sortDir === "asc" ? "↑" : "↓"}
                            </span>
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(paginatedRows as AllVehicleOperationSummaryRow[]).map((row) => (
                    <tr key={row.vehicleId || row.vehicle} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3 font-bold text-slate-900 whitespace-nowrap">{row.vehicle}</td>
                      <td className="py-3 px-3 text-slate-600 whitespace-nowrap">{row.model}</td>
                      <td className="py-3 px-3 text-slate-700 whitespace-nowrap">{row.driver}</td>
                      <td className="py-3 px-3 text-slate-600 max-w-[180px] truncate" title={row.route}>
                        {row.route}
                      </td>
                      <td className="py-3 px-3 font-semibold text-slate-900 whitespace-nowrap">{row.currentOdometer}</td>
                      <td className="py-3 px-3 font-medium text-slate-700 whitespace-nowrap">{row.tripsCount}</td>
                      <td className="py-3 px-3 font-extrabold text-indigo-700 whitespace-nowrap">{row.runningKm}</td>
                      <td className="py-3 px-3 text-slate-700 whitespace-nowrap">{row.dieselLitres}</td>
                      <td className="py-3 px-3 text-slate-700 whitespace-nowrap">{row.fuelAmount}</td>
                      <td className="py-3 px-3 font-semibold text-emerald-700 whitespace-nowrap">{row.kmpl}</td>
                      <td className="py-3 px-3 font-mono text-[10px] text-slate-500 whitespace-nowrap">{row.odometerSource}</td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <Badge variant="outline" className={`text-[10px] ${getStatusBadgeClass(row.status)}`}>
                          {row.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="py-10 text-center text-xs text-slate-400">
                No fleet vehicles match your current filters.
              </div>
            )
          ) : selectedReport === "operation_management" && paginatedRows.length > 0 ? (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                  {[
                    { key: "date", label: "Date" },
                    { key: "vehicle", label: "Vehicle No" },
                    { key: "driver", label: "Driver / Salesman" },
                    { key: "route", label: "Route" },
                    { key: "outDateTime", label: "Out" },
                    { key: "inDateTime", label: "In" },
                    { key: "outKm", label: "Out KM" },
                    { key: "inKm", label: "In KM" },
                    { key: "runningKm", label: "Running KM" },
                    { key: "dieselLitres", label: "Diesel" },
                    { key: "fuelAmount", label: "Amount" },
                    { key: "kmpl", label: "KMPL" },
                    { key: "status", label: "Status" },
                  ].map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSortColumn(col.key)}
                      className="py-2.5 px-3 whitespace-nowrap cursor-pointer select-none hover:text-slate-700"
                    >
                      <span className="inline-flex items-center gap-1">
                        <span>{col.label}</span>
                        <ArrowUpDown className="h-3 w-3 opacity-60" />
                        {sortKey === col.key && (
                          <span className="text-indigo-600 font-bold">
                            {sortDir === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                      </span>
                    </th>
                  ))}
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(paginatedRows as FormattedOperationStatementRow[]).map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-3 font-medium text-slate-800 whitespace-nowrap">{row.date}</td>
                    <td className="py-3 px-3 font-bold text-slate-900 whitespace-nowrap">{row.vehicle}</td>
                    <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                      <div>{row.driver}</div>
                      {row.salesman !== "-" && (
                        <div className="text-[10px] text-slate-400">Salesman: {row.salesman}</div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-slate-600 max-w-[180px] truncate" title={row.route}>
                      {row.route}
                    </td>
                    <td className="py-3 px-3 text-slate-600 whitespace-nowrap">{row.outDateTime}</td>
                    <td className="py-3 px-3 text-slate-600 whitespace-nowrap">{row.inDateTime}</td>
                    <td className="py-3 px-3 font-medium text-slate-700 whitespace-nowrap">{row.outKm}</td>
                    <td className="py-3 px-3 font-bold text-slate-900 whitespace-nowrap">{row.inKm}</td>
                    <td className="py-3 px-3 font-extrabold text-indigo-700 whitespace-nowrap">{row.runningKm}</td>
                    <td className="py-3 px-3 text-slate-700 whitespace-nowrap">{row.dieselLitres}</td>
                    <td className="py-3 px-3 text-slate-700 whitespace-nowrap">{row.fuelAmount}</td>
                    <td className="py-3 px-3 font-semibold text-emerald-700 whitespace-nowrap">{row.kmpl}</td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <Badge variant="outline" className={`text-[10px] ${getStatusBadgeClass(row.status)}`}>
                        {row.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setInspectStatementRow(row)}
                          className="px-2 py-1 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="h-3 w-3" />
                          Sheet
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDrillDownToVehicleActivity(row.vehicle)}
                          className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-md cursor-pointer"
                        >
                          Activity →
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

      {/* Detailed Driver Attendance, Assignments & Trip History Modal */}
      <DetailedDriverHistoryModal
        bundle={detailedDriverHistoryBundle}
        onClose={() => setInspectDriverId(null)}
      />

      {/* Printable Nanjil Dairy Operation Statement Sheet Modal */}
      {inspectStatementRow && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl border border-slate-200">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
                  Nanjil Dairy Fleet · Operation Audit
                </div>
                <div className="text-base font-bold">Vehicle Operation Statement</div>
              </div>
              <button
                onClick={() => setInspectStatementRow(null)}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Vehicle Number</span>
                  <span className="font-bold text-slate-900 text-sm">{inspectStatementRow.vehicle}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Date</span>
                  <span className="font-semibold text-slate-800 text-sm">{inspectStatementRow.date}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Route</span>
                  <span className="font-semibold text-slate-800">{inspectStatementRow.route}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Driver</span>
                  <span className="font-semibold text-slate-800">{inspectStatementRow.driver}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Salesman</span>
                  <span className="font-semibold text-slate-800">{inspectStatementRow.salesman}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Out Date &amp; Time</span>
                  <span className="font-semibold text-slate-800">{inspectStatementRow.outDateTime}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">In Date &amp; Time</span>
                  <span className="font-semibold text-slate-800">{inspectStatementRow.inDateTime}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Out KM</span>
                  <span className="font-bold text-slate-800">{inspectStatementRow.outKm}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">In KM</span>
                  <span className="font-bold text-slate-900">{inspectStatementRow.inKm}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Running KMs</span>
                  <span className="font-extrabold text-indigo-700 text-sm">{inspectStatementRow.runningKm}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">KMPL</span>
                  <span className="font-extrabold text-emerald-700 text-sm">{inspectStatementRow.kmpl}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Diesel (Litres)</span>
                  <span className="font-semibold text-slate-800">{inspectStatementRow.dieselLitres}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Fuel Amount</span>
                  <span className="font-semibold text-slate-800">{inspectStatementRow.fuelAmount}</span>
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                <span>
                  Odometer Source: <strong>{inspectStatementRow.odometerSource}</strong>
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {inspectStatementRow.status}
                </span>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  variant="outline"
                  onClick={() => window.print()}
                  className="text-xs px-3 py-1.5 rounded-xl flex items-center gap-1.5"
                >
                  <Printer className="h-3.5 w-3.5" /> Print Sheet
                </Button>
                <Button
                  onClick={() => setInspectStatementRow(null)}
                  className="text-xs px-4 py-1.5 rounded-xl bg-slate-900 text-white"
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
