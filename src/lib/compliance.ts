// Vehicle Compliance calculation logic, status definitions, and date utilities

export type ComplianceItemStatus = "VALID" | "EXPIRING_SOON" | "EXPIRED" | "NOT_APPLICABLE";

// Central default warning window (in days)
export const DEFAULT_COMPLIANCE_WARNING_DAYS = 30;

export interface ComplianceFieldDefinition {
  key: string;
  dbColumn: string;
  label: string;
  isDate: boolean;
  isExpiry: boolean;
  isMandatory: boolean;
}

export const COMPLIANCE_FIELDS: ComplianceFieldDefinition[] = [
  { key: "fcInspectionDate", dbColumn: "fc_inspection_date", label: "FC Inspection", isDate: true, isExpiry: false, isMandatory: false },
  { key: "fcExpiryDate", dbColumn: "fc_expiry_date", label: "FC Expiry", isDate: true, isExpiry: true, isMandatory: true },
  { key: "tnPermitExpiry", dbColumn: "tn_permit_expiry", label: "TN Permit", isDate: true, isExpiry: true, isMandatory: true },
  { key: "klPermitExpiry", dbColumn: "kl_permit_expiry", label: "KL Permit", isDate: true, isExpiry: true, isMandatory: false },
  { key: "tnTaxExpiry", dbColumn: "tn_tax_expiry", label: "TN Tax", isDate: true, isExpiry: true, isMandatory: true },
  { key: "klTaxExpiry", dbColumn: "kl_tax_expiry", label: "KL Tax", isDate: true, isExpiry: true, isMandatory: false },
  { key: "pollutionExpiry", dbColumn: "pollution_expiry", label: "Pollution", isDate: true, isExpiry: true, isMandatory: true },
  { key: "foodSafetyExpiry", dbColumn: "food_safety_expiry", label: "Food Safety", isDate: true, isExpiry: true, isMandatory: false },
  { key: "insuranceExpiry", dbColumn: "insurance_expiry", label: "Insurance", isDate: true, isExpiry: true, isMandatory: true },
  { key: "advertisementExpiry", dbColumn: "advertisement_expiry", label: "Advertisement", isDate: true, isExpiry: true, isMandatory: false },
];

/**
 * Calculates status of a single compliance item based on current date
 */
export function calculateItemStatus(
  expiryDateStr: string | null | undefined,
  warningDays: number = DEFAULT_COMPLIANCE_WARNING_DAYS,
  referenceDate: Date = new Date()
): ComplianceItemStatus {
  if (!expiryDateStr || expiryDateStr.trim() === "") {
    return "NOT_APPLICABLE";
  }

  const expiry = new Date(expiryDateStr);
  if (isNaN(expiry.getTime())) {
    return "NOT_APPLICABLE";
  }

  const refMidnight = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate()).getTime();
  const expMidnight = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate()).getTime();

  const diffDays = Math.ceil((expMidnight - refMidnight) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return "EXPIRED";
  } else if (diffDays <= warningDays) {
    return "EXPIRING_SOON";
  } else {
    return "VALID";
  }
}

/**
 * Calculates overall vehicle compliance status based on its item statuses
 */
export function calculateOverallVehicleStatus(
  statuses: { status: ComplianceItemStatus; isMandatory: boolean }[]
): ComplianceItemStatus {
  // If ANY item with a date is EXPIRED -> overall EXPIRED
  if (statuses.some((s) => s.status === "EXPIRED")) {
    return "EXPIRED";
  }

  // If ANY item is EXPIRING_SOON -> overall EXPIRING_SOON
  if (statuses.some((s) => s.status === "EXPIRING_SOON")) {
    return "EXPIRING_SOON";
  }

  // If at least one item is VALID and no expired/expiring
  if (statuses.some((s) => s.status === "VALID")) {
    return "VALID";
  }

  // If all are NOT_APPLICABLE
  return "NOT_APPLICABLE";
}

/**
 * Formats a date string into DD.MM.YYYY format per project & reference convention
 */
export function formatComplianceDate(dateStr: string | null | undefined): string {
  if (!dateStr || dateStr.trim() === "") return "N/A";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "N/A";

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

/**
 * Normalizes vehicle models/types into reference checklist vehicle groups
 */
export function resolveVehicleGroup(model: string = "", type: string = ""): string {
  const m = (model || "").toUpperCase();
  if (m.includes("TARRUS") || m.includes("TAURUS") || m.includes("15 KL") || m.includes("20 KL") || m.includes("15KL") || m.includes("20KL")) {
    return "TAURUS";
  }
  if (m.includes("ECOMET") || m.includes("EICHER")) {
    return "ECOMET";
  }
  if (m.includes("BOSS")) {
    return "BOSS";
  }
  if (m.includes("709")) {
    return "TATA - 709";
  }
  if (m.includes("407")) {
    return "TATA - 407";
  }
  if (m.includes("DOST")) {
    return "BADA DOST";
  }
  if (m.includes("INTRA") || m.includes("INDRA")) {
    return "TATA INTRA";
  }
  if (m.includes("ACE")) {
    return "TATA ACE";
  }
  if (m.includes("PARTNER")) {
    return "ASHOK PARTNER";
  }
  return (model && model !== "Unknown Model" ? model : type) || "GENERAL FLEET";
}

export const COMPLIANCE_STATUS_UI: Record<
  ComplianceItemStatus,
  { label: string; badgeCls: string; dotCls: string; accent: "success" | "warning" | "destructive" | "info" }
> = {
  VALID: {
    label: "Valid",
    badgeCls: "bg-emerald-500/12 text-emerald-700 border-emerald-500/25 ring-emerald-500/15",
    dotCls: "bg-emerald-500",
    accent: "success",
  },
  EXPIRING_SOON: {
    label: "Expiring Soon",
    badgeCls: "bg-amber-500/12 text-amber-700 border-amber-500/25 ring-amber-500/15",
    dotCls: "bg-amber-500",
    accent: "warning",
  },
  EXPIRED: {
    label: "Expired",
    badgeCls: "bg-red-500/10 text-red-700 border-red-500/20 ring-red-500/10",
    dotCls: "bg-red-500",
    accent: "destructive",
  },
  NOT_APPLICABLE: {
    label: "N/A",
    badgeCls: "bg-slate-100 text-slate-600 border-slate-200 ring-slate-200",
    dotCls: "bg-slate-400",
    accent: "info",
  },
};
