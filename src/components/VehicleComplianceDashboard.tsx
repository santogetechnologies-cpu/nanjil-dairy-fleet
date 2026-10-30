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
  Clock,
  Download,
  Plus,
  X,
  HelpCircle,
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
  const [groupFilter, setGroupFilter] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<"number" | "fcExpiry" | "pollution" | "insurance">("number");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [groupByCategory, setGroupByCategory] = useState(true);

  // Modals state
  const [viewRecord, setViewRecord] = useState<VehicleComplianceRecord | null>(null);
  const [editRecord, setEditRecord] = useState<VehicleComplianceRecord | null>(null);
  const [showQuickSelect, setShowQuickSelect] = useState(false);
  const [quickSelectSearch, setQuickSelectSearch] = useState("");

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
        const errMsg = complianceRes.error.message || "";
        const isTableMissing =
          errMsg.includes("vehicle_compliance") &&
          (errMsg.includes("schema cache") || errMsg.includes("does not exist"));

        if (isTableMissing) {
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

        // Calculate item statuses dynamically against real current date
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
    const channelId = `vehicle-compliance-realtime-${Math.random().toString(36).substring(2, 9)}`;
    const channel = supabase
      .channel(channelId)
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
      supabase.removeChannel(channel);
    };
  }, [warningDays]);

  // ── 3. Handle Saved Record from Edit Modal ─────────────────────────
  const handleRecordSaved = (updated: VehicleComplianceRecord) => {
    setRecords((prev) =>
      prev.map((r) => (r.vehicleId === updated.vehicleId ? updated : r))
    );
    showToast(`Compliance updated for vehicle ${updated.vehicleNo}`);
  };



  // ── 4. Distinct Vehicle Groups ────────────────────────────────────
  const distinctGroups = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => {
      if (r.vehicleGroup) set.add(r.vehicleGroup);
    });
    return Array.from(set).sort();
  }, [records]);

  // ── 5. Filtering & Searching ──────────────────────────────────────
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
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
  }, [records, groupFilter, searchQuery]);

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
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [filteredRecords, sortBy, sortOrder]);

  // ── 8. Grouping by Vehicle Category ───────────────────────────────
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

  // ── 9. Export to CSV Function ─────────────────────────────────────
  const exportToCsv = () => {
    if (records.length === 0) {
      showToast("No records available to export.");
      return;
    }

    const headers = [
      "Vehicle No",
      "Model",
      "Type",
      "Vehicle Group",
      "FC Inspection Date",
      "FC Expiry Date",
      "TN Permit Expiry",
      "KL Permit Expiry",
      "TN Tax Expiry",
      "KL Tax Expiry",
      "Pollution Expiry",
      "Food Safety Expiry",
      "Insurance Expiry",
      "Advertisement Expiry",
    ];

    const rows = sortedRecords.map((r) => [
      r.vehicleNo,
      r.model || "",
      r.type || "",
      r.vehicleGroup || "",
      formatComplianceDate(r.fcInspectionDate),
      formatComplianceDate(r.fcExpiryDate),
      formatComplianceDate(r.tnPermitExpiry),
      formatComplianceDate(r.klPermitExpiry),
      formatComplianceDate(r.tnTaxExpiry),
      formatComplianceDate(r.klTaxExpiry),
      formatComplianceDate(r.pollutionExpiry),
      formatComplianceDate(r.foodSafetyExpiry),
      formatComplianceDate(r.insuranceExpiry),
      formatComplianceDate(r.advertisementExpiry),
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nanjil_vehicle_compliance_${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Compliance report exported to CSV successfully.");
  };

  const exportComplianceCsv = exportToCsv;

  // Quick Select list for adding/editing any vehicle
  const quickSelectVehicles = useMemo(() => {
    if (!quickSelectSearch.trim()) return records;
    const q = quickSelectSearch.toLowerCase().trim();
    return records.filter(
      (r) =>
        r.vehicleNo.toLowerCase().includes(q) ||
        (r.model || "").toLowerCase().includes(q) ||
        (r.vehicleGroup || "").toLowerCase().includes(q)
    );
  }, [records, quickSelectSearch]);

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

      {/* ── Fleet Overview Summary Cards ─────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Total Vehicles"
          value={loading ? "…" : records.length}
          icon={<Truck className="h-5 w-5" />}
          hint="Active fleet units"
        />
        <Kpi
          label="Fleet Categories"
          value={loading ? "…" : distinctGroups.length}
          accent="info"
          icon={<Layers className="h-5 w-5" />}
          hint="Vehicle model groups"
        />
        <Kpi
          label="Statutory Checks"
          value="10"
          accent="primary"
          icon={<ShieldCheck className="h-5 w-5" />}
          hint="FC, Permits, Tax, PUC, Ins."
        />
        <Kpi
          label="Renewal Window"
          value={`${warningDays} Days`}
          accent="warning"
          icon={<Calendar className="h-5 w-5" />}
          hint="Expiring soon window"
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
            {/* Quick action buttons */}
            {canManage && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setQuickSelectSearch("");
                  setShowQuickSelect(true);
                }}
                className="text-xs"
                title="Select a vehicle to log or edit compliance"
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Log Compliance
              </Button>
            )}

            <Button
              size="sm"
              variant="outline"
              onClick={exportToCsv}
              className="text-xs"
              title="Download complete compliance matrix as CSV"
            >
              <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
            </Button>

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
              {groupByCategory ? "Categorized" : "Flat"}
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
            No vehicles match the selected search or group criteria.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSearchQuery("");
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
                      <th className="py-3 px-4 text-right w-24 min-w-[90px]">Actions</th>
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
                      const hasDates = Boolean(row.fcExpiryDate || row.insuranceExpiry || row.pollutionExpiry);

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
                            <div className="max-w-[140px] truncate" title={row.model || row.type}>
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

                          {/* Actions */}
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="icon"
                                variant="outline"
                                onClick={() => setViewRecord(row)}
                                className="h-8 w-8 text-muted-foreground hover:text-foreground cursor-pointer"
                                title={`View detailed compliance summary for ${row.vehicleNo}`}
                                aria-label={`View compliance for ${row.vehicleNo}`}
                              >
                                <Eye className="h-4 w-4 shrink-0" />
                              </Button>
                              {canManage && (
                                <Button
                                  size="icon"
                                  variant={hasDates ? "outline" : "primary"}
                                  onClick={() => setEditRecord(row)}
                                  className={`h-8 w-8 cursor-pointer ${
                                    hasDates
                                      ? "text-muted-foreground hover:text-primary hover:border-primary/40"
                                      : "text-white"
                                  }`}
                                  title={
                                    hasDates
                                      ? `Edit compliance dates for ${row.vehicleNo}`
                                      : `Log compliance dates for ${row.vehicleNo}`
                                  }
                                  aria-label={
                                    hasDates
                                      ? `Edit compliance for ${row.vehicleNo}`
                                      : `Log compliance for ${row.vehicleNo}`
                                  }
                                >
                                  {hasDates ? (
                                    <Edit2 className="h-4 w-4 shrink-0" />
                                  ) : (
                                    <Plus className="h-4 w-4 shrink-0 stroke-[2.5]" />
                                  )}
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

      {/* ── Quick Vehicle Select Modal (Log Compliance) ───────────────── */}
      {showQuickSelect && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          onClick={() => setShowQuickSelect(false)}
        >
          <div
            className="bg-card border border-border rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-muted/20">
              <div>
                <h3 className="font-bold text-base text-foreground">Select Vehicle to Log Compliance</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Pick any vehicle from the fleet to update or record compliance documents
                </p>
              </div>
              <button
                onClick={() => setShowQuickSelect(false)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 border-b border-border bg-background">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/60" />
                <input
                  type="text"
                  value={quickSelectSearch}
                  onChange={(e) => setQuickSelectSearch(e.target.value)}
                  placeholder="Filter vehicles by number or model…"
                  className="w-full h-9 pl-9 pr-3 rounded-xl border border-border bg-card text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
              </div>
            </div>

            <div className="p-3 overflow-y-auto flex-1 divide-y divide-border/60">
              {quickSelectVehicles.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  No vehicles match your search.
                </div>
              ) : (
                quickSelectVehicles.map((v) => {
                  return (
                    <div
                      key={v.vehicleId}
                      className="py-2.5 px-3 flex items-center justify-between gap-3 hover:bg-muted/30 rounded-xl transition-colors cursor-pointer"
                      onClick={() => {
                        setShowQuickSelect(false);
                        setEditRecord(v);
                      }}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-sm text-foreground">
                            {v.vehicleNo}
                          </span>
                          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-primary/10 text-primary">
                            {v.vehicleGroup}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[240px]">
                          {v.model || v.type}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button size="sm" variant="primary" className="h-7 text-xs">
                          Edit
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="px-5 py-3 border-t border-border bg-muted/10 flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowQuickSelect(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

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
    return <span className="text-muted-foreground/40 font-mono">N/A</span>;
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
