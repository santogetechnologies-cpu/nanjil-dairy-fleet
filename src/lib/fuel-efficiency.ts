/**
 * Real Fuel-Efficiency & Mileage Calculation Engine
 * 
 * Implements the standard full-tank-to-full-tank methodology
 * using manual fuel purchase logs and physical odometer readings.
 * 
 * Rules:
 * - NO GPS / sensor estimation.
 * - NO fake/mock default values.
 * - If insufficient data, returns null ("Insufficient data").
 */

export interface RawFuelLog {
  id: string;
  vehicle_id: string;
  driver_id?: string | null;
  liters: number;
  cost: number;
  odometer: number;
  logged_at: string;
  is_full_tank?: boolean | null;
  vehicles?: { number?: string; model?: string } | null;
  drivers?: { name?: string } | null;
}

export interface MileageInterval {
  intervalId: string;
  startDate: string;
  startOdometer: number;
  endDate: string;
  endOdometer: number;
  distanceKm: number;
  fuelLiters: number;
  totalCost: number;
  mileageKmpl: number;
  costPerKm: number;
  includedRecordsCount: number;
}

export interface VehicleFuelAnalysis {
  vehicleId: string;
  vehicleNumber?: string;
  intervals: MileageInterval[];
  validIntervalsCount: number;
  hasSufficientData: boolean;
  latestMileage: number | null;
  averageMileage: number | null;
  totalDistanceKm: number;
  totalFuelLiters: number;
  totalFuelCost: number;
  fuelCostPerKm: number | null;
  distanceSinceLastRefill: number | null;
  efficiencyWarning: string | null;
  excludedCount: number;
}

export interface FleetFuelAnalysis {
  vehicleMap: Record<string, VehicleFuelAnalysis>;
  totalFleetDistance: number;
  totalFleetFuel: number;
  totalFleetCost: number;
  fleetAvgMileage: number | null;
  vehiclesWithDataCount: number;
  dailyConsumption: Array<{
    day: string;
    date: string;
    consumed: number;
    mileage: number | null;
  }>;
}

/**
 * Calculates fuel efficiency for a single vehicle from its fuel refill records.
 */
export function calculateVehicleFuelAnalysis(
  vehicleId: string,
  logs: RawFuelLog[],
  vehicleNumber?: string,
  currentLiveOdometer?: number | null
): VehicleFuelAnalysis {
  const result: VehicleFuelAnalysis = {
    vehicleId,
    vehicleNumber,
    intervals: [],
    validIntervalsCount: 0,
    hasSufficientData: false,
    latestMileage: null,
    averageMileage: null,
    totalDistanceKm: 0,
    totalFuelLiters: 0,
    totalFuelCost: 0,
    fuelCostPerKm: null,
    distanceSinceLastRefill: null,
    efficiencyWarning: null,
    excludedCount: 0,
  };

  if (!logs || logs.length === 0) {
    return result;
  }

  // 1. Data Validation: filter out invalid records
  const validRecords: RawFuelLog[] = [];

  for (const log of logs) {
    const odo = Number(log.odometer);
    const lit = Number(log.liters);
    const cost = Number(log.cost);

    if (
      !log.vehicle_id ||
      isNaN(odo) ||
      odo < 0 ||
      isNaN(lit) ||
      lit <= 0 ||
      isNaN(cost) ||
      cost < 0 ||
      !log.logged_at
    ) {
      result.excludedCount++;
      continue;
    }

    validRecords.push({
      ...log,
      odometer: odo,
      liters: lit,
      cost: cost,
      // If is_full_tank is null/undefined (legacy records), treat as true (standard refill)
      is_full_tank: log.is_full_tank !== false,
    });
  }

  if (validRecords.length === 0) {
    return result;
  }

  // 2. Sort chronologically by logged_at ascending (then by odometer)
  validRecords.sort((a, b) => {
    const timeA = new Date(a.logged_at).getTime();
    const timeB = new Date(b.logged_at).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return a.odometer - b.odometer;
  });

  // 3. Full-Tank to Full-Tank Mileage Interval Processing
  let referenceFullTank: RawFuelLog | null = null;
  let previousRecordOdo: number | null = null;
  let cumulativeFuel = 0;
  let cumulativeCost = 0;
  let intermediateCount = 0;

  for (let i = 0; i < validRecords.length; i++) {
    const current = validRecords[i];

    // Odometer monotonicity check: odometer must strictly advance over previous valid log
    if (previousRecordOdo !== null && current.odometer <= previousRecordOdo) {
      // Invalid interval progression (decreasing or stagnated odometer reading)
      result.excludedCount++;
      continue;
    }

    if (!referenceFullTank) {
      // Look for the initial full-tank reference anchor
      if (current.is_full_tank) {
        referenceFullTank = current;
        previousRecordOdo = current.odometer;
        cumulativeFuel = 0;
        cumulativeCost = 0;
        intermediateCount = 0;
      } else {
        // Partial refill before any full tank anchor cannot be evaluated for mileage
        result.excludedCount++;
      }
      continue;
    }

    // Accumulate fuel & cost consumed towards the interval
    cumulativeFuel += current.liters;
    cumulativeCost += current.cost;

    if (!current.is_full_tank) {
      // Partial refill: accumulates fuel and advances odometer baseline
      intermediateCount++;
      previousRecordOdo = current.odometer;
      continue;
    }

    // We reached a valid full-tank refill: close the interval!
    const distance = current.odometer - referenceFullTank.odometer;

    if (distance > 0 && cumulativeFuel > 0) {
      const mileage = distance / cumulativeFuel;
      const costPerKm = distance > 0 ? cumulativeCost / distance : 0;

      result.intervals.push({
        intervalId: current.id,
        startDate: referenceFullTank.logged_at,
        startOdometer: referenceFullTank.odometer,
        endDate: current.logged_at,
        endOdometer: current.odometer,
        distanceKm: distance,
        fuelLiters: Number(cumulativeFuel.toFixed(2)),
        totalCost: Number(cumulativeCost.toFixed(2)),
        mileageKmpl: Number(mileage.toFixed(2)),
        costPerKm: Number(costPerKm.toFixed(2)),
        includedRecordsCount: intermediateCount + 1,
      });
    }

    // Set current full-tank as the new starting reference anchor for subsequent intervals
    referenceFullTank = current;
    previousRecordOdo = current.odometer;
    cumulativeFuel = 0;
    cumulativeCost = 0;
    intermediateCount = 0;
  }

  result.validIntervalsCount = result.intervals.length;

  if (result.validIntervalsCount > 0) {
    result.hasSufficientData = true;

    // Latest mileage from the most recent completed interval
    const latest = result.intervals[result.intervals.length - 1];
    result.latestMileage = latest.mileageKmpl;

    // Aggregate fleet distance, fuel and cost across all valid completed intervals
    const totalDist = result.intervals.reduce((sum, item) => sum + item.distanceKm, 0);
    const totalFuel = result.intervals.reduce((sum, item) => sum + item.fuelLiters, 0);
    const totalCost = result.intervals.reduce((sum, item) => sum + item.totalCost, 0);

    result.totalDistanceKm = totalDist;
    result.totalFuelLiters = Number(totalFuel.toFixed(2));
    result.totalFuelCost = Number(totalCost.toFixed(2));

    if (totalDist > 0 && totalFuel > 0) {
      result.averageMileage = Number((totalDist / totalFuel).toFixed(2));
      result.fuelCostPerKm = Number((totalCost / totalDist).toFixed(2));
    }

    // Efficiency check: if latest mileage is noticeably below historical average (>= 15% drop)
    if (result.intervals.length >= 2 && result.latestMileage !== null && result.averageMileage !== null) {
      const diffPercent = ((result.latestMileage - result.averageMileage) / result.averageMileage) * 100;
      if (diffPercent <= -15) {
        result.efficiencyWarning = "Fuel efficiency is below the vehicle's historical average.";
      }
    }

    // Distance since last valid refill
    const lastRefillOdo = latest.endOdometer;
    const currentOdo = Number(currentLiveOdometer ?? 0);
    if (currentOdo > lastRefillOdo) {
      result.distanceSinceLastRefill = currentOdo - lastRefillOdo;
    }
  }

  return result;
}

/**
 * Calculates fleet-wide fuel analysis across all vehicles.
 */
export function calculateFleetFuelAnalysis(
  logs: RawFuelLog[],
  vehicles: Array<{ id: string; number?: string; odometer?: number }> = []
): FleetFuelAnalysis {
  const vehicleMap: Record<string, VehicleFuelAnalysis> = {};
  const vehicleNumbers = new Map<string, string>();
  const vehicleOdometers = new Map<string, number>();

  vehicles.forEach((v) => {
    if (v.id) {
      if (v.number) vehicleNumbers.set(v.id, v.number);
      if (typeof v.odometer === "number") vehicleOdometers.set(v.id, v.odometer);
    }
  });

  // Group logs by vehicle_id
  const logsByVehicle = new Map<string, RawFuelLog[]>();

  (logs || []).forEach((log) => {
    if (!log.vehicle_id) return;
    const list = logsByVehicle.get(log.vehicle_id) || [];
    list.push(log);
    logsByVehicle.set(log.vehicle_id, list);

    if (!vehicleNumbers.has(log.vehicle_id) && log.vehicles?.number) {
      vehicleNumbers.set(log.vehicle_id, log.vehicles.number);
    }
  });

  // Process all vehicles that either have logs or are in vehicle master
  const allVehicleIds = new Set<string>([
    ...Array.from(logsByVehicle.keys()),
    ...vehicles.map((v) => v.id).filter(Boolean),
  ]);

  let totalFleetDistance = 0;
  let totalFleetFuel = 0;
  let totalFleetCost = 0;
  let vehiclesWithDataCount = 0;

  allVehicleIds.forEach((vId) => {
    const vLogs = logsByVehicle.get(vId) || [];
    const vNum = vehicleNumbers.get(vId) || "Unknown";
    const vLiveOdo = vehicleOdometers.get(vId) ?? null;

    const analysis = calculateVehicleFuelAnalysis(vId, vLogs, vNum, vLiveOdo);
    vehicleMap[vId] = analysis;

    if (analysis.hasSufficientData) {
      totalFleetDistance += analysis.totalDistanceKm;
      totalFleetFuel += analysis.totalFuelLiters;
      totalFleetCost += analysis.totalFuelCost;
      vehiclesWithDataCount++;
    }
  });

  const fleetAvgMileage =
    totalFleetDistance > 0 && totalFleetFuel > 0
      ? Number((totalFleetDistance / totalFleetFuel).toFixed(2))
      : null;

  // 4. Daily consumption & daily mileage trend aggregated from real manual logs (past 7 days)
  const dailyMap = new Map<string, { consumed: number; distance: number }>();
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().split("T")[0];
    dailyMap.set(key, { consumed: 0, distance: 0 });
  }

  // Sum real fuel added by day
  (logs || []).forEach((log) => {
    if (!log.logged_at) return;
    const dayKey = log.logged_at.split("T")[0];
    if (dailyMap.has(dayKey)) {
      const entry = dailyMap.get(dayKey)!;
      entry.consumed += Number(log.liters || 0);
    }
  });

  // Accumulate distance for intervals completed on that day
  Object.values(vehicleMap).forEach((va) => {
    va.intervals.forEach((interval) => {
      const dayKey = interval.endDate.split("T")[0];
      if (dailyMap.has(dayKey)) {
        const entry = dailyMap.get(dayKey)!;
        entry.distance += interval.distanceKm;
      }
    });
  });

  const dailyConsumption = Array.from(dailyMap.entries()).map(([dateStr, stats]) => {
    const dObj = new Date(dateStr);
    const dayLabel = dObj.toLocaleDateString([], { weekday: "short" });
    const mileage =
      stats.distance > 0 && stats.consumed > 0
        ? Number((stats.distance / stats.consumed).toFixed(1))
        : null;

    return {
      day: dayLabel,
      date: dateStr,
      consumed: Math.round(stats.consumed),
      mileage,
    };
  });

  return {
    vehicleMap,
    totalFleetDistance,
    totalFleetFuel: Number(totalFleetFuel.toFixed(2)),
    totalFleetCost: Number(totalFleetCost.toFixed(2)),
    fleetAvgMileage,
    vehiclesWithDataCount,
    dailyConsumption,
  };
}

/**
 * Format helper for UI display
 */
export function formatMileage(kmpl: number | null | undefined): string {
  if (kmpl === null || kmpl === undefined || isNaN(kmpl)) {
    return "Insufficient data";
  }
  return `${kmpl.toFixed(1)} km/L`;
}

export function formatCostPerKm(costPerKm: number | null | undefined): string {
  if (costPerKm === null || costPerKm === undefined || isNaN(costPerKm)) {
    return "Insufficient data";
  }
  return `₹${costPerKm.toFixed(2)}/km`;
}
