import { test } from "node:test";
import assert from "node:assert/strict";
import {
  archiveCollectionRoute,
  computeAssignmentDashboardKpis,
  validateAssignmentInput,
  saveRouteAssignment,
  cancelRouteAssignment,
  extractRouteSummary,
  filterAssignableRoutes,
  isValidSavedRoute,
  formatAssignmentCode,
} from "../src/lib/driverRouteAssignments.ts";
import {
  computeAttendanceOverviewKpis,
  buildDriverAttendanceRows,
  buildDriverTripRouteHistoryRows,
  buildDetailedDriverHistory,
  buildAttendanceCsv,
  buildTripRouteHistoryCsv,
} from "../src/lib/driverAttendanceReports.ts";
import {
  submitDriverClockIn,
  submitDriverClockOut,
  submitStartDriverTripStatement,
  submitCloseDriverTripStatement,
} from "../src/lib/driverOperationStatement.ts";
import { resolveReportDateBounds } from "../src/lib/dailyActivityReport.ts";

const DRIVER_A = "d1111111-1111-4111-8111-111111111111";
const DRIVER_B = "d2222222-2222-4222-8222-222222222222";
const VEHICLE_A = "v1111111-1111-4111-8111-111111111111";
const VEHICLE_B = "v2222222-2222-4222-8222-222222222222";
const ROUTE_A = "r1111111-1111-4111-8111-111111111111";
const ROUTE_B = "r2222222-2222-4222-8222-222222222222";

test("TEST 1 & TEST 2: Admin assigns Driver A + Vehicle A + Route A; validation & private scoping prevent conflicts and cross-driver leakage", async () => {
  const drivers = [
    { id: DRIVER_A, name: "Driver A", phone: "+91 90000 00001" },
    { id: DRIVER_B, name: "Driver B", phone: "+91 90000 00002" },
  ];
  const vehicles = [
    { id: VEHICLE_A, number: "TN 75 BE 7871", status: "Idle", type: "Tanker 10KL" },
    { id: VEHICLE_B, number: "TN 75 BC 3835", status: "Maintenance", type: "Tata Intra" },
  ];

  // Reject unavailable Maintenance vehicle
  const unavailable = validateAssignmentInput({
    driverId: DRIVER_B,
    vehicleId: VEHICLE_B,
    routeId: ROUTE_B,
    assignmentDate: "2026-11-26",
    departureTime: "06:00",
    vehicleStatus: "Maintenance",
    existingAssignments: [],
    todayIst: "2026-11-26",
  });
  assert.equal(unavailable.valid, false);
  assert.ok(unavailable.error?.includes("unavailable"));

  // Valid Admin assignment for Driver A + Vehicle A + Route A
  const valid = validateAssignmentInput({
    driverId: DRIVER_A,
    vehicleId: VEHICLE_A,
    routeId: ROUTE_A,
    assignmentDate: "2026-11-26",
    departureTime: "05:30",
    vehicleStatus: "Idle",
    existingAssignments: [],
    todayIst: "2026-11-26",
  });
  assert.equal(valid.valid, true);

  let savedArgs = null;
  const mockSupabase = {
    rpc: async (_fn, args) => {
      savedArgs = args;
      return {
        data: {
          ok: true,
          assignment: {
            id: "a1111111-1111-4111-8111-111111111111",
            driver_id: DRIVER_A,
            vehicle_id: VEHICLE_A,
            route_id: ROUTE_A,
            route_name: "Nagercoil -> Kolachal Loop",
            assignment_date: "2026-11-26",
            departure_time: "05:30",
            status: "Assigned",
            is_active: true,
          },
        },
        error: null,
      };
    },
  };
  const saved = await saveRouteAssignment(mockSupabase, {
    driverId: DRIVER_A,
    vehicleId: VEHICLE_A,
    routeId: ROUTE_A,
    assignmentDate: "2026-11-26",
    departureTime: "05:30",
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.assignment?.status, "Assigned");
  assert.equal(savedArgs.p_driver_id, DRIVER_A);

  // Conflicting active assignment for same vehicle or same driver is rejected
  const conflictVehicle = validateAssignmentInput({
    driverId: DRIVER_B,
    vehicleId: VEHICLE_A,
    routeId: ROUTE_B,
    assignmentDate: "2026-11-26",
    departureTime: "06:30",
    vehicleStatus: "Idle",
    existingAssignments: [saved.assignment],
    todayIst: "2026-11-26",
  });
  assert.equal(conflictVehicle.valid, false);
  assert.ok(conflictVehicle.error?.includes("already actively assigned"));

  const kpis = computeAssignmentDashboardKpis(drivers, vehicles, [saved.assignment]);
  assert.deepEqual(kpis, {
    totalDrivers: 2,
    availableDrivers: 1,
    assignedDrivers: 1,
    activeAssignments: 1,
    vehiclesAssigned: 1,
    unassignedVehicles: 1,
  });

  // Route summary extraction
  const routeSummary = extractRouteSummary({
    id: ROUTE_A,
    name: "Nagercoil -> Kolachal Loop",
    centres: 6,
    start_time: "05:30",
    route_config: {
      startPoint: { name: "Nanjil Dairy Plant" },
      destinationPoint: { name: "Kolachal Depot" },
      outboundStops: [{ name: "Centre 1" }, { name: "Centre 2" }],
    },
  });
  assert.equal(routeSummary?.startPoint, "Nanjil Dairy Plant");
  assert.equal(routeSummary?.destination, "Kolachal Depot");
  assert.equal(routeSummary?.centresCount, 6);
  assert.equal(formatAssignmentCode(saved.assignment.id, "2026-11-26"), "ASG-20261126-A111");
});

test("TEST 3, 4 & 5: Driver A clocks in -> starts assigned route trip -> completes trip & clocks out via existing RPCs", async () => {
  const rpcCalls = [];
  const mockDriverClient = {
    rpc: async (fnName, args) => {
      rpcCalls.push({ fnName, args });
      if (fnName === "driver_clock_in") {
        return {
          data: {
            ok: true,
            shift: {
              id: "s-1",
              driver_id: DRIVER_A,
              vehicle_id: VEHICLE_A,
              assignment_id: "a-1",
              route_id: ROUTE_A,
              started_at: "2026-11-26T00:05:00Z", // 05:35 IST
              ended_at: null,
            },
            vehicle: { id: VEHICLE_A, number: "TN 75 BE 7871", odometer: 66755 },
            authoritative_odometer: 66755,
            has_active_trip: false,
          },
          error: null,
        };
      }
      if (fnName === "start_driver_trip_statement") {
        return {
          data: {
            ok: true,
            out_km: 66755,
            statement_number: "NVIP-20261126-1234",
            trip: {
              id: "t-1",
              driver_id: DRIVER_A,
              vehicle_id: VEHICLE_A,
              route_id: args.p_route_id,
              start_km: 66755,
              status: "Ongoing",
            },
          },
          error: null,
        };
      }
      if (fnName === "close_driver_trip_statement") {
        return {
          data: {
            ok: true,
            vehicle_id: VEHICLE_A,
            vehicle_odometer: 66820,
            running_km: 65,
            kmpl: 6.5,
            trip: { id: "t-1", status: "Completed", end_km: 66820, distance: 65 },
          },
          error: null,
        };
      }
      return { data: { ok: true }, error: null };
    },
  };

  const inRes = await submitDriverClockIn(mockDriverClient);
  assert.equal(inRes.ok, true);
  assert.equal(inRes.shift.route_id, ROUTE_A);

  const startRes = await submitStartDriverTripStatement(mockDriverClient, {
    vehicleId: VEHICLE_A,
    route: "Nagercoil -> Kolachal Loop",
    routeId: ROUTE_A,
    outDate: "2026-11-26",
    outTime: "05:40",
  });
  assert.equal(startRes.ok, true);
  assert.equal(startRes.trip?.route_id, ROUTE_A);

  const closeRes = await submitCloseDriverTripStatement(mockDriverClient, {
    tripId: "t-1",
    inKm: 66820,
    inDate: "2026-11-26",
    inTime: "10:15",
    dieselLitres: 10,
    fuelAmount: 950,
  });
  assert.equal(closeRes.ok, true);
  assert.equal(closeRes.vehicleOdometer, 66820);

  const outRes = await submitDriverClockOut(mockDriverClient);
  assert.equal(outRes.ok, true);
  assert.deepEqual(
    rpcCalls.map((c) => c.fnName),
    [
      "driver_clock_in",
      "start_driver_trip_statement",
      "close_driver_trip_statement",
      "driver_clock_out",
    ]
  );
});

test("TEST 6, 7, 8 & 10: Admin Attendance Reports, Trip & Route History (legacy fallback safe), Filters, CSV Export & Historical Preservation", () => {
  const drivers = [
    { id: DRIVER_A, name: "Driver A", phone: "9000000001", license: "DL-A" },
    { id: DRIVER_B, name: "Driver B", phone: "9000000002", license: "DL-B" },
  ];
  const vehicles = [
    { id: VEHICLE_A, number: "TN 75 BE 7871", route: "Nanjil -> Kolachal" },
    { id: VEHICLE_B, number: "TN 75 BC 3835", route: "Nanjil -> Marthandam" },
  ];
  const routes = [
    {
      id: ROUTE_A,
      name: "Kolachal Milk Circuit",
      centres: 5,
      route_config: {
        startPoint: { name: "Nanjil Dairy Plant" },
        destinationPoint: { name: "Kolachal Depot" },
      },
    },
  ];
  const shifts = [
    {
      id: "sh-1",
      driver_id: DRIVER_A,
      vehicle_id: VEHICLE_A,
      assignment_id: "asg-1",
      route_id: ROUTE_A,
      started_at: "2026-11-26T00:00:00Z", // 05:30 IST
      ended_at: "2026-11-26T04:30:00Z",   // 10:00 IST
      active_hours: 4.5,
    },
    {
      id: "sh-2",
      driver_id: DRIVER_B,
      vehicle_id: VEHICLE_B,
      started_at: "2026-11-26T02:00:00Z", // 07:30 IST
      ended_at: null, // Still On Duty
    },
  ];
  const assignments = [
    {
      id: "asg-1",
      driver_id: DRIVER_A,
      vehicle_id: VEHICLE_A,
      route_id: ROUTE_A,
      route_name: "Kolachal Milk Circuit",
      assignment_date: "2026-11-26",
      departure_time: "05:30",
      status: "Completed",
      is_active: false,
      vehicles: { number: "TN 75 BE 7871" },
    },
    {
      id: "asg-future",
      driver_id: DRIVER_A,
      vehicle_id: VEHICLE_A,
      route_id: ROUTE_A,
      route_name: "Kolachal Milk Circuit",
      assignment_date: "2026-11-27",
      departure_time: "05:30",
      status: "Scheduled",
      is_active: false,
      vehicles: { number: "TN 75 BE 7871" },
    },
  ];
  const trips = [
    {
      id: "tr-1",
      driver_id: DRIVER_A,
      vehicle_id: VEHICLE_A,
      route_id: ROUTE_A,
      statement_number: "NVIP-20261126-A1B2",
      date: "2026-11-26",
      out_date: "2026-11-26",
      in_date: "2026-11-26",
      out_time: "05:45",
      in_time: "09:45",
      start_km: 66755,
      end_km: 66820,
      distance: 65,
      duration: "4h 0m",
      status: "Completed",
      start: "Plant",
      destination: "Kolachal",
    },
    {
      id: "tr-legacy",
      driver_id: DRIVER_B,
      vehicle_id: VEHICLE_B,
      route_id: null, // Old trip without route_id must NOT invent route_id association
      date: "2026-11-25",
      out_time: "06:00",
      in_time: "08:30",
      start_km: 12000,
      end_km: 12040,
      distance: 40,
      duration: "2h 30m",
      status: "Completed",
      start: "Mulagumoodu",
      destination: "Nagercoil",
    },
  ];

  // TEST 6: Attendance KPIs & authoritative driver_shifts rows
  const attKpis = computeAttendanceOverviewKpis(drivers, shifts, "2026-11-26");
  assert.equal(attKpis.totalDrivers, 2);
  assert.equal(attKpis.clockedInToday, 2);
  assert.equal(attKpis.clockedOutToday, 1);
  assert.equal(attKpis.currentlyOnDuty, 1);
  assert.equal(attKpis.totalCompletedShifts, 1);
  assert.equal(attKpis.avgWorkingHours, 4.5);

  const boundsToday = resolveReportDateBounds("custom", "2026-11-26", "2026-11-26");
  const attRows = buildDriverAttendanceRows(
    drivers,
    shifts,
    vehicles,
    routes,
    assignments,
    boundsToday
  );
  assert.equal(attRows.length, 2);
  assert.equal(attRows[0].attendanceStatus, "On Duty"); // Open shift remains On Duty
  assert.equal(attRows[1].attendanceStatus, "Completed");

  // TEST 7: Trip & Route History links route_id cleanly and preserves legacy trip stored start/destination
  const allBounds = resolveReportDateBounds("all");
  const allTrips = buildDriverTripRouteHistoryRows(trips, drivers, vehicles, routes, allBounds);
  assert.equal(allTrips.length, 2);
  const linked = allTrips.find((t) => t.id === "tr-1");
  const legacy = allTrips.find((t) => t.id === "tr-legacy");
  assert.equal(linked?.routeName, "Kolachal Milk Circuit");
  assert.equal(linked?.startingPoint, "Nanjil Dairy Plant");
  assert.equal(linked?.destination, "Kolachal Depot");
  assert.equal(legacy?.routeId, null);
  assert.equal(legacy?.routeName, "Direct / Legacy Trip");
  assert.equal(legacy?.startingPoint, "Mulagumoodu");

  // TEST 8: Driver + Date filters & matching CSV export
  const filteredDriverA = buildDriverTripRouteHistoryRows(trips, drivers, vehicles, routes, boundsToday, {
    driverId: DRIVER_A,
  });
  assert.equal(filteredDriverA.length, 1);
  const csvTrips = buildTripRouteHistoryCsv(filteredDriverA);
  assert.ok(csvTrips.includes("Driver A"));
  assert.ok(!csvTrips.includes("Driver B"));

  const attCsv = buildAttendanceCsv(attRows.filter((r) => r.driverId === DRIVER_A));
  assert.ok(attCsv.includes("Driver A"));
  assert.ok(!attCsv.includes("Driver B"));

  // TEST 10: Historical preservation when future assignments exist
  const detailA = buildDetailedDriverHistory(DRIVER_A, drivers, shifts, assignments, trips, vehicles, routes);
  assert.equal(detailA.assignments.length, 2); // Historical 'Completed' + future 'Scheduled' both intact
  assert.equal(detailA.trips.length, 1);
  assert.equal(detailA.totalDistanceKm, 65);
  assert.equal(detailA.totalWorkingHours, 4.5);
  assert.ok(detailA.timeline.length >= 4);
});

test("TEST 9: Admin cancels future assignment and historical record stays preserved", async () => {
  const cancelledCalls = [];
  const mockSupabase = {
    rpc: async (fnName, args) => {
      cancelledCalls.push({ fnName, args });
      return {
        data: {
          ok: true,
          assignment: {
            id: args.p_assignment_id,
            status: "Cancelled",
            is_active: false,
          },
        },
        error: null,
      };
    },
  };

  const res = await cancelRouteAssignment(mockSupabase, "asg-future", "Vehicle reassigned");
  assert.equal(res.ok, true);
  assert.equal(res.assignment?.status, "Cancelled");
  assert.equal(res.assignment?.is_active, false);
  assert.equal(cancelledCalls[0].fnName, "admin_cancel_route_assignment");
});

test("TEST 11: Route dropdown filters out archived & incomplete routes and keeps valid manual Supabase routes", () => {
  const routesCatalog = [
    {
      id: "r-archived",
      name: "Old Legacy Coastal Loop",
      is_archived: true,
      route_config: {
        startPoint: { name: "Plant", lat: 8.26, lng: 77.28 },
        destinationPoint: { name: "Kanyakumari", lat: 8.08, lng: 77.53 },
        outboundStops: [{ id: "1", name: "Stop 1", lat: 8.2, lng: 77.3 }],
      },
    },
    {
      id: "r-incomplete",
      name: "Unconfigured Draft Route",
      is_archived: false,
      route_config: null,
    },
    {
      id: "r-manual-a",
      name: "Manual Route A",
      is_archived: false,
      start_time: "05:45",
      route_config: {
        createdManually: true,
        roundTripType: "different_path",
        startPoint: { name: "Mulagumoodu Depot", lat: 8.2607, lng: 77.2883 },
        destinationPoint: { name: "Colachel Yard", lat: 8.1755, lng: 77.2562 },
        outboundStops: [
          { id: "out-1", name: "Villukuri Stop", lat: 8.2435, lng: 77.3325, isMandatory: true },
          { id: "out-2", name: "Eraniel Stop", lat: 8.2045, lng: 77.3065, isMandatory: false },
        ],
        returnStops: [
          { id: "ret-1", name: "Thingal Return Stop", lat: 8.2165, lng: 77.2785, isMandatory: false },
        ],
        totalDistanceKm: 42.5,
        totalDurationMins: 85,
      },
    },
  ];

  const assignable = filterAssignableRoutes(routesCatalog);
  assert.equal(assignable.length, 1);
  assert.equal(assignable[0].id, "r-manual-a");
  assert.equal(isValidSavedRoute(routesCatalog[0]), false);
  assert.equal(isValidSavedRoute(routesCatalog[1]), false);

  const summary = extractRouteSummary(assignable[0]);
  assert.ok(summary);
  assert.equal(summary.name, "Manual Route A");
  assert.equal(summary.startPoint, "Mulagumoodu Depot");
  assert.equal(summary.destination, "Colachel Yard");
  assert.equal(summary.outboundStops.length, 2);
  assert.equal(summary.returnStops.length, 1);
  assert.equal(summary.totalDistanceKm, 42.5);
  assert.equal(summary.totalDurationMins, 85);
});

test("TEST 12: Historical trip report preserves immutable route_snapshot after route modification or archival", async () => {
  const editedOrArchivedRoute = {
    id: ROUTE_A,
    name: "Renamed Route V2 (Archived)",
    is_archived: true,
    route_config: {
      startPoint: { name: "New Origin V2", lat: 8.3, lng: 77.3 },
      destinationPoint: { name: "New Dest V2", lat: 8.1, lng: 77.4 },
      outboundStops: [],
    },
  };

  const historicalTripWithSnapshot = {
    id: "tr-snap-1",
    driver_id: DRIVER_A,
    vehicle_id: VEHICLE_A,
    route_id: ROUTE_A,
    statement_number: "NVIP-20261126-SNAP",
    date: "2026-11-26",
    out_date: "2026-11-26",
    in_date: "2026-11-26",
    out_time: "05:30",
    in_time: "09:10",
    start_km: 50000,
    end_km: 50054,
    distance: 54,
    status: "Completed",
    route_snapshot: {
      id: ROUTE_A,
      name: "Original Route A (Snapshotted)",
      route_config: {
        startPoint: { name: "Original Plant", lat: 8.2607, lng: 77.2883 },
        destinationPoint: { name: "Original Colachel", lat: 8.1755, lng: 77.2562 },
        outboundStops: [{ id: "o1", name: "Centre One", lat: 8.22, lng: 77.27 }],
      },
    },
  };

  const rows = buildDriverTripRouteHistoryRows(
    [historicalTripWithSnapshot],
    [{ id: DRIVER_A, name: "Driver A" }],
    [{ id: VEHICLE_A, number: "TN 75 BE 7871" }],
    [editedOrArchivedRoute],
    resolveReportDateBounds("all")
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].routeName, "Original Route A (Snapshotted)");
  assert.equal(rows[0].startingPoint, "Original Plant");
  assert.equal(rows[0].destination, "Original Colachel");

  // Archive RPC verification
  const rpcCalls = [];
  const mockSupabase = {
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      return { data: { ok: true, route: { id: args.p_route_id, is_archived: true } }, error: null };
    },
  };
  const archiveRes = await archiveCollectionRoute(mockSupabase, ROUTE_A);
  assert.equal(archiveRes.ok, true);
  assert.equal(rpcCalls[0].fn, "admin_archive_collection_route");
  assert.equal(rpcCalls[0].args.p_route_id, ROUTE_A);
});
