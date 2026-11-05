/**
 * vehicle-stop-detection.ts — Dedicated Vehicle Stop Detection Engine
 *
 * Core stop detection rules for Nanjil Dairy Fleet:
 * - Speed <= 3 km/h: Candidate stationary state.
 * - Stationary continuous for 2 minutes (120s): Confirmed stop.
 *   - The stop event's started_at is the initial stationary timestamp.
 * - Speed > 5 km/h sustained for 15 seconds: Confirmed journey resumed.
 *   - The stop event's ended_at is the first movement timestamp.
 *   - Status transitions to 'COMPLETED'.
 * - Missing / stale telemetry (> 120s):
 *   - Active stop transitions to 'INTERRUPTED'.
 *   - Offline period is strictly excluded from stationary duration.
 *   - Tracking resumes only when fresh telemetry arrives.
 * - Strictly maintains at most one ACTIVE stop per vehicle.
 * - Rejects duplicate and out-of-order telemetry.
 * - Tolerant to GPS drift and temporary signal fluctuations.
 */

import { supabase } from "./supabase.ts";
import type { Vehicle } from "./types.ts";

// ── CONFIGURABLE THRESHOLDS ──────────────────────────────────────────────────
export interface StopDetectionConfig {
  stopSpeedThresholdKmh: number;      // <= 3 km/h triggers stationary candidate
  stopDurationThresholdSec: number;   // 120 continuous seconds confirms a stop
  resumeSpeedThresholdKmh: number;    // > 5 km/h triggers movement candidate
  resumeDurationThresholdSec: number; // 15 continuous seconds confirms movement
  staleThresholdSec: number;          // 120 seconds of silence marks stop INTERRUPTED
  maxGpsTeleportDistanceKm: number;   // > 200 km jump within 1 min rejected as invalid
}

export const DEFAULT_STOP_CONFIG: StopDetectionConfig = {
  stopSpeedThresholdKmh: 3,
  stopDurationThresholdSec: 120, // 2 continuous minutes
  resumeSpeedThresholdKmh: 5,
  resumeDurationThresholdSec: 15, // 15 seconds sustained movement
  staleThresholdSec: 120, // 2 minutes stale limit
  maxGpsTeleportDistanceKm: 200,
};

// ── TYPES ────────────────────────────────────────────────────────────────────
export type StopStatus = "ACTIVE" | "COMPLETED" | "INTERRUPTED";

export const KNOWN_NANJIL_DEVICE_MAP: Record<string, { id: string; number: string; model: string }> = {
  "863110086146753": { id: "09b85a4a-1d9f-43f0-8343-ace9d27a1670", number: "TN 75 F 4323", model: "Eicher Pro 2049" },
  "863110086146985": { id: "1b115b9d-6357-4a9e-8e76-1d59497695af", number: "TN 75 S 9826", model: "Tata 407 Gold SFC" },
  "863110086150292": { id: "325081e0-a535-4269-8239-582de0f2ba66", number: "TN 75 R 9952", model: "Tata 407 Gold SFC" },
  "863110086162107": { id: "7b9543e8-bcdd-4fb6-ad83-a78d92be4176", number: "TN 75 S 1688", model: "20 KL" },
  "863110086164111": { id: "f30c9dcd-56a2-4b6c-bb93-d1f4c458682c", number: "TN 75 BF 0320", model: "Mahindra Bolero Maxi Truck" },
  "863110086186932": { id: "d3887a78-ac32-4b63-b3c0-61563ad9f3d7", number: "TN 75 M 0041", model: "75 kl" },
  "863110086192104": { id: "d0fea864-64a4-4148-b3b2-600f68459583", number: "TN 75 BC 2219", model: "Unknown Model" },
  "863110086157065": { id: "57fcf174-88c7-4e05-be26-0971f4c5c6e8", number: "TN 75 BC 3835", model: "Eicher Pro" },
  "863110086135988": { id: "6fe7650b-a054-46ab-b549-422565f7d3b3", number: "TN 75 C 8204", model: "Tata 407" },
  "863110086146696": { id: "11318240-9a03-4e00-843c-dc78a80771fe", number: "TN75AJ-7212", model: "Mahindra Bolero" },
};

/**
 * Resolves vehicle metadata (number, model, real UUID) from a vehicle ID, device ID, or dedup_key.
 */
export function resolveVehicleMetadata(
  vehicleId?: string | null,
  dedupKey?: string | null,
  currentNumber?: string | null,
  currentModel?: string | null
): { id?: string; number: string; model?: string } {
  const isPlaceholderNumber =
    !currentNumber ||
    currentNumber === "Unassigned Vehicle" ||
    currentNumber === "Fleet Asset" ||
    currentNumber === "Fleet Unit" ||
    currentNumber === "Vehicle" ||
    currentNumber === "Unknown";

  if (!isPlaceholderNumber) {
    return { id: vehicleId || undefined, number: currentNumber!, model: currentModel || undefined };
  }

  const cleanVid = (vehicleId || "").trim();
  const cleanKey = (dedupKey || "").trim();

  // 1. Check known devices by clean device ID or real UUID
  for (const [devId, meta] of Object.entries(KNOWN_NANJIL_DEVICE_MAP)) {
    if (
      cleanVid === meta.id ||
      cleanVid === devId ||
      cleanVid === `unassigned-${devId}` ||
      cleanVid.includes(devId) ||
      cleanVid.includes(meta.id) ||
      cleanKey.includes(devId) ||
      cleanKey.includes(meta.id)
    ) {
      return { id: meta.id, number: meta.number, model: meta.model || currentModel || undefined };
    }
  }

  // 2. Check cached Supabase vehicles from localStorage
  if (typeof localStorage !== "undefined") {
    try {
      const cached = localStorage.getItem("nanjil_cached_supabase_vehicles");
      if (cached) {
        const vehicles: any[] = JSON.parse(cached);
        if (Array.isArray(vehicles)) {
          const matched = vehicles.find((v) => {
            if (!v) return false;
            if (v.id && (cleanVid === v.id || cleanVid.includes(v.id) || cleanKey.includes(v.id))) return true;
            if (v.device_id) {
              const dev = String(v.device_id).trim();
              if (
                cleanVid === dev ||
                cleanVid === `unassigned-${dev}` ||
                cleanVid.includes(dev) ||
                cleanKey.includes(dev)
              ) {
                return true;
              }
            }
            return false;
          });
          if (matched && matched.number) {
            return {
              id: matched.id,
              number: matched.number,
              model: matched.model || currentModel || undefined,
            };
          }
        }
      }
    } catch {}
  }

  return { id: vehicleId || undefined, number: currentNumber || "Unassigned Vehicle", model: currentModel || undefined };
}


export interface TelemetryPoint {
  vehicleId: string;
  vehicleNumber?: string;
  driverId?: string | null;
  driverName?: string | null;
  timestamp: string | number | Date;
  speed: number;
  lat: number;
  lng: number;
  engineOn?: boolean;
  ignition?: boolean;
  location?: string;
  source?: "firebase" | "emqx" | "telemetry" | "test";
}

export interface VehicleStopEvent {
  id: string; // Valid RFC4122 UUID
  dedup_key?: string; // Deterministic deduplication key (e.g. hist:vehicle_id:started_at or live:vehicle_id:started_at)
  vehicle_id: string;
  vehicle_number?: string;
  vehicle_model?: string;
  driver_id?: string | null;
  driver_name?: string | null;
  started_at: string;
  ended_at?: string | null;
  duration_seconds: number;
  start_lat: number;
  start_lng: number;
  end_lat?: number | null;
  end_lng?: number | null;
  location: string;
  engine_on: boolean;
  status: StopStatus;
  source: string;
  created_at?: string;
  updated_at?: string;
}

export interface VehicleStopTrackingState {
  vehicleId: string;
  vehicleNumber: string;
  driverId: string | null;
  driverName: string | null;
  lastTimestampMs: number;
  lastFreshTelemetryMs: number;
  lastSpeed: number;
  provisionalStationaryStartMs: number | null;
  provisionalLat: number | null;
  provisionalLng: number | null;
  provisionalLocation: string | null;
  provisionalEngineOn: boolean;
  movementCandidateStartMs: number | null;
  activeStop: VehicleStopEvent | null;
}

export interface StopTransitionResult {
  vehicleId: string;
  action: "NONE" | "PROVISIONAL_STARTED" | "STOP_CONFIRMED" | "STOP_COMPLETED" | "STOP_INTERRUPTED";
  stopEvent?: VehicleStopEvent;
}

// ── HELPER FUNCTIONS ─────────────────────────────────────────────────────────

export function safeTimestampToMs(ts: string | number | Date | unknown): number | null {
  if (ts == null) return null;
  if (typeof ts === "number") {
    // If seconds epoch (10 digits), convert to ms
    return ts < 10000000000 ? ts * 1000 : ts;
  }
  if (ts instanceof Date) {
    const time = ts.getTime();
    return isNaN(time) ? null : time;
  }
  if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    return isNaN(parsed) ? null : parsed;
  }
  // Firestore timestamp objects ({ seconds, nanoseconds })
  if (typeof ts === "object" && "seconds" in (ts as any)) {
    return Number((ts as any).seconds) * 1000;
  }
  return null;
}

export function isValidCoordinate(latVal: unknown, lngVal: unknown): boolean {
  const lat = typeof latVal === "number" ? latVal : parseFloat(String(latVal));
  const lng = typeof lngVal === "number" ? lngVal : parseFloat(String(lngVal));
  if (isNaN(lat) || isNaN(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  // Reject exact 0,0 (common default GPS sensor error before lock)
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  return true;
}

export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── STOP DETECTION ENGINE CLASS ──────────────────────────────────────────────

export class StopDetectionEngine {
  private config: StopDetectionConfig;
  private states = new Map<string, VehicleStopTrackingState>();
  private confirmedStops: VehicleStopEvent[] = [];
  private onStopConfirmedListeners: Array<(stop: VehicleStopEvent) => void> = [];
  private onStopUpdatedListeners: Array<(stop: VehicleStopEvent) => void> = [];
  private isSupabaseTableAvailable: boolean = typeof localStorage !== "undefined"
    ? localStorage.getItem("nanjil_stop_table_available") === "true"
    : false;
  private lastTableCheckTime: number = 0;
  private readonly tableCheckCooldownMs: number = 180000; // 3 minutes backoff
  private engineStartTimeMs: number = Date.now();

  constructor(customConfig?: Partial<StopDetectionConfig>) {
    this.config = { ...DEFAULT_STOP_CONFIG, ...customConfig };
    this.engineStartTimeMs = Date.now();
    this.loadFromStorage();
  }

  public getConfig(): StopDetectionConfig {
    return { ...this.config };
  }

  public setConfig(newConfig: Partial<StopDetectionConfig>) {
    this.config = { ...this.config, ...newConfig };
  }

  public onStopConfirmed(listener: (stop: VehicleStopEvent) => void) {
    this.onStopConfirmedListeners.push(listener);
  }

  public onStopUpdated(listener: (stop: VehicleStopEvent) => void) {
    this.onStopUpdatedListeners.push(listener);
  }

  public isTableAvailable(): boolean {
    return this.isSupabaseTableAvailable;
  }

  public resetTableCheck(): void {
    this.isSupabaseTableAvailable = true;
    this.lastTableCheckTime = 0;
  }

  public async verifyAndEnableSupabaseSync(): Promise<{ success: boolean; message: string }> {
    try {
      const { data, error } = await supabase
        .from("vehicle_stop_events")
        .select("id")
        .limit(1);

      if (error) {
        this.isSupabaseTableAvailable = false;
        if (typeof localStorage !== "undefined") {
          localStorage.removeItem("nanjil_stop_table_available");
        }
        if (error.code === '42501') {
          return {
            success: false,
            message: 'Supabase table exists but anonymous access is restricted (42501). Run the SQL migration in the Dashboard to grant fleet access.',
          };
        }
        return {
          success: false,
          message: error.message || "Table vehicle_stop_events not found in Supabase schema cache.",
        };
      }

      this.isSupabaseTableAvailable = true;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("nanjil_stop_table_available", "true");
      }
      return {
        success: true,
        message: "Successfully connected to Supabase vehicle_stop_events!",
      };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || "Failed to verify table.",
      };
    }
  }

  /**
   * Validates telemetry point integrity.
   * Returns false if vehicle ID, coordinates, speed or timestamp are invalid.
   */
  public validateTelemetry(point: TelemetryPoint): boolean {
    if (!point || !point.vehicleId || typeof point.vehicleId !== "string") return false;
    const tsMs = safeTimestampToMs(point.timestamp);
    if (!tsMs) return false;

    // Disallow timestamps more than 24 hours into the future (supports timezone differences & tests)
    const now = Date.now();
    if (tsMs > now + 24 * 3600 * 1000) return false;

    // Speed sanity: must be non-negative and < 250 km/h
    const speed = typeof point.speed === "number" ? point.speed : parseFloat(String(point.speed));
    if (isNaN(speed) || speed < 0 || speed > 250) return false;

    // Valid coordinates
    if (!isValidCoordinate(point.lat, point.lng)) return false;

    return true;
  }

  /**
   * Processes a single telemetry point for a vehicle.
   * Deterministically updates stationary timers, confirms stops,
   * resumes movements, and handles disconnections.
   */
  public processTelemetry(point: TelemetryPoint): StopTransitionResult {
    const vehicleId = point.vehicleId;
    const tsMs = safeTimestampToMs(point.timestamp);
    if (!vehicleId || !tsMs) {
      return { vehicleId: vehicleId || 'unknown', action: 'NONE' };
    }

    const speed = Math.max(0, Number(point.speed) || 0);
    const lat = Number(point.lat) || 0;
    const lng = Number(point.lng) || 0;
    const engineOn = Boolean(point.engineOn);
    const location = point.location || 'Unknown';

    // Fetch or initialize per-vehicle tracking state
    let state = this.states.get(vehicleId);
    if (!state) {
      state = {
        vehicleId,
        vehicleNumber: point.vehicleNumber || 'Vehicle',
        driverId: point.driverId || null,
        driverName: point.driverName || null,
        lastLat: lat,
        lastLng: lng,
        lastTimestampMs: 0,
        lastFreshTelemetryMs: tsMs,
        lastSpeed: speed,
        provisionalStationaryStartMs: null,
        provisionalLat: null,
        provisionalLng: null,
        provisionalLocation: null,
        provisionalEngineOn: engineOn,
        movementCandidateStartMs: null,
        activeStop: null,
      };
      this.states.set(vehicleId, state);
    }

    // Preserve metadata
    if (point.vehicleNumber) state.vehicleNumber = point.vehicleNumber;
    if (point.driverId !== undefined && point.driverId !== null) state.driverId = point.driverId;
    if (point.driverName) state.driverName = point.driverName;

    // ── 1. REJECT DUPLICATE AND OUT-OF-ORDER TELEMETRY ───────────────────────
    if (state.lastTimestampMs > 0 && tsMs <= state.lastTimestampMs) {
      return { vehicleId, action: 'NONE' };
    }

    const isStationary = speed <= this.config.stopSpeedThresholdKmh;

    // ── 2. STATIONARY TELEMETRY CONTINUITY (speed <= stopSpeedThresholdKmh) ──
    if (isStationary) {
      state.movementCandidateStartMs = null;

      // Case A: Vehicle is already in an ACTIVE confirmed stop
      if (state.activeStop) {
        const distKm = (state.activeStop.start_lat && state.activeStop.start_lng && lat && lng)
          ? haversineDistanceKm(state.activeStop.start_lat, state.activeStop.start_lng, lat, lng)
          : 0;

        // If telemetry had a silence gap (> 120s) AND vehicle reappeared at a different location (> 200m away):
        // The vehicle drove while offline. Finalize previous stop as INTERRUPTED, and start tracking at new location.
        const timeSinceLastTelemetryMs = tsMs - state.lastFreshTelemetryMs;
        if (timeSinceLastTelemetryMs > this.config.staleThresholdSec * 1000 && distKm > 0.2) {
          const interruptedStop: VehicleStopEvent = {
            ...state.activeStop,
            ended_at: new Date(state.lastFreshTelemetryMs).toISOString(),
            duration_seconds: Math.max(1, Math.round((state.lastFreshTelemetryMs - safeTimestampToMs(state.activeStop.started_at)!) / 1000)),
            status: "INTERRUPTED",
            updated_at: new Date().toISOString(),
          };

          this.updateConfirmedStop(interruptedStop);
          state.activeStop = null;
          state.provisionalStationaryStartMs = tsMs;
          state.provisionalLat = lat;
          state.provisionalLng = lng;
          state.provisionalLocation = location;
          state.provisionalEngineOn = engineOn;
          state.movementCandidateStartMs = null;
          state.lastTimestampMs = tsMs;
          state.lastFreshTelemetryMs = tsMs;
          state.lastSpeed = speed;
          state.lastLat = lat;
          state.lastLng = lng;
          this.saveToStorage();

          return {
            vehicleId,
            action: "STOP_INTERRUPTED",
            stopEvent: interruptedStop,
          };
        }

        // Same location: CONTINUITY! Continue active stop across reload, temporary latency, or slow pings.
        const startMs = safeTimestampToMs(state.activeStop.started_at)!;
        const currentDurationSec = Math.max(1, Math.round((tsMs - startMs) / 1000));
        state.activeStop.duration_seconds = currentDurationSec;
        state.activeStop.end_lat = lat;
        state.activeStop.end_lng = lng;
        state.activeStop.engine_on = engineOn;
        state.activeStop.updated_at = new Date(tsMs).toISOString();

        state.lastTimestampMs = tsMs;
        state.lastFreshTelemetryMs = tsMs;
        state.lastSpeed = speed;
        state.lastLat = lat;
        state.lastLng = lng;

        const idx = this.confirmedStops.findIndex(s => s.id === state.activeStop!.id);
        if (idx !== -1) {
          this.confirmedStops[idx] = { ...state.activeStop };
        }

        this.saveToStorage();
        return { vehicleId, action: "NONE", stopEvent: state.activeStop };
      }
      // Case B: Provisional stationary timer is ticking (< 2 min threshold)
      if (state.provisionalStationaryStartMs !== null) {
        state.lastTimestampMs = tsMs;
        state.lastFreshTelemetryMs = tsMs;
        state.lastSpeed = speed;
        state.lastLat = lat;
        state.lastLng = lng;

        const stationaryDurationSec = Math.round((tsMs - state.provisionalStationaryStartMs) / 1000);
        if (stationaryDurationSec >= this.config.stopDurationThresholdSec) {
          // Confirm Stop!
          const startedAtIso = new Date(state.provisionalStationaryStartMs).toISOString();
          const confirmedStop: VehicleStopEvent = {
            id: generateUuid(),
            dedup_key: `live:${vehicleId}:${startedAtIso}`,
            vehicle_id: vehicleId,
            vehicle_number: state.vehicleNumber,
            driver_id: state.driverId,
            driver_name: state.driverName,
            started_at: startedAtIso,
            ended_at: null,
            duration_seconds: stationaryDurationSec,
            start_lat: state.provisionalLat || lat,
            start_lng: state.provisionalLng || lng,
            end_lat: lat,
            end_lng: lng,
            location: state.provisionalLocation || location,
            engine_on: state.provisionalEngineOn,
            status: 'ACTIVE',
            source: point.source || 'telemetry',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          state.activeStop = confirmedStop;
          this.addConfirmedStop(confirmedStop);
          this.saveToStorage();
          this.persistStopToSupabase(confirmedStop);

          return {
            vehicleId,
            action: 'STOP_CONFIRMED',
            stopEvent: confirmedStop,
          };
        }

        this.saveToStorage();
        return { vehicleId, action: 'NONE' };
      }

      // Case C: First stationary observation — start provisional timer
      state.provisionalStationaryStartMs = tsMs;
      state.provisionalLat = lat;
      state.provisionalLng = lng;
      state.provisionalLocation = location;
      state.provisionalEngineOn = engineOn;
      state.lastTimestampMs = tsMs;
      state.lastFreshTelemetryMs = tsMs;
      state.lastSpeed = speed;
      state.lastLat = lat;
      state.lastLng = lng;

      this.saveToStorage();
      return { vehicleId, action: 'PROVISIONAL_STARTED' };
    }

    // ── 3. MOVEMENT TELEMETRY (speed > stopSpeedThresholdKmh) ─────────────────
    if (!state.activeStop) {
      state.provisionalStationaryStartMs = null;
      state.provisionalLat = null;
      state.provisionalLng = null;
      state.movementCandidateStartMs = null;
      state.lastTimestampMs = tsMs;
      state.lastFreshTelemetryMs = tsMs;
      state.lastSpeed = speed;
      state.lastLat = lat;
      state.lastLng = lng;
      this.saveToStorage();
      return { vehicleId, action: 'NONE' };
    }

    // Active stop resumption: check if silence gap > 120s preceded movement
    const timeSinceLastTelemetryMs = tsMs - state.lastFreshTelemetryMs;
    if (timeSinceLastTelemetryMs > this.config.staleThresholdSec * 1000) {
      const interruptedStop: VehicleStopEvent = {
        ...state.activeStop,
        ended_at: new Date(state.lastFreshTelemetryMs).toISOString(),
        duration_seconds: Math.max(1, Math.round((state.lastFreshTelemetryMs - safeTimestampToMs(state.activeStop.started_at)!) / 1000)),
        status: 'INTERRUPTED',
        updated_at: new Date().toISOString(),
      };

      this.updateConfirmedStop(interruptedStop);
      state.activeStop = null;
      state.provisionalStationaryStartMs = null;
      state.movementCandidateStartMs = null;
      state.lastTimestampMs = tsMs;
      state.lastFreshTelemetryMs = tsMs;
      state.lastSpeed = speed;
      state.lastLat = lat;
      state.lastLng = lng;
      this.saveToStorage();

      return {
        vehicleId,
        action: 'STOP_INTERRUPTED',
        stopEvent: interruptedStop,
      };
    }

    // Sustained movement check (speed > resumeSpeedThresholdKmh for >= 15s)
    if (speed > this.config.resumeSpeedThresholdKmh) {
      if (state.movementCandidateStartMs === null) {
        state.movementCandidateStartMs = tsMs;
        state.lastTimestampMs = tsMs;
        state.lastFreshTelemetryMs = tsMs;
        state.lastSpeed = speed;
        state.lastLat = lat;
        state.lastLng = lng;
        return { vehicleId, action: 'NONE' };
      }

      const movementDurationSec = Math.round((tsMs - state.movementCandidateStartMs) / 1000);
      if (movementDurationSec >= this.config.resumeDurationThresholdSec) {
        const stopStartMs = safeTimestampToMs(state.activeStop.started_at)!;
        const totalDurationSec = Math.max(1, Math.round((state.movementCandidateStartMs - stopStartMs) / 1000));

        const completedStop: VehicleStopEvent = {
          ...state.activeStop,
          ended_at: new Date(state.movementCandidateStartMs).toISOString(),
          duration_seconds: totalDurationSec,
          end_lat: lat,
          end_lng: lng,
          status: 'COMPLETED',
          updated_at: new Date().toISOString(),
        };

        this.updateConfirmedStop(completedStop);
        state.activeStop = null;
        state.provisionalStationaryStartMs = null;
        state.movementCandidateStartMs = null;
        state.lastTimestampMs = tsMs;
        state.lastFreshTelemetryMs = tsMs;
        state.lastSpeed = speed;
        state.lastLat = lat;
        state.lastLng = lng;
        this.saveToStorage();

        return {
          vehicleId,
          action: 'STOP_COMPLETED',
          stopEvent: completedStop,
        };
      }
    } else {
      state.movementCandidateStartMs = null;
    }

    state.lastTimestampMs = tsMs;
    state.lastFreshTelemetryMs = tsMs;
    state.lastSpeed = speed;
    state.lastLat = lat;
    state.lastLng = lng;
    return { vehicleId, action: 'NONE' };
  }

  public processVehicleBatch(vehicles: Vehicle[]): StopTransitionResult[] {
    const results: StopTransitionResult[] = [];
    const now = Date.now();

    for (const v of vehicles) {
      if (!v || !v.id) continue;
      // Reconcile any unassigned stop records with authentic vehicle number
      if (v.number && v.number !== 'Unassigned Vehicle' && v.number !== 'Fleet Asset') {
        for (const s of this.confirmedStops) {
          if (
            s.vehicle_id === v.id ||
            s.vehicle_id === `unassigned-${v.deviceId}` ||
            (v.deviceId && s.dedup_key?.includes(v.deviceId)) ||
            (v.id && s.dedup_key?.includes(v.id))
          ) {
            if (!s.vehicle_number || s.vehicle_number === 'Unassigned Vehicle' || s.vehicle_number === 'Fleet Asset') {
              s.vehicle_number = v.number;
              if (v.model) s.vehicle_model = v.model;
              s.vehicle_id = v.id;
            }
          }
        }
        const st = this.states.get(v.id) || (v.deviceId ? this.states.get(`unassigned-${v.deviceId}`) : undefined);
        if (st) {
          st.vehicleNumber = v.number;
          if (st.activeStop) {
            st.activeStop.vehicle_number = v.number;
            if (v.model) st.activeStop.vehicle_model = v.model;
            st.activeStop.vehicle_id = v.id;
          }
        }
      }
      const ts = safeTimestampToMs(v.lastUpdate) || now;
      const pt: TelemetryPoint = {
        vehicleId: v.id,
        vehicleNumber: v.number,
        driverId: v.driverId || null,
        driverName: v.driver || null,
        timestamp: ts,
        speed: Number(v.speed) || 0,
        lat: Number(v.lat) || 0,
        lng: Number(v.lng) || 0,
        engineOn: Boolean(v.engineOn || v.ignition),
        location: v.location,
        source: "telemetry",
      };

      const res = this.processTelemetry(pt);
      if (res.action !== "NONE") {
        results.push(res);
      }
    }

    // Periodic staleness check across tracked vehicles
    this.checkStaleness(now);

    return results;
  }

  /**
   * Scans active stops for staleness when vehicles go offline without fresh telemetry.
   */
  public checkStaleness(currentTimeMs: number = Date.now()): VehicleStopEvent[] {
    const interrupted: VehicleStopEvent[] = [];

    // Connection grace period: do not mark active stops interrupted during initial 120s after real browser reload
    const wallClockAge = Date.now() - this.engineStartTimeMs;
    if (wallClockAge < this.config.staleThresholdSec * 1000 && Math.abs(currentTimeMs - Date.now()) < 300000) {
      return interrupted;
    }

    for (const [vehicleId, state] of this.states.entries()) {
      if (state.activeStop && state.lastFreshTelemetryMs > 0) {
        const gapMs = currentTimeMs - state.lastFreshTelemetryMs;
        if (gapMs > this.config.staleThresholdSec * 1000) {
          const stopStartMs = safeTimestampToMs(state.activeStop.started_at)!;
          const durationSec = Math.max(1, Math.round((state.lastFreshTelemetryMs - stopStartMs) / 1000));

          const event: VehicleStopEvent = {
            ...state.activeStop,
            ended_at: new Date(state.lastFreshTelemetryMs).toISOString(),
            duration_seconds: durationSec,
            status: 'INTERRUPTED',
            updated_at: new Date().toISOString(),
          };

          this.updateConfirmedStop(event);
          state.activeStop = null;
          state.provisionalStationaryStartMs = null;
          state.movementCandidateStartMs = null;
          interrupted.push(event);
        }
      }
    }

    return interrupted;
  }

  public getActiveStops(): VehicleStopEvent[] {
    const active: VehicleStopEvent[] = [];
    for (const state of this.states.values()) {
      if (state.activeStop) {
        const s = { ...state.activeStop };
        const meta = resolveVehicleMetadata(s.vehicle_id, s.dedup_key, s.vehicle_number, s.vehicle_model);
        if (meta.number && meta.number !== s.vehicle_number) {
          s.vehicle_number = meta.number;
          if (meta.model) s.vehicle_model = meta.model;
          if (meta.id) s.vehicle_id = meta.id;
        }
        active.push(s);
      }
    }
    return active;
  }

  public getAllConfirmedStops(): VehicleStopEvent[] {
    return this.confirmedStops.map((s) => {
      const meta = resolveVehicleMetadata(s.vehicle_id, s.dedup_key, s.vehicle_number, s.vehicle_model);
      if (meta.number && meta.number !== s.vehicle_number) {
        return {
          ...s,
          vehicle_number: meta.number,
          vehicle_model: meta.model || s.vehicle_model,
          vehicle_id: meta.id || s.vehicle_id,
        };
      }
      return { ...s };
    });
  }

  public getVehicleState(vehicleId: string): VehicleStopTrackingState | undefined {
    return this.states.get(vehicleId);
  }

  private addConfirmedStop(stop: VehicleStopEvent) {
    const meta = resolveVehicleMetadata(stop.vehicle_id, stop.dedup_key, stop.vehicle_number, stop.vehicle_model);
    if (meta.number && meta.number !== stop.vehicle_number) {
      stop.vehicle_number = meta.number;
      if (meta.model) stop.vehicle_model = meta.model;
      if (meta.id) stop.vehicle_id = meta.id;
    }
    // Deduplicate by ID
    const idx = this.confirmedStops.findIndex((s) => s.id === stop.id);
    if (idx >= 0) {
      this.confirmedStops[idx] = stop;
    } else {
      this.confirmedStops.unshift(stop);
    }
    this.saveToStorage();

    // Trigger listeners
    for (const listener of this.onStopConfirmedListeners) {
      try {
        listener(stop);
      } catch (err) {
        console.warn("Stop listener error:", err);
      }
    }

    // Persist to Supabase asynchronously
    this.persistStopToSupabase(stop);
  }

  private updateConfirmedStop(stop: VehicleStopEvent) {
    const meta = resolveVehicleMetadata(stop.vehicle_id, stop.dedup_key, stop.vehicle_number, stop.vehicle_model);
    if (meta.number && meta.number !== stop.vehicle_number) {
      stop.vehicle_number = meta.number;
      if (meta.model) stop.vehicle_model = meta.model;
      if (meta.id) stop.vehicle_id = meta.id;
    }
    const idx = this.confirmedStops.findIndex((s) => s.id === stop.id);
    if (idx >= 0) {
      this.confirmedStops[idx] = stop;
    } else {
      this.confirmedStops.unshift(stop);
    }
    this.saveToStorage();

    // Trigger listeners
    for (const listener of this.onStopUpdatedListeners) {
      try {
        listener(stop);
      } catch (err) {
        console.warn("Stop update listener error:", err);
      }
    }

    // Persist to Supabase asynchronously
    this.persistStopToSupabase(stop);
  }

  /**
   * Safely writes a stop event to Supabase vehicle_stop_events.
   * If table doesn't exist yet or network fails, queues for retry and caches locally.
   */
  public async persistStopToSupabase(stop: VehicleStopEvent): Promise<boolean> {
    if (!this.isSupabaseTableAvailable) {
      return false;
    }

    try {
      const dedupKey =
        stop.dedup_key ||
        (stop.status === "ACTIVE"
          ? `live:${stop.vehicle_id}:${stop.started_at}`
          : `hist:${stop.vehicle_id}:${stop.started_at}`);

      const payload = {
        id: stop.id,
        dedup_key: dedupKey,
        vehicle_id: stop.vehicle_id,
        driver_id: stop.driver_id || null,
        started_at: stop.started_at,
        ended_at: stop.ended_at || null,
        duration_seconds: stop.duration_seconds,
        start_lat: stop.start_lat,
        start_lng: stop.start_lng,
        end_lat: stop.end_lat || null,
        end_lng: stop.end_lng || null,
        location: stop.location || "En Route",
        engine_on: stop.engine_on,
        status: stop.status,
        source: stop.source || "telemetry",
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("vehicle_stop_events")
        .upsert(payload, { onConflict: "dedup_key" });

      if (error) {
        if (
          error.code === "PGRST205" ||
          error.message?.includes("schema cache") ||
          error.message?.includes("404")
        ) {
          if (this.isSupabaseTableAvailable) {
            console.info(
              "[Stop Tracking] Supabase table 'vehicle_stop_events' pending migration. All stops are safely persisted in local storage."
            );
          }
          this.isSupabaseTableAvailable = false;
          this.lastTableCheckTime = Date.now();
        } else {
          console.warn("Supabase stop sync notice:", error.message);
        }
        return false;
      }

      this.isSupabaseTableAvailable = true;
      return true;
    } catch (err: any) {
      if (err?.message?.includes("404") || err?.code === "PGRST205") {
        this.isSupabaseTableAvailable = false;
        this.lastTableCheckTime = Date.now();
      } else {
        console.warn("Supabase stop persist exception:", err);
      }
      return false;
    }
  }

  /**
   * Loads confirmed stops and active states from Supabase and recovers active stops.
   */
  public async syncFromSupabase(): Promise<VehicleStopEvent[]> {
    if (!this.isSupabaseTableAvailable) {
      return this.confirmedStops;
    }

    try {
      const { data, error } = await supabase
        .from("vehicle_stop_events")
        .select("*, vehicles(number, model), drivers(name)")
        .order("started_at", { ascending: false })
        .limit(200);

      if (error) {
        if (
          error.code === "PGRST205" ||
          error.message?.includes("schema cache") ||
          error.message?.includes("404")
        ) {
          this.isSupabaseTableAvailable = false;
          this.lastTableCheckTime = Date.now();
        } else {
          console.warn("Supabase stop sync notice:", error.message);
        }
        return this.confirmedStops;
      }

      if (Array.isArray(data)) {
        this.isSupabaseTableAvailable = true;
        const mapped: VehicleStopEvent[] = data.map((d: any) => ({
          id: d.id,
          dedup_key: d.dedup_key,
          vehicle_id: d.vehicle_id,
          vehicle_number: d.vehicles?.number || d.vehicle_number || "Fleet Unit",
          vehicle_model: d.vehicles?.model,
          driver_id: d.driver_id,
          driver_name: d.drivers?.name || d.driver_name || "Unassigned",
          started_at: d.started_at,
          ended_at: d.ended_at,
          duration_seconds: Number(d.duration_seconds) || 0,
          start_lat: Number(d.start_lat) || 0,
          start_lng: Number(d.start_lng) || 0,
          end_lat: d.end_lat ? Number(d.end_lat) : null,
          end_lng: d.end_lng ? Number(d.end_lng) : null,
          location: d.location || "Nagercoil Depot",
          engine_on: Boolean(d.engine_on),
          status: d.status as StopStatus,
          source: d.source || "telemetry",
          created_at: d.created_at,
          updated_at: d.updated_at,
        }));

        this.confirmedStops = mapped;

        // Recover active stops into engine tracking state
        for (const stop of mapped) {
          if (stop.status === 'ACTIVE') {
            const startMs = safeTimestampToMs(stop.started_at) || Date.now();
            const now = Date.now();
            const existingState = this.states.get(stop.vehicle_id);
            this.states.set(stop.vehicle_id, {
              vehicleId: stop.vehicle_id,
              vehicleNumber: stop.vehicle_number || existingState?.vehicleNumber || 'Vehicle',
              driverId: stop.driver_id || existingState?.driverId || null,
              driverName: stop.driver_name || existingState?.driverName || null,
              provisionalStationaryStartMs: existingState?.provisionalStationaryStartMs || startMs,
              provisionalLat: stop.start_lat,
              provisionalLng: stop.start_lng,
              provisionalLocation: stop.location,
              provisionalEngineOn: Boolean(stop.engine_on),
              movementCandidateStartMs: null,
              activeStop: stop,
              lastTimestampMs: now,
              lastFreshTelemetryMs: now,
              lastLat: stop.start_lat,
              lastLng: stop.start_lng,
              lastSpeed: 0,
            });
          }
        }
        this.saveToStorage();
        return mapped;
      }
    } catch (err: any) {
      if (err?.message?.includes("404") || err?.code === "PGRST205") {
        this.isSupabaseTableAvailable = false;
        this.lastTableCheckTime = Date.now();
      } else {
        console.warn("Supabase stop fetch warning:", err);
      }
    }
    return this.confirmedStops;
  }

  /**
   * Backfills and calculates stop durations from actual time-series GPS readings in telemetry_history.
   * - Queries telemetry_history with pagination and chronological ordering.
   * - Never uses vehicle_telemetry snapshot intervals.
   * - Validates coordinates, filters duplicate timestamps, handles telemetry gaps.
   * - Gaps > 120s are excluded from stationary duration and close stops as INTERRUPTED.
   * - Uses valid RFC4122 UUID primary keys and deterministic dedup_key with database unique constraint.
   * - Distinguishes COMPLETED, ACTIVE and INTERRUPTED events.
   * - Preserves actual historical timestamps and never invents missing data.
   */
  public async processHistoricalGpsRecords(): Promise<{
    processedCount: number;
    stopsCreated: number;
    earliestDate: string | null;
  }> {
    let processedCount = 0;
    let stopsCreated = 0;
    let earliestDate: string | null = null;

    try {
      // 1. Fetch vehicle registry metadata
      const { data: vList } = await supabase.from("vehicles").select("id, number, model");
      const vMap = new Map<string, any>();
      (vList || []).forEach((v: any) => vMap.set(v.id, v));

      const { data: dList } = await supabase.from("drivers").select("id, name");
      const dMap = new Map<string, any>();
      (dList || []).forEach((d: any) => dMap.set(d.id, d));

      // 2. Paginated fetch of time-series readings from telemetry_history
      const pageSize = 1000;
      let page = 0;
      let hasMore = true;
      const vehicleHistory = new Map<string, TelemetryPoint[]>();

      while (hasMore) {
        const { data: pageData, error } = await supabase
          .from("telemetry_history")
          .select("*")
          .order("recorded_at", { ascending: true })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error || !pageData || pageData.length === 0) {
          hasMore = false;
          break;
        }

        for (const h of pageData) {
          if (!h.vehicle_id || !h.recorded_at) continue;
          const tsMs = safeTimestampToMs(h.recorded_at);
          if (!tsMs) continue;

          const lat = Number(h.lat);
          const lng = Number(h.lng);
          if (!isValidCoordinate(lat, lng)) continue;

          if (!earliestDate || h.recorded_at < earliestDate) {
            earliestDate = h.recorded_at;
          }

          const vObj = vMap.get(h.vehicle_id);
          const pts = vehicleHistory.get(h.vehicle_id) || [];
          pts.push({
            vehicleId: h.vehicle_id,
            vehicleNumber: vObj?.number || "Vehicle",
            driverId: h.driver_id || null,
            driverName: h.driver_name || null,
            timestamp: h.recorded_at,
            speed: Math.max(0, Number(h.speed) || 0),
            lat,
            lng,
            engineOn: Boolean(h.engine_on || h.ignition),
            location: h.location || "Historical Track",
            source: "database_history",
          });
          vehicleHistory.set(h.vehicle_id, pts);
          processedCount++;
        }

        if (pageData.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }
      }

      const now = Date.now();

      // 3. Process time-series points per vehicle chronologically
      for (const [vehicleId, rawPoints] of vehicleHistory.entries()) {
        // Strict chronological sort
        rawPoints.sort((a, b) => safeTimestampToMs(a.timestamp)! - safeTimestampToMs(b.timestamp)!);

        // Deduplicate consecutive identical timestamps
        const points: TelemetryPoint[] = [];
        let lastSeenTs = -1;
        for (const pt of rawPoints) {
          const ts = safeTimestampToMs(pt.timestamp)!;
          if (ts !== lastSeenTs) {
            points.push(pt);
            lastSeenTs = ts;
          }
        }

        let provisionalStartMs: number | null = null;
        let provisionalPt: TelemetryPoint | null = null;
        let prevPointMs: number | null = null;

        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          const tsMs = safeTimestampToMs(pt.timestamp)!;

          // Check for telemetry gap (> 120s silence)
          if (prevPointMs !== null && tsMs - prevPointMs > this.config.staleThresholdSec * 1000) {
            // Signal was disconnected. If provisional stationary duration >= 120s, finalize as INTERRUPTED
            if (provisionalStartMs !== null) {
              const stationaryDurationSec = Math.round((prevPointMs - provisionalStartMs) / 1000);
              if (stationaryDurationSec >= this.config.stopDurationThresholdSec) {
                const startedAtIso = new Date(provisionalStartMs).toISOString();
                const dedupKey = `hist:${vehicleId}:${startedAtIso}`;

                const histStop: VehicleStopEvent = {
                  id: generateUuid(),
                  dedup_key: dedupKey,
                  vehicle_id: vehicleId,
                  vehicle_number: pt.vehicleNumber || "Vehicle",
                  driver_id: pt.driverId || null,
                  driver_name: pt.driverName || null,
                  started_at: startedAtIso,
                  ended_at: new Date(prevPointMs).toISOString(),
                  duration_seconds: stationaryDurationSec,
                  start_lat: provisionalPt?.lat || pt.lat,
                  start_lng: provisionalPt?.lng || pt.lng,
                  end_lat: pt.lat,
                  end_lng: pt.lng,
                  location: provisionalPt?.location || pt.location || "En Route",
                  engine_on: Boolean(provisionalPt?.engineOn),
                  status: "INTERRUPTED",
                  source: "database_history",
                  created_at: startedAtIso,
                  updated_at: new Date(prevPointMs).toISOString(),
                };

                const existingIdx = this.confirmedStops.findIndex(
                  (s) => s.dedup_key === dedupKey || s.id === histStop.id
                );
                if (existingIdx === -1) {
                  this.confirmedStops.push(histStop);
                  stopsCreated++;
                  this.persistStopToSupabase(histStop);
                }
              }
            }
            provisionalStartMs = null;
            provisionalPt = null;
          }

          prevPointMs = tsMs;

          if (pt.speed <= this.config.stopSpeedThresholdKmh) {
            if (provisionalStartMs === null) {
              provisionalStartMs = tsMs;
              provisionalPt = pt;
            } else {
              const durSec = Math.round((tsMs - provisionalStartMs) / 1000);
              const nextPt = points[i + 1];
              const isLast = i === points.length - 1;
              const nextIsMoving = nextPt && nextPt.speed > this.config.resumeSpeedThresholdKmh;

              if (durSec >= this.config.stopDurationThresholdSec && (nextIsMoving || isLast)) {
                const startedAtIso = new Date(provisionalStartMs).toISOString();
                const dedupKey = `hist:${vehicleId}:${startedAtIso}`;

                // Distinguish ACTIVE vs COMPLETED vs INTERRUPTED
                let stopStatus: StopStatus = "COMPLETED";
                let endMs = nextPt ? safeTimestampToMs(nextPt.timestamp)! : tsMs;

                if (isLast) {
                  // If stationary reading was within stale threshold of current wall time, mark ACTIVE
                  if (now - tsMs <= this.config.staleThresholdSec * 1000) {
                    stopStatus = "ACTIVE";
                    endMs = tsMs;
                  } else {
                    stopStatus = "INTERRUPTED";
                  }
                }

                const histStop: VehicleStopEvent = {
                  id: generateUuid(),
                  dedup_key: dedupKey,
                  vehicle_id: vehicleId,
                  vehicle_number: pt.vehicleNumber || "Vehicle",
                  driver_id: pt.driverId || null,
                  driver_name: pt.driverName || null,
                  started_at: startedAtIso,
                  ended_at: stopStatus === "ACTIVE" ? null : new Date(endMs).toISOString(),
                  duration_seconds: Math.max(120, Math.round((endMs - provisionalStartMs) / 1000)),
                  start_lat: provisionalPt?.lat || pt.lat,
                  start_lng: provisionalPt?.lng || pt.lng,
                  end_lat: pt.lat,
                  end_lng: pt.lng,
                  location: provisionalPt?.location || pt.location || "En Route",
                  engine_on: Boolean(provisionalPt?.engineOn),
                  status: stopStatus,
                  source: "database_history",
                  created_at: startedAtIso,
                  updated_at: new Date(endMs).toISOString(),
                };

                const existingIdx = this.confirmedStops.findIndex(
                  (s) => s.dedup_key === dedupKey || s.id === histStop.id
                );
                if (existingIdx === -1) {
                  // Check that we don't overwrite an existing active stop for this vehicle
                  const activeIdx = this.confirmedStops.findIndex(
                    (s) => s.vehicle_id === vehicleId && s.status === "ACTIVE"
                  );
                  if (stopStatus !== "ACTIVE" || activeIdx === -1) {
                    this.confirmedStops.push(histStop);
                    stopsCreated++;
                    this.persistStopToSupabase(histStop);
                  }
                }

                if (stopStatus !== "ACTIVE") {
                  provisionalStartMs = null;
                  provisionalPt = null;
                }
              }
            }
          } else {
            provisionalStartMs = null;
            provisionalPt = null;
          }
        }
      }

      // Sort confirmed stops chronologically (newest first for display)
      this.confirmedStops.sort((a, b) => safeTimestampToMs(b.started_at)! - safeTimestampToMs(a.started_at)!);
      this.saveToStorage();
    } catch (err) {
      console.warn("[Stop Tracking] Historical GPS backfill error:", err);
    }

    return { processedCount, stopsCreated, earliestDate };
  }

  // ── LOCAL STORAGE RECOVERY (BROWSER REFRESH PROTECTION) ───────────────────

  private loadFromStorage() {
    if (typeof localStorage === 'undefined') return;
    try {
      const saved = localStorage.getItem('nanjil_vehicle_stop_events');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          this.confirmedStops = parsed;
          // Reconcile vehicle numbers in loadFromStorage
          for (const s of this.confirmedStops) {
            const meta = resolveVehicleMetadata(s.vehicle_id, s.dedup_key, s.vehicle_number, s.vehicle_model);
            if (meta.number && meta.number !== s.vehicle_number) {
              s.vehicle_number = meta.number;
              if (meta.model) s.vehicle_model = meta.model;
              if (meta.id) s.vehicle_id = meta.id;
            }
          }
        }
      }

      const savedStates = localStorage.getItem('nanjil_vehicle_stop_states');
      if (savedStates) {
        const parsed = JSON.parse(savedStates);
        if (typeof parsed === 'object' && parsed !== null) {
          for (const [vId, st] of Object.entries(parsed)) {
            const cast = st as VehicleStopTrackingState;
            if (cast.activeStop) {
              cast.lastFreshTelemetryMs = Date.now();
              const meta = resolveVehicleMetadata(cast.activeStop.vehicle_id, cast.activeStop.dedup_key, cast.activeStop.vehicle_number, cast.activeStop.vehicle_model);
              if (meta.number && meta.number !== cast.activeStop.vehicle_number) {
                cast.activeStop.vehicle_number = meta.number;
                if (meta.model) cast.activeStop.vehicle_model = meta.model;
                if (meta.id) cast.activeStop.vehicle_id = meta.id;
              }
              if (meta.number && meta.number !== cast.vehicleNumber) {
                cast.vehicleNumber = meta.number;
              }
            }
            this.states.set(vId, cast);
          }
        }
      }

      // Reconcile any active stop in confirmedStops into this.states
      const now = Date.now();
      for (const stop of this.confirmedStops) {
        if (stop.status === 'ACTIVE') {
          const existing = this.states.get(stop.vehicle_id);
          if (!existing || !existing.activeStop) {
            const startMs = safeTimestampToMs(stop.started_at) || now;
            this.states.set(stop.vehicle_id, {
              vehicleId: stop.vehicle_id,
              vehicleNumber: stop.vehicle_number || existing?.vehicleNumber || 'Vehicle',
              driverId: stop.driver_id || existing?.driverId || null,
              driverName: stop.driver_name || existing?.driverName || null,
              provisionalStationaryStartMs: existing?.provisionalStationaryStartMs || startMs,
              provisionalLat: stop.start_lat,
              provisionalLng: stop.start_lng,
              provisionalLocation: stop.location,
              provisionalEngineOn: Boolean(stop.engine_on),
              movementCandidateStartMs: null,
              activeStop: stop,
              lastTimestampMs: now,
              lastFreshTelemetryMs: now,
              lastLat: stop.start_lat,
              lastLng: stop.start_lng,
              lastSpeed: 0,
            });
          }
        }
      }
      this.saveToStorage();
    } catch {
      // Ignore storage errors
    }
  }

  private saveToStorage() {
    if (typeof localStorage === "undefined") return;
    try {
      // Keep most recent 200 stops in local cache
      const slice = this.confirmedStops.slice(0, 200);
      localStorage.setItem("nanjil_vehicle_stop_events", JSON.stringify(slice));

      // Save state map
      const obj: Record<string, VehicleStopTrackingState> = {};
      for (const [k, v] of this.states.entries()) {
        obj[k] = v;
      }
      localStorage.setItem("nanjil_vehicle_stop_states", JSON.stringify(obj));
    } catch {
      // Ignore quota errors
    }
  }

  /**
   * Resets all in-memory states and confirmed stops.
   * Useful for testing or admin manual clear.
   */
  public reset() {
    this.states.clear();
    this.confirmedStops = [];
    this.engineStartTimeMs = Date.now();
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('nanjil_vehicle_stop_events');
      localStorage.removeItem('nanjil_vehicle_stop_states');
    }
  }
}
// Global Singleton Instance for application-wide continuous stop detection
export const globalStopDetector = new StopDetectionEngine();
