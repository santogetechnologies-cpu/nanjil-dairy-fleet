import { Navigate, useNavigate } from "react-router-dom";
import { useAuth, REDIRECT_MAP } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { Truck, Fuel, Thermometer, Gauge, MapPin, Bell, ShieldCheck, Play, LogOut, Activity } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui-kit";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

function DriverPage() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [driver, setDriver] = useState<any>(null);
  const [vehicle, setVehicle] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tripStarted, setTripStarted] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) return;
      
      // Get driver record
      const { data: dData } = await supabase
        .from('drivers')
        .select('*')
        .eq('name', user.name)
        .maybeSingle();

      if (!active) return;

      const resolvedDriver = dData || { name: user.name, score: 0, rating: "Poor", trips: 0, total_km: 0, events: 0 };
      setDriver(resolvedDriver);

      // Check current session validity
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !active) return;

      // Get assigned vehicle via view
      const { data: vData } = await supabase
        .from('v_vehicles')
        .select('*')
        .eq('driver_name', resolvedDriver.name)
        .maybeSingle();

      if (!active) return;

      const resolvedVehicle = vData ? {
        id: vData.id,
        number: vData.number,
        type: vData.type,
        model: vData.model,
        route: vData.route || '',
        insuranceExpiry: vData.insurance_expiry || '',
        lastService: vData.last_service || '',
        nextServiceKm: vData.next_service_km || 0,
        odometer: vData.odometer || 0,
        engineHours: Number(vData.engine_hours || 0),
        status: vData.status,
        location: vData.location || '',
        lat: Number(vData.lat || 0),
        lng: Number(vData.lng || 0),
        speed: vData.speed || 0,
        fuel: vData.fuel || 0,
        temperature: Number(vData.temperature || 0),
        humidity: vData.humidity || 0,
        engineOn: vData.engine_on || false,
        ignition: vData.ignition || false,
        driver: vData.driver_name || '',
        driverId: vData.driver_id || '',
        lastUpdate: vData.last_update ? new Date(vData.last_update).toLocaleTimeString() : 'sec ago'
      } : { 
        number: "Unassigned", 
        type: "No Assigned Vehicle", 
        status: "Offline", 
        fuel: 0, 
        speed: 0, 
        temperature: 0, 
        engineOn: false, 
        route: "No route assigned" 
      };
      setVehicle(resolvedVehicle);

      // Get alerts
      if (vData?.id) {
        const { data: { session: alertSession } } = await supabase.auth.getSession();
        if (!alertSession || !active) return;

        const { data: aData } = await supabase
          .from('alerts')
          .select('*')
          .eq('vehicle_id', vData.id)
          .limit(4);

        if (aData && active) {
          setAlerts(aData.map(a => ({
            id: a.id,
            severity: a.severity,
            message: a.message,
            type: a.type,
            time: a.time ? new Date(a.time).toLocaleTimeString() : '1h ago',
            resolved: a.resolved
          })));
        }
      }
      if (active) setLoading(false);
    }
    load();
    return () => {
      active = false;
    };
  }, [user]);

  if (!user) return <Navigate to="/login" />;
  if (REDIRECT_MAP[user.role] !== "/driver") return <Navigate to={REDIRECT_MAP[user.role]} />;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-lg font-medium">Loading driver portal...</div>
      </div>
    );
  }

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
          <div className="text-xs text-muted-foreground mt-1">
            {vehicle.route && vehicle.route !== "No route assigned" ? "Active collection loop in progress." : "No route loop currently active."}
          </div>
          <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary" style={{ width: tripStarted ? "100%" : "0%", transition: "width 0.6s" }} />
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
              <div className="text-2xl font-semibold">{(driver.total_km / 1000).toFixed(1)}k</div>
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
