/**
 * telemetry-ingestion.ts — Unified Telemetry Ingestion & Normalization
 *
 * Normalizes telemetry from Firebase Firestore, EMQX MQTT / PostgreSQL,
 * and time-series history into a common format for authoritative
 * stop tracking and database persistence.
 */

import { supabase } from "./supabase.ts";
import { safeTimestampToMs, isValidCoordinate } from "./vehicle-stop-detection.ts";

export interface NormalizedTelemetryPoint {
  vehicleId: string;
  vehicleNumber?: string;
  deviceId?: string;
  driverId?: string | null;
  driverName?: string | null;
  timestamp: string; // ISO 8601 string
  timestampMs: number;
  speed: number;
  lat: number;
  lng: number;
  fuel?: number | null;
  temperature?: number | null;
  humidity?: number | null;
  engineOn: boolean;
  ignition: boolean;
  location?: string;
  source: "firebase" | "emqx" | "telemetry" | "database_history";
}

/**
 * Normalizes a Firebase Firestore vehicle document into a NormalizedTelemetryPoint.
 */
export function normalizeFirebaseDocument(
  docId: string,
  docData: any,
  vehicleMetadata?: { id: string; number: string; driverId?: string | null; driverName?: string | null }
): NormalizedTelemetryPoint | null {
  if (!docData) return null;

  const lat = typeof docData.lat === "number" ? docData.lat : parseFloat(String(docData.lat || 0));
  const lng = typeof docData.lng === "number" ? docData.lng : parseFloat(String(docData.lng || 0));

  if (!isValidCoordinate(lat, lng)) {
    return null;
  }

  const speed = Math.max(0, typeof docData.speed === "number" ? docData.speed : parseFloat(String(docData.speed || 0)) || 0);
  const engineOn = docData.engine_on === true || String(docData.engine_on).toLowerCase() === "true";
  const ignition = docData.ignition === true || String(docData.ignition).toLowerCase() === "true";

  const rawTs = docData.last_update || docData.timestamp || docData.updated_at || Date.now();
  const tsMs = safeTimestampToMs(rawTs) || Date.now();
  const timestamp = new Date(tsMs).toISOString();

  const deviceId = String(docData.device_id || docId).trim();
  const vehicleId = vehicleMetadata?.id || deviceId;
  const vehicleNumber = vehicleMetadata?.number || docData["v.no"] || docData.vehicle_number || "Vehicle";

  return {
    vehicleId,
    vehicleNumber,
    deviceId,
    driverId: vehicleMetadata?.driverId || null,
    driverName: vehicleMetadata?.driverName || docData.driver || null,
    timestamp,
    timestampMs: tsMs,
    speed,
    lat,
    lng,
    fuel: docData.fuel != null ? Number(docData.fuel) : null,
    temperature: docData.temperature != null ? Number(docData.temperature) : null,
    humidity: docData.humidity != null ? Number(docData.humidity) : null,
    engineOn: engineOn || ignition,
    ignition,
    location: docData.location || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    source: "firebase",
  };
}

/**
 * Normalizes an EMQX telemetry row into a NormalizedTelemetryPoint.
 */
export function normalizeEmqxRow(
  row: any,
  vehicleMetadata?: { number?: string; driverId?: string | null; driverName?: string | null }
): NormalizedTelemetryPoint | null {
  if (!row || !row.vehicle_id) return null;

  const lat = typeof row.lat === "number" ? row.lat : parseFloat(String(row.lat || 0));
  const lng = typeof row.lng === "number" ? row.lng : parseFloat(String(row.lng || 0));

  if (!isValidCoordinate(lat, lng)) {
    return null;
  }

  const speed = Math.max(0, typeof row.speed === "number" ? row.speed : parseFloat(String(row.speed || 0)) || 0);
  const rawTs = row.recorded_at || row.timestamp || row.last_update || Date.now();
  const tsMs = safeTimestampToMs(rawTs);
  if (!tsMs) return null;

  const engineOn = Boolean(row.engine_on || row.ignition);
  const ignition = Boolean(row.ignition);

  return {
    vehicleId: row.vehicle_id,
    vehicleNumber: vehicleMetadata?.number || row.vehicle_number || "Vehicle",
    deviceId: row.device_id ? String(row.device_id) : undefined,
    driverId: vehicleMetadata?.driverId || row.driver_id || null,
    driverName: vehicleMetadata?.driverName || row.driver_name || null,
    timestamp: new Date(tsMs).toISOString(),
    timestampMs: tsMs,
    speed,
    lat,
    lng,
    fuel: row.fuel != null ? Number(row.fuel) : null,
    temperature: row.temperature != null ? Number(row.temperature) : null,
    humidity: row.humidity != null ? Number(row.humidity) : null,
    engineOn,
    ignition,
    location: row.location || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    source: "emqx",
  };
}

/**
 * Ingestion Checkpoint Manager: tracks incremental sync progress.
 */
export async function getCheckpoint(source: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("stop_tracking_checkpoints")
      .select("last_recorded_at")
      .eq("source", source)
      .maybeSingle();

    if (error || !data) return null;
    return data.last_recorded_at || null;
  } catch {
    return null;
  }
}

export async function setCheckpoint(source: string, lastRecordedAt: string): Promise<void> {
  try {
    await supabase
      .from("stop_tracking_checkpoints")
      .upsert(
        {
          source,
          last_recorded_at: lastRecordedAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "source" }
      );
  } catch {
    // Checkpoint fallback
  }
}

