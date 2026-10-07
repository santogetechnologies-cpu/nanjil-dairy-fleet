import { useState } from "react";
import { X, Loader2, Sparkles, Calendar, CheckSquare, Square, CheckCircle2, AlertCircle } from "lucide-react";
import { type VehicleComplianceRecord } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui-kit";
import {
  calculateItemStatus,
  calculateOverallVehicleStatus,
  DEFAULT_COMPLIANCE_WARNING_DAYS,
} from "@/lib/compliance";

interface Props {
  vehicles: VehicleComplianceRecord[];
  warningDays?: number;
  isOpen: boolean;
  onClose: () => void;
  onApplied: (updated: VehicleComplianceRecord[]) => void;
}

export function BatchComplianceModal({
  vehicles,
  warningDays = DEFAULT_COMPLIANCE_WARNING_DAYS,
  isOpen,
  onClose,
  onApplied,
}: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Selection mode: 'all' | 'pending' | 'custom'
  const [targetScope, setTargetScope] = useState<"all" | "pending" | "custom">("all");
  const [selectedIds, setSelectedIds] = useState<string[]>(vehicles.map((v) => v.vehicleId));

  // Preset mode: 'standard' | 'realistic' | 'custom'
  const [preset, setPreset] = useState<"standard" | "realistic" | "custom">("standard");

  // Custom date fields
  const [customForm, setCustomForm] = useState({
    fcInspectionDate: "",
    fcExpiryDate: "",
    tnPermitExpiry: "",
    tnTaxExpiry: "",
    pollutionExpiry: "",
    insuranceExpiry: "",
    foodSafetyExpiry: "",
  });

  if (!isOpen) return null;

  const targetVehicles = vehicles.filter((v) => {
    if (targetScope === "all") return true;
    if (targetScope === "pending") return v.overallStatus === "NOT_APPLICABLE";
    return selectedIds.includes(v.vehicleId);
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleApply = async () => {
    if (targetVehicles.length === 0) {
      setErrorMsg("Please select at least one vehicle.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];

    // Helper for date offsets in days
    const dateOffset = (days: number) => {
      const d = new Date(now.getTime() + days * 24 * 3600 * 1000);
      return d.toISOString().split("T")[0];
    };

    try {
      const recordsToUpsert = targetVehicles.map((v, index) => {
        let fcInsp = todayStr;
        let fcExp = dateOffset(365);
        let tnPermit = dateOffset(365 * 5);
        let klPermit: string | null = null;
        let tnTax = dateOffset(365);
        let klTax: string | null = null;
        let pollution = dateOffset(180);
        let foodSafety = dateOffset(365);
        let insurance = dateOffset(365);
        let adv: string | null = null;

        if (preset === "realistic") {
          // Spread statuses across fleet: ~75% valid, ~15% expiring soon, ~10% expired
          const mod = index % 10;
          if (mod === 0) {
            // Expired FC & Pollution (expired 15 days ago)
            fcExp = dateOffset(-15);
            pollution = dateOffset(-20);
          } else if (mod === 1 || mod === 2) {
            // Expiring soon (due in 12-25 days)
            fcExp = dateOffset(14 + (index % 10));
            insurance = dateOffset(18);
            pollution = dateOffset(22);
          } else {
            // Fully valid (due in 6-12 months)
            fcExp = dateOffset(180 + (index * 7) % 180);
            insurance = dateOffset(200 + (index * 5) % 150);
            pollution = dateOffset(90 + (index * 3) % 90);
          }
        } else if (preset === "custom") {
          fcInsp = customForm.fcInspectionDate || todayStr;
          fcExp = customForm.fcExpiryDate || dateOffset(365);
          tnPermit = customForm.tnPermitExpiry || dateOffset(365 * 5);
          tnTax = customForm.tnTaxExpiry || dateOffset(365);
          pollution = customForm.pollutionExpiry || dateOffset(180);
          insurance = customForm.insuranceExpiry || dateOffset(365);
          foodSafety = customForm.foodSafetyExpiry || dateOffset(365);
        }

        return {
          vehicle_id: v.vehicleId,
          fc_inspection_date: fcInsp,
          fc_expiry_date: fcExp,
          tn_permit_expiry: tnPermit,
          kl_permit_expiry: klPermit,
          tn_tax_expiry: tnTax,
          kl_tax_expiry: klTax,
          pollution_expiry: pollution,
          food_safety_expiry: foodSafety,
          insurance_expiry: insurance,
          advertisement_expiry: adv,
          created_by: user?.id || null,
          updated_by: user?.id || null,
          updated_at: new Date().toISOString(),
        };
      });

      // Execute upsert into Supabase vehicle_compliance
      const { data, error } = await supabase
        .from("vehicle_compliance")
        .upsert(recordsToUpsert, { onConflict: "vehicle_id" })
        .select();

      if (error) {
        throw error;
      }

      // Map back into client state
      const updatedMap = new Map((data || []).map((row: any) => [row.vehicle_id, row]));

      const updatedRecords: VehicleComplianceRecord[] = vehicles.map((v) => {
        const row = updatedMap.get(v.vehicleId);
        if (!row) return v;

        const itemStatuses = [
          { status: calculateItemStatus(row.fc_expiry_date, warningDays), isMandatory: true },
          { status: calculateItemStatus(row.tn_permit_expiry, warningDays), isMandatory: true },
          { status: calculateItemStatus(row.kl_permit_expiry, warningDays), isMandatory: false },
          { status: calculateItemStatus(row.tn_tax_expiry, warningDays), isMandatory: true },
          { status: calculateItemStatus(row.kl_tax_expiry, warningDays), isMandatory: false },
          { status: calculateItemStatus(row.pollution_expiry, warningDays), isMandatory: true },
          { status: calculateItemStatus(row.food_safety_expiry, warningDays), isMandatory: false },
          { status: calculateItemStatus(row.insurance_expiry, warningDays), isMandatory: true },
          { status: calculateItemStatus(row.advertisement_expiry, warningDays), isMandatory: false },
        ];

        return {
          ...v,
          id: row.id,
          fcInspectionDate: row.fc_inspection_date,
          fcExpiryDate: row.fc_expiry_date,
          tnPermitExpiry: row.tn_permit_expiry,
          klPermitExpiry: row.kl_permit_expiry,
          tnTaxExpiry: row.tn_tax_expiry,
          klTaxExpiry: row.kl_tax_expiry,
          pollutionExpiry: row.pollution_expiry,
          foodSafetyExpiry: row.food_safety_expiry,
          insuranceExpiry: row.insurance_expiry,
          advertisementExpiry: row.advertisement_expiry,
          overallStatus: calculateOverallVehicleStatus(itemStatuses),
          updatedAt: row.updated_at,
          updatedBy: row.updated_by,
        };
      });

      onApplied(updatedRecords);
      onClose();
    } catch (err: any) {
      console.error("Batch compliance error:", err);
      setErrorMsg(err.message || "Failed to batch update compliance.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl max-w-xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-border flex items-start justify-between gap-4 bg-muted/20">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Batch Compliance Setup
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Quickly populate or initialize statutory compliance cycles for your fleet.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Scope selection */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
              Target Vehicles ({targetVehicles.length} selected)
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setTargetScope("all")}
                className={`p-2.5 rounded-xl border text-xs font-semibold text-left transition-all ${
                  targetScope === "all"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                All Vehicles ({vehicles.length})
              </button>
              <button
                type="button"
                onClick={() => setTargetScope("pending")}
                className={`p-2.5 rounded-xl border text-xs font-semibold text-left transition-all ${
                  targetScope === "pending"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                Pending Only ({vehicles.filter((v) => v.overallStatus === "NOT_APPLICABLE").length})
              </button>
              <button
                type="button"
                onClick={() => setTargetScope("custom")}
                className={`p-2.5 rounded-xl border text-xs font-semibold text-left transition-all ${
                  targetScope === "custom"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                Select Vehicles…
              </button>
            </div>
          </div>

          {/* If custom scope, show select list */}
          {targetScope === "custom" && (
            <div className="p-3 rounded-xl border border-border max-h-40 overflow-y-auto space-y-1 bg-muted/20">
              {vehicles.map((v) => {
                const checked = selectedIds.includes(v.vehicleId);
                return (
                  <div
                    key={v.vehicleId}
                    onClick={() => toggleSelect(v.vehicleId)}
                    className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-muted/50 cursor-pointer text-xs"
                  >
                    {checked ? (
                      <CheckSquare className="h-4 w-4 text-primary shrink-0" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="font-mono font-semibold">{v.vehicleNo}</span>
                    <span className="text-muted-foreground text-[10px] ml-auto">
                      {v.vehicleGroup} ({v.model || v.type})
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Preset selection */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
              Compliance Cycle Preset
            </label>
            <div className="space-y-2">
              <label
                onClick={() => setPreset("standard")}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  preset === "standard"
                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100"
                    : "border-border bg-card text-foreground hover:bg-muted/30"
                }`}
              >
                <input
                  type="radio"
                  name="preset"
                  checked={preset === "standard"}
                  onChange={() => setPreset("standard")}
                  className="mt-0.5"
                />
                <div>
                  <div className="font-semibold text-xs">Standard 1-Year Fleet Validity (All Compliant)</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Sets FC (1 yr), Permits (5 yr), Tax (1 yr), Pollution (6 mo), Insurance (1 yr) in the future.
                  </div>
                </div>
              </label>

              <label
                onClick={() => setPreset("realistic")}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  preset === "realistic"
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border bg-card text-foreground hover:bg-muted/30"
                }`}
              >
                <input
                  type="radio"
                  name="preset"
                  checked={preset === "realistic"}
                  onChange={() => setPreset("realistic")}
                  className="mt-0.5"
                />
                <div>
                  <div className="font-semibold text-xs">
                    Operational Fleet Spread (Compliant, Expiring Soon & Overdue)
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Distributes realistic expiration dates so you can immediately see the dashboard active with Valid, Expiring Soon, and Overdue items.
                  </div>
                </div>
              </label>

              <label
                onClick={() => setPreset("custom")}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  preset === "custom"
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border bg-card text-foreground hover:bg-muted/30"
                }`}
              >
                <input
                  type="radio"
                  name="preset"
                  checked={preset === "custom"}
                  onChange={() => setPreset("custom")}
                  className="mt-0.5"
                />
                <div>
                  <div className="font-semibold text-xs">Custom Expiry Dates</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Manually specify custom dates to apply to all selected vehicles.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Custom Date Inputs if preset === 'custom' */}
          {preset === "custom" && (
            <div className="p-3 rounded-xl border border-border bg-muted/20 space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="font-medium text-[11px] block mb-1">FC Expiry Date</label>
                  <input
                    type="date"
                    value={customForm.fcExpiryDate}
                    onChange={(e) => setCustomForm({ ...customForm, fcExpiryDate: e.target.value })}
                    className="w-full h-8 px-2 rounded-lg border border-border bg-card text-xs"
                  />
                </div>
                <div>
                  <label className="font-medium text-[11px] block mb-1">Insurance Expiry</label>
                  <input
                    type="date"
                    value={customForm.insuranceExpiry}
                    onChange={(e) => setCustomForm({ ...customForm, insuranceExpiry: e.target.value })}
                    className="w-full h-8 px-2 rounded-lg border border-border bg-card text-xs"
                  />
                </div>
                <div>
                  <label className="font-medium text-[11px] block mb-1">TN Permit Expiry</label>
                  <input
                    type="date"
                    value={customForm.tnPermitExpiry}
                    onChange={(e) => setCustomForm({ ...customForm, tnPermitExpiry: e.target.value })}
                    className="w-full h-8 px-2 rounded-lg border border-border bg-card text-xs"
                  />
                </div>
                <div>
                  <label className="font-medium text-[11px] block mb-1">Pollution (PUC) Expiry</label>
                  <input
                    type="date"
                    value={customForm.pollutionExpiry}
                    onChange={(e) => setCustomForm({ ...customForm, pollutionExpiry: e.target.value })}
                    className="w-full h-8 px-2 rounded-lg border border-border bg-card text-xs"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-muted/10 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Applies to <span className="font-semibold text-foreground">{targetVehicles.length}</span> vehicles
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleApply} disabled={loading || targetVehicles.length === 0}>
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Applying…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Apply to Fleet
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
