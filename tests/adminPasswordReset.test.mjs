import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeProfileRole,
  validateAdminPasswordReset,
  executeAdminPasswordReset,
} from "../src/lib/adminUserManagement.ts";

test("1. normalizeProfileRole maps display labels to valid DB role keys", () => {
  assert.equal(normalizeProfileRole("Administrator"), "admin");
  assert.equal(normalizeProfileRole("admin"), "admin");
  assert.equal(normalizeProfileRole("Fleet Manager"), "manager");
  assert.equal(normalizeProfileRole("Driver"), "driver");
  assert.equal(normalizeProfileRole("Operations"), "operations");
});

test("2. validateAdminPasswordReset enforces admin role, 8-char min, and matching confirmation", () => {
  assert.equal(validateAdminPasswordReset("Pass1234", "Pass1234", "manager").valid, false);
  assert.equal(validateAdminPasswordReset("short", "short", "admin").valid, false);
  assert.equal(validateAdminPasswordReset("Password1", "Password2", "admin").valid, false);
  assert.equal(validateAdminPasswordReset("NewPass123", "NewPass123", "admin").valid, true);
});

test("3. executeAdminPasswordReset resets password in-place without deleting existing user on RPC failure", async () => {
  const rpcCalls = [];
  let signUpCalled = false;

  const mockSupabase = {
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      return { data: true, error: null };
    },
    from: (table) => ({
      upsert: async () => ({ error: null }),
      select: () => ({
        eq: async () => ({ data: [], error: null }),
      }),
      update: () => ({
        eq: async () => ({ error: null }),
      }),
    }),
  };

  const mockTempAuth = {
    auth: {
      signUp: async () => {
        signUpCalled = true;
        return { data: { user: { id: "new-id" } }, error: null };
      },
    },
  };

  const res = await executeAdminPasswordReset(
    mockSupabase,
    mockTempAuth,
    {
      id: "u-mgr-1",
      name: "Ravi",
      email: "ravi@nanjilmilk.com",
      role: "Fleet Manager",
      status: "Active",
    },
    "ResetPass99"
  );

  assert.equal(res.ok, true);
  assert.equal(signUpCalled, false, "Existing auth account must not be re-created");
  assert.equal(rpcCalls[0].fn, "admin_reset_user_password");
  assert.equal(rpcCalls[0].args.user_id, "u-mgr-1");
  assert.equal(rpcCalls[0].args.new_password, "ResetPass99");

  // If RPC errors (e.g. non-admin or SQL error), surface error cleanly without falling back to signUp/delete
  const failingSupabase = {
    ...mockSupabase,
    rpc: async () => ({ data: null, error: { message: "Only active administrators can reset user passwords." } }),
  };
  const failRes = await executeAdminPasswordReset(
    failingSupabase,
    mockTempAuth,
    {
      id: "u-mgr-1",
      name: "Ravi",
      email: "ravi@nanjilmilk.com",
      role: "Fleet Manager",
    },
    "ResetPass99"
  );
  assert.equal(failRes.ok, false);
  assert.equal(signUpCalled, false);
  assert.match(failRes.error || "", /administrators/i);
});

test("4. executeAdminPasswordReset recovers unlinked driver account via admin_reset_user_password_by_email", async () => {
  const rpcCalls = [];
  let linkedProfileId = null;

  const mockSupabase = {
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      if (fn === "admin_reset_user_password_by_email") {
        return { data: "auth-driver-uuid-1", error: null };
      }
      return { data: null, error: null };
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { id: "drv-1", profile_id: null }, error: null }),
          then: (cb) => Promise.resolve({ data: [], error: null }).then(cb),
        }),
        ilike: async () => ({ data: [], error: null }),
      }),
      upsert: async () => ({ error: null }),
      update: (vals) => ({
        eq: async () => {
          if (table === "drivers" && vals.profile_id) linkedProfileId = vals.profile_id;
          return { error: null };
        },
      }),
    }),
  };

  const mockTempAuth = {
    auth: {
      signUp: async () => {
        throw new Error("Should not call signUp when by_email reset succeeds");
      },
    },
  };

  const res = await executeAdminPasswordReset(
    mockSupabase,
    mockTempAuth,
    {
      id: "driver-drv-1",
      name: "Abhraham",
      email: "abhraham@nanjilmilk.com",
      role: "Driver",
    },
    "DriverPass123"
  );

  assert.equal(res.ok, true);
  assert.equal(res.userId, "auth-driver-uuid-1");
  assert.equal(linkedProfileId, "auth-driver-uuid-1");
  assert.equal(rpcCalls[0].fn, "admin_reset_user_password_by_email");
});
