import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Fuel,
  Gauge,
  Loader2,
  Lock,
} from "lucide-react";
import { Badge } from "@/components/ui-kit";
import {
  computeRunningKm,
  computeTripKmpl,
  formatIsoToIstTime,
  formatStatementNumber,
  parseStrictNumericInput,
  type ValidationFieldErrors,
  type VehicleOperationTripRecord,
} from "@/lib/driverOperationStatement";
import { getTodayIstDateString } from "@/lib/odometerTrackingEngine";
import type { DriverAssignedVehicle, DriverProfileData } from "./types";

export interface CloseStatementFormState {
  inKm: string;
  inDate: string;
  inTime: string;
  dieselLitres: string;
  fuelAmount: string;
  salesmanName: string;
  notes: string;
}

interface VehicleOperationStatementFormProps {
  trip: VehicleOperationTripRecord;
  driver: DriverProfileData;
  vehicle: DriverAssignedVehicle;
  authoritativeOdometer: number;
  form: CloseStatementFormState;
  errors: ValidationFieldErrors;
  submitting: boolean;
  showConfirmModal: boolean;
  onChangeForm: (updater: (prev: CloseStatementFormState) => CloseStatementFormState) => void;
  onClearError: (keys: (keyof ValidationFieldErrors)[]) => void;
  onSubmitPrepare: (e: React.FormEvent) => void;
  onConfirmSubmit: () => void;
  onCloseConfirmModal: () => void;
  onBackToActiveTrip: () => void;
}

export function VehicleOperationStatementForm({
  trip,
  driver,
  vehicle,
  authoritativeOdometer,
  form,
  errors,
  submitting,
  showConfirmModal,
  onChangeForm,
  onClearError,
  onSubmitPrepare,
  onConfirmSubmit,
  onCloseConfirmModal,
  onBackToActiveTrip,
}: VehicleOperationStatementFormProps) {
  const statementNo = formatStatementNumber(trip);
  const outKm = Number(trip.start_km ?? authoritativeOdometer ?? 0);
  const outDate = trip.out_date || trip.date || getTodayIstDateString();
  const outTime = trip.out_time || formatIsoToIstTime(trip.started_at || trip.created_at) || "00:00";
  const routeLabel = trip.destination ? `${trip.start} → ${trip.destination}` : trip.start || vehicle.route;
  const vehicleNumber = trip.vehicles?.number || vehicle.number || "Assigned";

  const parsedInKm = parseStrictNumericInput(form.inKm);
  const hasPositiveInKm = parsedInKm.valid && parsedInKm.value > 0;
  const isBelowOutKm = hasPositiveInKm && parsedInKm.value < outKm;
  const liveRunningKm =
    hasPositiveInKm && !isBelowOutKm ? computeRunningKm(outKm, parsedInKm.value) : null;

  const parsedDiesel = parseStrictNumericInput(form.dieselLitres);
  const validDiesel = parsedDiesel.valid && parsedDiesel.value > 0 ? parsedDiesel.value : 0;
  const liveKmpl =
    liveRunningKm !== null ? computeTripKmpl(liveRunningKm, validDiesel) : null;

  return (
    <div className="space-y-4">
      <div className="bg-card border border-indigo-200/80 rounded-3xl overflow-hidden shadow-md">
        {/* Form Title Bar */}
        <div
          className="px-5 py-4 text-white flex items-center justify-between gap-3"
          style={{
            background: "linear-gradient(135deg, oklch(0.18 0.08 258) 0%, oklch(0.32 0.16 264) 100%)",
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onBackToActiveTrip}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white shrink-0 cursor-pointer"
              aria-label="Back to active trip"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-white/70">
                Nanjil Integrated Dairy Development
              </div>
              <div className="text-sm sm:text-base font-extrabold truncate">
                Vehicle Operation Statement
              </div>
            </div>
          </div>
          <Badge status="Moving">Closing</Badge>
        </div>

        <form onSubmit={onSubmitPrepare} noValidate className="p-4 sm:p-5 space-y-5">
          {/* ── A. BASIC DETAILS ── */}
          <section className="space-y-3">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-700 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> A. Basic Details
            </div>
            <div className="grid grid-cols-2 gap-2.5 text-xs bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80">
              <div>
                <div className="text-[10px] font-bold uppercase text-slate-400">Statement No</div>
                <div className="font-mono font-bold text-slate-900 mt-0.5">{statementNo}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase text-slate-400">Vehicle Number</div>
                <div className="font-extrabold text-slate-900 mt-0.5">{vehicleNumber}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase text-slate-400">Date</div>
                <div className="font-semibold text-slate-800 mt-0.5">{trip.date || outDate}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase text-slate-400">Driver Name</div>
                <div className="font-semibold text-slate-800 mt-0.5 truncate">{driver.name}</div>
              </div>
              <div className="col-span-2">
                <div className="text-[10px] font-bold uppercase text-slate-400">Assigned Route</div>
                <div className="font-semibold text-slate-800 mt-0.5">{routeLabel}</div>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                Salesman <span className="normal-case font-normal text-slate-400">(optional)</span>
              </label>
              <input
                type="text"
                value={form.salesmanName}
                onChange={(e) =>
                  onChangeForm((prev) => ({ ...prev, salesmanName: e.target.value }))
                }
                placeholder="Enter salesman name if accompanied"
                className="w-full h-12 px-3.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </section>

          {/* ── B. TRIP DETAILS ── */}
          <section className="space-y-3 pt-2 border-t border-border/70">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-700">
              B. Trip Details (IST)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                  <span>Out Date</span>
                  <Lock className="h-3 w-3 text-slate-400" />
                </label>
                <input
                  type="text"
                  readOnly
                  tabIndex={-1}
                  value={outDate}
                  className="w-full h-12 px-3 rounded-xl border border-border bg-muted/70 text-sm font-semibold text-muted-foreground cursor-not-allowed"
                />
              </div>
              <div>
                <label className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                  <span>Out Time</span>
                  <Lock className="h-3 w-3 text-slate-400" />
                </label>
                <input
                  type="text"
                  readOnly
                  tabIndex={-1}
                  value={`${outTime} IST`}
                  className="w-full h-12 px-3 rounded-xl border border-border bg-muted/70 text-sm font-semibold text-muted-foreground cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-700 mb-1.5">
                  In Date *
                </label>
                <input
                  type="date"
                  required
                  value={form.inDate}
                  min={outDate}
                  onChange={(e) => {
                    onChangeForm((prev) => ({ ...prev, inDate: e.target.value }));
                    onClearError(["inDate", "inTime", "general"]);
                  }}
                  className={`w-full h-12 px-3 rounded-xl border bg-background text-sm font-semibold focus:outline-none focus:ring-2 ${
                    errors.inDate
                      ? "border-red-500 focus:ring-red-500/25"
                      : "border-border focus:ring-primary/30"
                  }`}
                />
                {errors.inDate && (
                  <p className="mt-1 text-xs font-semibold text-red-600">{errors.inDate}</p>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-700 mb-1.5">
                  In Time *
                </label>
                <input
                  type="time"
                  required
                  value={form.inTime}
                  onChange={(e) => {
                    onChangeForm((prev) => ({ ...prev, inTime: e.target.value }));
                    onClearError(["inTime", "general"]);
                  }}
                  className={`w-full h-12 px-3 rounded-xl border bg-background text-sm font-semibold focus:outline-none focus:ring-2 ${
                    errors.inTime
                      ? "border-red-500 focus:ring-red-500/25"
                      : "border-border focus:ring-primary/30"
                  }`}
                />
                {errors.inTime && (
                  <p className="mt-1 text-xs font-semibold text-red-600">{errors.inTime}</p>
                )}
              </div>
            </div>
          </section>

          {/* ── C. ODOMETER DETAILS ── */}
          <section className="space-y-3 pt-2 border-t border-border/70">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-700 flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5" /> C. Odometer Details
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                  <span>Out KM (Read-Only)</span>
                  <span className="inline-flex items-center gap-1 text-[9px] text-slate-500">
                    <Lock className="h-2.5 w-2.5" /> Locked
                  </span>
                </label>
                <input
                  type="text"
                  readOnly
                  tabIndex={-1}
                  aria-label="Out KM"
                  value={`${outKm.toLocaleString()} KM`}
                  className="w-full h-14 px-4 rounded-xl border border-border bg-muted/70 text-base font-bold text-muted-foreground cursor-not-allowed select-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-primary mb-1.5">
                  In KM (Closing Reading) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  required
                  aria-label="In KM"
                  value={form.inKm}
                  onChange={(e) => {
                    onChangeForm((prev) => ({ ...prev, inKm: e.target.value }));
                    onClearError(["inKm", "general"]);
                  }}
                  placeholder={`>= ${outKm}`}
                  className={`w-full h-14 px-4 rounded-xl border-2 text-lg font-extrabold bg-background focus:outline-none focus:ring-2 ${
                    errors.inKm || isBelowOutKm
                      ? "border-red-500 focus:ring-red-500/25 text-red-700"
                      : "border-indigo-500 focus:border-indigo-700 focus:ring-indigo-500/25 text-slate-900"
                  }`}
                />
                {errors.inKm ? (
                  <p className="mt-1.5 text-xs font-semibold text-red-600 flex items-start gap-1">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{errors.inKm}</span>
                  </p>
                ) : isBelowOutKm ? (
                  <p className="mt-1.5 text-xs font-semibold text-red-600">
                    Invalid In KM: Reading cannot be lower than Out KM.
                  </p>
                ) : null}
              </div>
            </div>

            {/* Running KM & KMPL live calculation strip */}
            <div className="grid grid-cols-2 gap-3 p-3.5 rounded-2xl bg-indigo-50 border border-indigo-200">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                  Running KMs (Auto)
                </div>
                <div className="text-xl font-extrabold text-indigo-950 mt-0.5">
                  {liveRunningKm !== null ? `${liveRunningKm.toLocaleString()} KM` : "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                  KMPL (Auto)
                </div>
                <div className="text-xl font-extrabold text-indigo-950 mt-0.5">
                  {liveKmpl !== null ? `${liveKmpl.toFixed(2)} km/L` : "N/A"}
                </div>
              </div>
            </div>
          </section>

          {/* ── D. FUEL DETAILS ── */}
          <section className="space-y-3 pt-2 border-t border-border/70">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-700 flex items-center gap-1.5">
              <Fuel className="h-3.5 w-3.5" /> D. Fuel Details
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1.5">
                  Diesel (Litres)
                </label>
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  min={0}
                  value={form.dieselLitres}
                  onChange={(e) => {
                    onChangeForm((prev) => ({ ...prev, dieselLitres: e.target.value }));
                    onClearError(["dieselLitres", "general"]);
                  }}
                  placeholder="0.00"
                  className={`w-full h-12 px-3 rounded-xl border bg-background text-sm font-semibold focus:outline-none focus:ring-2 ${
                    errors.dieselLitres
                      ? "border-red-500 focus:ring-red-500/25"
                      : "border-border focus:ring-primary/30"
                  }`}
                />
                {errors.dieselLitres && (
                  <p className="mt-1 text-xs font-semibold text-red-600">{errors.dieselLitres}</p>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1.5">
                  Amount (₹ INR)
                </label>
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  min={0}
                  value={form.fuelAmount}
                  onChange={(e) => {
                    onChangeForm((prev) => ({ ...prev, fuelAmount: e.target.value }));
                    onClearError(["fuelAmount", "general"]);
                  }}
                  placeholder="0.00"
                  className={`w-full h-12 px-3 rounded-xl border bg-background text-sm font-semibold focus:outline-none focus:ring-2 ${
                    errors.fuelAmount
                      ? "border-red-500 focus:ring-red-500/25"
                      : "border-border focus:ring-primary/30"
                  }`}
                />
                {errors.fuelAmount && (
                  <p className="mt-1 text-xs font-semibold text-red-600">{errors.fuelAmount}</p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                Remarks <span className="normal-case font-normal text-slate-400">(optional)</span>
              </label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) =>
                  onChangeForm((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder="Any delay, toll, or route notes"
                className="w-full h-11 px-3.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </section>

          {errors.general && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errors.general}</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 min-h-[56px] rounded-2xl text-sm sm:text-base font-extrabold text-white flex items-center justify-center gap-2 shadow-md transition-all hover:opacity-95 disabled:opacity-50 cursor-pointer"
              style={{
                background: "linear-gradient(135deg, oklch(0.44 0.22 264), oklch(0.36 0.18 258))",
              }}
            >
              {submitting ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5" />
                  <span>Submit &amp; Update Odometer</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onBackToActiveTrip}
              disabled={submitting}
              className="sm:w-32 min-h-[48px] rounded-2xl text-sm font-bold border border-border bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Back
            </button>
          </div>
        </form>
      </div>

      {/* ── TRIP CLOSURE CONFIRMATION DIALOG ── */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 z-50">
          <div
            className="w-full max-w-sm rounded-3xl overflow-hidden bg-white"
            style={{ boxShadow: "0 24px 64px rgba(10,20,60,0.28)" }}
          >
            <div
              className="px-5 py-4 text-white"
              style={{ background: "linear-gradient(135deg, oklch(0.16 0.07 258), oklch(0.22 0.09 265))" }}
            >
              <div className="font-bold text-base">Confirm Trip Completion</div>
              <div className="text-white/70 text-xs mt-0.5">
                Vehicle master odometer will update atomically &amp; statement becomes read-only.
              </div>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Statement</div>
                  <div className="font-mono font-bold text-slate-900 text-xs">{statementNo}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Vehicle</div>
                  <div className="font-bold text-slate-900">{vehicleNumber}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Out KM</div>
                  <div className="font-semibold text-slate-800">{outKm.toLocaleString()} KM</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">In KM (New Master Odo)</div>
                  <div className="font-extrabold text-indigo-700">
                    {Number(form.inKm).toLocaleString()} KM
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Running KMs</div>
                  <div className="font-extrabold text-emerald-700">
                    {computeRunningKm(outKm, Number(form.inKm)).toLocaleString()} KM
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Diesel / KMPL</div>
                  <div className="font-semibold text-slate-800">
                    {Number(form.dieselLitres || 0) > 0
                      ? `${form.dieselLitres} L (${liveKmpl != null ? `${liveKmpl.toFixed(2)} km/L` : "N/A"})`
                      : "0 L (N/A)"}
                  </div>
                </div>
              </div>

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={onCloseConfirmModal}
                  className="flex-1 min-h-[48px] rounded-xl text-sm font-semibold border border-border bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={onConfirmSubmit}
                  className="flex-1 min-h-[48px] rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 cursor-pointer"
                  style={{ background: "linear-gradient(135deg, oklch(0.44 0.22 264), oklch(0.36 0.18 258))" }}
                >
                  {submitting ? <Loader2 className="animate-spin h-4 w-4" /> : "Confirm & Close"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
