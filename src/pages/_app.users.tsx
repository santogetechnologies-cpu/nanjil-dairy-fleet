
import { useState } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Card, Badge, Button } from "@/components/ui-kit";
import { DataTable } from "@/components/DataTable";
import { useAuth } from "@/lib/auth";
import { Plus, X } from "lucide-react";

interface UserRow {
  id: string; name: string; email: string; role: string; status: string; lastLogin: string;
}

const INITIAL: UserRow[] = [
  { id: "U001", name: "Person 1", email: "admin@nanjilmilk.com", role: "Administrator", status: "Active", lastLogin: "2 min ago" },
  { id: "U002", name: "Person 2", email: "manager@nanjilmilk.com", role: "Fleet Manager", status: "Active", lastLogin: "18 min ago" },
  { id: "U003", name: "Person 3", email: "driver@nanjilmilk.com", role: "Driver", status: "Active", lastLogin: "1 hour ago" },
  { id: "U004", name: "Murali Krishnan", email: "ops@nanjilmilk.com", role: "Operations", status: "Active", lastLogin: "3 hours ago" },
  { id: "U005", name: "Selvi M", email: "accounts@nanjilmilk.com", role: "Accounts", status: "Active", lastLogin: "Yesterday" },
  { id: "U006", name: "Pradeep Kumar", email: "supervisor@nanjilmilk.com", role: "Supervisor", status: "Inactive", lastLogin: "5 days ago" },
  { id: "U007", name: "Vimala R", email: "qa@nanjilmilk.com", role: "QA", status: "Active", lastLogin: "30 min ago" },
  { id: "U008", name: "Senthil Babu", email: "logistics@nanjilmilk.com", role: "Logistics", status: "Active", lastLogin: "2 hours ago" },
];

function Page() {
  const { user } = useAuth();
  const [users, setUsers] = useState(INITIAL);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "Driver" });

  if (user?.role !== "admin") {
    return (
      <div className="p-8 text-center">
        <div className="text-lg font-medium">Restricted</div>
        <p className="text-muted-foreground mt-1">User management is available to administrators only.</p>
      </div>
    );
  }

  function addUser(e: React.FormEvent) {
    e.preventDefault();
    setUsers((u) => [
      { id: `U${String(u.length + 1).padStart(3, "0")}`, name: form.name, email: form.email, role: form.role, status: "Active", lastLogin: "Just now" },
      ...u,
    ]);
    setShowNew(false);
    setForm({ name: "", email: "", role: "Driver" });
  }

  function toggle(id: string) {
    setUsers((arr) => arr.map((u) => (u.id === id ? { ...u, status: u.status === "Active" ? "Inactive" : "Active" } : u)));
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
