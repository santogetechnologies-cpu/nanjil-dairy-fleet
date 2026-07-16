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
  const [form, setForm] = useState({ name: "", email: "", role: "Driver", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pwdError, setPwdError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [toast, setToast] = useState({ show: false, message: "" });

  // Reset password states
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [showResetPwd, setShowResetPwd] = useState(false);
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState("");

  async function loadUsers() {
    const { data } = await supabase.from('profiles').select('*');
    if (data) {
      const roleMapRev: Record<string, string> = {
        admin: "Administrator",
        manager: "Fleet Manager",
        driver: "Driver",
        operations: "Operations",
        supervisor: "Supervisor",
        qa: "QA",
        logistics: "Logistics",
        accounts: "Accounts"
      };

      setUsers(data.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: roleMapRev[u.role] || u.role,
        status: u.status || 'Active',
        lastLogin: u.last_login ? new Date(u.last_login).toLocaleTimeString() : 'sec ago'
      })));
    }
  }

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      if (user?.role !== "admin") return;

      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled || !session) return;

      loadUsers();

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
    if (form.password.length < 8) {
      setPwdError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    setSubmitError("");

    const roleMapping: Record<string, string> = {
      "Administrator": "admin",
      "Fleet Manager": "manager",
      "Driver": "driver",
      "Operations": "operations",
      "Supervisor": "supervisor",
      "QA": "qa",
      "Logistics": "logistics",
      "Accounts": "accounts"
    };
    const roleVal = roleMapping[form.role] || "driver";

    try {
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
      const { data: signUpData, error: signUpErr } = await tempClient.auth.signUp({
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
        throw new Error(signUpErr.message);
      }

      if (!signUpData.user) {
        throw new Error("Unable to retrieve user account from creation response.");
      }

      // 3. Write profile directly to database to match Auth account
      const { error: profErr } = await supabase.from('profiles').upsert({
        id: signUpData.user.id,
        name: form.name,
        email: form.email.toLowerCase().trim(),
        role: roleVal,
        status: 'Active',
        created_at: new Date().toISOString()
      });

      if (profErr) {
        throw new Error(`Profile creation failed: ${profErr.message}`);
      }

      // 4. Success Handling
      setToast({ show: true, message: "User created successfully." });
      setShowNew(false);
      setForm({ name: "", email: "", role: "Driver", password: "" });
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
    await supabase.from('profiles').update({ status: newStatus }).eq('id', id);
    loadUsers();
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
      const { error } = await supabase.rpc("admin_reset_user_password", {
        user_id: selectedUser.id,
        new_password: newPwd
      });

      if (error) throw error;

      setToast({ show: true, message: `Password for ${selectedUser.name} reset successfully.` });
      setShowResetPwd(false);
      setNewPwd("");
      setConfirmPwd("");
      setShowNewPwd(false);
      setShowConfirmPwd(false);
      setSelectedUser(null);
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
    if (!confirm("Are you sure you want to delete this user profile? This action is permanent.")) return;

    // Delete associated driver record from drivers table first (cascades shifts, etc.)
    await supabase
      .from('drivers')
      .delete()
      .eq('profile_id', id);

    // Delete profile
    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', id);

    if (error) {
      alert("Failed to delete user: " + error.message);
    } else {
      setToast({ show: true, message: "User deleted successfully." });
      loadUsers();
      setTimeout(() => setToast({ show: false, message: "" }), 3000);
    }
  }

  return (
    <div>
      <PageHeader
        title="User Management"
        subtitle={`${users.length} users · roles & permissions`}
        actions={<Button onClick={() => setShowNew(true)}><Plus className="h-4 w-4" /> Add user</Button>}
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
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</label>
                <input 
                  required 
                  disabled={loading}
                  value={form.name} 
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="John Doe"
                  className="mt-1 h-10 w-full px-3 border border-border rounded-md bg-card text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" 
                />
              </div>

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
                  <option>Supervisor</option>
                  <option>QA</option>
                  <option>Logistics</option>
                  <option>Accounts</option>
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
