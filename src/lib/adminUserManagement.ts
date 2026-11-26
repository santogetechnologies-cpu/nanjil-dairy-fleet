/**
 * adminUserManagement.ts — Admin User Password Reset & Role Normalization Engine
 */

export type CanonicalProfileRole =
  | "admin"
  | "manager"
  | "driver"
  | "gatekeeper"
  | "operations";

export function normalizeProfileRole(roleLabel?: string | null): CanonicalProfileRole {
  const clean = (roleLabel || "").trim().toLowerCase();
  if (clean === "admin" || clean === "administrator") return "admin";
  if (clean === "manager" || clean === "fleet manager") return "manager";
  if (clean === "gatekeeper" || clean === "gate keeper") return "gatekeeper";
  if (clean === "operations" || clean === "operation") return "operations";
  return "driver";
}

export function validateAdminPasswordReset(
  newPassword: string,
  confirmPassword: string,
  callerRole?: string | null
): { valid: boolean; error?: string } {
  if (callerRole && callerRole !== "admin") {
    return { valid: false, error: "Only administrators can reset user passwords." };
  }
  if (!newPassword || newPassword.length < 8) {
    return { valid: false, error: "Password must be at least 8 characters." };
  }
  if (newPassword !== confirmPassword) {
    return { valid: false, error: "Passwords do not match." };
  }
  return { valid: true };
}

export interface TargetResetUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status?: string;
}

export async function executeAdminPasswordReset(
  supabaseClient: any,
  tempAuthClient: any,
  targetUser: TargetResetUser,
  newPassword: string
): Promise<{ ok: boolean; userId?: string; email: string; error?: string }> {
  const cleanEmail = targetUser.email.includes("@")
    ? targetUser.email.toLowerCase().trim()
    : `${targetUser.name.toLowerCase().replace(/[^a-z0-9]/g, "")}@nanjilmilk.com`;

  let targetAuthId: string | null = null;
  let driverDbId: string | null = null;

  if (targetUser.id.startsWith("driver-")) {
    driverDbId = targetUser.id.replace("driver-", "");
    const { data: drv } = await supabaseClient
      .from("drivers")
      .select("id, profile_id")
      .eq("id", driverDbId)
      .maybeSingle();
    targetAuthId = drv?.profile_id || null;
  } else {
    targetAuthId = targetUser.id;
  }

  if (!targetAuthId) {
    const { data: profsByEmail } = await supabaseClient
      .from("profiles")
      .select("id")
      .ilike("email", cleanEmail);
    if (profsByEmail && profsByEmail.length > 0) {
      targetAuthId = profsByEmail[0].id;
    }
  }

  if (!targetAuthId) {
    const { data: profsByName } = await supabaseClient
      .from("profiles")
      .select("id")
      .ilike("name", targetUser.name.trim());
    if (profsByName && profsByName.length > 0) {
      targetAuthId = profsByName[0].id;
    }
  }

  let resetSuccess = false;

  // 1. In-place reset via admin_reset_user_password RPC when auth UUID exists
  if (targetAuthId) {
    const { error: resetErr } = await supabaseClient.rpc("admin_reset_user_password", {
      user_id: targetAuthId,
      new_password: newPassword,
    });
    if (resetErr) {
      const msg = resetErr.message || "Failed to reset password.";
      if (!msg.includes("Auth account not found")) {
        return { ok: false, email: cleanEmail, error: msg };
      }
      // UUID wasn't in auth.users — allow by-email recovery next
      targetAuthId = null;
    } else {
      resetSuccess = true;
    }
  }

  // 2. Recover unlinked auth.users record by email before provisioning a new account
  if (!resetSuccess) {
    const { data: emailResetId, error: byEmailErr } = await supabaseClient.rpc(
      "admin_reset_user_password_by_email",
      {
        target_email: cleanEmail,
        new_password: newPassword,
      }
    );

    if (!byEmailErr && emailResetId) {
      targetAuthId = String(emailResetId);
      resetSuccess = true;
    } else if (byEmailErr) {
      const msg = byEmailErr.message || "";
      const isMissingAccountOrRpc =
        msg.includes("No auth account found") ||
        msg.includes("Could not find the function") ||
        msg.includes("PGRST202");

      if (!isMissingAccountOrRpc) {
        return { ok: false, email: cleanEmail, error: msg };
      }
    }
  }

  // 3. Only if the user genuinely has no auth.users account yet, provision one
  if (!resetSuccess) {
    const roleName = normalizeProfileRole(targetUser.role);
    const { data: signUpRes, error: signUpErr } = await tempAuthClient.auth.signUp({
      email: cleanEmail,
      password: newPassword,
      options: { data: { name: targetUser.name, role: roleName } },
    });

    if (signUpErr) {
      return {
        ok: false,
        email: cleanEmail,
        error:
          signUpErr.message ||
          "Failed to reset password. Ensure migration 20261126140000_fix_admin_reset_password_rpc.sql is applied.",
      };
    }
    if (signUpRes?.user?.id) {
      targetAuthId = signUpRes.user.id;
      resetSuccess = true;
    }
  }

  if (!resetSuccess || !targetAuthId) {
    return {
      ok: false,
      email: cleanEmail,
      error: "Unable to reset password for this user.",
    };
  }

  // 4. Sync profiles & drivers.profile_id with canonical role key
  const canonicalRole = normalizeProfileRole(targetUser.role);
  await supabaseClient.from("profiles").upsert(
    {
      id: targetAuthId,
      name: targetUser.name,
      email: cleanEmail,
      role: canonicalRole,
      status: targetUser.status || "Active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  const { data: drvWithProfile } = await supabaseClient
    .from("drivers")
    .select("id")
    .eq("profile_id", targetAuthId);

  if (drvWithProfile && drvWithProfile.length > 0) {
    await supabaseClient
      .from("drivers")
      .update({ name: targetUser.name })
      .eq("id", drvWithProfile[0].id);
  } else if (driverDbId) {
    const { error: updErr } = await supabaseClient
      .from("drivers")
      .update({ profile_id: targetAuthId })
      .eq("id", driverDbId);
    if (updErr && updErr.code === "23505") {
      await supabaseClient
        .from("drivers")
        .update({ name: targetUser.name })
        .eq("profile_id", targetAuthId);
    }
  }

  return { ok: true, userId: targetAuthId, email: cleanEmail };
}
