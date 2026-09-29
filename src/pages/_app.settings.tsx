
import { useState, useEffect } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Card, CardHeader, Button } from "@/components/ui-kit";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

function Page() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState({
    notifications: true,
    sms: false,
    geofence: true,
    overspeed: 60,
    coldMin: 2,
    coldMax: 6,
    fuelAlert: 25,
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      const savedLocal = localStorage.getItem('nanjil_settings_prefs');
      if (savedLocal) {
        try {
          setPrefs(JSON.parse(savedLocal));
        } catch (e) {
          // ignore parse error
        }
      }

      const isUUID = !!user?.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id);
      if (isUUID) {
        try {
          const { data } = await supabase
            .from('settings')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();
          if (data) {
            const loadedPrefs = {
              notifications: data.notifications,
              sms: data.sms,
              geofence: data.geofence,
              overspeed: data.overspeed,
              coldMin: data.cold_min,
              coldMax: data.cold_max,
              fuelAlert: data.fuel_alert,
            };
            setPrefs(loadedPrefs);
            localStorage.setItem('nanjil_settings_prefs', JSON.stringify(loadedPrefs));
          }
        } catch (err) {
          // ignore DB load error
        }
      }
    }
    load();
  }, [user]);

  async function save() {
    localStorage.setItem('nanjil_settings_prefs', JSON.stringify(prefs));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);

    const isUUID = !!user?.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id);
    if (isUUID) {
      try {
        await supabase.from('settings').upsert({
          user_id: user.id,
          notifications: prefs.notifications,
          sms: prefs.sms,
          geofence: prefs.geofence,
          overspeed: prefs.overspeed,
          cold_min: prefs.coldMin,
          cold_max: prefs.coldMax,
          fuel_alert: prefs.fuelAlert,
        });
      } catch (err) {
        // ignore DB save error
      }
    }
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Account, notifications and platform preferences" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Profile" />
          <div className="p-4 space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{user?.name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span className="font-medium">{user?.email}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Role</span><span className="font-medium capitalize">{user?.role}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Organisation</span><span className="font-medium">Nanjil Integrated Dairy Development</span></div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Notifications" />
          <div className="p-4 space-y-3 text-sm">
            <Toggle label="Email notifications" value={prefs.notifications}
              onChange={(v) => setPrefs({ ...prefs, notifications: v })} />
            <Toggle label="SMS alerts for high-severity events" value={prefs.sms}
              onChange={(v) => setPrefs({ ...prefs, sms: v })} />
            <Toggle label="Geofence alerts" value={prefs.geofence}
              onChange={(v) => setPrefs({ ...prefs, geofence: v })} />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Alert Thresholds" subtitle="Adjust when alerts are triggered" />
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Overspeed threshold" suffix="km/h" value={prefs.overspeed}
              onChange={(v) => setPrefs({ ...prefs, overspeed: v })} />
            <Field label="Low fuel alert" suffix="%" value={prefs.fuelAlert}
              onChange={(v) => setPrefs({ ...prefs, fuelAlert: v })} />
          </div>
        </Card>

        {user?.role === "admin" && (
          <Card className="lg:col-span-2">
            <CardHeader title="ESP32 IoT Hardware Integration" subtitle="Configure microcontroller telemetry ingest" />
            <div className="p-4 space-y-4 text-sm">
              <div className="bg-muted/40 rounded-lg p-3 border border-border">
                <div className="font-semibold text-primary">Microcontroller Telemetry Ingest Guidelines</div>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  Your ESP32 IoT boards can publish telemetry logs directly to the Supabase REST endpoint.
                  Map each ESP32 board to a specific vehicle using its unique <strong>vehicle_id</strong>.
                </p>
              </div>

              <div>
                <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Ingest API Endpoint (HTTP PATCH)</span>
                <div className="p-2.5 bg-muted rounded border border-border font-mono text-xs overflow-x-auto whitespace-nowrap">
                  https://lorxcxmwmxsesuqyzxih.supabase.co/rest/v1/vehicle_telemetry?vehicle_id=eq.&lt;vehicle_uuid&gt;
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">JSON Payload Structure (Documentation Reference Only)</span>
                  <pre className="p-3 bg-muted rounded border border-border font-mono text-xs text-foreground overflow-x-auto h-48">
{`{
  "status": "Moving",
  "lat": 0.000000,
  "lng": 0.000000,
  "speed": 0,
  "fuel": 0,
  "temperature": 0.0,
  "humidity": 0,
  "engine_on": true,
  "ignition": true,
  "device_id": "DEVICE_IMEI_OR_ID"
}`}
                  </pre>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Arduino C++ Code Snippet (Documentation Reference Only)</span>
                  <pre className="p-3 bg-muted rounded border border-border font-mono text-xs text-foreground overflow-x-auto h-48">
{`#include <WiFi.h>
#include <HTTPClient.h>
 
void postTelemetry() {
  HTTPClient http;
  String url = "https://lorxcxmwmxsesuqyzxih.supabase.co/rest/v1/vehicle_telemetry?vehicle_id=eq.VEHICLE_UUID";
  
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", "YOUR_SUPABASE_ANON_KEY");
  http.addHeader("Authorization", "Bearer YOUR_SUPABASE_ANON_KEY");
  
  String payload = "{\\"status\\":\\"Moving\\",\\"lat\\":0.0000,\\"lng\\":0.0000,\\"speed\\":0,\\"fuel\\":0,\\"temperature\\":0.0,\\"humidity\\":0,\\"device_id\\":\\"DEVICE_IMEI_OR_ID\\"}";
  int httpResponseCode = http.PATCH(payload);
  http.end();
}`}
                  </pre>
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save}>Save changes</Button>
        {saved && <span className="text-sm text-success">Settings saved.</span>}
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className="flex items-center justify-between w-full">
      <span>{label}</span>
      <span className={`relative inline-block w-10 h-6 rounded-full transition-colors ${value ? "bg-primary" : "bg-muted"}`}>
        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${value ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}

function Field({ label, value, suffix, onChange }: { label: string; value: number; suffix: string; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <div className="mt-1 flex items-center gap-2 h-10 px-3 border border-border rounded-md bg-card">
        <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))}
          className="bg-transparent outline-none text-sm w-full" />
        <span className="text-xs text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}

export default Page;
