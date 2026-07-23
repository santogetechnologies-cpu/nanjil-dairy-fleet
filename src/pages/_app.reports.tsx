import { useState } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Card, Button } from "@/components/ui-kit";
import { FileText, Download } from "lucide-react";
import { supabase } from "@/lib/supabase";

const REPORTS = [
  { id: "vehicle", name: "Vehicle Report", desc: "Status, odometer, location and assignments for all fleet vehicles." },
  { id: "fuel", name: "Fuel Report", desc: "Daily consumption, mileage and alerts across the fleet." },
  { id: "safety", name: "Driver Management Report", desc: "Driver scores, ranking and event breakdown." },
  { id: "trip", name: "Trip Report", desc: "Trip log including start/destination, distance and duration." },
  { id: "cold-chain", name: "Cold Chain Report", desc: "Temperature & humidity compliance for milk transport." },
  { id: "maintenance", name: "Maintenance Report", desc: "Service history, upcoming services and cost summary." },
];

async function generateReport(id: string) {
  let records: any[] = [];
  
  if (id === 'vehicle') {
    const { data } = await supabase.from('vehicles').select('*');
    records = data || [];
  } else if (id === 'fuel') {
    const { data } = await supabase.from('v_daily_fuel_fleet').select('*');
    records = data || [];
  } else if (id === 'safety') {
    const { data } = await supabase.from('drivers').select('*');
    records = data || [];
  } else if (id === 'trip') {
    const { data } = await supabase.from('trips').select('*');
    records = data || [];
  } else if (id === 'cold-chain') {
    const { data } = await supabase.from('v_vehicles').select('number, temperature, humidity');
    records = data || [];
  } else if (id === 'maintenance') {
    const { data } = await supabase.from('maintenance_records').select('*');
    records = data || [];
  }

  // Convert database records to CSV format
  let csvContent = "";
  if (records.length > 0) {
    const headers = Object.keys(records[0]).join(",");
    const rows = records.map(r => 
      Object.values(r).map(v => {
        if (v === null || v === undefined) return '""';
        return typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : String(v);
      }).join(",")
    );
    csvContent = [headers, ...rows].join("\n");
  } else {
    csvContent = "No records found in database.";
  }

  const content = `Nanjil Vehicle Intelligence Platform\n${id.toUpperCase()} REPORT\nGenerated: ${new Date().toLocaleString()}\n\n${csvContent}`;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nanjil-${id}-report.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Page() {
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string) {
    setBusy(id);
    try {
      await generateReport(id);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Reports" subtitle="Generate live CSV operational reports for management review" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {REPORTS.map((r) => (
          <Card key={r.id} className="p-5">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                <FileText className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="font-semibold">{r.name}</div>
                <div className="text-sm text-muted-foreground mt-0.5">{r.desc}</div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="primary" disabled={busy === r.id} onClick={() => run(r.id)}>
                    <Download className="h-3 w-3" /> {busy === r.id ? "Generating…" : "Export Live CSV"}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default Page;
