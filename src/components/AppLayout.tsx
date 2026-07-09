import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Logo } from "./Logo";
import {
  LayoutDashboard, MapPin, Truck, Route as RouteIcon, MilkOff, Fuel,
  ShieldCheck, Cog, Thermometer, Bell, Wrench, FileText, Sparkles,
  Users, Settings, LogOut, Search, Menu, X, ChevronDown, UserCircle2,
} from "lucide-react";
import { useState, useEffect, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/tracking", label: "Live Vehicle Tracking", icon: MapPin },
  { to: "/vehicles", label: "Vehicles", icon: Truck },
  { to: "/trips", label: "Trips & Routes", icon: RouteIcon },
  { to: "/collection-routes", label: "Dairy Collection Routes", icon: MilkOff },
  { to: "/fuel", label: "Fuel Intelligence", icon: Fuel },
  { to: "/safety", label: "Driver Safety", icon: ShieldCheck },
  { to: "/engine", label: "Engine & Ignition", icon: Cog },
  { to: "/cold-chain", label: "Cold Chain Monitoring", icon: Thermometer },
  { to: "/alerts", label: "Alerts Center", icon: Bell },
  { to: "/maintenance", label: "Maintenance", icon: Wrench },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/ai", label: "AI Intelligence", icon: Sparkles },
  { to: "/users", label: "Users", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function getUnread() {
      const { data } = await supabase
        .from('alerts')
        .select('id')
        .eq('resolved', false);
      if (cancelled) return;
      if (data) setUnread(data.length);
    }

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled || !session) return;

      getUnread();

      // Register handler BEFORE subscribe()
      channel = supabase
        .channel('alerts-badge')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => {
          if (!cancelled) getUnread();
        })
        .subscribe();
    }

    init();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // Driver gets simplified UI
  if (user?.role === "driver") {
    return <>{children}</>;
  }

  const filteredNav = user?.role === "manager"
    ? NAV.filter((n) => !["/users", "/settings"].includes(n.to))
    : NAV;

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 left-0 h-screen w-64 bg-sidebar text-sidebar-foreground z-40 transition-transform ${
          open ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0 flex flex-col`}
      >
        <div className="px-4 py-4 border-b border-sidebar-border flex items-center gap-3">
          <div className="bg-white rounded-md p-1.5">
            <Logo className="h-7" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold text-sm">Nanjil VIP</div>
            <div className="text-[11px] opacity-70">Vehicle Intelligence</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {filteredNav.map((item) => {
            const active = loc.pathname === item.to || (item.to !== "/dashboard" && loc.pathname.startsWith(item.to));
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  active ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "hover:bg-sidebar-accent/60"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="px-3 py-3 border-t border-sidebar-border text-xs opacity-70">
          v1.4.2 · {user?.role.toUpperCase()}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 sticky top-0 z-30 bg-card/90 backdrop-blur border-b border-border flex items-center px-4 gap-3">
          <button className="lg:hidden p-2 rounded hover:bg-muted" onClick={() => setOpen((v) => !v)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="hidden md:flex items-center gap-2 px-3 h-9 bg-muted rounded-md flex-1 max-w-md">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search vehicles, drivers, routes…"
              className="bg-transparent outline-none text-sm w-full"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = (e.target as HTMLInputElement).value.trim();
                  if (v) nav(`/vehicles?q=${encodeURIComponent(v)}`);
                }
              }}
            />
          </div>
          <div className="flex-1 md:hidden" />
          <Link to="/alerts" className="relative p-2 rounded hover:bg-muted" aria-label="Alerts">
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center">
                {unread}
              </span>
            )}
          </Link>
          <div className="relative">
            <button
              onClick={() => setProfileOpen((v) => !v)}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted"
            >
              <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">
                {user?.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
              </div>
              <div className="hidden sm:block text-left leading-tight">
                <div className="text-sm font-medium">{user?.name}</div>
                <div className="text-[11px] text-muted-foreground capitalize">{user?.role}</div>
              </div>
              <ChevronDown className="h-4 w-4 hidden sm:block" />
            </button>
            {profileOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-popover border border-border rounded-md shadow-lg py-1 z-50">
                <div className="px-3 py-2 border-b border-border">
                  <div className="text-sm font-medium">{user?.name}</div>
                  <div className="text-xs text-muted-foreground">{user?.email}</div>
                </div>
                <Link to="/settings" className="flex items-center gap-2 px-3 py-2 hover:bg-muted text-sm" onClick={() => setProfileOpen(false)}>
                  <UserCircle2 className="h-4 w-4" /> Profile & Settings
                </Link>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted text-sm text-destructive"
                  onClick={() => { logout(); nav("/login"); }}
                >
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6 max-w-[1600px] w-full mx-auto">
          {children}
        </main>
      </div>

      {open && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setOpen(false)} />}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
