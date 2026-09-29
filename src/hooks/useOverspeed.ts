/**
 * useOverspeed.ts — Hook for Live Fleet Overspeed Monitoring
 *
 * Connects vehicles streamed from the existing telemetry pipeline to the
 * centralized overspeed classification and alert persistence system.
 */

import { useState, useEffect, useRef } from "react";
import type { Vehicle } from "@/lib/types";
import {
  getOverspeedStatus,
  globalOverspeedManager,
  type OverspeedTransitionEvent,
} from "@/lib/overspeed";

export function useOverspeedMonitor(vehicles: Vehicle[]) {
  const [activeWarnings, setActiveWarnings] = useState<Vehicle[]>([]);
  const [activeCriticals, setActiveCriticals] = useState<Vehicle[]>([]);
  const [recentTransition, setRecentTransition] = useState<OverspeedTransitionEvent | null>(null);

  // Track if this is the initial render to avoid noise
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!vehicles || vehicles.length === 0) {
      setActiveWarnings([]);
      setActiveCriticals([]);
      return;
    }

    const warnings: Vehicle[] = [];
    const criticals: Vehicle[] = [];

    for (const v of vehicles) {
      const status = getOverspeedStatus(v.speed);
      if (status.level === "critical") {
        criticals.push(v);
      } else if (status.level === "warning") {
        warnings.push(v);
      }
    }

    setActiveWarnings(warnings);
    setActiveCriticals(criticals);

    // Evaluate transitions across live snapshots
    const transitions = globalOverspeedManager.evaluateTransitions(vehicles);

    if (transitions.length > 0) {
      // Asynchronously persist qualified alerts to Supabase (with 30m cooldown & spam prevention)
      globalOverspeedManager.persistAlerts(transitions);

      // Select most critical transition for live banner notification
      const highest = transitions.find((t) => t.currentLevel === "critical") || transitions[0];
      setRecentTransition(highest);
    }

    initializedRef.current = true;
  }, [vehicles]);

  return {
    activeWarnings,
    activeCriticals,
    hasOverspeed: activeWarnings.length > 0 || activeCriticals.length > 0,
    hasCritical: activeCriticals.length > 0,
    hasWarning: activeWarnings.length > 0,
    recentTransition,
    clearRecentTransition: () => setRecentTransition(null),
  };
}
