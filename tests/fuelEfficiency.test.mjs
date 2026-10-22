import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateVehicleFuelAnalysis,
  calculateFleetFuelAnalysis,
  formatMileage,
  formatCostPerKm,
} from "../src/lib/fuel-efficiency.ts";

// Helper to make consistent timestamps
const day = (offsetDays) =>
  new Date(Date.now() - (6 - offsetDays) * 24 * 60 * 60 * 1000).toISOString();

test("Test A — Full-tank interval (Starting 10,000 km, ending 10,600 km, 50 L => 12 km/L)", () => {
  const vehicleId = "v-test-a";
  const logs = [
    {
      id: "log-a1",
      vehicle_id: vehicleId,
      odometer: 10000,
      liters: 45,
      cost: 4500,
      is_full_tank: true,
      logged_at: day(0),
    },
    {
      id: "log-a2",
      vehicle_id: vehicleId,
      odometer: 10600,
      liters: 50,
      cost: 5000,
      is_full_tank: true,
      logged_at: day(2),
    },
  ];

  const analysis = calculateVehicleFuelAnalysis(vehicleId, logs, "TN-74-A-1001");

  assert.equal(analysis.hasSufficientData, true);
  assert.equal(analysis.validIntervalsCount, 1);
  assert.equal(analysis.totalDistanceKm, 600);
  assert.equal(analysis.totalFuelLiters, 50);
  assert.equal(analysis.averageMileage, 12);
  assert.equal(analysis.latestMileage, 12);

  const interval = analysis.intervals[0];
  assert.equal(interval.distanceKm, 600);
  assert.equal(interval.fuelLiters, 50);
  assert.equal(interval.mileageKmpl, 12);
  assert.equal(interval.startOdometer, 10000);
  assert.equal(interval.endOdometer, 10600);
  assert.equal(formatMileage(analysis.averageMileage), "12.0 km/L");
});

test("Test B — Partial refills (Starting 20,000 km, partial 10L at 20,200 km, partial 15L at 20,400 km, ending 25L full at 20,500 km => 10 km/L)", () => {
  const vehicleId = "v-test-b";
  const logs = [
    {
      id: "log-b1",
      vehicle_id: vehicleId,
      odometer: 20000,
      liters: 40,
      cost: 4000,
      is_full_tank: true,
      logged_at: day(0),
    },
    {
      id: "log-b2",
      vehicle_id: vehicleId,
      odometer: 20200,
      liters: 10,
      cost: 1000,
      is_full_tank: false,
      logged_at: day(1),
    },
    {
      id: "log-b3",
      vehicle_id: vehicleId,
      odometer: 20400,
      liters: 15,
      cost: 1500,
      is_full_tank: false,
      logged_at: day(2),
    },
    {
      id: "log-b4",
      vehicle_id: vehicleId,
      odometer: 20500,
      liters: 25,
      cost: 2500,
      is_full_tank: true,
      logged_at: day(3),
    },
  ];

  const analysis = calculateVehicleFuelAnalysis(vehicleId, logs, "TN-74-B-2002");

  assert.equal(analysis.hasSufficientData, true);
  assert.equal(analysis.validIntervalsCount, 1);
  assert.equal(analysis.totalDistanceKm, 500); // 20,500 - 20,000 = 500 km
  assert.equal(analysis.totalFuelLiters, 50); // 10 + 15 + 25 = 50 L
  assert.equal(analysis.averageMileage, 10); // 500 / 50 = 10 km/L
  assert.equal(analysis.intervals[0].includedRecordsCount, 3); // 2 partials + 1 ending full
  assert.equal(analysis.intervals[0].totalCost, 5000); // 1000 + 1500 + 2500
});

test("Test C — Insufficient data (Only one full-tank reference => Insufficient data)", () => {
  const vehicleId = "v-test-c";
  const logs = [
    {
      id: "log-c1",
      vehicle_id: vehicleId,
      odometer: 15000,
      liters: 45,
      cost: 4500,
      is_full_tank: true,
      logged_at: day(0),
    },
    {
      id: "log-c2",
      vehicle_id: vehicleId,
      odometer: 15200,
      liters: 15,
      cost: 1500,
      is_full_tank: false, // Ongoing interval, not completed
      logged_at: day(1),
    },
  ];

  const analysis = calculateVehicleFuelAnalysis(vehicleId, logs, "TN-74-C-3003");

  assert.equal(analysis.hasSufficientData, false);
  assert.equal(analysis.validIntervalsCount, 0);
  assert.equal(analysis.averageMileage, null);
  assert.equal(analysis.latestMileage, null);
  assert.equal(formatMileage(analysis.averageMileage), "Insufficient data");
});

test("Test D — Multiple intervals (Weighted by total distance ÷ total fuel, NOT arithmetic average of intervals)", () => {
  const vehicleId = "v-test-d";
  // Interval 1: 10,000 to 10,600 km (600 km) with 50 L => 12.00 km/L
  // Interval 2: 10,600 to 10,900 km (300 km) with 30 L => 10.00 km/L
  // Arithmetic mean of intervals = (12.0 + 10.0) / 2 = 11.00 km/L
  // True weighted mileage = (600 + 300) / (50 + 30) = 900 / 80 = 11.25 km/L!
  const logs = [
    {
      id: "log-d1",
      vehicle_id: vehicleId,
      odometer: 10000,
      liters: 40,
      cost: 4000,
      is_full_tank: true,
      logged_at: day(0),
    },
    {
      id: "log-d2",
      vehicle_id: vehicleId,
      odometer: 10600,
      liters: 50,
      cost: 5000,
      is_full_tank: true,
      logged_at: day(2),
    },
    {
      id: "log-d3",
      vehicle_id: vehicleId,
      odometer: 10900,
      liters: 30,
      cost: 3000,
      is_full_tank: true,
      logged_at: day(4),
    },
  ];

  const analysis = calculateVehicleFuelAnalysis(vehicleId, logs, "TN-74-D-4004");

  assert.equal(analysis.validIntervalsCount, 2);
  assert.equal(analysis.totalDistanceKm, 900);
  assert.equal(analysis.totalFuelLiters, 80);
  // Must be 11.25 km/L (900 / 80), NOT 11.00 km/L
  assert.equal(analysis.averageMileage, 11.25);
  assert.notEqual(analysis.averageMileage, 11.0);
  assert.equal(analysis.latestMileage, 10.0);
});

test("Test E — Invalid odometer (Rollback rejected, duplicate odometer preserved, invalid entries skipped, recovery on valid entry)", () => {
  const vehicleId = "v-test-e";
  const logs = [
    // 1. Initial full-tank reference
    {
      id: "log-e1",
      vehicle_id: vehicleId,
      odometer: 10000,
      liters: 40,
      cost: 4000,
      is_full_tank: true,
      logged_at: day(0),
    },
    // 2. Invalid entry: negative litres
    {
      id: "log-e-neg-lit",
      vehicle_id: vehicleId,
      odometer: 10100,
      liters: -10,
      cost: 1000,
      is_full_tank: false,
      logged_at: day(1),
    },
    // 3. Valid partial refill at 10,200 km (10 L)
    {
      id: "log-e2a",
      vehicle_id: vehicleId,
      odometer: 10200,
      liters: 10,
      cost: 1000,
      is_full_tank: false,
      logged_at: day(2),
    },
    // 4. Duplicate physical odometer reading at 10,200 km (15 L) - MUST be safely accumulated!
    {
      id: "log-e2b",
      vehicle_id: vehicleId,
      odometer: 10200,
      liters: 15,
      cost: 1500,
      is_full_tank: false,
      logged_at: day(2),
    },
    // 5. Decreasing reading (Rollback! 9,500 < 10,200) - MUST be rejected without corrupting baseline!
    {
      id: "log-e-rollback",
      vehicle_id: vehicleId,
      odometer: 9500,
      liters: 20,
      cost: 2000,
      is_full_tank: false,
      logged_at: day(3),
    },
    // 6. Ending full-tank refill at 10,600 km (25 L) - MUST recover and calculate 600 km / 50 L = 12 km/L!
    {
      id: "log-e3",
      vehicle_id: vehicleId,
      odometer: 10600,
      liters: 25,
      cost: 2500,
      is_full_tank: true,
      logged_at: day(4),
    },
  ];

  const analysis = calculateVehicleFuelAnalysis(vehicleId, logs, "TN-74-E-5005");

  assert.equal(analysis.validIntervalsCount, 1);
  assert.equal(analysis.totalDistanceKm, 600); // 10,600 - 10,000 = 600 km
  // Total fuel consumed: 10 (log-e2a) + 15 (log-e2b) + 25 (log-e3) = 50 L
  assert.equal(analysis.totalFuelLiters, 50);
  assert.equal(analysis.averageMileage, 12);
  // Excluded count includes: log-e-neg-lit and log-e-rollback
  assert.ok(analysis.excludedCount >= 2);
});

test("Test F — Multiple vehicles (Vehicle isolation and weighted fleet average)", () => {
  const v1 = "veh-01";
  const v2 = "veh-02";

  // Vehicle 1: 10,000 -> 10,600 km (600 km), 50 L => 12.00 km/L
  // Vehicle 2: 30,000 -> 30,400 km (400 km), 50 L => 8.00 km/L
  // Fleet Distance = 600 + 400 = 1,000 km. Fleet Fuel = 50 + 50 = 100 L.
  // Fleet Average Mileage = 1,000 / 100 = 10.00 km/L!
  const logs = [
    {
      id: "l1-start",
      vehicle_id: v1,
      odometer: 10000,
      liters: 40,
      cost: 4000,
      is_full_tank: true,
      logged_at: day(0),
    },
    {
      id: "l2-start",
      vehicle_id: v2,
      odometer: 30000,
      liters: 30,
      cost: 3000,
      is_full_tank: true,
      logged_at: day(0),
    },
    {
      id: "l1-end",
      vehicle_id: v1,
      odometer: 10600,
      liters: 50,
      cost: 5000,
      is_full_tank: true,
      logged_at: day(3),
    },
    {
      id: "l2-end",
      vehicle_id: v2,
      odometer: 30400,
      liters: 50,
      cost: 5000,
      is_full_tank: true,
      logged_at: day(3),
    },
  ];

  const vehicles = [
    { id: v1, number: "TN-74-V-0001", odometer: 10600 },
    { id: v2, number: "TN-74-V-0002", odometer: 30400 },
  ];

  const fleet = calculateFleetFuelAnalysis(logs, vehicles);

  assert.equal(fleet.vehiclesWithDataCount, 2);
  assert.equal(fleet.totalFleetDistance, 1000);
  assert.equal(fleet.totalFleetFuel, 100);
  assert.equal(fleet.fleetAvgMileage, 10.0);

  // Check per-vehicle isolation
  assert.equal(fleet.vehicleMap[v1].averageMileage, 12.0);
  assert.equal(fleet.vehicleMap[v2].averageMileage, 8.0);
});

test("Test G — Daily trends (Daily mileage strictly reflects intervals completed on that day, daily refills identified as fuel added)", () => {
  const v1 = "veh-trend";
  const targetDay = day(4);
  const targetDateKey = targetDay.split("T")[0];

  // Refill on day 0: 10,000 km, 40L (full)
  // Refill on day 4: 10,600 km, 50L (full, completing 600km interval)
  // An unrelated partial refill on day 4: 20L
  const logs = [
    {
      id: "t1",
      vehicle_id: v1,
      odometer: 10000,
      liters: 40,
      cost: 4000,
      is_full_tank: true,
      logged_at: day(0),
    },
    {
      id: "t2",
      vehicle_id: v1,
      odometer: 10600,
      liters: 50,
      cost: 5000,
      is_full_tank: true,
      logged_at: targetDay,
    },
    {
      id: "t3-extra",
      vehicle_id: "veh-other",
      odometer: 50000,
      liters: 20,
      cost: 2000,
      is_full_tank: false,
      logged_at: targetDay,
    },
  ];

  const fleet = calculateFleetFuelAnalysis(logs, [{ id: v1, number: "TN-74-T-1111" }]);

  const dayEntry = fleet.dailyConsumption.find((d) => d.date === targetDateKey);
  assert.ok(dayEntry !== undefined);

  // Total litres added on that day across fleet: 50 + 20 = 70 L
  assert.equal(dayEntry.litersAdded, 70);
  assert.equal(dayEntry.consumed, 70);

  // Mileage on targetDay must be calculated from the completed interval (600 km / 50 L = 12 km/L),
  // NOT divided by unrelated daily litres added (600 / 70 = 8.57)!
  assert.equal(dayEntry.intervalDistanceKm, 600);
  assert.equal(dayEntry.intervalFuelLiters, 50);
  assert.equal(dayEntry.mileage, 12.0);

  // On days with no completed intervals, mileage must be null
  const dayWithoutInterval = fleet.dailyConsumption.find((d) => d.date === day(1).split("T")[0]);
  if (dayWithoutInterval) {
    assert.equal(dayWithoutInterval.mileage, null);
  }
});

test("Test H — Realtime & persistence data validation (Format helpers and edge cases)", () => {
  assert.equal(formatMileage(12.34), "12.3 km/L");
  assert.equal(formatMileage(null), "Insufficient data");
  assert.equal(formatMileage(undefined), "Insufficient data");
  assert.equal(formatMileage(NaN), "Insufficient data");

  assert.equal(formatCostPerKm(8.5), "₹8.50/km");
  assert.equal(formatCostPerKm(null), "Insufficient data");

  // Empty logs
  const emptyRes = calculateVehicleFuelAnalysis("v-empty", []);
  assert.equal(emptyRes.hasSufficientData, false);
  assert.equal(emptyRes.averageMileage, null);

  // Single partial refill before any full tank
  const partialOnly = calculateVehicleFuelAnalysis("v-partial", [
    {
      id: "p1",
      vehicle_id: "v-partial",
      odometer: 5000,
      liters: 20,
      cost: 2000,
      is_full_tank: false,
      logged_at: day(0),
    },
  ]);
  assert.equal(partialOnly.hasSufficientData, false);
  assert.equal(partialOnly.excludedCount, 1);
});
