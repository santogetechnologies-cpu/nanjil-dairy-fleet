import { useState } from "react";
import { type Vehicle, type VehicleStatus } from "@/lib/types";
import { Card, Badge } from "@/components/ui-kit";
import { PageHeader } from "@/components/AppLayout";
import { VehicleMap } from "@/components/VehicleMap";
import { Search, MapPin, Radio } from "lucide-react";
import { usePureFirebaseTracking } from "@/hooks/useFirebaseTracking";

function TrackingPage() {
  const [filter, setFilter] = useState<VehicleStatus | "All">("All");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [routeHistory, setRouteHistory] = useState<Array<{ lat: number; lng: number }>>([]);

  // Stream live vehicle tracking 100% directly and exclusively from Firebase Firestore ("vechile" collection)
  const vehicles = usePureFirebaseTracking();

  function handleSelectVehicle(v: Vehicle) {
    setSelectedId(v.id);

    if (v.lat && v.lng) {
      // Build route path leading from Nanjil Dairy Plant Base Point (8.260765379365829, 77.28837309537465) to current live position
      const startLat = 8.260765379365829;
      const startLng = 77.28837309537465;
      const endLat = v.lat;
      const endLng = v.lng;

      const points = Array.from({ length: 5 }).map((_, idx, arr) => {
        const fraction = (idx + 1) / arr.length;
        return {
          lat: startLat + (endLat - startLat) * fraction,
          lng: startLng + (endLng - startLng) * fraction
        };
      });
      setRouteHistory(points);
    } else {
      setRouteHistory([]);
    }
  }

  // Show ONLY vehicles that have a valid Device ID
  const data = vehicles.filter((v) => {
    if (!v.deviceId || !v.deviceId.trim()) return false;
    if (filter !== "All" && v.status !== filter) return false;
    if (q && !`${v.number} ${v.driver} ${v.location} ${v.deviceId}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const selectedVehicle = vehicles.find(v => v.id === selectedId);

  return (
    <div>
      <PageHeader
        title="Live Vehicle Tracking"
        subtitle={
          <div className="flex items-center gap-2">
            <span>
              {selectedVehicle
                ? `Tracking Route for ${selectedVehicle.number} (${selectedVehicle.driver || 'Driver'})`
                : `Real-time positions · ${vehicles.length} active (Direct Firebase Stream)`}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              <Radio className="h-3 w-3 text-amber-500 animate-pulse" />
              100% Firebase Firestore (vechile)
            </span>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 space-y-3">
          <Card>
            <div className="p-3">
              <VehicleMap
                vehicles={data}
                height={620}
                selectedId={selectedId}
                onSelectVehicle={handleSelectVehicle}
                routeHistory={routeHistory}
              />
            </div>
          </Card>
        </div>

        <div className="space-y-3">
          <Card className="p-3">
            <div className="flex items-center gap-2 px-3 h-9 bg-muted rounded-md mb-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search vehicle, driver, device ID…"
                className="bg-transparent outline-none text-sm w-full"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["All", "Moving", "Idle", "Parked", "Offline"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`px-3 h-8 text-xs rounded-md border transition-colors ${
                    filter === s ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-muted"
                  }`}
                >
                  {s} ({s === "All" ? vehicles.length : vehicles.filter((v) => v.status === s).length})
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <div className="px-3 py-2 border-b border-border text-sm font-medium flex items-center justify-between">
              <span>Firebase Devices ({data.length})</span>
              {selectedId && (
                <button
                  onClick={() => { setSelectedId(undefined); setRouteHistory([]); }}
                  className="text-[11px] text-primary hover:underline"
                >
                  Show All Vehicles
                </button>
              )}
            </div>
            <div className="max-h-[480px] overflow-y-auto divide-y divide-border">
              {data.map((v) => {
                const isSelected = v.id === selectedId;
                return (
                  <div
                    key={v.id}
                    onClick={() => handleSelectVehicle(v)}
                    className={`px-3 py-2.5 cursor-pointer transition-colors ${
                      isSelected ? "bg-primary/10 border-l-4 border-l-primary" : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-400 text-black border border-black/80 font-mono font-black text-xs tracking-wide shadow-xs">
                          <span className="text-[8px] bg-black text-amber-400 px-0.5 rounded-xs font-sans">IND</span>
                          <span>{v.number}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                            v.status === "Moving" ? "bg-success/10 text-success" :
                            v.status === "Idle" ? "bg-warning/15 text-warning-foreground" :
                            v.status === "Parked" ? "bg-muted text-muted-foreground" :
                            "bg-destructive/10 text-destructive"
                          }`}
                        >
                          {v.status}
                        </span>
                      </div>
                    </div>
                    
                    {v.deviceId && (
                      <div className="text-[10px] text-muted-foreground font-mono mt-1 flex items-center gap-1">
                        <Radio className="h-3 w-3 text-emerald-500 animate-pulse" />
                        <span>Device ID: {v.deviceId}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                      <span>{v.driver || 'No Driver'}</span>
                      <span className="flex items-center gap-0.5">
                        <MapPin className="h-3 w-3" /> {v.location || 'Live Location'}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/40 pt-1.5">
                      <span>Speed: {v.speed} km/h • Temp: {v.temperature}°C</span>
                      <span className="text-primary font-medium flex items-center gap-0.5">
                        {isSelected ? "Tracking Active" : "Track Route →"}
                      </span>
                    </div>
                  </div>
                );
              })}
              {data.length === 0 && (
                <div className="p-6 text-center text-xs text-muted-foreground space-y-1">
                  <div className="font-medium text-foreground">No active Firebase devices found</div>
                  <div>Ensure documents exist in Firebase Firestore "vechile" collection.</div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default TrackingPage;
