import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Badge, Button, Card } from "@/components/ui-kit";
import { SearchableSelect, type SearchableOption } from "@/components/SearchableSelect";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Edit3,
  Loader2,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Route as RouteIcon,
  Search,
  ShieldAlert,
  Truck,
  UserCheck,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { getTodayIstDateString } from "@/lib/odometerTrackingEngine";
import {
  type RouteAssignmentRecord,
  cancelRouteAssignment,
  computeAssignmentDashboardKpis,
  extractRouteSummary,
  fetchAssignmentsWithFallback,
  filterAssignableRoutes,
  formatAssignmentCode,
  saveRouteAssignment,
  validateAssignmentInput,
} from "@/lib/driverRouteAssignments";

function statusBadgeStyle(status: string): string {
  switch (status) {
    case "In Progress":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "Assigned":
      return "bg-indigo-50 text-indigo-700 border-indigo-200";
    case "Scheduled":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "Completed":
      return "bg-slate-100 text-slate-700 border-slate-300";
    case "Cancelled":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

export default function DriverRouteAssignmentPage() {
  const { user } = useAuth();
  const canManage = !user || user.role === "admin" || user.role === "manager";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [migrationPending, setMigrationPending] = useState(false);

  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<RouteAssignmentRecord[]>([]);
  const [ongoingTrips, setOngoingTrips] = useState<any[]>([]);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [assignmentDate, setAssignmentDate] = useState(() => getTodayIstDateString());
  const [departureTime, setDepartureTime] = useState("05:30");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Cancel Dialog State
  const [cancelTarget, setCancelTarget] = useState<RouteAssignmentRecord | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // Filters State
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilterMode, setDateFilterMode] = useState<"all" | "today" | "upcoming" | "custom">("all");
  const [customDateFilter, setCustomDateFilter] = useState(() => getTodayIstDateString());
  const [driverFilter, setDriverFilter] = useState("All");
  const [vehicleFilter, setVehicleFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  async function loadAll() {
    try {
      setLoadError(null);
      const [dRes, vRes, rRes, aRes, tRes] = await Promise.all([
        supabase.from("drivers").select("*").order("name"),
        supabase
          .from("v_vehicles")
          .select("id, number, type, model, status, route, odometer")
          .order("number"),
        supabase.from("collection_routes").select("*").order("name"),
        fetchAssignmentsWithFallback(supabase),
        supabase
          .from("trips")
          .select("id, vehicle_id, driver_id, status")
          .eq("status", "Ongoing"),
      ]);

      if (dRes.error) throw dRes.error;
      if (aRes.error) throw new Error(aRes.error);

      setMigrationPending(aRes.schemaPendingMigration);

      // Deduplicate drivers cleanly by normalized name keeping profile_id links first
      const dMap = new Map<string, any>();
      (dRes.data || []).forEach((d: any) => {
        const key = (d.name || d.id).trim().toLowerCase();
        if (!dMap.has(key) || (d.profile_id && !dMap.get(key).profile_id)) {
          dMap.set(key, d);
        }
      });

      const vList = vRes.data || [];
      const vStatusById = new Map<string, string>(vList.map((v: any) => [v.id, v.status]));
      const enrichedAssignments = aRes.data.map((a) => ({
        ...a,
        vehicles: a.vehicles
          ? { ...a.vehicles, status: vStatusById.get(a.vehicle_id) || "Idle" }
          : a.vehicles,
      }));

      setDrivers(Array.from(dMap.values()));
      setVehicles(vList);
      setRoutes(filterAssignableRoutes(rRes.data || []));
      setAssignments(enrichedAssignments);
      setOngoingTrips(tRes.data || []);
    } catch (err: any) {
      setLoadError(err?.message || "Failed to load assignments dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    loadAll();

    const channel = supabase
      .channel(`admin-assignments-rt-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicle_assignments" }, () => {
        if (!cancelled) loadAll();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, () => {
        if (!cancelled) loadAll();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, () => {
        if (!cancelled) loadAll();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "collection_routes" }, () => {
        if (!cancelled) loadAll();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => {
        if (!cancelled) loadAll();
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  const kpis = useMemo(
    () => computeAssignmentDashboardKpis(drivers, vehicles, assignments),
    [drivers, vehicles, assignments]
  );

  const activeByDriver = useMemo(() => {
    const map = new Map<string, RouteAssignmentRecord>();
    assignments.forEach((a) => {
      if ((a.is_active || a.status === "Assigned" || a.status === "In Progress") && a.driver_id) {
        map.set(a.driver_id, a);
      }
    });
    return map;
  }, [assignments]);

  const activeByVehicle = useMemo(() => {
    const map = new Map<string, RouteAssignmentRecord>();
    assignments.forEach((a) => {
      if ((a.is_active || a.status === "Assigned" || a.status === "In Progress") && a.vehicle_id) {
        map.set(a.vehicle_id, a);
      }
    });
    return map;
  }, [assignments]);

  const driverOptions: SearchableOption[] = useMemo(
    () =>
      drivers.map((d) => {
        const active = activeByDriver.get(d.id);
        return {
          value: d.id,
          label: d.name,
          sublabel: d.phone || "No mobile number",
          badge: active ? active.status || "Assigned" : "Available",
        };
      }),
    [drivers, activeByDriver]
  );

  const vehicleOptions: SearchableOption[] = useMemo(
    () =>
      vehicles.map((v) => {
        const active = activeByVehicle.get(v.id);
        return {
          value: v.id,
          label: v.number,
          sublabel: `${v.type || "Vehicle"}${v.model ? ` · ${v.model}` : ""}`,
          badge: active ? `Assigned` : v.status || "Available",
        };
      }),
    [vehicles, activeByVehicle]
  );

  const routeOptions: SearchableOption[] = useMemo(
    () =>
      routes.map((r) => {
        const summary = extractRouteSummary(r);
        return {
          value: r.id,
          label: r.name,
          sublabel: summary
            ? `${summary.startPoint} → ${summary.destination} · ${summary.centresCount} centres`
            : "Collection Route",
          badge: summary?.departureTime ? `${summary.departureTime}` : undefined,
        };
      }),
    [routes]
  );

  const selectedDriver = useMemo(
    () => drivers.find((d) => d.id === driverId) || null,
    [drivers, driverId]
  );
  const selectedVehicle = useMemo(
    () => vehicles.find((v) => v.id === vehicleId) || null,
    [vehicles, vehicleId]
  );
  const selectedRouteSummary = useMemo(() => {
    const r = routes.find((x) => x.id === routeId);
    return r ? extractRouteSummary(r) : null;
  }, [routes, routeId]);

  function resetForm() {
    setEditingId(null);
    setDriverId("");
    setVehicleId("");
    setRouteId("");
    setAssignmentDate(getTodayIstDateString());
    setDepartureTime("05:30");
    setNotes("");
    setFormError(null);
  }

  function handleStartEdit(a: RouteAssignmentRecord) {
    setEditingId(a.id);
    setDriverId(a.driver_id || "");
    setVehicleId(a.vehicle_id || "");
    setRouteId(a.route_id || "");
    setAssignmentDate(a.assignment_date || getTodayIstDateString());
    setDepartureTime(a.departure_time || "05:30");
    setNotes(a.notes || "");
    setFormError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSaveAssignment(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) {
      setFormError("Only Admin or Manager roles can manage assignments.");
      return;
    }

    setFormError(null);
    const check = validateAssignmentInput({
      editingAssignmentId: editingId,
      driverId,
      vehicleId,
      routeId,
      assignmentDate,
      departureTime,
      vehicleStatus: selectedVehicle?.status,
      existingAssignments: assignments,
      ongoingTrips,
    });

    if (!check.valid) {
      setFormError(check.error || "Invalid assignment details.");
      return;
    }

    setSaving(true);
    try {
      const res = await saveRouteAssignment(supabase, {
        assignmentId: editingId,
        driverId,
        vehicleId,
        routeId,
        assignmentDate,
        departureTime,
        notes,
      });

      if (!res.ok) {
        setFormError(res.error || "Failed to save assignment.");
        return;
      }

      toast.success(
        editingId
          ? "Assignment updated and synced to Driver Portal!"
          : "Driver, Vehicle & Route assigned successfully!"
      );
      resetForm();
      await loadAll();
    } catch (err: any) {
      setFormError(err?.message || "Failed to save assignment.");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmCancel() {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    try {
      const res = await cancelRouteAssignment(supabase, cancelTarget.id, cancelReason);
      if (!res.ok) {
        toast.error(res.error || "Failed to cancel assignment.");
        return;
      }
      toast.success("Assignment cancelled. Historical record preserved.");
      setCancelTarget(null);
      setCancelReason("");
      if (editingId === cancelTarget.id) resetForm();
      await loadAll();
    } catch (err: any) {
      toast.error(err?.message || "Failed to cancel assignment.");
    } finally {
      setCancelling(false);
    }
  }

  const filteredAssignments = useMemo(() => {
    const todayIst = getTodayIstDateString();
    return assignments.filter((a) => {
      if (dateFilterMode === "today" && a.assignment_date !== todayIst) return false;
      if (dateFilterMode === "upcoming" && a.assignment_date <= todayIst) return false;
      if (dateFilterMode === "custom" && a.assignment_date !== customDateFilter) return false;

      if (driverFilter !== "All" && a.driver_id !== driverFilter) return false;
      if (vehicleFilter !== "All" && a.vehicle_id !== vehicleFilter) return false;
      if (statusFilter !== "All" && a.status !== statusFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const code = formatAssignmentCode(a.id, a.assignment_date).toLowerCase();
        const text = `${code} ${a.drivers?.name || ""} ${a.vehicles?.number || ""} ${a.route_name || a.collection_routes?.name || ""} ${a.status || ""} ${a.notes || ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [
    assignments,
    dateFilterMode,
    customDateFilter,
    driverFilter,
    vehicleFilter,
    statusFilter,
    searchQuery,
  ]);

  if (!canManage) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center space-y-3">
        <ShieldAlert className="h-10 w-10 text-red-500 mx-auto" />
        <h2 className="text-lg font-bold text-slate-900">Restricted Access</h2>
        <p className="text-sm text-slate-600">
          Driver &amp; Route Assignment requires Admin or Fleet Manager authorization.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Driver & Route Assignment"
        subtitle="Dispatch Drivers, Vehicles & Collection Routes · Real-Time Driver Sync"
        actions={
          <Button
            onClick={() => loadAll()}
            className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
            Refresh
          </Button>
        }
      />

      {migrationPending && (
        <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 font-medium flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <strong>Database Migration Pending:</strong> Run{" "}
            <code className="px-1.5 py-0.5 rounded bg-amber-100 font-mono text-[11px]">
              supabase/migrations/20261126110000_driver_route_assignments_and_attendance_reports.sql
            </code>{" "}
            in the Supabase SQL Editor to enable saving route assignments, departure times, and edit/cancel RPCs.
          </div>
        </div>
      )}

      {loadError && (
        <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* ── Summary Cards (6 Real Database Metrics) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Total Drivers", value: kpis.totalDrivers, hint: "Registered roster", icon: UsersRound, color: "text-slate-700" },
          { label: "Available Drivers", value: kpis.availableDrivers, hint: "Ready for dispatch", icon: UserCheck, color: "text-emerald-600" },
          { label: "Assigned Drivers", value: kpis.assignedDrivers, hint: "Currently allocated", icon: ClipboardCheck, color: "text-indigo-600" },
          { label: "Active Assignments", value: kpis.activeAssignments, hint: "Assigned & In Progress", icon: RouteIcon, color: "text-blue-600" },
          { label: "Vehicles Assigned", value: kpis.vehiclesAssigned, hint: "Allocated fleet units", icon: Truck, color: "text-indigo-700" },
          { label: "Unassigned Vehicles", value: kpis.unassignedVehicles, hint: "Available in depot", icon: Truck, color: "text-amber-600" },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <span>{card.label}</span>
                <Icon className={`h-3.5 w-3.5 ${card.color}`} />
              </div>
              <div className="text-2xl font-extrabold text-slate-900 mt-1">
                {loading ? "—" : card.value}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 truncate">{card.hint}</div>
            </div>
          );
        })}
      </div>

      {/* ── Create / Edit Assignment Form ── */}
      <Card className="border border-slate-200/80 p-5 shadow-xs space-y-4 bg-white">
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
              <ClipboardCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {editingId ? "Edit Scheduled Assignment" : "Create New Driver & Route Assignment"}
              </h2>
              <p className="text-xs text-slate-500">
                Select driver, vehicle, collection route, date, and scheduled departure time
              </p>
            </div>
          </div>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-1 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" /> Cancel Edit
            </button>
          )}
        </div>

        <form onSubmit={handleSaveAssignment} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                1. Select Driver *
              </label>
              <SearchableSelect
                ariaLabel="Select Driver"
                value={driverId}
                onChange={(val) => {
                  setDriverId(val);
                  setFormError(null);
                }}
                options={driverOptions}
                placeholder="Search and select driver..."
                searchPlaceholder="Search driver name or phone..."
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                2. Select Vehicle *
              </label>
              <SearchableSelect
                ariaLabel="Select Vehicle"
                value={vehicleId}
                onChange={(val) => {
                  setVehicleId(val);
                  setFormError(null);
                }}
                options={vehicleOptions}
                placeholder="Search and select vehicle..."
                searchPlaceholder="Search reg number, model, type..."
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                3. Select Collection Route *
              </label>
              <SearchableSelect
                ariaLabel="Select Collection Route"
                value={routeId}
                onChange={(val) => {
                  setRouteId(val);
                  const found = routes.find((r) => r.id === val);
                  const parsed = found ? extractRouteSummary(found) : null;
                  if (parsed?.departureTime && !editingId) {
                    setDepartureTime(parsed.departureTime.slice(0, 5));
                  }
                  setFormError(null);
                }}
                options={routeOptions}
                placeholder="Search and select collection route..."
                searchPlaceholder="Search route name or centre..."
              />
            </div>
          </div>

          {/* Live Driver, Vehicle & Route Context Info Cards */}
          {(selectedDriver || selectedVehicle || selectedRouteSummary) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="rounded-xl p-3 bg-slate-50 border border-slate-200/80 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Driver Details</div>
                {selectedDriver ? (
                  <>
                    <div className="font-bold text-slate-900">{selectedDriver.name}</div>
                    <div className="text-slate-600 flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {selectedDriver.phone || "No mobile on file"}
                    </div>
                    <div className="pt-0.5">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          activeByDriver.has(selectedDriver.id)
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}
                      >
                        {activeByDriver.has(selectedDriver.id)
                          ? `Current: ${activeByDriver.get(selectedDriver.id)?.status}`
                          : "Available"}
                      </Badge>
                    </div>
                  </>
                ) : (
                  <div className="text-slate-400">No driver selected</div>
                )}
              </div>

              <div className="rounded-xl p-3 bg-slate-50 border border-slate-200/80 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Vehicle Details</div>
                {selectedVehicle ? (
                  <>
                    <div className="font-bold text-slate-900">{selectedVehicle.number}</div>
                    <div className="text-slate-600">
                      {selectedVehicle.type} {selectedVehicle.model ? `· ${selectedVehicle.model}` : ""}
                    </div>
                    <div className="text-slate-500">
                      Status: <strong>{selectedVehicle.status || "Idle"}</strong> · Odo:{" "}
                      {Number(selectedVehicle.odometer || 0).toLocaleString()} km
                    </div>
                  </>
                ) : (
                  <div className="text-slate-400">No vehicle selected</div>
                )}
              </div>

              <div className="rounded-xl p-3 bg-slate-50 border border-slate-200/80 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Route Details</div>
                {selectedRouteSummary ? (
                  <>
                    <div className="font-bold text-slate-900 truncate" title={selectedRouteSummary.name}>
                      {selectedRouteSummary.name}
                    </div>
                    <div className="text-slate-600 flex items-center gap-1 truncate">
                      <MapPin className="h-3 w-3 text-indigo-500 shrink-0" />
                      <span className="truncate">
                        {selectedRouteSummary.startPoint} → {selectedRouteSummary.destination}
                      </span>
                    </div>
                    <div className="text-slate-500">
                      Collection Centres: <strong>{selectedRouteSummary.centresCount}</strong>
                    </div>
                  </>
                ) : (
                  <div className="text-slate-400">No collection route selected</div>
                )}
              </div>
            </div>
          )}

          {/* Date, Departure Time, Notes & Assign Button */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                4. Assignment Date *
              </label>
              <input
                type="date"
                required
                value={assignmentDate}
                onChange={(e) => {
                  setAssignmentDate(e.target.value);
                  setFormError(null);
                }}
                className="w-full h-[42px] px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                5. Departure Time *
              </label>
              <input
                type="time"
                required
                value={departureTime}
                onChange={(e) => {
                  setDepartureTime(e.target.value);
                  setFormError(null);
                }}
                className="w-full h-[42px] px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                6. Notes (Optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Shift or collection instructions"
                className="w-full h-[42px] px-3 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
              />
            </div>

            <Button
              type="submit"
              disabled={saving}
              className="h-[42px] bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-5 rounded-xl flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  <span>{editingId ? "Update Assignment" : "Assign"}</span>
                </>
              )}
            </Button>
          </div>

          {formError && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700 flex items-start gap-2"
            >
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}
        </form>
      </Card>

      {/* ── Assignment Filters ── */}
      <Card className="border border-slate-200/80 p-3.5 shadow-xs bg-white text-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 font-medium">Date:</span>
            <div className="bg-slate-100 p-0.5 rounded-lg flex items-center font-semibold">
              {[
                { id: "all", label: "All" },
                { id: "today", label: "Today" },
                { id: "upcoming", label: "Upcoming" },
                { id: "custom", label: "Pick Date" },
              ].map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDateFilterMode(d.id as any)}
                  className={`px-2.5 py-1 rounded-md cursor-pointer ${
                    dateFilterMode === d.id ? "bg-white text-slate-900 shadow-2xs font-bold" : "text-slate-600"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {dateFilterMode === "custom" && (
              <input
                type="date"
                value={customDateFilter}
                onChange={(e) => setCustomDateFilter(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 font-semibold text-slate-800"
              />
            )}
          </div>

          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 min-w-[220px]">
            <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search ID, driver, reg no, route..."
              className="bg-transparent outline-none text-xs text-slate-800 w-full"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-medium">Driver:</span>
            <select
              value={driverFilter}
              onChange={(e) => setDriverFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-800"
            >
              <option value="All">All Drivers</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-medium">Vehicle:</span>
            <select
              value={vehicleFilter}
              onChange={(e) => setVehicleFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-800"
            >
              <option value="All">All Vehicles</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
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
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-800"
            >
              <option value="All">All Statuses</option>
              <option value="Scheduled">Scheduled</option>
              <option value="Assigned">Assigned</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => {
              setDateFilterMode("all");
              setDriverFilter("All");
              setVehicleFilter("All");
              setStatusFilter("All");
              setSearchQuery("");
            }}
            className="ml-auto px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      </Card>

      {/* ── Assignment Management Table ── */}
      <Card className="border border-slate-200/80 p-5 shadow-xs bg-white">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-900">
            Assignment Management Ledger ({filteredAssignments.length})
          </h3>
          <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> Historical records preserved
          </span>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="space-y-2.5 py-2">
              {Array.from({ length: 5 }).map((_, idx) => (
                <div key={idx} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : filteredAssignments.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No assignments match your current filters.
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                  <th className="py-2.5 px-3 whitespace-nowrap">Assignment ID</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Driver</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Vehicle</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Registration No</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Collection Route</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Assignment Date</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Departure Time</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAssignments.map((a) => {
                  const canEditOrCancel = a.status === "Scheduled" || a.status === "Assigned";
                  const routeLabel = a.route_name || a.collection_routes?.name || a.vehicles?.route || "—";
                  return (
                    <tr key={a.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3 font-mono font-bold text-slate-800 whitespace-nowrap">
                        {formatAssignmentCode(a.id, a.assignment_date)}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="font-bold text-slate-900">{a.drivers?.name || "—"}</div>
                        {a.drivers?.phone && (
                          <div className="text-[10px] text-slate-400">{a.drivers.phone}</div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                        {a.vehicles?.type || "Tanker"}
                        {a.vehicles?.model ? ` · ${a.vehicles.model}` : ""}
                      </td>
                      <td className="py-3 px-3 font-extrabold text-slate-900 whitespace-nowrap">
                        {a.vehicles?.number || "—"}
                      </td>
                      <td className="py-3 px-3 text-slate-700 max-w-[200px] truncate" title={routeLabel}>
                        {routeLabel}
                      </td>
                      <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-slate-400" />
                          {a.assignment_date}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 font-medium">
                          <Clock className="h-3 w-3 text-slate-400" />
                          {a.departure_time || "05:30"} IST
                        </span>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <Badge variant="outline" className={`text-[10px] ${statusBadgeStyle(a.status)}`}>
                          {a.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {canEditOrCancel ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleStartEdit(a)}
                              className="px-2.5 py-1 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Edit3 className="h-3 w-3" /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCancelTarget(a);
                                setCancelReason("");
                              }}
                              className="px-2.5 py-1 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <XCircle className="h-3 w-3" /> Cancel
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] font-semibold text-slate-400">
                            {a.status === "In Progress" ? "Active Trip" : "Locked History"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* ── Cancel Assignment Modal ── */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="font-bold text-sm text-slate-900">Cancel Assignment</div>
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <p className="text-slate-600">
                Are you sure you want to cancel assignment{" "}
                <strong>{formatAssignmentCode(cancelTarget.id, cancelTarget.assignment_date)}</strong>{" "}
                for driver <strong>{cancelTarget.drivers?.name}</strong> ({" "}
                <strong>{cancelTarget.vehicles?.number}</strong>)? The historical record will remain preserved.
              </p>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Reason (Optional)</label>
                <input
                  type="text"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Driver on leave / Vehicle reallocated"
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCancelTarget(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 font-semibold cursor-pointer"
                >
                  Keep Assignment
                </button>
                <button
                  type="button"
                  disabled={cancelling}
                  onClick={handleConfirmCancel}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {cancelling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Confirm Cancellation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
