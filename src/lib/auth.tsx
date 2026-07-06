import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Role = "admin" | "manager" | "driver";

export interface AuthUser {
  email: string;
  name: string;
  role: Role;
}

const ACCOUNTS: Record<string, { password: string; user: AuthUser }> = {
  "admin@nanjilmilk.com": {
    password: "admin123",
    user: { email: "admin@nanjilmilk.com", name: "Person 1", role: "admin" },
  },
  "manager@nanjilmilk.com": {
    password: "manager123",
    user: { email: "manager@nanjilmilk.com", name: "Person 2", role: "manager" },
  },
  "driver@nanjilmilk.com": {
    password: "driver123",
    user: { email: "driver@nanjilmilk.com", name: "Person 3", role: "driver" },
  },
};

interface AuthCtx {
  user: AuthUser | null;
  login: (email: string, password: string) => { ok: boolean; error?: string; role?: Role };
  loginAs: (role: Role) => Role;
  logout: () => void;
  ready: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);
const STORAGE_KEY = "nanjil_auth_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {}
    setReady(true);
  }, []);

  const login: AuthCtx["login"] = (email, password) => {
    const acc = ACCOUNTS[email.toLowerCase().trim()];
    if (!acc) return { ok: false, error: "No account with that email" };
    if (acc.password !== password) return { ok: false, error: "Incorrect password" };
    setUser(acc.user);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(acc.user));
    return { ok: true, role: acc.user.role };
  };

  const loginAs: AuthCtx["loginAs"] = (role) => {
    const email =
      role === "admin" ? "admin@nanjilmilk.com" :
      role === "manager" ? "manager@nanjilmilk.com" : "driver@nanjilmilk.com";
    const acc = ACCOUNTS[email];
    setUser(acc.user);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(acc.user));
    return acc.user.role;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  return <Ctx.Provider value={{ user, login, loginAs, logout, ready }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
