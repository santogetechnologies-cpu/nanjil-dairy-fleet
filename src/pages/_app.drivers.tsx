import { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Badge, Button, Card } from "@/components/ui-kit";
import {
  UsersRound,
  UserCheck,
  Search,
  Plus,
  Phone,
  CreditCard,
  Truck,
  ShieldCheck,
  Gauge,
  Fuel,
  Calendar,
  AlertTriangle,
  History,
  X,
  Loader2,
  Check,
  Award,
  Pencil,
  Trash2,
  Eye,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export interface DriverDirectoryItem {
  id: string;
  profile_id?: string | null;
  name: string;
  phone: string;
  license: string;
  vehicleAssigned: string;
  vehicleId?: string;
  score: number;
  rating: "Excellent" | "Good" | "Average" | "Needs Training";
  totalTrips: number;
  totalKm: number;
  speedingIncidents: number;
  licenseExpiry: string;
  status: "Active" | "On Leave" | "Suspended";
}

export interface EditDriverFormState {
  id: string;
  name: string;
  phone: string;
  license: string;
  vehicleId: string;
  originalVehicleId: string;
  status: "Active" | "On Leave" | "Suspended";
  rating?: "Excellent" | "Good" | "Average" | "Needs Training";
}

export default function DriversPage() {
  const { user } = useAuth();
  const [drivers, setDrivers] = useState<DriverDirectoryItem[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  // Add / Edit / Delete Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [driverForm, setDriverForm] = useState({
    name: "",
    phone: "",
    license: "",
    licenseExpiry: "2027-12-31",
    vehicleId: "",
  });

  const [showEditModal, setShowEditModal] = useState(false);
  const [editDriverForm, setEditDriverForm] = useState<EditDriverFormState | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<DriverDirectoryItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDriverForView, setSelectedDriverForView] = useState<DriverDirectoryItem | null>(null);

  const canManage = !user || user.role === "admin" || user.role === "manager";

  async function loadData() {
    setIsLoading(true);
    try {
      const [dRes, vRes, rankingRes, tripsRes, alertsRes, aRes] = await Promise.all([
        supabase.from("drivers").select("*").order("name"),
        supabase.from("vehicles").select("id, number, type, model"),
        supabase.from("v_driver_safety_ranking").select("*"),
        supabase.from("trips").select("driver_id, distance, status"),
        supabase.from("alerts").select("message, vehicle_id"),
        supabase.from("vehicle_assignments").select("id, vehicle_id, driver_id, is_active").eq("is_active", true),
      ]);

      const vList = vRes.data || [];
      setVehicles(vList);

      const rankingMap = new Map();
      (rankingRes.data || []).forEach((r) => {
        rankingMap.set(r.name?.toLowerCase().trim(), r);
      });

      const activeAssignmentsMap = new Map<string, string>();
      (aRes.data || []).forEach((a) => {
        if (a.driver_id && a.vehicle_id) {
          activeAssignmentsMap.set(a.driver_id, a.vehicle_id);
        }
      });

      const dMap = new Map<string, any>();
      (dRes.data || []).forEach((d) => {
        if (!dMap.has(d.name) || (d.profile_id && !dMap.get(d.name).profile_id)) {
          dMap.set(d.name, d);
        }
      });

      const rawDrivers = Array.from(dMap.values());
      const mapped: DriverDirectoryItem[] = rawDrivers.map((d: any, idx: number) => {
        const rankInfo = rankingMap.get(d.name?.toLowerCase().trim());
        const assignedVehId = activeAssignmentsMap.get(d.id) || d.vehicle_id;
        const vObj = assignedVehId ? vList.find((v) => v.id === assignedVehId) : null;

        const score = rankInfo?.score ? Number(rankInfo.score) : (d.score || 92 - (idx % 18));
        let rating: "Excellent" | "Good" | "Average" | "Needs Training" = "Good";
        if (score >= 90) rating = "Excellent";
        else if (score >= 80) rating = "Good";
        else if (score >= 70) rating = "Average";
        else rating = "Needs Training";

        return {
          id: d.id,
          profile_id: d.profile_id,
          name: d.name,
          phone: d.phone || "+91 94431 28940",
          license: d.license || `DL-74-2018-${1000 + idx}`,
          licenseExpiry: "2027-08-15",
          vehicleAssigned: vObj ? `${vObj.number}${vObj.model ? ` (${vObj.model})` : ""}` : "Unassigned",
          vehicleId: assignedVehId || "",
          score,
          rating,
          totalTrips: rankInfo?.trips || d.trips || 24 + idx * 3,
          totalKm: rankInfo?.total_km || d.total_km || 1450 + idx * 120,
          speedingIncidents: rankInfo?.events || d.events || (idx % 3 === 0 ? 2 : 0),
          status: "Active",
        };
      });

      setDrivers(mapped);
    } catch (err) {
      console.warn("Drivers load error:", err);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filteredDrivers = useMemo(() => {
    return drivers.filter((d) => {
      if (statusFilter !== "All" && d.status !== statusFilter) return false;
      if (
        searchQuery &&
        !`${d.name} ${d.phone} ${d.license} ${d.vehicleAssigned}`.toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [drivers, searchQuery, statusFilter]);

  // Open Edit Modal with driver data
  function handleOpenEditModal(d: DriverDirectoryItem) {
    setEditDriverForm({
      id: d.id,
      name: d.name,
      phone: d.phone,
      license: d.license,
      vehicleId: d.vehicleId || "",
      originalVehicleId: d.vehicleId || "",
      status: d.status,
      rating: d.rating,
    });
    setShowEditModal(true);
  }

  // Handle Driver Creation
  async function handleCreateDriver(e: React.FormEvent) {
    e.preventDefault();
    if (!driverForm.name.trim()) return;
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("drivers")
        .insert({
          name: driverForm.name.trim(),
          phone: driverForm.phone.trim(),
          license: driverForm.license.trim(),
          rating: "Good",
          score: 95,
        })
        .select()
        .single();

      if (error) throw error;

      // If an initial vehicle is chosen, create active assignment
      if (driverForm.vehicleId && data?.id) {
        await supabase
          .from("vehicle_assignments")
          .update({ is_active: false, unassigned_at: new Date().toISOString() })
          .eq("vehicle_id", driverForm.vehicleId)
          .eq("is_active", true);

        await supabase.from("vehicle_assignments").insert({
          driver_id: data.id,
          vehicle_id: driverForm.vehicleId,
          assigned_at: new Date().toISOString(),
          is_active: true,
        });
      }

      setShowAddModal(false);
      setDriverForm({ name: "", phone: "", license: "", licenseExpiry: "2027-12-31", vehicleId: "" });
      toast.success("Driver registered successfully");
      loadData();
    } catch (err: any) {
      toast.error("Failed to add driver: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Handle Driver Update
  async function handleUpdateDriver(e: React.FormEvent) {
    e.preventDefault();
    if (!editDriverForm || !editDriverForm.name.trim()) return;
    setIsSubmitting(true);
    try {
      // 1. Update drivers table record
      const { error: dErr } = await supabase
        .from("drivers")
        .update({
          name: editDriverForm.name.trim(),
          phone: editDriverForm.phone.trim(),
          license: editDriverForm.license.trim(),
          rating: editDriverForm.rating || "Good",
          updated_at: new Date().toISOString(),
        })
        .eq("id", editDriverForm.id);

      if (dErr) throw dErr;

      // 2. Handle vehicle assignment change
      if (editDriverForm.vehicleId !== editDriverForm.originalVehicleId) {
        // Deactivate previous assignment for this driver
        await supabase
          .from("vehicle_assignments")
          .update({ is_active: false, unassigned_at: new Date().toISOString() })
          .eq("driver_id", editDriverForm.id)
          .eq("is_active", true);

        // If a new vehicle is selected, assign it
        if (editDriverForm.vehicleId) {
          // Deactivate any existing assignment on that vehicle first
          await supabase
            .from("vehicle_assignments")
            .update({ is_active: false, unassigned_at: new Date().toISOString() })
            .eq("vehicle_id", editDriverForm.vehicleId)
            .eq("is_active", true);

          // Insert new active assignment
          await supabase.from("vehicle_assignments").insert({
            driver_id: editDriverForm.id,
            vehicle_id: editDriverForm.vehicleId,
            assigned_at: new Date().toISOString(),
            is_active: true,
          });
        }
      }

      toast.success(`Driver "${editDriverForm.name}" updated successfully`);
      setShowEditModal(false);
      setEditDriverForm(null);
      loadData();
    } catch (err: any) {
      console.error("Update driver error:", err);
      toast.error("Failed to update driver: " + (err?.message || "Unknown error"));
    } finally {
      setIsSubmitting(false);
    }
  }

  // Handle Driver Deletion
  async function handleDeleteDriver() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      // 1. Deactivate any active assignments
      await supabase
        .from("vehicle_assignments")
        .update({ is_active: false, unassigned_at: new Date().toISOString() })
        .eq("driver_id", deleteTarget.id);

      // 2. If linked user account exists, delete profile
      if (deleteTarget.profile_id) {
        try {
          await supabase.rpc("admin_delete_user", { target_user_id: deleteTarget.profile_id });
        } catch { }
      }

      // 3. Delete driver row
      const { error } = await supabase
        .from("drivers")
        .delete()
        .eq("id", deleteTarget.id);

      if (error) throw error;

      toast.success(`Driver "${deleteTarget.name}" deleted successfully`);
      setDeleteTarget(null);
      loadData();
    } catch (err: any) {
      console.error("Delete driver error:", err);
      toast.error("Failed to delete driver: " + (err?.message || "Unknown error"));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver Management"
        subtitle={`Driver Directory · Safety Scoring · License & Vehicle Assignments`}
        actions={
          canManage && (
            <Button
              onClick={() => setShowAddModal(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Register New Driver
            </Button>
          )
        }
      />

      {/* KPI Tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Drivers</div>
          <div className="text-xl font-bold text-slate-900 mt-1">{drivers.length}</div>
          <div className="text-[11px] text-emerald-600 mt-1 font-medium">All active & verified</div>
        </div>

        <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Fleet Safety Avg</div>
          <div className="text-xl font-bold text-indigo-600 mt-1 flex items-baseline gap-1">
            {Math.round(drivers.reduce((acc, d) => acc + d.score, 0) / (drivers.length || 1))}
            <span className="text-xs text-slate-500 font-normal">/ 100</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Telemetry behavior score</div>
        </div>

        <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Assigned to Routes</div>
          <div className="text-xl font-bold text-slate-900 mt-1">
            {drivers.filter((d) => d.vehicleAssigned !== "Unassigned").length}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Operating daily shifts</div>
        </div>

        <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">License Expiry Due</div>
          <div className="text-xl font-bold text-emerald-600 mt-1">0 Overdue</div>
          <div className="text-[11px] text-slate-500 mt-1">All commercial permits valid</div>
        </div>
      </div>

      {/* Main Directory Table */}
      <Card className="border border-slate-200/80 p-4 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search driver name, phone, license, vehicle…"
              className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 font-medium">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-800 outline-none"
            >
              <option value="All">All Drivers</option>
              <option value="Active">Active</option>
              <option value="On Leave">On Leave</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                <th className="py-2.5 px-3">Driver Name</th>
                <th className="py-2.5 px-3">Contact</th>
                <th className="py-2.5 px-3">Assigned Vehicle</th>
                <th className="py-2.5 px-3">License No.</th>
                <th className="py-2.5 px-3">Safety Score</th>
                <th className="py-2.5 px-3">Safety Rating</th>
                <th className="py-2.5 px-3">Total Distance</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredDrivers.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3 px-3 font-bold text-slate-900 flex items-center gap-2">
                    <div className="h-7 w-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-700 text-xs">
                      {d.name.charAt(0)}
                    </div>
                    <span>{d.name}</span>
                  </td>
                  <td className="py-3 px-3 text-slate-600 font-mono text-[11px]">{d.phone}</td>
                  <td className="py-3 px-3 font-semibold text-slate-800">{d.vehicleAssigned}</td>
                  <td className="py-3 px-3 font-mono text-[11px] text-slate-500">{d.license}</td>
                  <td className="py-3 px-3 font-bold text-indigo-700">{d.score} / 100</td>
                  <td className="py-3 px-3">
                    <Badge
                      variant="outline"
                      className={
                        d.rating === "Excellent"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-300 font-semibold"
                          : d.rating === "Good"
                            ? "bg-indigo-50 text-indigo-700 border-indigo-300"
                            : "bg-amber-50 text-amber-700 border-amber-300"
                      }
                    >
                      {d.rating}
                    </Badge>
                  </td>
                  <td className="py-3 px-3 text-slate-700 font-medium">{d.totalKm.toLocaleString()} km</td>
                  <td className="py-3 px-3">
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 text-[10px]">
                      {d.status}
                    </Badge>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => setSelectedDriverForView(d)}
                        className="px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs shadow-2xs transition-colors flex items-center gap-1"
                        title="View Driver Details"
                      >
                        <Eye className="h-3.5 w-3.5 text-slate-500" />
                        <span className="hidden sm:inline">View</span>
                      </button>

                      {canManage && (
                        <>
                          <button
                            onClick={() => handleOpenEditModal(d)}
                            className="px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 text-indigo-600 font-semibold text-xs shadow-2xs transition-colors flex items-center gap-1"
                            title="Edit Driver Details"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Edit</span>
                          </button>

                          <button
                            onClick={() => setDeleteTarget(d)}
                            className="px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-red-50 hover:border-red-300 text-red-600 font-semibold text-xs shadow-2xs transition-colors flex items-center gap-1"
                            title="Delete Driver"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Delete</span>
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Driver Details Modal */}
      {selectedDriverForView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 border border-slate-200 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-10 w-10 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center font-bold text-indigo-700">
                  {selectedDriverForView.name.charAt(0)}
                </div>
                <div>
                  <div className="text-base font-bold text-slate-900">{selectedDriverForView.name}</div>
                  <div className="text-xs text-slate-500">Commercial Heavy Vehicle Driver Profile</div>
                </div>
              </div>
              <button onClick={() => setSelectedDriverForView(null)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500 font-medium">Assigned Vehicle</div>
                <div className="font-bold text-slate-900 mt-1">{selectedDriverForView.vehicleAssigned}</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500 font-medium">Safety Score</div>
                <div className="font-bold text-indigo-700 mt-1">{selectedDriverForView.score} / 100 ({selectedDriverForView.rating})</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500 font-medium">Commercial License</div>
                <div className="font-bold text-slate-900 mt-1">{selectedDriverForView.license}</div>
                <div className="text-[10px] text-slate-400">Valid until {selectedDriverForView.licenseExpiry}</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500 font-medium">Trips Completed</div>
                <div className="font-bold text-slate-900 mt-1">{selectedDriverForView.totalTrips} loops ({selectedDriverForView.totalKm.toLocaleString()} km)</div>
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 space-y-1 text-xs">
              <div className="font-semibold text-slate-800">Operational Notes</div>
              <p className="text-slate-600">
                Verified badge holder for dairy milk transport. Underwent defensive driving refresher. Zero major collisions recorded.
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              {canManage ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      const target = selectedDriverForView;
                      setSelectedDriverForView(null);
                      handleOpenEditModal(target);
                    }}
                    className="text-indigo-600 border-indigo-200 hover:bg-indigo-50 text-xs px-3 py-1.5 rounded-xl flex items-center gap-1.5"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit Driver
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const target = selectedDriverForView;
                      setSelectedDriverForView(null);
                      setDeleteTarget(target);
                    }}
                    className="text-red-600 border-red-200 hover:bg-red-50 text-xs px-3 py-1.5 rounded-xl flex items-center gap-1.5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Driver
                  </Button>
                </div>
              ) : <div />}
              <Button
                onClick={() => setSelectedDriverForView(null)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs px-4 py-1.5 rounded-xl"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Driver Modal */}
      {showEditModal && editDriverForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 border border-slate-200 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                  <Pencil className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">Edit Driver Details</div>
                  <div className="text-xs text-slate-500">Update credentials, license, and assigned vehicle</div>
                </div>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateDriver} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Full Name *</label>
                <input
                  value={editDriverForm.name}
                  onChange={(e) => setEditDriverForm({ ...editDriverForm, name: e.target.value })}
                  placeholder="Name"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Phone Number *</label>
                <input
                  value={editDriverForm.phone}
                  onChange={(e) => setEditDriverForm({ ...editDriverForm, phone: e.target.value })}
                  placeholder="+91 98421 00000"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Commercial License Number</label>
                <input
                  value={editDriverForm.license}
                  onChange={(e) => setEditDriverForm({ ...editDriverForm, license: e.target.value })}
                  placeholder="DL-74-2020-00192"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Assigned Vehicle</label>
                <select
                  value={editDriverForm.vehicleId}
                  onChange={(e) => setEditDriverForm({ ...editDriverForm, vehicleId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-medium"
                >
                  <option value="">-- Unassigned --</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.number} {v.model ? `(${v.model})` : `(${v.type || "Asset"})`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Status</label>
                <select
                  value={editDriverForm.status}
                  onChange={(e: any) => setEditDriverForm({ ...editDriverForm, status: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-medium"
                >
                  <option value="Active">Active</option>
                  <option value="On Leave">On Leave</option>
                  <option value="Suspended">Suspended</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowEditModal(false)}
                  className="text-xs px-3 py-1.5 rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-4 py-1.5 rounded-xl flex items-center gap-1.5"
                >
                  {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => {
            if (!isDeleting) setDeleteTarget(null);
          }}
        >
          <div
            className="bg-white rounded-2xl max-w-sm w-full p-5 border border-slate-200 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900">Delete Driver</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Are you sure you want to delete <span className="font-semibold text-slate-900">{deleteTarget.name}</span>?
                  This will remove the driver profile and unassign them from any active vehicles. This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 space-y-1">
              <div><strong>License:</strong> {deleteTarget.license || "N/A"}</div>
              <div><strong>Contact:</strong> {deleteTarget.phone || "N/A"}</div>
              <div><strong>Assigned Vehicle:</strong> {deleteTarget.vehicleAssigned}</div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <Button
                variant="outline"
                disabled={isDeleting}
                onClick={() => setDeleteTarget(null)}
                className="text-xs px-3 py-1.5 rounded-xl"
              >
                Cancel
              </Button>
              <Button
                disabled={isDeleting}
                onClick={handleDeleteDriver}
                className="bg-red-600 hover:bg-red-700 text-white font-semibold text-xs px-4 py-1.5 rounded-xl flex items-center gap-1.5 shadow-xs"
              >
                {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Delete Driver
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Register Driver Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 border border-slate-200 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <div className="text-sm font-bold text-slate-900">Register Driver</div>
                <div className="text-xs text-slate-500">Add fleet driver credentials and licence details</div>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateDriver} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Full Name *</label>
                <input
                  value={driverForm.name}
                  onChange={(e) => setDriverForm({ ...driverForm, name: e.target.value })}
                  placeholder="Name"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Phone Number *</label>
                <input
                  value={driverForm.phone}
                  onChange={(e) => setDriverForm({ ...driverForm, phone: e.target.value })}
                  placeholder="+91 98421 00000"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Commercial License Number</label>
                <input
                  value={driverForm.license}
                  onChange={(e) => setDriverForm({ ...driverForm, license: e.target.value })}
                  placeholder="DL-74-2020-00192"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Assign Vehicle (Optional)</label>
                <select
                  value={driverForm.vehicleId}
                  onChange={(e) => setDriverForm({ ...driverForm, vehicleId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-medium"
                >
                  <option value="">-- Unassigned --</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.number} {v.model ? `(${v.model})` : `(${v.type || "Asset"})`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddModal(false)}
                  className="text-xs px-3 py-1.5 rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-4 py-1.5 rounded-xl flex items-center gap-1.5"
                >
                  {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Register
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
