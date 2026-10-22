/**
 * useAverageSpeed — Unified GPS-based average speed hook & adapter
 *
 * Re-exports the authoritative engine from @/lib/gpsAverageSpeed
 * and provides a hook interface bound to the shared singleton tracker.
 */

import { useCallback } from "react";
import {
  GpsAverageSpeedTracker,
  globalGpsSpeedTracker,
  haversineDistanceKm,
  isValidCoord,
  isValidTimestamp,
  calculateAverageSpeedFromPoints,
  extractTelemetryTimestamp,
  formatAverageSpeed,
  EARTH_RADIUS_KM,
  MOVING_SPEED_THRESHOLD_KMH,
  MAX_SEGMENT_DISTANCE_KM,
  MAX_REALISTIC_SPEED_KMH,
  MAX_GAP_SECONDS,
  MIN_DRIVING_TIME_SEC_FOR_AVG,
  type GpsPointInput,
  type DeviceTrackingState,
  type AverageSpeedResult,
} from "@/lib/gpsAverageSpeed";

// Re-export backward-compatible constant alias
export const MOVING_SPEED_THRESHOLD = MOVING_SPEED_THRESHOLD_KMH;

export {
  EARTH_RADIUS_KM,
  MOVING_SPEED_THRESHOLD_KMH,
  MAX_SEGMENT_DISTANCE_KM,
  MAX_REALISTIC_SPEED_KMH,
  MAX_GAP_SECONDS,
  MIN_DRIVING_TIME_SEC_FOR_AVG,
  haversineDistanceKm,
  isValidCoord,
  isValidTimestamp,
  calculateAverageSpeedFromPoints,
  extractTelemetryTimestamp,
  formatAverageSpeed,
  GpsAverageSpeedTracker,
  globalGpsSpeedTracker,
  type GpsPointInput,
  type DeviceTrackingState,
  type AverageSpeedResult,
};

// Backward-compatible type alias
export type GpsTrackingPoint = {
  lat: number;
  lng: number;
  timestamp: number;
  speed: number;
};

/**
 * Hook providing access to the centralized GPS Average Speed tracker.
 *
 * Operates on the global singleton so all hooks, pages, and components
 * share a single, consistent source of truth.
 */
export function useAverageSpeed() {
  const updateGpsPoint = useCallback(
    (
      rawKey: string,
      lat: number,
      lng: number,
      speed: number,
      timestamp?: number | null,
    ): void => {
      globalGpsSpeedTracker.updateGpsPoint(rawKey, lat, lng, speed, timestamp);
    },
    [],
  );

  const getAverageSpeed = useCallback(
    (rawKey: string, sinceTimestamp?: number): number | null => {
      return globalGpsSpeedTracker.getAverageSpeed(rawKey, sinceTimestamp);
    },
    [],
  );

  const getTrackingStats = useCallback(
    (rawKey: string, sinceTimestamp?: number) => {
      return globalGpsSpeedTracker.getTrackingStats(rawKey, sinceTimestamp);
    },
    [],
  );

  const registerAlias = useCallback((aliasKey: string, canonicalKey: string) => {
    globalGpsSpeedTracker.registerAlias(aliasKey, canonicalKey);
  }, []);

  const resetSpeedTracker = useCallback((rawKey?: string) => {
    globalGpsSpeedTracker.reset(rawKey);
  }, []);

  return {
    updateGpsPoint,
    getAverageSpeed,
    getTrackingStats,
    registerAlias,
    resetSpeedTracker,
    calculateAverageSpeedFromPoints,
    formatAverageSpeed,
  };
}
