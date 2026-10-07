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

/**
 * Generates realistic statutory compliance dates for fleet demonstration / initialization.
 * Accurately distributes:
 * - ~65% fully VALID (expiring in 5-11 months)
 * - ~20% EXPIRING SOON (expiring in 10-28 days)
 * - ~15% EXPIRED (expired 10-45 days ago)
 * Guarantees FC Expiry >= FC Inspection.
 */
export function generateSampleComplianceDates(
  vehicleId: string,
  variantIndex: number,
  refDate: Date = new Date()
) {
  const fmt = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const addDays = (base: Date, days: number) => {
    const copy = new Date(base.getTime());
    copy.setDate(copy.getDate() + days);
    return copy;
  };

  const mod = variantIndex % 10;

  if (mod === 0 || mod === 6) {
    // ── EXPIRED CASE ────────────────────────────────────────────────
    // At least one statutory item expired in the last 15-45 days
    const fcInsp = addDays(refDate, -380);
    const fcExp = addDays(refDate, -15); // FC expired 15 days ago
    const tnPermit = addDays(refDate, 120);
    const klPermit = mod === 0 ? addDays(refDate, 150) : null;
    const tnTax = addDays(refDate, -20); // Tax expired 20 days ago
    const klTax = null;
    const pollution = addDays(refDate, -8); // Pollution expired 8 days ago
    const foodSafety = addDays(refDate, 180);
    const insurance = addDays(refDate, -25); // Insurance expired 25 days ago
    const adv = addDays(refDate, 90);

    return {
      vehicle_id: vehicleId,
      fc_inspection_date: fmt(fcInsp),
      fc_expiry_date: fmt(fcExp),
      tn_permit_expiry: fmt(tnPermit),
      kl_permit_expiry: klPermit ? fmt(klPermit) : null,
      tn_tax_expiry: fmt(tnTax),
      kl_tax_expiry: klTax,
      pollution_expiry: fmt(pollution),
      food_safety_expiry: fmt(foodSafety),
      insurance_expiry: fmt(insurance),
      advertisement_expiry: fmt(adv),
    };
  } else if (mod === 1 || mod === 7) {
    // ── EXPIRING SOON CASE ──────────────────────────────────────────
    // At least one statutory item expiring in 10-28 days
    const fcInsp = addDays(refDate, -345);
    const fcExp = addDays(refDate, 20); // FC expiring in 20 days
    const tnPermit = addDays(refDate, 200);
    const klPermit = mod === 1 ? addDays(refDate, 220) : null;
    const tnTax = addDays(refDate, 14); // TN Tax expiring in 14 days
    const klTax = null;
    const pollution = addDays(refDate, 22); // Pollution expiring in 22 days
    const foodSafety = addDays(refDate, 190);
    const insurance = addDays(refDate, 160);
    const adv = addDays(refDate, 120);

    return {
      vehicle_id: vehicleId,
      fc_inspection_date: fmt(fcInsp),
      fc_expiry_date: fmt(fcExp),
      tn_permit_expiry: fmt(tnPermit),
      kl_permit_expiry: klPermit ? fmt(klPermit) : null,
      tn_tax_expiry: fmt(tnTax),
      kl_tax_expiry: klTax,
      pollution_expiry: fmt(pollution),
      food_safety_expiry: fmt(foodSafety),
      insurance_expiry: fmt(insurance),
      advertisement_expiry: fmt(adv),
    };
  } else {
    // ── VALID CASE ──────────────────────────────────────────────────
    // All statutory dates are 5 - 11 months in the future
    const offset = (variantIndex * 7) % 120; // stagger dates naturally
    const fcInsp = addDays(refDate, -60 - offset);
    const fcExp = addDays(refDate, 305 - offset);
    const tnPermit = addDays(refDate, 280 - offset);
    const klPermit = mod % 2 === 0 ? addDays(refDate, 310 - offset) : null;
    const tnTax = addDays(refDate, 240 - offset);
    const klTax = mod % 3 === 0 ? addDays(refDate, 260 - offset) : null;
    const pollution = addDays(refDate, 180 - offset);
    const foodSafety = addDays(refDate, 290 - offset);
    const insurance = addDays(refDate, 320 - offset);
    const adv = addDays(refDate, 210 - offset);

    return {
      vehicle_id: vehicleId,
      fc_inspection_date: fmt(fcInsp),
      fc_expiry_date: fmt(fcExp),
      tn_permit_expiry: fmt(tnPermit),
      kl_permit_expiry: klPermit ? fmt(klPermit) : null,
      tn_tax_expiry: fmt(tnTax),
      kl_tax_expiry: klTax ? fmt(klTax) : null,
      pollution_expiry: fmt(pollution),
      food_safety_expiry: fmt(foodSafety),
      insurance_expiry: fmt(insurance),
      advertisement_expiry: fmt(adv),
    };
  }
}
