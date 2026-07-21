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
        setUser(null);
      }
      setReady(true);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    try {
      const u = await fetchProfile(data.user!.id, data.user!.email!, data.user!.user_metadata);
      setUser(u);
      return { ok: true, role: u.role };
    } catch (e: any) {
      await supabase.auth.signOut();
      return { ok: false, error: e.message };
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <Ctx.Provider value={{ user, login, logout, ready }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
