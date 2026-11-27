import { useRef, useState } from "react";
import { Camera, CheckCircle2, ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import {
  type DriverFuelStationOption,
  NANJIL_FUEL_STATION_NAME,
} from "@/lib/driverOperationStatement";
import { compressReceiptImageToTarget } from "@/lib/imageCompression";
import type { DriverAssignedVehicle, DriverProfileData } from "./types";

export interface DriverFuelFormState {
  vehicleId: string;
  liters: number;
  pricePerLiter: number;
  odometer: number;
  isFullTank: boolean;
  stationOption: DriverFuelStationOption;
  station: string;
  receiptRef: string;
  receiptPhotoFile?: File | null;
  receiptPhotoDataUrl?: string | null;
  receiptPhotoSizeKb?: number | null;
  receiptPhotoOriginalSizeKb?: number | null;
}

interface DriverFuelModalProps {
  open: boolean;
  driver: DriverProfileData;
  vehicle: DriverAssignedVehicle;
  assignedVehicles: any[];
  authoritativeOdometer: number;
  form: DriverFuelFormState;
  error: string | null;
  submitting: boolean;
  onChangeForm: (next: DriverFuelFormState) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function DriverFuelModal({
  open,
  driver,
  vehicle,
  assignedVehicles,
  authoritativeOdometer,
  form,
  error,
  submitting,
  onChangeForm,
  onClose,
  onSubmit,
}: DriverFuelModalProps) {
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const [compressingPhoto, setCompressingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  if (!open) return null;

  async function handleReceiptFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;

    setPhotoError(null);
    setCompressingPhoto(true);
    try {
      const compressed = await compressReceiptImageToTarget(picked);
      const origKb = Math.round((compressed.originalSizeBytes / 1024) * 10) / 10;
      onChangeForm({
        ...form,
        receiptPhotoFile: compressed.file,
        receiptPhotoDataUrl: compressed.dataUrl,
        receiptPhotoSizeKb: compressed.sizeKb,
        receiptPhotoOriginalSizeKb: origKb,
      });
    } catch (err: any) {
      setPhotoError(err?.message || "Could not compress receipt photo.");
    } finally {
      setCompressingPhoto(false);
    }
  }

  function clearReceiptPhoto() {
    setPhotoError(null);
    onChangeForm({
      ...form,
      receiptPhotoFile: null,
      receiptPhotoDataUrl: null,
      receiptPhotoSizeKb: null,
      receiptPhotoOriginalSizeKb: null,
    });
  }

  const estimatedTotalCost = Math.round(
    Math.max(0, Number(form.liters || 0)) * Math.max(0, Number(form.pricePerLiter || 0))
  );
  const selectableVehicles =
    assignedVehicles.length > 0
      ? assignedVehicles
      : vehicle?.id
      ? [{ id: vehicle.id, number: vehicle.number, type: vehicle.type, odometer: vehicle.odometer }]
      : [];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-xs p-3 sm:p-4">
      <div className="bg-white rounded-3xl sm:rounded-2xl max-w-lg w-full p-5 border border-slate-200 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
        {/* Modal Header matching Admin Record Fuel Transaction */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-3">
          <div>
            <div className="text-base font-bold text-slate-900">Record Fuel Transaction</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Log refuel with physical odometer reading &amp; receipt
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium"
          >
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-3.5 text-xs">
          {/* Vehicle * & Driver */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1.5">Vehicle *</label>
              {selectableVehicles.length > 1 ? (
                <select
                  value={form.vehicleId}
                  onChange={(e) => {
                    const vId = e.target.value;
                    onChangeForm({
                      ...form,
                      vehicleId: vId,
                      odometer: 0,
                    });
                  }}
                  required
                  className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white font-semibold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
                >
                  <option value="">Select vehicle…</option>
                  {selectableVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.number} {v.type ? `(${v.type})` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  readOnly
                  value={
                    vehicle?.id
                      ? `${vehicle.number}${vehicle.type ? ` (${vehicle.type})` : ""}`
                      : "No Vehicle Assigned"
                  }
                  className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-slate-50 font-semibold text-slate-900 text-sm cursor-not-allowed"
                />
              )}
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1.5">Driver</label>
              <input
                type="text"
                readOnly
                value={driver.name}
                className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-slate-50 font-semibold text-slate-800 text-sm cursor-not-allowed"
              />
            </div>
          </div>

          {/* Volume (Litres) * & Price per Litre (₹) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1.5">Volume (Litres) *</label>
              <input
                type="number"
                step="any"
                min={0.01}
                inputMode="decimal"
                value={form.liters || ""}
                onChange={(e) =>
                  onChangeForm({ ...form, liters: parseFloat(e.target.value) || 0 })
                }
                placeholder="e.g. 60"
                required
                className="w-full h-11 px-3 rounded-xl border border-slate-200 font-bold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1.5">Price per Litre (₹) *</label>
              <input
                type="number"
                step="any"
                min={0.01}
                inputMode="decimal"
                value={form.pricePerLiter || ""}
                onChange={(e) =>
                  onChangeForm({ ...form, pricePerLiter: parseFloat(e.target.value) || 0 })
                }
                placeholder="e.g. 94.5"
                required
                className="w-full h-11 px-3 rounded-xl border border-slate-200 font-bold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
              />
            </div>
          </div>

          {/* Physical Odometer (km) * & Total Estimated Cost */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1.5">
                Physical Odometer (km) *
              </label>
              <input
                type="number"
                step="any"
                min={0}
                inputMode="decimal"
                value={form.odometer === 0 ? "" : form.odometer}
                onChange={(e) =>
                  onChangeForm({
                    ...form,
                    odometer: e.target.value === "" ? 0 : parseFloat(e.target.value) || 0,
                  })
                }
                placeholder={
                  authoritativeOdometer > 0 ? String(authoritativeOdometer) : "e.g. 66800"
                }
                required
                className="w-full h-11 px-3 rounded-xl border border-slate-200 font-mono font-bold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
              />
              {authoritativeOdometer > 0 && (
                <div className="text-[10px] text-slate-500 mt-1">
                  Current Odo: {authoritativeOdometer.toLocaleString()} km
                </div>
              )}
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1.5">Total Estimated Cost</label>
              <div className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-slate-900 text-sm flex items-center">
                ₹ {estimatedTotalCost.toLocaleString("en-IN")}
              </div>
            </div>
          </div>

          {/* Was tank filled to 100% (Full Tank)? */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-slate-800 text-xs">
                Was tank filled to 100% (Full Tank)?
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Full-tank fills enable verified km/L mileage calculations
              </div>
            </div>
            <button
              type="button"
              onClick={() => onChangeForm({ ...form, isFullTank: !form.isFullTank })}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 transition-colors cursor-pointer ${
                form.isFullTank
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "bg-slate-200 text-slate-700 hover:bg-slate-300"
              }`}
            >
              {form.isFullTank ? "Full Tank" : "Partial Fill"}
            </button>
          </div>

          {/* Fuel Station & Receipt / Invoice Ref */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1.5">Fuel Station *</label>
              <select
                value={form.stationOption}
                onChange={(e) => {
                  const nextOpt = e.target.value as DriverFuelStationOption;
                  setPhotoError(null);
                  onChangeForm({
                    ...form,
                    stationOption: nextOpt,
                    station: nextOpt === NANJIL_FUEL_STATION_NAME ? NANJIL_FUEL_STATION_NAME : "",
                    ...(nextOpt === NANJIL_FUEL_STATION_NAME
                      ? {
                          receiptPhotoFile: null,
                          receiptPhotoDataUrl: null,
                          receiptPhotoSizeKb: null,
                          receiptPhotoOriginalSizeKb: null,
                        }
                      : {}),
                  });
                }}
                required
                className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white font-semibold text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/25 cursor-pointer"
              >
                <option value="Nanjil Fuel Station">1. Nanjil Fuel Station</option>
                <option value="Others">2. Others</option>
              </select>

              {form.stationOption === "Others" && (
                <input
                  type="text"
                  value={form.station}
                  onChange={(e) => onChangeForm({ ...form, station: e.target.value })}
                  placeholder="Enter other fuel station name..."
                  required
                  className="mt-2 w-full h-11 px-3 rounded-xl border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
                />
              )}
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1.5">
                Receipt / Invoice Ref
              </label>
              <input
                type="text"
                value={form.receiptRef}
                onChange={(e) => onChangeForm({ ...form, receiptRef: e.target.value })}
                placeholder="e.g. INV-9812"
                className="w-full h-11 px-3 rounded-xl border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
              />
            </div>
          </div>

          {/* Receipt Camera & Compressed Photo Upload (shown when "2. Others" is selected) */}
          {form.stationOption === "Others" && (
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-800 text-xs">
                    Fuel Receipt Photo <span className="text-slate-400 font-normal">(Auto-compressed 10–50 KB)</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    Take a camera photo or upload receipt image for outside fuel station
                  </div>
                </div>
              </div>

              {/* Hidden file inputs: camera (environment capture) + gallery upload */}
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleReceiptFileSelected}
                className="hidden"
              />
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                onChange={handleReceiptFileSelected}
                className="hidden"
              />

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={compressingPhoto || submitting}
                  onClick={() => cameraInputRef.current?.click()}
                  className="h-10 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-2xs disabled:opacity-50 cursor-pointer"
                >
                  <Camera className="h-4 w-4" />
                  <span>Open Camera</span>
                </button>
                <button
                  type="button"
                  disabled={compressingPhoto || submitting}
                  onClick={() => galleryInputRef.current?.click()}
                  className="h-10 px-3 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 font-semibold text-xs flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <ImagePlus className="h-4 w-4 text-indigo-600" />
                  <span>Upload Photo</span>
                </button>
              </div>

              {compressingPhoto && (
                <div className="flex items-center gap-2 text-xs text-indigo-700 font-medium py-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Compressing receipt photo to 10–50 KB…</span>
                </div>
              )}

              {photoError && (
                <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-700 font-medium">
                  {photoError}
                </div>
              )}

              {form.receiptPhotoDataUrl && !compressingPhoto && (
                <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-white border border-emerald-200">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <img
                      src={form.receiptPhotoDataUrl}
                      alt="Compressed fuel receipt preview"
                      className="h-12 w-12 rounded-lg object-cover border border-slate-200 shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        <span>Receipt Attached</span>
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        Compressed: <span className="font-bold text-slate-700">{form.receiptPhotoSizeKb} KB</span>
                        {form.receiptPhotoOriginalSizeKb
                          ? ` (from ${form.receiptPhotoOriginalSizeKb} KB)`
                          : ""}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearReceiptPhoto}
                    aria-label="Remove receipt photo"
                    className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 cursor-pointer shrink-0"
                    title="Remove photo"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Actions: Cancel & + Submit Refill */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 min-h-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !vehicle?.id}
              className="px-5 min-h-[44px] rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm disabled:opacity-50 cursor-pointer"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              <span>Submit Refill</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
