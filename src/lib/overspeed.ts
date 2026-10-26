/**
 * overspeed.ts — Centralized Real-Time Overspeed Classification and Alert System
 *
 * THREE LIVE SPEED STATES:
 *   NORMAL:   speed < 80 km/h
 *   WARNING:  80 <= speed < 100 km/h (Orange Warning)
 *   CRITICAL: speed >= 100 km/h (Red Critical)
 *
 * Designed for real-time Firebase telemetry monitoring without alert spam.
 */

import { supabase } from "@/lib/supabase";
import type { Vehicle } from "@/lib/types";

// ── Threshold Constants ──────────────────────────────────────────────────────
export const DEFAULT_SPEED_LIMIT_KMH = 60;
export const WARNING_SPEED_DELTA_KMH = 10;
export const CRITICAL_SPEED_DELTA_KMH = 20;
export const OVERSPEED_ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

export type OverspeedLevel = "normal" | "warning" | "critical";

export interface OverspeedStatus {
  level: OverspeedLevel;
  label: "Normal" | "Overspeed Warning" | "Critical Overspeed";
  speed: number;
  limit: number;
  excessSpeed: number;
  isOverspeed: boolean;
}

export interface OverspeedTransitionEvent {
  vehicleId: string;
  vehicleNumber: string;
  previousLevel: OverspeedLevel;
  currentLevel: OverspeedLevel;
  speed: number;
  timestamp: number;
}

/**
 * Validates whether an ID is a genuine Supabase UUID (not unassigned or raw device ID)
 */
export function isRealSupabaseVehicleId(id: unknown): boolean {
  if (typeof id !== "string") return false;
  const trimmed = id.trim();
  if (!trimmed || trimmed.startsWith("unassigned-")) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
}

/**
 * Centralized overspeed classification function.
 * Supports configurable speed threshold (defaults to 60 km/h).
 * Normal: <= limit
 * Warning: limit < speed <= limit + 20
 * Critical: > limit + 20
 */
export function getOverspeedStatus(speedVal: unknown, customLimit: number = DEFAULT_SPEED_LIMIT_KMH): OverspeedStatus {
  const speed =
    typeof speedVal === "number" && !isNaN(speedVal)
      ? speedVal
      : typeof speedVal === "string"
        ? parseFloat(speedVal)
        : 0;

  const limit = typeof customLimit === "number" && customLimit > 0 ? customLimit : DEFAULT_SPEED_LIMIT_KMH;

  if (isNaN(speed) || speed <= 0) {
    return {
      level: "normal",
      label: "Normal",
      speed: 0,
      limit,
      excessSpeed: 0,
      isOverspeed: false,
    };
  }

  const excess = Math.max(0, Math.round(speed - limit));

  if (speed > limit + CRITICAL_SPEED_DELTA_KMH) {
    return {
      level: "critical",
      label: "Critical Overspeed",
      speed,
      limit,
      excessSpeed: excess,
      isOverspeed: true,
    };
  }

  if (speed > limit) {
    return {
      level: "warning",
      label: "Overspeed Warning",
      speed,
      limit,
      excessSpeed: excess,
      isOverspeed: true,
    };
  }

  return {
    level: "normal",
    label: "Normal",
    speed,
    limit,
    excessSpeed: 0,
    isOverspeed: false,
  };
}

/**
 * State manager for tracking threshold crossings and generating alerts
 * with duplicate spam prevention and 30-minute cooldowns.
 */
export class OverspeedManager {
  private vehicleLevels = new Map<string, OverspeedLevel>();
  private lastAlertTimestamps = new Map<string, number>();

  constructor(private supabaseClient: any = supabase) {}

  /**
   * Evaluates vehicles and detects state transitions across snapshots.
   */
  public evaluateTransitions(vehicles: Vehicle[]): OverspeedTransitionEvent[] {
    const events: OverspeedTransitionEvent[] = [];

    for (const v of vehicles) {
      const key = v.id || v.deviceId;
      if (!key) continue;

      const prevLevel = this.vehicleLevels.get(key) ?? "normal";
      const status = getOverspeedStatus(v.speed);
      const currLevel = status.level;

      // Update state
      this.vehicleLevels.set(key, currLevel);

      // Check if a state transition occurred
      if (prevLevel !== currLevel) {
        events.push({
          vehicleId: v.id,
          vehicleNumber: v.number || "Unassigned Vehicle",
          previousLevel: prevLevel,
          currentLevel: currLevel,
          speed: status.speed,
          timestamp: Date.now(),
        });
      }
    }

    return events;
  }

  /**
   * Persists safety alerts to Supabase public.alerts for qualified transitions.
   * Enforces:
   *  - Real Supabase vehicle ID only (never unassigned-*, docId, or raw device ID)
   *  - 30-minute cooldown per vehicle
   *  - Transitions only (Normal -> Warning, Warning -> Critical, Normal -> Critical)
   */
  public async persistAlerts(events: OverspeedTransitionEvent[]): Promise<void> {
    for (const ev of events) {
      // Recovery transitions (Warning -> Normal, Critical -> Normal) do not generate alert records
      if (ev.currentLevel === "normal") continue;

      // Down-transitions (Critical -> Warning) do not spam a new alert record
      if (ev.previousLevel === "critical" && ev.currentLevel === "warning") continue;

      // Must be a real Supabase vehicle ID
      if (!isRealSupabaseVehicleId(ev.vehicleId)) {
        continue;
      }

      const severity = ev.currentLevel === "critical" ? "High" : "Medium";
      const cooldownKey = `${ev.vehicleId}:${severity}`;
      const lastSent = this.lastAlertTimestamps.get(cooldownKey) || 0;
      const now = Date.now();

      // Check in-memory cooldown
      if (now - lastSent < OVERSPEED_ALERT_COOLDOWN_MS) {
        continue;
      }

      const message =
        ev.currentLevel === "critical"
          ? `Critical overspeed: ${Math.round(ev.speed)} km/h (critical threshold: ${CRITICAL_SPEED_KMH} km/h)`
          : `Over-speed warning: ${Math.round(ev.speed)} km/h (warning threshold: ${WARNING_SPEED_KMH} km/h)`;

      try {
        // Also check DB for recent active safety alerts for this vehicle within 30 min
        const thirtyMinsAgo = new Date(now - OVERSPEED_ALERT_COOLDOWN_MS).toISOString();
        const { data: existing } = await this.supabaseClient
          .from("alerts")
          .select("id")
          .eq("vehicle_id", ev.vehicleId)
          .eq("type", "Safety")
          .eq("severity", severity)
          .eq("resolved", false)
          .gte("time", thirtyMinsAgo)
          .limit(1);

        if (existing && existing.length > 0) {
          this.lastAlertTimestamps.set(cooldownKey, now);
          continue;
        }

        const { error } = await this.supabaseClient.from("alerts").insert({
          vehicle_id: ev.vehicleId,
          type: "Safety",
          severity,
          message,
          time: new Date(now).toISOString(),
          resolved: false,
        });

        if (!error) {
          this.lastAlertTimestamps.set(cooldownKey, now);
          console.log(`[Overspeed Alert] Recorded ${severity} alert for ${ev.vehicleNumber}: ${message}`);
        } else {
          console.warn("[Overspeed Alert] Insert warning:", error.message);
        }
      } catch (err) {
        console.warn("[Overspeed Alert] Database error:", err);
      }
    }
  }

  /**
   * Reset tracking state (useful for tests or diagnostics)
   */
  public reset(): void {
    this.vehicleLevels.clear();
    this.lastAlertTimestamps.clear();
  }
}

// Global singleton instance for the live application
export const globalOverspeedManager = new OverspeedManager();
