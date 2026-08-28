import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function Card({
  children, className = "", ...props
}: React.HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      {...props}
      className={`bg-card border border-border rounded-xl shadow-sm ${className}`}
      style={{
        boxShadow: "0 1px 3px rgba(10,20,60,0.06), 0 1px 2px rgba(10,20,60,0.04)",
        ...(props.style ?? {}),
      }}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title, subtitle, action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-3.5 border-b border-border">
      <div>
        <div className="font-semibold text-sm text-foreground">{title}</div>
        {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

const STATUS_CONFIG: Record<string, { dot: string; badge: string }> = {
  Moving:       { dot: "bg-emerald-500", badge: "bg-emerald-500/12 text-emerald-700 border-emerald-500/25 ring-emerald-500/15" },
  Idle:         { dot: "bg-amber-500",   badge: "bg-amber-500/12 text-amber-700 border-amber-500/25 ring-amber-500/15" },
  Parked:       { dot: "bg-slate-400",   badge: "bg-slate-100 text-slate-600 border-slate-200 ring-slate-200" },
  Offline:      { dot: "bg-red-500",     badge: "bg-red-500/10 text-red-700 border-red-500/20 ring-red-500/10" },
  "On Time":    { dot: "bg-emerald-500", badge: "bg-emerald-500/12 text-emerald-700 border-emerald-500/25 ring-emerald-500/15" },
  Delayed:      { dot: "bg-red-500",     badge: "bg-red-500/10 text-red-700 border-red-500/20 ring-red-500/10" },
  Completed:    { dot: "bg-sky-500",     badge: "bg-sky-500/10 text-sky-700 border-sky-500/20 ring-sky-500/10" },
  "In Progress":{ dot: "bg-amber-500",   badge: "bg-amber-500/12 text-amber-700 border-amber-500/25 ring-amber-500/15" },
  Ongoing:      { dot: "bg-sky-500",     badge: "bg-sky-500/10 text-sky-700 border-sky-500/20 ring-sky-500/10" },
  High:         { dot: "bg-red-500",     badge: "bg-red-500/10 text-red-700 border-red-500/20 ring-red-500/10" },
  Medium:       { dot: "bg-amber-500",   badge: "bg-amber-500/12 text-amber-700 border-amber-500/25 ring-amber-500/15" },
  Low:          { dot: "bg-sky-500",     badge: "bg-sky-500/10 text-sky-700 border-sky-500/20 ring-sky-500/10" },
  Excellent:    { dot: "bg-emerald-500", badge: "bg-emerald-500/12 text-emerald-700 border-emerald-500/25 ring-emerald-500/15" },
  Good:         { dot: "bg-sky-500",     badge: "bg-sky-500/10 text-sky-700 border-sky-500/20 ring-sky-500/10" },
  Average:      { dot: "bg-amber-500",   badge: "bg-amber-500/12 text-amber-700 border-amber-500/25 ring-amber-500/15" },
  Poor:         { dot: "bg-red-500",     badge: "bg-red-500/10 text-red-700 border-red-500/20 ring-red-500/10" },
  Upcoming:     { dot: "bg-sky-500",     badge: "bg-sky-500/10 text-sky-700 border-sky-500/20 ring-sky-500/10" },
  Overdue:      { dot: "bg-red-500",     badge: "bg-red-500/10 text-red-700 border-red-500/20 ring-red-500/10" },
};

export function StatusDot({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${cfg?.dot ?? "bg-slate-400"}`}
    />
  );
}

export function Badge({ status, children }: { status?: string; children: ReactNode }) {
  const cfg = status ? STATUS_CONFIG[status] : undefined;
  const cls = cfg?.badge ?? "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-semibold rounded-full border ring-1 ring-inset ${cls}`}
    >
      <StatusDot status={status ?? ""} />
      {children}
    </span>
  );
}

const ACCENT_CONFIG: Record<string, { icon: string; value: string; hint: string }> = {
  primary:     { icon: "bg-primary/10 text-primary", value: "text-foreground", hint: "text-muted-foreground" },
  success:     { icon: "bg-emerald-500/10 text-emerald-600", value: "text-foreground", hint: "text-muted-foreground" },
  warning:     { icon: "bg-amber-500/12 text-amber-700", value: "text-foreground", hint: "text-muted-foreground" },
  destructive: { icon: "bg-red-500/10 text-red-600", value: "text-foreground", hint: "text-muted-foreground" },
  info:        { icon: "bg-sky-500/10 text-sky-600", value: "text-foreground", hint: "text-muted-foreground" },
};

export function Kpi({
  label, value, hint, accent = "primary", icon, to,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: "primary" | "success" | "warning" | "destructive" | "info";
  icon?: ReactNode;
  to?: string;
}) {
  const cfg = ACCENT_CONFIG[accent];
  const content = (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
          {label}
        </div>
        <div className={`text-2xl font-bold tracking-tight ${cfg.value}`}>{value}</div>
        {hint && <div className={`text-xs mt-1.5 ${cfg.hint}`}>{hint}</div>}
      </div>
      {icon && (
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${cfg.icon}`}>
          {icon}
        </div>
      )}
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="kpi-card kpi-card-hover block cursor-pointer select-none no-underline">
        {content}
      </Link>
    );
  }

  return (
    <div className="kpi-card kpi-card-hover">
      {content}
    </div>
  );
}

const BTN_VARIANTS: Record<string, string> = {
  primary:
    "text-white border-transparent shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/25 hover:-translate-y-0.5 active:translate-y-0",
  outline:
    "border border-border bg-card text-foreground hover:bg-muted/60 hover:-translate-y-0.5 active:translate-y-0",
  ghost:
    "border-transparent bg-transparent text-foreground hover:bg-muted/60",
  destructive:
    "bg-destructive text-white border-transparent shadow-sm shadow-destructive/20 hover:bg-destructive/90 hover:-translate-y-0.5",
  success:
    "bg-success text-white border-transparent shadow-sm shadow-success/20 hover:bg-success/90 hover:-translate-y-0.5",
};

const BTN_SIZES: Record<string, string> = {
  sm: "h-8 px-3 text-xs gap-1",
  md: "h-9 px-4 text-sm gap-1.5",
  lg: "h-11 px-5 text-sm gap-2",
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost" | "destructive" | "success";
  size?: "sm" | "md" | "lg";
}) {
  const isPrimary = variant === "primary";
  return (
    <button
      {...props}
      className={`
        inline-flex items-center justify-center rounded-lg font-semibold border
        transition-all duration-150
        disabled:opacity-50 disabled:pointer-events-none disabled:hover:translate-y-0
        ${BTN_SIZES[size]}
        ${BTN_VARIANTS[variant]}
        ${className}
      `}
      style={
        isPrimary
          ? {
              background:
                "linear-gradient(135deg, oklch(0.44 0.22 264) 0%, oklch(0.36 0.18 258) 100%)",
              ...(props.style ?? {}),
            }
          : props.style ?? undefined
      }
    >
      {children}
    </button>
  );
}
