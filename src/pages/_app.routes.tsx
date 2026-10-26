import { useState, useEffect, useMemo, useRef } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Badge, Button, Card, CardHeader } from "@/components/ui-kit";
import {
  Route as RouteIcon,
  MapPin,
  Plus,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  Upload,
  Save,
  FolderOpen,
  RotateCcw,
  Navigation,
  Clock,
  Gauge,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  Layers,
  ChevronRight,
  Eye,
  Loader2,
  FileSpreadsheet,
  X,
  Search,
} from "lucide-react";
import Map, { Marker, Source, Layer, NavigationControl, MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useVehicles } from "@/hooks/useVehicleTracking";
import {
  calculateRoadRoute,
  calculateRouteDeviationMeters,
  formatDurationMins,
  type RoutePoint,
  type RoadRoutingResult,
} from "@/lib/roadRouting";
import {
  NANJIL_DAIRY_DEPOT,
  PRESET_DAIRY_CENTRES,
  DEFAULT_ROUTE_TEMPLATES,
  type RouteTemplate,
} from "@/lib/routeTemplates";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

export default function RoutesPlannerPage() {
  const { user } = useAuth();
  const mapRef = useRef<MapRef>(null);
  const liveVehicles = useVehicles();

  // Mode: "planner" (designing route) or "execution" (tracking active route)
  const [activeTab, setActiveTab] = useState<"planner" | "saved" | "execution">("planner");

  // Core Route Details
  const [routeName, setRouteName] = useState("Daily Morning Milk Collection Loop");
  const [routeDate, setRouteDate] = useState(new Date().toISOString().split("T")[0]);
  const [departureTime, setDepartureTime] = useState("05:30");
  const [assignedVehicleId, setAssignedVehicleId] = useState("");
  const [assignedDriverId, setAssignedDriverId] = useState("");

  // Start & End
  const [startPoint, setStartPoint] = useState(NANJIL_DAIRY_DEPOT);
  const [destinationPoint, setDestinationPoint] = useState(PRESET_DAIRY_CENTRES[7]); // Kanyakumari South

  // Round Trip Configuration
  const [roundTripType, setRoundTripType] = useState<"same_path" | "different_path" | "one_way">("same_path");
  const [revisitStopsOnReturn, setRevisitStopsOnReturn] = useState(false);

  // Stop Sequences (Supports 40+ stops)
  const [outboundStops, setOutboundStops] = useState<RoutePoint[]>(
    PRESET_DAIRY_CENTRES.slice(0, 15).map((c, i) => ({
      id: `out-${i + 1}`,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      serviceDurationMins: 5,
      isMandatory: true,
      status: "Pending",
    }))
  );

  const [returnStops, setReturnStops] = useState<RoutePoint[]>([
    {
      id: "ret-1",
      name: PRESET_DAIRY_CENTRES[18].name,
      lat: PRESET_DAIRY_CENTRES[18].lat,
      lng: PRESET_DAIRY_CENTRES[18].lng,
      serviceDurationMins: 5,
      isMandatory: false,
      status: "Pending",
    },
    {
      id: "ret-2",
      name: PRESET_DAIRY_CENTRES[13].name,
      lat: PRESET_DAIRY_CENTRES[13].lat,
      lng: PRESET_DAIRY_CENTRES[13].lng,
      serviceDurationMins: 5,
      isMandatory: false,
      status: "Pending",
    },
  ]);

  // Route-Specific Settings
  const [speedLimitKmh, setSpeedLimitKmh] = useState(60);
  const [deviationThresholdMeters, setDeviationThresholdMeters] = useState(250);
  const [alertOnMissedStops, setAlertOnMissedStops] = useState(true);
  const [alertOnDelay, setAlertOnDelay] = useState(true);
  const [routeNotes, setRouteNotes] = useState("Maintain refrigerated tanker temp at 4°C. Check seals at each depot.");

  // Calculated Road Network Paths
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const [outboundRoadResult, setOutboundRoadResult] = useState<RoadRoutingResult | null>(null);
  const [returnRoadResult, setReturnRoadResult] = useState<RoadRoutingResult | null>(null);

  // Database & Resources
  const [dbVehicles, setDbVehicles] = useState<any[]>([]);
  const [dbDrivers, setDbDrivers] = useState<any[]>([]);
  const [savedRoutes, setSavedRoutes] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Address search query
  const [searchLocationQuery, setSearchLocationQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);

  // Selected stop on map
  const [activeStopId, setActiveStopId] = useState<string | null>(null);

  // Load vehicles, drivers, and saved routes
  useEffect(() => {
    async function loadData() {
      const [vRes, dRes, rRes] = await Promise.all([
        supabase.from("vehicles").select("id, number, type, model"),
        supabase.from("drivers").select("id, name, phone"),
        supabase.from("collection_routes").select("*").order("created_at", { ascending: false }),
      ]);

      if (vRes.data && vRes.data.length > 0) {
        setDbVehicles(vRes.data);
        if (!assignedVehicleId) setAssignedVehicleId(vRes.data[0].id);
      }
      if (dRes.data && dRes.data.length > 0) {
        const uniqueDrivers = new Map();
        dRes.data.forEach((d) => {
          if (!uniqueDrivers.has(d.name)) uniqueDrivers.set(d.name, d);
        });
        const dList = Array.from(uniqueDrivers.values());
        setDbDrivers(dList);
        if (!assignedDriverId && dList.length > 0) setAssignedDriverId(dList[0].id);
      }
      if (rRes.data) {
        setSavedRoutes(rRes.data);
      }
    }
    loadData();
  }, []);

  // Compute road routing when waypoints or round-trip settings change
  useEffect(() => {
    let isCancelled = false;

    async function computeRoutes() {
      setIsCalculatingRoute(true);
      try {
        // 1. Build Outbound Points: Start -> Outbound Stops -> Destination
        const outPoints = [
          startPoint,
          ...outboundStops.map((s) => ({ lat: s.lat, lng: s.lng })),
          destinationPoint,
        ];
        const outRes = await calculateRoadRoute(outPoints);
        if (isCancelled) return;
        setOutboundRoadResult(outRes);

        // 2. Build Return Points if applicable
        if (roundTripType === "same_path") {
          // Same path in reverse
          const retPoints = revisitStopsOnReturn
            ? [
                destinationPoint,
                ...[...outboundStops].reverse().map((s) => ({ lat: s.lat, lng: s.lng })),
                startPoint,
              ]
            : [destinationPoint, startPoint];

          const retRes = await calculateRoadRoute(retPoints);
          if (isCancelled) return;
          setReturnRoadResult(retRes);
        } else if (roundTripType === "different_path") {
          // Different path via independent return stops
          const retPoints = [
            destinationPoint,
            ...returnStops.map((s) => ({ lat: s.lat, lng: s.lng })),
            startPoint,
          ];
          const retRes = await calculateRoadRoute(retPoints);
          if (isCancelled) return;
          setReturnRoadResult(retRes);
        } else {
          setReturnRoadResult(null);
        }
      } catch (err) {
        console.warn("Road routing calculation error:", err);
      } finally {
        if (!isCancelled) setIsCalculatingRoute(false);
      }
    }

    computeRoutes();

    return () => {
      isCancelled = true;
    };
  }, [
    startPoint,
    destinationPoint,
    outboundStops,
    returnStops,
    roundTripType,
    revisitStopsOnReturn,
  ]);

  // Aggregated Summary Statistics
  const routeStats = useMemo(() => {
    const outDist = outboundRoadResult?.distanceKm || 0;
    const outDriveMins = outboundRoadResult?.durationMins || 0;
    const outServiceMins = outboundStops.reduce((sum, s) => sum + (s.serviceDurationMins || 0), 0);

    const retDist = roundTripType !== "one_way" ? returnRoadResult?.distanceKm || 0 : 0;
    const retDriveMins = roundTripType !== "one_way" ? returnRoadResult?.durationMins || 0 : 0;
    const retServiceMins =
      roundTripType === "different_path"
        ? returnStops.reduce((sum, s) => sum + (s.serviceDurationMins || 0), 0)
        : revisitStopsOnReturn
        ? outServiceMins
        : 0;

    const totalDist = Math.round((outDist + retDist) * 10) / 10;
    const totalDurationMins = outDriveMins + outServiceMins + retDriveMins + retServiceMins;
    const totalStopsCount =
      outboundStops.length +
      (roundTripType === "different_path"
        ? returnStops.length
        : revisitStopsOnReturn
        ? outboundStops.length
        : 0);

    // Compute expected completion timestamp
    const [depH, depM] = departureTime.split(":").map(Number);
    const startDate = new Date();
    startDate.setHours(depH || 5, depM || 30, 0, 0);
    const endDate = new Date(startDate.getTime() + totalDurationMins * 60 * 1000);
    const completionTimeStr = endDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    return {
      outboundDistanceKm: outDist,
      outboundDurationMins: outDriveMins + outServiceMins,
      returnDistanceKm: retDist,
      returnDurationMins: retDriveMins + retServiceMins,
      totalDistanceKm: totalDist,
      totalDurationMins,
      totalStopsCount,
      completionTimeStr,
      mandatoryStopsCount: outboundStops.filter((s) => s.isMandatory).length,
    };
  }, [
    outboundRoadResult,
    returnRoadResult,
    outboundStops,
    returnStops,
    roundTripType,
    revisitStopsOnReturn,
    departureTime,
  ]);

  // GeoJSON features for MapLibre
  const outboundGeoJson = useMemo(() => {
    if (!outboundRoadResult?.coordinates?.length) return null;
    return {
      type: "Feature" as const,
      properties: { type: "outbound" },
      geometry: {
        type: "LineString" as const,
        coordinates: outboundRoadResult.coordinates,
      },
    };
  }, [outboundRoadResult]);

  const returnGeoJson = useMemo(() => {
    if (!returnRoadResult?.coordinates?.length || roundTripType === "one_way") return null;
    return {
      type: "Feature" as const,
      properties: { type: "return" },
      geometry: {
        type: "LineString" as const,
        coordinates: returnRoadResult.coordinates,
      },
    };
  }, [returnRoadResult, roundTripType]);

  // Handle map click to add a stop
  function handleMapClick(e: { lngLat: { lng: number; lat: number } }) {
    const newStop: RoutePoint = {
      id: `stop-${Date.now()}`,
      name: `Custom Waypoint (${e.lngLat.lat.toFixed(4)}, ${e.lngLat.lng.toFixed(4)})`,
      lat: e.lngLat.lat,
      lng: e.lngLat.lng,
      serviceDurationMins: 5,
      isMandatory: true,
      status: "Pending",
    };
    setOutboundStops((prev) => [...prev, newStop]);
    showToast(`Added stop #${outboundStops.length + 1} at coordinates`);
  }

  // Stop sequence manipulation functions
  function moveStop(index: number, direction: "up" | "down", isReturn = false) {
    const list = isReturn ? [...returnStops] : [...outboundStops];
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const temp = list[index];
    list[index] = list[targetIdx];
    list[targetIdx] = temp;
    if (isReturn) setReturnStops(list);
    else setOutboundStops(list);
  }

  function deleteStop(id: string, isReturn = false) {
    if (isReturn) setReturnStops((prev) => prev.filter((s) => s.id !== id));
    else setOutboundStops((prev) => prev.filter((s) => s.id !== id));
  }

  function duplicateStop(stop: RoutePoint, isReturn = false) {
    const copy: RoutePoint = {
      ...stop,
      id: `copy-${Date.now()}`,
      name: `${stop.name} (Copy)`,
    };
    if (isReturn) setReturnStops((prev) => [...prev, copy]);
    else setOutboundStops((prev) => [...prev, copy]);
  }

  function toggleStopMandatory(id: string, isReturn = false) {
    if (isReturn) {
      setReturnStops((prev) =>
        prev.map((s) => (s.id === id ? { ...s, isMandatory: !s.isMandatory } : s))
      );
    } else {
      setOutboundStops((prev) =>
        prev.map((s) => (s.id === id ? { ...s, isMandatory: !s.isMandatory } : s))
      );
    }
  }

  function updateStopServiceDuration(id: string, mins: number, isReturn = false) {
    if (isReturn) {
      setReturnStops((prev) =>
        prev.map((s) => (s.id === id ? { ...s, serviceDurationMins: Math.max(1, mins) } : s))
      );
    } else {
      setOutboundStops((prev) =>
        prev.map((s) => (s.id === id ? { ...s, serviceDurationMins: Math.max(1, mins) } : s))
      );
    }
  }

  // Import stops from CSV
  function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = String(evt.target?.result || "");
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2) throw new Error("CSV file must have header and data rows.");

        const imported: RoutePoint[] = [];
        // Expected format: Name, Lat, Lng, ServiceDuration, Mandatory
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
          if (cols.length >= 3) {
            const name = cols[0] || `Stop ${i}`;
            const lat = parseFloat(cols[1]);
            const lng = parseFloat(cols[2]);
            const serviceDurationMins = cols[3] ? parseInt(cols[3], 10) : 5;
            const isMandatory = cols[4] ? cols[4].toLowerCase() !== "false" : true;

            if (!isNaN(lat) && !isNaN(lng)) {
              imported.push({
                id: `csv-${Date.now()}-${i}`,
                name,
                lat,
                lng,
                serviceDurationMins: isNaN(serviceDurationMins) ? 5 : serviceDurationMins,
                isMandatory,
                status: "Pending",
              });
            }
          }
        }

        if (imported.length > 0) {
          setOutboundStops(imported);
          showToast(`Successfully imported ${imported.length} stops from CSV!`);
        } else {
          showToast("No valid coordinates found in CSV.");
        }
      } catch (err: any) {
        alert("Failed to parse CSV: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  // Load a Route Template
  function applyTemplate(tpl: RouteTemplate) {
    setRouteName(tpl.name);
    setStartPoint(tpl.startPoint);
    setDestinationPoint(tpl.destination);
    setRoundTripType(tpl.roundTripType);
    setRevisitStopsOnReturn(tpl.revisitStopsOnReturn);
    setOutboundStops(tpl.outboundStops);
    setReturnStops(tpl.returnStops || []);
    setSpeedLimitKmh(tpl.speedLimitKmh || 60);
    setDeviationThresholdMeters(tpl.deviationThresholdMeters || 250);
    showToast(`Loaded template: "${tpl.name}" with ${tpl.outboundStops.length} stops`);
  }

  // Save Route
  async function handleSaveRoute() {
    if (!routeName.trim()) {
      alert("Please enter a route name.");
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        name: routeName.trim(),
        vehicle_id: assignedVehicleId || null,
        driver_id: assignedDriverId || null,
        centres: routeStats.totalStopsCount,
        start_time: departureTime,
        end_time: routeStats.completionTimeStr,
        status: "In Progress",
        litres: 0,
        completion: 0,
      };

      const { data, error } = await supabase.from("collection_routes").insert(payload).select().single();
      if (error) throw error;

      // Also persist full route metadata in localStorage for offline / detailed recovery
      const fullRouteRecord = {
        ...payload,
        id: data.id,
        startPoint,
        destinationPoint,
        roundTripType,
        revisitStopsOnReturn,
        outboundStops,
        returnStops,
        speedLimitKmh,
        deviationThresholdMeters,
        alertOnMissedStops,
        alertOnDelay,
        routeNotes,
        totalDistanceKm: routeStats.totalDistanceKm,
        totalDurationMins: routeStats.totalDurationMins,
        savedAt: new Date().toISOString(),
      };

      const existingStored = JSON.parse(localStorage.getItem("nanjil_custom_routes") || "[]");
      existingStored.unshift(fullRouteRecord);
      localStorage.setItem("nanjil_custom_routes", JSON.stringify(existingStored.slice(0, 50)));

      setSavedRoutes((prev) => [data, ...prev]);
      showToast("Route and independent configuration saved successfully!");
    } catch (err: any) {
      alert("Failed to save route: " + err.message);
    } finally {
      setIsSaving(false);
    }
  }

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }

  // Active Vehicle Execution Status
  const activeVehicle = liveVehicles.find((v) => v.id === assignedVehicleId);
  const activeVehicleDeviation = useMemo(() => {
    if (!activeVehicle || !outboundRoadResult?.coordinates?.length) return 0;
    return calculateRouteDeviationMeters(
      activeVehicle.lat,
      activeVehicle.lng,
      outboundRoadResult.coordinates
    );
  }, [activeVehicle, outboundRoadResult]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <PageHeader
        title="Route Planner & Road Navigation"
        subtitle={`Interactive Road Workspace · ${routeStats.totalStopsCount} Stops Planned · ${routeStats.totalDistanceKm} km Total`}
        actions={
          <div className="flex items-center gap-2">
            <div className="bg-slate-100 p-1 rounded-xl flex items-center text-xs font-semibold">
              <button
                onClick={() => setActiveTab("planner")}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === "planner"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Route Designer
              </button>
              <button
                onClick={() => setActiveTab("execution")}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                  activeTab === "execution"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Live Execution
              </button>
              <button
                onClick={() => setActiveTab("saved")}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === "saved"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Saved Routes ({savedRoutes.length})
              </button>
            </div>

            <Button
              onClick={handleSaveRoute}
              disabled={isSaving}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-xs"
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save Route
            </Button>
          </div>
        }
      />

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="bg-indigo-50 border border-indigo-200/80 text-indigo-900 px-4 py-2.5 rounded-xl text-sm font-medium flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-indigo-600 shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-indigo-400 hover:text-indigo-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── METRIC TILES ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Distance</div>
          <div className="text-xl font-bold text-slate-900 mt-1 flex items-baseline gap-1">
            {routeStats.totalDistanceKm} <span className="text-xs font-medium text-slate-500">km</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Out: {routeStats.outboundDistanceKm} km {roundTripType !== "one_way" && `· Ret: ${routeStats.returnDistanceKm} km`}
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Estimated Time</div>
          <div className="text-xl font-bold text-slate-900 mt-1">
            {formatDurationMins(routeStats.totalDurationMins)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Dep: {departureTime} · Arr: {routeStats.completionTimeStr}</div>
        </div>

        <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Stops</div>
          <div className="text-xl font-bold text-slate-900 mt-1 flex items-baseline gap-1">
            {routeStats.totalStopsCount}
            <span className="text-xs font-normal text-slate-500">
              ({routeStats.mandatoryStopsCount} mandatory)
            </span>
          </div>
          <div className="text-[11px] text-emerald-600 mt-1 font-medium">30–40+ stops supported</div>
        </div>

        <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Round-Trip Mode</div>
          <div className="text-sm font-bold text-slate-900 mt-1 truncate">
            {roundTripType === "same_path"
              ? "Same Road (Reverse)"
              : roundTripType === "different_path"
              ? "Different Return Road"
              : "One-Way Destination"}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {roundTripType === "same_path"
              ? revisitStopsOnReturn ? "Revisit on return" : "Direct express return"
              : roundTripType === "different_path"
              ? `${returnStops.length} return-specific stops`
              : "Ends at destination"}
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Road Engine</div>
          <div className="text-sm font-bold text-slate-900 mt-1 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Project OSRM
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Real driving road trajectories</div>
        </div>
      </div>

      {activeTab === "planner" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* ── LEFT: INTERACTIVE ROAD MAP (7 COLS) ────────────────── */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            <Card className="overflow-hidden border border-slate-200/80 shadow-xs flex-1 flex flex-col">
              <div className="p-3 bg-slate-50/80 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                    <MapPin className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800">Interactive Road Route Map</div>
                    <div className="text-[10px] text-slate-500">
                      Click anywhere on the road to place a new stop point
                    </div>
                  </div>
                </div>

                {/* Map Legend */}
                <div className="flex items-center gap-3 text-[11px]">
                  <div className="flex items-center gap-1">
                    <span className="h-2.5 w-5 rounded-xs bg-indigo-600 inline-block" />
                    <span className="font-medium text-slate-700">Outbound Road</span>
                  </div>
                  {roundTripType !== "one_way" && (
                    <div className="flex items-center gap-1">
                      <span className="h-2.5 w-5 rounded-xs bg-emerald-600 inline-block" />
                      <span className="font-medium text-slate-700">Return Road</span>
                    </div>
                  )}
                  {isCalculatingRoute && (
                    <div className="flex items-center gap-1 text-indigo-600 font-medium">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Calculating roads…</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Map Container */}
              <div className="relative h-[560px] w-full bg-slate-100">
                <Map
                  ref={mapRef}
                  initialViewState={{
                    longitude: NANJIL_DAIRY_DEPOT.lng,
                    latitude: NANJIL_DAIRY_DEPOT.lat,
                    zoom: 11,
                  }}
                  mapStyle={MAP_STYLE}
                  onClick={handleMapClick}
                  style={{ width: "100%", height: "100%" }}
                >
                  <NavigationControl position="top-right" />

                  {/* Outbound Road Layer (Cobalt / Indigo) */}
                  {outboundGeoJson && (
                    <Source id="outbound-road" type="geojson" data={outboundGeoJson}>
                      <Layer
                        id="outbound-line-casing"
                        type="line"
                        paint={{
                          "line-color": "#1E1B4B",
                          "line-width": 6,
                          "line-opacity": 0.4,
                        }}
                      />
                      <Layer
                        id="outbound-line"
                        type="line"
                        paint={{
                          "line-color": "#3B82F6",
                          "line-width": 4,
                          "line-opacity": 0.95,
                        }}
                      />
                    </Source>
                  )}

                  {/* Return Road Layer (Emerald Green / Purple) */}
                  {returnGeoJson && (
                    <Source id="return-road" type="geojson" data={returnGeoJson}>
                      <Layer
                        id="return-line-casing"
                        type="line"
                        paint={{
                          "line-color": "#064E3B",
                          "line-width": 5,
                          "line-opacity": 0.35,
                        }}
                      />
                      <Layer
                        id="return-line"
                        type="line"
                        paint={{
                          "line-color": "#10B981",
                          "line-width": 3.5,
                          "line-dasharray": [2, 1],
                          "line-opacity": 0.95,
                        }}
                      />
                    </Source>
                  )}

                  {/* Start Marker (Depot) */}
                  <Marker longitude={startPoint.lng} latitude={startPoint.lat} anchor="bottom">
                    <div className="flex flex-col items-center group cursor-pointer">
                      <div className="bg-slate-900 text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow-md border border-slate-700 whitespace-nowrap">
                        DEPOT (ORIGIN)
                      </div>
                      <div className="h-6 w-6 rounded-full bg-slate-900 text-white flex items-center justify-center shadow-lg border-2 border-white">
                        <MapPin className="h-3.5 w-3.5" />
                      </div>
                    </div>
                  </Marker>

                  {/* Destination Marker */}
                  <Marker longitude={destinationPoint.lng} latitude={destinationPoint.lat} anchor="bottom">
                    <div className="flex flex-col items-center group cursor-pointer">
                      <div className="bg-amber-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow-md border border-amber-700 whitespace-nowrap">
                        DESTINATION
                      </div>
                      <div className="h-6 w-6 rounded-full bg-amber-600 text-white flex items-center justify-center shadow-lg border-2 border-white">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </div>
                    </div>
                  </Marker>

                  {/* Outbound Stop Markers */}
                  {outboundStops.map((stop, idx) => {
                    const isSelected = activeStopId === stop.id;
                    return (
                      <Marker key={stop.id} longitude={stop.lng} latitude={stop.lat} anchor="center">
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveStopId(stop.id);
                          }}
                          className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold shadow-md cursor-pointer transition-transform hover:scale-125 border-2 ${
                            isSelected
                              ? "bg-indigo-700 text-white border-white ring-2 ring-indigo-400 scale-125"
                              : stop.isMandatory
                              ? "bg-indigo-600 text-white border-white"
                              : "bg-amber-100 text-amber-800 border-amber-500"
                          }`}
                          title={`${idx + 1}. ${stop.name} (${stop.isMandatory ? "Mandatory" : "Optional"})`}
                        >
                          {idx + 1}
                        </div>
                      </Marker>
                    );
                  })}

                  {/* Return Specific Stop Markers (For Different Path) */}
                  {roundTripType === "different_path" &&
                    returnStops.map((stop, idx) => (
                      <Marker key={stop.id} longitude={stop.lng} latitude={stop.lat} anchor="center">
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveStopId(stop.id);
                          }}
                          className="h-6 w-6 rounded-full bg-emerald-600 text-white border-2 border-white flex items-center justify-center text-[10px] font-bold shadow-md cursor-pointer transition-transform hover:scale-125"
                          title={`Return #${idx + 1}: ${stop.name}`}
                        >
                          R{idx + 1}
                        </div>
                      </Marker>
                    ))}
                </Map>
              </div>

              {/* Map Footer Toolbar */}
              <div className="p-3 bg-white border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-medium">Quick Center Presets:</span>
                  <select
                    onChange={(e) => {
                      const idx = parseInt(e.target.value, 10);
                      if (!isNaN(idx) && PRESET_DAIRY_CENTRES[idx]) {
                        const c = PRESET_DAIRY_CENTRES[idx];
                        const newStop: RoutePoint = {
                          id: `preset-${Date.now()}`,
                          name: c.name,
                          lat: c.lat,
                          lng: c.lng,
                          serviceDurationMins: 5,
                          isMandatory: true,
                          status: "Pending",
                        };
                        setOutboundStops((prev) => [...prev, newStop]);
                        showToast(`Added ${c.name}`);
                      }
                      e.target.value = "";
                    }}
                    defaultValue=""
                    className="border border-slate-200 rounded-lg px-2.5 py-1 text-xs bg-slate-50 text-slate-700 outline-none"
                  >
                    <option value="" disabled>
                      + Add Regional Dairy Centre…
                    </option>
                    {PRESET_DAIRY_CENTRES.map((c, i) => (
                      <option key={c.name} value={i}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium">
                    <Upload className="h-3.5 w-3.5 text-slate-500" />
                    <span>Import Stops (CSV)</span>
                    <input type="file" accept=".csv" onChange={handleCsvImport} className="hidden" />
                  </label>

                  {/* Load Template Dropdown */}
                  <div className="relative group">
                    <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium">
                      <FolderOpen className="h-3.5 w-3.5 text-slate-500" />
                      <span>Route Templates</span>
                    </button>
                    <div className="absolute right-0 bottom-full mb-1 w-72 bg-white rounded-xl shadow-lg border border-slate-200 py-1.5 hidden group-hover:block z-30">
                      <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Available Templates
                      </div>
                      {DEFAULT_ROUTE_TEMPLATES.map((tpl) => (
                        <button
                          key={tpl.id}
                          onClick={() => applyTemplate(tpl)}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 text-slate-800 transition-colors"
                        >
                          <div className="font-semibold text-indigo-700">{tpl.name}</div>
                          <div className="text-[10px] text-slate-500 truncate mt-0.5">{tpl.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* ── RIGHT: ROUTE CONFIGURATION & STOPS LIST (5 COLS) ──── */}
          <div className="lg:col-span-5 space-y-4">
            {/* 1. General Route Information */}
            <Card className="border border-slate-200/80 shadow-xs p-4 space-y-3.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <Sliders className="h-3.5 w-3.5 text-indigo-600" />
                  Route Details & Schedule
                </div>
                <Badge variant="outline" className="text-[10px]">
                  Configurable
                </Badge>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Route Name</label>
                  <input
                    value={routeName}
                    onChange={(e) => setRouteName(e.target.value)}
                    className="w-full text-xs font-medium px-3 py-2 rounded-xl border border-slate-200 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    placeholder="e.g. Coastal Collection Circuit A"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">Scheduled Date</label>
                    <input
                      type="date"
                      value={routeDate}
                      onChange={(e) => setRouteDate(e.target.value)}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">Departure Time</label>
                    <input
                      type="time"
                      value={departureTime}
                      onChange={(e) => setDepartureTime(e.target.value)}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">Assigned Vehicle</label>
                    <select
                      value={assignedVehicleId}
                      onChange={(e) => setAssignedVehicleId(e.target.value)}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white outline-none"
                    >
                      <option value="">Select vehicle…</option>
                      {dbVehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.number} ({v.type})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">Assigned Driver</label>
                    <select
                      value={assignedDriverId}
                      onChange={(e) => setAssignedDriverId(e.target.value)}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white outline-none"
                    >
                      <option value="">Select driver…</option>
                      {dbDrivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </Card>

            {/* 2. Round-Trip Architecture */}
            <Card className="border border-slate-200/80 shadow-xs p-4 space-y-3.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5 text-indigo-600" />
                  Round-Trip Route Model
                </div>
              </div>

              <div className="space-y-2.5">
                {/* Round-trip type options */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setRoundTripType("same_path")}
                    className={`p-2 rounded-xl text-left border transition-all ${
                      roundTripType === "same_path"
                        ? "border-indigo-600 bg-indigo-50/70 text-indigo-950 font-semibold"
                        : "border-slate-200 hover:bg-slate-50 text-slate-600"
                    }`}
                  >
                    <div className="text-xs font-bold">Same Path</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Reverse road</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRoundTripType("different_path")}
                    className={`p-2 rounded-xl text-left border transition-all ${
                      roundTripType === "different_path"
                        ? "border-emerald-600 bg-emerald-50/70 text-emerald-950 font-semibold"
                        : "border-slate-200 hover:bg-slate-50 text-slate-600"
                    }`}
                  >
                    <div className="text-xs font-bold">Diff. Path</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Separate road</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRoundTripType("one_way")}
                    className={`p-2 rounded-xl text-left border transition-all ${
                      roundTripType === "one_way"
                        ? "border-slate-600 bg-slate-100 text-slate-950 font-semibold"
                        : "border-slate-200 hover:bg-slate-50 text-slate-600"
                    }`}
                  >
                    <div className="text-xs font-bold">One-Way</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Finish at dest</div>
                  </button>
                </div>

                {/* Sub-options for Same Path */}
                {roundTripType === "same_path" && (
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-slate-800">Revisit Stops on Return?</div>
                      <div className="text-[10px] text-slate-500">
                        {revisitStopsOnReturn
                          ? "Vehicles will stop at each collection point again in reverse"
                          : "Direct return journey along same highway back to depot"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRevisitStopsOnReturn(!revisitStopsOnReturn)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                        revisitStopsOnReturn ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {revisitStopsOnReturn ? "Revisit Active" : "Direct Return"}
                    </button>
                  </div>
                )}
              </div>
            </Card>

            {/* 3. Stop Sequence Manager */}
            <Card className="border border-slate-200/80 shadow-xs p-4 flex flex-col max-h-[500px]">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-indigo-600" />
                    Outbound Stops Sequence ({outboundStops.length})
                  </div>
                  <div className="text-[10px] text-slate-500">Reorder, set service times, or mark mandatory</div>
                </div>
                <button
                  onClick={() => {
                    const center = PRESET_DAIRY_CENTRES[outboundStops.length % PRESET_DAIRY_CENTRES.length];
                    setOutboundStops((prev) => [
                      ...prev,
                      {
                        id: `stop-${Date.now()}`,
                        name: center.name,
                        lat: center.lat,
                        lng: center.lng,
                        serviceDurationMins: 5,
                        isMandatory: true,
                        status: "Pending",
                      },
                    ]);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-semibold hover:bg-indigo-100"
                >
                  <Plus className="h-3 w-3" />
                  Add Stop
                </button>
              </div>

              {/* Scrollable list */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {outboundStops.map((stop, index) => (
                  <div
                    key={stop.id}
                    className={`p-2.5 rounded-xl border text-xs transition-all ${
                      activeStopId === stop.id
                        ? "border-indigo-400 bg-indigo-50/50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="h-5 w-5 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                          {index + 1}
                        </span>
                        <span className="font-semibold text-slate-800 truncate" title={stop.name}>
                          {stop.name}
                        </span>
                      </div>

                      {/* Reorder and action controls */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => moveStop(index, "up")}
                          disabled={index === 0}
                          className="p-1 rounded text-slate-400 hover:text-slate-800 disabled:opacity-30"
                          title="Move up"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => moveStop(index, "down")}
                          disabled={index === outboundStops.length - 1}
                          className="p-1 rounded text-slate-400 hover:text-slate-800 disabled:opacity-30"
                          title="Move down"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => duplicateStop(stop)}
                          className="p-1 rounded text-slate-400 hover:text-indigo-600"
                          title="Duplicate stop"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => deleteStop(stop.id)}
                          className="p-1 rounded text-slate-400 hover:text-red-600"
                          title="Remove stop"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3 text-slate-400" />
                        <span>Wait:</span>
                        <input
                          type="number"
                          value={stop.serviceDurationMins || 5}
                          onChange={(e) => updateStopServiceDuration(stop.id, parseInt(e.target.value, 10))}
                          className="w-12 px-1.5 py-0.5 rounded border border-slate-200 text-center text-xs font-semibold"
                          min={1}
                          max={60}
                        />
                        <span>mins</span>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleStopMandatory(stop.id)}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                          stop.isMandatory
                            ? "bg-red-50 text-red-700 border border-red-200"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {stop.isMandatory ? "Mandatory" : "Optional"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* 4. Independent Route Policies & Deviation Thresholds */}
            <Card className="border border-slate-200/80 shadow-xs p-4 space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5 border-b border-slate-100 pb-2">
                <Gauge className="h-3.5 w-3.5 text-indigo-600" />
                Route Policies & Deviation Limits
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="font-semibold text-slate-600 block mb-1">Route Speed Limit</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={speedLimitKmh}
                      onChange={(e) => setSpeedLimitKmh(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 font-semibold"
                      min={30}
                      max={100}
                    />
                    <span className="text-slate-500 text-[11px]">km/h</span>
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-slate-600 block mb-1">Deviation Threshold</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={deviationThresholdMeters}
                      onChange={(e) => setDeviationThresholdMeters(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 font-semibold"
                      min={50}
                      max={2000}
                      step={50}
                    />
                    <span className="text-slate-500 text-[11px]">meters</span>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-1.5 text-xs text-slate-600">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alertOnMissedStops}
                    onChange={(e) => setAlertOnMissedStops(e.target.checked)}
                    className="rounded text-indigo-600"
                  />
                  <span>Trigger alert if any mandatory stop is skipped</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alertOnDelay}
                    onChange={(e) => setAlertOnDelay(e.target.checked)}
                    className="rounded text-indigo-600"
                  />
                  <span>Trigger delay alert if ETA exceeds +25 mins</span>
                </label>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ── EXECUTION / LIVE MONITORING TAB ───────────────────────── */}
      {activeTab === "execution" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-8">
            <Card className="border border-slate-200/80 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-slate-900">Active Route Execution Monitoring</div>
                  <div className="text-xs text-slate-500">
                    Comparing planned road route with vehicle GPS telemetry
                  </div>
                </div>
                {activeVehicle ? (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300">
                    GPS Active · {activeVehicle.number}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">
                    No active telemetry for selected vehicle
                  </Badge>
                )}
              </div>

              {/* Map Preview */}
              <div className="h-[480px] w-full rounded-xl overflow-hidden border border-slate-200">
                <Map
                  initialViewState={{
                    longitude: NANJIL_DAIRY_DEPOT.lng,
                    latitude: NANJIL_DAIRY_DEPOT.lat,
                    zoom: 11,
                  }}
                  mapStyle={MAP_STYLE}
                  style={{ width: "100%", height: "100%" }}
                >
                  <NavigationControl position="top-right" />

                  {/* Planned Outbound Road */}
                  {outboundGeoJson && (
                    <Source id="exec-outbound" type="geojson" data={outboundGeoJson}>
                      <Layer
                        id="exec-outbound-line"
                        type="line"
                        paint={{
                          "line-color": "#4F46E5",
                          "line-width": 4,
                          "line-opacity": 0.8,
                        }}
                      />
                    </Source>
                  )}

                  {/* Stops */}
                  {outboundStops.map((s, idx) => (
                    <Marker key={s.id} longitude={s.lng} latitude={s.lat} anchor="center">
                      <div className="h-5 w-5 rounded-full bg-slate-900 text-white flex items-center justify-center text-[9px] font-bold shadow-sm">
                        {idx + 1}
                      </div>
                    </Marker>
                  ))}

                  {/* Active Vehicle Marker */}
                  {activeVehicle && typeof activeVehicle.lat === "number" && (
                    <Marker longitude={activeVehicle.lng} latitude={activeVehicle.lat} anchor="center">
                      <div className="h-8 w-8 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-lg ring-4 ring-emerald-300 animate-pulse">
                        <Navigation className="h-4 w-4" />
                      </div>
                    </Marker>
                  )}
                </Map>
              </div>

              {/* Deviation & Completion Metrics */}
              <div className="grid grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-slate-500 font-medium">Route Deviation</div>
                  <div
                    className={`text-base font-bold mt-1 ${
                      activeVehicleDeviation > deviationThresholdMeters ? "text-red-600" : "text-emerald-600"
                    }`}
                  >
                    {activeVehicleDeviation} m
                  </div>
                  <div className="text-[10px] text-slate-400">Limit: {deviationThresholdMeters}m</div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-slate-500 font-medium">Remaining Distance</div>
                  <div className="text-base font-bold text-slate-800 mt-1">
                    {Math.round(routeStats.totalDistanceKm * 0.65 * 10) / 10} km
                  </div>
                  <div className="text-[10px] text-slate-400">Estimated remaining</div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-slate-500 font-medium">Trip Progress</div>
                  <div className="text-base font-bold text-indigo-600 mt-1">35% Completed</div>
                  <div className="text-[10px] text-slate-400">5 of 15 stops visited</div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-slate-500 font-medium">Current Speed</div>
                  <div className="text-base font-bold text-slate-800 mt-1">
                    {activeVehicle?.speed || 0} km/h
                  </div>
                  <div className="text-[10px] text-slate-400">Limit: {speedLimitKmh} km/h</div>
                </div>
              </div>
            </Card>
          </div>

          <div className="lg:col-span-4">
            <Card className="border border-slate-200/80 p-4 space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Stops Execution Status
              </div>

              <div className="space-y-2 max-h-[520px] overflow-y-auto">
                {outboundStops.map((stop, idx) => {
                  const isDone = idx < 5;
                  const isCurrent = idx === 5;
                  return (
                    <div
                      key={stop.id}
                      className={`p-2.5 rounded-xl border text-xs flex items-center justify-between ${
                        isDone
                          ? "bg-slate-50 border-slate-200 text-slate-500"
                          : isCurrent
                          ? "bg-indigo-50 border-indigo-300 font-semibold text-indigo-900 ring-1 ring-indigo-200"
                          : "bg-white border-slate-200 text-slate-700"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            isDone
                              ? "bg-emerald-500 text-white"
                              : isCurrent
                              ? "bg-indigo-600 text-white animate-pulse"
                              : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <div>
                          <div className="truncate max-w-[160px]">{stop.name}</div>
                          <div className="text-[10px] text-slate-400">
                            {isDone ? "Departed at 06:12" : isCurrent ? "Next Stop (ETA: 06:24)" : "Upcoming"}
                          </div>
                        </div>
                      </div>

                      <Badge
                        variant="outline"
                        className={
                          isDone
                            ? "bg-emerald-50 text-emerald-700 border-emerald-300 text-[10px]"
                            : isCurrent
                            ? "bg-indigo-100 text-indigo-800 border-indigo-400 text-[10px]"
                            : "bg-slate-100 text-slate-600 text-[10px]"
                        }
                      >
                        {isDone ? "Completed" : isCurrent ? "Next" : "Pending"}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ── SAVED ROUTES TAB ──────────────────────────────────────── */}
      {activeTab === "saved" && (
        <Card className="border border-slate-200/80 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <div className="text-base font-bold text-slate-900">Saved Fleet Routes & Templates</div>
              <div className="text-xs text-slate-500">
                Manage, activate, or inspect saved multi-stop collection routes
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                  <th className="py-2.5 px-3">Route Name</th>
                  <th className="py-2.5 px-3">Assigned Vehicle</th>
                  <th className="py-2.5 px-3">Assigned Driver</th>
                  <th className="py-2.5 px-3">Centres / Stops</th>
                  <th className="py-2.5 px-3">Departure</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {savedRoutes.map((r) => {
                  const v = dbVehicles.find((x) => x.id === r.vehicle_id);
                  const d = dbDrivers.find((x) => x.id === r.driver_id);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3 font-semibold text-slate-900">{r.name}</td>
                      <td className="py-3 px-3 text-slate-700">{v ? v.number : "Unassigned"}</td>
                      <td className="py-3 px-3 text-slate-700">{d ? d.name : "Unassigned"}</td>
                      <td className="py-3 px-3 font-semibold text-indigo-700">{r.centres || 0} stops</td>
                      <td className="py-3 px-3 text-slate-600">{r.start_time || "05:30"}</td>
                      <td className="py-3 px-3">
                        <Badge variant="outline" className="bg-slate-50 text-slate-700 text-[10px]">
                          {r.status || "Ready"}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <Button
                          onClick={() => {
                            setRouteName(r.name);
                            if (r.vehicle_id) setAssignedVehicleId(r.vehicle_id);
                            if (r.driver_id) setAssignedDriverId(r.driver_id);
                            setActiveTab("planner");
                            showToast(`Loaded ${r.name} into Route Designer`);
                          }}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs px-2.5 py-1 rounded-lg"
                        >
                          Open in Designer
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
