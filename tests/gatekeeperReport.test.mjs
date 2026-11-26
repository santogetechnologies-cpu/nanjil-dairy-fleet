import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateGateOutgoingEntry,
  validateGateIncomingEntry,
  computeDurationMinutes,
  formatGateDuration,
  submitGateOutgoingEntry,
  submitGateIncomingEntry,
  buildGatekeeperReportRows,
  computeGatekeeperReportKpis,
  buildGatekeeperReportCsv,
} from "../src/lib/gatekeeperLogs.ts";
import { resolveReportDateBounds } from "../src/lib/dailyActivityReport.ts";

test("validateGateOutgoingEntry accepts valid outgoing entry with optional salesman omitted", () => {
  const res = validateGateOutgoingEntry({
    vehicleId: "veh-1",
    vehicleNumber: "TN 75 AA 1001",
    driverId: "drv-1",
    driverName: "Ramesh Kumar",
    salesmanName: "",
    logDate: "2026-11-26",
    outgoingTime: "06:15",
  });

  assert.equal(res.valid, true);
  assert.equal(res.parsed?.salesmanName, null);
  assert.equal(res.parsed?.outgoingAtIso, "2026-11-26T06:15:00+05:30");
  assert.equal(res.parsed?.incomingAtIso, null);
});

test("validateGateOutgoingEntry requires vehicle and driver name", () => {
  const missingVeh = validateGateOutgoingEntry({
    vehicleNumber: "   ",
    driverName: "Ramesh Kumar",
    logDate: "2026-11-26",
    outgoingTime: "06:15",
  });
  assert.equal(missingVeh.valid, false);
  assert.match(missingVeh.error || "", /vehicle/i);

  const missingDrv = validateGateOutgoingEntry({
    vehicleNumber: "TN 75 AA 1001",
    driverName: "",
    logDate: "2026-11-26",
    outgoingTime: "06:15",
  });
  assert.equal(missingDrv.valid, false);
  assert.match(missingDrv.error || "", /driver/i);
});

test("validateGateOutgoingEntry enforces incoming time >= outgoing time when provided together", () => {
  const invalid = validateGateOutgoingEntry({
    vehicleNumber: "TN 75 AA 1001",
    driverName: "Ramesh Kumar",
    salesmanName: "Suresh Babu",
    logDate: "2026-11-26",
    outgoingTime: "09:30",
    incomingDate: "2026-11-26",
    incomingTime: "08:45",
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.error || "", /earlier than outgoing/i);

  const valid = validateGateOutgoingEntry({
    vehicleNumber: "TN 75 AA 1001",
    driverName: "Ramesh Kumar",
    salesmanName: "Suresh Babu",
    logDate: "2026-11-26",
    outgoingTime: "06:00",
    incomingDate: "2026-11-26",
    incomingTime: "11:45",
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.parsed?.salesmanName, "Suresh Babu");
  assert.equal(valid.parsed?.incomingAtIso, "2026-11-26T11:45:00+05:30");
});

test("validateGateIncomingEntry validates return timestamp against outgoing time", () => {
  const early = validateGateIncomingEntry({
    logId: "gate-1",
    outgoingAtIso: "2026-11-26T07:00:00+05:30",
    incomingDate: "2026-11-26",
    incomingTime: "06:30",
  });
  assert.equal(early.valid, false);
  assert.match(early.error || "", /earlier/i);

  const ok = validateGateIncomingEntry({
    logId: "gate-1",
    outgoingAtIso: "2026-11-26T07:00:00+05:30",
    incomingDate: "2026-11-26",
    incomingTime: "10:25",
    salesmanName: "Arun",
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.parsed?.incomingAtIso, "2026-11-26T10:25:00+05:30");
  assert.equal(ok.parsed?.salesmanName, "Arun");
});

test("computeDurationMinutes and formatGateDuration format durations accurately", () => {
  const mins = computeDurationMinutes(
    "2026-11-26T05:30:00+05:30",
    "2026-11-26T08:15:00+05:30"
  );
  assert.equal(mins, 165);
  assert.equal(formatGateDuration(mins), "2h 45m");
  assert.equal(formatGateDuration(35), "35m");
  assert.equal(formatGateDuration(null), "Out (Open)");
});

test("submitGateOutgoingEntry and submitGateIncomingEntry invoke Supabase RPCs with clean arguments", async () => {
  const calls = [];
  const mockSupabase = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return {
        data: { id: "log-123", vehicle_number: args.p_vehicle_number || "TN 75 AA 1001" },
        error: null,
      };
    },
  };

  const outRes = await submitGateOutgoingEntry(mockSupabase, {
    vehicleId: "v-1",
    vehicleNumber: "TN 75 AA 1001",
    driverId: "d-1",
    driverName: "Karthik",
    salesmanName: null,
    logDate: "2026-11-26",
    outgoingTime: "05:45",
  });
  assert.equal(outRes.ok, true);
  assert.equal(calls[0].fn, "gatekeeper_record_vehicle_out");
  assert.equal(calls[0].args.p_salesman_name, null);
  assert.equal(calls[0].args.p_outgoing_at, "2026-11-26T05:45:00+05:30");

  const inRes = await submitGateIncomingEntry(mockSupabase, {
    logId: "log-123",
    outgoingAtIso: "2026-11-26T05:45:00+05:30",
    incomingDate: "2026-11-26",
    incomingTime: "09:15",
    salesmanName: "Mani",
  });
  assert.equal(inRes.ok, true);
  assert.equal(calls[1].fn, "gatekeeper_record_vehicle_in");
  assert.equal(calls[1].args.p_log_id, "log-123");
  assert.equal(calls[1].args.p_incoming_at, "2026-11-26T09:15:00+05:30");
  assert.equal(calls[1].args.p_salesman_name, "Mani");
});

test("buildGatekeeperReportRows, computeGatekeeperReportKpis, and buildGatekeeperReportCsv produce real backend data only", () => {
  const bounds = resolveReportDateBounds("custom", "2026-11-26", "2026-11-26");

  // Empty backend returns empty array (zero fake/mock rows)
  const emptyRows = buildGatekeeperReportRows([], bounds);
  assert.equal(emptyRows.length, 0);
  const emptyKpis = computeGatekeeperReportKpis(emptyRows);
  assert.equal(emptyKpis.totalEntries, 0);
  assert.equal(emptyKpis.currentlyOut, 0);
  assert.equal(emptyKpis.returnedCount, 0);
  assert.equal(emptyKpis.avgDurationMins, null);
  assert.equal(buildGatekeeperReportCsv(emptyRows), "");

  const rawLogs = [
    {
      id: "g-1",
      vehicle_id: "v-1",
      vehicle_number: "TN 75 AA 1001",
      driver_id: "d-1",
      driver_name: "Ramesh Kumar",
      salesman_name: "Suresh",
      log_date: "2026-11-26",
      outgoing_at: "2026-11-26T05:30:00+05:30",
      outgoing_time: "05:30",
      incoming_at: "2026-11-26T08:00:00+05:30",
      incoming_time: "08:00",
      status: "Returned",
      gatekeeper_name: "Murugan Gate",
      notes: "Morning dispatch",
    },
    {
      id: "g-2",
      vehicle_id: "v-2",
      vehicle_number: "TN 75 BB 2002",
      driver_id: "d-2",
      driver_name: "Vijay",
      salesman_name: null,
      log_date: "2026-11-26",
      outgoing_at: "2026-11-26T07:15:00+05:30",
      outgoing_time: "07:15",
      incoming_at: null,
      incoming_time: null,
      status: "Out",
      gatekeeper_name: "Murugan Gate",
      notes: null,
    },
    {
      id: "g-old",
      vehicle_id: "v-1",
      vehicle_number: "TN 75 AA 1001",
      driver_id: "d-1",
      driver_name: "Ramesh Kumar",
      salesman_name: null,
      log_date: "2026-11-20",
      outgoing_at: "2026-11-20T06:00:00+05:30",
      outgoing_time: "06:00",
      incoming_at: "2026-11-20T09:00:00+05:30",
      incoming_time: "09:00",
      status: "Returned",
      gatekeeper_name: "Murugan Gate",
    },
  ];

  const rows = buildGatekeeperReportRows(rawLogs, bounds);
  assert.equal(rows.length, 2);
  // Sorted descending by outgoingAtMs -> g-2 first, g-1 second
  assert.equal(rows[0].id, "g-2");
  assert.equal(rows[0].salesmanName, "-");
  assert.equal(rows[0].status, "Out");
  assert.equal(rows[0].durationDisplay, "Still Out");

  assert.equal(rows[1].id, "g-1");
  assert.equal(rows[1].salesmanName, "Suresh");
  assert.equal(rows[1].status, "Returned");
  assert.equal(rows[1].durationMins, 150);
  assert.equal(rows[1].durationDisplay, "2h 30m");

  const kpis = computeGatekeeperReportKpis(rows);
  assert.equal(kpis.totalEntries, 2);
  assert.equal(kpis.currentlyOut, 1);
  assert.equal(kpis.returnedCount, 1);
  assert.equal(kpis.avgDurationMins, 150);
  assert.equal(kpis.uniqueVehicles, 2);
  assert.equal(kpis.uniqueDrivers, 2);

  // Filter by status Out
  const outOnly = buildGatekeeperReportRows(rawLogs, bounds, { statusFilter: "Out" });
  assert.equal(outOnly.length, 1);
  assert.equal(outOnly[0].vehicleNumber, "TN 75 BB 2002");

  // Filter by driver name
  const driverFiltered = buildGatekeeperReportRows(rawLogs, bounds, { driverName: "Ramesh Kumar" });
  assert.equal(driverFiltered.length, 1);
  assert.equal(driverFiltered[0].vehicleNumber, "TN 75 AA 1001");

  const csv = buildGatekeeperReportCsv(rows);
  assert.match(csv, /^Date,Vehicle No,Driver Name,Salesman Name/);
  assert.match(csv, /TN 75 AA 1001/);
  assert.match(csv, /Suresh/);
});
