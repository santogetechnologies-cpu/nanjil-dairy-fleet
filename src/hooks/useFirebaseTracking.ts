import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { supabase } from "@/lib/supabase";
import { type Vehicle, type VehicleStatus } from "@/lib/types";
import { useAverageSpeed } from "@/hooks/useAverageSpeed";

export interface FirestoreVehicleDoc {
  device_id?: string | number;
  vehicle_number?: string;
  number?: string;
  "v.no"?: string;
  v_no?: string;
  vehicle_no?: string;
  driver?: string;
  driver_id?: string;
  type?: string;
  model?: string;
  lat?: string | number;
  lng?: string | number;
  speed?: string | number;
  status?: string;
  engine_on?: boolean | string;
  ignition?: boolean | string;
  temperature?: string | number;
  fuel?: string | number;
  humidity?: string | number;
  location?: string;
  last_update?: any;
}

/**
 * Normalizes a device ID:
 * - converts to string
 * - trims whitespace
 * - removes accidental non-numeric characters
 * - returns the sanitized numeric string (typically 15 digits)
 */
export function normalizeDeviceId(val: unknown): string {
  if (val == null) return "";
  return String(val).trim().replace(/\D/g, "");
}

/**
 * Extracts candidate device IDs from Firestore telemetry doc data and doc ID.
 * Prioritizes complete 15-digit clean device IDs.
 */
export function extractTelemetryDeviceId(
  data: FirestoreVehicleDoc,
  docId: string,
): { cleanDevId: string; rawDevId: string } {
  const fromData = data.device_id != null ? String(data.device_id).trim() : "";
  const cleanFromData = normalizeDeviceId(fromData);
  const cleanDocId = normalizeDeviceId(docId);

  // If data.device_id is a 15-digit number, prioritize it
  if (cleanFromData.length === 15) {
    return { cleanDevId: cleanFromData, rawDevId: fromData };
  }
  // If docId is a 15-digit number, use it
  if (cleanDocId.length === 15) {
    return { cleanDevId: cleanDocId, rawDevId: docId.trim() };
  }
  // Otherwise use whatever digits exist
  if (cleanFromData.length > 0) {
    return { cleanDevId: cleanFromData, rawDevId: fromData };
  }
  if (cleanDocId.length > 0) {
    return { cleanDevId: cleanDocId, rawDevId: docId.trim() };
  }
  return { cleanDevId: "", rawDevId: fromData || docId.trim() };
}

/**
 * Returns a genuine vehicle registration number if present in Firebase doc,
 * ensuring it is NEVER a device ID, docId, or hardware serial.
 */
export function getGenuineFirebaseVehicleNumber(
  data: FirestoreVehicleDoc,
  cleanDevId: string,
  rawDevId: string,
  docId: string,
): string | null {
  const candidate = (
    data.vehicle_number ||
    data["v.no"] ||
    data.v_no ||
    data.vehicle_no ||
    data.number ||
    ""
  )
    .toString()
    .trim();

  if (!candidate) return null;

  const normalizedCandidate = normalizeDeviceId(candidate);
  // Reject if it matches the deviceId, docId, or looks like a hardware serial (10-18 continuous digits)
  if (
    candidate === rawDevId ||
    candidate === docId ||
    (cleanDevId && normalizedCandidate === cleanDevId) ||
    /^\d{10,18}$/.test(candidate) ||
    candidate.toLowerCase() === "unassigned" ||
    candidate.toLowerCase() === "unassigned vehicle" ||
    candidate.toLowerCase() === "null" ||
    candidate.toLowerCase() === "undefined"
  ) {
    return null;
  }

  return candidate;
}

/**
 * Parses and normalizes Firestore telemetry fields into a Vehicle structure
 */
export function parseFirestoreTelemetry(
  data: FirestoreVehicleDoc,
  existing?: Vehicle,
): Partial<Vehicle> {
  const rawLat = data.lat;
  const rawLng = data.lng;

  // Use ONLY Firebase Firestore coordinates (do not fallback to Supabase location column)
  const lat = typeof rawLat === "number" ? rawLat : parseFloat(String(rawLat ?? 0));
  const lng = typeof rawLng === "number" ? rawLng : parseFloat(String(rawLng ?? 0));

  const speed = typeof data.speed === "number" ? data.speed : parseFloat(String(data.speed || 0));

  const temperature =
    typeof data.temperature === "number"
      ? data.temperature
      : parseFloat(String(data.temperature ?? existing?.temperature ?? 0));

  const fuel =
    typeof data.fuel === "number"
      ? data.fuel
      : data.fuel != null
        ? parseFloat(String(data.fuel))
        : (existing?.fuel ?? 0);

  const humidity =
    typeof data.humidity === "number"
      ? data.humidity
      : data.humidity != null
        ? parseFloat(String(data.humidity))
        : (existing?.humidity ?? 0);

  const engineOn =
    data.engine_on === true || data.engine_on === "true" || (data.engine_on as any) === 1;
  const ignition =
    data.ignition === true || data.ignition === "true" || (data.ignition as any) === 1;

  let status: VehicleStatus = existing?.status || "Idle";
  if (data.status && ["Moving", "Idle", "Parked", "Offline"].includes(data.status)) {
    status = data.status as VehicleStatus;
  } else if (speed > 0) {
    status = "Moving";
  } else if (engineOn || ignition) {
    status = "Idle";
  } else {
    status = "Parked";
  }

  return {
    lat: isNaN(lat) ? existing?.lat || 0 : lat,
    lng: isNaN(lng) ? existing?.lng || 0 : lng,
    speed: isNaN(speed) ? existing?.speed || 0 : speed,
    temperature: isNaN(temperature) ? existing?.temperature || 0 : temperature,
    fuel: isNaN(fuel) ? existing?.fuel || 0 : fuel,
    humidity: isNaN(humidity) ? existing?.humidity || 0 : humidity,
    engineOn,
    ignition,
    status,
    location: data.location || existing?.location || "",
    lastUpdate: "Just now (Firebase)",
  };
}

/**
 * Hook to stream live tracking vehicles DIRECTLY from Firebase Firestore ("vechile" collection)
 * enriched reactively with registered vehicle master data (number, driver, model) from Supabase.
 */
export function usePureFirebaseTracking() {
  const [supabaseVehicles, setSupabaseVehicles] = useState<any[]>([]);
  const [firestoreDocs, setFirestoreDocs] = useState<
    Array<{ id: string; data: FirestoreVehicleDoc }>
  >([]);
  const pendingBaseLookupsRef = useRef<Set<string>>(new Set());
  const loggedMappingsRef = useRef<Map<string, string>>(new Map());

  // GPS-based average speed calculator (incremental, per-device)
  const { updateGpsPoint, getAverageSpeed } = useAverageSpeed();

  // 1. Fetch Supabase registered vehicles and listen for updates
  useEffect(() => {
    let cancelled = false;

    async function loadSupabaseVehicles() {
      try {
        // Query v_vehicles view first
        const { data: viewData, error: viewError } = await supabase
          .from("v_vehicles")
          .select(
            "id, number, device_id, type, model, route, insurance_expiry, last_service, next_service_km, odometer, engine_hours, driver_name, driver_id, status, location, lat, lng, speed, fuel, temperature, humidity, engine_on, ignition, last_update",
          );

        let combined: any[] = viewData || [];

        if (viewError) {
          console.warn("[Vehicle Mapping] Error querying Supabase v_vehicles:", viewError);
        }

        // Also query base vehicles table directly to guarantee all device_ids are loaded
        const { data: baseData, error: baseError } = await supabase
          .from("vehicles")
          .select(
            "id, number, device_id, type, model, route, insurance_expiry, last_service, next_service_km, odometer, engine_hours",
          );

        if (baseError) {
          console.warn("[Vehicle Mapping] Error querying Supabase base vehicles table:", baseError);
        } else if (baseData) {
          // Merge any vehicles or device_ids that might be missing or unpopulated in v_vehicles
          const existingIds = new Set(combined.map((v) => v.id));
          for (const bv of baseData) {
            if (!existingIds.has(bv.id)) {
              combined.push({
                ...bv,
                driver_name: null,
                driver_id: null,
                status: "Offline",
                location: "",
              });
            } else {
              const target = combined.find((v) => v.id === bv.id);
              if (target && !target.device_id && bv.device_id) {
                target.device_id = bv.device_id;
              }
            }
          }
        }

        if (!cancelled) {
          setSupabaseVehicles(combined);
        }
      } catch (err) {
        console.warn("[Vehicle Mapping] Could not load Supabase vehicles for tracking:", err);
      }
    }

    loadSupabaseVehicles();

    const channelId = `pure-tracking-vehicles-${Math.random().toString(36).substring(2, 9)}`;
    const channel = supabase
      .channel(channelId)
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, () => {
        loadSupabaseVehicles();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vehicle_assignments" },
        () => {
          loadSupabaseVehicles();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  // Direct lookup helper when a telemetry device_id is not found in v_vehicles
  const lookupBaseVehicleByDeviceId = useCallback(async (devId: string) => {
    try {
      const { data, error } = await supabase
        .from("vehicles")
        .select(
          "id, number, device_id, type, model, route, insurance_expiry, last_service, next_service_km, odometer, engine_hours",
        )
        .eq("device_id", devId)
        .maybeSingle();

      if (error) {
        console.warn(
          `[Vehicle Mapping] Error querying base vehicles for device_id=${devId}:`,
          error,
        );
        return;
      }

      if (data) {
        // Fetch active driver if available
        const { data: assignData } = await supabase
          .from("vehicle_assignments")
          .select("driver_id, drivers(name)")
          .eq("vehicle_id", data.id)
          .eq("is_active", true)
          .maybeSingle();

        const enriched = {
          ...data,
          driver_name: (assignData?.drivers as any)?.name || null,
          driver_id: assignData?.driver_id || null,
          status: "Idle",
          location: "",
        };

        console.log(
          `[Vehicle Mapping] Found in base vehicles table: device_id=${devId} → vehicle=${data.number} (id=${data.id})`,
        );
        setSupabaseVehicles((prev) => {
          if (prev.some((v) => v.id === data.id)) {
            return prev.map((v) => (v.id === data.id ? { ...v, ...enriched } : v));
          }
          return [...prev, enriched];
        });
      } else {
        console.warn(
          `[Vehicle Mapping] device_id=${devId} not found in Supabase base vehicles table`,
        );
      }
    } catch (err) {
      console.warn(`[Vehicle Mapping] Failed to query base vehicles for device_id=${devId}:`, err);
    }
  }, []);

  // 2. Subscribe in real time to Firebase Firestore "vechile" collection
  useEffect(() => {
    if (!db) return;

    const collectionRef = collection(db, "vechile");

    const unsubscribe = onSnapshot(
      collectionRef,
      (snapshot) => {
        const docs: Array<{ id: string; data: FirestoreVehicleDoc }> = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as FirestoreVehicleDoc;
          const docId = docSnap.id.trim();
          docs.push({ id: docId, data });

          // Feed each GPS point into the average speed calculator
          const { cleanDevId } = extractTelemetryDeviceId(data, docId);
          if (cleanDevId) {
            const lat = typeof data.lat === "number" ? data.lat : parseFloat(String(data.lat ?? 0));
            const lng = typeof data.lng === "number" ? data.lng : parseFloat(String(data.lng ?? 0));
            const speed = typeof data.speed === "number" ? data.speed : parseFloat(String(data.speed || 0));
            updateGpsPoint(cleanDevId, lat, lng, speed);
          }
        });
        setFirestoreDocs(docs);
      },
      (error) => {
        console.warn("Pure Firebase Firestore live tracking error:", error);
      },
    );

    return () => unsubscribe();
  }, [updateGpsPoint]);

  // 3. Reactively combine Firestore live telemetry with Supabase registered vehicles metadata
  const vehicles = useMemo(() => {
    return firestoreDocs.map(({ id: docId, data }) => {
      const { cleanDevId, rawDevId } = extractTelemetryDeviceId(data, docId);
      const parsed = parseFirestoreTelemetry(data);

      // Match against Supabase vehicles using Supabase vehicles.device_id as authoritative mapping key
      // Compare the complete normalized device ID (DO NOT use partial/endsWith matching)
      const matchedSupabase = supabaseVehicles.find((sv) => {
        const sDevId = normalizeDeviceId(sv.device_id);
        if (!cleanDevId || !sDevId) return false;
        return cleanDevId === sDevId;
      });

      // If cleanDevId is 15 digits but not in loaded Supabase vehicles, trigger direct lookup on base vehicles table
      if (
        !matchedSupabase &&
        cleanDevId.length === 15 &&
        !pendingBaseLookupsRef.current.has(cleanDevId)
      ) {
        pendingBaseLookupsRef.current.add(cleanDevId);
        lookupBaseVehicleByDeviceId(cleanDevId);
      }

      // Priority for vehicle registration display value:
      // 1. Matched Supabase vehicle.number
      // 2. Firebase vehicle number field ONLY if genuinely present (never device_id / docId)
      // 3. Otherwise "Unassigned Vehicle"
      // NEVER use device ID, Firestore document ID, or telemetry document ID!
      let vehicleNumber: string;
      if (matchedSupabase?.number) {
        vehicleNumber = matchedSupabase.number;
      } else {
        const genuineFirebaseNum = getGenuineFirebaseVehicleNumber(
          data,
          cleanDevId,
          rawDevId,
          docId,
        );
        vehicleNumber = genuineFirebaseNum || "Unassigned Vehicle";
      }

      // Diagnostic logging
      const devKey = cleanDevId || rawDevId;
      const currentMapping = matchedSupabase
        ? `matched:${matchedSupabase.number}:${matchedSupabase.id}`
        : "unmatched";
      if (loggedMappingsRef.current.get(devKey) !== currentMapping) {
        loggedMappingsRef.current.set(devKey, currentMapping);
        if (matchedSupabase) {
          console.log(
            `[Vehicle Mapping] device_id=${devKey} → vehicle=${matchedSupabase.number} (id=${matchedSupabase.id})`,
          );
        } else {
          console.warn(
            `[Vehicle Mapping] device_id=${devKey} → UNMATCHED (no Supabase vehicle found)`,
          );
        }
      }

      const vehicleId =
        matchedSupabase?.id || (cleanDevId ? `unassigned-${cleanDevId}` : `unassigned-${docId}`);
      const driverName = matchedSupabase?.driver_name || data.driver || "Unassigned";
      const driverId = matchedSupabase?.driver_id || data.driver_id || "";
      const vehicleType = matchedSupabase?.type || data.type || "Vehicle";
      const vehicleModel = matchedSupabase?.model || data.model || "";
      const vehicleRoute = matchedSupabase?.route || "";

      return {
        id: vehicleId,
        number: vehicleNumber,
        type: vehicleType,
        model: vehicleModel,
        driver: driverName,
        driverId: driverId,
        status: parsed.status || "Idle",
        location: parsed.location || matchedSupabase?.location || "",
        lat: parsed.lat || 0,
        lng: parsed.lng || 0,
        speed: parsed.speed || 0,
        fuel: parsed.fuel || 0,
        temperature: parsed.temperature || 0,
        humidity: parsed.humidity || 0,
        engineOn: parsed.engineOn || false,
        ignition: parsed.ignition || false,
        route: vehicleRoute,
        insuranceExpiry: matchedSupabase?.insurance_expiry || "",
        lastService: matchedSupabase?.last_service || "",
        nextServiceKm: matchedSupabase?.next_service_km || 0,
        odometer: matchedSupabase?.odometer || 0,
        engineHours: matchedSupabase?.engine_hours ? Number(matchedSupabase.engine_hours) : 0,
        lastUpdate: "Just now (Firebase)",
        deviceId: cleanDevId || rawDevId,
        averageSpeed: getAverageSpeed(cleanDevId || rawDevId),
      } as Vehicle;
    });
  }, [firestoreDocs, supabaseVehicles, lookupBaseVehicleByDeviceId, getAverageSpeed]);

  return vehicles;
}

/**
 * Hook to map live Firebase Firestore tracking data ("vechile" collection)
 * to vehicles with matching device IDs.
 */
export function useFirebaseTracking(initialVehicles: Vehicle[]) {
  const [vehicles, setVehicles] = useState<Vehicle[]>(initialVehicles);

  // GPS-based average speed calculator (incremental, per-device)
  const { updateGpsPoint, getAverageSpeed } = useAverageSpeed();

  useEffect(() => {
    setVehicles(initialVehicles);
  }, [initialVehicles]);

  useEffect(() => {
    if (!db) return;

    const collectionRef = collection(db, "vechile");

    const unsubscribe = onSnapshot(
      collectionRef,
      (snapshot) => {
        const firestoreDocsMap = new Map<string, { docId: string; data: FirestoreVehicleDoc }>();

        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as FirestoreVehicleDoc;
          const docId = docSnap.id.trim();
          const { cleanDevId } = extractTelemetryDeviceId(data, docId);

          if (cleanDevId) {
            firestoreDocsMap.set(cleanDevId, { docId, data });

            // Feed GPS point into the average speed calculator
            const lat = typeof data.lat === "number" ? data.lat : parseFloat(String(data.lat ?? 0));
            const lng = typeof data.lng === "number" ? data.lng : parseFloat(String(data.lng ?? 0));
            const speed = typeof data.speed === "number" ? data.speed : parseFloat(String(data.speed || 0));
            updateGpsPoint(cleanDevId, lat, lng, speed);
          }
        });

        setVehicles((prevVehicles) => {
          const baseList = prevVehicles.length > 0 ? prevVehicles : initialVehicles;

          // Update ONLY existing vehicles with matching Firestore telemetry
          return baseList.map((v) => {
            const vDeviceId = normalizeDeviceId(v.deviceId);
            let match: { docId: string; data: FirestoreVehicleDoc } | undefined = undefined;

            if (vDeviceId && firestoreDocsMap.has(vDeviceId)) {
              match = firestoreDocsMap.get(vDeviceId);
            }

            if (!match) return v;

            const updatedFields = parseFirestoreTelemetry(match.data, v);
            return {
              ...v,
              ...updatedFields,
              // Keep original vehicle registration number
              number: v.number || "Unassigned Vehicle",
              deviceId: v.deviceId || vDeviceId,
              averageSpeed: vDeviceId ? getAverageSpeed(vDeviceId) : null,
            };
          });
        });
      },
      (error) => {
        console.warn("Firestore live tracking error:", error);
      },
    );

    return () => unsubscribe();
  }, [initialVehicles, updateGpsPoint, getAverageSpeed]);

  return vehicles;
}

/**
 * Hook to track a single vehicle live via Firebase Firestore "vechile" collection.
 * Reuses the authoritative multi-vehicle stream, guaranteeing live telemetry parity with the fleet overview.
 */
export function useSingleVehicleFirebaseTracking(initialVehicle: Vehicle | null): Vehicle | null {
  const allLiveVehicles = usePureFirebaseTracking();

  return useMemo(() => {
    if (!initialVehicle) return null;

    const targetDevId = normalizeDeviceId(initialVehicle.deviceId);
    const targetNumber = initialVehicle.number?.trim().toLowerCase();
    const targetId = initialVehicle.id;

    const matched = allLiveVehicles.find((v) => {
      if (targetId && v.id === targetId) return true;
      if (targetDevId && normalizeDeviceId(v.deviceId) === targetDevId) return true;
      if (targetNumber && v.number && v.number.trim().toLowerCase() === targetNumber) return true;
      return false;
    });

    if (matched) {
      return {
        ...initialVehicle,
        ...matched,
        // Preserve registration and db metadata from initial vehicle
        id: initialVehicle.id || matched.id,
        number: initialVehicle.number || matched.number,
        type: initialVehicle.type || matched.type,
        model: initialVehicle.model || matched.model,
        route: initialVehicle.route || matched.route,
        driver: matched.driver && matched.driver !== "Unassigned" ? matched.driver : (initialVehicle.driver || "Unassigned"),
        driverId: initialVehicle.driverId || matched.driverId,
        odometer: initialVehicle.odometer || matched.odometer,
        engineHours: initialVehicle.engineHours || matched.engineHours,
        insuranceExpiry: initialVehicle.insuranceExpiry || matched.insuranceExpiry,
        lastService: initialVehicle.lastService || matched.lastService,
        nextServiceKm: initialVehicle.nextServiceKm || matched.nextServiceKm,
      };
    }

    return initialVehicle;
  }, [allLiveVehicles, initialVehicle]);
}
