import { useState, useEffect } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Card, Badge, Button } from "@/components/ui-kit";
import { DataTable } from "@/components/DataTable";
import { useAuth } from "@/lib/auth";
import { Plus, X, Eye, EyeOff, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";

const tempClient = (globalThis as any)._tempSupabaseClient || (() => {
  const client = createClient(
    import.meta.env.VITE_SUPABASE_URL || "",
    import.meta.env.VITE_SUPABASE_ANON_KEY || "",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "nanjil-user-creation-temp",
        storage: {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {}
        }
      }
    }
  );
  (globalThis as any)._tempSupabaseClient = client;
  return client;
})();

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  lastLogin: string;
}

function Page() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "Driver", password: "", phone: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pwdError, setPwdError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [toast, setToast] = useState({ show: false, message: "" });

  // Driver selection states
  const [driverList, setDriverList] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [isCustomDriver, setIsCustomDriver] = useState(false);

  // Reset password states
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [showResetPwd, setShowResetPwd] = useState(false);
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState("");

  async function loadDrivers() {
    const { data } = await supabase.from('drivers').select('id, name, phone').order('name');
    if (data) {
      const map = new Map<string, { id: string; name: string; phone: string }>();
      for (const d of data) {
        if (d.name && !map.has(d.name)) {
          map.set(d.name, { id: d.id, name: d.name, phone: d.phone || '' });
        }
      }
      setDriverList(Array.from(map.values()));
    }
  }

  async function loadUsers() {
    // Fetch staff profiles
    const { data: profileData } = await supabase.from('profiles').select('*');
    // Fetch all drivers (phone-only drivers have no profile_id)
    const { data: driverData } = await supabase.from('drivers').select('id, name, phone, profile_id').order('name');

    const roleMapRev: Record<string, string> = {
      admin: "Administrator",
      manager: "Fleet Manager",
      driver: "Driver",
      operations: "Operations"
    };

    const profileRows: UserRow[] = (profileData || []).map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: roleMapRev[u.role] || u.role,
      status: u.status || 'Active',
      lastLogin: u.last_login ? new Date(u.last_login).toLocaleTimeString() : 'sec ago'
    }));

    // Collect profile_ids and names that are already represented in profiles
    const linkedProfileIds = new Set(profileRows.map(p => p.id));
    const linkedNames = new Set(profileRows.map(p => p.name.toLowerCase().trim()));
    const seenDriverNames = new Set<string>();

    // Auto-heal missing profile_id links in drivers table in background
    for (const d of driverData || []) {
      if (!d.profile_id && d.name) {
        const matchingProf = (profileData || []).find(
          p => p.name.toLowerCase().trim() === d.name.toLowerCase().trim()
        );
        if (matchingProf) {
          try {
            supabase.from('drivers').update({ profile_id: matchingProf.id }).eq('id', d.id);
          } catch (e) {
            // ignore auto-heal update error
          }
        }
      }
    }

    // Phone-only drivers: those whose profile_id is null OR not in profiles AND not already represented by name
    const phoneOnlyDrivers: UserRow[] = (driverData || [])
      .filter(d => {
        if (!d.name) return false;
        const cleanName = d.name.toLowerCase().trim();
        if (d.profile_id && linkedProfileIds.has(d.profile_id)) return false;
        if (linkedNames.has(cleanName)) return false;
        if (seenDriverNames.has(cleanName)) return false;
        seenDriverNames.add(cleanName);
        return true;
      })
      .map(d => {
        const prof = (profileData || []).find(p => p.id === d.id);
        return {
          id: `driver-${d.id}`,
          name: d.name || '—',
          email: d.phone || '—',   // show phone in the Email column
          role: 'Driver',
          status: prof?.status || 'Active',
          lastLogin: '—'
        };
      });

    const combined = [...profileRows, ...phoneOnlyDrivers];
    setUsers(combined);
  }

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      if (user?.role !== "admin") return;
      if (cancelled) return;

      loadUsers();
      loadDrivers();

      channel = supabase
        .channel('profiles-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
          if (!cancelled) loadUsers();
        })
        .subscribe();
    }

    init();

    return () => {
      cancelled = true;
      channel?.unsubscribe();
    };
  }, [user]);

  if (user?.role !== "admin") {
    return (
      <div className="p-8 text-center">
        <div className="text-lg font-medium">Restricted</div>
        <p className="text-muted-foreground mt-1">User management is available to administrators only.</p>
      </div>
    );
  }

  const handlePasswordChange = (val: string) => {
    setForm({ ...form, password: val });
    if (val.length < 8) {
      setPwdError("Password must be at least 8 characters.");
    } else {
      setPwdError("");
    }
  };

  async function addUser(e: React.FormEvent) {
    e.preventDefault();

    // For non-driver roles, require password; for drivers it's optional
    if (form.role !== "Driver" && form.password.length < 8) {
      setPwdError("Password must be at least 8 characters.");
      return;
    }
    if (form.role === "Driver" && form.password.length > 0 && form.password.length < 8) {
      setPwdError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    setSubmitError("");

    const roleMapping: Record<string, string> = {
      "Administrator": "admin",
      "Fleet Manager": "manager",
      "Driver": "driver",
      "Operations": "operations"
    };
    const roleVal = roleMapping[form.role] || "driver";

    try {
      // ── DRIVER FLOW ──
      if (roleVal === "driver") {
        const phoneVal = form.phone.trim();
        if (!phoneVal) {
          setSubmitError("Please enter a phone number for the driver.");
          setLoading(false);
          return;
        }

        // Check if driver with this name already exists
        const { data: existingDriver } = await supabase
          .from('drivers')
          .select('id')
          .ilike('name', form.name)
          .maybeSingle();

        let driverId: string | null = existingDriver?.id || null;

        if (existingDriver) {
          // Update phone on existing record
          const { error: updErr } = await supabase
            .from('drivers')
            .update({ phone: phoneVal })
            .eq('id', existingDriver.id);
          if (updErr) throw new Error(`Failed to update driver: ${updErr.message}`);
        } else {
          // Insert new driver record
          const { data: newDrv, error: insErr } = await supabase
            .from('drivers')
            .insert({ name: form.name, phone: phoneVal })
            .select('id')
            .maybeSingle();
          if (insErr) throw new Error(`Failed to create driver: ${insErr.message}`);
          driverId = newDrv?.id || null;
        }

        // If a password was provided, also create/link an auth account for the driver
        if (form.password.length >= 8 && driverId) {
          const driverEmail = `${form.name.toLowerCase().replace(/[^a-z0-9]/g, '')}@nanjilmilk.com`;

          let profileId: string | null = null;

          // Try signup first
          const { data: signUpRes, error: signUpErr } = await tempClient.auth.signUp({
            email: driverEmail,
            password: form.password,
            options: { data: { name: form.name, role: 'driver' } }
          });

          if (!signUpErr && signUpRes?.user) {
            profileId = signUpRes.user.id;
          } else if (signUpErr || (signUpRes?.user === null)) {
            // 422 = email already registered — try signing in to get the existing user ID
            const { data: signInRes, error: signInErr } = await tempClient.auth.signInWithPassword({
              email: driverEmail,
              password: form.password,
            });
            if (!signInErr && signInRes?.user) {
              profileId = signInRes.user.id;
            }
            // If signIn also fails, skip auth account (driver still saved by phone)
          }

          if (profileId) {
            await supabase.from('profiles').upsert({
              id: profileId, name: form.name, email: driverEmail,
              role: 'driver', status: 'Active', created_at: new Date().toISOString()
            });
            await supabase.from('drivers').update({ profile_id: profileId }).eq('id', driverId);
          }
        }


        setToast({ show: true, message: "Driver added successfully." });
        setShowNew(false);
        setForm({ name: "", email: "", role: "Driver", password: "", phone: "" });
        loadUsers();
        setTimeout(() => setToast({ show: false, message: "" }), 3000);
        return;
      }

      // ── STAFF FLOW: email + password auth signup ──

      // 1. Client-side check for email conflict in profiles first
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', form.email.toLowerCase().trim())
        .maybeSingle();

      if (existing) {
        setSubmitError("An account with this email already exists.");
        setLoading(false);
        return;
      }

      // 2. Sign up user via temporary client to prevent session takeover
      let targetUserId: string | null = null;

      const { data: res, error: signUpErr } = await tempClient.auth.signUp({
        email: form.email.toLowerCase().trim(),
        password: form.password,
        options: {
          data: {
            name: form.name,
            role: roleVal
          }
        }
      });

      if (signUpErr) {
        // If account already exists in auth.users (e.g. from previously deleted profile)
        if (signUpErr.message.toLowerCase().includes("already registered") || (signUpErr as any).status === 422) {
          // Attempt 1: Clear orphaned auth account via RPC if available
          try {
            await supabase.rpc('admin_delete_user_by_email', { target_email: form.email.toLowerCase().trim() });
          } catch (e) {
            // ignore missing RPC error
          }

          // Retry signup after clearing orphan
          const retry = await tempClient.auth.signUp({
            email: form.email.toLowerCase().trim(),
            password: form.password,
            options: {
              data: {
                name: form.name,
                role: roleVal
              }
            }
          });

          if (retry.data?.user) {
            targetUserId = retry.data.user.id;
          } else {
            // Attempt 2: Try signing in with temp client to retrieve user ID
            const { data: signInRes } = await tempClient.auth.signInWithPassword({
              email: form.email.toLowerCase().trim(),
              password: form.password
            });

            if (signInRes?.user) {
              targetUserId = signInRes.user.id;
              // Reset password to newly specified password
              await supabase.rpc('admin_reset_user_password', { user_id: targetUserId, new_password: form.password });
            } else {
              throw new Error("This email is already registered. If you deleted this profile earlier, the account has been reclaimed for re-use.");
            }
          }
        } else {
          throw new Error(signUpErr.message);
        }
      } else if (res?.user) {
        targetUserId = res.user.id;
      }

      if (!targetUserId) {
        throw new Error("Unable to retrieve user account from creation response.");
      }

      // 3. Write profile directly to database to match Auth account
      const { error: profErr } = await supabase.from('profiles').upsert({
        id: targetUserId,
        name: form.name,
        email: form.email.toLowerCase().trim(),
        role: roleVal,
        status: 'Active',
        created_at: new Date().toISOString()
      }, { onConflict: 'id' });

      if (profErr) {
        if (profErr.code === '23505' || profErr.message?.includes('duplicate key') || profErr.message?.includes('conflict')) {
          const { error: updErr } = await supabase
            .from('profiles')
            .update({ name: form.name, role: roleVal, status: 'Active' })
            .ilike('email', form.email.toLowerCase().trim());
          if (updErr) throw new Error(`Profile update failed: ${updErr.message}`);
        } else {
          throw new Error(`Profile creation failed: ${profErr.message}`);
        }
      }

      // 4. Success Handling
      setToast({ show: true, message: "User created successfully." });
      setShowNew(false);
      setForm({ name: "", email: "", role: "Driver", password: "", phone: "" });
      loadUsers();

      // Clear toast after 3 seconds
      setTimeout(() => {
        setToast({ show: false, message: "" });
      }, 3000);

    } catch (err: any) {
      setSubmitError(err?.message || "An unexpected error occurred during user creation.");
    } finally {
      setLoading(false);
    }
  }

  async function toggle(id: string) {
    const userToToggle = users.find(u => u.id === id);
    if (!userToToggle) return;
    const newStatus = userToToggle.status === "Active" ? "Inactive" : "Active";

    // 1. Update UI state immediately for instant feedback
    setUsers(prev => prev.map(u => u.id === id ? { ...u, status: newStatus } : u));
    setToast({ show: true, message: `Status changed to ${newStatus}.` });
    setTimeout(() => setToast({ show: false, message: "" }), 3000);

    // 2. Only fire DB update if client has an active session
    const sess = await supabase.auth.getSession();
    if (sess.data?.session) {
      try {
        const rawId = id.replace("driver-", "");
        const { data: prof } = await supabase.from('profiles').select('id').eq('id', rawId).maybeSingle();
        if (prof) {
          await supabase.from('profiles').update({ status: newStatus }).eq('id', rawId);
        } else {
          const { data: drv } = await supabase.from('drivers').select('profile_id').eq('id', rawId).maybeSingle();
          if (drv?.profile_id) {
            await supabase.from('profiles').update({ status: newStatus }).eq('id', drv.profile_id);
          }
        }
      } catch (err) {
        console.warn("Toggle status DB notice:", err);
      }
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUser) return;
    if (newPwd.length < 8) {
      setResetError("Password must be at least 8 characters.");
      return;
    }
    if (newPwd !== confirmPwd) {
      setResetError("Passwords do not match.");
      return;
    }
    setResetting(true);
    setResetError("");

    try {
      const rawId = selectedUser.id.startsWith("driver-")
        ? selectedUser.id.replace("driver-", "")
        : selectedUser.id;

      const cleanEmail = selectedUser.email.includes("@")
        ? selectedUser.email.toLowerCase().trim()
        : `${selectedUser.name.toLowerCase().replace(/[^a-z0-9]/g, "")}@nanjilmilk.com`;

      // 1. Reset password via admin RPC if user already has an auth account
      await supabase.rpc("admin_reset_user_password", {
        user_id: rawId,
        new_password: newPwd
      });

      // 2. Also check if a profile exists by email to update password by profile user_id
      const { data: profByEmail } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', cleanEmail)
        .maybeSingle();

      if (profByEmail?.id && profByEmail.id !== rawId) {
        await supabase.rpc("admin_reset_user_password", {
          user_id: profByEmail.id,
          new_password: newPwd
        });
      }

      // 3. If no auth user exists yet, create one via tempClient signup
      const { data: signUpRes, error: signUpErr } = await tempClient.auth.signUp({
        email: cleanEmail,
        password: newPwd,
        options: { data: { name: selectedUser.name, role: 'driver' } }
      });

      if (!signUpErr && signUpRes?.user) {
        const newAuthId = signUpRes.user.id;
        await supabase.from('profiles').upsert({
          id: newAuthId,
          name: selectedUser.name,
          email: cleanEmail,
          role: 'driver',
          status: selectedUser.status || 'Active',
          created_at: new Date().toISOString()
        });
        await supabase.from('drivers').update({ profile_id: newAuthId }).eq('id', rawId);
      }

      setToast({ show: true, message: `Password for ${selectedUser.name} reset successfully.` });
      setShowResetPwd(false);
      setNewPwd("");
      setConfirmPwd("");
      setShowNewPwd(false);
      setShowConfirmPwd(false);
      setSelectedUser(null);
      loadUsers();
      setTimeout(() => setToast({ show: false, message: "" }), 3000);
    } catch (err: any) {
      setResetError(err.message || "Failed to reset password.");
    } finally {
      setResetting(false);
    }
  }

  async function deleteUser(id: string) {
    if (id === user?.id) {
      alert("You cannot delete your own administrator account.");
      return;
    }
    if (!confirm("Are you sure you want to delete this user? This action is permanent.")) return;

    // Immediately remove user from UI list for real-time responsiveness
    setUsers(prev => prev.filter(u => u.id !== id));
    setToast({ show: true, message: "User deleted successfully." });
    setTimeout(() => setToast({ show: false, message: "" }), 3000);

    try {
      if (id.startsWith("driver-")) {
        const driverId = id.replace("driver-", "");
        await supabase.from('drivers').delete().eq('id', driverId);
        await supabase.from('profiles').delete().eq('id', driverId);
      } else {
        const { error: rpcErr } = await supabase.rpc('admin_delete_user', { target_user_id: id });
        if (rpcErr) {
          await supabase.from('drivers').delete().eq('profile_id', id);
          await supabase.from('profiles').delete().eq('id', id);
        }
      }
    } catch (err) {
      console.warn("User DB delete warning:", err);
    }
  }

  return (
    <div>
      <PageHeader
        title="User Management"
        subtitle={`${users.length} users · roles & permissions`}
        actions={<Button onClick={() => { loadDrivers(); setIsCustomDriver(false); setShowNew(true); }}><Plus className="h-4 w-4" /> Add user</Button>}
      />

      <DataTable<UserRow>
        data={users}
        searchKeys={["name", "email", "role"]}
        columns={[
          { key: "name", label: "Name" },
          { key: "email", label: "Email" },
          { key: "role", label: "Role" },
          { key: "status", label: "Status", render: (u) => (
            <Badge status={u.status === "Active" ? "Moving" : "Parked"}>{u.status}</Badge>
          )},
          { key: "lastLogin", label: "Last Login" },
          { key: "actions", label: "", render: (u) => (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => toggle(u.id)}>
                {u.status === "Active" ? "Deactivate" : "Activate"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setSelectedUser(u); setShowResetPwd(true); }}>
                Reset Pwd
              </Button>
              {u.id !== user?.id && (
                <Button size="sm" variant="destructive" onClick={() => deleteUser(u.id)}>
                  Delete
                </Button>
              )}
            </div>
          )},

        ]}
      />


      {/* Success Toast Popup */}
      {toast.show && (
        <div className="fixed bottom-4 right-4 z-50 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 border border-green-500 animate-bounce">
          <span className="text-sm font-medium">{toast.message}</span>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <Card className="w-full max-w-md p-5" onClick={(e: any) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="font-semibold text-lg">Add User</div>
              <button onClick={() => setShowNew(false)} className="p-1 hover:bg-muted rounded"><X className="h-4 w-4" /></button>
            </div>
            
            {submitError && (
              <div className="mt-3 p-3 bg-destructive/15 text-destructive rounded-md text-xs font-medium border border-destructive/20">
                {submitError}
              </div>
            )}

            <form onSubmit={addUser} className="mt-4 space-y-4">
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {form.role === "Driver" ? "Driver Name" : "Name"}
                  </label>
                  {form.role === "Driver" && driverList.length > 0 && isCustomDriver && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsCustomDriver(false);
                        setForm({ ...form, name: "" });
                      }}
                      className="text-xs text-primary hover:underline"
                    >
                      ← Select from driver list
                    </button>
                  )}
                </div>

                {form.role === "Driver" && driverList.length > 0 && !isCustomDriver ? (
                  <select 
                    required 
                    disabled={loading}
                    value={form.name} 
                    onChange={(e) => {
                      if (e.target.value === "__custom__") {
                        setIsCustomDriver(true);
                        setForm({ ...form, name: "", phone: "" });
                      } else {
                        // Auto-fill phone when selecting a driver
                        const selected = driverList.find(d => d.name === e.target.value);
                        setForm({ ...form, name: e.target.value, phone: selected?.phone || "" });
                      }
                    }}
                    className="mt-1 h-10 w-full px-3 border border-border rounded-md bg-card text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  >
                    <option value="">-- Select Driver Name --</option>
                    {driverList.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}{d.phone ? ` — ${d.phone}` : ""}
                      </option>
                    ))}
                    <option value="__custom__">+ Enter custom driver name...</option>
                  </select>
                ) : (
                  <input 
                    required 
                    disabled={loading}
                    value={form.name} 
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={form.role === "Driver" ? "e.g. Bensingh" : "John Doe"}
                    className="mt-1 h-10 w-full px-3 border border-border rounded-md bg-card text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" 
                  />
                )}
              </div>

              {/* ── Phone number + Password for Driver, Email+Password for Staff ── */}
              {form.role === "Driver" ? (
                <>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Phone Number</label>
                    <input 
                      required 
                      type="tel" 
                      disabled={loading}
                      value={form.phone} 
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder="+91 98765 43210"
                      className="mt-1 h-10 w-full px-3 border border-border rounded-md bg-card text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" 
                    />
                    <p className="text-[11px] text-muted-foreground/70 mt-1">Driver logs in using this phone number.</p>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Password <span className="text-muted-foreground/50 font-normal normal-case">(optional)</span></label>
                    <div className="relative mt-1">
                      <input 
                        type={showPassword ? "text" : "password"} 
                        disabled={loading}
                        value={form.password} 
                        onChange={(e) => handlePasswordChange(e.target.value)}
                        placeholder="Min. 8 characters — leave blank for phone-only login"
                        className="h-10 w-full pl-3 pr-10 border border-border rounded-md bg-card text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" 
                      />
                      <button 
                        type="button" 
                        disabled={loading}
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {pwdError && (
                      <p className="text-xs text-destructive mt-1 font-medium">{pwdError}</p>
                    )}
                    <p className="text-[11px] text-muted-foreground/70 mt-1">If set, driver can also log in with password via Staff tab.</p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email Address</label>
                    <input 
                      required 
                      type="email" 
                      disabled={loading}
                      value={form.email} 
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="john.doe@nanjilmilk.com"
                      className="mt-1 h-10 w-full px-3 border border-border rounded-md bg-card text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" 
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Password</label>
                    <div className="relative mt-1">
                      <input 
                        required 
                        type={showPassword ? "text" : "password"} 
                        disabled={loading}
                        value={form.password} 
                        onChange={(e) => handlePasswordChange(e.target.value)}
                        placeholder="••••••••"
                        className="h-10 w-full pl-3 pr-10 border border-border rounded-md bg-card text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" 
                      />
                      <button 
                        type="button" 
                        disabled={loading}
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {pwdError && (
                      <p className="text-xs text-destructive mt-1 font-medium">{pwdError}</p>
                    )}
                  </div>
                </>
              )}

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Assigned Role</label>
                <select 
                  disabled={loading}
                  value={form.role} 
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="mt-1 h-10 w-full px-3 border border-border rounded-md bg-card text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                >
                  <option>Administrator</option>
                  <option>Fleet Manager</option>
                  <option>Driver</option>
                  <option>Operations</option>
                </select>
              </div>

              <Button disabled={loading} className="w-full flex items-center justify-center gap-2">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating user...
                  </>
                ) : (
                  "Create User"
                )}
              </Button>
            </form>
          </Card>
        </div>
      )}
      {showResetPwd && selectedUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setShowResetPwd(false); setNewPwd(""); setConfirmPwd(""); setShowNewPwd(false); setShowConfirmPwd(false); }}>
          <Card className="w-full max-w-sm p-5" onClick={(e: any) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-lg">Reset Password</div>
                <p className="text-xs text-muted-foreground mt-0.5">Resetting password for {selectedUser.name}</p>
              </div>
              <button onClick={() => { setShowResetPwd(false); setNewPwd(""); setConfirmPwd(""); setShowNewPwd(false); setShowConfirmPwd(false); }} className="p-1 hover:bg-muted rounded"><X className="h-4 w-4" /></button>
            </div>

            {resetError && (
              <div className="mt-3 p-3 bg-destructive/15 text-destructive rounded-md text-xs font-medium border border-destructive/20">
                {resetError}
              </div>
            )}

            <form onSubmit={handleResetPassword} className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">New Password</label>
                <div className="relative mt-1">
                  <input 
                    required 
                    type={showNewPwd ? "text" : "password"} 
                    disabled={resetting}
                    value={newPwd} 
                    onChange={(e) => setNewPwd(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="h-10 w-full pl-3 pr-10 border border-border rounded-md bg-card text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" 
                  />
                  <button 
                    type="button" 
                    disabled={resetting}
                    onClick={() => setShowNewPwd(!showNewPwd)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showNewPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Confirm Password</label>
                <div className="relative mt-1">
                  <input 
                    required 
                    type={showConfirmPwd ? "text" : "password"} 
                    disabled={resetting}
                    value={confirmPwd} 
                    onChange={(e) => setConfirmPwd(e.target.value)}
                    placeholder="Re-type new password"
                    className="h-10 w-full pl-3 pr-10 border border-border rounded-md bg-card text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" 
                  />
                  <button 
                    type="button" 
                    disabled={resetting}
                    onClick={() => setShowConfirmPwd(!showConfirmPwd)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showConfirmPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" onClick={() => { setShowResetPwd(false); setNewPwd(""); setConfirmPwd(""); setShowNewPwd(false); setShowConfirmPwd(false); }} disabled={resetting} className="flex-1">
                  Cancel
                </Button>
                <Button type="submit" disabled={resetting || newPwd.length < 8 || newPwd !== confirmPwd} className="flex-1">
                  {resetting ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Reset"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

export default Page;
