import type { ReactNode } from "react";

export function Card({ children, className = "", ...props }: React.HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div {...props} className={`bg-card border border-border rounded-lg shadow-sm ${className}`}>{children}</div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
      <div>
        <div className="font-medium text-sm">{title}</div>
        {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Moving: "bg-success",
    Idle: "bg-warning",
    Parked: "bg-muted-foreground",
    Offline: "bg-destructive",
    "On Time": "bg-success",
    Delayed: "bg-destructive",
    Completed: "bg-info",
    "In Progress": "bg-warning",
    Ongoing: "bg-info",
    High: "bg-destructive",
    Medium: "bg-warning",
    Low: "bg-info",
    Excellent: "bg-success",
    Good: "bg-info",
    Average: "bg-warning",
    Poor: "bg-destructive",
    Upcoming: "bg-info",
    Overdue: "bg-destructive",
  };
  return <span className={`inline-block h-2 w-2 rounded-full ${colors[status] ?? "bg-muted-foreground"}`} />;
}

export function Badge({ status, children }: { status?: string; children: ReactNode }) {
  const tones: Record<string, string> = {
    Moving: "bg-success/10 text-success border-success/30",
    Idle: "bg-warning/15 text-warning-foreground border-warning/40",
    Parked: "bg-muted text-muted-foreground border-border",
    Offline: "bg-destructive/10 text-destructive border-destructive/30",
    "On Time": "bg-success/10 text-success border-success/30",
    Delayed: "bg-destructive/10 text-destructive border-destructive/30",
    Completed: "bg-info/10 text-info border-info/30",
    "In Progress": "bg-warning/15 text-warning-foreground border-warning/40",
    Ongoing: "bg-info/10 text-info border-info/30",
    High: "bg-destructive/10 text-destructive border-destructive/30",
    Medium: "bg-warning/15 text-warning-foreground border-warning/40",
    Low: "bg-info/10 text-info border-info/30",
    Excellent: "bg-success/10 text-success border-success/30",
    Good: "bg-info/10 text-info border-info/30",
    Average: "bg-warning/15 text-warning-foreground border-warning/40",
    Poor: "bg-destructive/10 text-destructive border-destructive/30",
    Upcoming: "bg-info/10 text-info border-info/30",
    Overdue: "bg-destructive/10 text-destructive border-destructive/30",
  };
  const tone = (status && tones[status]) || "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-md border ${tone}`}>
      <StatusDot status={status ?? ""} />
      {children}
    </span>
  );
}

export function Kpi({
  label, value, hint, accent = "primary", icon,
}: { label: string; value: ReactNode; hint?: string; accent?: "primary" | "success" | "warning" | "destructive" | "info"; icon?: ReactNode }) {
  const ring: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    warning: "bg-warning/15 text-warning-foreground",
    destructive: "bg-destructive/10 text-destructive",
    info: "bg-info/10 text-info",
  };
  return (
    <div className="kpi-card kpi-card-hover">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</div>
          <div className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
          {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
        </div>
        {icon && <div className={`h-9 w-9 rounded-md flex items-center justify-center ${ring[accent]}`}>{icon}</div>}
      </div>
    </div>
  );
}

export function Button({
  children, variant = "primary", size = "md", className = "", ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "ghost" | "destructive" | "success"; size?: "sm" | "md" }) {
  const sizes: Record<string, string> = { sm: "h-8 px-3 text-xs", md: "h-9 px-4 text-sm" };
  const variants: Record<string, string> = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-border bg-card hover:bg-muted",
    ghost: "hover:bg-muted",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    success: "bg-success text-success-foreground hover:bg-success/90",
  };
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
