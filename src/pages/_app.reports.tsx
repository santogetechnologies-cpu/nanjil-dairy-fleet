
import { useState } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Card, Button } from "@/components/ui-kit";
import { FileText, Download, FileSpreadsheet } from "lucide-react";

const REPORTS = [
  { id: "vehicle", name: "Vehicle Report", desc: "Status, odometer, location and assignments for all 40 vehicles." },
  { id: "fuel", name: "Fuel Report", desc: "Daily consumption, mileage and theft alerts across the fleet." },
  { id: "safety", name: "Driver Safety Report", desc: "Driver scores, ranking and event breakdown." },
  { id: "trip", name: "Trip Report", desc: "Trip log including start/destination, distance and duration." },
  { id: "cold-chain", name: "Cold Chain Report", desc: "Temperature & humidity compliance for milk transport." },
  { id: "maintenance", name: "Maintenance Report", desc: "Service history, upcoming services and cost summary." },
];

function generate(format: "pdf" | "xlsx", id: string) {
  const content = `Nanjil Vehicle Intelligence Platform\n${id.toUpperCase()} REPORT\nGenerated: ${new Date().toISOString()}\n\nThis is a generated demo report containing aggregated fleet data.`;
  const blob = new Blob([content], { type: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nanjil-${id}-report.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

function Page() {
  const [busy, setBusy] = useState<string | null>(null);

  function run(id: string, format: "pdf" | "xlsx") {
    setBusy(`${id}-${format}`);
    setTimeout(() => {
      generate(format, id);
      setBusy(null);
    }, 600);
  }

  return (
    <div>
      <PageHeader title="Reports" subtitle="Generate operational reports for management review" />

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
                  <Button size="sm" variant="primary" disabled={busy === `${r.id}-pdf`} onClick={() => run(r.id, "pdf")}>
                    <Download className="h-3 w-3" /> {busy === `${r.id}-pdf` ? "Preparing…" : "Export PDF"}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy === `${r.id}-xlsx`} onClick={() => run(r.id, "xlsx")}>
                    <FileSpreadsheet className="h-3 w-3" /> Export Excel
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
