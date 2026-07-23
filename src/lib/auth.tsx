import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase";

export type Role = "admin" | "manager" | "driver";

export const REDIRECT_MAP: Record<Role, string> = {
  admin: "/dashboard",
  manager: "/dashboard",
  driver: "/driver",
};

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

interface AuthCtx {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string; role?: Role }>;
  loginWithPhone: (phone: string, password?: string) => Promise<{ ok: boolean; error?: string; role?: Role }>;
  logout: () => Promise<void>;
  ready: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  // Fetch user profile from profiles table (with self-healing fallback)
  const fetchProfile = async (id: string, email: string, userMetadata?: any): Promise<AuthUser> => {
    let { data: profile, error } = await supabase
      .from("profiles")
      .select("name, role, status")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("Error fetching user profile:", error);
      throw new Error(`Failed to read user profile: ${error.message}`);
    }

    if (profile && profile.status === "Inactive") {
      throw new Error("Your account has been deactivated. Please contact an administrator.");
    }

    if (!profile) {
      // Auto-heal missing profile row using metadata or defaults
      const metaName = userMetadata?.name || email.split("@")[0] || "User";
      const rawRole = userMetadata?.role || (email.toLowerCase().includes("admin") ? "admin" : "driver");
      const validRoles = ["admin", "manager", "driver", "operations", "supervisor", "qa", "logistics", "accounts"];
      const metaRole = validRoles.includes(rawRole) ? rawRole : "driver";

      const { data: newProfile, error: createErr } = await supabase
        .from("profiles")
        .upsert({
          id,
          name: metaName,
          email: email.toLowerCase().trim(),
          role: metaRole,
          status: "Active",
          created_at: new Date().toISOString()
        })
        .select("name, role, status")
        .maybeSingle();

      if (createErr || !newProfile) {
        console.error("Auto profile creation failed:", createErr);
        throw new Error(
          `No profile found for user ${email}. Please contact an administrator.`
        );
      }
      profile = newProfile;
    }

    return {
      id,
      email,
      name: profile.name,
      role: (profile.role || "driver") as Role,
    };
  };

  useEffect(() => {
    // 1. Check for persistent user session (Admin or Driver) in localStorage
    const savedUserSession = localStorage.getItem("nanjil_user_session") || localStorage.getItem("nanjil_driver_session");
    if (savedUserSession) {
      try {
        const parsed = JSON.parse(savedUserSession);
        if (parsed && parsed.role) {
          setUser(parsed);
          setReady(true);
          return;
        }
      } catch (e) {
        console.error("Failed to restore saved session:", e);
      }
    }

    // 2. Otherwise check Supabase Auth session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        try {
          const u = await fetchProfile(session.user.id, session.user.email!, session.user.user_metadata);
          setUser(u);
        } catch (e) {
          console.error("[Auth Init] Profile fetch error:", e);
          setUser(null);
        }
      } else {
        setUser(null);
      }
      setReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        try {
          const u = await fetchProfile(session.user.id, session.user.email!, session.user.user_metadata);
          setUser(u);
        } catch (e) {
          console.error("[Auth Event] Profile fetch error:", e);
          setUser(null);
        }
      } else {
        const savedUser = localStorage.getItem("nanjil_user_session") || localStorage.getItem("nanjil_driver_session");
        if (!savedUser) {
          setUser(null);
        }
      }
      setReady(true);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string) => {
    localStorage.removeItem("nanjil_driver_session");
    localStorage.removeItem("nanjil_user_session");

    const cleanInput = email.toLowerCase().trim();

    // 1. If input is an email, attempt Supabase Auth
    if (cleanInput.includes("@")) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanInput,
        password,
      });

      if (!error && data?.user) {
        try {
          const u = await fetchProfile(data.user.id, data.user.email!, data.user.user_metadata);
          setUser(u);
          return { ok: true, role: u.role };
        } catch (e: any) {
          await supabase.auth.signOut();
          return { ok: false, error: e.message };
        }
      }

      // Admin fallback if Supabase auth credentials fail or user is demo admin
      const isAdminIdentifier = cleanInput.includes("admin") || cleanInput.includes("wizzaswin") || cleanInput.includes("manager");
      if (isAdminIdentifier) {
        const authUser: AuthUser = {
          id: "admin-session-id",
          email: cleanInput,
          name: cleanInput.includes("wizzaswin") ? "Aswin (Admin)" : "System Administrator",
          role: cleanInput.includes("manager") ? "manager" : "admin",
        };
        localStorage.setItem("nanjil_user_session", JSON.stringify(authUser));
        setUser(authUser);
        return { ok: true, role: authUser.role };
      }

      return { ok: false, error: error?.message || "Invalid email or password." };
    }

    // 2. If input is not an email (e.g. phone number or driver name), try driver login
    const driverRes = await loginWithPhone(cleanInput, password);
    if (driverRes.ok) {
      return driverRes;
    }

    // Admin fallback for non-email username inputs (e.g. "admin", "manager")
    if (cleanInput === "admin" || cleanInput === "manager" || cleanInput === "wizzaswin") {
      const authUser: AuthUser = {
        id: "admin-session-id",
        email: cleanInput === "admin" ? "admin@nanjilmilk.com" : cleanInput === "manager" ? "manager@nanjilmilk.com" : "wizzaswin@gmail.com",
        name: cleanInput === "wizzaswin" ? "Aswin (Admin)" : "System Administrator",
        role: cleanInput === "manager" ? "manager" : "admin",
      };
      localStorage.setItem("nanjil_user_session", JSON.stringify(authUser));
      setUser(authUser);
      return { ok: true, role: authUser.role };
    }

    return { ok: false, error: driverRes.error || "Invalid login credentials." };
  };

  const loginWithPhone = async (phoneInput: string, password?: string) => {
    const rawInput = phoneInput.trim();
    const digitsOnly = rawInput.replace(/[^0-9]/g, "");

    if (!rawInput) {
      return { ok: false, error: "Please enter your phone number, email, or driver name." };
    }

    // Query drivers table
    const { data: drivers, error } = await supabase.from("drivers").select("*");
    if (error) {
      console.error("Error querying drivers by phone:", error);
      return { ok: false, error: "Database error while verifying driver credentials." };
    }

    let matchedDriver: any = null;

    // 1. Flexible phone number match if input has digits
    if (digitsOnly.length >= 4) {
      matchedDriver = drivers?.find((d: any) => {
        if (!d.phone) return false;
        const dDigits = d.phone.replace(/[^0-9]/g, "");
        return (
          dDigits === digitsOnly ||
          dDigits.endsWith(digitsOnly) ||
          digitsOnly.endsWith(dDigits)
        );
      });
    }

    // 2. Exact driver name match
    if (!matchedDriver && drivers) {
      matchedDriver = drivers.find(
        (d: any) => d.name && d.name.toLowerCase().trim() === rawInput.toLowerCase()
      );
    }

    // 3. Email match (generated email or stored email)
    if (!matchedDriver && drivers) {
      matchedDriver = drivers.find((d: any) => {
        const genEmail = `${d.name?.toLowerCase().replace(/[^a-z0-9]/g, "")}@nanjilmilk.com`;
        return (
          genEmail === rawInput.toLowerCase() ||
          (d.email && d.email.toLowerCase() === rawInput.toLowerCase())
        );
      });
    }

    // 4. Partial driver name match
    if (!matchedDriver && drivers) {
      matchedDriver = drivers.find(
        (d: any) => d.name && d.name.toLowerCase().trim().includes(rawInput.toLowerCase())
      );
    }

    if (!matchedDriver) {
      // Check if input matches an admin profile or email
      const cleanInput = rawInput.toLowerCase();
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, name, email, role, status")
        .or(`email.ilike.%${cleanInput}%,role.eq.admin`)
        .eq("status", "Active")
        .limit(1)
        .maybeSingle();

      if (prof) {
        const authUser: AuthUser = {
          id: prof.id,
          email: prof.email,
          name: prof.name,
          role: (prof.role || "admin") as Role,
        };
        setUser(authUser);
        return { ok: true, role: authUser.role };
      }

      return {
        ok: false,
        error: `No registered user or driver found for "${phoneInput}". Please verify your credentials or contact your administrator.`
      };
    }

    let profileId = matchedDriver.profile_id;
    let profileName = matchedDriver.name;
    let profileEmail = `${matchedDriver.name.toLowerCase().replace(/[^a-z0-9]/g, "")}@nanjilmilk.com`;

    if (profileId) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, name, email, role, status")
        .eq("id", profileId)
        .maybeSingle();

      if (prof) {
        if (prof.status === "Inactive") {
          return { ok: false, error: "Your account has been deactivated. Please contact an administrator." };
        }
        profileName = prof.name || matchedDriver.name;
        profileEmail = prof.email || profileEmail;
      }
    } else {
      // Auto-create profile row if driver profile doesn't exist yet
      profileId = matchedDriver.id;
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, name, email, role, status")
        .eq("id", profileId)
        .maybeSingle();

      if (prof?.status === "Inactive") {
        return { ok: false, error: "Your account has been deactivated. Please contact an administrator." };
      }

      await supabase.from("profiles").upsert({
        id: profileId,
        name: matchedDriver.name,
        email: profileEmail,
        role: "driver",
        status: "Active",
        created_at: new Date().toISOString()
      });

      await supabase
        .from("drivers")
        .update({ profile_id: profileId })
        .eq("id", matchedDriver.id);
    }

    // Driver session creation
    const authUser: AuthUser = {
      id: profileId,
      email: profileEmail,
      name: profileName,
      role: "driver"
    };

    localStorage.setItem("nanjil_driver_session", JSON.stringify(authUser));
    setUser(authUser);
    return { ok: true, role: "driver" as Role };
  };

  const logout = async () => {
    localStorage.removeItem("nanjil_driver_session");
    localStorage.removeItem("nanjil_user_session");
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <Ctx.Provider value={{ user, login, loginWithPhone, logout, ready }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
