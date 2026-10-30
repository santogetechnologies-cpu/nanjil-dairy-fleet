import { useState, useEffect } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Card, Button, Badge } from "@/components/ui-kit";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  Settings,
  Route,
  History,
  Gauge,
  Fuel,
  UsersRound,
  Shield,
  Save,
  CheckCircle2,
  X,
  Radio,
  Sliders,
  Bell,
  Lock,
  Plus,
  Loader2,
  Trash2,
  Eye,
  EyeOff,
} from "lucide-react";

type SettingsTab = "route" | "trip" | "speed" | "fuel" | "fleet_users";

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [activeTab, setActiveTab] = useState<SettingsTab>("route");
  const [savedSuccess, setSavedSuccess] = useState(false);

  // 1. Route Planner Settings
  const [routeSettings, setRouteSettings] = useState({
    defaultDepartureTime: "05:30",
    defaultServiceDurationMins: 5,
    deviationThresholdMeters: 250,
    routeSpeedLimitKmh: 60,
    defaultReturnMode: "same_path",
    alertOnMissedStops: true,
    alertOnDelayMinutes: 20,
  });

  // 2. Trip History Settings
  const [tripSettings, setTripSettings] = useState({
    retentionDays: 90,
    defaultPlaybackSpeed: 2,
    idleDetectionThresholdMins: 3,
    stopDetectionThresholdMins: 3,
    gpsGapToleranceSeconds: 900, // 15 mins
    distanceAlgorithm: "haversine_geodesic",
  });

  // 3. Speeding & Driving Behavior Settings
  const [speedSettings, setSpeedSettings] = useState({
    speedThresholdKmh: 60,
    minEventDurationSeconds: 8,
    warningDeltaKmh: 10,
    criticalDeltaKmh: 20,
    notifyManagerOnCritical: true,
    harshBrakingThresholdG: 0.4,
    excessiveIdleMins: 20,
  });

  // 4. Fuel Management Settings
  const [fuelSettings, setFuelSettings] = useState({
    currencySymbol: "₹",
    targetMileageKmpl: 4.5,
    monthlyFuelLimit: 250000,
    requireReceiptCode: true,
    requireManagerApprovalOverAmount: 5000,
    calculationMethod: "full_tank_to_full_tank",
  });

  // 5. System & Users Settings (Admin)
  const [systemUsers, setSystemUsers] = useState<any[]>([]);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    name: "",
    email: "",
    role: "driver" as "admin" | "manager" | "driver",
    password: "",
  });
  const [driverList, setDriverList] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isSubmittingUser, setIsSubmittingUser] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [userActionMsg, setUserActionMsg] = useState<string | null>(null);

  const showUserToast = (msg: string) => {
    setUserActionMsg(msg);
    setTimeout(() => setUserActionMsg(null), 3500);
  };

  async function loadDriverList() {
    try {
      const { data } = await supabase
        .from("drivers")
        .select("id, name, phone")
        .order("name");
      if (data) {
        const map = new Map<string, { id: string; name: string; phone: string }>();
        for (const d of data) {
          if (d.name && !map.has(d.name.trim().toLowerCase())) {
            map.set(d.name.trim().toLowerCase(), {
              id: d.id,
              name: d.name.trim(),
              phone: d.phone ? d.phone.trim() : "",
            });
          }
        }
        setDriverList(Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name)));
      }
    } catch (e) {
      console.warn("Failed to load driver directory list:", e);
    }
  }

  // Load saved preferences from localStorage / database
  useEffect(() => {
    const saved = localStorage.getItem("nanjil_independent_settings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.route) setRouteSettings(parsed.route);
        if (parsed.trip) setTripSettings(parsed.trip);
        if (parsed.speed) setSpeedSettings(parsed.speed);
        if (parsed.fuel) setFuelSettings(parsed.fuel);
      } catch (e) {
        // parse error ignored
      }
    }

    if (isAdmin) {
      loadProfiles();
      loadDriverList();
    }
  }, [isAdmin]);

  async function loadProfiles() {
    const { data } = await supabase.from("profiles").select("id, name, email, role, status").order("created_at");
    if (data) {
      // Map legacy roles to clean user-facing roles
      setSystemUsers(
        data.map((p) => ({
          ...p,
          role: p.role === "operations" ? "manager" : p.role,
        }))
      );
    }
  }

  function handleSaveSettings() {
    const bundle = {
      route: routeSettings,
      trip: tripSettings,
      speed: speedSettings,
      fuel: fuelSettings,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem("nanjil_independent_settings", JSON.stringify(bundle));
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newUserForm.name || !newUserForm.email || !newUserForm.password) return;
    setIsSubmittingUser(true);
    try {
      const cleanEmail = newUserForm.email.toLowerCase().trim();
      let createdAuthUserId: string | null = null;

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: newUserForm.password,
        options: {
          data: {
            name: newUserForm.name,
            role: newUserForm.role,
          },
        },
      });

      if (error) {
        // If email already exists in auth.users as an orphan, clean and retry
        if (error.message.toLowerCase().includes("already registered") || (error as any).status === 422) {
          try {
            await supabase.rpc("admin_delete_user_by_email", { target_email: cleanEmail });
          } catch {
            // Ignore
          }
          const retry = await supabase.auth.signUp({
            email: cleanEmail,
            password: newUserForm.password,
            options: {
              data: {
                name: newUserForm.name,
                role: newUserForm.role,
              },
            },
          });
          if (retry.error) throw retry.error;
          createdAuthUserId = retry.data?.user?.id || null;
        } else {
          throw error;
        }
      } else {
        createdAuthUserId = data?.user?.id || null;
      }

      if (createdAuthUserId) {
        await supabase.from("profiles").upsert({
          id: createdAuthUserId,
          name: newUserForm.name,
          email: cleanEmail,
          role: newUserForm.role,
          status: "Active",
          created_at: new Date().toISOString(),
        });

        // If Driver role, link profile_id in drivers table
        if (newUserForm.role === "driver") {
          if (selectedDriverId) {
            await supabase
              .from("drivers")
              .update({ profile_id: createdAuthUserId })
              .eq("id", selectedDriverId);
          } else if (newUserForm.name.trim()) {
            await supabase
              .from("drivers")
              .update({ profile_id: createdAuthUserId })
              .ilike("name", newUserForm.name.trim());
          }
        }
      }

      setShowAddUserModal(false);
      setShowPassword(false);
      setNewUserForm({ name: "", email: "", role: "driver", password: "" });
      setSelectedDriverId("");
      loadProfiles();
      loadDriverList();
      showUserToast(`User "${newUserForm.name}" registered successfully!`);
    } catch (err: any) {
      alert("Failed to create user: " + err.message);
    } finally {
      setIsSubmittingUser(false);
    }
  }

  async function handleDeleteUser(targetUser: any) {
    if (targetUser.id === user?.id) {
      alert("You cannot delete your own administrator account.");
      return;
    }

    const userName = targetUser.name || targetUser.email || "this user";
    if (
      !confirm(
        `Are you sure you want to permanently delete user "${userName}"? This will revoke their access and remove their credentials.`
      )
    ) {
      return;
    }

    setDeletingUserId(targetUser.id);

    try {
      // 1. If it's a driver, clean up driver record and synthetic email
      if (targetUser.role === "driver") {
        await supabase.from("drivers").delete().eq("profile_id", targetUser.id);
        if (targetUser.email && targetUser.email.endsWith("@nanjilmilk.com")) {
          try {
            await supabase.rpc("admin_delete_user_by_email", { target_email: targetUser.email });
          } catch {
            // Ignore
          }
        }
      }

      // 2. Try backend admin_delete_user RPC
      const { error: rpcErr } = await supabase.rpc("admin_delete_user", {
        target_user_id: targetUser.id,
      });

      if (rpcErr) {
        console.warn("[DeleteUser] RPC warning, fallback to table cascade:", rpcErr);
        await supabase.from("drivers").delete().eq("profile_id", targetUser.id);
        const { error: profErr } = await supabase.from("profiles").delete().eq("id", targetUser.id);
        if (profErr) throw profErr;
        if (targetUser.email) {
          try {
            await supabase.rpc("admin_delete_user_by_email", { target_email: targetUser.email });
          } catch {
            // Ignore
          }
        }
      }

      // 3. Optimistic local update
      setSystemUsers((prev) => prev.filter((u) => u.id !== targetUser.id));
      showUserToast(`User "${userName}" deleted successfully.`);
    } catch (err: any) {
      console.error("Failed to delete user:", err);
      alert("Failed to delete user: " + (err.message || "An unexpected error occurred."));
      loadProfiles();
    } finally {
      setDeletingUserId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings & System Configuration"
        subtitle="Independent Operational Policies · Fleet Parameters · User Access Controls"
        actions={
          <Button
            onClick={handleSaveSettings}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs px-4 py-2 rounded-xl flex items-center gap-1.5 shadow-xs"
          >
            <Save className="h-3.5 w-3.5" />
            Save Module Settings
          </Button>
        }
      />

      {savedSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>Settings saved and applied successfully across modules!</span>
          </div>
        </div>
      )}

      {/* Floating Action Feedback Notification */}
      {userActionMsg && (
        <div className="fixed bottom-5 right-5 z-50 bg-emerald-700 text-white px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 text-sm font-medium animate-in fade-in slide-in-from-bottom-3 duration-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{userActionMsg}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab("route")}
          className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
            activeTab === "route"
              ? "bg-indigo-50 border border-indigo-200 text-indigo-700"
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          <Route className="h-3.5 w-3.5" />
          Route Planner
        </button>

        <button
          onClick={() => setActiveTab("trip")}
          className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
            activeTab === "trip"
              ? "bg-indigo-50 border border-indigo-200 text-indigo-700"
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          <History className="h-3.5 w-3.5" />
          Trip History
        </button>

        <button
          onClick={() => setActiveTab("speed")}
          className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
            activeTab === "speed"
              ? "bg-indigo-50 border border-indigo-200 text-indigo-700"
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          <Gauge className="h-3.5 w-3.5" />
          Speeding & Safety
        </button>

        <button
          onClick={() => setActiveTab("fuel")}
          className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
            activeTab === "fuel"
              ? "bg-indigo-50 border border-indigo-200 text-indigo-700"
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          <Fuel className="h-3.5 w-3.5" />
          Fuel Management
        </button>

        {isAdmin && (
          <button
            onClick={() => setActiveTab("fleet_users")}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
              activeTab === "fleet_users"
                ? "bg-indigo-50 border border-indigo-200 text-indigo-700"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <UsersRound className="h-3.5 w-3.5" />
            User Roles & Access (Admin)
          </button>
        )}
      </div>

      {/* ── TAB 1: ROUTE PLANNER SETTINGS ──────────────────────── */}
      {activeTab === "route" && (
        <Card className="border border-slate-200/80 p-5 shadow-xs max-w-2xl space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <div className="text-sm font-bold text-slate-900">Route Planner Configuration</div>
            <div className="text-xs text-slate-500">Parameters applied when constructing multi-stop dairy routes</div>
          </div>

          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Default Departure Time</label>
                <input
                  type="time"
                  value={routeSettings.defaultDepartureTime}
                  onChange={(e) => setRouteSettings({ ...routeSettings, defaultDepartureTime: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Default Stop Waiting Time (mins)</label>
                <input
                  type="number"
                  value={routeSettings.defaultServiceDurationMins}
                  onChange={(e) =>
                    setRouteSettings({
                      ...routeSettings,
                      defaultServiceDurationMins: parseInt(e.target.value, 10) || 5,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200"
                  min={1}
                  max={60}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Route Deviation Threshold (meters)</label>
                <input
                  type="number"
                  value={routeSettings.deviationThresholdMeters}
                  onChange={(e) =>
                    setRouteSettings({
                      ...routeSettings,
                      deviationThresholdMeters: parseInt(e.target.value, 10) || 250,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200"
                  step={50}
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Alert triggers if vehicle strays beyond this distance from road path
                </span>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Route Speed Policy (km/h)</label>
                <input
                  type="number"
                  value={routeSettings.routeSpeedLimitKmh}
                  onChange={(e) =>
                    setRouteSettings({
                      ...routeSettings,
                      routeSpeedLimitKmh: parseInt(e.target.value, 10) || 60,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200"
                />
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── TAB 2: TRIP HISTORY SETTINGS ───────────────────────── */}
      {activeTab === "trip" && (
        <Card className="border border-slate-200/80 p-5 shadow-xs max-w-2xl space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <div className="text-sm font-bold text-slate-900">Trip History & Playback Preferences</div>
            <div className="text-xs text-slate-500">Historical telemetry processing and playback preferences</div>
          </div>

          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">GPS History Retention (Days)</label>
                <input
                  type="number"
                  value={tripSettings.retentionDays}
                  onChange={(e) =>
                    setTripSettings({ ...tripSettings, retentionDays: parseInt(e.target.value, 10) || 90 })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">GPS Signal Gap Tolerance (Seconds)</label>
                <input
                  type="number"
                  value={tripSettings.gpsGapToleranceSeconds}
                  onChange={(e) =>
                    setTripSettings({
                      ...tripSettings,
                      gpsGapToleranceSeconds: parseInt(e.target.value, 10) || 900,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Displays visible signal gap if gap exceeds this window
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Stop Detection Threshold (Mins)</label>
                <input
                  type="number"
                  value={tripSettings.stopDetectionThresholdMins}
                  onChange={(e) =>
                    setTripSettings({
                      ...tripSettings,
                      stopDetectionThresholdMins: parseInt(e.target.value, 10) || 3,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Default Playback Speed</label>
                <select
                  value={tripSettings.defaultPlaybackSpeed}
                  onChange={(e) =>
                    setTripSettings({
                      ...tripSettings,
                      defaultPlaybackSpeed: parseInt(e.target.value, 10) || 2,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white"
                >
                  <option value={1}>1x (Real-time pace)</option>
                  <option value={2}>2x (Standard speed)</option>
                  <option value={5}>5x (Fast scrub)</option>
                  <option value={10}>10x (Rapid playback)</option>
                </select>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── TAB 3: SPEEDING & DRIVING BEHAVIOR SETTINGS ─────────── */}
      {activeTab === "speed" && (
        <Card className="border border-slate-200/80 p-5 shadow-xs max-w-2xl space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <div className="text-sm font-bold text-slate-900">Speeding & Safety Policy</div>
            <div className="text-xs text-slate-500">Configurable limits and driving behavior rules</div>
          </div>

          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Baseline Speed Limit (km/h)</label>
                <input
                  type="number"
                  value={speedSettings.speedThresholdKmh}
                  onChange={(e) =>
                    setSpeedSettings({
                      ...speedSettings,
                      speedThresholdKmh: parseInt(e.target.value, 10) || 60,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 font-bold"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">Default threshold is 60 km/h</span>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Min Event Duration (Seconds)</label>
                <input
                  type="number"
                  value={speedSettings.minEventDurationSeconds}
                  onChange={(e) =>
                    setSpeedSettings({
                      ...speedSettings,
                      minEventDurationSeconds: parseInt(e.target.value, 10) || 8,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">Rejects isolated GPS sensor noise</span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── TAB 4: FUEL MANAGEMENT SETTINGS ────────────────────── */}
      {activeTab === "fuel" && (
        <Card className="border border-slate-200/80 p-5 shadow-xs max-w-2xl space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <div className="text-sm font-bold text-slate-900">Fuel Management & Cost Settings</div>
            <div className="text-xs text-slate-500">Independent fuel calculation and approval rules</div>
          </div>

          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Currency Symbol</label>
                <select
                  value={fuelSettings.currencySymbol}
                  onChange={(e) => setFuelSettings({ ...fuelSettings, currencySymbol: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-bold"
                >
                  <option value="₹">₹ INR (Indian Rupee)</option>
                  <option value="$">$ USD</option>
                  <option value="€">€ EUR</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Expected Fleet Mileage (km/L)</label>
                <input
                  type="number"
                  step="0.1"
                  value={fuelSettings.targetMileageKmpl}
                  onChange={(e) =>
                    setFuelSettings({
                      ...fuelSettings,
                      targetMileageKmpl: parseFloat(e.target.value) || 4.5,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 font-bold"
                />
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── TAB 5: FLEET USERS & ROLES (ADMIN ONLY) ─────────────── */}
      {isAdmin && activeTab === "fleet_users" && (
        <Card className="border border-slate-200/80 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <div className="text-base font-bold text-slate-900">User Roles & Access Permissions</div>
              <div className="text-xs text-slate-500">
                Managed strictly into 3 user-facing roles: Administrator, Fleet Manager, and Driver
              </div>
            </div>

            <Button
              onClick={() => {
                loadDriverList();
                setSelectedDriverId("");
                setShowPassword(false);
                setNewUserForm({ name: "", email: "", role: "driver", password: "" });
                setShowAddUserModal(true);
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 shadow-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Add User
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                  <th className="py-2.5 px-3">Name</th>
                  <th className="py-2.5 px-3">Email</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Access Scope</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {systemUsers.map((u) => {
                  const isSelf = u.id === user?.id;
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3 font-bold text-slate-900">{u.name}</td>
                      <td className="py-3 px-3 text-slate-600">{u.email}</td>
                      <td className="py-3 px-3">
                        <Badge
                          variant="outline"
                          className={
                            u.role === "admin"
                              ? "bg-purple-50 text-purple-700 border-purple-200 font-bold"
                              : u.role === "manager"
                              ? "bg-indigo-50 text-indigo-700 border-indigo-200 font-semibold"
                              : "bg-slate-100 text-slate-700"
                          }
                        >
                          {u.role === "admin" ? "Administrator" : u.role === "manager" ? "Fleet Manager" : "Driver"}
                        </Badge>
                      </td>
                      <td className="py-3 px-3">
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                          {u.status || "Active"}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 text-slate-500 text-[11px]">
                        {u.role === "admin"
                          ? "Full System Access"
                          : u.role === "manager"
                          ? "Fleet Operations & Reports"
                          : "Driver Trip Portal"}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {isSelf ? (
                          <span className="text-[10px] font-medium text-slate-400 italic pr-2">Current User</span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDeleteUser(u)}
                            disabled={deletingUserId === u.id}
                            className="h-7 px-2.5 text-xs text-rose-600 border-rose-200 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 cursor-pointer transition-colors shrink-0"
                            title={`Delete ${u.name || u.email}`}
                          >
                            {deletingUserId === u.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5 mr-1" />
                            )}
                            Delete
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 border border-slate-200 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <div className="text-sm font-bold text-slate-900">Add Staff Account</div>
                <div className="text-xs text-slate-500">Only Admin, Manager, and Driver roles permitted</div>
              </div>
              <button
                onClick={() => {
                  setShowAddUserModal(false);
                  setShowPassword(false);
                }}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3.5 text-xs">
              {/* User Role */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1">User Role *</label>
                <select
                  value={newUserForm.role}
                  onChange={(e) => {
                    const r = e.target.value as any;
                    setSelectedDriverId("");
                    setNewUserForm({
                      ...newUserForm,
                      role: r,
                      name: "",
                      email: "",
                    });
                    if (r === "driver") {
                      loadDriverList();
                    }
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
                >
                  <option value="driver">Driver</option>
                  <option value="manager">Fleet Manager</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>

              {/* Full Name / Driver Name Selection */}
              {newUserForm.role === "driver" ? (
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Select Driver Name *
                  </label>
                  <select
                    value={selectedDriverId}
                    onChange={(e) => {
                      const dId = e.target.value;
                      setSelectedDriverId(dId);
                      if (!dId) {
                        setNewUserForm((prev) => ({ ...prev, name: "", email: "" }));
                      } else {
                        const found = driverList.find((d) => d.id === dId);
                        if (found) {
                          const cleanSlug = found.name.toLowerCase().replace(/[^a-z0-9]/g, "");
                          const emailVal = `${cleanSlug}@nanjilmilk.com`;
                          setNewUserForm((prev) => ({
                            ...prev,
                            name: found.name,
                            email: emailVal,
                          }));
                        }
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
                    required
                  >
                    <option value="">-- Select Driver Name ({driverList.length} registered) --</option>
                    {driverList.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} {d.phone ? `· ${d.phone}` : ""}
                      </option>
                    ))}
                  </select>
                  {selectedDriverId && (
                    <p className="text-[10px] text-slate-400 mt-1">
                      Account credentials will be linked to this registered driver profile.
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Full Name *</label>
                  <input
                    type="text"
                    value={newUserForm.name}
                    onChange={(e) => setNewUserForm({ ...newUserForm, name: e.target.value })}
                    placeholder="e.g. Rajesh Kumar"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    required
                  />
                </div>
              )}

              {/* Email Address */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Email Address *</label>
                <input
                  type="email"
                  value={newUserForm.email}
                  onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                  placeholder={newUserForm.role === "driver" ? "driver@nanjilmilk.com" : "name@example.com"}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  required
                />
              </div>

              {/* Initial Password */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700 block">Initial Password *</label>
                  {newUserForm.password.length > 0 && (
                    <span
                      className={`text-[11px] font-medium flex items-center gap-1 ${
                        newUserForm.password.length >= 6 ? "text-emerald-600" : "text-amber-600"
                      }`}
                    >
                      {newUserForm.password.length >= 6 ? (
                        <>
                          <CheckCircle2 className="h-3 w-3" />
                          Meets requirement ({newUserForm.password.length} chars)
                        </>
                      ) : (
                        `At least 6 chars required (${newUserForm.password.length}/6)`
                      )}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={newUserForm.password}
                    onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                    placeholder="Minimum 6 characters"
                    className={`w-full pl-3 pr-10 py-2 rounded-xl border text-slate-800 transition-colors focus:outline-none focus:ring-2 ${
                      newUserForm.password.length > 0 && newUserForm.password.length < 6
                        ? "border-amber-300 focus:ring-amber-500/20"
                        : newUserForm.password.length >= 6
                        ? "border-emerald-300 focus:ring-emerald-500/20"
                        : "border-slate-200 focus:ring-indigo-500/20"
                    }`}
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 focus:outline-none transition-colors"
                    title={showPassword ? "Hide password" : "Show password"}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-slate-600" />
                    ) : (
                      <Eye className="h-4 w-4 text-slate-400" />
                    )}
                  </button>
                </div>
                {newUserForm.password.length === 0 && (
                  <p className="text-[10px] text-slate-400 mt-1">
                    Password must be at least 6 characters.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  onClick={() => {
                    setShowAddUserModal(false);
                    setShowPassword(false);
                  }}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs px-3 py-1.5 rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmittingUser}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-4 py-1.5 rounded-xl flex items-center gap-1.5"
                >
                  {isSubmittingUser ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Create Account
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
