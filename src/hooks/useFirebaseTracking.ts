import { useState, useEffect } from "react";
import { collection, onSnapshot, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { type Vehicle, type VehicleStatus } from "@/lib/types";

export interface FirestoreVehicleDoc {
  device_id?: string;
  vehicle_number?: string;
  number?: string;
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
    : (data.fuel != null ? parseFloat(String(data.fuel)) : (existing?.fuel ?? 80));

  const humidity = typeof data.humidity === "number"
    ? data.humidity
    : (data.humidity != null ? parseFloat(String(data.humidity)) : (existing?.humidity ?? 65));

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
    fuel: isNaN(fuel) ? (existing?.fuel || 80) : fuel,
    humidity: isNaN(humidity) ? (existing?.humidity || 65) : humidity,
    engineOn,
    ignition,
    status,
    location: data.location || existing?.location || "Live GPS Location",
    lastUpdate: "Just now (Firebase)"
  };
}

/**
 * Hook to stream live tracking vehicles DIRECTLY and EXCLUSIVELY from Firebase Firestore ("vechile" collection)
 * No Supabase calls used for tracking data.
 */
export function usePureFirebaseTracking() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  useEffect(() => {
    if (!db) return;

    const collectionRef = collection(db, "vechile");

    const unsubscribe = onSnapshot(
      collectionRef,
      (snapshot) => {
        const results: Vehicle[] = [];

        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as FirestoreVehicleDoc;
          const docId = docSnap.id.trim();
          const devId = (data.device_id || docId).toString().trim();

          const parsed = parseFirestoreTelemetry(data);

          const vehicleNumber = data.vehicle_number || data.number || `TN-75-DEV-${devId.slice(-4) || docId.slice(-4)}`;

          results.push({
            id: devId || docId,
            number: vehicleNumber,
            type: data.type || "Milk Tanker",
            model: data.model || "Firebase GPS Tracker",
            driver: data.driver || "Assigned Driver",
            driverId: data.driver_id || "",
            status: parsed.status || "Idle",
            location: parsed.location || "Live GPS Location",
            lat: parsed.lat || 0,
            lng: parsed.lng || 0,
            speed: parsed.speed || 0,
            fuel: parsed.fuel || 80,
            temperature: parsed.temperature || 0,
            humidity: parsed.humidity || 65,
            engineOn: parsed.engineOn || false,
            ignition: parsed.ignition || false,
            route: "Milk Collection Route",
            insuranceExpiry: "2026-12-31",
            lastService: "2026-01-15",
            nextServiceKm: 10000,
            odometer: 45000,
            engineHours: 1200,
            lastUpdate: "Just now (Firebase)",
            deviceId: devId || docId
          });
        });

        setVehicles(results);
      },
      (error) => {
        console.warn("Pure Firebase Firestore live tracking error:", error);
      }
    );

    return () => unsubscribe();
  }, []);

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
              deviceId: v.deviceId || match.data.device_id || match.docId
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
