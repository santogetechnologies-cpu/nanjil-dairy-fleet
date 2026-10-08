import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Logo } from "./Logo";
import {
  LayoutDashboard, MapPin, Truck, Route as RouteIcon, Fuel,
  ShieldCheck, Cog, Bell, Wrench, Sparkles,
  Users, Settings, LogOut, Search, Menu, X, ChevronDown, UserCircle2,
  ChevronRight, LayoutGrid,
} from "lucide-react";
import { useState, useEffect, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/tracking", label: "Live Tracking", icon: MapPin },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/vehicles", label: "Vehicles", icon: Truck },
      { to: "/vehicles-management", label: "Vehicles Management", icon: LayoutGrid },
      { to: "/trips", label: "Trips & Routes", icon: RouteIcon },
      { to: "/fuel", label: "Fuel Intelligence", icon: Fuel },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { to: "/safety", label: "Driver Management", icon: ShieldCheck },
      { to: "/engine", label: "Vehicle Activity", icon: Cog },
      { to: "/alerts", label: "Alerts Center", icon: Bell },
    ],
  },
  {
    label: "Management",
    items: [
      { to: "/maintenance", label: "Maintenance", icon: Wrench },
      { to: "/ai", label: "AI Intelligence", icon: Sparkles },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/users", label: "Users", icon: Users },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
    adminOnly: true,
  },
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
      try {
        const { data, error } = await supabase
          .from('alerts')
          .select('id')
          .eq('resolved', false);
        if (cancelled) return;
        if (error) {
          console.warn("Alerts fetch warning:", error.message);
          return;
        }
        if (data) setUnread(data.length);
      } catch (err) {
        // Silently catch network or authorization errors
      }
    }

    async function init() {
      getUnread();
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

  const isManager = user?.role === "manager";

  const visibleGroups = NAV_GROUPS
    .filter((g) => !g.adminOnly || !isManager)
    .map((g) => ({
      ...g,
      items: g.items.filter((item) =>
        isManager ? !(["/users", "/settings"].includes(item.to)) : true
      ),
    }))
    .filter((g) => g.items.length > 0);

  const avatarLetters = user?.name.split(" ").map((s) => s[0]).slice(0, 2).join("") ?? "?";

  return (
    <div className="min-h-screen bg-background flex">

      {/* ── SIDEBAR ─────────────────────────────────────────────── */}
      <aside
        className={`fixed lg:sticky top-0 left-0 h-screen w-60 z-40 transition-transform duration-300 flex flex-col ${
          open ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0`}
        style={{
          background: "linear-gradient(175deg, oklch(0.16 0.07 258) 0%, oklch(0.13 0.05 258) 100%)",
          borderRight: "1px solid oklch(0.22 0.08 258)",
        }}
      >
        {/* Logo area */}
        <div className="px-4 pt-5 pb-4 flex items-center gap-3 shrink-0">
          <div
            className="rounded-xl p-2 shrink-0"
            style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.12)" }}
          >
            <Logo className="h-7 w-7 object-contain" />
          </div>
          <div className="leading-tight min-w-0">
            <div className="text-white font-bold text-sm tracking-tight truncate">Nanjil VIP</div>
            <div className="text-white/45 text-[10px] font-medium tracking-wide truncate">Fleet Intelligence</div>
          </div>
          <button
            className="ml-auto lg:hidden p-1 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-colors min-h-0 min-w-0"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Divider */}
        <div className="mx-4 h-px" style={{ background: "rgba(255,255,255,0.07)" }} />

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-4">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <div className="px-2 mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.18em] text-white/25 select-none">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    loc.pathname === item.to ||
                    (item.to !== "/dashboard" && loc.pathname.startsWith(item.to));
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setOpen(false)}
                      className={`sidebar-item sidebar-item-hover ${active ? "sidebar-item-active" : ""}`}
                    >
                      <Icon
                        className="h-4 w-4 shrink-0"
                        style={{ color: active ? "white" : "oklch(0.68 0.05 240)" }}
                      />
                      <span className="truncate">{item.label}</span>
                      {active && <ChevronRight className="h-3 w-3 ml-auto shrink-0 opacity-60" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom user strip */}
        <div className="shrink-0 px-3 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-2.5 rounded-xl px-2 py-2" style={{ background: "rgba(255,255,255,0.04)" }}>
            <div
              className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ background: "linear-gradient(135deg, oklch(0.48 0.22 264), oklch(0.38 0.18 255))" }}
            >
              {avatarLetters}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white/85 text-xs font-semibold truncate">{user?.name}</div>
              <div className="text-white/35 text-[10px] capitalize">{user?.role} · v1.4.2</div>
            </div>
            <button
              onClick={() => { logout(); nav("/login"); }}
              className="p-1.5 rounded-lg text-white/35 hover:text-white hover:bg-white/10 transition-colors min-h-0 min-w-0"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── MAIN CONTENT ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <header className="h-14 sticky top-0 z-30 flex items-center px-4 gap-3"
          style={{
            background: "rgba(247,248,252,0.88)",
            backdropFilter: "blur(16px) saturate(180%)",
            WebkitBackdropFilter: "blur(16px) saturate(180%)",
            borderBottom: "1px solid oklch(0.90 0.012 240)",
            boxShadow: "0 1px 3px rgba(10,20,60,0.05)",
          }}
        >
          {/* Mobile menu toggle */}
          <button
            className="lg:hidden p-2 rounded-lg hover:bg-muted/60 text-foreground/70 hover:text-foreground transition-colors"
            onClick={() => setOpen((v) => !v)}
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Search bar */}
          <div
            className="hidden md:flex items-center gap-2 px-3 h-9 flex-1 max-w-sm rounded-xl transition-all"
            style={{
              background: "oklch(0.955 0.010 240)",
              border: "1px solid oklch(0.90 0.012 240)",
            }}
          >
            <Search className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
            <input
              placeholder="Search vehicles, drivers, routes…"
              className="bg-transparent outline-none text-sm w-full text-foreground placeholder:text-muted-foreground/50"
              style={{ fontSize: "13px" }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = (e.target as HTMLInputElement).value.trim();
                  if (v) nav(`/vehicles?q=${encodeURIComponent(v)}`);
                }
              }}
            />
          </div>

          <div className="flex-1" />

          {/* Alerts bell */}
          <Link
            to="/alerts"
            className="relative p-2 rounded-xl hover:bg-muted/60 text-foreground/70 hover:text-foreground transition-colors"
            aria-label="Alerts"
          >
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 h-4.5 min-w-4.5 px-1 rounded-full text-white text-[9px] font-bold flex items-center justify-center"
                style={{
                  background: "oklch(0.58 0.24 25)",
                  boxShadow: "0 0 0 2px oklch(0.975 0.006 240)",
                  minWidth: "18px",
                  height: "18px",
                }}
              >
                {unread}
              </span>
            )}
          </Link>

          {/* Profile dropdown */}
          <div className="relative">
            <button
              onClick={() => setProfileOpen((v) => !v)}
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-muted/60 transition-colors"
            >
              <div
                className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                style={{ background: "linear-gradient(135deg, oklch(0.48 0.22 264), oklch(0.38 0.18 255))" }}
              >
                {avatarLetters}
              </div>
              <div className="hidden sm:block text-left leading-tight">
                <div className="text-sm font-semibold text-foreground">{user?.name}</div>
                <div className="text-[10px] text-muted-foreground capitalize">{user?.role}</div>
              </div>
              <ChevronDown className={`h-3.5 w-3.5 hidden sm:block text-muted-foreground transition-transform ${profileOpen ? "rotate-180" : ""}`} />
            </button>

            {profileOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
                <div
                  className="absolute right-0 top-full mt-2 w-60 z-50 rounded-2xl overflow-hidden"
                  style={{
                    background: "white",
                    border: "1px solid oklch(0.90 0.012 240)",
                    boxShadow: "0 20px 40px -12px rgba(10,20,60,0.18), 0 4px 8px -4px rgba(10,20,60,0.08)",
                  }}
                >
                  {/* Profile header */}
                  <div className="px-4 py-3.5" style={{ borderBottom: "1px solid oklch(0.93 0.010 240)" }}>
                    <div className="flex items-center gap-3">
                      <div
                        className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-sm font-bold text-white"
                        style={{ background: "linear-gradient(135deg, oklch(0.48 0.22 264), oklch(0.38 0.18 255))" }}
                      >
                        {avatarLetters}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">{user?.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
                      </div>
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="p-1.5">
                    <Link
                      to="/settings"
                      className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-muted/60 text-sm text-foreground transition-colors"
                      onClick={() => setProfileOpen(false)}
                    >
                      <UserCircle2 className="h-4 w-4 text-muted-foreground" />
                      Profile & Settings
                    </Link>
                    <button
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-destructive/8 text-sm text-destructive transition-colors"
                      onClick={() => { setProfileOpen(false); logout(); nav("/login"); }}
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 md:p-6 max-w-[1600px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title, subtitle, actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {subtitle && <div className="text-sm text-muted-foreground mt-0.5">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
