import { useState, useMemo, useEffect, useRef } from "react";
import {
  Map,
  AdvancedMarker,
  InfoWindow,
  Polyline,
  useMap,
} from "@vis.gl/react-google-maps";
import type { Vehicle } from "@/lib/types";
import { Truck, Navigation, MapPin, AlertTriangle, Factory, Route as RouteIcon } from "lucide-react";
import { Badge } from "@/components/ui-kit";
import { Link } from "react-router-dom";
import { getOverspeedStatus } from "@/lib/overspeed";
import { isFleetOperatingCoordinate, haversineDistanceKm } from "@/lib/tripHistoryEngine";
import { KNOWN_NANJIL_DEVICE_MAP } from "@/lib/vehicle-stop-detection";
import { type VehicleOdometerState, loadLocalOdometerStates } from "@/lib/odometerTrackingEngine";
import {
  NANJIL_DAIRY_DEPOT,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  GOOGLE_MAPS_MAP_ID,
  GOOGLE_MAPS_API_KEY,
  getVehicleStatusColor,
  getVehicleRegistrationNumber,
  isValidFleetCoord,
  toFleetCoord,
} from "./mapConstants";

export { isValidFleetCoord, toFleetCoord };

export interface GoogleVehicleMapProps {
  vehicles: Vehicle[];
  height?: number;
  selectedId?: string;
  onSelectVehicle?: (vehicle: Vehicle) => void;
  routeHistory?: Array<{ lat: number; lng: number }>;
  todayRoutes?: Record<string, Array<Array<{ lat: number; lng: number }>>>;
  plantConnectors?: Record<string, Array<Array<{ lat: number; lng: number }>>>;
  tripStartTimes?: Record<string, string>;
  odometerStates?: Record<string, VehicleOdometerState>;
  getVehicleOdometer?: (idOrDeviceId?: string) => VehicleOdometerState;
}

export function GoogleVehicleMap({
  vehicles,
  height = 520,
  selectedId,
  onSelectVehicle,
  routeHistory,
  todayRoutes,
  plantConnectors,
  tripStartTimes,
  odometerStates,
  getVehicleOdometer,
}: GoogleVehicleMapProps) {
  const map = useMap();

  const [active, setActive] = useState<Vehicle | null>(
    selectedId ? (vehicles.find((v) => v.id === selectedId) ?? null) : null,
  );

  // Synchronize active vehicle selection whenever selectedId changes externally
  useEffect(() => {
    if (selectedId) {
      const match = vehicles.find((v) => v.id === selectedId || v.deviceId === selectedId);
      if (match) {
        setActive(match);
      }
    }
  }, [selectedId, vehicles]);

  // Always resolve the latest live vehicle object from vehicles stream to keep popup in sync with sidebar
  const currentActive = useMemo(() => {
    if (!active) return null;
    return vehicles.find((v) => v.id === active.id || (v.deviceId && v.deviceId === active.deviceId)) ?? active;
  }, [active, vehicles]);

  // Synchronize live odometer reading with sidebar and top header
  const activeOdo = useMemo(() => {
    if (!currentActive) return null;
    if (getVehicleOdometer) {
      if (currentActive.id) {
        const byId = getVehicleOdometer(currentActive.id);
        if (byId && byId.totalOdometerKm > 0) return byId;
      }
      if (currentActive.deviceId) {
        const byDev = getVehicleOdometer(currentActive.deviceId);
        if (byDev && byDev.totalOdometerKm > 0) return byDev;
        const byClean = getVehicleOdometer(currentActive.deviceId.replace(/^device_/, ""));
        if (byClean && byClean.totalOdometerKm > 0) return byClean;
      }
      return getVehicleOdometer(currentActive.id || currentActive.deviceId);
    }
    if (odometerStates) {
      return (
        odometerStates[currentActive.id] ||
        (currentActive.deviceId && odometerStates[currentActive.deviceId]) ||
        (currentActive.deviceId && odometerStates[currentActive.deviceId.replace(/^device_/, "")]) ||
        null
      );
    }
    const local = loadLocalOdometerStates();
    return (
      local[currentActive.id] ||
      (currentActive.deviceId && local[currentActive.deviceId]) ||
      (currentActive.deviceId && local[currentActive.deviceId.replace(/^device_/, "")]) ||
      null
    );
  }, [currentActive, getVehicleOdometer, odometerStates]);

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div
        className="flex flex-col items-center justify-center w-full p-6 text-center bg-slate-50 border border-slate-200 rounded-xl"
        style={{ height }}
      >
        <div className="h-10 w-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center mb-2">
          <MapPin className="h-5 w-5" />
        </div>
        <h4 className="text-xs font-bold text-slate-800">Google Maps API Key Required</h4>
        <p className="text-[11px] text-slate-500 max-w-sm mt-1">
          Configure <code className="bg-slate-200 px-1 py-0.5 rounded text-[10px] font-mono">VITE_GOOGLE_MAPS_API_KEY</code> in <code className="bg-slate-200 px-1 py-0.5 rounded text-[10px] font-mono">.env</code>.
        </p>
      </div>
    );
  }

  // Only show vehicles that have actual valid numeric GPS coordinates within the fleet operating geofence
  const mappedVehicles = useMemo(() => {
    return vehicles
      .map((v) => {
        const coord =
          toFleetCoord({ lat: v.lat, lng: v.lng }) ||
          (v.location ? toFleetCoord(v.location) : null);
        if (coord) {
          return { ...v, lat: coord.lat, lng: coord.lng };
        }
        return { ...v, lat: NANJIL_DAIRY_DEPOT.lat, lng: NANJIL_DAIRY_DEPOT.lng };
      })
      .filter(
        (v) =>
          isValidFleetCoord({ lat: v.lat, lng: v.lng }) &&
          isFleetOperatingCoordinate(v.lat, v.lng),
      );
  }, [vehicles]);

  const initialCenter = useMemo(() => {
    if (selectedId) {
      const v = mappedVehicles.find((x) => x.id === selectedId || x.deviceId === selectedId);
      if (v && isValidFleetCoord({ lat: v.lat, lng: v.lng })) {
        return { lat: Number(v.lat), lng: Number(v.lng) };
      }
    }
    if (mappedVehicles.length > 0) {
      const valid = mappedVehicles.filter((v) => isValidFleetCoord({ lat: v.lat, lng: v.lng }));
      if (valid.length > 0) {
        const lat = valid.reduce((s, v) => s + Number(v.lat), 0) / valid.length;
        const lng = valid.reduce((s, v) => s + Number(v.lng), 0) / valid.length;
        if (isValidFleetCoord({ lat, lng })) return { lat, lng };
      }
    }
    return DEFAULT_MAP_CENTER;
  }, [mappedVehicles, selectedId]);

  // Keep track of the active selection so camera auto-fit only runs when selection changes,
  // preventing zoom-out reset on real-time GPS telemetry updates or popup open/close
  const lastHandledSelectionRef = useRef<string | null>(null);

  // Handle selectedId camera fitBounds & auto-centering
  useEffect(() => {
    if (!map) return;

    // When selection is cleared, reset the tracked ref and do not zoom out
    if (!selectedId) {
      lastHandledSelectionRef.current = null;
      return;
    }

    // Guard: Only adjust camera when selectedId actually changes
    if (lastHandledSelectionRef.current === selectedId) {
      return;
    }
    lastHandledSelectionRef.current = selectedId;

    const match =
      mappedVehicles.find((v) => v.id === selectedId || v.deviceId === selectedId) ||
      vehicles.find((v) => v.id === selectedId || v.deviceId === selectedId);
    if (!match) return;

    setActive(match);

    const cleanDev = match.deviceId ? match.deviceId.replace(/^device_/, "") : undefined;
    const segs =
      todayRoutes?.[match.id] ||
      (match.deviceId ? todayRoutes?.[match.deviceId] : undefined) ||
      (cleanDev ? todayRoutes?.[cleanDev] : undefined) ||
      (cleanDev ? todayRoutes?.[`device_${cleanDev}`] : undefined) ||
      (cleanDev && KNOWN_NANJIL_DEVICE_MAP[cleanDev] ? todayRoutes?.[KNOWN_NANJIL_DEVICE_MAP[cleanDev].id] : undefined);

    const connPts =
      plantConnectors?.[match.id]?.[0] ||
      (match.deviceId ? plantConnectors?.[match.deviceId]?.[0] : undefined) ||
      (cleanDev ? plantConnectors?.[cleanDev]?.[0] : undefined);

    // Collect valid coordinates strictly per requirements:
    // 1. Include selected vehicle's current position
    // 2. Include selected vehicle's valid route points
    // 3. Include Nanjil Dairy Plant ONLY when displaying its relevant connector
    // 4. Exclude unrelated vehicles and invalid GPS points
    const validPoints: Array<{ lat: number; lng: number }> = [];

    // 1. Current position
    const matchCoord =
      toFleetCoord({ lat: match.lat, lng: match.lng }) ||
      (match.location ? toFleetCoord(match.location) : null);
    if (matchCoord) {
      validPoints.push(matchCoord);
    }

    // 2. Travelled route points
    if (segs && Array.isArray(segs)) {
      segs.forEach((seg) => {
        if (Array.isArray(seg)) {
          seg.forEach((pt) => {
            if (isValidFleetCoord(pt)) {
              validPoints.push({ lat: Number(pt.lat), lng: Number(pt.lng) });
            }
          });
        }
      });
    }

    // 3. Include Nanjil Dairy Plant and connector points ONLY when displaying its relevant connector
    const hasValidConnector = Boolean(connPts && Array.isArray(connPts) && connPts.length >= 2);
    if (hasValidConnector) {
      if (isValidFleetCoord(NANJIL_DAIRY_DEPOT)) {
        validPoints.push(NANJIL_DAIRY_DEPOT);
      }
      connPts.forEach((pt) => {
        if (isValidFleetCoord(pt)) {
          validPoints.push({ lat: Number(pt.lat), lng: Number(pt.lng) });
        }
      });
    }

    // Case A: No valid points at all -> center on Nanjil Dairy Depot
    if (validPoints.length === 0) {
      map.setCenter(NANJIL_DAIRY_DEPOT);
      map.setZoom(14);
      return;
    }

    // Case B: If only one valid location exists, use setCenter() and an appropriate zoom level instead of fitBounds()
    if (validPoints.length === 1) {
      map.setCenter(validPoints[0]);
      map.setZoom(15);
      return;
    }

    // Case C: Multiple points exist -> calculate bounding box span
    let minLat = validPoints[0].lat;
    let maxLat = validPoints[0].lat;
    let minLng = validPoints[0].lng;
    let maxLng = validPoints[0].lng;

    for (let i = 1; i < validPoints.length; i++) {
      const p = validPoints[i];
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }

    const spanLat = maxLat - minLat;
    const spanLng = maxLng - minLng;

    // If span is minuscule (< ~200 meters, e.g. vehicle stationary at yard), center with zoom 15 instead of fitBounds()
    if (spanLat < 0.002 && spanLng < 0.002) {
      map.setCenter({ lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 });
      map.setZoom(15);
      return;
    }

    // Multiple points with distinct spatial span -> safely fitBounds
    if (typeof google !== "undefined" && google.maps && google.maps.LatLngBounds) {
      const bounds = new google.maps.LatLngBounds();
      validPoints.forEach((pt) => bounds.extend(pt));

      map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });

      // Add one-time idle listener to prevent auto-fit over/under-zooming
      const listener = google.maps.event.addListenerOnce(map, "idle", () => {
        const currentZoom = map.getZoom();
        if (currentZoom !== undefined) {
          if (currentZoom < 8) map.setZoom(8);
          if (currentZoom > 16) map.setZoom(15);
        }
      });
    } else {
      map.setCenter(validPoints[0]);
      map.setZoom(14);
    }
  }, [selectedId, vehicles, map, todayRoutes, plantConnectors]);

  // Check whether the active / selected vehicle has a valid today route
  const activeHasRoute = useMemo(() => {
    if (!active || !todayRoutes) return false;
    const cleanDev = active.deviceId ? active.deviceId.replace(/^device_/, "") : undefined;
    const segs =
      todayRoutes[active.id] ||
      (active.deviceId ? todayRoutes[active.deviceId] : undefined) ||
      (cleanDev ? todayRoutes[cleanDev] : undefined) ||
      (cleanDev ? todayRoutes[`device_${cleanDev}`] : undefined) ||
      (cleanDev && KNOWN_NANJIL_DEVICE_MAP[cleanDev] ? todayRoutes[KNOWN_NANJIL_DEVICE_MAP[cleanDev].id] : undefined);
    if (!segs || segs.length === 0) return false;
    return segs.some((s) => s && s.length >= 2);
  }, [active, todayRoutes]);

  // Prepare Today's Travelled GPS Route Segments (Red Polyline, 5px, 0.9 opacity)
  const renderedRouteSegments = useMemo(() => {
    const list: Array<{
      key: string;
      path: Array<{ lat: number; lng: number }>;
      isSelected: boolean;
    }> = [];

    // 1. If todayRoutes map is provided, render all vehicle routes
    if (todayRoutes && Object.keys(todayRoutes).length > 0) {
      const renderedVehicleKeys = new Set<string>();

      const getSegmentsForVehicle = (v: Vehicle): Array<Array<{ lat: number; lng: number }>> | undefined => {
        // 1. Direct ID / UUID match
        if (todayRoutes[v.id] && todayRoutes[v.id].length > 0) return todayRoutes[v.id];

        // 2. Direct deviceId match
        if (v.deviceId && todayRoutes[v.deviceId] && todayRoutes[v.deviceId].length > 0) return todayRoutes[v.deviceId];

        // 3. Normalized deviceId match
        const cleanDev = v.deviceId ? v.deviceId.replace(/^device_/, "") : undefined;
        if (cleanDev && todayRoutes[cleanDev] && todayRoutes[cleanDev].length > 0) return todayRoutes[cleanDev];
        if (cleanDev && todayRoutes[`device_${cleanDev}`] && todayRoutes[`device_${cleanDev}`].length > 0) return todayRoutes[`device_${cleanDev}`];

        // 4. Forward lookup in KNOWN_NANJIL_DEVICE_MAP
        if (cleanDev && KNOWN_NANJIL_DEVICE_MAP[cleanDev]) {
          const mappedUuid = KNOWN_NANJIL_DEVICE_MAP[cleanDev].id;
          if (todayRoutes[mappedUuid] && todayRoutes[mappedUuid].length > 0) return todayRoutes[mappedUuid];
        }

        // 5. Reverse lookup in KNOWN_NANJIL_DEVICE_MAP
        const knownEntry = Object.entries(KNOWN_NANJIL_DEVICE_MAP).find(([, meta]) => meta.id === v.id);
        if (knownEntry) {
          const [kDevId] = knownEntry;
          if (todayRoutes[kDevId] && todayRoutes[kDevId].length > 0) return todayRoutes[kDevId];
          if (todayRoutes[`device_${kDevId}`] && todayRoutes[`device_${kDevId}`].length > 0) return todayRoutes[`device_${kDevId}`];
        }

        // 6. Registration plate match
        if (v.number) {
          const cleanNum = v.number.replace(/\s+/g, "").toUpperCase();
          for (const [kDev, meta] of Object.entries(KNOWN_NANJIL_DEVICE_MAP)) {
            if (meta.number.replace(/\s+/g, "").toUpperCase() === cleanNum) {
              if (todayRoutes[meta.id] && todayRoutes[meta.id].length > 0) return todayRoutes[meta.id];
              if (todayRoutes[kDev] && todayRoutes[kDev].length > 0) return todayRoutes[kDev];
            }
          }
        }

        return undefined;
      };

      // 1. Iterate through ALL fleet vehicles (including offline vehicles without live coordinates)
      vehicles.forEach((v) => {
        const isSelected = v.id === selectedId || active?.id === v.id || (v.deviceId && v.deviceId === selectedId);
        const segments = getSegmentsForVehicle(v);

        if (!segments || segments.length === 0) return;

        renderedVehicleKeys.add(v.id);
        if (v.deviceId) {
          const clean = v.deviceId.replace(/^device_/, "");
          renderedVehicleKeys.add(v.deviceId);
          renderedVehicleKeys.add(clean);
          renderedVehicleKeys.add(`device_${clean}`);
          if (KNOWN_NANJIL_DEVICE_MAP[clean]) {
            renderedVehicleKeys.add(KNOWN_NANJIL_DEVICE_MAP[clean].id);
          }
        }
        const knownEntry = Object.entries(KNOWN_NANJIL_DEVICE_MAP).find(([, meta]) => meta.id === v.id);
        if (knownEntry) {
          renderedVehicleKeys.add(knownEntry[0]);
          renderedVehicleKeys.add(`device_${knownEntry[0]}`);
        }

        segments.forEach((seg, sIdx) => {
          if (seg && seg.length >= 2) {
            const cleanSeg = seg.filter((p) => isValidFleetCoord(p) && isFleetOperatingCoordinate(p.lat, p.lng));
            if (cleanSeg.length >= 2) {
              list.push({
                key: `today-route-${v.id}-${sIdx}`,
                path: cleanSeg,
                isSelected: Boolean(isSelected),
              });
            }
          }
        });
      });

      // 2. Also render any orphaned routes in todayRoutes that weren't matched in the vehicles array
      Object.entries(todayRoutes).forEach(([key, segments]) => {
        if (renderedVehicleKeys.has(key)) return;
        renderedVehicleKeys.add(key);

        const isSelected = key === selectedId || (active && (active.id === key || active.deviceId === key));

        segments.forEach((seg, sIdx) => {
          if (seg && seg.length >= 2) {
            const cleanSeg = seg.filter((p) => isValidFleetCoord(p) && isFleetOperatingCoordinate(p.lat, p.lng));
            if (cleanSeg.length >= 2) {
              list.push({
                key: `today-route-unmatched-${key}-${sIdx}`,
                path: cleanSeg,
                isSelected: Boolean(isSelected),
              });
            }
          }
        });
      });
    } else if (routeHistory && routeHistory.length >= 2) {
      // 2. Fallback to routeHistory for single-vehicle profiles / backward compatibility
      const cleanHistory = routeHistory.filter((p) => isValidFleetCoord(p) && isFleetOperatingCoordinate(p.lat, p.lng));
      if (cleanHistory.length >= 2) {
        list.push({
          key: "legacy-route-history",
          path: cleanHistory,
          isSelected: Boolean(selectedId),
        });
      }
    }

    // When a vehicle is selected, highlight and display ONLY that vehicle's route
    if (selectedId) {
      return list.filter((item) => item.isSelected);
    }

    return list;
  }, [todayRoutes, vehicles, selectedId, active, routeHistory]);

  // Prepare Estimated Plant Connectors (Dashed Orange Polyline, #F59E0B)
  const renderedConnectors = useMemo(() => {
    if (!plantConnectors || Object.keys(plantConnectors).length === 0) return [];

    const list: Array<{
      key: string;
      path: Array<{ lat: number; lng: number }>;
      isSelected: boolean;
    }> = [];

    const renderedKeys = new Set<string>();

    const getConnectorForVehicle = (v: Vehicle): Array<Array<{ lat: number; lng: number }>> | undefined => {
      if (plantConnectors[v.id] && plantConnectors[v.id].length > 0) return plantConnectors[v.id];
      if (v.deviceId && plantConnectors[v.deviceId] && plantConnectors[v.deviceId].length > 0) return plantConnectors[v.deviceId];
      const cleanDev = v.deviceId ? v.deviceId.replace(/^device_/, "") : undefined;
      if (cleanDev && plantConnectors[cleanDev] && plantConnectors[cleanDev].length > 0) return plantConnectors[cleanDev];
      if (cleanDev && plantConnectors[`device_${cleanDev}`] && plantConnectors[`device_${cleanDev}`].length > 0) return plantConnectors[`device_${cleanDev}`];

      const knownEntry = Object.entries(KNOWN_NANJIL_DEVICE_MAP).find(([, meta]) => meta.id === v.id);
      if (knownEntry) {
        const [kDevId] = knownEntry;
        if (plantConnectors[kDevId] && plantConnectors[kDevId].length > 0) return plantConnectors[kDevId];
        if (plantConnectors[`device_${kDevId}`] && plantConnectors[`device_${kDevId}`].length > 0) return plantConnectors[`device_${kDevId}`];
      }

      return undefined;
    };

    vehicles.forEach((v) => {
      const isSelected = v.id === selectedId || active?.id === v.id || (v.deviceId && v.deviceId === selectedId);
      const segments = getConnectorForVehicle(v);
      if (!segments || segments.length === 0) return;

      renderedKeys.add(v.id);
      if (v.deviceId) renderedKeys.add(v.deviceId);

      segments.forEach((seg, sIdx) => {
        if (seg && seg.length >= 2) {
          const cleanSeg = seg.filter((p) => isValidFleetCoord(p) && isFleetOperatingCoordinate(p.lat, p.lng));
          if (cleanSeg.length >= 2) {
            list.push({
              key: `plant-conn-${v.id}-${sIdx}`,
              path: cleanSeg,
              isSelected: Boolean(isSelected),
            });
          }
        }
      });
    });

    Object.entries(plantConnectors).forEach(([key, segments]) => {
      if (renderedKeys.has(key)) return;
      renderedKeys.add(key);

      const isSelected = key === selectedId || (active && (active.id === key || active.deviceId === key));
      segments.forEach((seg, sIdx) => {
        if (seg && seg.length >= 2) {
          const cleanSeg = seg.filter((p) => isValidFleetCoord(p) && isFleetOperatingCoordinate(p.lat, p.lng));
          if (cleanSeg.length >= 2) {
            list.push({
              key: `plant-conn-orphan-${key}-${sIdx}`,
              path: cleanSeg,
              isSelected: Boolean(isSelected),
            });
          }
        }
      });
    });

    // When a vehicle is selected, display ONLY that vehicle's connector
    if (selectedId) {
      return list.filter((item) => item.isSelected);
    }

    return list;
  }, [plantConnectors, vehicles, selectedId, active]);

  return (
    <div className="relative rounded-lg overflow-hidden border border-border" style={{ height }}>
      <Map
        defaultCenter={initialCenter}
        defaultZoom={DEFAULT_MAP_ZOOM}
        maxZoom={18}
        mapId={GOOGLE_MAPS_MAP_ID}
        gestureHandling="greedy"
        disableDefaultUI={false}
        mapTypeControl={true}
        streetViewControl={false}
        fullscreenControl={true}
        zoomControl={true}
        style={{ width: "100%", height: "100%" }}
      >
        {/* Today's Travelled GPS Routes with Active Vehicle Highlighting */}
        {renderedRouteSegments.map(({ key, path, isSelected }) => {
          const hasSelection = Boolean(selectedId);
          if (isSelected) {
            return (
              <div key={`group-${key}`}>
                {/* High-contrast white halo underneath selected route */}
                <Polyline
                  key={`${key}-halo`}
                  path={path}
                  strokeColor="#FFFFFF"
                  strokeOpacity={0.9}
                  strokeWeight={8.5}
                  geodesic={true}
                  zIndex={90}
                />
                {/* Primary highlighted polyline */}
                <Polyline
                  key={key}
                  path={path}
                  strokeColor="#DC2626"
                  strokeOpacity={1.0}
                  strokeWeight={5.5}
                  geodesic={true}
                  zIndex={100}
                />
              </div>
            );
          }

          if (hasSelection) {
            return (
              <Polyline
                key={key}
                path={path}
                strokeColor="#94A3B8"
                strokeOpacity={0.22}
                strokeWeight={2.5}
                geodesic={true}
                zIndex={10}
              />
            );
          }

          return (
            <Polyline
              key={key}
              path={path}
              strokeColor="#EF4444"
              strokeOpacity={0.8}
              strokeWeight={3.8}
              geodesic={true}
              zIndex={20}
            />
          );
        })}

        {/* Estimated Road Connectors from Nanjil Dairy Plant (Dashed Orange Polyline, #F59E0B) */}
        {renderedConnectors.map(({ key, path, isSelected }) => {
          const hasSelection = Boolean(selectedId);
          if (isSelected) {
            return (
              <div key={`group-conn-${key}`}>
                <Polyline
                  key={`${key}-halo`}
                  path={path}
                  strokeColor="#FFFFFF"
                  strokeOpacity={0.8}
                  strokeWeight={6}
                  geodesic={true}
                  zIndex={85}
                />
                <Polyline
                  key={key}
                  path={path}
                  strokeColor="#F59E0B"
                  strokeOpacity={0}
                  icons={[
                    {
                      icon: {
                        path: "M 0,-1 0,1",
                        strokeOpacity: 1,
                        scale: 3.5,
                        strokeColor: "#F59E0B",
                      },
                      offset: "0",
                      repeat: "14px",
                    },
                  ]}
                  geodesic={true}
                  zIndex={95}
                />
              </div>
            );
          }

          if (hasSelection) {
            return (
              <Polyline
                key={key}
                path={path}
                strokeColor="#D97706"
                strokeOpacity={0}
                icons={[
                  {
                    icon: {
                      path: "M 0,-1 0,1",
                      strokeOpacity: 0.18,
                      scale: 2.2,
                      strokeColor: "#D97706",
                    },
                    offset: "0",
                    repeat: "18px",
                  },
                ]}
                geodesic={true}
                zIndex={8}
              />
            );
          }

          return (
            <Polyline
              key={key}
              path={path}
              strokeColor="#F59E0B"
              strokeOpacity={0}
              icons={[
                {
                  icon: {
                    path: "M 0,-1 0,1",
                    strokeOpacity: 0.75,
                    scale: 2.8,
                    strokeColor: "#F59E0B",
                  },
                  offset: "0",
                  repeat: "15px",
                },
              ]}
              geodesic={true}
              zIndex={18}
            />
          );
        })}

        {/* Nanjil Dairy Plant Base Location Marker */}
        <AdvancedMarker
          position={NANJIL_DAIRY_DEPOT}
          zIndex={160}
          title="Nanjil Dairy Plant (Base Location) — Mulagumoodu"
          onClick={() => {
            if (map) {
              map.panTo(NANJIL_DAIRY_DEPOT);
              map.setZoom(15);
            }
          }}
        >
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-full shadow-xl border-2 border-white text-xs font-bold cursor-pointer select-none pointer-events-auto transition-transform hover:scale-105 ring-2 ring-emerald-500/40">
            <Factory className="h-4 w-4 text-emerald-200" />
            <span className="whitespace-nowrap font-bold">Nanjil Dairy Plant</span>
            <span className="text-[9px] bg-emerald-900/90 text-emerald-100 px-1.5 py-0.2 rounded-full uppercase tracking-wider font-semibold">
              Base Location
            </span>
          </div>
        </AdvancedMarker>

        {/* Start Point Badge when a vehicle is selected */}
        {selectedId && currentActive && (
          <AdvancedMarker
            position={{ lat: NANJIL_DAIRY_DEPOT.lat + 0.0018, lng: NANJIL_DAIRY_DEPOT.lng }}
            zIndex={170}
          >
            <div className="flex items-center gap-1 px-2.5 py-1 bg-slate-900/95 backdrop-blur-xs text-white text-[10px] font-bold rounded-full shadow-lg border border-slate-700">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Route Origin · Nanjil Dairy Plant</span>
            </div>
          </AdvancedMarker>
        )}

        {/* Destination Badge when a vehicle is selected and away from plant */}
        {selectedId && currentActive && isValidFleetCoord({ lat: currentActive.lat, lng: currentActive.lng }) && isFleetOperatingCoordinate(currentActive.lat, currentActive.lng) && (
          <AdvancedMarker
            position={{ lat: Number(currentActive.lat) + 0.0018, lng: Number(currentActive.lng) }}
            zIndex={175}
          >
            <div className="flex items-center gap-1 px-2.5 py-1 bg-red-600 text-white text-[10px] font-bold rounded-full shadow-lg border border-white">
              <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
              <span>Destination · {getVehicleRegistrationNumber(currentActive)}</span>
            </div>
          </AdvancedMarker>
        )}

        {/* Live Vehicle Markers */}
        {mappedVehicles.map((v) => {
          const isSelected = active?.id === v.id || selectedId === v.id;
          const overspeed = getOverspeedStatus(v.speed);
          const statusBg = getVehicleStatusColor(v.status);

          return (
            <AdvancedMarker
              key={v.id}
              position={{ lat: v.lat, lng: v.lng }}
              onClick={() => {
                setActive(v);
                if (onSelectVehicle) onSelectVehicle(v);
                if (map) {
                  map.panTo({ lat: v.lat, lng: v.lng });
                  map.setZoom(14);
                }
              }}
            >
              <div className="group relative cursor-pointer focus:outline-none flex flex-col items-center">
                {v.status === "Moving" && (
                  <span
                    className="absolute -inset-1.5 rounded-full animate-ping pointer-events-none"
                    style={{ background: statusBg, opacity: 0.4 }}
                  />
                )}

                {/* Overspeed Pulsing Halo Ring */}
                {overspeed.level === "critical" && (
                  <span
                    className="absolute -inset-2.5 rounded-full animate-ping border-2 border-red-500 pointer-events-none"
                    style={{ background: "rgba(239, 68, 68, 0.35)" }}
                  />
                )}
                {overspeed.level === "warning" && (
                  <span
                    className="absolute -inset-2 rounded-full animate-pulse border-2 border-orange-500 pointer-events-none"
                    style={{ background: "rgba(249, 115, 22, 0.3)" }}
                  />
                )}

                <span
                  className={`relative flex items-center justify-center rounded-full text-white shadow-lg transition-transform ${
                    isSelected
                      ? "h-9 w-9 ring-4 ring-primary scale-110"
                      : overspeed.level === "critical"
                        ? "h-8 w-8 ring-4 ring-red-500 ring-offset-1 scale-105"
                        : overspeed.level === "warning"
                          ? "h-7.5 w-7.5 ring-3 ring-orange-500 ring-offset-1"
                          : "h-7 w-7 ring-2 ring-white"
                  }`}
                  style={{ background: statusBg }}
                >
                  <Truck className={isSelected ? "h-4 w-4" : "h-3.5 w-3.5"} />

                  {/* Warning Dot Badge on Pin */}
                  {overspeed.level === "critical" && (
                    <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-red-600 text-white flex items-center justify-center text-[9px] font-black shadow-sm ring-1 ring-white">
                      !
                    </span>
                  )}
                  {overspeed.level === "warning" && (
                    <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-orange-500 text-white flex items-center justify-center text-[8px] font-bold shadow-sm ring-1 ring-white">
                      !
                    </span>
                  )}
                </span>

                {/* Vehicle Registration Number Tag on Pin */}
                <span
                  className={`mt-1 whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] font-bold font-mono tracking-tight shadow-md border transition-all flex items-center gap-1 ${
                    isSelected
                      ? "bg-amber-400 text-black border-black ring-2 ring-amber-400/50 z-20 scale-105"
                      : overspeed.level === "critical"
                        ? "bg-red-50 text-red-700 border-red-500 ring-1 ring-red-500/50 z-20 dark:bg-red-950 dark:text-red-200"
                        : overspeed.level === "warning"
                          ? "bg-orange-50 text-orange-800 border-orange-500 ring-1 ring-orange-500/40 z-20 dark:bg-orange-950 dark:text-orange-200"
                          : "bg-background/95 text-foreground border-border/80 group-hover:bg-amber-400 group-hover:text-black group-hover:border-black z-10"
                  }`}
                >
                  <span
                    className={`text-[8px] px-0.5 rounded-xs font-sans ${
                      overspeed.level === "critical"
                        ? "bg-red-600 text-white font-bold"
                        : "bg-black text-amber-400"
                    }`}
                  >
                    IND
                  </span>
                  <span>{getVehicleRegistrationNumber(v)}</span>
                  {overspeed.level === "critical" && (
                    <span className="text-[9px] text-red-600 font-bold font-sans">⚡{Math.round(v.speed)}</span>
                  )}
                  {overspeed.level === "warning" && (
                    <span className="text-[9px] text-orange-600 font-semibold font-sans">⚠{Math.round(v.speed)}</span>
                  )}
                </span>
              </div>
            </AdvancedMarker>
          );
        })}

        {/* Active Vehicle InfoWindow */}
        {currentActive &&
          isValidFleetCoord({ lat: currentActive.lat, lng: currentActive.lng }) &&
          (() => {
            const activeOverspeed = getOverspeedStatus(currentActive.speed);
            return (
              <InfoWindow
                position={{ lat: Number(currentActive.lat), lng: Number(currentActive.lng) }}
                onCloseClick={() => setActive(null)}
                pixelOffset={[0, -28]}
              >
                <div className="w-68 p-1 text-slate-900 space-y-2">
                  {/* Vehicle Registration Number Header */}
                  <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-2">
                    <div>
                      <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 flex items-center gap-1">
                        <Truck className="h-3 w-3 text-indigo-600" />
                        <span>Vehicle Registration No.</span>
                      </div>
                      <div className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-400 text-black border border-black/80 font-mono font-black text-xs tracking-wider shadow-xs">
                        <span className="text-[8px] font-sans font-bold bg-black text-amber-400 px-1 py-0.5 rounded-xs leading-none">
                          IND
                        </span>
                        <span>{getVehicleRegistrationNumber(currentActive)}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        {currentActive.type} · {currentActive.model}
                      </div>
                    </div>
                    <Badge status={currentActive.status}>{currentActive.status}</Badge>
                  </div>

                  {/* Overspeed Warning Alert Banner */}
                  {activeOverspeed.level === "warning" && (
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-orange-50 border border-orange-200 text-orange-700 text-xs font-semibold">
                      <AlertTriangle className="h-3.5 w-3.5 text-orange-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="leading-tight text-[11px]">⚠ Overspeed Warning</div>
                        <div className="text-[10px] font-normal text-orange-600/90">
                          {currentActive.speed} km/h (Limit: 60 km/h)
                        </div>
                      </div>
                    </div>
                  )}

                  {activeOverspeed.level === "critical" && (
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
                      <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="leading-tight text-[11px]">⚠ Critical Overspeed</div>
                        <div className="text-[10px] font-normal text-red-600/90">
                          {currentActive.speed} km/h (Limit: 100 km/h)
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Telemetry Metrics */}
                  <div className="grid grid-cols-2 gap-1.5 text-xs bg-slate-50 p-2 rounded border border-slate-200">
                    <div>
                      <div className="text-[10px] text-slate-500">Driver</div>
                      <div className="font-semibold text-slate-800 truncate">
                        {currentActive.driver || "Unassigned"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">Speed</div>
                      <div
                        className={`font-semibold ${
                          activeOverspeed.level === "critical"
                            ? "text-red-600 font-bold"
                            : activeOverspeed.level === "warning"
                              ? "text-orange-600 font-semibold"
                              : "text-slate-800"
                        }`}
                      >
                        {currentActive.speed} km/h
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">Avg Speed</div>
                      <div className="font-semibold text-slate-800">
                        {currentActive.averageSpeed != null && currentActive.averageSpeed > 0 ? `${currentActive.averageSpeed.toFixed(1)} km/h` : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">Fuel Level</div>
                      <div className="font-semibold text-slate-800">{currentActive.fuel}%</div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-500">Odometer</span>
                        {activeOdo?.readingSource && (
                          <span
                            className={`text-[8px] font-semibold px-1 py-0.2 rounded border ${
                              activeOdo.readingSource === "hardware"
                                ? "bg-blue-50 text-blue-600 border-blue-200"
                                : "bg-emerald-50 text-emerald-600 border-emerald-200"
                            }`}
                          >
                            {activeOdo.readingSource === "hardware" ? "HW" : "GPS Est."}
                          </span>
                        )}
                      </div>
                      <div className="font-semibold text-slate-800 font-mono">
                        {activeOdo != null
                          ? `${activeOdo.totalOdometerKm.toLocaleString("en-IN", {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 1,
                            })} km`
                          : currentActive.odometer
                            ? `${currentActive.odometer.toLocaleString()} km`
                            : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">Sector</div>
                      <div className="font-medium text-slate-800 truncate" title={currentActive.location || "Live Location"}>
                        {currentActive.location || "Live Location"}
                      </div>
                    </div>
                    {activeOdo != null && (
                      <div className="col-span-2 grid grid-cols-2 gap-1.5 pt-1.5 border-t border-slate-200 text-[10px]">
                        <div>
                          <div className="text-[9px] text-slate-500">Today Distance</div>
                          <div className="font-mono font-semibold text-slate-800">
                            {activeOdo.todayDistanceKm.toFixed(1)} km
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] text-slate-500">Current Trip</div>
                          <div className="font-mono font-semibold text-slate-800">
                            {activeOdo.currentTripDistanceKm.toFixed(1)} km
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Origin & Timing Details */}
                    <div className="col-span-2 pt-1.5 border-t border-slate-200 grid grid-cols-2 gap-1.5 text-[10px]">
                      <div>
                        <div className="text-[9px] text-slate-500 flex items-center gap-1">
                          <Factory className="h-2.5 w-2.5 text-emerald-600" />
                          <span>Origin Point</span>
                        </div>
                        <div className="font-semibold text-slate-800 truncate" title="Nanjil Central Processing Plant, Mulagumoodu">
                          Nanjil Dairy Plant
                        </div>
                      </div>
                      <div>
                        <div className="text-[9px] text-slate-500 flex items-center gap-1">
                          <RouteIcon className="h-2.5 w-2.5 text-blue-600" />
                          <span>Trip Start</span>
                        </div>
                        <div className="font-semibold text-slate-800 truncate">
                          {tripStartTimes?.[currentActive.id]
                            ? new Date(tripStartTimes[currentActive.id]).toLocaleTimeString("en-IN", {
                                timeZone: "Asia/Kolkata",
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: true,
                              })
                            : "Early Morning"}
                        </div>
                      </div>
                    </div>
                    <div className="col-span-2 text-[10px] text-slate-500 font-mono truncate border-t border-slate-200 pt-1 flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                      <span>Device ID: {currentActive.deviceId || "—"}</span>
                    </div>
                  </div>

                  {/* Action Link */}
                  <div className="pt-1">
                    {currentActive.id && !currentActive.id.startsWith("unassigned-") ? (
                      <Link
                        to={`/vehicles/${currentActive.id}`}
                        className="block text-center text-xs font-semibold bg-indigo-600 text-white rounded py-1 hover:bg-indigo-700 transition-colors shadow-xs"
                      >
                        Inspect Telemetry →
                      </Link>
                    ) : (
                      <div className="text-center text-xs text-slate-400 bg-slate-100 rounded py-1">
                        Unassigned Device
                      </div>
                    )}
                  </div>
                </div>
              </InfoWindow>
            );
          })()}
      </Map>

      {/* Legend & Tracking Notice */}
      <div className="absolute bottom-3 left-3 z-10 bg-card/95 backdrop-blur border border-border rounded-md px-3 py-2 text-xs flex items-center gap-3 shadow flex-wrap">
        {(["Moving", "Idle", "Parked", "Offline"] as const).map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: getVehicleStatusColor(s) }} />
            <span className="font-medium text-foreground">{s}</span>
          </div>
        ))}
        <div className="pl-2 border-l border-border flex items-center gap-3">
          <div className="flex items-center gap-1.5" title="Actual GPS travelled route">
            <span className="h-1 w-4 bg-red-600 rounded-full inline-block" />
            <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">GPS Route</span>
          </div>
          <div className="flex items-center gap-1.5" title="Estimated road connector from Nanjil Dairy Plant (not added to odometer)">
            <span className="h-0.5 w-4 border-b-2 border-dashed border-amber-500 inline-block" />
            <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">Plant Connector</span>
          </div>
        </div>
        {currentActive && (
          <div className="pl-2 border-l border-border text-primary font-semibold flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Navigation className="h-3 w-3 animate-pulse" />
              <span>
                Tracking: <strong className="font-mono">{getVehicleRegistrationNumber(currentActive)}</strong>
              </span>
            </div>
            {activeOdo && (
              <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                · {activeOdo.totalOdometerKm.toFixed(1)} km (Today: {activeOdo.todayDistanceKm.toFixed(1)} km)
              </span>
            )}
            {activeHasRoute ? (
              <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                Route Active
              </span>
            ) : (
              <span className="text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
                Route Unavailable (No GPS track today)
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

