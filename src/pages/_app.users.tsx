import { useState, useEffect } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Card, Badge, Button } from "@/components/ui-kit";
import { DataTable } from "@/components/DataTable";
import { useAuth } from "@/lib/auth";
import { Plus, X, Eye, EyeOff, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";

// Isolated client for creating new users without affecting the admin session.
// Uses a unique storageKey + no-op storage to prevent any shared state with the main client.
const tempClient = createClient(
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
    if (user?.role === "admin") {
      loadUsers();
    }
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
            <Button size="sm" variant="outline" onClick={() => toggle(u.id)}>
              {u.status === "Active" ? "Deactivate" : "Activate"}
            </Button>
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
    </div>
  );
}

export default Page;
