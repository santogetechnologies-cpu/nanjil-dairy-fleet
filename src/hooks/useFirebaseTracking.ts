import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { supabase } from "@/lib/supabase";
import { type Vehicle, type VehicleStatus } from "@/lib/types";

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
 * Parses and normalizes Firestore telemetry fields into a Vehicle structure
 */
export function parseFirestoreTelemetry(data: FirestoreVehicleDoc, existing?: Vehicle): Partial<Vehicle> {
  const rawLat = data.lat;
  const rawLng = data.lng;

  // Use ONLY Firebase Firestore coordinates (do not fallback to Supabase location column)
  const lat = typeof rawLat === "number" ? rawLat : parseFloat(String(rawLat ?? 0));
  const lng = typeof rawLng === "number" ? rawLng : parseFloat(String(rawLng ?? 0));

  const speed = typeof data.speed === "number" ? data.speed : parseFloat(String(data.speed || 0));

  const temperature = typeof data.temperature === "number" 
    ? data.temperature 
    : parseFloat(String(data.temperature ?? existing?.temperature ?? 0));

  const fuel = typeof data.fuel === "number"
    ? data.fuel
    : (data.fuel != null ? parseFloat(String(data.fuel)) : (existing?.fuel ?? 0));

  const humidity = typeof data.humidity === "number"
    ? data.humidity
    : (data.humidity != null ? parseFloat(String(data.humidity)) : (existing?.humidity ?? 0));

  const engineOn = data.engine_on === true || data.engine_on === "true" || (data.engine_on as any) === 1;
  const ignition = data.ignition === true || data.ignition === "true" || (data.ignition as any) === 1;

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
    lat: isNaN(lat) ? (existing?.lat || 0) : lat,
    lng: isNaN(lng) ? (existing?.lng || 0) : lng,
    speed: isNaN(speed) ? (existing?.speed || 0) : speed,
    temperature: isNaN(temperature) ? (existing?.temperature || 0) : temperature,
    fuel: isNaN(fuel) ? (existing?.fuel || 0) : fuel,
    humidity: isNaN(humidity) ? (existing?.humidity || 0) : humidity,
    engineOn,
    ignition,
    status,
    location: data.location || existing?.location || "",
    lastUpdate: "Just now (Firebase)"
  };
}

/**
 * Hook to stream live tracking vehicles DIRECTLY from Firebase Firestore ("vechile" collection)
 * enriched reactively with registered vehicle master data (number, driver, model) from Supabase.
 */
export function usePureFirebaseTracking() {
  const [supabaseVehicles, setSupabaseVehicles] = useState<any[]>([]);
  const [firestoreDocs, setFirestoreDocs] = useState<Array<{ id: string; data: FirestoreVehicleDoc }>>([]);

  // 1. Fetch Supabase registered vehicles and listen for updates
  useEffect(() => {
    let cancelled = false;

    async function loadSupabaseVehicles() {
      try {
        const { data, error } = await supabase.from("v_vehicles").select("*");
        if (data && !cancelled) {
          setSupabaseVehicles(data);
        }
        if (error) {
          console.warn("Error querying Supabase v_vehicles:", error);
        }
      } catch (err) {
        console.warn("Could not load Supabase vehicles for tracking:", err);
      }
    }

    loadSupabaseVehicles();

    const channel = supabase
      .channel("pure-tracking-supabase-vehicles")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, () => {
        loadSupabaseVehicles();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicle_assignments" }, () => {
        loadSupabaseVehicles();
      })
      .subscribe();

    return () => {
      cancelled = true;
      channel.unsubscribe();
    };
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
          docs.push({
            id: docSnap.id.trim(),
            data: docSnap.data() as FirestoreVehicleDoc
          });
        });
        setFirestoreDocs(docs);
      },
      (error) => {
        console.warn("Pure Firebase Firestore live tracking error:", error);
      }
    );

    return () => unsubscribe();
  }, []);

  // 3. Reactively combine Firestore live telemetry with Supabase registered vehicles metadata
  const vehicles = useMemo(() => {
    return firestoreDocs.map(({ id: docId, data }) => {
      const devId = (data.device_id != null ? String(data.device_id) : docId).trim();
      const parsed = parseFirestoreTelemetry(data);

      // Match in Supabase vehicles by device_id or id or vehicle number
      const cleanDevId = devId.replace(/\D/g, "");
      const matchedSupabase = supabaseVehicles.find((sv) => {
        const sDevId = (sv.device_id || "").toString().trim().replace(/\D/g, "");
        const sId = (sv.id || "").toString().trim();
        const sNumber = (sv.number || "").toString().trim().replace(/[\s-]/g, "").toUpperCase();
        const rawNum = (data.vehicle_number || data["v.no"] || data.v_no || data.vehicle_no || data.number || "")
          .toString().trim().replace(/[\s-]/g, "").toUpperCase();

        return (
          (cleanDevId && sDevId && (sDevId === cleanDevId || cleanDevId.endsWith(sDevId) || sDevId.endsWith(cleanDevId))) ||
          (sId && (sId === devId || sId === docId)) ||
          (rawNum && sNumber && rawNum === sNumber)
        );
      });

      const rawFirebaseVehicleNumber =
        data.vehicle_number ||
        data["v.no"] ||
        data.v_no ||
        data.vehicle_no ||
        data.number;

      const vehicleNumber =
        matchedSupabase?.number ||
        rawFirebaseVehicleNumber ||
        devId ||
        docId;

      const vehicleId = matchedSupabase?.id || devId || docId;
      const driverName = matchedSupabase?.driver_name || data.driver || "";
      const driverId = matchedSupabase?.driver_id || data.driver_id || "";
      const vehicleType = matchedSupabase?.type || data.type || "";
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
        location: parsed.location || "",
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
        deviceId: devId || docId
      } as Vehicle;
    });
  }, [firestoreDocs, supabaseVehicles]);

  return vehicles;
}

/**
 * Hook to map live Firebase Firestore tracking data ("vechile" collection)
 * to vehicles with matching device IDs.
 */
export function useFirebaseTracking(initialVehicles: Vehicle[]) {
  const [vehicles, setVehicles] = useState<Vehicle[]>(initialVehicles);

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
          const devId = (data.device_id || docId).toString().trim();

          if (devId) {
            firestoreDocsMap.set(devId, { docId, data });
          }
          if (docId && docId !== devId) {
            firestoreDocsMap.set(docId, { docId, data });
          }
        });

        setVehicles((prevVehicles) => {
          const baseList = prevVehicles.length > 0 ? prevVehicles : initialVehicles;

          // Update ONLY existing vehicles with matching Firestore telemetry
          return baseList.map((v) => {
            const vDeviceId = (v.deviceId || "").toString().trim();
            const vId = (v.id || "").toString().trim();

            let match: { docId: string; data: FirestoreVehicleDoc } | undefined = undefined;

            if (vDeviceId && firestoreDocsMap.has(vDeviceId)) {
              match = firestoreDocsMap.get(vDeviceId);
            } else if (vId && firestoreDocsMap.has(vId)) {
              match = firestoreDocsMap.get(vId);
            }

            if (!match) return v;

            const updatedFields = parseFirestoreTelemetry(match.data, v);
            return {
              ...v,
              ...updatedFields,
              deviceId: v.deviceId || (match.data.device_id != null ? String(match.data.device_id) : match.docId)
            };
          });
        });
      },
      (error) => {
        console.warn("Firestore live tracking error:", error);
      }
    );

    return () => unsubscribe();
  }, [initialVehicles]);

  return vehicles;
}

/**
 * Hook to track a single vehicle live via Firebase Firestore "vechile" collection
 */
export function useSingleVehicleFirebaseTracking(initialVehicle: Vehicle | null) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(initialVehicle);

  useEffect(() => {
    setVehicle(initialVehicle);
  }, [initialVehicle]);

  useEffect(() => {
    if (!db || !vehicle) return;

    const devId = (vehicle.deviceId || vehicle.id || "").toString().trim();
    if (!devId) return;

    const collectionRef = collection(db, "vechile");

    const unsubscribe = onSnapshot(
      collectionRef,
      (snapshot) => {
        let matchingDoc: FirestoreVehicleDoc | null = null;

        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as FirestoreVehicleDoc;
          const dId = docSnap.id.trim();
          const targetDevId = (data.device_id || dId).toString().trim();

          if (targetDevId === devId || dId === devId) {
            matchingDoc = data;
          }
        });

        if (matchingDoc) {
          const updatedFields = parseFirestoreTelemetry(matchingDoc, vehicle);
          setVehicle((prev) => (prev ? { ...prev, ...updatedFields } : null));
        }
      },
      (error) => {
        console.warn("Firestore single vehicle subscription error:", error);
      }
    );

    return () => unsubscribe();
  }, [initialVehicle?.id, initialVehicle?.deviceId]);

  return vehicle;
}
