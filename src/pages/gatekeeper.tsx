import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  UserCheck,
  X,
} from "lucide-react";
import { useAuth, REDIRECT_MAP } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/components/Logo";
import { Badge, Button, Card } from "@/components/ui-kit";
import {
  type RawVehicleGateLogRow,
  computeDurationMinutes,
  formatGateDuration,
  formatGateTimeDisplay,
  getCurrentIstTimeString,
  getTodayIstDateString,
  submitGateIncomingEntry,
  submitGateOutgoingEntry,
} from "@/lib/gatekeeperLogs";

interface VehicleOption {
  id: string;
  number: string;
  model?: string | null;
}

interface DriverOption {
  id: string;
  name: string;
  phone?: string | null;
}

export default function GatekeeperPage() {
  const { user, logout, ready } = useAuth();
  const nav = useNavigate();

  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [logs, setLogs] = useState<RawVehicleGateLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [migrationMissing, setMigrationMissing] = useState(false);

  // Entry form state
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [customVehicleMode, setCustomVehicleMode] = useState(false);
  const [vehicleNumberInput, setVehicleNumberInput] = useState("");

  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [customDriverMode, setCustomDriverMode] = useState(false);
  const [driverNameInput, setDriverNameInput] = useState("");

  const [salesmanName, setSalesmanName] = useState("");
  const [logDate, setLogDate] = useState(() => getTodayIstDateString());
  const [outgoingTime, setOutgoingTime] = useState(() => getCurrentIstTimeString());
  const [includeIncomingNow, setIncludeIncomingNow] = useState(false);
  const [incomingDate, setIncomingDate] = useState(() => getTodayIstDateString());
  const [incomingTime, setIncomingTime] = useState(() => getCurrentIstTimeString());
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Return modal state for closing an active 'Out' vehicle
  const [closingRow, setClosingRow] = useState<RawVehicleGateLogRow | null>(null);
  const [returnDate, setReturnDate] = useState(() => getTodayIstDateString());
  const [returnTime, setReturnTime] = useState(() => getCurrentIstTimeString());
  const [returnSalesman, setReturnSalesman] = useState("");
  const [returnNotes, setReturnNotes] = useState("");
  const [closingBusy, setClosingBusy] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  // Register filters
  const [statusFilter, setStatusFilter] = useState<"All" | "Out" | "Returned">("All");
  const [searchQuery, setSearchQuery] = useState("");

  async function loadData() {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [vehRes, drvRes, logsRes] = await Promise.all([
        supabase.from("vehicles").select("id, number, model").order("number"),
        supabase.from("drivers").select("id, name, phone").order("name"),
        supabase
          .from("vehicle_gate_logs")
          .select("*, vehicles(id, number), drivers(id, name)")
          .order("outgoing_at", { ascending: false })
          .limit(300),
      ]);

      if (vehRes.data) {
        setVehicles(vehRes.data as VehicleOption[]);
      }

      if (drvRes.data) {
        const seen = new Map<string, DriverOption>();
        for (const d of drvRes.data as DriverOption[]) {
          const key = (d.name || "").trim().toLowerCase();
          if (key && !seen.has(key)) {
            seen.set(key, d);
          }
        }
        setDrivers(Array.from(seen.values()));
      }

      if (logsRes.error) {
        const msg = logsRes.error.message || "";
        if (msg.includes("vehicle_gate_logs") || logsRes.error.code === "PGRST205") {
          setMigrationMissing(true);
          setLogs([]);
        } else {
          throw logsRes.error;
        }
      } else {
        setMigrationMissing(false);
        setLogs((logsRes.data || []) as RawVehicleGateLogRow[]);
      }
    } catch (err: any) {
      setLoadError(err?.message || "Failed to load gate register.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    loadData();

    const chId = `gatekeeper-logs-${Math.random().toString(36).slice(2, 9)}`;
    const channel = supabase
      .channel(chId)
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicle_gate_logs" }, () => {
        loadData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  async function handleLogout() {
    await logout();
    nav("/login");
  }

  async function handleSubmitOutEntry(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);
    setSubmitting(true);

    try {
      const res = await submitGateOutgoingEntry(supabase, {
        vehicleId: customVehicleMode ? null : selectedVehicleId || null,
        vehicleNumber: vehicleNumberInput,
        driverId: customDriverMode ? null : selectedDriverId || null,
        driverName: driverNameInput,
        salesmanName: salesmanName.trim() || null,
        logDate,
        outgoingTime,
        incomingDate: includeIncomingNow ? incomingDate : null,
        incomingTime: includeIncomingNow ? incomingTime : null,
        notes: notes.trim() || null,
      });

      if (!res.ok) {
        setFormError(res.error || "Could not save gate entry.");
        return;
      }

      setSuccessMsg(
        includeIncomingNow
          ? `Gate entry recorded for ${vehicleNumberInput} (Out & Returned).`
          : `Vehicle ${vehicleNumberInput} marked OUT at ${outgoingTime} IST.`
      );
      setSelectedVehicleId("");
      setVehicleNumberInput("");
      setCustomVehicleMode(false);
      setSelectedDriverId("");
      setDriverNameInput("");
      setCustomDriverMode(false);
      setSalesmanName("");
      setNotes("");
      setIncludeIncomingNow(false);
      setLogDate(getTodayIstDateString());
      setOutgoingTime(getCurrentIstTimeString());
      setIncomingDate(getTodayIstDateString());
      setIncomingTime(getCurrentIstTimeString());
      await loadData();
    } catch (err: any) {
      setFormError(err?.message || "Unexpected error while saving entry.");
    } finally {
      setSubmitting(false);
    }
  }

  function openIncomingModal(row: RawVehicleGateLogRow) {
    setClosingRow(row);
    setReturnDate(getTodayIstDateString());
    setReturnTime(getCurrentIstTimeString());
    setReturnSalesman(row.salesman_name || "");
    setReturnNotes(row.notes || "");
    setCloseError(null);
  }

  async function handleConfirmIncoming(e: React.FormEvent) {
    e.preventDefault();
    if (!closingRow) return;
    setClosingBusy(true);
    setCloseError(null);

    try {
      const res = await submitGateIncomingEntry(supabase, {
        logId: closingRow.id,
        outgoingAtIso: closingRow.outgoing_at,
        incomingDate: returnDate,
        incomingTime: returnTime,
        salesmanName: returnSalesman.trim() || null,
        notes: returnNotes.trim() || null,
      });

      if (!res.ok) {
        setCloseError(res.error || "Failed to record incoming time.");
        return;
      }

      const closedVeh = closingRow.vehicles?.number || closingRow.vehicle_number;
      setClosingRow(null);
      setSuccessMsg(`Vehicle ${closedVeh} marked Returned at ${returnTime} IST.`);
      await loadData();
    } catch (err: any) {
      setCloseError(err?.message || "Failed to record incoming time.");
    } finally {
      setClosingBusy(false);
    }
  }

  const todayIst = getTodayIstDateString();
  const activeOutRows = useMemo(
    () => logs.filter((r) => r.status === "Out" && !r.incoming_at),
    [logs]
  );

  const todayStats = useMemo(() => {
    const todayRows = logs.filter((r) => r.log_date === todayIst);
    const outNow = activeOutRows.length;
    const returnedToday = todayRows.filter((r) => r.status === "Returned" || Boolean(r.incoming_at)).length;
    return {
      todayTotal: todayRows.length,
      outNow,
      returnedToday,
    };
  }, [logs, activeOutRows.length, todayIst]);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((r) => {
      const isReturned = r.status === "Returned" || Boolean(r.incoming_at);
      const st = isReturned ? "Returned" : "Out";
      if (statusFilter !== "All" && st !== statusFilter) return false;
      if (!q) return true;
      const veh = (r.vehicles?.number || r.vehicle_number || "").toLowerCase();
      const drv = (r.drivers?.name || r.driver_name || "").toLowerCase();
      const sls = (r.salesman_name || "").toLowerCase();
      return veh.includes(q) || drv.includes(q) || sls.includes(q);
    });
  }, [logs, statusFilter, searchQuery]);

  if (!ready) return null;
  if (!user) return <Navigate to="/login" />;
  if (user.role !== "gatekeeper" && user.role !== "admin" && user.role !== "manager") {
    return <Navigate to={REDIRECT_MAP[user.role]} />;
  }

  const isAdminOrManager = user.role === "admin" || user.role === "manager";

  return (
    <div className="min-h-screen bg-slate-50/90 flex flex-col overflow-x-hidden">
      {/* Header */}
      <header
        className="sticky top-0 z-30 shrink-0 border-b border-white/10"
        style={{
          background: "linear-gradient(135deg, oklch(0.16 0.07 258) 0%, oklch(0.24 0.11 264) 100%)",
        }}
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-white/12 rounded-xl p-1.5 shrink-0">
              <Logo className="h-8" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-teal-300 flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" />
                Nanjil VIP · Gate Keeper Portal
              </div>
              <div className="text-white font-bold text-sm sm:text-base leading-tight truncate">
                Welcome, {user.name}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isAdminOrManager && (
              <button
                type="button"
                onClick={() => nav("/reports?tab=gatekeeper_logs")}
                className="px-3 py-2 rounded-xl bg-white/12 hover:bg-white/22 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Admin Reports
              </button>
            )}
            <button
              type="button"
              onClick={loadData}
              aria-label="Refresh gate logs"
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Logout"
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-red-500/30 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-5 space-y-5">
        {migrationMissing && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 space-y-1">
            <div className="font-bold">Gate Keeper database table is not deployed yet.</div>
            <div>
              Run migration <code>supabase/migrations/20261126150000_gatekeeper_role_and_vehicle_gate_logs.sql</code> in Supabase SQL Editor to enable live gate register storage.
            </div>
          </div>
        )}

        {loadError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-xs text-red-800 font-medium flex items-center justify-between">
            <span>{loadError}</span>
            <button
              type="button"
              onClick={loadData}
              className="px-3 py-1 rounded-lg bg-white border border-red-200 font-semibold cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {successMsg && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 text-xs font-semibold text-emerald-900 flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setSuccessMsg(null)}
              className="text-emerald-700 hover:text-emerald-950 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Today KPIs */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border border-slate-200/80 rounded-2xl p-3.5 shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Today&apos;s Entries
            </div>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">{todayStats.todayTotal}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Logged on {todayIst}</div>
          </div>
          <div className="bg-white border border-amber-200/80 rounded-2xl p-3.5 shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600">
              Currently Out
            </div>
            <div className="text-2xl font-extrabold text-amber-700 mt-1">{todayStats.outNow}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Awaiting return</div>
          </div>
          <div className="bg-white border border-emerald-200/80 rounded-2xl p-3.5 shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
              Returned Today
            </div>
            <div className="text-2xl font-extrabold text-emerald-700 mt-1">{todayStats.returnedToday}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Completed round-trips</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left: New Gate Entry Form */}
          <Card className="lg:col-span-5 border border-slate-200/80 p-5 shadow-xs space-y-4 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <Plus className="h-4 w-4 text-indigo-600" />
                  Record Gate Entry
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Log vehicle outgoing time, incoming time, driver &amp; optional salesman
                </p>
              </div>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 font-medium">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmitOutEntry} className="space-y-3.5 text-xs">
              {/* Vehicle Selection */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700">Vehicle Number *</label>
                  {vehicles.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomVehicleMode((prev) => !prev);
                        setSelectedVehicleId("");
                        setVehicleNumberInput("");
                      }}
                      className="text-[11px] font-semibold text-indigo-600 hover:underline cursor-pointer"
                    >
                      {customVehicleMode ? "← Select fleet vehicle" : "+ Enter manually"}
                    </button>
                  )}
                </div>

                {!customVehicleMode && vehicles.length > 0 ? (
                  <select
                    required
                    value={selectedVehicleId}
                    onChange={(e) => {
                      const vId = e.target.value;
                      setSelectedVehicleId(vId);
                      const found = vehicles.find((v) => v.id === vId);
                      setVehicleNumberInput(found?.number || "");
                    }}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="">-- Select Vehicle --</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.number} {v.model ? `· ${v.model}` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    required
                    type="text"
                    value={vehicleNumberInput}
                    onChange={(e) => setVehicleNumberInput(e.target.value)}
                    placeholder="e.g. TN 75 AA 1234"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                )}
              </div>

              {/* Driver Selection */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700">Driver Name *</label>
                  {drivers.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomDriverMode((prev) => !prev);
                        setSelectedDriverId("");
                        setDriverNameInput("");
                      }}
                      className="text-[11px] font-semibold text-indigo-600 hover:underline cursor-pointer"
                    >
                      {customDriverMode ? "← Select driver list" : "+ Type custom driver"}
                    </button>
                  )}
                </div>

                {!customDriverMode && drivers.length > 0 ? (
                  <select
                    required
                    value={selectedDriverId}
                    onChange={(e) => {
                      const dId = e.target.value;
                      setSelectedDriverId(dId);
                      const found = drivers.find((d) => d.id === dId);
                      setDriverNameInput(found?.name || "");
                    }}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="">-- Select Driver --</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} {d.phone ? `· ${d.phone}` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    required
                    type="text"
                    value={driverNameInput}
                    onChange={(e) => setDriverNameInput(e.target.value)}
                    placeholder="Enter driver full name"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                )}
              </div>

              {/* Salesman Name (Optional) */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Salesman Name <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={salesmanName}
                  onChange={(e) => setSalesmanName(e.target.value)}
                  placeholder="Enter salesman name if accompanying"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              {/* Date & Outgoing Time */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Date *</label>
                  <input
                    required
                    type="date"
                    value={logDate}
                    max={todayIst}
                    onChange={(e) => setLogDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700">Outgoing Time *</label>
                    <button
                      type="button"
                      onClick={() => setOutgoingTime(getCurrentIstTimeString())}
                      className="text-[10px] font-bold text-indigo-600 hover:underline cursor-pointer"
                    >
                      Now
                    </button>
                  </div>
                  <input
                    required
                    type="time"
                    value={outgoingTime}
                    onChange={(e) => setOutgoingTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              {/* Optional Immediate Incoming Time Toggle */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2.5">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeIncomingNow}
                    onChange={(e) => {
                      setIncludeIncomingNow(e.target.checked);
                      if (e.target.checked) {
                        setIncomingDate(logDate);
                        setIncomingTime(getCurrentIstTimeString());
                      }
                    }}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="font-semibold text-slate-700">
                    Also record Incoming Time now (completed trip)
                  </span>
                </label>

                {includeIncomingNow && (
                  <div className="grid grid-cols-2 gap-2.5 pt-1">
                    <div>
                      <label className="font-semibold text-slate-600 block mb-1">Return Date *</label>
                      <input
                        required={includeIncomingNow}
                        type="date"
                        value={incomingDate}
                        min={logDate}
                        max={todayIst}
                        onChange={(e) => setIncomingDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-semibold text-slate-800 outline-none"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-semibold text-slate-600">Incoming Time *</label>
                        <button
                          type="button"
                          onClick={() => setIncomingTime(getCurrentIstTimeString())}
                          className="text-[10px] font-bold text-indigo-600 hover:underline cursor-pointer"
                        >
                          Now
                        </button>
                      </div>
                      <input
                        required={includeIncomingNow}
                        type="time"
                        value={incomingTime}
                        onChange={(e) => setIncomingTime(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-semibold text-slate-800 outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Notes (Optional) */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Remarks <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional route / gate note"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <Button
                type="submit"
                disabled={submitting || migrationMissing}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-xs cursor-pointer disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" />
                {submitting
                  ? "Saving Entry..."
                  : includeIncomingNow
                  ? "Save Out & Incoming Entry"
                  : "Record Vehicle Outgoing"}
              </Button>
            </form>
          </Card>

          {/* Right: Active Vehicles Outside + Gate Register */}
          <div className="lg:col-span-7 space-y-5">
            {/* Active Outside Vehicles awaiting Incoming Time */}
            <Card className="border border-amber-200/80 bg-white p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                    <Truck className="h-4 w-4 text-amber-600" />
                    Vehicles Currently Outside ({activeOutRows.length})
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Tap &quot;Record Incoming&quot; when a vehicle enters the gate
                  </p>
                </div>
              </div>

              {activeOutRows.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
                  All logged vehicles have returned. No active Out entries.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {activeOutRows.map((row) => {
                    const vehNum = row.vehicles?.number || row.vehicle_number;
                    const drvName = row.drivers?.name || row.driver_name;
                    return (
                      <div
                        key={row.id}
                        className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 flex flex-col justify-between gap-2.5"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-extrabold text-slate-900">{vehNum}</span>
                            <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300 text-[10px]">
                              Out · {formatGateTimeDisplay(row.outgoing_at, row.outgoing_time)}
                            </Badge>
                          </div>
                          <div className="text-xs text-slate-700 font-medium flex items-center gap-1">
                            <UserCheck className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                            <span>{drvName}</span>
                          </div>
                          {row.salesman_name && (
                            <div className="text-[11px] text-slate-500">
                              Salesman: <span className="font-semibold text-slate-700">{row.salesman_name}</span>
                            </div>
                          )}
                          <div className="text-[10px] text-slate-400">
                            Date: {row.log_date}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => openIncomingModal(row)}
                          className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <LogIn className="h-3.5 w-3.5" />
                          Record Incoming Time
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Full Gate Register Table */}
            <Card className="border border-slate-200/80 bg-white p-4 shadow-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-indigo-600" />
                    Gate Register Log ({filteredLogs.length})
                  </h3>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <div className="bg-slate-100 p-0.5 rounded-lg flex items-center font-semibold">
                    {(["All", "Out", "Returned"] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setStatusFilter(st)}
                        className={`px-2.5 py-1 rounded-md cursor-pointer ${
                          statusFilter === st
                            ? "bg-white text-slate-900 shadow-2xs font-bold"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 w-44">
                    <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Vehicle / Driver..."
                      className="bg-transparent outline-none text-xs w-full text-slate-800"
                    />
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                {filteredLogs.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    No gate log entries found.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                        <th className="py-2 px-2.5">Date</th>
                        <th className="py-2 px-2.5">Vehicle</th>
                        <th className="py-2 px-2.5">Driver</th>
                        <th className="py-2 px-2.5">Salesman</th>
                        <th className="py-2 px-2.5">Out Time</th>
                        <th className="py-2 px-2.5">In Time</th>
                        <th className="py-2 px-2.5">Duration</th>
                        <th className="py-2 px-2.5">Status</th>
                        <th className="py-2 px-2.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredLogs.slice(0, 50).map((row) => {
                        const isReturned = row.status === "Returned" || Boolean(row.incoming_at);
                        const mins = isReturned
                          ? computeDurationMinutes(row.outgoing_at, row.incoming_at)
                          : null;
                        return (
                          <tr key={row.id} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-2.5 text-slate-600 whitespace-nowrap">{row.log_date}</td>
                            <td className="py-2.5 px-2.5 font-bold text-slate-900 whitespace-nowrap">
                              {row.vehicles?.number || row.vehicle_number}
                            </td>
                            <td className="py-2.5 px-2.5 font-medium text-slate-800 whitespace-nowrap">
                              {row.drivers?.name || row.driver_name}
                            </td>
                            <td className="py-2.5 px-2.5 text-slate-600 whitespace-nowrap">
                              {row.salesman_name || "-"}
                            </td>
                            <td className="py-2.5 px-2.5 font-semibold text-slate-800 whitespace-nowrap">
                              {formatGateTimeDisplay(row.outgoing_at, row.outgoing_time)}
                            </td>
                            <td className="py-2.5 px-2.5 font-semibold text-slate-800 whitespace-nowrap">
                              {isReturned
                                ? formatGateTimeDisplay(row.incoming_at, row.incoming_time)
                                : "-"}
                            </td>
                            <td className="py-2.5 px-2.5 text-slate-600 whitespace-nowrap">
                              {isReturned ? formatGateDuration(mins) : "Open"}
                            </td>
                            <td className="py-2.5 px-2.5 whitespace-nowrap">
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${
                                  isReturned
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : "bg-amber-50 text-amber-700 border-amber-200"
                                }`}
                              >
                                {isReturned ? "Returned" : "Out"}
                              </Badge>
                            </td>
                            <td className="py-2.5 px-2.5 text-right whitespace-nowrap">
                              {!isReturned ? (
                                <button
                                  type="button"
                                  onClick={() => openIncomingModal(row)}
                                  className="px-2 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-semibold text-[11px] cursor-pointer"
                                >
                                  Mark In
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-400">Logged</span>
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
          </div>
        </div>
      </main>

      {/* Incoming Time Confirmation Modal */}
      {closingRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
          onClick={() => !closingBusy && setClosingRow(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full p-5 border border-slate-200 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <div className="text-sm font-bold text-slate-900">Record Vehicle Incoming Time</div>
                <div className="text-xs text-slate-500">
                  {closingRow.vehicles?.number || closingRow.vehicle_number} · Driver:{" "}
                  {closingRow.drivers?.name || closingRow.driver_name}
                </div>
              </div>
              <button
                type="button"
                disabled={closingBusy}
                onClick={() => setClosingRow(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {closeError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 font-medium">
                {closeError}
              </div>
            )}

            <form onSubmit={handleConfirmIncoming} className="space-y-3.5 text-xs">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 text-[11px] text-slate-600 flex items-center justify-between">
                <span>Recorded Outgoing:</span>
                <span className="font-bold text-slate-900">
                  {closingRow.log_date} · {formatGateTimeDisplay(closingRow.outgoing_at, closingRow.outgoing_time)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Return Date *</label>
                  <input
                    required
                    type="date"
                    value={returnDate}
                    min={closingRow.log_date}
                    max={todayIst}
                    onChange={(e) => setReturnDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700">Incoming Time *</label>
                    <button
                      type="button"
                      onClick={() => setReturnTime(getCurrentIstTimeString())}
                      className="text-[10px] font-bold text-indigo-600 hover:underline cursor-pointer"
                    >
                      Now
                    </button>
                  </div>
                  <input
                    required
                    type="time"
                    value={returnTime}
                    onChange={(e) => setReturnTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-semibold text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Salesman Name <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={returnSalesman}
                  onChange={(e) => setReturnSalesman(e.target.value)}
                  placeholder="Optional salesman name"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Remarks <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder="Optional incoming note"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  disabled={closingBusy}
                  onClick={() => setClosingRow(null)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs px-3 py-2 rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={closingBusy}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-1.5"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  {closingBusy ? "Saving..." : "Confirm Incoming Time"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
