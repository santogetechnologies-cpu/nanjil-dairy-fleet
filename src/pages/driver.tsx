import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { VEHICLES, ALERTS, DRIVERS } from "@/lib/mock-data";
import { Truck, Fuel, Thermometer, Gauge, MapPin, Bell, ShieldCheck, Play, LogOut, Activity } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui-kit";
import { useState } from "react";

function DriverPage() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  if (!user) return <Navigate to="/login" />;
  if (user.role !== "driver") return <Navigate to="/dashboard" />;

  // Pick the driver's vehicle
  const driver = DRIVERS.find((d) => d.name === user.name) ?? DRIVERS[0];
  const vehicle = VEHICLES.find((v) => v.driver === driver.name) ?? VEHICLES[0];
  const alerts = ALERTS.filter((a) => a.vehicle === vehicle.number).slice(0, 4);

  const [tripStarted, setTripStarted] = useState(false);

  return (
    <div className="min-h-screen bg-background pb-12">
      <header className="bg-primary text-primary-foreground px-5 py-4 flex items-center gap-3 shadow">
        <div className="bg-white rounded-md p-1.5"><Logo className="h-7" /></div>
        <div className="flex-1 leading-tight">
          <div className="text-xs opacity-80">Welcome back</div>
          <div className="font-semibold">{user.name}</div>
        </div>
        <button onClick={() => { logout(); nav("/login"); }}
          className="p-2 rounded hover:bg-white/10"><LogOut className="h-5 w-5" /></button>
      </header>

      <div className="px-4 max-w-md mx-auto md:max-w-3xl">
        <div className="mt-4">
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-br from-primary to-[oklch(0.22_0.08_240)] text-primary-foreground p-5">
              <div className="flex items-center gap-2">
                <Truck className="h-5 w-5" />
                <div className="text-xs opacity-80">My Vehicle</div>
              </div>
              <div className="text-2xl font-semibold mt-1">{vehicle.number}</div>
              <div className="text-sm opacity-90">{vehicle.type}</div>
              <div className="mt-3"><Badge status={vehicle.status}>{vehicle.status}</Badge></div>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3 text-sm">
              <Stat icon={<Fuel className="h-4 w-4" />} label="Fuel" value={`${vehicle.fuel}%`} />
              <Stat icon={<Gauge className="h-4 w-4" />} label="Speed" value={`${vehicle.speed} km/h`} />
              <Stat icon={<Thermometer className="h-4 w-4" />} label="Temp" value={`${vehicle.temperature}°C`} />
              <Stat icon={<Activity className="h-4 w-4" />} label="Engine" value={vehicle.engineOn ? "ON" : "OFF"} />
            </div>
          </Card>
        </div>

        <Card className="mt-4 p-4">
          <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /><div className="font-medium text-sm">Today's Route</div></div>
          <div className="mt-2 text-sm">{vehicle.route}</div>
          <div className="text-xs text-muted-foreground mt-1">14 collection centres · target completion 11:30</div>
          <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary" style={{ width: tripStarted ? "62%" : "0%", transition: "width 0.6s" }} />
          </div>
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" onClick={() => setTripStarted((v) => !v)}>
              <Play className="h-4 w-4" /> {tripStarted ? "Pause Trip" : "Start Trip"}
            </Button>
            <Button variant="outline" className="flex-1">View Route</Button>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4" /> Safety Score</div>
            <div className="mt-1 text-2xl font-semibold">{driver.score}%</div>
            <div className="text-xs"><Badge status={driver.rating}>{driver.rating}</Badge></div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Bell className="h-4 w-4" /> Open Alerts</div>
            <div className="mt-1 text-2xl font-semibold">{alerts.filter((a) => !a.resolved).length}</div>
            <div className="text-xs text-muted-foreground">{alerts.length} total</div>
          </Card>
        </div>

        <Card className="mt-4">
          <div className="px-4 py-3 border-b border-border font-medium text-sm">Recent Alerts</div>
          <div className="divide-y divide-border">
            {alerts.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted-foreground">No alerts.</div>}
            {alerts.map((a) => (
              <div key={a.id} className="px-4 py-3 flex items-start gap-3">
                <Badge status={a.severity}>{a.severity}</Badge>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{a.message}</div>
                  <div className="text-xs text-muted-foreground">{a.type} · {a.time}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="mt-4 p-4">
          <div className="font-medium text-sm">My Performance</div>
          <div className="grid grid-cols-3 gap-3 mt-3 text-center">
            <div>
              <div className="text-2xl font-semibold">{driver.trips}</div>
              <div className="text-xs text-muted-foreground">Trips</div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{(driver.totalKm / 1000).toFixed(1)}k</div>
              <div className="text-xs text-muted-foreground">km driven</div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{driver.events}</div>
              <div className="text-xs text-muted-foreground">events</div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="mt-0.5 font-semibold">{value}</div>
    </div>
  );
}

export default DriverPage;
