import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Logo } from "./Logo";
import {
  LayoutDashboard,
  Radio,
  Route as RouteIcon,
  History,
  Gauge,
  Fuel,
  Truck,
  UsersRound,
  Bell,
  Wrench,
  FileBarChart2,
  Settings,
  LogOut,
  Search,
  Menu,
  X,
  ChevronDown,
  UserCircle2,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
  Plus,
  Command,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ShieldAlert,
  Sparkles,
  Clock,
  ArrowUpRight,
  Activity,
  Check,
  Compass,
  Layers,
  ShieldCheck,
  Calendar,
  Filter,
} from "lucide-react";
import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useVehicles, TELEMETRY_LABEL } from "@/hooks/useVehicleTracking";

interface NavItem {
  to: string;
  label: string;
  icon: any;
  badge?: number;
  shortcut?: string;
  description?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();

  // Live vehicles stream for real-time header pulse indicators
  const liveVehicles = useVehicles();

  // Sidebar expansion state
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("nanjil_sidebar_collapsed") === "true";
  });

  // Mobile drawer open state
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Popover menus state
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [quickActionOpen, setQuickActionOpen] = useState(false);
  const [moduleSwitcherOpen, setModuleSwitcherOpen] = useState(false);

  // Command Palette (Ctrl+K / Cmd+K)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState("");
  const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);

  // Real-time unread alerts
  const [unreadAlerts, setUnreadAlerts] = useState<any[]>([]);

  // Toggle sidebar collapse
  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("nanjil_sidebar_collapsed", String(next));
      return next;
    });
  }

  // Handle Ctrl+K / Cmd+K and keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setCommandPaletteOpen(false);
        setNotificationsOpen(false);
        setProfileOpen(false);
        setQuickActionOpen(false);
        setModuleSwitcherOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Fetch real-time alerts stream
  useEffect(() => {
    let cancelled = false;

    async function getUnread() {
      try {
        const { data, error } = await supabase
          .from("alerts")
          .select("id, type, severity, message, time, vehicle")
          .eq("resolved", false)
          .order("time", { ascending: false })
          .limit(6);

        if (cancelled) return;
        if (!error && data) setUnreadAlerts(data);
      } catch (err) {
        // Silently catch
      }
    }

    getUnread();

    const channel = supabase
      .channel("alerts-app-layout-stream")
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => {
        if (!cancelled) getUnread();
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  // Quick action: Resolve an alert directly from notification drawer
  async function resolveAlert(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    try {
      await supabase
        .from("alerts")
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq("id", id);
      setUnreadAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error("Failed to resolve alert", err);
    }
  }

  // Real-time Fleet Status Counts from GPS stream
  const fleetPulse = useMemo(() => {
    let moving = 0;
    let idle = 0;
    let stopped = 0;

    for (const v of liveVehicles) {
      const speed = Number(v.speed ?? 0);
      const isIgnition = Boolean(v.ignition ?? (speed > 3));

      if (speed > 3) {
        moving++;
      } else if (isIgnition) {
        idle++;
      } else {
        stopped++;
      }
    }

    return {
      total: liveVehicles.length,
      moving,
      idle,
      stopped,
    };
  }, [liveVehicles]);

  // Dedicated Driver View (standalone mobile-first interface)
  if (user?.role === "driver") {
    return <>{children}</>;
  }

  const NAV_SECTIONS: NavSection[] = [
    {
      title: "MONITORING",
      items: [
        {
          to: "/dashboard",
          label: "Overview",
          icon: LayoutDashboard,
          shortcut: "G D",
          description: "Executive fleet health & KPIs",
        },
        {
          to: "/tracking",
          label: "Live Tracking",
          icon: Radio,
          shortcut: "G T",
          description: "Real-time GPS telemetry & map",
        },
      ],
    },
    {
      title: "OPERATIONS",
      items: [
        {
          to: "/routes",
          label: "Route Planner",
          icon: RouteIcon,
          shortcut: "G R",
          description: "OSRM road routing & collection circuits",
        },
        {
          to: "/trips",
          label: "Trip History",
          icon: History,
          shortcut: "G H",
          description: "Historical GPS playback & stop audits",
        },
        {
          to: "/safety",
          label: "Speeding & Driving",
          icon: Gauge,
          shortcut: "G S",
          description: "60 km/h baseline audit & safety scores",
        },
        {
          to: "/fuel",
          label: "Fuel Intelligence",
          icon: Fuel,
          shortcut: "G F",
          description: "Tank-to-tank km/L & anomaly detection",
        },
      ],
    },
    {
      title: "FLEET ASSETS",
      items: [
        {
          to: "/vehicles",
          label: "Vehicles Directory",
          icon: Truck,
          shortcut: "G V",
          description: "Fleet inventory & hardware trackers",
        },
        {
          to: "/drivers",
          label: "Drivers Directory",
          icon: UsersRound,
          shortcut: "G U",
          description: "Driver roster & performance scores",
        },
      ],
    },
    {
      title: "AUDIT & COMPLIANCE",
      items: [
        {
          to: "/alerts",
          label: "Alerts & Incidents",
          icon: Bell,
          badge: unreadAlerts.length,
          shortcut: "G A",
          description: "Centralized operational incidents",
        },
        {
          to: "/maintenance",
          label: "Maintenance & FC",
          icon: Wrench,
          shortcut: "G M",
          description: "Fitness certificates, insurance & services",
        },
        {
          to: "/reports",
          label: "Reports & Analytics",
          icon: FileBarChart2,
          shortcut: "G P",
          description: "Audited summaries, PDF & CSV export",
        },
      ],
    },
    {
      title: "ADMINISTRATION",
      items: [
        {
          to: "/settings",
          label: "System Settings",
          icon: Settings,
          shortcut: "G ,",
          description: "Operational thresholds & user access",
        },
      ],
    },
  ];

  // Dynamic Current Navigation Context
  const currentNav = useMemo(() => {
    for (const sec of NAV_SECTIONS) {
      for (const item of sec.items) {
        if (loc.pathname === item.to || (item.to !== "/dashboard" && loc.pathname.startsWith(item.to))) {
          return { section: sec.title, item };
        }
      }
    }
    return {
      section: "MONITORING",
      item: {
        to: "/dashboard",
        label: "Overview",
        icon: LayoutDashboard,
        shortcut: "G D",
        description: "Fleet overview",
      },
    };
  }, [loc.pathname]);

  // Flattened items for command palette search
  const allNavItems = useMemo(() => {
    return NAV_SECTIONS.flatMap((s) => s.items);
  }, []);

  const commandFilteredItems = useMemo(() => {
    if (!commandSearch.trim()) return allNavItems;
    const q = commandSearch.toLowerCase();
    return allNavItems.filter(
      (i) => i.label.toLowerCase().includes(q) || (i.description && i.description.toLowerCase().includes(q))
    );
  }, [commandSearch, allNavItems]);

  const avatarLetters =
    user?.name
      ?.split(" ")
      .map((s) => s[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "ND";

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex text-slate-900 font-sans antialiased selection:bg-indigo-100 selection:text-indigo-900">
      {/* ── SIDEBAR (DESKTOP & TABLET) ─────────────────────────── */}
      <aside
        className={`fixed lg:sticky top-0 left-0 h-screen z-40 transition-all duration-300 ease-in-out flex flex-col bg-white border-r border-slate-200/80 shadow-[1px_0_6px_rgba(0,0,0,0.02)] ${
          collapsed ? "w-[72px]" : "w-64"
        } ${mobileDrawerOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      >
        {/* Brand Header */}
        <div
          className={`h-16 flex items-center shrink-0 border-b border-slate-100 transition-all ${
            collapsed ? "justify-center px-0" : "justify-between px-4"
          }`}
        >
          <Link to="/dashboard" className="flex items-center gap-3 min-w-0 group">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-indigo-900 p-2 text-white shadow-md shadow-indigo-500/20 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Logo className="h-full w-full object-contain brightness-0 invert" />
            </div>

            {!collapsed && (
              <div className="leading-tight min-w-0">
                <div className="text-slate-900 font-extrabold text-sm tracking-tight truncate flex items-center gap-1.5">
                  <span>Nanjil Fleet</span>
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse ring-2 ring-emerald-200" />
                </div>
                <div className="text-slate-400 text-[10.5px] font-semibold tracking-wide truncate">
                  Dairy Operations OS
                </div>
              </div>
            )}
          </Link>

          {!collapsed && (
            <button
              onClick={toggleCollapsed}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors hidden lg:flex"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}

          {/* Close button on mobile drawer */}
          <button
            onClick={() => setMobileDrawerOpen(false)}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Sidebar Nav Items */}
        <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-4 custom-scrollbar">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title} className="space-y-1">
              {!collapsed && (
                <div className="px-3 mb-1.5 text-[9.5px] font-extrabold uppercase tracking-[0.16em] text-slate-400 select-none">
                  {section.title}
                </div>
              )}
              {section.items.map((item) => {
                const active =
                  loc.pathname === item.to ||
                  (item.to !== "/dashboard" && loc.pathname.startsWith(item.to));
                const Icon = item.icon;

                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileDrawerOpen(false)}
                    title={collapsed ? `${item.label} (${item.shortcut})` : undefined}
                    className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all group ${
                      active
                        ? "bg-gradient-to-r from-indigo-50 to-indigo-100/50 text-indigo-700 font-bold border border-indigo-200/70 shadow-xs"
                        : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 border border-transparent"
                    } ${collapsed ? "justify-center px-0 h-11 w-11 mx-auto" : ""}`}
                  >
                    {/* Active Left Indicator Pill */}
                    {active && !collapsed && (
                      <span className="absolute left-0 top-2 bottom-2 w-1.25 rounded-r-full bg-indigo-600 shadow-[0_0_8px_rgba(79,70,229,0.5)]" />
                    )}

                    <Icon
                      className={`h-4.5 w-4.5 shrink-0 transition-transform group-hover:scale-105 ${
                        active ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-700"
                      }`}
                    />

                    {!collapsed && (
                      <div className="truncate flex-1 flex items-center justify-between">
                        <span className="truncate">{item.label}</span>
                        {item.shortcut && (
                          <span
                            className={`text-[9.5px] font-mono tracking-wider ml-2 opacity-0 group-hover:opacity-100 transition-opacity ${
                              active ? "text-indigo-400 opacity-100" : "text-slate-400"
                            }`}
                          >
                            {item.shortcut}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Unread Alerts Badge */}
                    {typeof item.badge === "number" && item.badge > 0 && (
                      <span
                        className={`${
                          collapsed ? "absolute -top-1 -right-1" : "ml-auto"
                        } h-4.5 min-w-4.5 px-1.5 rounded-full bg-rose-500 text-white text-[9.5px] font-bold flex items-center justify-center shadow-xs ring-2 ring-white animate-pulse`}
                      >
                        {item.badge}
                      </span>
                    )}

                    {active && !collapsed && !item.badge && (
                      <ChevronRight className="h-3.5 w-3.5 ml-auto text-indigo-400 shrink-0" />
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Expand Trigger when collapsed */}
        {collapsed && (
          <div className="p-2 border-t border-slate-100 flex justify-center">
            <button
              onClick={toggleCollapsed}
              className="p-2.5 rounded-xl text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
              title="Expand sidebar"
            >
              <PanelLeft className="h-4.5 w-4.5" />
            </button>
          </div>
        )}

        {/* Gateway Telemetry Status Indicator at bottom of Sidebar */}
        {!collapsed && (
          <div className="px-3.5 py-2 border-t border-slate-100 bg-slate-50/60">
            <div className="flex items-center justify-between text-[10.5px]">
              <div className="flex items-center gap-1.5 text-slate-600 font-medium truncate">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <span className="truncate">GPS Gateway Active</span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">99.8%</span>
            </div>
          </div>
        )}

        {/* User Profile Card at bottom of Sidebar */}
        <div className="shrink-0 p-3 border-t border-slate-100 bg-white">
          <div
            className={`flex items-center gap-2.5 p-2 rounded-2xl bg-slate-50/90 border border-slate-200/80 transition-all ${
              collapsed ? "justify-center p-1.5" : ""
            }`}
          >
            <div className="relative">
              <div className="h-8.5 w-8.5 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white bg-gradient-to-br from-indigo-600 to-indigo-800 shadow-xs">
                {avatarLetters}
              </div>
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
            </div>

            {!collapsed && (
              <div className="flex-1 min-w-0">
                <div className="text-slate-900 text-xs font-bold truncate leading-tight">
                  {user?.name || "Fleet User"}
                </div>
                <div className="text-slate-400 text-[10px] capitalize font-medium">
                  {user?.role === "admin" ? "Administrator" : "Fleet Manager"}
                </div>
              </div>
            )}

            {!collapsed && (
              <button
                onClick={() => {
                  logout();
                  nav("/login");
                }}
                className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile Drawer Backdrop */}
      {mobileDrawerOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-30 lg:hidden"
          onClick={() => setMobileDrawerOpen(false)}
        />
      )}

      {/* ── MAIN APPLICATION VIEWPORT ──────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* ── TOP HEADER BAR ────────────────────────────────────── */}
        <header className="h-16 sticky top-0 z-30 flex items-center px-4 md:px-6 gap-3 bg-white/90 backdrop-blur-md border-b border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          {/* Mobile menu trigger */}
          <button
            onClick={() => setMobileDrawerOpen(true)}
            className="lg:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors relative"
            aria-label="Toggle navigation drawer"
          >
            <Menu className="h-5 w-5" />
            {unreadAlerts.length > 0 && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
            )}
          </button>

          {/* Breadcrumb Context with interactive module switcher */}
          <div className="relative">
            <button
              onClick={() => setModuleSwitcherOpen(!moduleSwitcherOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors group"
            >
              <span className="text-slate-400 font-medium hidden sm:inline">Nanjil</span>
              <ChevronRight className="h-3.5 w-3.5 text-slate-300 hidden sm:inline" />
              <currentNav.item.icon className="h-4 w-4 text-indigo-600" />
              <span className="text-slate-900 font-bold">{currentNav.item.label}</span>
              <ChevronDown className="h-3 w-3 text-slate-400 group-hover:text-slate-700 transition-transform" />
            </button>

            {/* Quick module switcher dropdown */}
            {moduleSwitcherOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setModuleSwitcherOpen(false)} />
                <div className="absolute left-0 top-full mt-2 w-72 z-50 rounded-2xl bg-white border border-slate-200 shadow-2xl p-2 text-xs space-y-1 animate-in fade-in zoom-in-95">
                  <div className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    Switch Fleet Workspace
                  </div>
                  {allNavItems.map((item) => {
                    const Icon = item.icon;
                    const isSelected = item.to === currentNav.item.to;
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={() => setModuleSwitcherOpen(false)}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-xl transition-colors ${
                          isSelected
                            ? "bg-indigo-50 text-indigo-700 font-bold"
                            : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <Icon className={`h-4 w-4 ${isSelected ? "text-indigo-600" : "text-slate-400"}`} />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold truncate">{item.label}</div>
                          {item.description && (
                            <div className="text-[10px] text-slate-400 truncate">{item.description}</div>
                          )}
                        </div>
                        {isSelected && <Check className="h-3.5 w-3.5 text-indigo-600 shrink-0" />}
                      </Link>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* ── FLEET PULSE TICKER (REAL-TIME STATUS PILLS) ───────── */}
          <div className="hidden xl:flex items-center gap-2 ml-2 pl-3 border-l border-slate-200/80">
            <Link
              to="/vehicles"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 hover:bg-slate-200/70 text-slate-700 transition-colors"
              title="Total Registered Fleet Assets"
            >
              <Truck className="h-3 w-3 text-slate-500" />
              <span>{fleetPulse.total} Total</span>
            </Link>

            <Link
              to="/tracking"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 hover:bg-emerald-100/80 text-emerald-700 border border-emerald-200/70 transition-colors"
              title="Vehicles in transit on road"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>{fleetPulse.moving} Moving</span>
            </Link>

            <Link
              to="/tracking"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 hover:bg-amber-100/80 text-amber-700 border border-amber-200/70 transition-colors"
              title="Vehicles with ignition on, speed 0"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span>{fleetPulse.idle} Idle</span>
            </Link>

            {unreadAlerts.length > 0 && (
              <Link
                to="/alerts"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-50 hover:bg-rose-100/80 text-rose-700 border border-rose-200/70 transition-colors"
                title="Active unresolved alerts"
              >
                <AlertTriangle className="h-3 w-3 text-rose-500" />
                <span>{unreadAlerts.length} Alerts</span>
              </Link>
            )}
          </div>

          <div className="flex-1" />

          {/* Global Search / Command Palette Trigger */}
          <button
            onClick={() => setCommandPaletteOpen(true)}
            className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-100/90 hover:bg-slate-200/70 border border-slate-200/80 text-xs text-slate-500 transition-all w-40 sm:w-56 md:w-64 shadow-2xs group"
          >
            <Search className="h-3.5 w-3.5 text-slate-400 group-hover:text-indigo-600 shrink-0 transition-colors" />
            <span className="truncate">Search modules, vehicles…</span>
            <kbd className="ml-auto hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9.5px] font-bold text-slate-400 bg-white rounded-md border border-slate-200 shadow-2xs">
              ⌘K
            </kbd>
          </button>

          {/* Live Telemetry Indicator Pill */}
          <div
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/70 shadow-2xs"
            title={`Streaming via ${TELEMETRY_LABEL}`}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse ring-2 ring-emerald-200" />
            <span>GPS Live</span>
          </div>

          {/* Quick Action Dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setQuickActionOpen(!quickActionOpen);
                setNotificationsOpen(false);
                setProfileOpen(false);
                setModuleSwitcherOpen(false);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white text-xs font-semibold shadow-xs transition-all active:scale-95"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Action</span>
            </button>

            {quickActionOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setQuickActionOpen(false)} />
                <div className="absolute right-0 top-full mt-2 w-64 z-50 rounded-2xl bg-white border border-slate-200 shadow-2xl p-2 text-xs space-y-1 animate-in fade-in zoom-in-95">
                  <div className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    Quick Operational Actions
                  </div>

                  <Link
                    to="/routes"
                    onClick={() => setQuickActionOpen(false)}
                    className="flex items-start gap-3 p-2 rounded-xl text-slate-700 hover:bg-indigo-50/70 hover:text-indigo-900 group transition-colors"
                  >
                    <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                      <RouteIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">Plan New Route</div>
                      <div className="text-[10.5px] text-slate-500">
                        Build collection circuit with stops
                      </div>
                    </div>
                  </Link>

                  <Link
                    to="/fuel"
                    onClick={() => setQuickActionOpen(false)}
                    className="flex items-start gap-3 p-2 rounded-xl text-slate-700 hover:bg-emerald-50/70 hover:text-emerald-900 group transition-colors"
                  >
                    <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                      <Fuel className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">Log Fuel Refill</div>
                      <div className="text-[10.5px] text-slate-500">
                        Record litrage, odometer & fuel slip
                      </div>
                    </div>
                  </Link>

                  <Link
                    to="/vehicles"
                    onClick={() => setQuickActionOpen(false)}
                    className="flex items-start gap-3 p-2 rounded-xl text-slate-700 hover:bg-blue-50/70 hover:text-blue-900 group transition-colors"
                  >
                    <div className="p-2 rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                      <Truck className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">Add Fleet Vehicle</div>
                      <div className="text-[10.5px] text-slate-500">
                        Register tanker or milk collection van
                      </div>
                    </div>
                  </Link>

                  <Link
                    to="/drivers"
                    onClick={() => setQuickActionOpen(false)}
                    className="flex items-start gap-3 p-2 rounded-xl text-slate-700 hover:bg-amber-50/70 hover:text-amber-900 group transition-colors"
                  >
                    <div className="p-2 rounded-lg bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white transition-colors">
                      <UsersRound className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">Register Driver</div>
                      <div className="text-[10.5px] text-slate-500">
                        Onboard delivery driver & license
                      </div>
                    </div>
                  </Link>
                </div>
              </>
            )}
          </div>

          {/* Notifications Center Bell */}
          <div className="relative">
            <button
              onClick={() => {
                setNotificationsOpen(!notificationsOpen);
                setProfileOpen(false);
                setQuickActionOpen(false);
                setModuleSwitcherOpen(false);
              }}
              className="relative p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
              aria-label="Operational Notifications"
            >
              <Bell className="h-5 w-5" />
              {unreadAlerts.length > 0 && (
                <span className="absolute top-1.5 right-1.5 h-4 min-w-4 px-1 rounded-full bg-rose-500 text-white text-[9.5px] font-bold flex items-center justify-center ring-2 ring-white animate-pulse">
                  {unreadAlerts.length}
                </span>
              )}
            </button>

            {/* Notifications Dropdown Drawer */}
            {notificationsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setNotificationsOpen(false)} />
                <div className="absolute right-0 top-full mt-2 w-84 z-50 rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden text-xs animate-in fade-in zoom-in-95">
                  <div className="p-3.5 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-900 flex items-center gap-1.5">
                        <span>Operational Alerts</span>
                        {unreadAlerts.length > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">
                            {unreadAlerts.length} new
                          </span>
                        )}
                      </div>
                      <div className="text-[10.5px] text-slate-400">
                        Real-time speed, offline & breakdown events
                      </div>
                    </div>
                    <Link
                      to="/alerts"
                      onClick={() => setNotificationsOpen(false)}
                      className="text-indigo-600 hover:text-indigo-800 text-[11px] font-bold"
                    >
                      View All
                    </Link>
                  </div>

                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 custom-scrollbar">
                    {unreadAlerts.length > 0 ? (
                      unreadAlerts.map((alt) => (
                        <div
                          key={alt.id}
                          className="p-3 hover:bg-slate-50/90 transition-colors flex items-start justify-between gap-3 group"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  alt.severity === "critical"
                                    ? "bg-rose-500"
                                    : alt.severity === "warning"
                                    ? "bg-amber-500"
                                    : "bg-blue-500"
                                }`}
                              />
                              <span className="font-bold text-slate-900 truncate">
                                {alt.vehicle || "Fleet Asset"}
                              </span>
                              <span className="text-[10px] text-slate-400 ml-auto shrink-0">
                                {alt.time ? new Date(alt.time).toLocaleTimeString() : "Recent"}
                              </span>
                            </div>
                            <div className="text-[11.5px] text-slate-600 line-clamp-2 leading-relaxed">
                              {alt.message}
                            </div>
                          </div>

                          <button
                            onClick={(e) => resolveAlert(alt.id, e)}
                            className="p-1 rounded-lg text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 transition-colors shrink-0"
                            title="Mark resolved"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="p-8 text-center space-y-2">
                        <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto opacity-70" />
                        <div className="text-slate-700 font-semibold text-xs">All Clear</div>
                        <div className="text-slate-400 text-[11px] max-w-[200px] mx-auto">
                          Zero unresolved alerts. All dairy routes and vehicles running nominally.
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-2 border-t border-slate-100 bg-slate-50/50 text-center">
                    <Link
                      to="/alerts"
                      onClick={() => setNotificationsOpen(false)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-indigo-600"
                    >
                      <span>Open Alerts & Incidents Center</span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* User Profile Pill & Dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setProfileOpen(!profileOpen);
                setNotificationsOpen(false);
                setQuickActionOpen(false);
                setModuleSwitcherOpen(false);
              }}
              className="flex items-center gap-2 p-1 pl-2.5 rounded-2xl hover:bg-slate-100/90 transition-colors border border-slate-200/70"
            >
              <div className="text-left hidden md:block">
                <div className="text-xs font-bold text-slate-800 leading-tight">
                  {user?.name || "Fleet User"}
                </div>
                <div className="text-[10px] text-slate-400 capitalize leading-tight">
                  {user?.role === "admin" ? "Administrator" : "Fleet Manager"}
                </div>
              </div>
              <div className="h-7.5 w-7.5 rounded-full flex items-center justify-center text-xs font-bold text-white bg-gradient-to-br from-indigo-600 to-indigo-800 shrink-0 shadow-2xs">
                {avatarLetters}
              </div>
              <ChevronDown className="h-3 w-3 text-slate-400" />
            </button>

            {profileOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
                <div className="absolute right-0 top-full mt-2 w-60 z-50 rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden text-xs animate-in fade-in zoom-in-95">
                  <div className="p-3.5 border-b border-slate-100 bg-slate-50/70">
                    <div className="font-bold text-slate-900 truncate">
                      {user?.name || "Nanjil Fleet Staff"}
                    </div>
                    <div className="text-slate-400 text-[11px] truncate">
                      {user?.email || "fleet@nanjildairy.com"}
                    </div>
                    <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700">
                      <span>{user?.role === "admin" ? "Role: Admin" : "Role: Fleet Manager"}</span>
                    </div>
                  </div>

                  <div className="p-1.5 space-y-0.5">
                    <Link
                      to="/settings"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-slate-700 hover:bg-slate-50 font-medium"
                    >
                      <Settings className="h-4 w-4 text-slate-400" />
                      <span>System Settings</span>
                    </Link>

                    <Link
                      to="/reports"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-slate-700 hover:bg-slate-50 font-medium"
                    >
                      <FileBarChart2 className="h-4 w-4 text-slate-400" />
                      <span>Operational Reports</span>
                    </Link>

                    <div className="my-1 border-t border-slate-100" />

                    <button
                      onClick={() => {
                        setProfileOpen(false);
                        logout();
                        nav("/login");
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 font-medium text-left"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </header>

        {/* ── MAIN CONTENT AREA ─────────────────────────────────── */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1680px] w-full mx-auto space-y-6 pb-24 lg:pb-8">
          {children}
        </main>
      </div>

      {/* ── COMMAND PALETTE MODAL (CTRL + K / CMD + K) ─────────── */}
      {commandPaletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 bg-slate-900/50 backdrop-blur-xs p-4">
          <div
            className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-2xl overflow-hidden space-y-1 animate-in fade-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Input Header */}
            <div className="p-3.5 border-b border-slate-100 flex items-center gap-3">
              <Search className="h-4.5 w-4.5 text-indigo-600 shrink-0" />
              <input
                autoFocus
                value={commandSearch}
                onChange={(e) => {
                  setCommandSearch(e.target.value);
                  setCommandSelectedIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCommandSelectedIndex((prev) =>
                      prev < commandFilteredItems.length - 1 ? prev + 1 : 0
                    );
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCommandSelectedIndex((prev) =>
                      prev > 0 ? prev - 1 : commandFilteredItems.length - 1
                    );
                  } else if (e.key === "Enter" && commandFilteredItems[commandSelectedIndex]) {
                    e.preventDefault();
                    nav(commandFilteredItems[commandSelectedIndex].to);
                    setCommandPaletteOpen(false);
                  }
                }}
                placeholder="Jump to route planner, trip history, fuel, or vehicles…"
                className="w-full text-xs outline-none bg-transparent text-slate-900 placeholder:text-slate-400 font-medium"
              />
              <kbd className="px-1.5 py-0.5 text-[10px] font-bold text-slate-400 bg-slate-100 rounded-md border border-slate-200">
                ESC
              </kbd>
            </div>

            {/* Filtered Item List */}
            <div className="max-h-80 overflow-y-auto p-2 space-y-1 custom-scrollbar">
              <div className="px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                Available Destinations & Tools
              </div>

              {commandFilteredItems.length > 0 ? (
                commandFilteredItems.map((item, idx) => {
                  const Icon = item.icon;
                  const isSelected = idx === commandSelectedIndex;

                  return (
                    <button
                      key={item.to}
                      onClick={() => {
                        nav(item.to);
                        setCommandPaletteOpen(false);
                      }}
                      onMouseEnter={() => setCommandSelectedIndex(idx)}
                      className={`w-full flex items-center justify-between p-2.5 rounded-xl text-xs transition-colors group text-left ${
                        isSelected
                          ? "bg-indigo-50/90 text-indigo-900 font-bold"
                          : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`p-2 rounded-lg ${
                            isSelected
                              ? "bg-indigo-600 text-white"
                              : "bg-slate-100 text-slate-500 group-hover:text-indigo-600"
                          } transition-colors`}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold truncate">{item.label}</div>
                          {item.description && (
                            <div className="text-[10.5px] text-slate-400 font-normal truncate">
                              {item.description}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {item.shortcut && (
                          <span className="text-[10px] text-slate-400 font-mono px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200">
                            {item.shortcut}
                          </span>
                        )}
                        <ArrowRight className="h-3.5 w-3.5 opacity-40 group-hover:opacity-100 text-indigo-600 transition-opacity" />
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="p-8 text-center text-slate-400 text-xs">
                  No matching modules found for "{commandSearch}".
                </div>
              )}
            </div>

            {/* Footer tips */}
            <div className="p-2.5 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between text-[10.5px] text-slate-400 px-4">
              <div className="flex items-center gap-3">
                <span>↑↓ Navigate</span>
                <span>↵ Open</span>
              </div>
              <span>Nanjil Fleet Intelligence</span>
            </div>
          </div>
        </div>
      )}

      {/* ── MOBILE BOTTOM NAVIGATION BAR ───────────────────────── */}
      <nav
        aria-label="Mobile Navigation"
        className="fixed bottom-0 left-0 right-0 z-30 lg:hidden bg-white/95 backdrop-blur-md border-t border-slate-200/90 flex items-center justify-around py-2 shadow-lg safe-bottom"
      >
        <Link
          to="/dashboard"
          className={`flex flex-col items-center gap-0.5 text-[10px] font-bold ${
            loc.pathname === "/dashboard" ? "text-indigo-600" : "text-slate-500"
          }`}
        >
          <LayoutDashboard className="h-4.5 w-4.5" />
          <span>Overview</span>
        </Link>
        <Link
          to="/tracking"
          className={`flex flex-col items-center gap-0.5 text-[10px] font-bold ${
            loc.pathname === "/tracking" ? "text-indigo-600" : "text-slate-500"
          }`}
        >
          <Radio className="h-4.5 w-4.5" />
          <span>Tracking</span>
        </Link>
        <Link
          to="/routes"
          className={`flex flex-col items-center gap-0.5 text-[10px] font-bold ${
            loc.pathname === "/routes" ? "text-indigo-600" : "text-slate-500"
          }`}
        >
          <RouteIcon className="h-4.5 w-4.5" />
          <span>Routes</span>
        </Link>
        <Link
          to="/trips"
          className={`flex flex-col items-center gap-0.5 text-[10px] font-bold ${
            loc.pathname === "/trips" ? "text-indigo-600" : "text-slate-500"
          }`}
        >
          <History className="h-4.5 w-4.5" />
          <span>Trips</span>
        </Link>
        <Link
          to="/alerts"
          className={`relative flex flex-col items-center gap-0.5 text-[10px] font-bold ${
            loc.pathname === "/alerts" ? "text-indigo-600" : "text-slate-500"
          }`}
        >
          <Bell className="h-4.5 w-4.5" />
          <span>Alerts</span>
          {unreadAlerts.length > 0 && (
            <span className="absolute -top-1 right-2 h-4 min-w-4 px-1 rounded-full bg-rose-500 text-white text-[8.5px] font-bold flex items-center justify-center animate-pulse ring-2 ring-white">
              {unreadAlerts.length}
            </span>
          )}
        </Link>
      </nav>
    </div>
  );
}

/**
 * ── ENHANCED PAGE HEADER COMPONENT ─────────────────────────────
 * Provides a uniform, stunning header across all fleet management pages.
 */
export function PageHeader({
  title,
  subtitle,
  badge,
  actions,
  tabs,
}: {
  title: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  tabs?: {
    id: string;
    label: string;
    icon?: any;
    badge?: number;
    active: boolean;
    onClick: () => void;
  }[];
}) {
  return (
    <div className="space-y-4 mb-6">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-2 border-b border-slate-200/70">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">
              {title}
            </h1>
            {badge && <div>{badge}</div>}
          </div>
          {subtitle && (
            <div className="text-xs sm:text-sm text-slate-500 mt-1 font-medium leading-relaxed">
              {subtitle}
            </div>
          )}
        </div>

        {actions && (
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 shrink-0">{actions}</div>
        )}
      </div>

      {/* Optional Integrated Tab Strip */}
      {tabs && tabs.length > 0 && (
        <div className="flex items-center gap-1.5 border-b border-slate-200/80 overflow-x-auto pb-1 scrollbar-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={tab.onClick}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
                  tab.active
                    ? "bg-indigo-50 text-indigo-700 border border-indigo-200/80 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70"
                }`}
              >
                {Icon && <Icon className="h-4 w-4" />}
                <span>{tab.label}</span>
                {typeof tab.badge === "number" && tab.badge > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      tab.active ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
