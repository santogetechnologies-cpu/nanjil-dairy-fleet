import { useState, useEffect } from "react";
import { X, Loader2, Save, AlertCircle, CheckCircle2 } from "lucide-react";
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
  record: VehicleComplianceRecord | null;
  warningDays?: number;
  onClose: () => void;
  onSaved: (updated: VehicleComplianceRecord) => void;
}

export function ComplianceEditModal({
  record,
  warningDays = DEFAULT_COMPLIANCE_WARNING_DAYS,
  onClose,
  onSaved,
}: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form state holding raw dates (YYYY-MM-DD or empty string)
  const [form, setForm] = useState({
    fcInspectionDate: "",
    fcExpiryDate: "",
    tnPermitExpiry: "",
    klPermitExpiry: "",
    tnTaxExpiry: "",
    klTaxExpiry: "",
    pollutionExpiry: "",
    foodSafetyExpiry: "",
    insuranceExpiry: "",
    advertisementExpiry: "",
  });

  useEffect(() => {
    if (record) {
      setForm({
        fcInspectionDate: record.fcInspectionDate || "",
        fcExpiryDate: record.fcExpiryDate || "",
        tnPermitExpiry: record.tnPermitExpiry || "",
        klPermitExpiry: record.klPermitExpiry || "",
        tnTaxExpiry: record.tnTaxExpiry || "",
        klTaxExpiry: record.klTaxExpiry || "",
        pollutionExpiry: record.pollutionExpiry || "",
        foodSafetyExpiry: record.foodSafetyExpiry || "",
        insuranceExpiry: record.insuranceExpiry || "",
        advertisementExpiry: record.advertisementExpiry || "",
      });
      setErrorMsg(null);
    }
  }, [record]);

  if (!record) return null;

  const handleChange = (field: keyof typeof form, val: string) => {
    setForm((prev) => ({ ...prev, [field]: val }));
    setErrorMsg(null);
  };

  const validate = (): string | null => {
    // 1. FC Inspection Date vs FC Expiry Date validation
    if (form.fcInspectionDate && form.fcExpiryDate) {
      const insp = new Date(form.fcInspectionDate);
      const exp = new Date(form.fcExpiryDate);
      if (exp < insp) {
        return "Fitness Certificate (FC) Expiry date cannot be earlier than FC Inspection date.";
      }
    }

    // 2. Validate all entered dates are valid calendar dates
    for (const [key, val] of Object.entries(form)) {
      if (val.trim()) {
        const d = new Date(val);
        if (isNaN(d.getTime())) {
          return `Invalid date entered for ${key}. Please enter a valid date.`;
        }
      }
    }

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const valError = validate();
    if (valError) {
      setErrorMsg(valError);
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    const payload = {
      vehicle_id: record.vehicleId,
      fc_inspection_date: form.fcInspectionDate || null,
      fc_expiry_date: form.fcExpiryDate || null,
      tn_permit_expiry: form.tnPermitExpiry || null,
      kl_permit_expiry: form.klPermitExpiry || null,
      tn_tax_expiry: form.tnTaxExpiry || null,
      kl_tax_expiry: form.klTaxExpiry || null,
      pollution_expiry: form.pollutionExpiry || null,
      food_safety_expiry: form.foodSafetyExpiry || null,
      insurance_expiry: form.insuranceExpiry || null,
      advertisement_expiry: form.advertisementExpiry || null,
      updated_by: user?.id || null,
      updated_at: new Date().toISOString(),
    };

    try {
      // Upsert into public.vehicle_compliance
      const { data, error } = await supabase
        .from("vehicle_compliance")
        .upsert(
          {
            ...payload,
            ...(record.id ? { id: record.id } : {}),
            created_by: record.createdBy || user?.id || null,
          },
          { onConflict: "vehicle_id" }
        )
        .select()
        .single();

      if (error) {
        const errMsg = error.message || "";
        const errCode = (error as any).code || "";
        const isTableNotFound =
          (errMsg.includes("vehicle_compliance") && (errMsg.includes("schema cache") || errMsg.includes("does not exist"))) ||
          errCode === "PGRST205" ||
          errCode === "42P01";

        if (isTableNotFound) {
          throw new Error(
            "The vehicle_compliance table is not yet created in the database. Please run migration 20261006130000_create_vehicle_compliance.sql in your Supabase SQL editor."
          );
        }
        throw error;
      }

      // Compute new statuses dynamically
      const itemStatuses = [
        { status: calculateItemStatus(payload.fc_expiry_date, warningDays), isMandatory: true },
        { status: calculateItemStatus(payload.tn_permit_expiry, warningDays), isMandatory: true },
        { status: calculateItemStatus(payload.kl_permit_expiry, warningDays), isMandatory: false },
        { status: calculateItemStatus(payload.tn_tax_expiry, warningDays), isMandatory: true },
        { status: calculateItemStatus(payload.kl_tax_expiry, warningDays), isMandatory: false },
        { status: calculateItemStatus(payload.pollution_expiry, warningDays), isMandatory: true },
        { status: calculateItemStatus(payload.food_safety_expiry, warningDays), isMandatory: false },
        { status: calculateItemStatus(payload.insurance_expiry, warningDays), isMandatory: true },
        { status: calculateItemStatus(payload.advertisement_expiry, warningDays), isMandatory: false },
      ];

      const newOverallStatus = calculateOverallVehicleStatus(itemStatuses);

      const updatedRecord: VehicleComplianceRecord = {
        ...record,
        id: data?.id || record.id,
        fcInspectionDate: payload.fc_inspection_date,
        fcExpiryDate: payload.fc_expiry_date,
        tnPermitExpiry: payload.tn_permit_expiry,
        klPermitExpiry: payload.kl_permit_expiry,
        tnTaxExpiry: payload.tn_tax_expiry,
        klTaxExpiry: payload.kl_tax_expiry,
        pollutionExpiry: payload.pollution_expiry,
        foodSafetyExpiry: payload.food_safety_expiry,
        insuranceExpiry: payload.insurance_expiry,
        advertisementExpiry: payload.advertisement_expiry,
        overallStatus: newOverallStatus,
        updatedAt: payload.updated_at,
        updatedBy: payload.updated_by,
      };

      onSaved(updatedRecord);
      onClose();
    } catch (err: any) {
      console.error("Save compliance error:", err);
      setErrorMsg(err.message || "Failed to update compliance records.");
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
        className="bg-card border border-border rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-border flex items-start justify-between gap-4 bg-muted/20">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
              Update Vehicle Compliance
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Vehicle: <span className="font-semibold text-foreground font-mono">{record.vehicleNo}</span> (
              {record.model || "Unknown Model"}) · Group: <span className="font-semibold text-foreground">{record.vehicleGroup}</span>
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="p-6 overflow-y-auto flex-1 space-y-4">
            {errorMsg && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{errorMsg}</span>
              </div>
            )}

            {/* Read-only vehicle identity */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-muted/30 border border-border text-xs">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Vehicle Number
                </label>
                <div className="font-mono font-bold text-sm text-foreground mt-0.5">
                  {record.vehicleNo}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Fleet Category / Group
                </label>
                <div className="font-semibold text-foreground mt-0.5">
                  {record.vehicleGroup} ({record.model || record.type})
                </div>
              </div>
            </div>

            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground pt-1">
              Compliance Expiry Schedules
            </div>

            {/* FC Dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl border border-border/80 bg-background/50">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  FC Inspection Date
                </label>
                <input
                  type="date"
                  value={form.fcInspectionDate}
                  onChange={(e) => handleChange("fcInspectionDate", e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-border bg-card text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <span className="text-[10px] text-muted-foreground mt-0.5 block">
                  Date of vehicle inspection
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  FC Expiry Date *
                </label>
                <input
                  type="date"
                  value={form.fcExpiryDate}
                  onChange={(e) => handleChange("fcExpiryDate", e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-border bg-card text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <span className="text-[10px] text-muted-foreground mt-0.5 block">
                  Fitness validity expiry
                </span>
              </div>
            </div>

            {/* Permits */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  TN Permit Expiry
                </label>
                <input
                  type="date"
                  value={form.tnPermitExpiry}
                  onChange={(e) => handleChange("tnPermitExpiry", e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-border bg-card text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  KL Permit Expiry
                </label>
                <input
                  type="date"
                  value={form.klPermitExpiry}
                  onChange={(e) => handleChange("klPermitExpiry", e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-border bg-card text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* Taxes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  TN Road Tax Expiry
                </label>
                <input
                  type="date"
                  value={form.tnTaxExpiry}
                  onChange={(e) => handleChange("tnTaxExpiry", e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-border bg-card text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  KL Road Tax Expiry
                </label>
                <input
                  type="date"
                  value={form.klTaxExpiry}
                  onChange={(e) => handleChange("klTaxExpiry", e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-border bg-card text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* Pollution & Food Safety */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Pollution (PUC) Expiry
                </label>
                <input
                  type="date"
                  value={form.pollutionExpiry}
                  onChange={(e) => handleChange("pollutionExpiry", e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-border bg-card text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Food Safety (FSSAI) Expiry
                </label>
                <input
                  type="date"
                  value={form.foodSafetyExpiry}
                  onChange={(e) => handleChange("foodSafetyExpiry", e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-border bg-card text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* Insurance & Advertisement */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Vehicle Insurance Expiry
                </label>
                <input
                  type="date"
                  value={form.insuranceExpiry}
                  onChange={(e) => handleChange("insuranceExpiry", e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-border bg-card text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Advertisement Permit Expiry
                </label>
                <input
                  type="date"
                  value={form.advertisementExpiry}
                  onChange={(e) => handleChange("advertisementExpiry", e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-border bg-card text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground pt-1">
              * Note: Leaving any field blank records a <code>NULL</code> (N/A) value in the database.
            </p>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border bg-muted/10 flex items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Saving…
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5 mr-1" /> Save Changes
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
