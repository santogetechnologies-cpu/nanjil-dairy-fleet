import { useState, useEffect } from "react";
import { type Driver } from "@/lib/types";
import { PageHeader } from "@/components/AppLayout";
import { Kpi, Card, CardHeader, Badge, Button } from "@/components/ui-kit";
import { ShieldCheck, AlertTriangle, TrendingUp, UsersRound, Trash2, UserPlus, X, Loader2, Pencil } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

function Page() {
  const { user } = useAuth();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [eventsChart, setEventsChart] = useState<{ name: string; value: number }[]>([]);
  const [radarData, setRadarData] = useState<{ metric: string; score: number }[]>([]);
  
  // Add & Edit Driver state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [vehicles, setVehicles] = useState<{ id: string; number: string }[]>([]);
  const [addForm, setAddForm] = useState({
    name: "",
    phone: "",
    license: "",
    score: 100,
    vehicleId: ""
  });
  const [editForm, setEditForm] = useState({
    id: "",
    name: "",
    phone: "",
    license: "",
    score: 100,
    vehicleId: ""
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState({ show: false, message: "" });

  const canManage = user?.role === "admin" || user?.role === "manager";

  async function load() {
    // 1. Fetch safety ranking
    const { data: dData } = await supabase.from('v_driver_safety_ranking').select('*');
    
    let resolvedDrivers: Driver[] = [];
    if (dData) {
      const map = new Map<string, Driver>();
      for (const d of dData) {
        const item: Driver = {
          id: d.id,
          name: d.name,
          vehicle: d.vehicle || 'Unknown',
          phone: '',
          license: '',
          score: d.score,
          events: d.events,
          rating: d.rating,
          trips: d.trips,
          totalKm: d.total_km
        };
        const key = (d.name || '').trim().toLowerCase();
        const existing = map.get(key);
        // Prefer entry with assigned vehicle or non-zero score/events
        if (!existing || (existing.vehicle === 'Unknown' && item.vehicle !== 'Unknown')) {
          map.set(key, item);
        }
      }
      setDrivers(Array.from(map.values()));
    }

    // Fetch available vehicles list for optional vehicle assignment
    const { data: vData } = await supabase.from('vehicles').select('id, number').order('number');
    if (vData) {
      setVehicles(vData);
    }

    // 2. Fetch safety alerts to calculate safety events chart
    const { data: aData } = await supabase
      .from('alerts')
      .select('message')
      .eq('type', 'Safety');

    const counts: Record<string, number> = {
      "Overspeed": 0,
      "Harsh Braking": 0,
      "Sudden Accel.": 0,
      "Sharp Turn": 0,
      "Rash Driving": 0
    };

    if (aData) {
      aData.forEach(a => {
        const msg = a.message.toLowerCase();
        if (msg.includes('speed') || msg.includes('overspeed')) counts["Overspeed"]++;
        else if (msg.includes('brake') || msg.includes('braking')) counts["Harsh Braking"]++;
        else if (msg.includes('acceleration') || msg.includes('accel')) counts["Sudden Accel."]++;
        else if (msg.includes('turn') || msg.includes('cornering')) counts["Sharp Turn"]++;
        else counts["Rash Driving"]++;
      });
    }
    setEventsChart(Object.keys(counts).map(name => ({ name, value: counts[name] })));

    // 3. Radar safety profile: compute per-dimension safety event counts from alerts
    // Each dimension is derived from real alert message keywords in the database
    const speedCount = aData ? aData.filter(a => /speed|overspeed/i.test(a.message)).length : 0;
    const brakeCount = aData ? aData.filter(a => /brake|braking/i.test(a.message)).length : 0;
    const accelCount = aData ? aData.filter(a => /accel/i.test(a.message)).length : 0;
    const turnCount  = aData ? aData.filter(a => /turn|corner/i.test(a.message)).length : 0;
    const rashCount  = aData ? aData.filter(a => !/speed|brake|accel|turn|corner/i.test(a.message)).length : 0;
    const totalEvents = speedCount + brakeCount + accelCount + turnCount + rashCount || 1;

    // Convert incident counts to a 0-100 safety score per dimension (fewer events = higher score)
    const toScore = (count: number) => Math.max(0, Math.round(100 - (count / totalEvents) * 100));

    setRadarData([
      { metric: "Speed Control", score: aData && aData.length > 0 ? toScore(speedCount) : 100 },
      { metric: "Smooth Braking", score: aData && aData.length > 0 ? toScore(brakeCount) : 100 },
      { metric: "Acceleration", score: aData && aData.length > 0 ? toScore(accelCount) : 100 },
      { metric: "Cornering", score: aData && aData.length > 0 ? toScore(turnCount) : 100 },
      { metric: "Safe Driving", score: aData && aData.length > 0 ? toScore(rashCount) : 100 },
    ]);
  }

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      if (cancelled) return;

      load();

      channel = supabase
        .channel('safety-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => { if (!cancelled) load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => { if (!cancelled) load(); })
        .subscribe();
    }

    init();

    return () => {
      cancelled = true;
      channel?.unsubscribe();
    };
  }, []);

  const sorted = [...drivers].sort((a, b) => b.score - a.score);
  const topPerformer = sorted[0] || { name: "None", score: 0, vehicle: "N/A" };
  const needsImprovement = sorted.filter((d) => d.score < 80).length;
  const avgScore = drivers.length > 0 ? Math.round(drivers.reduce((s, d) => s + d.score, 0) / drivers.length) : 0;

  async function handleAddDriver(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.name.trim()) {
      setFormError("Driver name is required.");
      return;
    }

    setSubmitting(true);
    setFormError("");

    try {
      const scoreNum = Math.min(100, Math.max(0, Number(addForm.score) || 100));
      const ratingVal = scoreNum >= 90 ? "Excellent" : scoreNum >= 75 ? "Good" : scoreNum >= 60 ? "Average" : "Poor";

      // 1. Insert driver record into drivers table
      const { data: newDriver, error: insertErr } = await supabase
        .from('drivers')
        .insert({
          name: addForm.name.trim(),
          phone: addForm.phone.trim() || null,
          license: addForm.license.trim() ? addForm.license.trim().toUpperCase() : null,
          score: scoreNum,
          rating: ratingVal,
          events: 0,
          trips: 0,
          total_km: 0
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      // 2. If a vehicle was selected, create/update vehicle_assignments
      if (addForm.vehicleId && newDriver) {
        await supabase
          .from('vehicle_assignments')
          .update({ is_active: false, unassigned_at: new Date().toISOString() })
          .eq('vehicle_id', addForm.vehicleId)
          .eq('is_active', true);

        const { error: assignErr } = await supabase
          .from('vehicle_assignments')
          .insert({
            vehicle_id: addForm.vehicleId,
            driver_id: newDriver.id,
            is_active: true
          });

        if (assignErr) {
          console.warn("Vehicle assignment failed:", assignErr.message);
        }
      }

      // 3. Reset form and inform user
      const createdName = addForm.name.trim();
      setShowAddModal(false);
      setAddForm({ name: "", phone: "", license: "", score: 100, vehicleId: "" });
      setToast({ show: true, message: `Driver "${createdName}" added successfully.` });
      load();

      setTimeout(() => setToast({ show: false, message: "" }), 3000);
    } catch (err: any) {
      setFormError(err?.message || "Failed to add driver. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function openEditModal(driver: Driver) {
    setFormError("");
    try {
      const { data: dData } = await supabase
        .from('drivers')
        .select('*')
        .eq('id', driver.id)
        .maybeSingle();

      const { data: vAssign } = await supabase
        .from('vehicle_assignments')
        .select('vehicle_id')
        .eq('driver_id', driver.id)
        .eq('is_active', true)
        .maybeSingle();

      setEditForm({
        id: driver.id,
        name: dData?.name || driver.name,
        phone: dData?.phone || '',
        license: dData?.license || '',
        score: dData?.score ?? driver.score,
        vehicleId: vAssign?.vehicle_id || ''
      });
      setShowEditModal(true);
    } catch (err: any) {
      console.error("Failed to load driver details for edit:", err);
    }
  }

  async function handleUpdateDriver(e: React.FormEvent) {
    e.preventDefault();
    if (!editForm.name.trim() || !editForm.id) {
      setFormError("Driver name is required.");
      return;
    }

    setSubmitting(true);
    setFormError("");

    try {
      const scoreNum = Math.min(100, Math.max(0, Number(editForm.score) || 100));
      const ratingVal = scoreNum >= 90 ? "Excellent" : scoreNum >= 75 ? "Good" : scoreNum >= 60 ? "Average" : "Poor";

      // 1. Update driver record in drivers table
      const { error: updateErr } = await supabase
        .from('drivers')
        .update({
          name: editForm.name.trim(),
          phone: editForm.phone.trim() || null,
          license: editForm.license.trim() ? editForm.license.trim().toUpperCase() : null,
          score: scoreNum,
          rating: ratingVal,
          updated_at: new Date().toISOString()
        })
        .eq('id', editForm.id);

      if (updateErr) throw updateErr;

      // 2. Check & update vehicle assignment if changed
      const { data: currAssign } = await supabase
        .from('vehicle_assignments')
        .select('vehicle_id')
        .eq('driver_id', editForm.id)
        .eq('is_active', true)
        .maybeSingle();

      const currentVehicleId = currAssign?.vehicle_id || '';

      if (editForm.vehicleId !== currentVehicleId) {
        // Deactivate current assignment for this driver
        await supabase
          .from('vehicle_assignments')
          .update({ is_active: false, unassigned_at: new Date().toISOString() })
          .eq('driver_id', editForm.id)
          .eq('is_active', true);

        if (editForm.vehicleId) {
          // Deactivate any existing assignment for target vehicle
          await supabase
            .from('vehicle_assignments')
            .update({ is_active: false, unassigned_at: new Date().toISOString() })
            .eq('vehicle_id', editForm.vehicleId)
            .eq('is_active', true);

          // Assign new vehicle
          await supabase
            .from('vehicle_assignments')
            .insert({
              vehicle_id: editForm.vehicleId,
              driver_id: editForm.id,
              is_active: true
            });
        }
      }

      const updatedName = editForm.name.trim();
      setShowEditModal(false);
      setToast({ show: true, message: `Driver "${updatedName}" updated successfully.` });
      load();

      setTimeout(() => setToast({ show: false, message: "" }), 3000);
    } catch (err: any) {
      setFormError(err?.message || "Failed to update driver.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteDriver(driver: Driver) {
    if (!confirm(`Are you sure you want to delete driver ${driver.name}? This will remove their driver records, shift history, and safety stats. This action is permanent.`)) return;

    try {
      // 1. Fetch the driver to get their profile_id (if any)
      const { data: driverData, error: fetchErr } = await supabase
        .from('drivers')
        .select('profile_id')
        .eq('id', driver.id)
        .maybeSingle();

      if (fetchErr) throw fetchErr;

      // 2. Delete from drivers table (which cascades to assignments, shifts, schedules, pre-trip inspections, etc.)
      const { error: deleteDriverErr } = await supabase
        .from('drivers')
        .delete()
        .eq('id', driver.id);

      if (deleteDriverErr) throw deleteDriverErr;

      // 3. If there's an associated user profile, delete it from profiles table
      if (driverData?.profile_id) {
        const { error: deleteProfileErr } = await supabase
          .from('profiles')
          .delete()
          .eq('id', driverData.profile_id);

        if (deleteProfileErr) {
          console.warn("Driver record deleted, but profile deletion failed:", deleteProfileErr.message);
        }
      }

      alert("Driver deleted successfully.");
      load();
    } catch (err: any) {
      alert("Failed to delete driver: " + err.message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Driver Management"
        subtitle="Real-time scoring, events and ranking"
        actions={
          canManage ? (
            <Button onClick={() => { setShowAddModal(true); setFormError(""); }}>
              <UserPlus className="h-4 w-4" /> Add Driver
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Average Safety Score" value={`${avgScore}%`} accent="success" icon={<ShieldCheck className="h-5 w-5" />} />
        <Kpi label="Top Performer" value={topPerformer.name} hint={`${topPerformer.score}% · ${topPerformer.vehicle}`} icon={<TrendingUp className="h-5 w-5" />} />
        <Kpi label="Needs Improvement" value={needsImprovement} accent="warning" icon={<AlertTriangle className="h-5 w-5" />} hint="Score < 80%" />
        <Kpi label="Total Drivers" value={drivers.length} icon={<UsersRound className="h-5 w-5" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card>
          <CardHeader title="Safety Events" subtitle="Aggregated from real-time vehicle alerts" />
          <div className="p-3" style={{ height: 280 }}>
            {eventsChart.some(item => item.value > 0) ? (
              <ResponsiveContainer>
                <BarChart data={eventsChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="value" fill="oklch(0.6 0.22 25)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No safety alerts registered in the system.
              </div>
            )}
          </div>
        </Card>
        
        <Card>
          <CardHeader title="Fleet Safety Profile" subtitle="Average safety dimension scores" />
          <div className="p-3" style={{ height: 280 }}>
            {drivers.length > 0 ? (
              <ResponsiveContainer>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="oklch(0.9 0.01 240)" />
                  <PolarAngleAxis dataKey="metric" fontSize={11} />
                  <Radar dataKey="score" stroke="oklch(0.45 0.15 255)" fill="oklch(0.45 0.15 255 / 0.3)" />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No driver safety profiles to compile.
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <DataTable<Driver>
          data={sorted}
          searchKeys={["name", "vehicle"]}
          columns={[
            { key: "name", label: "Driver" },
            { key: "vehicle", label: "Vehicle" },
            { key: "score", label: "Safety Score", render: (d) => (
              <div className="flex items-center gap-2">
                <span className="font-semibold">{d.score}%</span>
                <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full ${d.score >= 85 ? "bg-success" : d.score >= 75 ? "bg-warning" : "bg-destructive"}`} style={{ width: `${d.score}%` }} />
                </div>
              </div>
            )},
            { key: "events", label: "Safety Alerts", render: (d) => (
              <span className={`font-semibold ${d.events > 5 ? "text-destructive" : d.events > 2 ? "text-warning" : "text-muted-foreground"}`}>
                {d.events} alerts
              </span>
            )},
            { key: "rating", label: "Rating", render: (d) => <Badge status={d.rating}>{d.rating}</Badge> },
            { key: "trips", label: "Trips logged", render: (d) => `${d.trips} trips` },
            { key: "totalKm", label: "Total Distance", render: (d) => `${d.totalKm.toLocaleString()} km` },
            ...(canManage ? [{
              key: "actions",
              label: "Actions",
              render: (d: Driver) => (
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); openEditModal(d); }}
                    className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-primary transition-colors"
                    title="Edit driver"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteDriver(d); }}
                    className="p-1.5 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                    title="Delete driver"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )
            }] : [])
          ]}
        />
      </div>

      {/* Success Toast */}
      {toast.show && (
        <div className="fixed bottom-4 right-4 z-50 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 border border-green-500 animate-bounce">
          <span className="text-sm font-medium">{toast.message}</span>
        </div>
      )}

      {/* Add Driver Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => !submitting && setShowAddModal(false)}>
          <Card className="w-full max-w-md p-5" onClick={(e: any) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2 font-semibold text-lg">
                <UserPlus className="h-5 w-5 text-primary" />
                Add New Driver
              </div>
              <button onClick={() => setShowAddModal(false)} disabled={submitting} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {formError && (
              <div className="mt-3 p-3 bg-destructive/15 text-destructive rounded-md text-xs font-medium border border-destructive/20">
                {formError}
              </div>
            )}

            <form onSubmit={handleAddDriver} className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  disabled={submitting}
                  placeholder="e.g. Arun Kumar"
                  value={addForm.name}
                  onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">License Number</label>
                  <input
                    type="text"
                    disabled={submitting}
                    placeholder="e.g. TN-74-2024-00123"
                    value={addForm.license}
                    onChange={(e) => setAddForm({ ...addForm, license: e.target.value })}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring uppercase"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Phone Number</label>
                  <input
                    type="tel"
                    disabled={submitting}
                    placeholder="e.g. +91 9876543210"
                    value={addForm.phone}
                    onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Initial Safety Score</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    disabled={submitting}
                    value={addForm.score}
                    onChange={(e) => setAddForm({ ...addForm, score: Number(e.target.value) })}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Assign Vehicle</label>
                  <select
                    disabled={submitting}
                    value={addForm.vehicleId}
                    onChange={(e) => setAddForm({ ...addForm, vehicleId: e.target.value })}
                    className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">-- None (Unassigned) --</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.number}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button type="button" variant="outline" disabled={submitting} onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1" /> Saving...
                    </>
                  ) : (
                    "Save Driver"
                  )}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Edit Driver Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => !submitting && setShowEditModal(false)}>
          <Card className="w-full max-w-md p-5" onClick={(e: any) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2 font-semibold text-lg">
                <Pencil className="h-5 w-5 text-primary" />
                Edit Driver Details
              </div>
              <button onClick={() => setShowEditModal(false)} disabled={submitting} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {formError && (
              <div className="mt-3 p-3 bg-destructive/15 text-destructive rounded-md text-xs font-medium border border-destructive/20">
                {formError}
              </div>
            )}

            <form onSubmit={handleUpdateDriver} className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  disabled={submitting}
                  placeholder="e.g. Arun Kumar"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">License Number</label>
                  <input
                    type="text"
                    disabled={submitting}
                    placeholder="e.g. TN-74-2024-00123"
                    value={editForm.license}
                    onChange={(e) => setEditForm({ ...editForm, license: e.target.value })}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring uppercase"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Phone Number</label>
                  <input
                    type="tel"
                    disabled={submitting}
                    placeholder="e.g. +91 9876543210"
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Safety Score (0-100)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    disabled={submitting}
                    value={editForm.score}
                    onChange={(e) => setEditForm({ ...editForm, score: Number(e.target.value) })}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Assign Vehicle</label>
                  <select
                    disabled={submitting}
                    value={editForm.vehicleId}
                    onChange={(e) => setEditForm({ ...editForm, vehicleId: e.target.value })}
                    className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">-- None (Unassigned) --</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.number}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button type="button" variant="outline" disabled={submitting} onClick={() => setShowEditModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1" /> Updating...
                    </>
                  ) : (
                    "Update Driver"
                  )}
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


