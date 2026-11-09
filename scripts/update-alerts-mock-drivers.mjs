import fs from "fs";

let code = fs.readFileSync("src/pages/_app.alerts.tsx", "utf8");
code = code.replace(/\r\n/g, "\n");

const oldLoadAlerts = `  async function loadAlerts() {
    setIsLoading(true);
    try {
      const [aRes, vRes] = await Promise.all([
        supabase.from("alerts").select("*").order("time", { ascending: false }),
        supabase.from("vehicles").select("id, number, type"),
      ]);

      const vList = vRes.data || [];
      setVehicles(vList);

      const rawAlerts = aRes.data || [];
      const mapped: OperationalAlert[] = rawAlerts.map((a: any, idx: number) => {
        const vObj = vList.find((x) => x.id === a.vehicle_id);
        const vNum = vObj ? vObj.number : a.vehicle || (vList[0]?.number || "Fleet Unit");

        // Map generic alert message to clean operational types
        const msg = (a.message || "").toLowerCase();
        let alertType: OperationalAlert["type"] = "Overspeeding";
        if (msg.includes("deviation") || msg.includes("route")) alertType = "Route Deviation";
        else if (msg.includes("idle")) alertType = "Excessive Idling";
        else if (msg.includes("stop")) alertType = "Unexpected Stop";
        else if (msg.includes("fuel")) alertType = "Fuel Anomaly";
        else if (msg.includes("maintenance") || msg.includes("service")) alertType = "Maintenance Due";
        else if (msg.includes("expiry") || msg.includes("permit") || msg.includes("insurance"))
          alertType = "Document Expiry";
        else if (msg.includes("offline") || msg.includes("disconnect")) alertType = "GPS Offline";
        else if (msg.includes("delay")) alertType = "Delayed Arrival";
        else if (msg.includes("missed")) alertType = "Missed Mandatory Stop";

        let sev: OperationalAlert["severity"] = a.severity || "Medium";
        if (a.severity === "High" && (msg.includes("critical") || msg.includes("breakdown"))) {
          sev = "Critical";
        }

        return {
          id: a.id,
          type: alertType,
          severity: sev,
          vehicleNumber: vNum,
          vehicleId: a.vehicle_id,
          driverName: idx % 2 === 0 ? "S. Arumugam" : "M. Kumar",
          message: a.message,
          timestamp: a.time || new Date().toISOString(),
          location: "NH-47 Bypass, Nagercoil",
          status: a.resolved ? "Resolved" : idx % 3 === 1 ? "Acknowledged" : "New",
          assignedPerson: a.resolved ? "Ops Team" : undefined,
        };
      });
      // Authentic database operational alerts
      setAlerts(mapped);
    } catch (err) {
      console.warn("Alerts load warning:", err);
    } finally {
      setIsLoading(false);
    }
  }`;

const newLoadAlerts = `  async function loadAlerts() {
    setIsLoading(true);
    try {
      const [aRes, vRes, dRes, vaRes, tRes] = await Promise.all([
        supabase.from("alerts").select("*").order("time", { ascending: false }),
        supabase.from("vehicles").select("id, number, type, model"),
        supabase.from("drivers").select("id, name, phone"),
        supabase.from("vehicle_assignments").select("id, vehicle_id, driver_id, assigned_at, unassigned_at, is_active, drivers(name)"),
        supabase.from("trips").select("vehicle_id, driver_id, date, drivers(name)").order("date", { ascending: false }),
      ]);

      const vList = vRes.data || [];
      setVehicles(vList);

      const dList = dRes.data || [];
      const dMap = new Map<string, string>();
      dList.forEach((d: any) => {
        if (d.id && d.name) dMap.set(d.id, d.name);
      });

      const vaList = vaRes.data || [];
      const tList = tRes.data || [];

      // Active vehicle assignment lookup
      const activeAssignmentMap = new Map<string, string>();
      vaList.forEach((va: any) => {
        if (va.is_active && va.vehicle_id) {
          const name = va.drivers?.name || dMap.get(va.driver_id);
          if (name) activeAssignmentMap.set(va.vehicle_id, name);
        }
      });

      const rawAlerts = aRes.data || [];
      const mapped: OperationalAlert[] = rawAlerts.map((a: any, idx: number) => {
        const vObj = vList.find((x) => x.id === a.vehicle_id);
        const vNum = vObj ? vObj.number : a.vehicle || "Fleet Unit";

        // Map generic alert message to clean operational types
        const msg = (a.message || "").toLowerCase();
        let alertType: OperationalAlert["type"] = "Overspeeding";
        if (msg.includes("deviation") || msg.includes("route")) alertType = "Route Deviation";
        else if (msg.includes("idle")) alertType = "Excessive Idling";
        else if (msg.includes("stop")) alertType = "Unexpected Stop";
        else if (msg.includes("fuel")) alertType = "Fuel Anomaly";
        else if (msg.includes("maintenance") || msg.includes("service")) alertType = "Maintenance Due";
        else if (msg.includes("expiry") || msg.includes("permit") || msg.includes("insurance"))
          alertType = "Document Expiry";
        else if (msg.includes("offline") || msg.includes("disconnect")) alertType = "GPS Offline";
        else if (msg.includes("delay")) alertType = "Delayed Arrival";
        else if (msg.includes("missed")) alertType = "Missed Mandatory Stop";

        let sev: OperationalAlert["severity"] = a.severity || "Medium";
        if (a.severity === "High" && (msg.includes("critical") || msg.includes("breakdown"))) {
          sev = "Critical";
        }

        // Resolve authentic driver for this alert (Never use mock names!)
        let resolvedDriverName: string | undefined = undefined;

        if (a.vehicle_id) {
          const alertTimeMs = a.time ? new Date(a.time).getTime() : NaN;

          // 1. Check historical assignment matching alert timestamp
          if (!isNaN(alertTimeMs)) {
            const histVa = vaList.find((va: any) => {
              if (va.vehicle_id !== a.vehicle_id) return false;
              const start = new Date(va.assigned_at).getTime();
              if (!isNaN(start) && start > alertTimeMs) return false;
              if (va.unassigned_at) {
                const end = new Date(va.unassigned_at).getTime();
                if (!isNaN(end) && end < alertTimeMs) return false;
              }
              return true;
            });
            if (histVa) {
              resolvedDriverName = histVa.drivers?.name || dMap.get(histVa.driver_id);
            }
          }

          // 2. Check currently active vehicle assignment
          if (!resolvedDriverName) {
            resolvedDriverName = activeAssignmentMap.get(a.vehicle_id);
          }

          // 3. Check trips matching vehicle on that date
          if (!resolvedDriverName && a.time) {
            const alertDateStr = a.time.split("T")[0];
            const matchedTrip = tList.find((t: any) => t.vehicle_id === a.vehicle_id && t.date === alertDateStr);
            if (matchedTrip) {
              resolvedDriverName = matchedTrip.drivers?.name || dMap.get(matchedTrip.driver_id);
            }
          }
        }

        // Real alert status: if resolved is true, Resolved; otherwise New or saved status
        const alertStatus: OperationalAlert["status"] = a.resolved
          ? "Resolved"
          : a.status === "Acknowledged" || a.status === "In Progress"
          ? a.status
          : "New";

        return {
          id: a.id,
          type: alertType,
          severity: sev,
          vehicleNumber: vNum,
          vehicleId: a.vehicle_id,
          driverName: resolvedDriverName, // authentic driver name or undefined
          message: a.message,
          timestamp: a.time || a.created_at || new Date().toISOString(),
          location: a.location || (vObj?.model ? \`\${vObj.model} Operations Corridor\` : "Fleet Operational Route"),
          status: alertStatus,
          assignedPerson: a.resolved ? (a.resolved_by || "Operations Team") : undefined,
          resolutionNotes: a.resolution_notes,
        };
      });
      // Authentic database operational alerts
      setAlerts(mapped);
    } catch (err) {
      console.warn("Alerts load warning:", err);
    } finally {
      setIsLoading(false);
    }
  }`;

if (!code.includes(oldLoadAlerts)) {
  console.error("oldLoadAlerts not found");
  process.exit(1);
}
code = code.replace(oldLoadAlerts, newLoadAlerts);

// Replace Driver column cell render
const oldDriverCell = `<td className="py-3 px-3 text-slate-600">{alt.driverName || "—"}</td>`;
const newDriverCell = `<td className="py-3 px-3">
                    {alt.driverName ? (
                      <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                        <User className="h-3 w-3 text-slate-400 shrink-0" />
                        {alt.driverName}
                      </span>
                    ) : (
                      <span className="text-slate-400 font-normal italic">Unassigned</span>
                    )}
                  </td>`;

if (!code.includes(oldDriverCell)) {
  console.error("oldDriverCell not found");
  process.exit(1);
}
code = code.replace(oldDriverCell, newDriverCell);

fs.writeFileSync("src/pages/_app.alerts.tsx", code, "utf8");
console.log("Successfully updated _app.alerts.tsx");

