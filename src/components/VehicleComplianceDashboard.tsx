import { useState, useEffect, useMemo } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  Truck,
  Search,
  Filter,
  ArrowUpDown,
  Eye,
  Edit2,
  RefreshCw,
  Loader2,
  Calendar,
  CheckCircle2,
  Layers,
  ChevronDown,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { type VehicleComplianceRecord, type ComplianceStatus } from "@/lib/types";
import {
  calculateItemStatus,
  calculateOverallVehicleStatus,
  formatComplianceDate,
  resolveVehicleGroup,
  COMPLIANCE_STATUS_UI,
  DEFAULT_COMPLIANCE_WARNING_DAYS,
  type ComplianceItemStatus,
} from "@/lib/compliance";
import { Kpi, Card, Button } from "@/components/ui-kit";
import { ComplianceDetailModal } from "./ComplianceDetailModal";
import { ComplianceEditModal } from "./ComplianceEditModal";

export function VehicleComplianceDashboard() {
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "manager";

  // Data state
  const [records, setRecords] = useState<VehicleComplianceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [isMigrationPending, setIsMigrationPending] = useState(false);
  const [warningDays, setWarningDays] = useState(DEFAULT_COMPLIANCE_WARNING_DAYS);

  // Filters, search, sort, and display state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [groupFilter, setGroupFilter] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<"number" | "fcExpiry" | "pollution" | "insurance" | "status">("number");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [groupByCategory, setGroupByCategory] = useState(true);

  // Modals state
  const [viewRecord, setViewRecord] = useState<VehicleComplianceRecord | null>(null);
  const [editRecord, setEditRecord] = useState<VehicleComplianceRecord | null>(null);

  // Toast / notification banner state
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  };

  // ── 1. Batch Load Real Data ───────────────────────────────────────
  async function loadData(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setDbError(null);

    try {
      // Step A: Load fleet settings if available to get configurable threshold
      try {
        const { data: settingsData } = await supabase
          .from("settings")
          .select("compliance_warning_days")
          .limit(1)
          .maybeSingle();

        if (settingsData?.compliance_warning_days) {
          setWarningDays(settingsData.compliance_warning_days);
        }
      } catch {
        // Fallback to default threshold
      }

      // Step B: Batch query vehicles and compliance records in parallel
      const [vehiclesRes, complianceRes] = await Promise.all([
        supabase.from("vehicles").select("*").order("number"),
        supabase.from("vehicle_compliance").select("*"),
      ]);

      if (vehiclesRes.error) {
        throw new Error(vehiclesRes.error.message || "Failed to load vehicles from Supabase.");
      }

      const vehicles = vehiclesRes.data || [];
      let complianceRows: any[] = [];

      if (complianceRes.error) {
        // Check if table missing in schema cache (migration pending)
        const errMsg = complianceRes.error.message || "";
        const errCode = (complianceRes.error as any).code || "";
        if (
          errMsg.includes("vehicle_compliance") ||
          errMsg.includes("schema cache") ||
          errMsg.includes("does not exist") ||
          errCode === "PGRST205" ||
          errCode === "42P01"
        ) {
          setIsMigrationPending(true);
          console.warn("[Compliance] vehicle_compliance table not found in schema cache. Migration pending.");
        } else {
          console.warn("[Compliance] Compliance query warning:", errMsg);
        }
      } else {
        complianceRows = complianceRes.data || [];
        setIsMigrationPending(false);
      }

      // Map compliance rows by vehicle_id
      const complianceMap = new Map<string, any>();
      for (const row of complianceRows) {
        complianceMap.set(row.vehicle_id, row);
      }

      // Merge real vehicle dataset with real compliance records
      const mapped: VehicleComplianceRecord[] = vehicles.map((v) => {
        const c = complianceMap.get(v.id);
        const group = resolveVehicleGroup(v.model, v.type);

        const fcInspectionDate = c?.fc_inspection_date || null;
        const fcExpiryDate = c?.fc_expiry_date || null;
        const tnPermitExpiry = c?.tn_permit_expiry || null;
        const klPermitExpiry = c?.kl_permit_expiry || null;
        const tnTaxExpiry = c?.tn_tax_expiry || null;
        const klTaxExpiry = c?.kl_tax_expiry || null;
        const pollutionExpiry = c?.pollution_expiry || null;
        const foodSafetyExpiry = c?.food_safety_expiry || null;
        const insuranceExpiry = c?.insurance_expiry || v.insurance_expiry || null;
        const advertisementExpiry = c?.advertisement_expiry || null;

        // Calculate item statuses dynamically against real date
        const itemStatuses = [
          { status: calculateItemStatus(fcExpiryDate, warningDays), isMandatory: true },
          { status: calculateItemStatus(tnPermitExpiry, warningDays), isMandatory: true },
          { status: calculateItemStatus(klPermitExpiry, warningDays), isMandatory: false },
          { status: calculateItemStatus(tnTaxExpiry, warningDays), isMandatory: true },
          { status: calculateItemStatus(klTaxExpiry, warningDays), isMandatory: false },
          { status: calculateItemStatus(pollutionExpiry, warningDays), isMandatory: true },
          { status: calculateItemStatus(foodSafetyExpiry, warningDays), isMandatory: false },
          { status: calculateItemStatus(insuranceExpiry, warningDays), isMandatory: true },
          { status: calculateItemStatus(advertisementExpiry, warningDays), isMandatory: false },
        ];

        const overallStatus = calculateOverallVehicleStatus(itemStatuses);

        return {
          id: c?.id,
          vehicleId: v.id,
          vehicleNo: v.number,
          model: v.model,
          type: v.type,
          vehicleGroup: group,
          fcInspectionDate,
          fcExpiryDate,
          tnPermitExpiry,
          klPermitExpiry,
          tnTaxExpiry,
          klTaxExpiry,
          pollutionExpiry,
          foodSafetyExpiry,
          insuranceExpiry,
          advertisementExpiry,
          overallStatus,
          createdAt: c?.created_at,
          updatedAt: c?.updated_at,
          createdBy: c?.created_by,
          updatedBy: c?.updated_by,
        };
      });

      setRecords(mapped);
    } catch (err: any) {
      console.error("Error loading compliance data:", err);
      setDbError(err.message || "Failed to load compliance data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // ── 2. Realtime Subscription ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    loadData();

    // Subscribe to realtime postgres_changes on vehicle_compliance
    const channel = supabase
      .channel("vehicle-compliance-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vehicle_compliance" },
        (payload) => {
          if (cancelled) return;
          const updatedRow = payload.new as any;
          if (!updatedRow || !updatedRow.vehicle_id) {
            loadData(true);
            return;
          }

          // In-place selective state update without full refetch
          setRecords((prev) =>
            prev.map((rec) => {
              if (rec.vehicleId !== updatedRow.vehicle_id) return rec;

              const fcExp = updatedRow.fc_expiry_date || null;
              const tnPerm = updatedRow.tn_permit_expiry || null;
              const klPerm = updatedRow.kl_permit_expiry || null;
              const tnTax = updatedRow.tn_tax_expiry || null;
              const klTax = updatedRow.kl_tax_expiry || null;
              const poll = updatedRow.pollution_expiry || null;
              const food = updatedRow.food_safety_expiry || null;
              const ins = updatedRow.insurance_expiry || null;
              const adv = updatedRow.advertisement_expiry || null;

              const itemStatuses = [
                { status: calculateItemStatus(fcExp, warningDays), isMandatory: true },
                { status: calculateItemStatus(tnPerm, warningDays), isMandatory: true },
                { status: calculateItemStatus(klPerm, warningDays), isMandatory: false },
                { status: calculateItemStatus(tnTax, warningDays), isMandatory: true },
                { status: calculateItemStatus(klTax, warningDays), isMandatory: false },
                { status: calculateItemStatus(poll, warningDays), isMandatory: true },
                { status: calculateItemStatus(food, warningDays), isMandatory: false },
                { status: calculateItemStatus(ins, warningDays), isMandatory: true },
                { status: calculateItemStatus(adv, warningDays), isMandatory: false },
              ];

              return {
                ...rec,
                id: updatedRow.id,
                fcInspectionDate: updatedRow.fc_inspection_date || null,
                fcExpiryDate: fcExp,
                tnPermitExpiry: tnPerm,
                klPermitExpiry: klPerm,
                tnTaxExpiry: tnTax,
                klTaxExpiry: klTax,
                pollutionExpiry: poll,
                foodSafetyExpiry: food,
                insuranceExpiry: ins,
                advertisementExpiry: adv,
                overallStatus: calculateOverallVehicleStatus(itemStatuses),
                updatedAt: updatedRow.updated_at,
                updatedBy: updatedRow.updated_by,
              };
            })
          );
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      channel.unsubscribe();
    };
  }, [warningDays]);

  // ── 3. Handle Saved Record from Edit Modal ─────────────────────────
  const handleRecordSaved = (updated: VehicleComplianceRecord) => {
    setRecords((prev) =>
      prev.map((r) => (r.vehicleId === updated.vehicleId ? updated : r))
    );
    showToast(`Compliance updated for vehicle ${updated.vehicleNo}`);
  };

  // ── 4. Dynamic Summary Counts (Calculated dynamically) ────────────
  const summaryCounts = useMemo(() => {
    const total = records.length;
    let compliant = 0;
    let expiring = 0;
    let expired = 0;
    let notApplicable = 0;

    for (const r of records) {
      if (r.overallStatus === "VALID") compliant++;
      else if (r.overallStatus === "EXPIRING_SOON") expiring++;
      else if (r.overallStatus === "EXPIRED") expired++;
      else notApplicable++;
    }

    return { total, compliant, expiring, expired, notApplicable };
  }, [records]);

  // ── 5. Distinct Vehicle Groups from Real Dataset ──────────────────
  const distinctGroups = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => {
      if (r.vehicleGroup) set.add(r.vehicleGroup);
    });
    return Array.from(set).sort();
  }, [records]);

  // ── 6. Filtering & Searching ──────────────────────────────────────
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      // Status filter
      if (statusFilter !== "ALL" && r.overallStatus !== statusFilter) {
        return false;
      }

      // Group filter
      if (groupFilter !== "ALL" && r.vehicleGroup !== groupFilter) {
        return false;
      }

      // Realtime search by vehicle number, model, group
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesNo = r.vehicleNo.toLowerCase().includes(query);
        const matchesModel = (r.model || "").toLowerCase().includes(query);
        const matchesGroup = (r.vehicleGroup || "").toLowerCase().includes(query);
        const matchesType = (r.type || "").toLowerCase().includes(query);
        if (!matchesNo && !matchesModel && !matchesGroup && !matchesType) {
          return false;
        }
      }

      return true;
    });
  }, [records, statusFilter, groupFilter, searchQuery]);

  // ── 7. Deterministic Sorting ──────────────────────────────────────
  const sortedRecords = useMemo(() => {
    return [...filteredRecords].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "number") {
        cmp = a.vehicleNo.localeCompare(b.vehicleNo);
      } else if (sortBy === "fcExpiry") {
        const da = a.fcExpiryDate || "9999-99-99";
        const db = b.fcExpiryDate || "9999-99-99";
        cmp = da.localeCompare(db);
      } else if (sortBy === "pollution") {
        const da = a.pollutionExpiry || "9999-99-99";
        const db = b.pollutionExpiry || "9999-99-99";
        cmp = da.localeCompare(db);
      } else if (sortBy === "insurance") {
        const da = a.insuranceExpiry || "9999-99-99";
        const db = b.insuranceExpiry || "9999-99-99";
        cmp = da.localeCompare(db);
      } else if (sortBy === "status") {
        const orderWeight: Record<ComplianceStatus, number> = {
          EXPIRED: 1,
          EXPIRING_SOON: 2,
          VALID: 3,
          NOT_APPLICABLE: 4,
        };
        cmp = orderWeight[a.overallStatus] - orderWeight[b.overallStatus];
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [filteredRecords, sortBy, sortOrder]);

  // ── 8. Grouping by Vehicle Category (Reference Checklist Style) ───
  const groupedData = useMemo(() => {
    if (!groupByCategory) {
      return [{ group: "All Vehicles", items: sortedRecords }];
    }

    const groupsMap = new Map<string, VehicleComplianceRecord[]>();
    for (const r of sortedRecords) {
      const g = r.vehicleGroup || "OTHER";
      if (!groupsMap.has(g)) groupsMap.set(g, []);
      groupsMap.get(g)!.push(r);
    }

    const result: { group: string; items: VehicleComplianceRecord[] }[] = [];
    groupsMap.forEach((items, group) => {
      result.push({ group, items });
    });

    return result.sort((a, b) => a.group.localeCompare(b.group));
  }, [sortedRecords, groupByCategory]);

  const toggleSort = (key: typeof sortBy) => {
    if (sortBy === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortOrder("asc");
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 bg-emerald-700 text-white px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 text-sm font-medium animate-in fade-in slide-in-from-bottom-3 duration-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Database Error Banner */}
      {dbError && (
        <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{dbError}</span>
          </div>
          <Button size="sm" variant="outline" onClick={() => loadData(true)}>
            Retry
          </Button>
        </div>
      )}

      {/* Migration Pending Banner */}
      {isMigrationPending && (
        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-start sm:items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <span className="font-semibold text-amber-950 dark:text-amber-100">Database Migration Pending: </span>
              <span>
                The <code className="font-mono bg-amber-500/20 px-1 py-0.5 rounded">vehicle_compliance</code> table and settings column are not yet created in Supabase.
                Run <code className="font-mono bg-amber-500/20 px-1 py-0.5 rounded">supabase/migrations/20261006130000_create_vehicle_compliance.sql</code> in your Supabase SQL Editor.
              </span>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-500/40 hover:bg-amber-500/15 text-amber-950 dark:text-amber-100 shrink-0"
            onClick={() => loadData(true)}
          >
            Check Again
          </Button>
        </div>
      )}

      {/* ── Summary KPI Cards ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Total Vehicles"
          value={loading ? "…" : summaryCounts.total}
          icon={<Truck className="h-5 w-5" />}
          hint="Active fleet units"
        />
        <Kpi
          label="Compliant"
          value={loading ? "…" : summaryCounts.compliant}
          accent="success"
          icon={<ShieldCheck className="h-5 w-5" />}
          hint="All statutory items valid"
        />
        <Kpi
          label="Expiring Soon"
          value={loading ? "…" : summaryCounts.expiring}
          accent="warning"
          icon={<AlertTriangle className="h-5 w-5" />}
          hint={`Within ${warningDays} days window`}
        />
        <Kpi
          label="Expired"
          value={loading ? "…" : summaryCounts.expired}
          accent="destructive"
          icon={<AlertCircle className="h-5 w-5" />}
          hint="Action required immediately"
        />
      </div>

      {/* ── Filter Bar & Controls ───────────────────────────────────── */}
      <Card className="p-4 space-y-3.5">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search box */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/60" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by vehicle number, model, or group…"
              className="w-full h-9 pl-9 pr-3 rounded-xl border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>

          {/* Group and Warning Controls */}
          <div className="flex flex-wrap items-center gap-2 justify-end">
            {/* Vehicle Group Filter */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground hidden sm:inline">Group:</span>
              <select
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                className="h-9 px-2.5 rounded-xl border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="ALL">All Groups</option>
                {distinctGroups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            {/* Configurable Warning Window */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground hidden sm:inline" title="Warning window threshold">
                Window:
              </span>
              <select
                value={warningDays}
                onChange={(e) => setWarningDays(Number(e.target.value))}
                className="h-9 px-2 rounded-xl border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                title="Configurable Expiring Soon window"
              >
                <option value={15}>15 Days</option>
                <option value={30}>30 Days (Default)</option>
                <option value={45}>45 Days</option>
                <option value={60}>60 Days</option>
                <option value={90}>90 Days</option>
              </select>
            </div>

            {/* Toggle Grouping */}
            <Button
              size="sm"
              variant={groupByCategory ? "primary" : "outline"}
              onClick={() => setGroupByCategory(!groupByCategory)}
              className="text-xs"
              title="Group rows by model category"
            >
              <Layers className="h-3.5 w-3.5 mr-1" />
              {groupByCategory ? "Categorized" : "Flat Table"}
            </Button>

            {/* Refresh button */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => loadData(true)}
              disabled={refreshing}
              className="text-xs"
              title="Refresh compliance records"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/60">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mr-1">
            Status:
          </span>
          {[
            { key: "ALL", label: `All (${summaryCounts.total})` },
            { key: "VALID", label: `Valid (${summaryCounts.compliant})` },
            { key: "EXPIRING_SOON", label: `Expiring Soon (${summaryCounts.expiring})` },
            { key: "EXPIRED", label: `Expired (${summaryCounts.expired})` },
            { key: "NOT_APPLICABLE", label: `N/A (${summaryCounts.notApplicable})` },
          ].map((tab) => {
            const isActive = statusFilter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1 text-xs rounded-lg font-medium transition-all ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </Card>

      {/* ── Main Compliance Table ───────────────────────────────────── */}
      {loading ? (
        <Card className="p-12 flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <div className="text-sm font-medium text-foreground">Loading compliance records…</div>
          <div className="text-xs text-muted-foreground">Checking statutory expiry dates</div>
        </Card>
      ) : records.length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <Truck className="h-10 w-10 text-muted-foreground/40 mx-auto" />
          <h3 className="text-base font-semibold text-foreground">No vehicles found</h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            No fleet vehicles are registered in the system yet.
          </p>
        </Card>
      ) : sortedRecords.length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <Filter className="h-10 w-10 text-muted-foreground/40 mx-auto" />
          <h3 className="text-base font-semibold text-foreground">No matching compliance records</h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            No vehicles match the selected filter or search term. Try resetting the filters.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSearchQuery("");
              setStatusFilter("ALL");
              setGroupFilter("ALL");
            }}
          >
            Reset Filters
          </Button>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupedData.map((groupSection, sectionIdx) => (
            <Card key={sectionIdx} className="overflow-hidden border border-border">
              {/* Category Group Header (Reference image style: TARRUS, ECOMET, BOSS, TATA - 709) */}
              {groupByCategory && (
                <div className="px-5 py-3 bg-muted/40 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="font-bold text-sm tracking-tight text-foreground uppercase">
                      {groupSection.group}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-md bg-primary/10 text-primary">
                      {groupSection.items.length} {groupSection.items.length === 1 ? "vehicle" : "vehicles"}
                    </span>
                  </div>
                </div>
              )}

              {/* Horizontally scrollable table container */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead>
                    <tr className="bg-muted/60 text-muted-foreground font-semibold border-b border-border uppercase tracking-wider text-[10px] select-none">
                      <th
                        className="py-3 px-4 cursor-pointer hover:text-foreground sticky left-0 bg-muted/90 backdrop-blur-xs z-10 shadow-xs"
                        onClick={() => toggleSort("number")}
                      >
                        <div className="flex items-center gap-1.5">
                          <span>Vehicle No</span>
                          <ArrowUpDown className="h-3 w-3 opacity-60" />
                        </div>
                      </th>
                      <th className="py-3 px-3">Model / Group</th>
                      <th className="py-3 px-3">FC Insp.</th>
                      <th
                        className="py-3 px-3 cursor-pointer hover:text-foreground"
                        onClick={() => toggleSort("fcExpiry")}
                      >
                        <div className="flex items-center gap-1">
                          <span>FC Expiry</span>
                          <ArrowUpDown className="h-3 w-3 opacity-60" />
                        </div>
                      </th>
                      <th className="py-3 px-3">TN Permit</th>
                      <th className="py-3 px-3">KL Permit</th>
                      <th className="py-3 px-3">TN Tax</th>
                      <th className="py-3 px-3">KL Tax</th>
                      <th
                        className="py-3 px-3 cursor-pointer hover:text-foreground"
                        onClick={() => toggleSort("pollution")}
                      >
                        <div className="flex items-center gap-1">
                          <span>Pollution</span>
                          <ArrowUpDown className="h-3 w-3 opacity-60" />
                        </div>
                      </th>
                      <th className="py-3 px-3">Food Safety</th>
                      <th
                        className="py-3 px-3 cursor-pointer hover:text-foreground"
                        onClick={() => toggleSort("insurance")}
                      >
                        <div className="flex items-center gap-1">
                          <span>Insurance</span>
                          <ArrowUpDown className="h-3 w-3 opacity-60" />
                        </div>
                      </th>
                      <th className="py-3 px-3">Advertisement</th>
                      <th
                        className="py-3 px-3 cursor-pointer hover:text-foreground text-center"
                        onClick={() => toggleSort("status")}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>Overall Status</span>
                          <ArrowUpDown className="h-3 w-3 opacity-60" />
                        </div>
                      </th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {groupSection.items.map((row) => {
                      const fcStatus = calculateItemStatus(row.fcExpiryDate, warningDays);
                      const tnPermitStatus = calculateItemStatus(row.tnPermitExpiry, warningDays);
                      const klPermitStatus = calculateItemStatus(row.klPermitExpiry, warningDays);
                      const tnTaxStatus = calculateItemStatus(row.tnTaxExpiry, warningDays);
                      const klTaxStatus = calculateItemStatus(row.klTaxExpiry, warningDays);
                      const pollutionStatus = calculateItemStatus(row.pollutionExpiry, warningDays);
                      const foodStatus = calculateItemStatus(row.foodSafetyExpiry, warningDays);
                      const insuranceStatus = calculateItemStatus(row.insuranceExpiry, warningDays);
                      const advStatus = calculateItemStatus(row.advertisementExpiry, warningDays);

                      const overallUi = COMPLIANCE_STATUS_UI[row.overallStatus];

                      return (
                        <tr
                          key={row.vehicleId}
                          className="hover:bg-muted/30 transition-colors"
                        >
                          {/* Vehicle Number (Sticky column for tablet/mobile readability) */}
                          <td className="py-3 px-4 sticky left-0 bg-card z-10 font-mono font-bold text-foreground">
                            <div className="flex items-center gap-2">
                              <span>{row.vehicleNo}</span>
                            </div>
                          </td>

                          {/* Model / Group */}
                          <td className="py-3 px-3 text-muted-foreground">
                            <div className="max-w-[130px] truncate" title={row.model || row.type}>
                              <span className="font-semibold text-foreground mr-1">
                                {row.vehicleGroup}
                              </span>
                              <span className="text-[10px] opacity-75">
                                ({row.model || row.type})
                              </span>
                            </div>
                          </td>

                          {/* FC Inspection Date */}
                          <td className="py-3 px-3 font-mono text-muted-foreground">
                            {formatComplianceDate(row.fcInspectionDate)}
                          </td>

                          {/* FC Expiry */}
                          <td className="py-3 px-3">
                            <ComplianceCell dateStr={row.fcExpiryDate} status={fcStatus} />
                          </td>

                          {/* TN Permit */}
                          <td className="py-3 px-3">
                            <ComplianceCell dateStr={row.tnPermitExpiry} status={tnPermitStatus} />
                          </td>

                          {/* KL Permit */}
                          <td className="py-3 px-3">
                            <ComplianceCell dateStr={row.klPermitExpiry} status={klPermitStatus} />
                          </td>

                          {/* TN Tax */}
                          <td className="py-3 px-3">
                            <ComplianceCell dateStr={row.tnTaxExpiry} status={tnTaxStatus} />
                          </td>

                          {/* KL Tax */}
                          <td className="py-3 px-3">
                            <ComplianceCell dateStr={row.klTaxExpiry} status={klTaxStatus} />
                          </td>

                          {/* Pollution */}
                          <td className="py-3 px-3">
                            <ComplianceCell dateStr={row.pollutionExpiry} status={pollutionStatus} />
                          </td>

                          {/* Food Safety */}
                          <td className="py-3 px-3">
                            <ComplianceCell dateStr={row.foodSafetyExpiry} status={foodStatus} />
                          </td>

                          {/* Insurance */}
                          <td className="py-3 px-3">
                            <ComplianceCell dateStr={row.insuranceExpiry} status={insuranceStatus} />
                          </td>

                          {/* Advertisement */}
                          <td className="py-3 px-3">
                            <ComplianceCell dateStr={row.advertisementExpiry} status={advStatus} />
                          </td>

                          {/* Overall Status */}
                          <td className="py-3 px-3 text-center">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold rounded-full border ring-1 ring-inset ${overallUi.badgeCls}`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${overallUi.dotCls}`} />
                              {overallUi.label}
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setViewRecord(row)}
                                className="h-7 px-2 text-[11px]"
                                title="View detailed compliance summary"
                              >
                                <Eye className="h-3 w-3 mr-1" /> View
                              </Button>
                              {canManage && (
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={() => setEditRecord(row)}
                                  className="h-7 px-2 text-[11px]"
                                  title="Edit compliance dates"
                                >
                                  <Edit2 className="h-3 w-3 mr-1" /> Edit
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── View Detail Modal ───────────────────────────────────────── */}
      <ComplianceDetailModal
        record={viewRecord}
        warningDays={warningDays}
        canManage={canManage}
        onClose={() => setViewRecord(null)}
        onEdit={(rec) => setEditRecord(rec)}
      />

      {/* ── Edit Modal ──────────────────────────────────────────────── */}
      <ComplianceEditModal
        record={editRecord}
        warningDays={warningDays}
        onClose={() => setEditRecord(null)}
        onSaved={handleRecordSaved}
      />
    </div>
  );
}

/**
 * Reusable table cell displaying formatted date and status badge/coloring
 */
function ComplianceCell({
  dateStr,
  status,
}: {
  dateStr: string | null | undefined;
  status: ComplianceItemStatus;
}) {
  const formatted = formatComplianceDate(dateStr);
  if (!dateStr || status === "NOT_APPLICABLE") {
    return <span className="text-muted-foreground/50 font-mono">N/A</span>;
  }

  const ui = COMPLIANCE_STATUS_UI[status];

  return (
    <div className="flex items-center gap-1.5 font-mono">
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${ui.dotCls}`}
        title={`Status: ${ui.label}`}
      />
      <span
        className={
          status === "EXPIRED"
            ? "text-red-600 font-semibold"
            : status === "EXPIRING_SOON"
            ? "text-amber-700 font-medium"
            : "text-foreground"
        }
      >
        {formatted}
      </span>
    </div>
  );
}
