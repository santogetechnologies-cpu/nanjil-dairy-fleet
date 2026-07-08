import { Link, useParams } from "react-router-dom";
import { VEHICLES, speedHistory, fuelHistory, tempHistory } from "@/lib/mock-data";
import { Card, CardHeader, Badge, Button } from "@/components/ui-kit";
import { PageHeader } from "@/components/AppLayout";
import { VehicleMap } from "@/components/VehicleMap";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  ChevronLeft, Truck, Fuel, Thermometer, Gauge, MapPin, Calendar, FileText, Activity,
} from "lucide-react";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { type Vehicle } from "@/lib/mock-data";

function VehicleDetailPage() {
  const { id } = useParams();
  const [v, setV] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('v_vehicles')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (data) {
        setV({
          id: data.id,
          number: data.number,
          type: data.type,
          model: data.model,
          route: data.route || '',
          insuranceExpiry: data.insurance_expiry || '',
          lastService: data.last_service || '',
          nextServiceKm: data.next_service_km || 0,
          odometer: data.odometer || 0,
          engineHours: Number(data.engine_hours || 0),
          status: data.status,
          location: data.location || '',
          lat: Number(data.lat || 0),
          lng: Number(data.lng || 0),
          speed: data.speed || 0,
          fuel: data.fuel || 0,
          temperature: Number(data.temperature || 0),
          humidity: data.humidity || 0,
          engineOn: data.engine_on || false,
          ignition: data.ignition || false,
          driver: data.driver_name || '',
          driverId: data.driver_id || '',
          lastUpdate: data.last_update ? new Date(data.last_update).toLocaleTimeString() : 'sec ago'
        });
      }
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="text-lg font-medium">Loading vehicle details...</div>
      </div>
    );
  }

  if (!v) {
    return (
      <div className="p-8 text-center">
        <div className="text-lg font-medium">Vehicle not found</div>
        <Link to="/vehicles" className="text-primary hover:underline">Back to vehicles</Link>
      </div>
    );
  }

  return (
    <div>
      <Link to="/vehicles" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
        <ChevronLeft className="h-4 w-4" /> Back to vehicles
      </Link>
      <PageHeader
        title={v.number}
        subtitle={`${v.type} · ${v.model}`}
        actions={
          <>
            <Badge status={v.status}>{v.status}</Badge>
            <Button variant="outline" size="sm">Export profile</Button>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={<Gauge className="h-4 w-4" />} label="Current Speed" value={`${v.speed} km/h`} />
        <Stat icon={<Fuel className="h-4 w-4" />} label="Fuel" value={`${v.fuel}%`} />
        <Stat icon={<Thermometer className="h-4 w-4" />} label="Temperature" value={`${v.temperature}°C`} />
        <Stat icon={<Activity className="h-4 w-4" />} label="Engine" value={v.engineOn ? "Running" : "Off"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <Card className="lg:col-span-2">
          <CardHeader title="Live Location" subtitle={v.location} />
          <div className="p-3">
            <VehicleMap vehicles={[v]} height={360} selectedId={v.id} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Vehicle Information" />
          <dl className="px-4 py-3 text-sm grid grid-cols-2 gap-y-3">
            <Field label="Registration" value={v.number} />
            <Field label="Model" value={v.model} />
            <Field label="Driver" value={v.driver} />
            <Field label="Route" value={v.route} />
            <Field label="Insurance" value={v.insuranceExpiry} />
            <Field label="Last Service" value={v.lastService} />
            <Field label="Odometer" value={`${v.odometer.toLocaleString()} km`} />
            <Field label="Engine Hours" value={`${v.engineHours.toLocaleString()} h`} />
            <Field label="Ignition" value={v.ignition ? "ON" : "OFF"} />
            <Field label="Next Service" value={`${v.nextServiceKm} km`} />
          </dl>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card>
          <CardHeader title="Speed History" subtitle="Past 24 hours" />
          <div className="p-3" style={{ height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={speedHistory()}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                <XAxis dataKey="t" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Line type="monotone" dataKey="speed" stroke="oklch(0.45 0.15 255)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Fuel Usage" subtitle="Past 14 days" />
          <div className="p-3" style={{ height: 240 }}>
            <ResponsiveContainer>
              <AreaChart data={fuelHistory()}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Area type="monotone" dataKey="fuel" stroke="oklch(0.62 0.18 150)" fill="oklch(0.62 0.18 150 / 0.25)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Temperature History" subtitle="Past 24 hours · cold-chain compliance window 2°C – 6°C" />
          <div className="p-3" style={{ height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={tempHistory()}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 240)" />
                <XAxis dataKey="t" fontSize={11} />
                <YAxis domain={[0, 10]} fontSize={11} />
                <Tooltip />
                <Line type="monotone" dataKey="temp" stroke="oklch(0.6 0.22 25)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-right">{value}</dd>
    </>
  );
}

export default VehicleDetailPage;
