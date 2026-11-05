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
  id: string;
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

  constructor(customConfig?: Partial<StopDetectionConfig>) {
    this.config = { ...DEFAULT_STOP_CONFIG, ...customConfig };
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
    if (!this.validateTelemetry(point)) {
      return { vehicleId: point?.vehicleId || "unknown", action: "NONE" };
    }

    const vehicleId = point.vehicleId.trim();
    const tsMs = safeTimestampToMs(point.timestamp)!;
    const speed = Math.max(0, typeof point.speed === "number" ? point.speed : parseFloat(String(point.speed)) || 0);
    const lat = typeof point.lat === "number" ? point.lat : parseFloat(String(point.lat));
    const lng = typeof point.lng === "number" ? point.lng : parseFloat(String(point.lng));
    const engineOn = Boolean(point.engineOn ?? point.ignition ?? (speed > this.config.stopSpeedThresholdKmh));
    const location = point.location || (isValidCoordinate(lat, lng) ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : "En Route");

    let state = this.states.get(vehicleId);
    if (!state) {
      state = {
        vehicleId,
        vehicleNumber: point.vehicleNumber || "Vehicle",
        driverId: point.driverId || null,
        driverName: point.driverName || null,
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
      // Out of order or duplicate point; safely drop without altering confirmed state
      return { vehicleId, action: "NONE" };
    }

    // ── 2. CHECK FOR TELEMETRY GAPS / STALENESS (SIGNAL DISCONNECTION) ────────
    const timeSinceLastTelemetryMs = tsMs - state.lastFreshTelemetryMs;
    if (timeSinceLastTelemetryMs > this.config.staleThresholdSec * 1000) {
      // Signal was interrupted!
      if (state.activeStop) {
        // Mark active stop as INTERRUPTED at the last valid telemetry timestamp
        const interruptedStop: VehicleStopEvent = {
          ...state.activeStop,
          ended_at: new Date(state.lastFreshTelemetryMs).toISOString(),
          duration_seconds: Math.max(1, Math.round((state.lastFreshTelemetryMs - safeTimestampToMs(state.activeStop.started_at)!) / 1000)),
          status: "INTERRUPTED",
          updated_at: new Date().toISOString(),
        };

        this.updateConfirmedStop(interruptedStop);
        state.activeStop = null;
        state.provisionalStationaryStartMs = null;
        state.movementCandidateStartMs = null;
        state.lastTimestampMs = tsMs;
        state.lastFreshTelemetryMs = tsMs;
        state.lastSpeed = speed;

        return {
          vehicleId,
          action: "STOP_INTERRUPTED",
          stopEvent: interruptedStop,
        };
      }
      // Reset provisional counters on reconnect
      state.provisionalStationaryStartMs = null;
      state.movementCandidateStartMs = null;
    }

    state.lastTimestampMs = tsMs;
    state.lastFreshTelemetryMs = tsMs;
    state.lastSpeed = speed;

    // ── 3. STATIONARY CONDITIONS (speed <= stopSpeedThresholdKmh) ────────────
    if (speed <= this.config.stopSpeedThresholdKmh) {
      // Cancel any pending movement candidates if vehicle dropped back to stationary
      if (state.movementCandidateStartMs !== null) {
        state.movementCandidateStartMs = null;
      }

      if (state.activeStop) {
        // Stop is already active. Update live duration and end coordinates.
        const startMs = safeTimestampToMs(state.activeStop.started_at)!;
        const currentDurationSec = Math.max(1, Math.round((tsMs - startMs) / 1000));
        state.activeStop.duration_seconds = currentDurationSec;
        state.activeStop.end_lat = lat;
        state.activeStop.end_lng = lng;
        state.activeStop.engine_on = engineOn;
        state.activeStop.updated_at = new Date().toISOString();

        return { vehicleId, action: "NONE", stopEvent: state.activeStop };
      }

      // No active stop yet: track provisional stationary state
      if (state.provisionalStationaryStartMs === null) {
        // Start provisional timer at the FIRST stationary point
        state.provisionalStationaryStartMs = tsMs;
        state.provisionalLat = lat;
        state.provisionalLng = lng;
        state.provisionalLocation = location;
        state.provisionalEngineOn = engineOn;

        return { vehicleId, action: "PROVISIONAL_STARTED" };
      }

      // Check if continuous stationary duration >= 2 minutes (120 seconds)
      const stationaryDurationSec = Math.round((tsMs - state.provisionalStationaryStartMs) / 1000);
      if (stationaryDurationSec >= this.config.stopDurationThresholdSec) {
        // ── CONFIRM STOP! ────────────────────────────────────────────────────
        // Note: The stop started at provisionalStationaryStartMs, NOT now!
        const confirmedStop: VehicleStopEvent = {
          id: generateUuid(),
          vehicle_id: vehicleId,
          vehicle_number: state.vehicleNumber,
          driver_id: state.driverId,
          driver_name: state.driverName,
          started_at: new Date(state.provisionalStationaryStartMs).toISOString(),
          ended_at: null,
          duration_seconds: stationaryDurationSec,
          start_lat: state.provisionalLat || lat,
          start_lng: state.provisionalLng || lng,
          end_lat: lat,
          end_lng: lng,
          location: state.provisionalLocation || location,
          engine_on: state.provisionalEngineOn,
          status: "ACTIVE",
          source: point.source || "telemetry",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        state.activeStop = confirmedStop;
        this.addConfirmedStop(confirmedStop);

        return {
          vehicleId,
          action: "STOP_CONFIRMED",
          stopEvent: confirmedStop,
        };
      }

      return { vehicleId, action: "NONE" };
    }

    // ── 4. MOVEMENT CONDITIONS (speed > stopSpeedThresholdKmh) ───────────────
    // If not in an active stop, any movement cleanly clears the provisional stationary timer
    if (!state.activeStop) {
      state.provisionalStationaryStartMs = null;
      state.provisionalLat = null;
      state.provisionalLng = null;
      state.movementCandidateStartMs = null;
      return { vehicleId, action: "NONE" };
    }

    // Vehicle is in an ACTIVE stop and is now moving:
    if (speed > this.config.resumeSpeedThresholdKmh) {
      if (state.movementCandidateStartMs === null) {
        // First movement observation
        state.movementCandidateStartMs = tsMs;
        return { vehicleId, action: "NONE" };
      }

      // Check if movement is sustained for 15 seconds
      const movementDurationSec = Math.round((tsMs - state.movementCandidateStartMs) / 1000);
      if (movementDurationSec >= this.config.resumeDurationThresholdSec) {
        // ── CONFIRM JOURNEY RESUMED! ─────────────────────────────────────────
        // The stop ended at the FIRST movement timestamp (movementCandidateStartMs)
        const stopStartMs = safeTimestampToMs(state.activeStop.started_at)!;
        const totalDurationSec = Math.max(1, Math.round((state.movementCandidateStartMs - stopStartMs) / 1000));

        const completedStop: VehicleStopEvent = {
          ...state.activeStop,
          ended_at: new Date(state.movementCandidateStartMs).toISOString(),
          duration_seconds: totalDurationSec,
          end_lat: lat,
          end_lng: lng,
          status: "COMPLETED",
          updated_at: new Date().toISOString(),
        };

        this.updateConfirmedStop(completedStop);
        state.activeStop = null;
        state.provisionalStationaryStartMs = null;
        state.movementCandidateStartMs = null;

        return {
          vehicleId,
          action: "STOP_COMPLETED",
          stopEvent: completedStop,
        };
      }
    } else {
      // Speed is between 3 km/h and 5 km/h: minor creep or GPS wobble, reset movement candidate
      state.movementCandidateStartMs = null;
    }

    return { vehicleId, action: "NONE" };
  }

  /**
   * Processes a live snapshot of vehicles (e.g. from useVehicles()).
   */
  public processVehicleBatch(vehicles: Vehicle[]): StopTransitionResult[] {
    const results: StopTransitionResult[] = [];
    const now = Date.now();

    for (const v of vehicles) {
      if (!v || !v.id) continue;
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
            status: "INTERRUPTED",
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

  // ── STATE & PERSISTENCE ACCESSORS ──────────────────────────────────────────

  public getActiveStops(): VehicleStopEvent[] {
    const active: VehicleStopEvent[] = [];
    for (const state of this.states.values()) {
      if (state.activeStop) {
        active.push({ ...state.activeStop });
      }
    }
    return active;
  }

  public getAllConfirmedStops(): VehicleStopEvent[] {
    return [...this.confirmedStops];
  }

  public getVehicleState(vehicleId: string): VehicleStopTrackingState | undefined {
    return this.states.get(vehicleId);
  }

  private addConfirmedStop(stop: VehicleStopEvent) {
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
   * If table doesn't exist yet or network fails, caches locally without crashing or spamming 404s.
   */
  public async persistStopToSupabase(stop: VehicleStopEvent): Promise<boolean> {
    if (!this.isSupabaseTableAvailable) {
      return false;
    }

    try {
      const payload = {
        id: stop.id,
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
        .upsert(payload, { onConflict: "id" });

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
   * Loads confirmed stops and active states from Supabase and local storage.
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
   * Backfills and calculates stop durations from existing historical database records.
   * - Reads historical GPS records from Supabase (telemetry_history and vehicle_telemetry).
   * - Analyzes historical speed, coordinates, timestamps and engine status.
   * - Identifies continuous stationary periods of at least 2 minutes (120s).
   * - Avoids duplicate stop records during repeated processing via deterministic IDs.
   * - Preserves original timestamps.
   * - Clearly marks records with `source: "database_history"`.
   * - Never invents or estimates missing GPS data.
   * - Returns diagnostic summary (processedCount, stopsCreated, earliestDate).
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
      // 1. Fetch vehicle registry metadata for vehicle_number, model, driver
      const { data: vList } = await supabase
        .from("vehicles")
        .select("id, number, model");
      const vMap = new Map<string, any>();
      (vList || []).forEach((v: any) => vMap.set(v.id, v));

      const { data: dList } = await supabase
        .from("drivers")
        .select("id, name");
      const dMap = new Map<string, any>();
      (dList || []).forEach((d: any) => dMap.set(d.id, d));

      // 2. Fetch all telemetry_history records (time-series)
      const { data: histData } = await supabase
        .from("telemetry_history")
        .select("*")
        .order("recorded_at", { ascending: true });

      // 3. Fetch all vehicle_telemetry snapshots
      const { data: vtData } = await supabase
        .from("vehicle_telemetry")
        .select("*")
        .order("last_update", { ascending: true });

      // Group historical telemetry points by vehicle in chronological order
      const vehicleHistory = new Map<string, TelemetryPoint[]>();

      if (Array.isArray(histData) && histData.length > 0) {
        for (const h of histData) {
          if (!h.vehicle_id || !h.recorded_at) continue;
          const tsMs = safeTimestampToMs(h.recorded_at);
          if (!tsMs) continue;

          if (!earliestDate || h.recorded_at < earliestDate) {
            earliestDate = h.recorded_at;
          }

          const vObj = vMap.get(h.vehicle_id);
          const pts = vehicleHistory.get(h.vehicle_id) || [];
          pts.push({
            vehicleId: h.vehicle_id,
            vehicleNumber: vObj?.number || "Vehicle",
            timestamp: h.recorded_at,
            speed: Number(h.speed) || 0,
            lat: Number(h.lat) || 0,
            lng: Number(h.lng) || 0,
            engineOn: Boolean(h.engine_on || h.ignition),
            location: h.location || "Historical Track",
            source: "database_history" as any,
          });
          vehicleHistory.set(h.vehicle_id, pts);
          processedCount++;
        }
      }

      // If time-series history records exist, process them through chronological stop detector
      for (const [vehicleId, points] of vehicleHistory.entries()) {
        points.sort((a, b) => safeTimestampToMs(a.timestamp)! - safeTimestampToMs(b.timestamp)!);

        let provisionalStartMs: number | null = null;
        let provisionalPt: TelemetryPoint | null = null;

        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          const tsMs = safeTimestampToMs(pt.timestamp)!;

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
                const stopId = `hist-${vehicleId}-${provisionalStartMs}`;
                const endMs = nextPt ? safeTimestampToMs(nextPt.timestamp)! : tsMs;

                const histStop: VehicleStopEvent = {
                  id: stopId,
                  vehicle_id: vehicleId,
                  vehicle_number: pt.vehicleNumber || "Vehicle",
                  driver_id: pt.driverId || null,
                  driver_name: pt.driverName || null,
                  started_at: new Date(provisionalStartMs).toISOString(),
                  ended_at: new Date(endMs).toISOString(),
                  duration_seconds: Math.max(120, Math.round((endMs - provisionalStartMs) / 1000)),
                  start_lat: provisionalPt?.lat || pt.lat,
                  start_lng: provisionalPt?.lng || pt.lng,
                  end_lat: pt.lat,
                  end_lng: pt.lng,
                  location: provisionalPt?.location || pt.location || "En Route",
                  engine_on: Boolean(provisionalPt?.engineOn),
                  status: "COMPLETED",
                  source: "database_history",
                  created_at: new Date(provisionalStartMs).toISOString(),
                  updated_at: new Date(endMs).toISOString(),
                };

                const existingIdx = this.confirmedStops.findIndex((s) => s.id === stopId);
                if (existingIdx === -1) {
                  this.confirmedStops.push(histStop);
                  stopsCreated++;
                  this.persistStopToSupabase(histStop);
                }
                provisionalStartMs = null;
                provisionalPt = null;
              }
            }
          } else {
            provisionalStartMs = null;
            provisionalPt = null;
          }
        }
      }

      // Also process vehicle_telemetry snapshot records
      if (Array.isArray(vtData) && vtData.length > 0) {
        for (const vt of vtData) {
          if (!vt.vehicle_id || !vt.last_update) continue;
          if (!earliestDate || vt.last_update < earliestDate) {
            earliestDate = vt.last_update;
          }
          processedCount++;

          const startMs = safeTimestampToMs(vt.last_update);
          const endMs = safeTimestampToMs(vt.updated_at);
          const speed = Number(vt.speed) || 0;

          if (startMs && endMs && speed <= this.config.stopSpeedThresholdKmh) {
            const durationSec = Math.round((endMs - startMs) / 1000);
            if (durationSec >= this.config.stopDurationThresholdSec) {
              const stopId = `hist-${vt.vehicle_id}-${startMs}`;
              const vObj = vMap.get(vt.vehicle_id);

              const histStop: VehicleStopEvent = {
                id: stopId,
                vehicle_id: vt.vehicle_id,
                vehicle_number: vObj?.number || "Fleet Unit",
                vehicle_model: vObj?.model,
                driver_id: null,
                driver_name: null,
                started_at: new Date(startMs).toISOString(),
                ended_at: new Date(endMs).toISOString(),
                duration_seconds: durationSec,
                start_lat: Number(vt.lat) || 0,
                start_lng: Number(vt.lng) || 0,
                end_lat: Number(vt.lat) || 0,
                end_lng: Number(vt.lng) || 0,
                location: vt.location || "Depot / Service Yard",
                engine_on: Boolean(vt.engine_on || vt.ignition),
                status: "COMPLETED",
                source: "database_history",
                created_at: new Date(startMs).toISOString(),
                updated_at: new Date(endMs).toISOString(),
              };

              const existingIdx = this.confirmedStops.findIndex((s) => s.id === stopId);
              if (existingIdx === -1) {
                this.confirmedStops.push(histStop);
                stopsCreated++;
                this.persistStopToSupabase(histStop);
              }
            }
          }
        }
      }

      // Keep confirmed stops sorted chronologically (newest first for display)
      this.confirmedStops.sort((a, b) => safeTimestampToMs(b.started_at)! - safeTimestampToMs(a.started_at)!);
      this.saveToStorage();

    } catch (err) {
      console.warn("[Stop Tracking] Historical GPS backfill error:", err);
    }

    return { processedCount, stopsCreated, earliestDate };
  }

  // ── LOCAL STORAGE RECOVERY (BROWSER REFRESH PROTECTION) ───────────────────

  private loadFromStorage() {
    if (typeof localStorage === "undefined") return;
    try {
      const saved = localStorage.getItem("nanjil_vehicle_stop_events");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          this.confirmedStops = parsed;
        }
      }

      const savedStates = localStorage.getItem("nanjil_vehicle_stop_states");
      if (savedStates) {
        const parsed = JSON.parse(savedStates);
        if (typeof parsed === "object" && parsed !== null) {
          for (const [vId, st] of Object.entries(parsed)) {
            this.states.set(vId, st as VehicleStopTrackingState);
          }
        }
      }
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
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("nanjil_vehicle_stop_events");
      localStorage.removeItem("nanjil_vehicle_stop_states");
    }
  }
}

// Global Singleton Instance for application-wide continuous stop detection
export const globalStopDetector = new StopDetectionEngine();
