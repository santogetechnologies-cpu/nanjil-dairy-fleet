import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRunningKm,
  computeTripKmpl,
  filterDriverTripsByPeriod,
  formatStatementNumber,
  getIstGreeting,
  resolveAuthoritativeOutKm,
  validateClockInEligibility,
  validateTripStart,
  validateTripCloseStatement,
  submitDriverClockIn,
  submitDriverClockOut,
  submitStartDriverTripStatement,
  submitCloseDriverTripStatement,
} from "../src/lib/driverOperationStatement.ts";

const DRIVER_ID = "d1111111-1111-4111-8111-111111111111";
const OTHER_DRIVER_ID = "d2222222-2222-4222-8222-222222222222";
const VEHICLE_ID = "v1111111-1111-4111-8111-111111111111";
const TRIP_ID = "t1111111-1111-4111-8111-111111111111";

test("Test 1: Valid trip close (Out KM = 66755, In KM = 66820) computes Running KM = 65 and updates odometer atomically", async () => {
  const res = validateTripCloseStatement({
    tripId: TRIP_ID,
    tripStatus: "Ongoing",
    tripClosedAt: null,
    tripDriverId: DRIVER_ID,
    tripVehicleId: VEHICLE_ID,
    authenticatedDriverId: DRIVER_ID,
    assignedVehicleIds: [VEHICLE_ID],
    outKm: 66755,
    inKmRaw: "66820",
    currentVehicleOdometer: 66755,
    hardwareOdometer: 66810,
    outDate: "2026-11-25",
    outTime: "06:00",
    inDate: "2026-11-25",
    inTime: "10:30",
    dieselLitresRaw: "13",
    fuelAmountRaw: "1235",
  });

  assert.equal(res.valid, true);
  assert.equal(res.parsed?.inKm, 66820);
  assert.equal(res.parsed?.runningKm, 65);
  assert.equal(res.parsed?.kmpl, 5);
  assert.equal(res.parsed?.durationMinutes, 270);

  let calledRpc = null;
  let calledArgs = null;
  const mockSupabase = {
    rpc: async (fnName, args) => {
      calledRpc = fnName;
      calledArgs = args;
      return {
        data: {
          ok: true,
          vehicle_id: VEHICLE_ID,
          vehicle_odometer: 66820,
          running_km: 65,
          kmpl: 5,
          odometer_source: "DRIVER_TRIP_CLOSURE",
          trip: { id: TRIP_ID, status: "Completed", start_km: 66755, end_km: 66820, distance: 65 },
        },
        error: null,
      };
    },
  };

  const rpcRes = await submitCloseDriverTripStatement(mockSupabase, {
    tripId: TRIP_ID,
    inKm: res.parsed.inKm,
    inDate: res.parsed.inDate,
    inTime: res.parsed.inTime,
    dieselLitres: res.parsed.dieselLitres,
    fuelAmount: res.parsed.fuelAmount,
  });

  assert.equal(calledRpc, "close_driver_trip_statement");
  assert.equal(calledArgs.p_in_km, 66820);
  assert.equal(rpcRes.ok, true);
  assert.equal(rpcRes.vehicleOdometer, 66820);
  assert.equal(rpcRes.runningKm, 65);
});

test("Test 2: Out KM = 66755, In KM = 66700 rejects with clear odometer error", () => {
  const res = validateTripCloseStatement({
    tripId: TRIP_ID,
    tripStatus: "Ongoing",
    tripDriverId: DRIVER_ID,
    tripVehicleId: VEHICLE_ID,
    authenticatedDriverId: DRIVER_ID,
    assignedVehicleIds: [VEHICLE_ID],
    outKm: 66755,
    inKmRaw: "66700",
    currentVehicleOdometer: 66755,
    outDate: "2026-11-25",
    outTime: "06:00",
    inDate: "2026-11-25",
    inTime: "10:00",
  });

  assert.equal(res.valid, false);
  assert.equal(
    res.errors.inKm,
    "Invalid Odometer Reading! In KM cannot be less than Out KM."
  );
});

test("Test 3: Empty In KM or non-numeric characters rejected", () => {
  const emptyRes = validateTripCloseStatement({
    tripId: TRIP_ID,
    tripStatus: "Ongoing",
    tripDriverId: DRIVER_ID,
    tripVehicleId: VEHICLE_ID,
    authenticatedDriverId: DRIVER_ID,
    outKm: 66755,
    inKmRaw: "",
    currentVehicleOdometer: 66755,
    outDate: "2026-11-25",
    outTime: "06:00",
    inDate: "2026-11-25",
    inTime: "10:00",
  });
  assert.equal(emptyRes.valid, false);
  assert.equal(emptyRes.errors.inKm, "In KM is mandatory.");

  const badChars = validateTripCloseStatement({
    tripId: TRIP_ID,
    tripStatus: "Ongoing",
    tripDriverId: DRIVER_ID,
    tripVehicleId: VEHICLE_ID,
    authenticatedDriverId: DRIVER_ID,
    outKm: 66755,
    inKmRaw: "66820abc",
    currentVehicleOdometer: 66755,
    outDate: "2026-11-25",
    outTime: "06:00",
    inDate: "2026-11-25",
    inTime: "10:00",
  });
  assert.equal(badChars.valid, false);
  assert.ok(badChars.errors.inKm?.includes("valid digits"));
});

test("Test 4: Negative In KM or negative Diesel/Amount rejected", () => {
  const negInKm = validateTripCloseStatement({
    tripId: TRIP_ID,
    tripStatus: "Ongoing",
    tripDriverId: DRIVER_ID,
    tripVehicleId: VEHICLE_ID,
    authenticatedDriverId: DRIVER_ID,
    outKm: 0,
    inKmRaw: "-500",
    currentVehicleOdometer: 0,
    outDate: "2026-11-25",
    outTime: "06:00",
    inDate: "2026-11-25",
    inTime: "10:00",
    dieselLitresRaw: "-5",
    fuelAmountRaw: "-100",
  });

  assert.equal(negInKm.valid, false);
  assert.ok(negInKm.errors.inKm?.includes("zero or negative"));
  assert.ok(negInKm.errors.dieselLitres?.includes("negative"));
  assert.ok(negInKm.errors.fuelAmount?.includes("negative"));
});

test("Test 5: Submitting closure twice on an already Completed trip is rejected", () => {
  const dup = validateTripCloseStatement({
    tripId: TRIP_ID,
    tripStatus: "Completed",
    tripClosedAt: "2026-11-25T05:00:00Z",
    tripDriverId: DRIVER_ID,
    tripVehicleId: VEHICLE_ID,
    authenticatedDriverId: DRIVER_ID,
    assignedVehicleIds: [VEHICLE_ID],
    outKm: 66755,
    inKmRaw: "66820",
    currentVehicleOdometer: 66820,
    outDate: "2026-11-25",
    outTime: "06:00",
    inDate: "2026-11-25",
    inTime: "10:00",
  });

  assert.equal(dup.valid, false);
  assert.ok(dup.errors.general?.includes("already been closed"));
});

test("Test 6: Driver attempting to close another driver's or unassigned vehicle's trip fails authorization", () => {
  const wrongDriver = validateTripCloseStatement({
    tripId: TRIP_ID,
    tripStatus: "Ongoing",
    tripDriverId: OTHER_DRIVER_ID,
    tripVehicleId: VEHICLE_ID,
    authenticatedDriverId: DRIVER_ID,
    assignedVehicleIds: [VEHICLE_ID],
    outKm: 66755,
    inKmRaw: "66820",
    currentVehicleOdometer: 66755,
    outDate: "2026-11-25",
    outTime: "06:00",
    inDate: "2026-11-25",
    inTime: "10:00",
  });
  assert.equal(wrongDriver.valid, false);
  assert.ok(wrongDriver.errors.general?.includes("Unauthorized"));

  const unassignedVehicle = validateTripCloseStatement({
    tripId: TRIP_ID,
    tripStatus: "Ongoing",
    tripDriverId: DRIVER_ID,
    tripVehicleId: "v9999999-9999-4999-8999-999999999999",
    authenticatedDriverId: DRIVER_ID,
    assignedVehicleIds: [VEHICLE_ID],
    outKm: 66755,
    inKmRaw: "66820",
    currentVehicleOdometer: 66755,
    outDate: "2026-11-25",
    outTime: "06:00",
    inDate: "2026-11-25",
    inTime: "10:00",
  });
  assert.equal(unassignedVehicle.valid, false);
  assert.ok(unassignedVehicle.errors.general?.includes("Unauthorized"));
});

test("Test 7: Stale In KM when GPS hardware odometer has already advanced beyond submitted value is rejected", () => {
  const stale = validateTripCloseStatement({
    tripId: TRIP_ID,
    tripStatus: "Ongoing",
    tripDriverId: DRIVER_ID,
    tripVehicleId: VEHICLE_ID,
    authenticatedDriverId: DRIVER_ID,
    assignedVehicleIds: [VEHICLE_ID],
    outKm: 66755,
    inKmRaw: "66820",
    currentVehicleOdometer: 66755,
    hardwareOdometer: 66890,
    outDate: "2026-11-25",
    outTime: "06:00",
    inDate: "2026-11-25",
    inTime: "10:00",
  });

  assert.equal(stale.valid, false);
  assert.ok(stale.errors.inKm?.includes("Stale odometer reading"));
  assert.ok(stale.errors.inKm?.includes("66,890"));
});

test("Test 8: Database failure during close RPC propagates error cleanly without faking success", async () => {
  const failingSupabase = {
    rpc: async () => ({
      data: null,
      error: { message: "Database transaction rolled back due to serialization error" },
    }),
  };

  const rpcRes = await submitCloseDriverTripStatement(failingSupabase, {
    tripId: TRIP_ID,
    inKm: 66820,
    inDate: "2026-11-25",
    inTime: "10:30",
    dieselLitres: 10,
    fuelAmount: 950,
  });

  assert.equal(rpcRes.ok, false);
  assert.equal(rpcRes.vehicleOdometer, undefined);
  assert.ok(rpcRes.error?.includes("rolled back"));
});

test("Test 9: Zero diesel, In Time earlier than Out Time, and Trip Start guard rules", async () => {
  // Zero diesel -> KMPL is null (never fabricated)
  assert.equal(computeRunningKm(66755, 66820), 65);
  assert.equal(computeTripKmpl(65, 0), null);
  assert.equal(computeTripKmpl(65, 10), 6.5);
  assert.equal(resolveAuthoritativeOutKm(66755, 66780), 66780);

  // In Time earlier than Out Time rejected
  const earlyClose = validateTripCloseStatement({
    tripId: TRIP_ID,
    tripStatus: "Ongoing",
    tripDriverId: DRIVER_ID,
    tripVehicleId: VEHICLE_ID,
    authenticatedDriverId: DRIVER_ID,
    assignedVehicleIds: [VEHICLE_ID],
    outKm: 66755,
    inKmRaw: "66820",
    currentVehicleOdometer: 66755,
    outDate: "2026-11-25",
    outTime: "09:00",
    inDate: "2026-11-25",
    inTime: "08:30",
  });
  assert.equal(earlyClose.valid, false);
  assert.ok(earlyClose.errors.inTime?.includes("earlier than Out Date"));

  // Prevent starting a second active trip when vehicle already has one
  const startBlocked = validateTripStart({
    vehicleId: VEHICLE_ID,
    driverId: DRIVER_ID,
    assignedVehicleIds: [VEHICLE_ID],
    vehicleOdometer: 66755,
    outDate: "2026-11-25",
    outTime: "10:00",
    hasActiveVehicleTrip: true,
  });
  assert.equal(startBlocked.valid, false);

  const startOk = validateTripStart({
    vehicleId: VEHICLE_ID,
    driverId: DRIVER_ID,
    assignedVehicleIds: [VEHICLE_ID],
    vehicleOdometer: 66755,
    hardwareOdometer: 66760,
    outDate: "2026-11-25",
    outTime: "10:00",
  });
  assert.equal(startOk.valid, true);
  assert.equal(startOk.outKm, 66760);

  const mockStartSupabase = {
    rpc: async (fnName) => ({
      data: { ok: true, out_km: 66760, trip: { id: TRIP_ID, status: "Ongoing", start_km: 66760 } },
      error: fnName === "start_driver_trip_statement" ? null : { message: "Unexpected RPC" },
    }),
  };
  const startRes = await submitStartDriverTripStatement(mockStartSupabase, {
    vehicleId: VEHICLE_ID,
    route: "Nagercoil -> Thuckalay",
    outDate: "2026-11-25",
    outTime: "10:00",
  });
  assert.equal(startRes.ok, true);
  assert.equal(startRes.outKm, 66760);
});

test("Test 10: Clock In eligibility blocks unassigned drivers and duplicate Clock In", async () => {
  const unassigned = validateClockInEligibility({
    driverId: DRIVER_ID,
    assignedVehicleId: null,
  });
  assert.equal(unassigned.allowed, false);
  assert.equal(unassigned.error, "No Vehicle Assigned. Please contact your administrator.");

  const duplicate = validateClockInEligibility({
    driverId: DRIVER_ID,
    assignedVehicleId: VEHICLE_ID,
    hasActiveShift: true,
  });
  assert.equal(duplicate.allowed, false);
  assert.ok(duplicate.error?.includes("Duplicate Clock In prevented"));

  const valid = validateClockInEligibility({
    driverId: DRIVER_ID,
    assignedVehicleId: VEHICLE_ID,
    hasActiveShift: false,
    hasActiveDriverTrip: false,
    vehicleHasOtherDriverTrip: false,
  });
  assert.equal(valid.allowed, true);

  const mockClockInClient = {
    rpc: async (fnName) => ({
      data:
        fnName === "driver_clock_in"
          ? {
              ok: true,
              shift: { id: "s1", driver_id: DRIVER_ID, vehicle_id: VEHICLE_ID },
              vehicle: { id: VEHICLE_ID, number: "TN75 BE 7871", odometer: 66755 },
              authoritative_odometer: 66755,
              has_active_trip: false,
            }
          : { ok: true },
      error: null,
    }),
  };

  const clockInRes = await submitDriverClockIn(mockClockInClient);
  assert.equal(clockInRes.ok, true);
  assert.equal(clockInRes.authoritativeOdometer, 66755);

  const clockOutRes = await submitDriverClockOut(mockClockInClient);
  assert.equal(clockOutRes.ok, true);
});

test("Test 11: Statement Number formatting, IST greetings, and My Trips period filters", () => {
  assert.equal(
    formatStatementNumber({
      id: "abcd1234-0000-4000-8000-000000000000",
      out_date: "2026-11-25",
    }),
    "NVIP-20261125-ABCD"
  );
  assert.equal(
    formatStatementNumber({ id: TRIP_ID, statement_number: "NVIP-20261125-7871" }),
    "NVIP-20261125-7871"
  );

  // IST greetings: 04:00Z = 09:30 IST (Morning), 08:00Z = 13:30 IST (Afternoon), 13:00Z = 18:30 IST (Evening)
  assert.equal(getIstGreeting(new Date("2026-11-25T04:00:00Z")), "Good Morning");
  assert.equal(getIstGreeting(new Date("2026-11-25T08:00:00Z")), "Good Afternoon");
  assert.equal(getIstGreeting(new Date("2026-11-25T13:00:00Z")), "Good Evening");

  const sampleTrips = [
    { id: "1", vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID, date: "2026-11-25", in_date: "2026-11-25", start: "A", destination: "B", status: "Completed" },
    { id: "2", vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID, date: "2026-11-23", in_date: "2026-11-23", start: "A", destination: "B", status: "Completed" },
    { id: "3", vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID, date: "2026-11-05", in_date: "2026-11-05", start: "A", destination: "B", status: "Completed" },
    { id: "4", vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID, date: "2026-10-18", in_date: "2026-10-18", start: "A", destination: "B", status: "Completed" },
  ];

  assert.equal(filterDriverTripsByPeriod(sampleTrips, "today", undefined, undefined, "2026-11-25").length, 1);
  assert.equal(filterDriverTripsByPeriod(sampleTrips, "week", undefined, undefined, "2026-11-25").length, 2);
  assert.equal(filterDriverTripsByPeriod(sampleTrips, "month", undefined, undefined, "2026-11-25").length, 3);
  assert.equal(filterDriverTripsByPeriod(sampleTrips, "custom", "2026-10-01", "2026-11-10", "2026-11-25").length, 2);
});
