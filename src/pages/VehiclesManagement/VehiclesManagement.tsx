import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { 
  Truck, 
  Activity, 
  Wrench, 
  Fuel, 
  ShieldCheck, 
  AlertTriangle, 
  RotateCcw, 
  Plus, 
  Gauge, 
  MapPin, 
  User, 
  ArrowRight,
  Radio
} from "lucide-react";
import { PageHeader } from "@/components/AppLayout";
import { Card, Button, Kpi, Badge } from "@/components/ui-kit";
import { useVehicles, TELEMETRY_LABEL, TELEMETRY_SOURCE } from "@/hooks/useVehicleTracking";
import { supabase } from "@/lib/supabase";
import { calculateFleetFuelAnalysis, calculateVehicleFuelAnalysis, type RawFuelLog } from "@/lib/fuel-efficiency";
import type { Vehicle, VehicleStatus } from "@/lib/types";
import { VehicleCard } from "./components/VehicleCard";
import { VehicleFilters } from "./components/VehicleFilters";
import type { 
  VehicleFiltersState, 
  VehicleSummaryMetrics, 
  MaintenanceHealthStatus, 
  MaintenanceRecordItem 
} from "./types";

export default function VehiclesManagementPage() {
  // Live vehicles stream via unified telemetry adapter
  const liveVehicles = useVehicles();

  // Supplementary fleet records
  const [maintenanceRecords, setMaintenanceRecords] = useState<MaintenanceRecordItem[]>([]);
  const [fuelLogs, setFuelLogs] = useState<RawFuelLog[]>([]);
  const [tripsList, setTripsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isRealtimeActive, setIsRealtimeActive] = useState(false);

  // Peak session speeds cache per vehicle
  const sessionMaxSpeedsRef = useRef<Map<string, number>>(new Map());

  // Filters and controls state
  const [filters, setFilters] = useState<VehicleFiltersState>({
    searchQuery: "",
    status: "All",
    vehicleType: "All",
    driver: "All",
    maintenanceStatus: "All",
    sortBy: "number",
    sortOrder: "asc",
    viewMode: "grid",
  });

  // Track peak speeds seen during live telemetry stream
  useEffect(() => {
    liveVehicles.forEach((v) => {
      if (v.speed > 0) {
        const cur = sessionMaxSpeedsRef.current.get(v.id) || 0;
        if (v.speed > cur) {
          sessionMaxSpeedsRef.current.set(v.id, v.speed);
        }
      }
    });
  }, [liveVehicles]);

  // Load backend records (supports silent background sync on realtime triggers)
  const loadFleetData = useCallback(async (isManual = false, isBackground = false) => {
    if (isManual) setRefreshing(true);
    else if (!isBackground) setLoading(true);

    try {
      const [mRes, fRes, tRes] = await Promise.all([
        supabase.from("maintenance_records").select("*"),
        supabase.from("fuel_purchase_logs").select("*").order("logged_at", { ascending: true }),
        supabase.from("trips").select("id, vehicle_id, distance, duration, status, date"),
      ]);

      if (mRes.data) {
        setMaintenanceRecords(mRes.data as MaintenanceRecordItem[]);
      }
      if (fRes.data) {
        setFuelLogs(fRes.data as RawFuelLog[]);
      }
      if (tRes.data) {
        setTripsList(tRes.data);
      }
    } catch (err) {
      console.error("[VehiclesManagement] Failed to load fleet supplementary data:", err);
    } finally {
      if (!isBackground) setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadFleetData(false, false);

    // Multi-table real-time listener for operational fleet data
    const channelId = `vehicles-mgmt-all-${Math.random().toString(36).substring(2, 9)}`;
    const channel = supabase
      .channel(channelId)
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, () => {
        loadFleetData(false, true);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "maintenance_records" }, () => {
        loadFleetData(false, true);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "fuel_purchase_logs" }, () => {
        loadFleetData(false, true);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => {
        loadFleetData(false, true);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => {
        loadFleetData(false, true);
      })
      .subscribe((status) => {
        setIsRealtimeActive(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadFleetData]);

  // Compute metrics per vehicle
  const vehicleMetricsMap = useMemo(() => {
    const map = new Map<string, VehicleSummaryMetrics>();

    liveVehicles.forEach((v) => {
      // 1. Maintenance status
      const vRecords = maintenanceRecords.filter((m) => m.vehicle_id === v.id);
      let maintStatus: MaintenanceHealthStatus = "Good";
      let daysToService: number | null = null;
      let lastServiceDate: string | null = v.lastService || null;
      let nextServiceDate: string | null = null;

      const completed = vRecords.filter((r) => r.status === "Completed");
      if (completed.length > 0) {
        const sorted = [...completed].sort((a, b) => {
          const da = a.due_date ? new Date(a.due_date).getTime() : 0;
          const db = b.due_date ? new Date(b.due_date).getTime() : 0;
          return db - da;
        });
        lastServiceDate = sorted[0].due_date || lastServiceDate;
      }

      const overdue = vRecords.filter((r) => r.status === "Overdue");
      const upcoming = vRecords.filter((r) => r.status === "Upcoming");

      const today = new Date().setHours(0, 0, 0, 0);

      if (overdue.length > 0) {
        maintStatus = "Overdue";
      } else if (upcoming.length > 0) {
        // Check earliest upcoming
        const sortedUp = [...upcoming].sort((a, b) => {
          const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
          const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
          return da - db;
        });
        nextServiceDate = sortedUp[0].due_date;
        if (nextServiceDate) {
          const target = new Date(nextServiceDate).getTime();
          daysToService = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
          if (daysToService < 0) maintStatus = "Overdue";
          else if (daysToService <= 14) maintStatus = "Due Soon";
          else maintStatus = "Due";
        }
      }

      const totalMaintCost = vRecords.reduce((sum, r) => sum + (Number(r.cost) || 0), 0);

      // 2. Fuel efficiency calculation for this vehicle
      const vFuelLogs = fuelLogs.filter((f) => f.vehicle_id === v.id);
      const fuelAnalysis = calculateVehicleFuelAnalysis(v.id, vFuelLogs, v.number, v.odometer);
      const avgMileage = fuelAnalysis.averageMileage;

      // 3. Trips count & speeds (incorporating peak live velocity)
      const vTrips = tripsList.filter((t) => t.vehicle_id === v.id);
      const sessionPeak = sessionMaxSpeedsRef.current.get(v.id) || 0;
      const peakSpeed = Math.max(sessionPeak, v.speed || 0);
      const topSpeed = peakSpeed > 0 ? peakSpeed : null;
      const avgSpeed = v.averageSpeed != null && v.averageSpeed > 0 ? v.averageSpeed : null;

      map.set(v.id, {
        topSpeed,
        avgSpeed,
        avgMileage,
        maintenanceStatus: maintStatus,
        maintenanceDueInDays: daysToService,
        lastServiceDate,
        nextServiceDate,
        totalTripsCount: vTrips.length,
        totalMaintenanceCost: totalMaintCost,
      });
    });

    return map;
  }, [liveVehicles, maintenanceRecords, fuelLogs, tripsList]);

  // Extract unique filter options dynamically from live data
  const vehicleTypes = useMemo(() => {
    const set = new Set<string>();
    liveVehicles.forEach((v) => {
      if (v.type && v.type.trim()) set.add(v.type.trim());
    });
    return Array.from(set).sort();
  }, [liveVehicles]);

  const driverNames = useMemo(() => {
    const set = new Set<string>();
    liveVehicles.forEach((v) => {
      if (v.driver && v.driver.trim() && v.driver !== "Unassigned") {
        set.add(v.driver.trim());
      }
    });
    return Array.from(set).sort();
  }, [liveVehicles]);

  // Filter & Sort vehicles
  const filteredVehicles = useMemo(() => {
    return liveVehicles.filter((v) => {
      // 1. Search Query (Number, Model, DeviceId)
      if (filters.searchQuery.trim()) {
        const query = filters.searchQuery.toLowerCase().trim();
        const num = (v.number || "").toLowerCase();
        const model = (v.model || "").toLowerCase();
        const type = (v.type || "").toLowerCase();
        const devId = (v.deviceId || "").toLowerCase();
        const driver = (v.driver || "").toLowerCase();
        if (
          !num.includes(query) &&
          !model.includes(query) &&
          !type.includes(query) &&
          !devId.includes(query) &&
          !driver.includes(query)
        ) {
          return false;
        }
      }

      // 2. Status filter
      if (filters.status !== "All") {
        if (v.status !== filters.status) return false;
      }

      // 3. Vehicle Type
      if (filters.vehicleType !== "All") {
        if (v.type !== filters.vehicleType) return false;
      }

      // 4. Driver filter
      if (filters.driver !== "All") {
        if (v.driver !== filters.driver) return false;
      }

      // 5. Maintenance filter
      if (filters.maintenanceStatus !== "All") {
        const m = vehicleMetricsMap.get(v.id);
        if (m?.maintenanceStatus !== filters.maintenanceStatus) return false;
      }

      return true;
    }).sort((a, b) => {
      const mA = vehicleMetricsMap.get(a.id);
      const mB = vehicleMetricsMap.get(b.id);
      const order = filters.sortOrder === "asc" ? 1 : -1;

      switch (filters.sortBy) {
        case "number":
          return a.number.localeCompare(b.number) * order;
        case "topSpeed":
          return ((mA?.topSpeed || a.speed || 0) - (mB?.topSpeed || b.speed || 0)) * order;
        case "avgSpeed":
          return ((mA?.avgSpeed || a.averageSpeed || 0) - (mB?.avgSpeed || b.averageSpeed || 0)) * order;
        case "avgMileage":
          return ((mA?.avgMileage || 0) - (mB?.avgMileage || 0)) * order;
        case "maintenance":
          return (mA?.maintenanceStatus || "Good").localeCompare(mB?.maintenanceStatus || "Good") * order;
        case "lastUpdate":
          return (a.lastUpdate || "").localeCompare(b.lastUpdate || "") * order;
        case "status":
          return (a.status || "").localeCompare(b.status || "") * order;
        default:
          return 0;
      }
    });
  }, [liveVehicles, filters, vehicleMetricsMap]);

  // Fleet Overall Statistics
  const fleetStats = useMemo(() => {
    const total = liveVehicles.length;
    const moving = liveVehicles.filter((v) => v.status === "Moving").length;
    const idle = liveVehicles.filter((v) => v.status === "Idle").length;
    const parked = liveVehicles.filter((v) => v.status === "Parked").length;
    const offline = liveVehicles.filter((v) => v.status === "Offline").length;

    let overdueCount = 0;
    let dueSoonCount = 0;
    vehicleMetricsMap.forEach((m) => {
      if (m.maintenanceStatus === "Overdue") overdueCount++;
      if (m.maintenanceStatus === "Due Soon" || m.maintenanceStatus === "Due") dueSoonCount++;
    });

    const fleetAnalysis = calculateFleetFuelAnalysis(fuelLogs, liveVehicles);

    return {
      total,
      moving,
      idle,
      parked,
      offline,
      overdueCount,
      dueSoonCount,
      avgMileage: fleetAnalysis.fleetAvgMileage,
    };
  }, [liveVehicles, vehicleMetricsMap, fuelLogs]);

  return (
    <div className="space-y-5 pb-8">
      {/* ── Page Header ── */}
      <PageHeader
        title="Vehicles"
        subtitle="Monitor vehicle performance, mileage, maintenance and operational health."
        actions={
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
              isRealtimeActive 
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" 
                : "bg-amber-500/10 text-amber-600 border-amber-500/20"
            }`}>
              <span className={`h-2 w-2 rounded-full ${isRealtimeActive ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
              {isRealtimeActive ? "Real-time Live Sync" : "Connecting..."}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
              <Radio className="h-3 w-3 animate-pulse" />
              {TELEMETRY_LABEL}
            </span>
          </div>
        }
      />

      {/* ── Fleet Summary Top KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi
          label="Total Fleet"
          value={fleetStats.total}
          hint={`${fleetStats.moving} on the road now`}
          icon={<Truck className="h-5 w-5" />}
          accent="primary"
        />
        <Kpi
          label="Active / Moving"
          value={fleetStats.moving}
          hint={`${Math.round((fleetStats.moving / (fleetStats.total || 1)) * 100)}% active utilization`}
          icon={<Activity className="h-5 w-5" />}
          accent="success"
        />
        <Kpi
          label="Idle & Parked"
          value={fleetStats.idle + fleetStats.parked}
          hint={`${fleetStats.idle} idling · ${fleetStats.parked} parked`}
          icon={<Gauge className="h-5 w-5" />}
          accent="warning"
        />
        <Kpi
          label="Maintenance Attention"
          value={fleetStats.overdueCount + fleetStats.dueSoonCount}
          hint={`${fleetStats.overdueCount} overdue · ${fleetStats.dueSoonCount} due soon`}
          icon={<Wrench className="h-5 w-5" />}
          accent={fleetStats.overdueCount > 0 ? "destructive" : "warning"}
        />
        <Kpi
          label="Fleet Avg Mileage"
          value={fleetStats.avgMileage != null ? `${fleetStats.avgMileage.toFixed(1)} km/L` : "—"}
          hint="Audit full-tank calculation"
          icon={<Fuel className="h-5 w-5" />}
          accent="info"
        />
      </div>

      {/* ── Search, Filters & Controls Bar ── */}
      <VehicleFilters
        filters={filters}
        onChange={setFilters}
        onRefresh={() => loadFleetData(true)}
        isRefreshing={refreshing}
        vehicleTypes={vehicleTypes}
        drivers={driverNames}
        totalVehicles={liveVehicles.length}
        filteredCount={filteredVehicles.length}
      />

      {/* ── Main Vehicle Grid / List Section ── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <Card key={n} className="p-4 space-y-4 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="h-5 w-28 bg-muted rounded" />
                <div className="h-5 w-16 bg-muted rounded-full" />
              </div>
              <div className="space-y-2">
                <div className="h-4 w-3/4 bg-muted/60 rounded" />
                <div className="h-4 w-1/2 bg-muted/40 rounded" />
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <div className="h-12 bg-muted/50 rounded" />
                <div className="h-12 bg-muted/50 rounded" />
                <div className="h-12 bg-muted/50 rounded" />
                <div className="h-12 bg-muted/50 rounded" />
              </div>
              <div className="h-9 bg-muted rounded-lg mt-2" />
            </Card>
          ))}
        </div>
      ) : filteredVehicles.length === 0 ? (
        <Card className="p-12 text-center max-w-lg mx-auto">
          <Truck className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="font-bold text-base text-foreground">No vehicles found</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            There are currently no vehicles matching your active search query or filter criteria.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setFilters({
                ...filters,
                searchQuery: "",
                status: "All",
                vehicleType: "All",
                driver: "All",
                maintenanceStatus: "All",
              })
            }
            className="mt-4 text-xs"
          >
            Clear Filters
          </Button>
        </Card>
      ) : filters.viewMode === "grid" ? (
        /* GRID VIEW: 3-4 cards desktop, 2 tablet, 1 mobile */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredVehicles.map((vehicle) => (
            <VehicleCard
              key={vehicle.id}
              vehicle={vehicle}
              metrics={vehicleMetricsMap.get(vehicle.id)}
            />
          ))}
        </div>
      ) : (
        /* LIST VIEW: Structured tabular layout */
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Vehicle</th>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3">Driver</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Top Speed</th>
                  <th className="py-3 px-3">Avg Speed</th>
                  <th className="py-3 px-3">Avg Mileage</th>
                  <th className="py-3 px-3">Maintenance</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredVehicles.map((v) => {
                  const m = vehicleMetricsMap.get(v.id);
                  return (
                    <tr key={v.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-bold text-sm text-foreground">{v.number}</div>
                        <div className="text-[11px] text-muted-foreground truncate max-w-[150px]">
                          {v.model || "Commercial Fleet"}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-muted-foreground">{v.type || "Milk Tanker"}</td>
                      <td className="py-3 px-3 font-medium text-foreground">{v.driver || "Unassigned"}</td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <Badge status={v.status}>{v.status}</Badge>
                      </td>
                      <td className="py-3 px-3 font-semibold text-foreground whitespace-nowrap">
                        {m?.topSpeed != null && m.topSpeed > 0 ? `${Math.round(m.topSpeed)} km/h` : "—"}
                      </td>
                      <td className="py-3 px-3 font-semibold text-foreground whitespace-nowrap">
                        {m?.avgSpeed != null && m.avgSpeed > 0 ? `${m.avgSpeed.toFixed(1)} km/h` : "—"}
                      </td>
                      <td className="py-3 px-3 font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                        {m?.avgMileage != null ? `${m.avgMileage.toFixed(1)} km/L` : "—"}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-muted/60">
                          {m?.maintenanceStatus || "Good"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <Link
                          to={`/vehicles-management/${v.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          View Details
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
