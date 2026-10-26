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
      const validRoles: Role[] = ["admin", "manager", "driver"];
      const metaRole = rawRole === "operations" ? "manager" : validRoles.includes(rawRole) ? rawRole : "driver";

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
    // Purge any legacy insecure localStorage sessions
    localStorage.removeItem("nanjil_user_session");
    localStorage.removeItem("nanjil_driver_session");

    // Supabase Auth session is the sole authority
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        try {
          const u = await fetchProfile(session.user.id, session.user.email!, session.user.user_metadata);
          setUser(u);
        } catch (e) {
          console.error("[Auth Event] Profile fetch error:", e);
          setUser(null);
        }
      } else {
        setUser(null);
      }
      setReady(true);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const login = async (identifier: string, password: string) => {
    // Purge any legacy keys
    localStorage.removeItem("nanjil_driver_session");
    localStorage.removeItem("nanjil_user_session");

    if (!identifier || !identifier.trim()) {
      return { ok: false, error: "Please enter your email, username, or phone number." };
    }
    if (!password) {
      return { ok: false, error: "Please enter your password." };
    }

    const cleanInput = identifier.toLowerCase().trim();
    let targetEmail = cleanInput;

    // If identifier is not an email, resolve it to the registered user's email
    if (!cleanInput.includes("@")) {
      const digitsOnly = cleanInput.replace(/[^0-9]/g, "");
      let foundEmail: string | null = null;

      // 1. Check profiles by name
      const { data: prof } = await supabase
        .from("profiles")
        .select("email, status")
        .ilike("name", cleanInput)
        .maybeSingle();

      if (prof?.email) {
        if (prof.status === "Inactive") {
          return { ok: false, error: "Your account has been deactivated. Please contact an administrator." };
        }
        foundEmail = prof.email;
      }

      // 2. Check drivers by phone or name
      if (!foundEmail) {
        const { data: drivers } = await supabase.from("drivers").select("name, phone, profile_id");
        if (drivers) {
          const matched = drivers.find((d: any) => {
            if (digitsOnly.length >= 4 && d.phone) {
              const dDigits = d.phone.replace(/[^0-9]/g, "");
              if (dDigits === digitsOnly || dDigits.endsWith(digitsOnly) || digitsOnly.endsWith(dDigits)) return true;
            }
            if (d.name && d.name.toLowerCase().trim() === cleanInput) return true;
            return false;
          });

          if (matched?.profile_id) {
            const { data: driverProf } = await supabase
              .from("profiles")
              .select("email, status")
              .eq("id", matched.profile_id)
              .maybeSingle();
            if (driverProf?.email) {
              if (driverProf.status === "Inactive") {
                return { ok: false, error: "Your account has been deactivated. Please contact an administrator." };
              }
              foundEmail = driverProf.email;
            }
          }
        }
      }

      if (!foundEmail) {
        return { ok: false, error: "Invalid login credentials." };
      }
      targetEmail = foundEmail;
    }

    // Authenticate strictly with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email: targetEmail,
      password,
    });

    if (error || !data?.user) {
      // STOP immediately. Never query fallbacks or create manual sessions.
      return { ok: false, error: error?.message || "Invalid email or password." };
    }

    try {
      const u = await fetchProfile(data.user.id, data.user.email!, data.user.user_metadata);
      setUser(u);
      return { ok: true, role: u.role };
    } catch (e: any) {
      await supabase.auth.signOut();
      return { ok: false, error: e.message };
    }
  };

  const loginWithPhone = async (phoneInput: string, password?: string) => {
    if (!password) {
      return { ok: false, error: "Password is required." };
    }
    return login(phoneInput, password);
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
