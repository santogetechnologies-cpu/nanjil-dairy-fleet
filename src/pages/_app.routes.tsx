import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
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
  RefreshCw,
  Edit,
  Truck,
  UserCheck,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useVehicles } from "@/hooks/useVehicleTracking";
import { GoogleRoutePlannerMap } from "@/components/maps";
import {
  calculateRoadRoute,
  calculateRouteDeviationMeters,
  formatDurationMins,
  type RoutePoint,
  type RoadRoutingResult,
} from "@/lib/roadRouting";
import {
  NANJIL_DAIRY_DEPOT,
  createEmptyRouteDraft,
  validateManualRouteConfig,
  type ManualRouteEndpoint,
} from "@/lib/routeTemplates";
import { archiveCollectionRoute, isValidSavedRoute } from "@/lib/driverRouteAssignments";

export const PLANNER_WORKSPACE_KEY = "nanjil_planner_manual_workspace_v2";

export interface StoredPlannerWorkspace {
  editingRouteId?: string | null;
  routeName?: string;
  routeDate?: string;
  departureTime?: string;
  assignedVehicleId?: string;
  assignedDriverId?: string;
  startPoint?: ManualRouteEndpoint | null;
  destinationPoint?: ManualRouteEndpoint | null;
  roundTripType?: "same_path" | "different_path" | "one_way";
  revisitStopsOnReturn?: boolean;
  outboundStops?: RoutePoint[];
  returnStops?: RoutePoint[];
  speedLimitKmh?: number;
  deviationThresholdMeters?: number;
  alertOnMissedStops?: boolean;
  alertOnDelay?: boolean;
  routeNotes?: string;
  activeTab?: "planner" | "saved" | "execution";
  lastUpdated?: string;
}

export function getInitialPlannerWorkspace(): StoredPlannerWorkspace | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PLANNER_WORKSPACE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    }
  } catch (err) {
    console.warn("Failed to read initial planner workspace:", err);
  }
  return null;
}

export default function RoutesPlannerPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const liveVehicles = useVehicles();

  const initialWorkspace = useMemo(() => getInitialPlannerWorkspace(), []);
  const emptyDraft = useMemo(() => createEmptyRouteDraft(), []);

  // Mode: "planner" (designing route), "saved" (DB routes), or "execution" (tracking)
  const [activeTab, setActiveTab] = useState<"planner" | "saved" | "execution">(
    () => initialWorkspace?.activeTab || "planner"
  );

  // Core Route Details — clean empty defaults when no draft exists
  const [routeName, setRouteName] = useState(
    () => initialWorkspace?.routeName ?? emptyDraft.routeName
  );
  const [routeDate, setRouteDate] = useState(
    () => initialWorkspace?.routeDate || new Date().toISOString().split("T")[0]
  );
  const [departureTime, setDepartureTime] = useState(
    () => initialWorkspace?.departureTime || emptyDraft.departureTime
  );
  const [assignedVehicleId, setAssignedVehicleId] = useState(
    () => initialWorkspace?.assignedVehicleId || ""
  );
  const [assignedDriverId, setAssignedDriverId] = useState(
    () => initialWorkspace?.assignedDriverId || ""
  );

  // Start & End — manually selected or picked on map
  const [startPoint, setStartPoint] = useState<ManualRouteEndpoint | null>(
    () => initialWorkspace?.startPoint ?? null
  );
  const [destinationPoint, setDestinationPoint] = useState<ManualRouteEndpoint | null>(
    () => initialWorkspace?.destinationPoint ?? null
  );

  // Round Trip Configuration
  const [roundTripType, setRoundTripType] = useState<"same_path" | "different_path" | "one_way">(
    () => initialWorkspace?.roundTripType || emptyDraft.roundTripType
  );
  const [revisitStopsOnReturn, setRevisitStopsOnReturn] = useState(
    () => initialWorkspace?.revisitStopsOnReturn ?? emptyDraft.revisitStopsOnReturn
  );

  // Manual Stop Sequences — starts empty
  const [outboundStops, setOutboundStops] = useState<RoutePoint[]>(
    () => initialWorkspace?.outboundStops ?? []
  );
  const [returnStops, setReturnStops] = useState<RoutePoint[]>(
    () => initialWorkspace?.returnStops ?? []
  );

  // Route-Specific Settings
  const [speedLimitKmh, setSpeedLimitKmh] = useState(
    () => initialWorkspace?.speedLimitKmh ?? emptyDraft.speedLimitKmh
  );
  const [deviationThresholdMeters, setDeviationThresholdMeters] = useState(
    () => initialWorkspace?.deviationThresholdMeters ?? emptyDraft.deviationThresholdMeters
  );
  const [alertOnMissedStops, setAlertOnMissedStops] = useState(
    () => initialWorkspace?.alertOnMissedStops ?? true
  );
  const [alertOnDelay, setAlertOnDelay] = useState(
    () => initialWorkspace?.alertOnDelay ?? true
  );
  const [routeNotes, setRouteNotes] = useState(
    () => initialWorkspace?.routeNotes ?? ""
  );

  // Calculated Road Network Paths
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const [outboundRoadResult, setOutboundRoadResult] = useState<RoadRoutingResult | null>(null);
  const [returnRoadResult, setReturnRoadResult] = useState<RoadRoutingResult | null>(null);

  // Database & Resources
  const [dbVehicles, setDbVehicles] = useState<any[]>([]);
  const [dbDrivers, setDbDrivers] = useState<any[]>([]);
  const [savedRoutes, setSavedRoutes] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(
    () => searchParams.get("id") || searchParams.get("routeId") || initialWorkspace?.editingRouteId || null
  );
  const [savedRoutesSearch, setSavedRoutesSearch] = useState("");
  const [viewingRoute, setViewingRoute] = useState<any | null>(null);
  const [archivingRouteId, setArchivingRouteId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    type: "success" | "error" | "info";
  } | null>(null);

  // Manual stop quick-add + drag reorder + geocoding search state
  const [searchLocationQuery, setSearchLocationQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ name: string; displayName: string; lat: number; lng: number }>>([]);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showManualStopForm, setShowManualStopForm] = useState<"outbound" | "return" | null>(null);
  const [manualStopName, setManualStopName] = useState("");
  const [manualStopLat, setManualStopLat] = useState("");
  const [manualStopLng, setManualStopLng] = useState("");
  const [manualStopDuration, setManualStopDuration] = useState(5);
  const [manualStopMandatory, setManualStopMandatory] = useState(true);
  const [draggedStop, setDraggedStop] = useState<{ index: number; isReturn: boolean } | null>(null);
  const [editingCoordsStopId, setEditingCoordsStopId] = useState<string | null>(null);

  // Selected stop on map + click mode
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [mapClickMode, setMapClickMode] = useState<
    "add_stop" | "add_return_stop" | "set_start" | "set_destination"
  >("add_stop");

  // Auto-sync active workspace to localStorage on any state modification
  useEffect(() => {
    try {
      const workspaceDraft: StoredPlannerWorkspace = {
        editingRouteId,
        routeName,
        routeDate,
        departureTime,
        assignedVehicleId,
        assignedDriverId,
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
        activeTab,
        lastUpdated: new Date().toISOString(),
      };
      localStorage.setItem(PLANNER_WORKSPACE_KEY, JSON.stringify(workspaceDraft));
    } catch (e) {
      console.warn("Failed to auto-sync route planner workspace:", e);
    }
  }, [
    editingRouteId,
    routeName,
    routeDate,
    departureTime,
    assignedVehicleId,
    assignedDriverId,
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
    activeTab,
  ]);

  // Keep URL query parameter ?id= in sync with editingRouteId
  useEffect(() => {
    const currentUrlId = searchParams.get("id");
    if (editingRouteId) {
      if (currentUrlId !== editingRouteId) {
        setSearchParams({ id: editingRouteId }, { replace: true });
      }
    } else {
      if (currentUrlId) {
        setSearchParams({}, { replace: true });
      }
    }
  }, [editingRouteId]);

  function showToast(text: string, type: "success" | "error" | "info" = "success") {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  }

  // Parse route configuration cleanly from Supabase row
  function extractRouteConfig(r: any) {
    let config = r?.route_config;
    if (typeof config === "string") {
      try {
        config = JSON.parse(config);
      } catch {
        config = null;
      }
    }
    return config && typeof config === "object" && Object.keys(config).length > 0 ? config : null;
  }

  // Reload active non-archived routes from Supabase database (single source of truth)
  async function loadSavedRoutes() {
    setIsLoadingRoutes(true);
    try {
      const { data, error } = await supabase
        .from("collection_routes")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to load collection_routes:", error);
        showToast("Error loading routes: " + error.message, "error");
        return;
      }

      if (data) {
        const activeRows = data
          .filter((r: any) => r.is_archived !== true)
          .map((r: any) => ({
            ...r,
            route_config: extractRouteConfig(r),
          }));
        setSavedRoutes(activeRows);
      }
    } catch (err: any) {
      console.error("loadSavedRoutes exception:", err);
      showToast("Network error while loading routes", "error");
    } finally {
      setIsLoadingRoutes(false);
    }
  }

  // Load vehicles, drivers, and saved routes on mount
  useEffect(() => {
    let isMounted = true;

    async function initData() {
      setIsLoadingRoutes(true);
      try {
        const [vRes, dRes, rRes] = await Promise.all([
          supabase.from("vehicles").select("id, number, type, model"),
          supabase.from("drivers").select("id, name, phone"),
          supabase.from("collection_routes").select("*").order("created_at", { ascending: false }),
        ]);

        if (!isMounted) return;

        if (vRes.data && vRes.data.length > 0) {
          setDbVehicles(vRes.data);
        }
        if (dRes.data && dRes.data.length > 0) {
          const uniqueDrivers = new Map();
          dRes.data.forEach((d) => {
            if (!uniqueDrivers.has(d.name)) uniqueDrivers.set(d.name, d);
          });
          setDbDrivers(Array.from(uniqueDrivers.values()));
        }
        if (rRes.error) {
          console.error("Failed to load collection_routes:", rRes.error);
          showToast("Could not load saved routes: " + rRes.error.message, "error");
        } else if (rRes.data) {
          const enriched = rRes.data
            .filter((r: any) => r.is_archived !== true)
            .map((r: any) => ({
              ...r,
              route_config: extractRouteConfig(r),
            }));
          setSavedRoutes(enriched);

          // If URL specifically requested a route (?id=... or ?routeId=...)
          const targetUrlId = searchParams.get("id") || searchParams.get("routeId");
          if (targetUrlId && targetUrlId !== initialWorkspace?.editingRouteId) {
            const matched = enriched.find((r: any) => r.id === targetUrlId);
            if (matched) {
              handleOpenInDesigner(matched);
            }
          }
        }
      } catch (err: any) {
        console.error("Failed to load initial data in routes:", err);
      } finally {
        if (isMounted) setIsLoadingRoutes(false);
      }
    }

    initData();

    // Subscribe to realtime updates on collection_routes
    const channelId = `routes-stream-${Math.random().toString(36).substring(2, 9)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "collection_routes" },
        () => {
          if (isMounted) loadSavedRoutes();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  // Compute road routing when waypoints or round-trip settings change
  useEffect(() => {
    let isCancelled = false;

    async function computeRoutes() {
      const validOutPoints: Array<{ lat: number; lng: number }> = [
        ...(startPoint ? [{ lat: startPoint.lat, lng: startPoint.lng }] : []),
        ...outboundStops.map((s) => ({ lat: s.lat, lng: s.lng })),
        ...(destinationPoint ? [{ lat: destinationPoint.lat, lng: destinationPoint.lng }] : []),
      ];

      if (validOutPoints.length < 2) {
        setOutboundRoadResult(null);
        setReturnRoadResult(null);
        return;
      }

      setIsCalculatingRoute(true);
      try {
        const outRes = await calculateRoadRoute(validOutPoints);
        if (isCancelled) return;
        setOutboundRoadResult(outRes);

        // Build Return Points when endpoints exist and round-trip enabled
        if (startPoint && destinationPoint && roundTripType === "same_path") {
          const retPoints = revisitStopsOnReturn
            ? [
                { lat: destinationPoint.lat, lng: destinationPoint.lng },
                ...[...outboundStops].reverse().map((s) => ({ lat: s.lat, lng: s.lng })),
                { lat: startPoint.lat, lng: startPoint.lng },
              ]
            : [
                { lat: destinationPoint.lat, lng: destinationPoint.lng },
                { lat: startPoint.lat, lng: startPoint.lng },
              ];

          const retRes = await calculateRoadRoute(retPoints);
          if (isCancelled) return;
          setReturnRoadResult(retRes);
        } else if (startPoint && destinationPoint && roundTripType === "different_path") {
          const retPoints = [
            { lat: destinationPoint.lat, lng: destinationPoint.lng },
            ...returnStops.map((s) => ({ lat: s.lat, lng: s.lng })),
            { lat: startPoint.lat, lng: startPoint.lng },
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

  // Reverse-geocode optional friendly name via OpenStreetMap Nominatim (falls back cleanly to coordinates)
  async function lookupPlaceLabel(lat: number, lng: number, fallbackPrefix: string): Promise<string> {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14`,
        { signal: AbortSignal.timeout(3000) }
      );
      if (res.ok) {
        const data = await res.json();
        const label =
          data?.name ||
          data?.address?.village ||
          data?.address?.town ||
          data?.address?.suburb ||
          data?.address?.city;
        if (label) return String(label);
      }
    } catch {
      // Ignore network/rate limit; keep clean coordinate fallback
    }
    return `${fallbackPrefix} (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  }

  // Forward search place / address or "lat, lng"
  async function handleSearchLocation(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const q = searchLocationQuery.trim();
    if (!q) return;
    setSearchError(null);

    // Direct coordinate entry "lat, lng"
    const coordMatch = q.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        setSearchResults([
          {
            name: `Pinned Point (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
            displayName: `Custom Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
            lat,
            lng,
          },
        ]);
        return;
      }
    }

    setIsSearchingLocation(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
        q
      )}&countrycodes=in&limit=6`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        setSearchResults([]);
        setSearchError("No matching locations found. Try another town/village name or enter lat, lng.");
        return;
      }
      setSearchResults(
        rows.map((r: any) => ({
          name: String(r.display_name || q).split(",")[0].trim(),
          displayName: String(r.display_name || q),
          lat: Number(r.lat),
          lng: Number(r.lon),
        }))
      );
    } catch (err: any) {
      setSearchError(err?.message || "Unable to search locations right now. You can click directly on the map.");
    } finally {
      setIsSearchingLocation(false);
    }
  }

  // Handle map click to set origin, destination, outbound stop, or return stop
  async function handleMapClick(e: { lngLat: { lng: number; lat: number } }) {
    const lat = Number(e.lngLat.lat.toFixed(6));
    const lng = Number(e.lngLat.lng.toFixed(6));

    if (mapClickMode === "set_start") {
      const tempName = `Origin (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      setStartPoint({ name: tempName, lat, lng });
      setMapClickMode("add_stop");
      showToast("Starting location set from map");
      const friendly = await lookupPlaceLabel(lat, lng, "Origin");
      setStartPoint((prev) => (prev && prev.lat === lat && prev.lng === lng ? { ...prev, name: friendly } : prev));
      return;
    }

    if (mapClickMode === "set_destination") {
      const tempName = `Destination (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      setDestinationPoint({ name: tempName, lat, lng });
      setMapClickMode("add_stop");
      showToast("Destination updated from map");
      const friendly = await lookupPlaceLabel(lat, lng, "Destination");
      setDestinationPoint((prev) =>
        prev && prev.lat === lat && prev.lng === lng ? { ...prev, name: friendly } : prev
      );
      return;
    }

    if (mapClickMode === "add_return_stop") {
      const id = `ret-${Date.now()}`;
      const newStop: RoutePoint = {
        id,
        name: `Return Stop #${returnStops.length + 1}`,
        lat,
        lng,
        serviceDurationMins: 5,
        isMandatory: false,
        status: "Pending",
      };
      setReturnStops((prev) => [...prev, newStop]);
      setActiveStopId(id);
      showToast(`Added return stop #${returnStops.length + 1}`);
      const friendly = await lookupPlaceLabel(lat, lng, `Return Stop`);
      setReturnStops((prev) => prev.map((s) => (s.id === id ? { ...s, name: friendly } : s)));
      return;
    }

    const id = `stop-${Date.now()}`;
    const newStop: RoutePoint = {
      id,
      name: `Stop #${outboundStops.length + 1}`,
      lat,
      lng,
      serviceDurationMins: 5,
      isMandatory: true,
      status: "Pending",
    };
    setOutboundStops((prev) => [...prev, newStop]);
    setActiveStopId(id);
    showToast(`Added outbound stop #${outboundStops.length + 1}`);
    const friendly = await lookupPlaceLabel(lat, lng, `Stop`);
    setOutboundStops((prev) => prev.map((s) => (s.id === id ? { ...s, name: friendly } : s)));
  }

  // Manual inline Add Stop submit (coordinates optional)
  function handleSubmitManualStop(e: React.FormEvent) {
    e.preventDefault();
    const isReturn = showManualStopForm === "return";
    const parsedLat = parseFloat(manualStopLat);
    const parsedLng = parseFloat(manualStopLng);
    const lat = Number.isFinite(parsedLat) ? parsedLat : 0;
    const lng = Number.isFinite(parsedLng) ? parsedLng : 0;
    if (!manualStopName.trim()) {
      showToast("Enter a stop name.", "error");
      return;
    }
    const newStop: RoutePoint = {
      id: `${isReturn ? "ret" : "stop"}-${Date.now()}`,
      name: manualStopName.trim(),
      lat,
      lng,
      serviceDurationMins: Math.max(1, Number(manualStopDuration) || 5),
      isMandatory: manualStopMandatory,
      status: "Pending",
    };
    if (isReturn) {
      setReturnStops((prev) => [...prev, newStop]);
    } else {
      setOutboundStops((prev) => [...prev, newStop]);
    }
    setActiveStopId(newStop.id);
    setShowManualStopForm(null);
    setManualStopName("");
    setManualStopLat("");
    setManualStopLng("");
    showToast(`Added "${newStop.name}"`);
  }

  function reorderStopByDragDrop(fromIdx: number, toIdx: number, isReturn = false) {
    if (fromIdx === toIdx) return;
    const updater = (prev: RoutePoint[]) => {
      const next = [...prev];
      if (fromIdx < 0 || fromIdx >= next.length || toIdx < 0 || toIdx >= next.length) return prev;
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    };
    if (isReturn) setReturnStops(updater);
    else setOutboundStops(updater);
  }

  function updateStopFields(
    id: string,
    patch: Partial<RoutePoint>,
    isReturn = false
  ) {
    const updater = (prev: RoutePoint[]) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s));
    if (isReturn) setReturnStops(updater);
    else setOutboundStops(updater);
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

  // Save or Update Route directly in Supabase `public.collection_routes`
  async function handleSaveRoute(asNewCopy = false) {
    const check = validateManualRouteConfig({
      routeName,
      startPoint,
      destinationPoint,
      outboundStops,
      returnStops,
      roundTripType,
    });
    if (!check.valid) {
      showToast(check.error || "Please complete all required route fields.", "error");
      return;
    }

    setIsSaving(true);
    try {
      const routeConfigData = {
        createdManually: true,
        startPoint,
        destinationPoint,
        roundTripType,
        revisitStopsOnReturn,
        outboundStops,
        returnStops: roundTripType === "different_path" ? returnStops : [],
        departureTime,
        speedLimitKmh,
        deviationThresholdMeters,
        alertOnMissedStops,
        alertOnDelay,
        routeNotes: routeNotes.trim(),
        routeDate,
        totalDistanceKm: routeStats.totalDistanceKm,
        totalDurationMins: routeStats.totalDurationMins,
        savedAt: new Date().toISOString(),
      };

      const basePayload: any = {
        name: routeName.trim(),
        vehicle_id: assignedVehicleId || null,
        driver_id: assignedDriverId || null,
        centres: routeStats.totalStopsCount,
        start_time: departureTime,
        end_time: routeStats.completionTimeStr,
        status: "In Progress",
        is_archived: false,
        litres: 0,
        completion: 0,
        route_config: routeConfigData,
      };

      let savedRecord: any = null;
      const isUpdate = Boolean(editingRouteId && !asNewCopy);

      if (isUpdate) {
        const updateRes = await supabase
          .from("collection_routes")
          .update(basePayload)
          .eq("id", editingRouteId)
          .select()
          .single();

        if (updateRes.error) throw updateRes.error;
        savedRecord = updateRes.data;
      } else {
        const insertRes = await supabase
          .from("collection_routes")
          .insert(basePayload)
          .select()
          .single();

        if (insertRes.error) throw insertRes.error;
        savedRecord = insertRes.data;
      }

      if (!savedRecord || !savedRecord.id) {
        throw new Error("No database record was returned after saving.");
      }

      try {
        const activeDraft: StoredPlannerWorkspace = {
          editingRouteId: savedRecord.id,
          routeName: routeName.trim(),
          routeDate,
          departureTime,
          assignedVehicleId,
          assignedDriverId,
          startPoint,
          destinationPoint,
          roundTripType,
          revisitStopsOnReturn,
          outboundStops,
          returnStops: roundTripType === "different_path" ? returnStops : [],
          speedLimitKmh,
          deviationThresholdMeters,
          alertOnMissedStops,
          alertOnDelay,
          routeNotes: routeNotes.trim(),
          activeTab: "planner",
          lastUpdated: new Date().toISOString(),
        };
        localStorage.setItem(PLANNER_WORKSPACE_KEY, JSON.stringify(activeDraft));
      } catch (storageErr) {
        console.warn("Local storage write warning:", storageErr);
      }

      const completeRecord = {
        ...savedRecord,
        route_config: extractRouteConfig(savedRecord) || routeConfigData,
      };

      setEditingRouteId(savedRecord.id);
      setSearchParams({ id: savedRecord.id }, { replace: true });

      setSavedRoutes((prev) => {
        if (isUpdate) {
          return prev.map((r) => (r.id === savedRecord.id ? completeRecord : r));
        } else {
          return [completeRecord, ...prev.filter((r) => r.id !== savedRecord.id)];
        }
      });

      showToast(
        isUpdate
          ? `Route "${savedRecord.name}" updated in Supabase with ${routeStats.totalStopsCount} stops!`
          : `New route "${savedRecord.name}" saved to Supabase with ${routeStats.totalStopsCount} stops!`,
        "success"
      );
    } catch (err: any) {
      console.error("Failed to save route:", err);
      const msg = err?.message || "Database error while saving route";
      if (msg.includes("is_archived") || msg.includes("route_config")) {
        showToast(
          "Database schema is missing lifecycle columns. Apply migration 20261126120000_manual_routes_lifecycle_and_snapshots.sql in Supabase first.",
          "error"
        );
      } else {
        showToast("Failed to save route: " + msg, "error");
      }
    } finally {
      setIsSaving(false);
    }
  }

  // Open and restore saved route into Route Designer (optionally as duplicate)
  function handleOpenInDesigner(r: any, asDuplicate = false) {
    setEditingRouteId(asDuplicate ? null : r.id);
    if (asDuplicate) {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ id: r.id }, { replace: true });
    }

    const resolvedName = asDuplicate ? `${r.name || "Route"} (Copy)` : r.name || "";
    setRouteName(resolvedName);
    setAssignedVehicleId(r.vehicle_id || "");
    setAssignedDriverId(r.driver_id || "");

    const cfg = extractRouteConfig(r) || r.route_config;
    setDepartureTime(r.start_time || cfg?.departureTime || "05:30");

    const loadedStart = cfg?.startPoint || null;
    const loadedDest = cfg?.destinationPoint || cfg?.destination || null;
    const loadedOutbound: RoutePoint[] = Array.isArray(cfg?.outboundStops) ? cfg.outboundStops : [];
    const loadedReturn: RoutePoint[] = Array.isArray(cfg?.returnStops) ? cfg.returnStops : [];

    setStartPoint(loadedStart);
    setDestinationPoint(loadedDest);
    setRoundTripType(
      cfg?.roundTripType || (loadedReturn.length > 0 ? "different_path" : "one_way")
    );
    setRevisitStopsOnReturn(Boolean(cfg?.revisitStopsOnReturn));
    setOutboundStops(loadedOutbound);
    setReturnStops(loadedReturn);
    setSpeedLimitKmh(typeof cfg?.speedLimitKmh === "number" ? cfg.speedLimitKmh : 55);
    setDeviationThresholdMeters(
      typeof cfg?.deviationThresholdMeters === "number" ? cfg.deviationThresholdMeters : 200
    );
    setAlertOnMissedStops(typeof cfg?.alertOnMissedStops === "boolean" ? cfg.alertOnMissedStops : true);
    setAlertOnDelay(typeof cfg?.alertOnDelay === "boolean" ? cfg.alertOnDelay : true);
    setRouteNotes(typeof cfg?.routeNotes === "string" ? cfg.routeNotes : "");
    if (typeof cfg?.routeDate === "string") setRouteDate(cfg.routeDate);

    try {
      const workspaceDraft: StoredPlannerWorkspace = {
        editingRouteId: asDuplicate ? null : r.id,
        routeName: resolvedName,
        routeDate: cfg?.routeDate || new Date().toISOString().split("T")[0],
        departureTime: r.start_time || cfg?.departureTime || "05:30",
        assignedVehicleId: r.vehicle_id || "",
        assignedDriverId: r.driver_id || "",
        startPoint: loadedStart,
        destinationPoint: loadedDest,
        roundTripType:
          cfg?.roundTripType || (loadedReturn.length > 0 ? "different_path" : "one_way"),
        revisitStopsOnReturn: Boolean(cfg?.revisitStopsOnReturn),
        outboundStops: loadedOutbound,
        returnStops: loadedReturn,
        speedLimitKmh: typeof cfg?.speedLimitKmh === "number" ? cfg.speedLimitKmh : 55,
        deviationThresholdMeters:
          typeof cfg?.deviationThresholdMeters === "number" ? cfg.deviationThresholdMeters : 200,
        alertOnMissedStops:
          typeof cfg?.alertOnMissedStops === "boolean" ? cfg.alertOnMissedStops : true,
        alertOnDelay: typeof cfg?.alertOnDelay === "boolean" ? cfg.alertOnDelay : true,
        routeNotes: typeof cfg?.routeNotes === "string" ? cfg.routeNotes : "",
        activeTab: "planner",
        lastUpdated: new Date().toISOString(),
      };
      localStorage.setItem(PLANNER_WORKSPACE_KEY, JSON.stringify(workspaceDraft));
    } catch {
      // Ignore
    }

    setActiveTab("planner");
    showToast(
      asDuplicate
        ? `Duplicated "${r.name}" into editor — click Save Route to store copy`
        : `Loaded "${r.name}" into Route Designer`,
      "info"
    );
  }

  // Safely archive a route (sets is_archived = true so historical trips & assignments stay intact)
  async function handleArchiveRoute(id: string, name: string) {
    if (
      !window.confirm(
        `Archive route "${name}"?\n\nIt will be removed from active Route Planner and Admin Assignment dropdowns, while preserving all historical trips and attendance reports.`
      )
    ) {
      return;
    }

    setArchivingRouteId(id);
    try {
      const res = await archiveCollectionRoute(supabase, id);
      if (!res.ok) {
        throw new Error(res.error || "Failed to archive route.");
      }

      setSavedRoutes((prev) => prev.filter((r) => r.id !== id));
      if (editingRouteId === id) {
        handleStartNewRoute(true);
      }
      if (viewingRoute?.id === id) setViewingRoute(null);
      showToast(`Route "${name}" archived safely.`);
    } catch (err: any) {
      console.error("Failed to archive route:", err);
      showToast("Failed to archive route: " + (err.message || "Database error"), "error");
    } finally {
      setArchivingRouteId(null);
    }
  }

  // Clear editor state completely for scratch manual route creation
  function handleStartNewRoute(silent = false) {
    const clean = createEmptyRouteDraft();
    setEditingRouteId(null);
    setSearchParams({}, { replace: true });
    setRouteName(clean.routeName);
    setDepartureTime(clean.departureTime);
    setAssignedVehicleId("");
    setAssignedDriverId("");
    setStartPoint(null);
    setDestinationPoint(null);
    setRoundTripType(clean.roundTripType);
    setRevisitStopsOnReturn(clean.revisitStopsOnReturn);
    setOutboundStops([]);
    setReturnStops([]);
    setSpeedLimitKmh(clean.speedLimitKmh);
    setDeviationThresholdMeters(clean.deviationThresholdMeters);
    setRouteNotes("");
    setOutboundRoadResult(null);
    setReturnRoadResult(null);
    setSearchResults([]);
    setSearchLocationQuery("");
    setSearchError(null);
    setActiveStopId(null);
    setShowManualStopForm(null);
    setMapClickMode("set_start");
    setActiveTab("planner");

    try {
      const cleanDraft: StoredPlannerWorkspace = {
        editingRouteId: null,
        routeName: "",
        routeDate: new Date().toISOString().split("T")[0],
        departureTime: clean.departureTime,
        assignedVehicleId: "",
        assignedDriverId: "",
        startPoint: null,
        destinationPoint: null,
        roundTripType: clean.roundTripType,
        revisitStopsOnReturn: clean.revisitStopsOnReturn,
        outboundStops: [],
        returnStops: [],
        speedLimitKmh: clean.speedLimitKmh,
        deviationThresholdMeters: clean.deviationThresholdMeters,
        alertOnMissedStops: true,
        alertOnDelay: true,
        routeNotes: "",
        activeTab: "planner",
        lastUpdated: new Date().toISOString(),
      };
      localStorage.setItem(PLANNER_WORKSPACE_KEY, JSON.stringify(cleanDraft));
    } catch {
      // Ignore
    }

    if (!silent) {
      showToast("Clean Route Designer ready. Set Origin, Destination & add stops.", "info");
    }
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

  // Filtered saved routes for quick search
  const filteredSavedRoutes = useMemo(() => {
    if (!savedRoutesSearch.trim()) return savedRoutes;
    const q = savedRoutesSearch.toLowerCase();
    return savedRoutes.filter((r) => {
      const v = dbVehicles.find((x) => x.id === r.vehicle_id);
      const d = dbDrivers.find((x) => x.id === r.driver_id);
      return (
        r.name?.toLowerCase().includes(q) ||
        v?.number?.toLowerCase().includes(q) ||
        d?.name?.toLowerCase().includes(q)
      );
    });
  }, [savedRoutes, savedRoutesSearch, dbVehicles, dbDrivers]);

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
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                  activeTab === "saved"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span>Saved Routes ({savedRoutes.length})</span>
                {editingRouteId && (
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" />
                )}
              </button>
            </div>

            <Button
              onClick={() => handleStartNewRoute()}
              variant="outline"
              className="text-xs px-2.5 py-1.5 rounded-xl flex items-center gap-1 border-slate-200 text-slate-700 hover:bg-slate-50"
              title="Clear editor and create a new manual route from scratch"
            >
              <Plus className="h-3.5 w-3.5" />
              Create New Route
            </Button>

            {editingRouteId ? (
              <div className="flex items-center gap-1.5">
                <Button
                  onClick={() => handleSaveRoute(false)}
                  disabled={isSaving}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-xs"
                >
                  {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Update Route
                </Button>
                <Button
                  onClick={() => handleSaveRoute(true)}
                  disabled={isSaving}
                  variant="outline"
                  className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 font-medium text-xs px-3 py-2 rounded-xl flex items-center gap-1.5"
                  title="Save current settings as a new separate route record"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Save as Copy
                </Button>
              </div>
            ) : (
              <Button
                onClick={() => handleSaveRoute(false)}
                disabled={isSaving}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-xs"
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save Route
              </Button>
            )}
          </div>
        }
      />

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div
          className={`px-4 py-2.5 rounded-xl text-sm font-medium flex items-center justify-between shadow-xs border ${
            toastMessage.type === "error"
              ? "bg-rose-50 border-rose-200 text-rose-900"
              : toastMessage.type === "info"
              ? "bg-slate-50 border-slate-200 text-slate-800"
              : "bg-indigo-50 border-indigo-200/80 text-indigo-900"
          }`}
        >
          <div className="flex items-center gap-2">
            {toastMessage.type === "error" ? (
              <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-indigo-600 shrink-0" />
            )}
            <span>{toastMessage.text}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Active Route Edit Banner */}
      {editingRouteId && activeTab === "planner" && (
        <div className="bg-indigo-50/70 border border-indigo-200/80 text-indigo-900 px-4 py-2 rounded-xl text-xs flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-indigo-600 animate-pulse" />
            <span className="font-semibold">Active Route: {routeName}</span>
            <span className="text-slate-400 hidden sm:inline">· ID: {editingRouteId.slice(0, 8)}...</span>
            <span className="text-[10px] text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded-md font-medium hidden sm:inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              Synced & Persisted
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleSaveRoute(false)}
              className="text-indigo-700 hover:text-indigo-900 font-semibold underline text-[11px]"
            >
              Update Route
            </button>
            <button
              onClick={() => handleStartNewRoute()}
              className="text-slate-500 hover:text-slate-700 text-[11px]"
            >
              Start New Route
            </button>
          </div>
        </div>
      )}

      {/* Unsaved Draft Banner */}
      {!editingRouteId && activeTab === "planner" && (
        <div className="bg-slate-50 border border-slate-200 text-slate-700 px-4 py-1.5 rounded-xl text-xs flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="font-medium">
              Manual Draft: {routeName.trim() || "Untitled Route"} ({outboundStops.length} outbound
              {roundTripType === "different_path" ? `, ${returnStops.length} return` : ""} stops)
            </span>
            <span className="text-[10px] text-slate-500 hidden sm:inline">· Saved only when confirmed in Supabase</span>
          </div>
          <div className="flex items-center gap-3">
            {(routeName || startPoint || destinationPoint || outboundStops.length > 0) && (
              <button
                onClick={() => handleStartNewRoute()}
                className="text-slate-500 hover:text-slate-800 text-[11px]"
              >
                Clear Designer
              </button>
            )}
            <button
              onClick={() => handleSaveRoute(false)}
              className="text-indigo-600 hover:text-indigo-800 font-semibold text-[11px] flex items-center gap-1"
            >
              <Save className="h-3 w-3" />
              Save to Supabase
            </button>
          </div>
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
          <div className="text-[11px] text-slate-500 mt-1">Drive + planned stop wait time</div>
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
                      {mapClickMode === "set_start"
                        ? "Click anywhere on the map to set Starting Location (Origin)"
                        : mapClickMode === "set_destination"
                        ? "Click anywhere on the map to set the Destination marker"
                        : mapClickMode === "add_return_stop"
                        ? "Click anywhere on the road to add a Return Stop"
                        : "Click anywhere on the road to add an Outbound Stop"}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Mode Selector */}
                  <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 text-[11px] shadow-2xs">
                    <button
                      type="button"
                      onClick={() => setMapClickMode("set_start")}
                      className={`px-2 py-1 rounded-md font-medium transition-all ${
                        mapClickMode === "set_start"
                          ? "bg-slate-900 text-white shadow-xs"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      Set Origin
                    </button>
                    <button
                      type="button"
                      onClick={() => setMapClickMode("add_stop")}
                      className={`px-2 py-1 rounded-md font-medium transition-all ${
                        mapClickMode === "add_stop"
                          ? "bg-indigo-600 text-white shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      + Outbound Stop
                    </button>
                    {roundTripType === "different_path" && (
                      <button
                        type="button"
                        onClick={() => setMapClickMode("add_return_stop")}
                        className={`px-2 py-1 rounded-md font-medium transition-all ${
                          mapClickMode === "add_return_stop"
                            ? "bg-emerald-600 text-white shadow-xs"
                            : "text-emerald-700 hover:bg-emerald-50"
                        }`}
                      >
                        + Return Stop
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setMapClickMode("set_destination")}
                      className={`px-2 py-1 rounded-md font-medium transition-all flex items-center gap-1 ${
                        mapClickMode === "set_destination"
                          ? "bg-amber-600 text-white shadow-xs"
                          : "text-amber-700 hover:text-amber-800"
                      }`}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Set Dest
                    </button>
                  </div>

                  {/* Map Legend */}
                  <div className="hidden sm:flex items-center gap-2.5 text-[11px] pl-1">
                    <div className="flex items-center gap-1">
                      <span className="h-2 w-4 rounded-xs bg-indigo-600 inline-block" />
                      <span className="font-medium text-slate-700">Outbound</span>
                    </div>
                    {roundTripType !== "one_way" && (
                      <div className="flex items-center gap-1">
                        <span className="h-2 w-4 rounded-xs bg-emerald-600 inline-block" />
                        <span className="font-medium text-slate-700">Return</span>
                      </div>
                    )}
                  </div>
                  {isCalculatingRoute && (
                    <div className="flex items-center gap-1 text-indigo-600 font-medium text-[11px]">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Calculating…</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Map Container */}
              <div className="relative h-[560px] w-full bg-slate-100">
                <GoogleRoutePlannerMap
                  outboundCoordinates={outboundRoadResult?.coordinates}
                  returnCoordinates={returnRoadResult?.coordinates}
                  startPoint={startPoint || undefined}
                  destinationPoint={destinationPoint || undefined}
                  outboundStops={outboundStops}
                  returnStops={returnStops}
                  roundTripType={roundTripType}
                  activeStopId={activeStopId}
                  onSelectStop={setActiveStopId}
                  onMapClick={handleMapClick}
                  height="100%"
                />
              </div>

              {/* Map Footer: Manual Location Search + CSV Import (No Presets/Templates) */}
              <div className="p-3 bg-white border-t border-slate-200/80 space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <form onSubmit={handleSearchLocation} className="flex items-center gap-1.5 flex-1 min-w-[240px]">
                    <div className="relative flex-1">
                      <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={searchLocationQuery}
                        onChange={(e) => setSearchLocationQuery(e.target.value)}
                        placeholder="Search town, centre or enter lat, lng (e.g. 8.1833, 77.4119)"
                        className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs bg-slate-50 focus:bg-white outline-none focus:border-indigo-500"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isSearchingLocation}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold inline-flex items-center gap-1"
                    >
                      {isSearchingLocation ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                      Search
                    </button>
                    {searchResults.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchResults([]);
                          setSearchError(null);
                        }}
                        className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                        title="Clear search results"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </form>

                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium">
                    <Upload className="h-3.5 w-3.5 text-slate-500" />
                    <span>Import Stops (CSV)</span>
                    <input type="file" accept=".csv" onChange={handleCsvImport} className="hidden" />
                  </label>
                </div>

                {searchError && (
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                    {searchError}
                  </div>
                )}

                {searchResults.length > 0 && (
                  <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-slate-50/70">
                    {searchResults.map((res, idx) => (
                      <div key={idx} className="p-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-slate-800 truncate">{res.name}</div>
                          <div className="text-[10px] text-slate-500 truncate">
                            {res.displayName} ({res.lat.toFixed(4)}, {res.lng.toFixed(4)})
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setStartPoint({ name: res.name, lat: res.lat, lng: res.lng });
                              showToast(`Origin set to ${res.name}`);
                            }}
                            className="px-2 py-1 rounded-md bg-slate-900 text-white text-[10px] font-semibold"
                          >
                            Set Origin
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOutboundStops((prev) => [
                                ...prev,
                                {
                                  id: `stop-${Date.now()}-${idx}`,
                                  name: res.name,
                                  lat: res.lat,
                                  lng: res.lng,
                                  serviceDurationMins: 5,
                                  isMandatory: true,
                                  status: "Pending",
                                },
                              ]);
                              showToast(`Added "${res.name}" to Outbound Stops`);
                            }}
                            className="px-2 py-1 rounded-md bg-indigo-600 text-white text-[10px] font-semibold"
                          >
                            + Outbound
                          </button>
                          {roundTripType === "different_path" && (
                            <button
                              type="button"
                              onClick={() => {
                                setReturnStops((prev) => [
                                  ...prev,
                                  {
                                    id: `ret-${Date.now()}-${idx}`,
                                    name: res.name,
                                    lat: res.lat,
                                    lng: res.lng,
                                    serviceDurationMins: 5,
                                    isMandatory: false,
                                    status: "Pending",
                                  },
                                ]);
                                showToast(`Added "${res.name}" to Return Stops`);
                              }}
                              className="px-2 py-1 rounded-md bg-emerald-600 text-white text-[10px] font-semibold"
                            >
                              + Return
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setDestinationPoint({ name: res.name, lat: res.lat, lng: res.lng });
                              showToast(`Destination set to ${res.name}`);
                            }}
                            className="px-2 py-1 rounded-md bg-amber-600 text-white text-[10px] font-semibold"
                          >
                            Set Dest
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
                  Route Details
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

                {/* Manual Origin & Destination Controls (Search or Pick on Map) */}
                <div className="pt-2 border-t border-slate-100 space-y-3">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 flex items-center justify-between mb-1">
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-slate-900 inline-block" />
                        <span>Starting Location (Origin) *</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setMapClickMode("set_start");
                          showToast("Click on the map to set Starting Location");
                        }}
                        className="text-[10px] text-indigo-700 hover:underline font-semibold"
                      >
                        Pick on map
                      </button>
                    </label>
                    <input
                      type="text"
                      value={startPoint?.name || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setStartPoint((prev) =>
                          prev
                            ? { ...prev, name: val }
                            : { name: val, lat: NANJIL_DAIRY_DEPOT.lat, lng: NANJIL_DAIRY_DEPOT.lng }
                        );
                      }}
                      placeholder="Type starting location name or Pick on map..."
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white outline-none focus:border-indigo-500 font-medium text-slate-800"
                    />
                    <div className="grid grid-cols-2 gap-1.5 mt-1">
                      <input
                        type="number"
                        step="0.0001"
                        value={startPoint?.lat ?? ""}
                        onChange={(e) => {
                          const lat = parseFloat(e.target.value);
                          if (!Number.isFinite(lat)) return;
                          setStartPoint((prev) => ({
                            name: prev?.name || "Origin",
                            lat,
                            lng: prev?.lng ?? 77.2884,
                          }));
                        }}
                        placeholder="Lat (e.g. 8.2607)"
                        className="text-[11px] px-2 py-1 rounded border border-slate-200 bg-slate-50 font-mono"
                      />
                      <input
                        type="number"
                        step="0.0001"
                        value={startPoint?.lng ?? ""}
                        onChange={(e) => {
                          const lng = parseFloat(e.target.value);
                          if (!Number.isFinite(lng)) return;
                          setStartPoint((prev) => ({
                            name: prev?.name || "Origin",
                            lat: prev?.lat ?? 8.2607,
                            lng,
                          }));
                        }}
                        placeholder="Lng (e.g. 77.2883)"
                        className="text-[11px] px-2 py-1 rounded border border-slate-200 bg-slate-50 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 flex items-center justify-between mb-1">
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-amber-600 inline-block" />
                        <span>Destination *</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setMapClickMode("set_destination");
                          showToast("Click anywhere on the map to set Destination");
                        }}
                        className="text-[10px] text-amber-700 hover:underline font-semibold"
                      >
                        Pick on map
                      </button>
                    </label>
                    <input
                      type="text"
                      value={destinationPoint?.name || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDestinationPoint((prev) =>
                          prev
                            ? { ...prev, name: val }
                            : { name: val, lat: NANJIL_DAIRY_DEPOT.lat, lng: NANJIL_DAIRY_DEPOT.lng }
                        );
                      }}
                      placeholder="Type destination name or Pick on map..."
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50/40 outline-none focus:border-amber-500 font-semibold text-amber-950"
                    />
                    <div className="grid grid-cols-2 gap-1.5 mt-1">
                      <input
                        type="number"
                        step="0.0001"
                        value={destinationPoint?.lat ?? ""}
                        onChange={(e) => {
                          const lat = parseFloat(e.target.value);
                          if (!Number.isFinite(lat)) return;
                          setDestinationPoint((prev) => ({
                            name: prev?.name || "Destination",
                            lat,
                            lng: prev?.lng ?? 77.2884,
                          }));
                        }}
                        placeholder="Lat (e.g. 8.0883)"
                        className="text-[11px] px-2 py-1 rounded border border-slate-200 bg-slate-50 font-mono"
                      />
                      <input
                        type="number"
                        step="0.0001"
                        value={destinationPoint?.lng ?? ""}
                        onChange={(e) => {
                          const lng = parseFloat(e.target.value);
                          if (!Number.isFinite(lng)) return;
                          setDestinationPoint((prev) => ({
                            name: prev?.name || "Destination",
                            lat: prev?.lat ?? 8.0883,
                            lng,
                          }));
                        }}
                        placeholder="Lng (e.g. 77.5385)"
                        className="text-[11px] px-2 py-1 rounded border border-slate-200 bg-slate-50 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                      Route Notes (Optional)
                    </label>
                    <input
                      type="text"
                      value={routeNotes}
                      onChange={(e) => setRouteNotes(e.target.value)}
                      placeholder="Special collection instructions, seals, or shift notes..."
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 outline-none focus:border-indigo-500"
                    />
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

            {/* 3. Outbound Stop Sequence Manager */}
            <Card className="border border-slate-200/80 shadow-xs p-4 flex flex-col max-h-[540px]">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-indigo-600" />
                    Outbound Stops Sequence ({outboundStops.length})
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Click map, search place, or add manually · Drag or use arrows to reorder
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowManualStopForm((prev) => (prev === "outbound" ? null : "outbound"));
                    setManualStopName("");
                    setManualStopLat(startPoint?.lat ? String(startPoint.lat) : "");
                    setManualStopLng(startPoint?.lng ? String(startPoint.lng) : "");
                    setManualStopDuration(5);
                    setManualStopMandatory(true);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-semibold hover:bg-indigo-100"
                >
                  <Plus className="h-3 w-3" />
                  Add Stop
                </button>
              </div>

              {showManualStopForm === "outbound" && (
                <form
                  onSubmit={handleSubmitManualStop}
                  className="mb-3 p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-2 text-xs"
                >
                  <div className="font-bold text-indigo-900 text-[11px]">Add Outbound Stop Manually</div>
                  <input
                    type="text"
                    value={manualStopName}
                    onChange={(e) => setManualStopName(e.target.value)}
                    placeholder="Stop / Collection Centre Name *"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-white outline-none text-xs"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="number"
                      step="0.0001"
                      value={manualStopLat}
                      onChange={(e) => setManualStopLat(e.target.value)}
                      placeholder="Lat *"
                      className="px-2 py-1.5 rounded-lg border border-indigo-200 bg-white text-xs font-mono"
                    />
                    <input
                      type="number"
                      step="0.0001"
                      value={manualStopLng}
                      onChange={(e) => setManualStopLng(e.target.value)}
                      placeholder="Lng *"
                      className="px-2 py-1.5 rounded-lg border border-indigo-200 bg-white text-xs font-mono"
                    />
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={manualStopDuration}
                      onChange={(e) => setManualStopDuration(Number(e.target.value))}
                      placeholder="Wait (min)"
                      className="px-2 py-1.5 rounded-lg border border-indigo-200 bg-white text-xs"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={manualStopMandatory}
                        onChange={(e) => setManualStopMandatory(e.target.checked)}
                      />
                      Mandatory Stop
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowManualStopForm(null)}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-600"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-3 py-1 rounded-lg bg-indigo-600 text-white font-semibold"
                      >
                        Add Stop
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* Scrollable Outbound Stops List */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {outboundStops.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
                    No outbound stops yet. Click on the map, search a location above, or click <strong>+ Add Stop</strong>.
                  </div>
                ) : (
                  outboundStops.map((stop, index) => (
                    <div
                      key={stop.id}
                      draggable
                      onDragStart={() => setDraggedStop({ index, isReturn: false })}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (draggedStop && !draggedStop.isReturn) {
                          reorderStopByDragDrop(draggedStop.index, index, false);
                        }
                        setDraggedStop(null);
                      }}
                      className={`p-2.5 rounded-xl border text-xs transition-all cursor-grab active:cursor-grabbing ${
                        activeStopId === stop.id
                          ? "border-indigo-400 bg-indigo-50/50"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="h-5 w-5 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                            {index + 1}
                          </span>
                          <input
                            type="text"
                            value={stop.name}
                            onChange={(e) => updateStopFields(stop.id, { name: e.target.value }, false)}
                            onClick={() => setActiveStopId(stop.id)}
                            className="w-full font-semibold text-slate-800 bg-transparent border-b border-transparent focus:border-indigo-400 focus:bg-white px-1 py-0.5 outline-none"
                          />
                        </div>

                        {/* Reorder and action controls */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => moveStop(index, "up")}
                            disabled={index === 0}
                            className="p-1 rounded text-slate-400 hover:text-slate-800 disabled:opacity-30"
                            title="Move up"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveStop(index, "down")}
                            disabled={index === outboundStops.length - 1}
                            className="p-1 rounded text-slate-400 hover:text-slate-800 disabled:opacity-30"
                            title="Move down"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => duplicateStop(stop)}
                            className="p-1 rounded text-slate-400 hover:text-indigo-600"
                            title="Duplicate stop"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setEditingCoordsStopId((prev) => (prev === stop.id ? null : stop.id))
                            }
                            className="p-1 rounded text-slate-400 hover:text-indigo-600"
                            title="Edit coordinates"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteStop(stop.id)}
                            className="p-1 rounded text-slate-400 hover:text-red-600"
                            title="Remove stop"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {editingCoordsStopId === stop.id && (
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                          <input
                            type="number"
                            step="0.0001"
                            value={stop.lat}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (Number.isFinite(v)) updateStopFields(stop.id, { lat: v }, false);
                            }}
                            className="px-2 py-1 rounded border border-slate-200 text-[11px] font-mono bg-slate-50"
                          />
                          <input
                            type="number"
                            step="0.0001"
                            value={stop.lng}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (Number.isFinite(v)) updateStopFields(stop.id, { lng: v }, false);
                            }}
                            className="px-2 py-1 rounded border border-slate-200 text-[11px] font-mono bg-slate-50"
                          />
                        </div>
                      )}

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
                          <span>mins · {stop.lat.toFixed(4)}, {stop.lng.toFixed(4)}</span>
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
                  ))
                )}
              </div>
            </Card>

            {/* 3B. Independent Return Stops Manager (for Different Return Path) */}
            {roundTripType === "different_path" && (
              <Card className="border border-emerald-200/80 shadow-xs p-4 flex flex-col max-h-[380px]">
                <div className="flex items-center justify-between border-b border-emerald-100 pb-2.5 mb-3">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                      <RotateCcw className="h-3.5 w-3.5 text-emerald-600" />
                      Return Stops Sequence ({returnStops.length})
                    </div>
                    <div className="text-[10px] text-slate-500">Stops visited on return leg back to Origin</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowManualStopForm((prev) => (prev === "return" ? null : "return"));
                      setManualStopName("");
                      setManualStopLat(destinationPoint?.lat ? String(destinationPoint.lat) : "");
                      setManualStopLng(destinationPoint?.lng ? String(destinationPoint.lng) : "");
                      setManualStopDuration(5);
                      setManualStopMandatory(false);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100"
                  >
                    <Plus className="h-3 w-3" />
                    Add Return Stop
                  </button>
                </div>

                {showManualStopForm === "return" && (
                  <form
                    onSubmit={handleSubmitManualStop}
                    className="mb-3 p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-2 text-xs"
                  >
                    <div className="font-bold text-emerald-900 text-[11px]">Add Return Stop Manually</div>
                    <input
                      type="text"
                      value={manualStopName}
                      onChange={(e) => setManualStopName(e.target.value)}
                      placeholder="Return Stop Name *"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-white outline-none text-xs"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        step="0.0001"
                        value={manualStopLat}
                        onChange={(e) => setManualStopLat(e.target.value)}
                        placeholder="Lat *"
                        className="px-2 py-1.5 rounded-lg border border-emerald-200 bg-white text-xs font-mono"
                      />
                      <input
                        type="number"
                        step="0.0001"
                        value={manualStopLng}
                        onChange={(e) => setManualStopLng(e.target.value)}
                        placeholder="Lng *"
                        className="px-2 py-1.5 rounded-lg border border-emerald-200 bg-white text-xs font-mono"
                      />
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={manualStopDuration}
                        onChange={(e) => setManualStopDuration(Number(e.target.value))}
                        placeholder="Wait (min)"
                        className="px-2 py-1.5 rounded-lg border border-emerald-200 bg-white text-xs"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowManualStopForm(null)}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-600"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-3 py-1 rounded-lg bg-emerald-600 text-white font-semibold"
                      >
                        Add Return Stop
                      </button>
                    </div>
                  </form>
                )}

                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {returnStops.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-400 border border-dashed border-emerald-200 rounded-xl">
                      No return stops yet. Switch map click mode to <strong>+ Return Stop</strong> or click <strong>Add Return Stop</strong>.
                    </div>
                  ) : (
                    returnStops.map((stop, index) => (
                      <div
                        key={stop.id}
                        draggable
                        onDragStart={() => setDraggedStop({ index, isReturn: true })}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (draggedStop && draggedStop.isReturn) {
                            reorderStopByDragDrop(draggedStop.index, index, true);
                          }
                          setDraggedStop(null);
                        }}
                        className="p-2.5 rounded-xl border border-emerald-200/80 bg-white text-xs cursor-grab"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="h-5 w-5 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                              R{index + 1}
                            </span>
                            <input
                              type="text"
                              value={stop.name}
                              onChange={(e) => updateStopFields(stop.id, { name: e.target.value }, true)}
                              className="w-full font-semibold text-slate-800 bg-transparent border-b border-transparent focus:border-emerald-400 px-1 py-0.5 outline-none"
                            />
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => moveStop(index, "up", true)}
                              disabled={index === 0}
                              className="p-1 rounded text-slate-400 hover:text-slate-800 disabled:opacity-30"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveStop(index, "down", true)}
                              disabled={index === returnStops.length - 1}
                              className="p-1 rounded text-slate-400 hover:text-slate-800 disabled:opacity-30"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteStop(stop.id, true)}
                              className="p-1 rounded text-slate-400 hover:text-red-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                          <span>
                            Wait: {stop.serviceDurationMins || 5}m · {stop.lat.toFixed(4)}, {stop.lng.toFixed(4)}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleStopMandatory(stop.id, true)}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              stop.isMandatory
                                ? "bg-red-50 text-red-700 border border-red-200"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {stop.isMandatory ? "Mandatory" : "Optional"}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            )}

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
                <GoogleRoutePlannerMap
                  outboundCoordinates={outboundRoadResult?.coordinates}
                  outboundStops={outboundStops}
                  interactive={false}
                  activeVehicle={activeVehicle}
                  height="100%"
                />
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <div className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span>Active Saved Collection Routes</span>
                <Badge variant="outline" className="bg-indigo-50 text-indigo-700 text-xs font-semibold">
                  {savedRoutes.length} Active in Supabase
                </Badge>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Single source of truth synced with Driver &amp; Route Assignment and Driver Portal
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter routes..."
                  value={savedRoutesSearch}
                  onChange={(e) => setSavedRoutesSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-indigo-500 w-44 sm:w-56"
                />
              </div>

              <Button
                onClick={loadSavedRoutes}
                disabled={isLoadingRoutes}
                variant="outline"
                className="text-xs px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 border-slate-200 text-slate-700 hover:bg-slate-50"
                title="Refresh routes from Supabase database"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoadingRoutes ? "animate-spin" : ""}`} />
                Refresh
              </Button>

              <Button
                onClick={() => handleStartNewRoute()}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                New Route
              </Button>
            </div>
          </div>

          {isLoadingRoutes && savedRoutes.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <Loader2 className="h-7 w-7 text-indigo-600 animate-spin mx-auto" />
              <div className="text-xs text-slate-500">Loading saved routes from Supabase...</div>
            </div>
          ) : filteredSavedRoutes.length === 0 ? (
            <div className="py-14 text-center space-y-3">
              <div className="h-12 w-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
                <RouteIcon className="h-6 w-6" />
              </div>
              <div className="text-sm font-bold text-slate-800">
                {savedRoutesSearch ? "No routes matching your search" : "No active routes saved yet"}
              </div>
              <div className="text-xs text-slate-500 max-w-sm mx-auto">
                {savedRoutesSearch
                  ? `No routes found matching "${savedRoutesSearch}". Try clearing your search.`
                  : "Create routes manually from scratch in Route Designer and click Save Route to store them in Supabase."}
              </div>
              {savedRoutesSearch ? (
                <Button
                  onClick={() => setSavedRoutesSearch("")}
                  variant="outline"
                  className="text-xs px-3 py-1.5 rounded-xl"
                >
                  Clear Search
                </Button>
              ) : (
                <Button
                  onClick={() => handleStartNewRoute()}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-4 py-2 rounded-xl"
                >
                  Create New Manual Route
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-semibold bg-slate-50/50">
                    <th className="py-2.5 px-3">Route Name</th>
                    <th className="py-2.5 px-3">Start → Destination</th>
                    <th className="py-2.5 px-3">Mode</th>
                    <th className="py-2.5 px-3">Stops / Distance</th>
                    <th className="py-2.5 px-3">Est. Time &amp; Dep</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSavedRoutes.map((r) => {
                    const cfg = r.route_config;
                    const mode = cfg?.roundTripType || "one_way";
                    const distKm = cfg?.totalDistanceKm || null;
                    const durMins = cfg?.totalDurationMins || null;
                    const outCount = Array.isArray(cfg?.outboundStops) ? cfg.outboundStops.length : 0;
                    const retCount = Array.isArray(cfg?.returnStops) ? cfg.returnStops.length : 0;
                    const startName = cfg?.startPoint?.name || "Not configured";
                    const destName = cfg?.destinationPoint?.name || cfg?.destination?.name || "Not configured";
                    const validCfg = isValidSavedRoute(r);
                    const isCurrent = editingRouteId === r.id;

                    return (
                      <tr
                        key={r.id}
                        className={`hover:bg-slate-50/70 transition-colors ${
                          isCurrent ? "bg-indigo-50/30 font-medium" : ""
                        }`}
                      >
                        <td className="py-3 px-3">
                          <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                            {r.name}
                            {isCurrent && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold uppercase">
                                Editing
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            Created {r.created_at ? new Date(r.created_at).toLocaleDateString() : "Recently"}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-slate-700">
                          <div className="font-medium text-slate-800 truncate max-w-[200px]" title={startName}>
                            {startName}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate max-w-[200px]" title={destName}>
                            → {destName}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              mode === "same_path"
                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                : mode === "different_path"
                                ? "bg-purple-50 text-purple-700 border-purple-200"
                                : "bg-emerald-50 text-emerald-700 border-emerald-200"
                            }`}
                          >
                            {mode === "same_path"
                              ? "Same Path"
                              : mode === "different_path"
                              ? "Different Return"
                              : "One-Way"}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 font-semibold text-indigo-700">
                          {outCount + retCount || r.centres || 0} stops
                          {retCount > 0 ? ` (${outCount}+${retCount})` : ""}
                          {distKm ? (
                            <div className="text-[10px] text-slate-500 font-normal">{distKm} km</div>
                          ) : null}
                        </td>
                        <td className="py-3 px-3 text-slate-600">
                          <div>Dep: {r.start_time || cfg?.departureTime || "05:30"}</div>
                          {durMins ? (
                            <div className="text-[10px] text-slate-400">{formatDurationMins(durMins)}</div>
                          ) : null}
                        </td>
                        <td className="py-3 px-3">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              validCfg
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-amber-50 text-amber-700 border-amber-200"
                            }`}
                          >
                            {validCfg ? "Ready" : "Incomplete"}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setViewingRoute(r)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-700 hover:bg-indigo-50 transition-colors"
                              title="View full stop sequence"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            <Button
                              onClick={() => handleOpenInDesigner(r, false)}
                              className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs px-2.5 py-1 rounded-lg flex items-center gap-1 font-medium transition-colors"
                              title="Edit route in Route Designer"
                            >
                              <Edit className="h-3 w-3" />
                              Edit
                            </Button>
                            <button
                              type="button"
                              onClick={() => handleOpenInDesigner(r, true)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-slate-100 transition-colors"
                              title="Duplicate route into editor"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={archivingRouteId === r.id}
                              onClick={() => handleArchiveRoute(r.id, r.name)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-40"
                              title="Archive route (preserves trip & assignment history)"
                            >
                              {archivingRouteId === r.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Route Preview Modal */}
      {viewingRoute && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Saved Route Details
                </div>
                <div className="text-base font-bold">{viewingRoute.name}</div>
              </div>
              <button
                type="button"
                onClick={() => setViewingRoute(null)}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Origin</div>
                  <div className="font-semibold text-slate-900">
                    {viewingRoute.route_config?.startPoint?.name || "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Destination</div>
                  <div className="font-semibold text-slate-900">
                    {viewingRoute.route_config?.destinationPoint?.name || "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Departure Time</div>
                  <div className="font-semibold">{viewingRoute.start_time || "05:30"}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Distance / Est. Time</div>
                  <div className="font-semibold">
                    {viewingRoute.route_config?.totalDistanceKm || 0} km ·{" "}
                    {formatDurationMins(viewingRoute.route_config?.totalDurationMins || 0)}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase text-slate-500 mb-1.5">
                  Outbound Stops ({viewingRoute.route_config?.outboundStops?.length || 0})
                </div>
                <div className="space-y-1">
                  {(viewingRoute.route_config?.outboundStops || []).map((s: any, idx: number) => (
                    <div
                      key={s.id || idx}
                      className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200/70"
                    >
                      <div className="flex items-center gap-2">
                        <span className="h-5 w-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <span className="font-semibold text-slate-800">{s.name}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {Number(s.lat).toFixed(4)}, {Number(s.lng).toFixed(4)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {Array.isArray(viewingRoute.route_config?.returnStops) &&
                viewingRoute.route_config.returnStops.length > 0 && (
                  <div>
                    <div className="text-[11px] font-bold uppercase text-emerald-700 mb-1.5">
                      Return Stops ({viewingRoute.route_config.returnStops.length})
                    </div>
                    <div className="space-y-1">
                      {viewingRoute.route_config.returnStops.map((s: any, idx: number) => (
                        <div
                          key={s.id || idx}
                          className="flex items-center justify-between p-2 rounded-lg bg-emerald-50/50 border border-emerald-200/70"
                        >
                          <div className="flex items-center gap-2">
                            <span className="h-5 w-5 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center">
                              R{idx + 1}
                            </span>
                            <span className="font-semibold text-slate-800">{s.name}</span>
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {Number(s.lat).toFixed(4)}, {Number(s.lng).toFixed(4)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setViewingRoute(null)}
                  className="text-xs px-3 py-1.5 rounded-xl"
                >
                  Close
                </Button>
                <Button
                  onClick={() => {
                    const target = viewingRoute;
                    setViewingRoute(null);
                    handleOpenInDesigner(target, false);
                  }}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1.5 rounded-xl"
                >
                  Edit in Designer
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
