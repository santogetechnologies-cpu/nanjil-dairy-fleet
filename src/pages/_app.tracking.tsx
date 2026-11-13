import { useState } from "react";
import { Link } from "react-router-dom";
import { type Vehicle, type VehicleStatus } from "@/lib/types";
import { Card } from "@/components/ui-kit";
import { PageHeader } from "@/components/AppLayout";
import { VehicleMap } from "@/components/VehicleMap";
import { Search, MapPin, Radio, AlertTriangle, AlertCircle, Gauge, Clock, Factory, Navigation, Route as RouteIcon } from "lucide-react";
import { useVehicles, TELEMETRY_SOURCE, TELEMETRY_LABEL } from "@/hooks/useVehicleTracking";
import { getOverspeedStatus } from "@/lib/overspeed";
import { useOverspeedMonitor } from "@/hooks/useOverspeed";
import { useTodayTravelledRoutes } from "@/hooks/useTodayTravelledRoutes";
import { useOdometerTracking } from "@/hooks/useOdometerTracking";

function formatLastUpdated(isoString?: string): string {
  if (!isoString) return "Just now";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "Just now";
    return d.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return "Just now";
  }
}

function formatTripStartTime(isoString?: string): string {
  if (!isoString) return "Early Morning";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "Early Morning";
    return d.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "Early Morning";
  }
}

function TrackingPage() {
  const [filter, setFilter] = useState<VehicleStatus | "All">("All");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [routeHistory, setRouteHistory] = useState<Array<{ lat: number; lng: number }>>([]);

  // Stream live vehicle tracking from the configured telemetry source.
  // Source is controlled by VITE_TELEMETRY_SOURCE ("firebase" | "supabase").
  const vehicles = useVehicles();

  // Load and stream today's actual GPS travelled route for each vehicle (Asia/Kolkata timezone)
  const { routes: todayRoutes, tripStartTimes } = useTodayTravelledRoutes(vehicles);

  // Real-time overspeed detection, transition tracking, and alert persistence
  const { activeWarnings, activeCriticals } = useOverspeedMonitor(vehicles);

  // Real-time cumulative odometer and daily distance tracking engine
  const { getVehicleOdometer, odometerStates } = useOdometerTracking(vehicles);

  function handleSelectVehicle(v: Vehicle) {
    setSelectedId(v.id);
    setRouteHistory([]);
  }

  // Show ONLY vehicles that have a valid Device ID
  const data = vehicles.filter((v) => {
    if (!v.deviceId || !v.deviceId.trim()) return false;
    if (filter !== "All" && v.status !== filter) return false;
    if (
      q &&
      !`${v.number} ${v.driver} ${v.location} ${v.deviceId}`.toLowerCase().includes(q.toLowerCase())
    )
      return false;
    return true;
  });

  const selectedVehicle = vehicles.find((v) => v.id === selectedId);
  const selectedOdo = selectedVehicle ? getVehicleOdometer(selectedVehicle.id) : null;

  // Source-aware badge colour: amber for Firebase, emerald for EMQX/Supabase
  const badgeClass =
    TELEMETRY_SOURCE === "supabase"
      ? "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
      : "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20";

  const pulseClass =
    TELEMETRY_SOURCE === "supabase"
      ? "h-3 w-3 text-emerald-500 animate-pulse"
      : "h-3 w-3 text-amber-500 animate-pulse";

  // Empty-state hint text
  const emptyHint =
    TELEMETRY_SOURCE === "supabase"
      ? "Ensure the vehicle has a Device ID and EMQX is publishing to fleet/vehicle/{device_id}/telemetry."
      : 'Ensure documents exist in Firebase Firestore "vechile" collection.';

  const emptyLabel =
    TELEMETRY_SOURCE === "supabase"
      ? "No active EMQX devices found"
      : "No active Firebase devices found";

  // Device list panel heading
  const deviceListLabel = TELEMETRY_SOURCE === "supabase" ? "EMQX Devices" : "Firebase Devices";

  return (
    <div>
      <PageHeader
        title="Live Vehicle Tracking"
        subtitle={
          <div className="flex items-center gap-2 flex-wrap">
            <span>
              {selectedVehicle && selectedOdo
                ? `Tracking Route for ${selectedVehicle.number} (${selectedVehicle.driver || "Driver"}) · Odometer: ${selectedOdo.totalOdometerKm.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km (Today: ${selectedOdo.todayDistanceKm.toFixed(1)} km)`
                : `Real-time positions · ${vehicles.length} active`}
            </span>
            <span className={badgeClass}>
              <Radio className={pulseClass} />
              {TELEMETRY_LABEL}
            </span>
          </div>
        }
      />

      {/* Page-level live overspeed warning banner */}
      {(activeWarnings.length > 0 || activeCriticals.length > 0) && (
        <div
          className={`mb-4 px-4 py-2.5 rounded-xl border flex items-center justify-between gap-3 text-xs sm:text-sm font-medium transition-all shadow-xs ${
            activeCriticals.length > 0
              ? "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300"
              : "bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-300"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {activeCriticals.length > 0 ? (
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 animate-pulse" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0 animate-pulse" />
            )}
            <span className="truncate">
              {activeCriticals.length > 0 ? (
                <>
                  <strong>Critical Overspeed (≥75 km/h):</strong>{" "}
                  {activeCriticals.map((v) => `${v.number} (${v.speed} km/h)`).join(", ")}
                </>
              ) : (
                <>
                  <strong>Speeding Warning (&gt;60 km/h):</strong>{" "}
                  {activeWarnings.map((v) => `${v.number} (${v.speed} km/h)`).join(", ")}
                </>
              )}
            </span>
          </div>
          <div className="text-[11px] opacity-75 shrink-0 hidden md:block font-mono">
            Safety Policy · 60 km/h Baseline
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_310px] xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
        <div className="min-w-0 space-y-3">
          {/* Selected Vehicle Route Intelligence Panel */}
          {selectedVehicle && (
            <Card className="p-3.5 bg-card/95 border-primary/30 shadow-xs">
              <div className="flex items-center justify-between gap-3 mb-2.5 pb-2 border-b border-border flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-amber-400 text-black border border-black/80 font-mono font-black text-xs tracking-wider shadow-xs">
                    <span className="text-[8px] font-sans font-bold bg-black text-amber-400 px-1 py-0.2 rounded-xs leading-none">
                      IND
                    </span>
                    <span>{selectedVehicle.number}</span>
                  </div>
                  <span className="text-xs font-semibold text-foreground">
                    {selectedVehicle.driver ? `Driver: ${selectedVehicle.driver}` : "Unassigned Driver"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · {selectedVehicle.model || selectedVehicle.type}
                  </span>
                  <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                    <RouteIcon className="h-3 w-3" />
                    <span>Nanjil Plant Anchored Route</span>
                  </span>
                </div>
                <button
                  onClick={() => setSelectedId(undefined)}
                  className="text-xs text-primary hover:underline font-medium shrink-0 cursor-pointer"
                >
                  Show All Routes
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 text-xs">
                <div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Factory className="h-3 w-3 text-emerald-600" />
                    <span>Starting Point</span>
                  </div>
                  <div className="font-semibold text-foreground truncate mt-0.5" title="Nanjil Central Processing Plant, Mulagumoodu">
                    Nanjil Dairy Plant
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3 text-red-500" />
                    <span>Current Location</span>
                  </div>
                  <div className="font-semibold text-foreground truncate mt-0.5" title={selectedVehicle.location || "Live Location"}>
                    {selectedVehicle.location || "Live Location"}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Gauge className="h-3 w-3 text-blue-500" />
                    <span>Total Distance</span>
                  </div>
                  <div className="font-mono font-bold text-foreground mt-0.5">
                    {selectedOdo ? `${selectedOdo.todayDistanceKm.toFixed(1)} km` : "0.0 km"}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Navigation className="h-3 w-3 text-amber-500" />
                    <span>Current Speed</span>
                  </div>
                  <div className="font-mono font-bold text-foreground mt-0.5">
                    {selectedVehicle.speed} km/h
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3 text-purple-500" />
                    <span>Trip Start Time</span>
                  </div>
                  <div className="font-mono font-medium text-foreground mt-0.5">
                    {formatTripStartTime(tripStartTimes[selectedVehicle.id] || tripStartTimes[selectedVehicle.deviceId || ""])}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Radio className="h-3 w-3 text-emerald-500 animate-pulse" />
                    <span>Last GPS Update</span>
                  </div>
                  <div className="font-mono font-medium text-foreground mt-0.5">
                    {formatLastUpdated(selectedVehicle.lastUpdate)}
                  </div>
                </div>
              </div>
            </Card>
          )}

          <Card>
            <div className="p-3">
              <VehicleMap
                vehicles={data}
                height={725}
                selectedId={selectedId}
                onSelectVehicle={handleSelectVehicle}
                routeHistory={routeHistory}
                todayRoutes={todayRoutes}
                tripStartTimes={tripStartTimes}
                odometerStates={odometerStates}
                getVehicleOdometer={getVehicleOdometer}
              />
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-3">
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
                  className={`px-2.5 h-8 text-xs rounded-md border transition-colors truncate ${
                    filter === s
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border hover:bg-muted"
                  }`}
                >
                  {s} (
                  {s === "All" ? vehicles.length : vehicles.filter((v) => v.status === s).length})
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <div className="px-3 py-2 border-b border-border text-sm font-medium flex items-center justify-between">
              <span>
                {deviceListLabel} ({data.length})
              </span>
              {selectedId && (
                <button
                  onClick={() => {
                    setSelectedId(undefined);
                    setRouteHistory([]);
                  }}
                  className="text-[11px] text-primary hover:underline"
                >
                  Show All Vehicles
                </button>
              )}
            </div>
            <div className="max-h-[555px] overflow-y-auto divide-y divide-border">
              {data.map((v) => {
                const isSelected = v.id === selectedId;
                const overspeed = getOverspeedStatus(v.speed);
                const odo = getVehicleOdometer(v.id || v.deviceId);

                return (
                  <div
                    key={v.id}
                    onClick={() => handleSelectVehicle(v)}
                    className={`px-3 py-2.5 cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-primary/10 border-l-4 border-l-primary"
                        : overspeed.level === "critical"
                          ? "bg-red-500/5 hover:bg-red-500/10 border-l-4 border-l-red-500"
                          : overspeed.level === "warning"
                            ? "bg-orange-500/5 hover:bg-orange-500/10 border-l-4 border-l-orange-500"
                            : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-400 text-black border border-black/80 font-mono font-black text-xs tracking-wide shadow-xs">
                          <span className="text-[8px] bg-black text-amber-400 px-0.5 rounded-xs font-sans">
                            IND
                          </span>
                          <span>{v.number}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                            v.status === "Moving"
                              ? "bg-success/10 text-success"
                              : v.status === "Idle"
                                ? "bg-warning/15 text-warning-foreground"
                                : v.status === "Parked"
                                  ? "bg-muted text-muted-foreground"
                                  : "bg-destructive/10 text-destructive"
                          }`}
                        >
                          {v.status}
                        </span>
                        {overspeed.level === "warning" && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/30 animate-pulse">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            <span>Overspeed Warning</span>
                          </span>
                        )}
                        {overspeed.level === "critical" && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/40 animate-pulse">
                            <AlertCircle className="h-3 w-3 shrink-0" />
                            <span>Critical Overspeed</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {v.deviceId && (
                      <div className="text-[10px] text-muted-foreground font-mono mt-1 flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <Radio className="h-3 w-3 text-emerald-500 animate-pulse" />
                          <span>Device ID: {v.deviceId}</span>
                        </span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-sans">
                          {v.lastUpdate ? "Transmitting" : "Live"}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                      <span>{v.driver || "Unassigned"}</span>
                      <span className="flex items-center gap-0.5 truncate max-w-[130px]">
                        <MapPin className="h-3 w-3 shrink-0" /> {v.location || "Live Location"}
                      </span>
                    </div>

                    {/* Live Odometer Intelligence Card */}
                    <div className="mt-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800">
                      <div className="flex items-center justify-between gap-1.5 mb-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Gauge className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                            Odometer
                          </span>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[9px] font-semibold border ${
                              odo.readingSource === "hardware"
                                ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                            }`}
                          >
                            {odo.readingSource === "hardware" ? "Hardware" : "GPS Estimated"}
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono font-bold text-xs text-foreground">
                            {odo.totalOdometerKm.toLocaleString("en-IN", {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 1,
                            })}{" "}
                            <span className="text-[10px] font-normal text-muted-foreground">km</span>
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-1.5 pt-1.5 border-t border-slate-200/60 dark:border-slate-800 text-[10px]">
                        <div>
                          <div className="text-muted-foreground text-[9px]">Today</div>
                          <div className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                            {odo.todayDistanceKm.toFixed(1)} km
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-[9px]">Current Trip</div>
                          <div className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                            {odo.currentTripDistanceKm.toFixed(1)} km
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-[9px]">Speed / Status</div>
                          <div className="font-mono font-semibold flex items-center gap-1">
                            <span
                              className={
                                odo.isMoving
                                  ? overspeed.level === "critical"
                                    ? "text-red-600 font-bold"
                                    : overspeed.level === "warning"
                                      ? "text-orange-600 font-semibold"
                                      : "text-emerald-600 font-bold"
                                  : "text-slate-500"
                              }
                            >
                              {v.speed} km/h
                            </span>
                            {odo.isMoving ? (
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" title="Accruing distance" />
                            ) : (
                              <span className="text-[8px] text-muted-foreground font-sans">Frozen</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mt-1.5 flex items-center justify-between text-[9px] text-muted-foreground pt-1 border-t border-slate-200/40 dark:border-slate-800/40">
                        <span className="flex items-center gap-1 truncate">
                          <Clock className="h-2.5 w-2.5 shrink-0" />
                          <span>Updated: {formatLastUpdated(v.lastUpdate || odo.lastUpdated)}</span>
                        </span>
                        {odo.isMoving ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium shrink-0">Accruing distance</span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500 shrink-0">Drift filtered (Idle)</span>
                        )}
                      </div>
                    </div>

                    {isSelected && (
                      <div className="mt-2.5 pt-2 border-t border-slate-200/80 flex items-center gap-1.5 text-[11px]">
                        <Link
                          to={`/trips?vehicle=${v.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 text-center py-1 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-semibold"
                        >
                          Trip History
                        </Link>
                        <Link
                          to={`/routes?vehicle=${v.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 text-center py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 font-medium"
                        >
                          Route Planner
                        </Link>
                        <Link
                          to={`/vehicles/${v.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200"
                          title="Vehicle Profile"
                        >
                          Profile
                        </Link>
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between flex-wrap gap-y-1 text-[11px] text-muted-foreground border-t border-border/40 pt-1.5">
                      <span className="truncate mr-1">
                        Speed:{" "}
                        <span
                          className={
                            overspeed.level === "critical"
                              ? "text-red-600 font-bold"
                              : overspeed.level === "warning"
                                ? "text-orange-600 font-semibold"
                                : "text-foreground font-medium"
                          }
                        >
                          {v.speed} km/h
                        </span>
                        {" "}• Avg: {v.averageSpeed != null && v.averageSpeed > 0 ? `${v.averageSpeed.toFixed(1)} km/h` : "—"} • Fuel: {v.fuel}%
                      </span>
                      <span className="text-primary font-medium flex items-center gap-0.5 shrink-0">
                        {isSelected ? "Tracking Active" : "Track Route →"}
                      </span>
                    </div>
                  </div>
                );
              })}
              {data.length === 0 && (
                <div className="p-6 text-center text-xs text-muted-foreground space-y-1">
                  <div className="font-medium text-foreground">{emptyLabel}</div>
                  <div>{emptyHint}</div>
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
