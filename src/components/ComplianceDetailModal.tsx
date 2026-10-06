import { X, Calendar, ShieldCheck, AlertTriangle, AlertCircle, Clock, Edit2 } from "lucide-react";
import { type VehicleComplianceRecord } from "@/lib/types";
import {
  COMPLIANCE_STATUS_UI,
  calculateItemStatus,
  formatComplianceDate,
  DEFAULT_COMPLIANCE_WARNING_DAYS,
} from "@/lib/compliance";
import { Button } from "@/components/ui-kit";

interface Props {
  record: VehicleComplianceRecord | null;
  warningDays?: number;
  canManage: boolean;
  onClose: () => void;
  onEdit: (record: VehicleComplianceRecord) => void;
}

export function ComplianceDetailModal({
  record,
  warningDays = DEFAULT_COMPLIANCE_WARNING_DAYS,
  canManage,
  onClose,
  onEdit,
}: Props) {
  if (!record) return null;

  const items = [
    {
      title: "Fitness Certificate (FC)",
      isFC: true,
      inspectionDate: record.fcInspectionDate,
      expiryDate: record.fcExpiryDate,
      status: calculateItemStatus(record.fcExpiryDate, warningDays),
      mandatory: true,
    },
    {
      title: "Tamil Nadu Permit",
      expiryDate: record.tnPermitExpiry,
      status: calculateItemStatus(record.tnPermitExpiry, warningDays),
      mandatory: true,
    },
    {
      title: "Kerala Permit",
      expiryDate: record.klPermitExpiry,
      status: calculateItemStatus(record.klPermitExpiry, warningDays),
      mandatory: false,
    },
    {
      title: "Tamil Nadu Road Tax",
      expiryDate: record.tnTaxExpiry,
      status: calculateItemStatus(record.tnTaxExpiry, warningDays),
      mandatory: true,
    },
    {
      title: "Kerala Road Tax",
      expiryDate: record.klTaxExpiry,
      status: calculateItemStatus(record.klTaxExpiry, warningDays),
      mandatory: false,
    },
    {
      title: "Pollution Certificate (PUC)",
      expiryDate: record.pollutionExpiry,
      status: calculateItemStatus(record.pollutionExpiry, warningDays),
      mandatory: true,
    },
    {
      title: "Food Safety / FSSAI",
      expiryDate: record.foodSafetyExpiry,
      status: calculateItemStatus(record.foodSafetyExpiry, warningDays),
      mandatory: false,
    },
    {
      title: "Vehicle Insurance",
      expiryDate: record.insuranceExpiry,
      status: calculateItemStatus(record.insuranceExpiry, warningDays),
      mandatory: true,
    },
    {
      title: "Advertisement Permit",
      expiryDate: record.advertisementExpiry,
      status: calculateItemStatus(record.advertisementExpiry, warningDays),
      mandatory: false,
    },
  ];

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
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-xl font-bold tracking-tight text-foreground font-mono">
                {record.vehicleNo}
              </h2>
              <span className="px-2 py-0.5 text-xs font-semibold rounded-md bg-primary/10 text-primary border border-primary/20">
                {record.vehicleGroup}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Model: <span className="font-medium text-foreground">{record.model || "N/A"}</span> · Type:{" "}
              <span className="font-medium text-foreground">{record.type || "N/A"}</span>
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

        {/* Content list */}
        <div className="p-6 overflow-y-auto flex-1 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
            Statutory & Operational Requirements
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {items.map((item, idx) => {
              const itemUi = COMPLIANCE_STATUS_UI[item.status];
              return (
                <div
                  key={idx}
                  className="p-3.5 rounded-xl border border-border bg-card/60 hover:bg-muted/20 transition-colors flex flex-col justify-between gap-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-semibold text-foreground leading-tight">
                      {item.title}
                      {item.mandatory && <span className="text-primary ml-1" title="Mandatory statutory requirement">*</span>}
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full border ring-1 ring-inset shrink-0 ${itemUi.badgeCls}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${itemUi.dotCls}`} />
                      {itemUi.label}
                    </span>
                  </div>

                  <div className="text-xs text-muted-foreground space-y-1 mt-1">
                    {item.isFC && (
                      <div className="flex justify-between items-center text-[11px]">
                        <span>Inspection:</span>
                        <span className="font-mono text-foreground font-medium">
                          {formatComplianceDate(item.inspectionDate)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center text-[11px]">
                      <span>Expiry Date:</span>
                      <span className="font-mono text-foreground font-medium">
                        {formatComplianceDate(item.expiryDate)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {record.updatedAt && (
            <div className="pt-2 text-[11px] text-muted-foreground flex items-center justify-between border-t border-border">
              <span>Last Updated: {new Date(record.updatedAt).toLocaleString()}</span>
              {record.id && <span>Record ID: {record.id.slice(0, 8)}…</span>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-muted/10 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Warning Window: <span className="font-semibold text-foreground">{warningDays} days</span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
            {canManage && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onClose();
                  onEdit(record);
                }}
              >
                <Edit2 className="h-3.5 w-3.5 mr-1" /> Edit Compliance
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
