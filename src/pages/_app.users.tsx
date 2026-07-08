
import { useState, useEffect } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Card, Badge, Button } from "@/components/ui-kit";
import { DataTable } from "@/components/DataTable";
import { useAuth } from "@/lib/auth";
import { Plus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface UserRow {
  id: string; name: string; email: string; role: string; status: string; lastLogin: string;
}

function Page() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "Driver" });

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

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    const password = "password123";
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

    // Sign up user
    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
      email: form.email,
      password: password,
      options: {
        data: {
          name: form.name,
          role: roleVal
        }
      }
    });

    if (signUpErr) {
      alert("Error adding user: " + signUpErr.message);
      return;
    }

    if (signUpData.user) {
      const { error: profErr } = await supabase.from('profiles').insert({
        id: signUpData.user.id,
        name: form.name,
        email: form.email,
        role: roleVal,
        status: 'Active'
      });
      if (profErr) {
        // Fallback in case trigger failed or had conflict
        await supabase.from('profiles').update({
          name: form.name,
          role: roleVal,
          status: 'Active'
        }).eq('id', signUpData.user.id);
      }
    }

    setShowNew(false);
    setForm({ name: "", email: "", role: "Driver" });
    loadUsers();
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

      {showNew && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <Card className="w-full max-w-md p-5" onClick={(e: any) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="font-semibold">Add user</div>
              <button onClick={() => setShowNew(false)} className="p-1 hover:bg-muted rounded"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={addUser} className="mt-4 space-y-3">
              <div>
                <label className="text-sm font-medium">Name</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 h-10 w-full px-3 border border-border rounded-md bg-card text-sm outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="text-sm font-medium">Email</label>
                <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="mt-1 h-10 w-full px-3 border border-border rounded-md bg-card text-sm outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="text-sm font-medium">Role</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="mt-1 h-10 w-full px-3 border border-border rounded-md bg-card text-sm">
                  <option>Administrator</option><option>Fleet Manager</option><option>Driver</option>
                  <option>Operations</option><option>Supervisor</option><option>QA</option>
                </select>
              </div>
              <Button className="w-full">Create user</Button>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

export default Page;
