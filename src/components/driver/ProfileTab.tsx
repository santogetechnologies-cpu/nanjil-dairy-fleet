import { BadgeCheck, Lock, LogOut, MapPin, Phone, ShieldCheck, Truck, User } from "lucide-react";
import { Badge } from "@/components/ui-kit";
import type { DriverAssignedVehicle, DriverProfileData } from "./types";

interface ProfileTabProps {
  driver: DriverProfileData;
  vehicle: DriverAssignedVehicle;
  userEmail?: string;
  onLogout: () => void;
}

export function ProfileTab({ driver, vehicle, userEmail, onLogout }: ProfileTabProps) {
  const employeeId =
    driver.employee_id ||
    (driver.id ? `ND-${driver.id.slice(0, 6).toUpperCase()}` : "Unlinked");
  const accountStatus = driver.status || "Active";

  return (
    <div className="space-y-4">
      {/* Driver Identity Hero */}
      <div
        className="rounded-3xl p-5 sm:p-6 text-white space-y-4"
        style={{
          background: "linear-gradient(135deg, oklch(0.20 0.08 258) 0%, oklch(0.34 0.16 264) 100%)",
          boxShadow: "0 10px 28px oklch(0.30 0.14 264 / 0.22)",
        }}
      >
        <div className="flex items-center gap-3.5">
          <div className="h-14 w-14 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center text-xl font-extrabold shrink-0">
            {(driver.name || "D").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-extrabold truncate">{driver.name}</h2>
              <Badge status={accountStatus === "Active" ? "Completed" : "Idle"}>
                {accountStatus}
              </Badge>
            </div>
            <div className="text-xs text-white/75 mt-0.5 truncate">{userEmail || "Driver Account"}</div>
            <div className="text-[11px] font-mono text-emerald-300 mt-1">Employee ID: {employeeId}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/15 text-center">
          <div className="rounded-xl bg-white/10 p-2.5">
            <div className="text-lg font-extrabold">{driver.score}%</div>
            <div className="text-[10px] text-white/65">Safety Score</div>
          </div>
          <div className="rounded-xl bg-white/10 p-2.5">
            <div className="text-lg font-extrabold">{driver.trips}</div>
            <div className="text-[10px] text-white/65">Total Trips</div>
          </div>
          <div className="rounded-xl bg-white/10 p-2.5">
            <div className="text-lg font-extrabold">{Number(driver.total_km || 0).toLocaleString()}</div>
            <div className="text-[10px] text-white/65">Total KM</div>
          </div>
        </div>
      </div>

      {/* Admin-Controlled Details */}
      <div className="bg-card border border-border rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
            <User className="h-3.5 w-3.5 text-indigo-600" /> Driver &amp; Assignment Profile
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400">
            <Lock className="h-3 w-3" /> Read-Only
          </span>
        </div>

        <div className="divide-y divide-border text-xs">
          <div className="py-2.5 flex items-center justify-between gap-2">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <BadgeCheck className="h-3.5 w-3.5" /> Employee ID
            </span>
            <span className="font-mono font-bold text-foreground">{employeeId}</span>
          </div>
          <div className="py-2.5 flex items-center justify-between gap-2">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" /> Mobile Number
            </span>
            <span className="font-semibold text-foreground">{driver.phone || "Not registered"}</span>
          </div>
          <div className="py-2.5 flex items-center justify-between gap-2">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> License No
            </span>
            <span className="font-semibold text-foreground">{driver.license || "Not on file"}</span>
          </div>
          <div className="py-2.5 flex items-center justify-between gap-2">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5" /> Assigned Vehicle
            </span>
            <span className="font-bold text-indigo-700">
              {vehicle?.id ? `${vehicle.number}${vehicle.model ? ` (${vehicle.model})` : ""}` : "Unassigned"}
            </span>
          </div>
          <div className="py-2.5 flex items-center justify-between gap-2">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> Assigned Route
            </span>
            <span className="font-semibold text-foreground text-right max-w-[60%] truncate">
              {vehicle?.route || "No route assigned"}
            </span>
          </div>
          <div className="py-2.5 flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Account Status</span>
            <span className="font-bold text-emerald-700">{accountStatus}</span>
          </div>
        </div>

        <div className="rounded-xl p-3 bg-slate-50 border border-slate-200/80 text-[11px] text-slate-600 flex items-start gap-2">
          <Lock className="h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5" />
          <span>
            Vehicle assignments, routes, and permissions are managed exclusively by Fleet Administration.
          </span>
        </div>
      </div>

      {/* Logout Button */}
      <button
        type="button"
        onClick={onLogout}
        className="w-full min-h-[52px] rounded-2xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
      >
        <LogOut className="h-4 w-4" /> Sign Out of Driver Portal
      </button>
    </div>
  );
}
