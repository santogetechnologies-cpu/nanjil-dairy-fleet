import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, initializeDatabase } from "./supabase";

export type Role = "admin" | "manager" | "driver";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

interface AuthCtx {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string; role?: Role }>;
  loginAs: (role: Role) => Promise<Role>;
  logout: () => Promise<void>;
  ready: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  // Helper to fetch user profile role/name
  const fetchProfile = async (id: string, email: string): Promise<AuthUser> => {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("name, role")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("Error fetching user profile:", error);
    }

    return {
      id,
      email,
      name: profile?.name || email.split("@")[0],
      role: (profile?.role as Role) || "driver",
    };
  };

  useEffect(() => {
    // Run self-healing db init / seeding
    initializeDatabase();

    // Fetch initial auth session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const u = await fetchProfile(session.user.id, session.user.email!);
        setUser(u);
        initializeDatabase();
      } else {
        setUser(null);
      }
      setReady(true);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const u = await fetchProfile(session.user.id, session.user.email!);
        setUser(u);
        initializeDatabase();
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

    const u = await fetchProfile(data.user!.id, data.user!.email!);
    setUser(u);
    return { ok: true, role: u.role };
  };

  const loginAs = async (role: Role) => {
    const email = `${role}@nanjilmilk.com`;
    const password = `${role}123`;

    // Try signing in
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // If user does not exist in Auth, sign them up first for seamless demo experience
      const name = role === "admin" ? "Person 1" : role === "manager" ? "Person 2" : "Person 3";
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
            role,
          },
        },
      });

      if (signUpErr) {
        throw signUpErr;
      }

      // Automatically sign in
      const { data: retryData, error: retryErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (retryErr) throw retryErr;

      // In case trigger on_auth_user_created needs a brief moment, we create user profile if not present
      const userId = retryData.user!.id;
      const { data: checkProf } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
      if (!checkProf) {
        await supabase.from("profiles").insert({
          id: userId,
          name,
          email,
          role,
          status: "Active",
        });
      }

      const u = await fetchProfile(userId, email);
      setUser(u);
      return u.role;
    }

    const u = await fetchProfile(data.user!.id, data.user!.email!);
    setUser(u);
    return u.role;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <Ctx.Provider value={{ user, login, loginAs, logout, ready }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
