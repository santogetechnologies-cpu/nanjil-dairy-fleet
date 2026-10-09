/**
 * Real Fuel-Efficiency & Mileage Calculation Engine
 * 
 * Implements the standard full-tank-to-full-tank methodology
 * using manual fuel purchase logs and physical odometer readings.
 * 
 * Formula:
 * Mileage (km/L) = Distance Travelled (km) ÷ Fuel Consumed (litres)
 * 
 * Rules:
 * - NO GPS / sensor estimation.
 * - NO fake/mock default values.
 * - If insufficient data, returns null ("Insufficient data").
 * - Handles intermediate partial refills correctly.
 * - Validates physical odometer readings strictly (rejects rollbacks & negative readings).
 * - Legitimate multiple refills at the same odometer are handled safely without losing valid fuel.
 * - Daily mileage is calculated ONLY from verified intervals completed in that measurement period.
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
    litersAdded: number;
    mileage: number | null;
    intervalDistanceKm: number;
    intervalFuelLiters: number;
  }>;
}

interface ValidatedLog {
  id: string;
  vehicle_id: string;
  driver_id?: string | null;
  liters: number;
  cost: number;
  odometer: number;
  logged_at: string;
  is_full_tank: boolean;
}

interface OdometerStop {
  odometer: number;
  totalLiters: number;
  totalCost: number;
  isFullTank: boolean;
  startDate: string;
  endDate: string;
  logIds: string[];
  fullTankLogId: string | null;
  recordCount: number;
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
  const validRecords: ValidatedLog[] = [];
  const seenIds = new Set<string>();

  for (const log of logs) {
    // Isolate by vehicle_id
    if (!log.vehicle_id || log.vehicle_id !== vehicleId) {
      continue;
    }

    // Deduplicate exact same record ID
    if (log.id && seenIds.has(log.id)) {
      continue;
    }

    const odo = Number(log.odometer);
    const lit = Number(log.liters);
    const cost = Number(log.cost);
    const dateMs = log.logged_at ? new Date(log.logged_at).getTime() : NaN;

    if (
      isNaN(odo) ||
      odo < 0 ||
      isNaN(lit) ||
      lit <= 0 ||
      isNaN(cost) ||
      cost < 0 ||
      isNaN(dateMs)
    ) {
      result.excludedCount++;
      continue;
    }

    if (log.id) {
      seenIds.add(log.id);
    }

    validRecords.push({
      id: log.id,
      vehicle_id: log.vehicle_id,
      driver_id: log.driver_id,
      odometer: odo,
      liters: lit,
      cost: cost,
      logged_at: log.logged_at,
      // Legacy records where is_full_tank is null/undefined default to true (per schema migration)
      is_full_tank: log.is_full_tank !== false,
    });
  }

  if (validRecords.length === 0) {
    return result;
  }

  // 2. Sort chronologically by logged_at ascending, then by odometer ascending
  validRecords.sort((a, b) => {
    const timeA = new Date(a.logged_at).getTime();
    const timeB = new Date(b.logged_at).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return a.odometer - b.odometer;
  });

  // 3. Process chronological records into physical odometer stops.
  // This safely handles legitimate multiple refills at the same physical odometer reading
  // without losing valid fuel quantities, while rejecting rollbacks (decreasing odometers).
  const stops: OdometerStop[] = [];
  let lastValidOdometer: number | null = null;

  for (const rec of validRecords) {
    // Odometer rollback check: odometer must not roll backward from last accepted valid odometer reading
    if (lastValidOdometer !== null && rec.odometer < lastValidOdometer) {
      // Reject rollback record without corrupting previous valid baseline
      result.excludedCount++;
      continue;
    }

    // If there is an existing stop at the exact same odometer reading, coalesce fuel & cost
    if (stops.length > 0 && stops[stops.length - 1].odometer === rec.odometer) {
      const currentStop = stops[stops.length - 1];
      currentStop.totalLiters += rec.liters;
      currentStop.totalCost += rec.cost;
      currentStop.recordCount++;
      currentStop.logIds.push(rec.id);
      currentStop.endDate = rec.logged_at;
      if (rec.is_full_tank) {
        currentStop.isFullTank = true;
        currentStop.fullTankLogId = rec.id;
      }
    } else {
      // New stop at an advanced odometer reading
      lastValidOdometer = rec.odometer;
      stops.push({
        odometer: rec.odometer,
        totalLiters: rec.liters,
        totalCost: rec.cost,
        isFullTank: rec.is_full_tank,
        startDate: rec.logged_at,
        endDate: rec.logged_at,
        logIds: [rec.id],
        fullTankLogId: rec.is_full_tank ? rec.id : null,
        recordCount: 1,
      });
    }
  }

  // 4. Full-Tank to Full-Tank Mileage Interval Processing
  let referenceFullTank: OdometerStop | null = null;
  let cumulativeFuel = 0;
  let cumulativeCost = 0;
  let intermediateRecordsCount = 0;

  for (let i = 0; i < stops.length; i++) {
    const currentStop = stops[i];

    if (!referenceFullTank) {
      // Search for the initial valid full-tank anchor
      if (currentStop.isFullTank) {
        referenceFullTank = currentStop;
        cumulativeFuel = 0;
        cumulativeCost = 0;
        intermediateRecordsCount = 0;
      } else {
        // Partial refills before any full tank anchor cannot be evaluated for mileage
        result.excludedCount += currentStop.recordCount;
      }
      continue;
    }

    // Accumulate fuel & cost consumed towards this interval
    cumulativeFuel += currentStop.totalLiters;
    cumulativeCost += currentStop.totalCost;

    if (!currentStop.isFullTank) {
      // Intermediate partial refill: continues accumulating towards the full-tank interval
      intermediateRecordsCount += currentStop.recordCount;
      continue;
    }

    // Valid ending full-tank refill reached: complete the interval!
    const distance = currentStop.odometer - referenceFullTank.odometer;

    if (distance > 0 && cumulativeFuel > 0) {
      const mileage = distance / cumulativeFuel;
      const costPerKm = cumulativeCost / distance;

      result.intervals.push({
        intervalId: currentStop.fullTankLogId || currentStop.logIds[currentStop.logIds.length - 1],
        startDate: referenceFullTank.endDate,
        startOdometer: referenceFullTank.odometer,
        endDate: currentStop.endDate,
        endOdometer: currentStop.odometer,
        distanceKm: distance,
        fuelLiters: Number(cumulativeFuel.toFixed(2)),
        totalCost: Number(cumulativeCost.toFixed(2)),
        mileageKmpl: Number(mileage.toFixed(2)),
        costPerKm: Number(costPerKm.toFixed(2)),
        includedRecordsCount: intermediateRecordsCount + currentStop.recordCount,
      });
    }

    // The ending full-tank record becomes the starting reference for the next interval
    referenceFullTank = currentStop;
    cumulativeFuel = 0;
    cumulativeCost = 0;
    intermediateRecordsCount = 0;
  }

  result.validIntervalsCount = result.intervals.length;

  if (result.validIntervalsCount > 0) {
    result.hasSufficientData = true;

    // Latest mileage from the most recent completed interval
    const latest = result.intervals[result.intervals.length - 1];
    result.latestMileage = latest.mileageKmpl;

    // Aggregate overall vehicle distance, fuel, and cost across all valid completed intervals
    const totalDist = result.intervals.reduce((sum, item) => sum + item.distanceKm, 0);
    const totalFuel = result.intervals.reduce((sum, item) => sum + item.fuelLiters, 0);
    const totalCost = result.intervals.reduce((sum, item) => sum + item.totalCost, 0);

    result.totalDistanceKm = totalDist;
    result.totalFuelLiters = Number(totalFuel.toFixed(2));
    result.totalFuelCost = Number(totalCost.toFixed(2));

    // Overall vehicle average mileage = Total Valid Distance ÷ Total Valid Fuel
    // (Never use a simple arithmetic average of interval averages)
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

  // Group logs strictly by vehicle_id
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

  // Fleet Average Mileage = Sum of Valid Fleet Distances ÷ Sum of Valid Fleet Fuel
  const fleetAvgMileage =
    totalFleetDistance > 0 && totalFleetFuel > 0
      ? Number((totalFleetDistance / totalFleetFuel).toFixed(2))
      : null;

  // 5. Daily consumption & daily mileage trend aggregated from real manual logs (past 7 days)
  // Daily fuel volume is identified as litres added (refilled) across the fleet.
  // Daily mileage is calculated ONLY when intervals completed on that measurement day,
  // using the actual interval distance and interval fuel for those completed intervals.
  const dailyMap = new Map<
    string,
    { litersAdded: number; intervalDistance: number; intervalFuel: number }
  >();
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().split("T")[0];
    dailyMap.set(key, { litersAdded: 0, intervalDistance: 0, intervalFuel: 0 });
  }

  // Sum actual fuel litres added (refilled) by calendar day
  (logs || []).forEach((log) => {
    if (!log.logged_at) return;
    const dayKey = log.logged_at.split("T")[0];
    if (dailyMap.has(dayKey)) {
      const entry = dailyMap.get(dayKey)!;
      entry.litersAdded += Number(log.liters || 0);
    }
  });

  // Accumulate distance & fuel for intervals COMPLETED on that calendar day
  Object.values(vehicleMap).forEach((va) => {
    va.intervals.forEach((interval) => {
      const dayKey = interval.endDate.split("T")[0];
      if (dailyMap.has(dayKey)) {
        const entry = dailyMap.get(dayKey)!;
        entry.intervalDistance += interval.distanceKm;
        entry.intervalFuel += interval.fuelLiters;
      }
    });
  });

  const dailyConsumption = Array.from(dailyMap.entries()).map(([dateStr, stats]) => {
    const dObj = new Date(dateStr);
    const dayLabel = dObj.toLocaleDateString([], { weekday: "short" });
    
    // Daily mileage is derived strictly from intervals that completed on this date,
    // where distance and fuel reflect the exact same measurement interval
    const mileage =
      stats.intervalDistance > 0 && stats.intervalFuel > 0
        ? Number((stats.intervalDistance / stats.intervalFuel).toFixed(1))
        : null;

    return {
      day: dayLabel,
      date: dateStr,
      consumed: Math.round(stats.litersAdded), // Kept for backward compatibility with bar charts
      litersAdded: Number(stats.litersAdded.toFixed(2)),
      mileage,
      intervalDistanceKm: stats.intervalDistance,
      intervalFuelLiters: stats.intervalFuel,
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

