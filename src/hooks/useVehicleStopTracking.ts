/**
 * useVehicleStopTracking.ts — React Hook for Vehicle Stop Tracking
 *
 * Connects the live vehicle telemetry stream (from Firebase or EMQX/Supabase)
 * to the global stop detection engine and provides real-time state, KPIs,
 * and historical stop logs for the Vehicle Stop History page.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useVehicles } from "@/hooks/useVehicleTracking";
import {
  globalStopDetector,
  type VehicleStopEvent,
  safeTimestampToMs,
} from "@/lib/vehicle-stop-detection";

export interface StopOverviewKPIs {
  totalStoppedVehicles: number;
  totalStopsToday: number;
  totalStoppedDurationTodaySec: number;
  avgStopDurationSec: number;
  longestStopToday: {
    durationSeconds: number;
    vehicleNumber: string;
    location: string;
  } | null;
  currentlyIdleCount: number;
  currentlyParkedCount: number;
  interruptedCount: number;
}

export function useVehicleStopTracking() {
  const liveVehicles = useVehicles();
  const [stops, setStops] = useState<VehicleStopEvent[]>(() => globalStopDetector.getAllConfirmedStops());
  const [activeStops, setActiveStops] = useState<VehicleStopEvent[]>(() => globalStopDetector.getActiveStops());
  const [isLoading, setIsLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [historicalStats, setHistoricalStats] = useState<{
    processedCount: number;
    stopsCreated: number;
    earliestDate: string | null;
  } | null>(null);

  // 1. Initial Load & Sync from Supabase
  const loadStopsFromSupabase = async () => {
    setIsLoading(true);
    try {
      const dbStops = await globalStopDetector.syncFromSupabase();
      setStops(dbStops);
      setActiveStops(globalStopDetector.getActiveStops());
    } catch (err) {
      console.warn("Failed to sync stop events from Supabase:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const triggerHistoricalBackfill = async () => {
    try {
      const stats = await globalStopDetector.processHistoricalGpsRecords();
      setHistoricalStats(stats);
      setStops(globalStopDetector.getAllConfirmedStops());
      setActiveStops(globalStopDetector.getActiveStops());
      return stats;
    } catch (err) {
      console.warn("Historical GPS backfill failed:", err);
      return null;
    }
  };

  useEffect(() => {
    const init = async () => {
      await loadStopsFromSupabase();
      // Incremental historical backfill runs once on initial boot
      await triggerHistoricalBackfill();
    };
    init();

    // Listen to stop engine events
    globalStopDetector.onStopConfirmed((newStop) => {
      setStops((prev) => [newStop, ...prev.filter((s) => s.id !== newStop.id)]);
      setActiveStops(globalStopDetector.getActiveStops());
    });

    globalStopDetector.onStopUpdated((updatedStop) => {
      setStops((prev) => [updatedStop, ...prev.filter((s) => s.id !== updatedStop.id)]);
      setActiveStops(globalStopDetector.getActiveStops());
    });
  }, []);

  // 2. Feed live vehicle telemetry batch to stop detection engine
  useEffect(() => {
    if (!liveVehicles || liveVehicles.length === 0) return;

    const transitions = globalStopDetector.processVehicleBatch(liveVehicles);
    if (transitions.length > 0) {
      setStops(globalStopDetector.getAllConfirmedStops());
      setActiveStops(globalStopDetector.getActiveStops());
    }
  }, [liveVehicles]);

  // 3. Second-by-second ticker for live duration updates without resetting
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => (t + 1) % 100000);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 4. Supabase Realtime channel subscription for multi-user / backend parity
  useEffect(() => {
    if (!globalStopDetector.isTableAvailable()) {
      return;
    }

    const channelId = `realtime-stops-${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vehicle_stop_events" },
        () => {
          loadStopsFromSupabase();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 5. Compute enriched active stops with live ticking duration
  const liveActiveStops = useMemo(() => {
    const now = Date.now();
    return activeStops.map((stop) => {
      const startMs = safeTimestampToMs(stop.started_at) || now;
      const liveDurationSec = Math.max(1, Math.round((now - startMs) / 1000));
      return {
        ...stop,
        duration_seconds: liveDurationSec,
      };
    });
    // tick dependency ensures second-by-second ticker updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStops, tick]);

  // 6. Compute Overview KPIs (Section A)
  const overviewKPIs: StopOverviewKPIs = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const todayStops = stops.filter((s) => {
      const startMs = safeTimestampToMs(s.started_at);
      return startMs !== null && startMs >= startOfToday;
    });

    let totalDurationTodaySec = 0;
    let longestDuration = 0;
    let longestVehicle = "";
    let longestLoc = "";
    let interrupted = 0;

    for (const s of todayStops) {
      const dur = s.duration_seconds || 0;
      totalDurationTodaySec += dur;
      if (dur > longestDuration) {
        longestDuration = dur;
        longestVehicle = s.vehicle_number || "Fleet Unit";
        longestLoc = s.location || "En Route";
      }
      if (s.status === "INTERRUPTED") {
        interrupted++;
      }
    }

    const avgDuration = todayStops.length > 0 ? Math.round(totalDurationTodaySec / todayStops.length) : 0;

    let currentlyIdle = 0;
    let currentlyParked = 0;

    for (const a of activeStops) {
      if (a.engine_on) {
        currentlyIdle++;
      } else {
        currentlyParked++;
      }
    }

    return {
      totalStoppedVehicles: activeStops.length,
      totalStopsToday: todayStops.length,
      totalStoppedDurationTodaySec: totalDurationTodaySec,
      avgStopDurationSec: avgDuration,
      longestStopToday: longestDuration > 0
        ? { durationSeconds: longestDuration, vehicleNumber: longestVehicle, location: longestLoc }
        : null,
      currentlyIdleCount: currentlyIdle,
      currentlyParkedCount: currentlyParked,
      interruptedCount: interrupted,
    };
  }, [stops, activeStops]);

  return {
    stops,
    activeStops: liveActiveStops,
    rawActiveStops: activeStops,
    isLoading,
    overviewKPIs,
    isTableAvailable: globalStopDetector.isTableAvailable(),
    refreshStops: loadStopsFromSupabase,
    verifySupabaseSync: () => globalStopDetector.verifyAndEnableSupabaseSync(),
    historicalStats,
    processHistoricalGpsRecords: triggerHistoricalBackfill,
  };
}

