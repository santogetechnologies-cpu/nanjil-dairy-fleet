import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Truck,
  Activity,
  ParkingSquare,
  Pause,
  Fuel,
  Wrench,
  Sparkles,
  ArrowUpRight,
  Radio,
} from "lucide-react";
import { Kpi, Card, CardHeader } from "@/components/ui-kit";
import { PageHeader } from "@/components/AppLayout";
import { VehicleMap } from "@/components/VehicleMap";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { useVehicles, TELEMETRY_LABEL } from "@/hooks/useVehicleTracking";
import { calculateFleetFuelAnalysis, type RawFuelLog } from "@/lib/fuel-efficiency";

const STATUS_COLORS: Record<string, string> = {
  Moving: "oklch(0.62 0.16 150)",
  Idle: "oklch(0.78 0.16 75)",
  Parked: "oklch(0.5 0.02 250)",
  Offline: "oklch(0.6 0.22 25)",
};

function DashboardPage() {
  const [now, setNow] = useState(new Date());
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [maintenance, setMaintenance] = useState<any[]>([]);
  const [eff, setEff] = useState<any[]>([]);
  const [fuelData, setFuelData] = useState<any[]>([]);

  // Map shows ONLY vehicles with device IDs, streamed live from the configured telemetry source
  const firebaseVehicles = useVehicles();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function load() {
      try {
        const [vRes, aRes, mRes, logRes] = await Promise.all([
          supabase.from("v_vehicles").select("*"),
          supabase.from("alerts").select("*"),
          supabase.from("maintenance_records").select("*"),
          supabase
            .from("fuel_purchase_logs")
            .select("*, vehicles(number), drivers(name)")
            .order("logged_at", { ascending: true }),
        ]);

        if (cancelled) return;

        const vList = vRes.data || [];
        setVehicles(vList);
        setAlerts(aRes.data || []);
        setMaintenance(mRes.data || []);

        const rawLogs: RawFuelLog[] = logRes.data || [];
        const analysis = calculateFleetFuelAnalysis(rawLogs, vList);

        const realEff = Object.values(analysis.vehicleMap)
          .filter((va) => va.hasSufficientData && va.averageMileage !== null)
          .map((va) => ({
            vehicle: va.vehicleNumber
              ? va.vehicleNumber.split("-").slice(0, 2).join("-")
              : "Unknown",
            kmpl: va.averageMileage!,
          }))
          .slice(0, 10);
        setEff(realEff);

        // Daily manual refill consumption
        const realFuelTrend = analysis.dailyConsumption.filter((d) => d.consumed > 0);
        setFuelData(realFuelTrend);
      } catch (err) {
        console.warn("Dashboard load error:", err);
      }
    }

    async function init() {
      if (cancelled) return;

      load();

      // Register ALL handlers before calling subscribe() — supabase-js requires this order
      channel = supabase
        .channel("dashboard-realtime")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "vehicle_telemetry" },
          () => {
            if (!cancelled) load();
          },
        )
        .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => {
          if (!cancelled) load();
        })
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "maintenance_records" },
          () => {
            if (!cancelled) load();
          },
        )
        .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, () => {
          if (!cancelled) load();
        })
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "vehicle_assignments" },
          () => {
            if (!cancelled) load();
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "fuel_purchase_logs" },
          () => {
            if (!cancelled) load();
          },
        )
        .subscribe();
    }

    init();

    return () => {
      cancelled = true;
      channel?.unsubscribe();
    };
  }, []);

  const mappedVehicles = vehicles.map((v) => ({
    id: v.id,
    number: v.number,
    type: v.type,
    model: v.model,
    route: v.route,
    insuranceExpiry: v.insurance_expiry,
    lastService: v.last_service,
    nextServiceKm: v.next_service_km,
    odometer: v.odometer,
    engineHours: Number(v.engine_hours),
    status: v.status,
    location: v.location,
    lat: Number(v.lat),
    lng: Number(v.lng),
    speed: v.speed,
    fuel: v.fuel,
    temperature: Number(v.temperature),
    humidity: v.humidity,
    engineOn: v.engine_on,
    ignition: v.ignition,
    driver: v.driver_name || "",
    driverId: v.driver_id || "",
    lastUpdate: v.last_update ? new Date(v.last_update).toLocaleTimeString() : "sec ago",
    deviceId: v.device_id || "",
  }));

  // Only vehicles with a Device ID streamed from Firebase, shown on the map
  const mapVehicles = firebaseVehicles.filter((v) => v.deviceId && v.deviceId.trim());

  const mappedAlerts = alerts.map((a) => {
    const vObj = vehicles.find((x) => x.id === a.vehicle_id);
    return {
      id: a.id,
      type: a.type,
      severity: a.severity,
      vehicle: vObj ? vObj.number : "Unknown",
      message: a.message,
      time: a.time ? new Date(a.time).toLocaleTimeString() : "1h ago",
      resolved: a.resolved,
    };
  });

  const kpiData = {
    totalVehicles: mappedVehicles.length,
    moving: mapVehicles.filter((v) => v.status === "Moving").length,
    idle: mapVehicles.filter((v) => v.status === "Idle").length,
    parked: mapVehicles.filter((v) => v.status === "Parked").length,
    offline: mapVehicles.filter((v) => v.status === "Offline").length,
    fuelAlerts: mappedAlerts.filter((a) => a.type === "Fuel" && !a.resolved).length,
    maintenanceDue: maintenance.filter((m: any) => m.status !== "Completed").length,
    trackedLive: mapVehicles.length,
  };

  const statusData = [
    { name: "Moving", value: kpiData.moving },
    { name: "Idle", value: kpiData.idle },
    { name: "Parked", value: kpiData.parked },
    { name: "Offline", value: kpiData.offline },
  ];

  return (
    <div>
      <PageHeader
        title="Fleet Operations Overview"
        subtitle={`Live data · ${now.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "medium" })}`}
        actions={
          <Link
            to="/tracking"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 text-sm font-medium hover:bg-primary/90"
          >
            Open live tracking <ArrowUpRight className="h-4 w-4" />
          </Link>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi
          label="Total Vehicles"
          value={kpiData.totalVehicles}
          icon={<Truck className="h-5 w-5" />}
          hint="Live GPS units"
          to="/tracking"
        />
        <Kpi
          label="Currently Moving"
          value={kpiData.moving}
          accent="success"
          icon={<Activity className="h-5 w-5" />}
          hint={`${kpiData.totalVehicles > 0 ? Math.round((kpiData.moving / kpiData.totalVehicles) * 100) : 0}% of fleet`}
          to="/tracking"
        />
        <Kpi
          label="Idle Vehicles"
          value={kpiData.idle}
          accent="warning"
          icon={<Pause className="h-5 w-5" />}
          hint="Engine on, no motion"
          to="/tracking"
        />
        <Kpi
          label="Parked Vehicles"
          value={kpiData.parked}
          icon={<ParkingSquare className="h-5 w-5" />}
          hint="Engine off"
          to="/tracking"
        />
        <Kpi
          label="Fuel Alerts"
          value={kpiData.fuelAlerts}
          accent="destructive"
          icon={<Fuel className="h-5 w-5" />}
          hint="Open issues"
          to="/alerts?type=Fuel"
        />
        <Kpi
          label="Maintenance Due"
          value={kpiData.maintenanceDue}
          accent="warning"
          icon={<Wrench className="h-5 w-5" />}
          hint="Next 30 days"
          to="/maintenance"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-5">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Live Vehicle Map"
              subtitle={
                <div className="flex items-center gap-2">
                  <span>Kanyakumari district · {mapVehicles.length} active GPS devices</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    <Radio className="h-3 w-3 text-amber-500 animate-pulse" />
                    {TELEMETRY_LABEL}
                  </span>
                </div>
              }
              action={
                <Link to="/tracking" className="text-xs font-medium text-primary hover:underline">
                  View full map →
                </Link>
              }
            />
            <div className="p-3">
              <VehicleMap vehicles={mapVehicles} height={420} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Fleet Status" />
            <div className="p-3" style={{ height: 220 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={2}
                  >
                    {statusData.map((d) => (
                      <Cell key={d.name} fill={STATUS_COLORS[d.name]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Daily Fuel Consumption"
          subtitle="Litres consumed across the fleet · from refuel logs"
        />
        <div className="p-3" style={{ height: 260 }}>
          {fuelData.length > 0 ? (
            <ResponsiveContainer>
              <BarChart data={fuelData}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                <XAxis dataKey="day" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Bar dataKey="consumed" fill="oklch(0.45 0.15 255)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
              <Fuel className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No fuel logs yet</p>
              <p className="text-xs text-muted-foreground/60">
                Log fuel refills in the Fuel Intelligence section to see consumption trends.
              </p>
            </div>
          )}
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Fuel Efficiency by Vehicle"
          subtitle="km/L · calculated from fuel purchase logs"
        />
        <div className="p-3" style={{ height: 260 }}>
          {eff.length > 0 ? (
            <ResponsiveContainer>
              <BarChart data={eff}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                <XAxis dataKey="vehicle" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Bar dataKey="kmpl" fill="oklch(0.62 0.18 150)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
              <Sparkles className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No mileage data yet</p>
              <p className="text-xs text-muted-foreground/60">
                Log at least two full-tank fuel refills for a vehicle in Fuel Intelligence to
                calculate verified km/L efficiency.
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

export default DashboardPage;
