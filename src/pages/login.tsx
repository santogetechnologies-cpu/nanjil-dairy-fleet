import { useNavigate, Navigate } from "react-router-dom";
import { useState } from "react";
import { useAuth, REDIRECT_MAP } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import {
  Mail, Lock, Loader2, Shield, Snowflake, Fuel, MapPin,
  Eye, EyeOff, ArrowRight, Zap, TrendingUp,
} from "lucide-react";
import { motion } from "framer-motion";

function LoginPage() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    return <Navigate to={REDIRECT_MAP[user.role]} />;
  }

  function go(role: any) {
    nav(REDIRECT_MAP[role as keyof typeof REDIRECT_MAP]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await login(email, password);
      setBusy(false);
      if (!r.ok) setError(r.error ?? "Login failed");
      else if (r.role) go(r.role);
    } catch (err: any) {
      setBusy(false);
      setError(err?.message || "Login failed");
    }
  }

  const features = [
    {
      icon: MapPin,
      label: "Live GPS Tracking",
      desc: "Real-time fleet visibility across all routes",
      delay: 0.10,
      color: "from-sky-400 to-blue-500",
      bg: "from-sky-500/20 to-blue-500/10",
    },
    {
      icon: Fuel,
      label: "Fuel Intelligence",
      desc: "AI-powered theft detection & consumption analytics",
      delay: 0.17,
      color: "from-amber-400 to-orange-500",
      bg: "from-amber-500/20 to-orange-500/10",
    },
    {
      icon: Shield,
      label: "Driver Safety",
      desc: "Behaviour scoring & incident prevention",
      delay: 0.24,
      color: "from-emerald-400 to-teal-500",
      bg: "from-emerald-500/20 to-teal-500/10",
    },
    {
      icon: Snowflake,
      label: "Cold-Chain Monitor",
      desc: "Precision 2°C – 6°C temperature control",
      delay: 0.31,
      color: "from-cyan-400 to-indigo-500",
      bg: "from-cyan-500/20 to-indigo-500/10",
    },
  ];

  const stats = [
    { icon: TrendingUp, value: "99.2%", label: "Uptime" },
    { icon: Zap, value: "<200ms", label: "Latency" },
    { icon: Shield, value: "ISO 27001", label: "Certified" },
  ];

  return (
    <div className="h-screen overflow-hidden bg-[oklch(0.97_0.008_240)] relative flex">

      {/* ── LEFT PANEL ─────────────────────────────────────────── */}
      <div className="hidden lg:flex flex-col relative w-[52%] xl:w-[55%] overflow-hidden">
        {/* Animated mesh gradient */}
        <div className="absolute inset-0 mesh-bg" />

        {/* Decorative orbs */}
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/20 blur-[80px] pointer-events-none" />
        <div className="absolute bottom-[-5%] right-[-5%] w-[45%] h-[45%] rounded-full bg-cyan-500/15 blur-[80px] pointer-events-none" />
        <div className="absolute top-[45%] left-[30%] w-[30%] h-[30%] rounded-full bg-emerald-400/10 blur-[60px] pointer-events-none" />

        <div className="relative flex flex-col h-full px-12 xl:px-16 py-12 justify-between z-10">
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex items-center gap-3"
          >
            <div className="glass-card-dark rounded-2xl p-2.5">
              <Logo className="h-10" />
            </div>
            <div className="leading-tight">
              <div className="text-white font-bold text-lg tracking-tight">Nanjil VIP</div>
              <div className="text-white/60 text-xs font-medium tracking-wide">Vehicle Intelligence Platform</div>
            </div>
          </motion.div>

          {/* Headline */}
          <div className="flex-1 flex flex-col justify-center gap-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.08 }}
            >
              <div className="text-white/50 text-sm font-semibold uppercase tracking-[0.2em] mb-3">

              </div>
              <h1 className="text-4xl xl:text-5xl font-bold text-white leading-[1.15] tracking-tight">
                Drive smarter.<br />
                <span
                  style={{
                    background: "linear-gradient(90deg, #a5f3fc, #818cf8, #6ee7b7)",
                    backgroundSize: "200% auto",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    animation: "shimmer 4s linear infinite",
                  }}
                >
                  Deliver faster.
                </span>
              </h1>
              <p className="mt-4 text-white/60 text-base max-w-sm leading-relaxed">
                AI-powered fleet management, real-time telemetry, and cold-chain monitoring — all in one platform.
              </p>
            </motion.div>

            {/* Feature cards */}
            <div className="grid grid-cols-2 gap-3 max-w-md">
              {features.map((f) => (
                <motion.div
                  key={f.label}
                  initial={{ opacity: 0, scale: 0.94, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: f.delay }}
                  style={{ animationName: "float-up", animationDuration: `${3.5 + Math.random()}s`, animationTimingFunction: "ease-in-out", animationIterationCount: "infinite" }}
                  className="group glass-card-dark rounded-2xl p-4 hover:scale-[1.03] transition-all duration-300 cursor-default"
                >
                  <div className={`h-9 w-9 rounded-xl bg-gradient-to-br ${f.bg} flex items-center justify-center mb-3`}>
                    <div className={`bg-gradient-to-br ${f.color} bg-clip-text`}>
                      <f.icon className="h-4.5 w-4.5 text-white" strokeWidth={2.2} />
                    </div>
                  </div>
                  <div className="text-white/90 text-xs font-semibold leading-tight">{f.label}</div>
                  <div className="text-white/45 text-[10px] mt-0.5 leading-relaxed">{f.desc}</div>
                </motion.div>
              ))}
            </div>

            {/* Stats strip */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.55 }}
              className="flex items-center gap-6"
            >
              {stats.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <s.icon className="h-3.5 w-3.5 text-white/40" />
                  <div>
                    <div className="text-white/90 text-sm font-bold">{s.value}</div>
                    <div className="text-white/40 text-[10px]">{s.label}</div>
                  </div>
                </div>
              ))}
            </motion.div>
          </div>

          {/* Footer */}
          <div className="text-white/30 text-[11px]">
            © {new Date().getFullYear()} Nanjil Integrated Dairy Development
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL — Login Card ────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 sm:px-10 relative">
        {/* Mobile ambient orbs */}
        <div className="lg:hidden absolute inset-0 pointer-events-none">
          <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/12 blur-3xl" />
          <div className="absolute bottom-0 -left-20 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="w-full max-w-[400px] relative z-10"
        >
          {/* Mobile logo */}
          <div className="lg:hidden mb-8 flex flex-col items-center gap-2">
            <div className="bg-white border border-border/60 rounded-2xl p-3 shadow-lg shadow-primary/10">
              <Logo className="h-11" />
            </div>
            <div className="text-center">
              <div className="font-bold text-lg tracking-tight">Nanjil VIP</div>
              <div className="text-muted-foreground text-xs">Vehicle Intelligence Platform</div>
            </div>
          </div>

          {/* Card */}
          <div className="bg-white border border-border/60 rounded-2xl shadow-2xl shadow-primary/8 p-8">
            <div className="mb-7">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">Welcome back</h2>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                Sign in to your operations workspace
              </p>
            </div>

            <form onSubmit={submit} className="space-y-5">
              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Email address
                </label>
                <div className="relative flex items-center">
                  <Mail className="absolute left-3.5 h-4 w-4 text-muted-foreground/70 pointer-events-none" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@nanjilmilk.com"
                    className="w-full h-12 pl-10 pr-4 rounded-xl border border-input bg-background/60 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60 transition-all"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                    Password
                  </label>
                  <button type="button" className="text-xs text-primary hover:text-primary/80 font-medium transition-colors min-h-0 min-w-0">
                    Forgot password?
                  </button>
                </div>
                <div className="relative flex items-center">
                  <Lock className="absolute left-3.5 h-4 w-4 text-muted-foreground/70 pointer-events-none" />
                  <input
                    type={showPwd ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full h-12 pl-10 pr-11 rounded-xl border border-input bg-background/60 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((s) => !s)}
                    className="absolute right-3.5 text-muted-foreground/60 hover:text-foreground transition-colors min-h-0 min-w-0"
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm text-destructive bg-destructive/8 border border-destructive/25 rounded-xl px-4 py-3 flex items-start gap-2"
                >
                  <span className="mt-0.5">⚠</span> {error}
                </motion.div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={busy}
                className="relative w-full h-12 rounded-xl font-semibold text-sm text-white overflow-hidden transition-all duration-200 hover:shadow-lg hover:shadow-primary/30 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                style={{
                  background: busy
                    ? "oklch(0.38 0.20 264)"
                    : "linear-gradient(135deg, oklch(0.42 0.22 264) 0%, oklch(0.35 0.18 258) 100%)",
                }}
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>Sign in <ArrowRight className="h-4 w-4" /></>
                  )}
                </span>
                {/* Shimmer overlay */}
                {!busy && (
                  <div
                    className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity"
                    style={{
                      background: "linear-gradient(105deg, transparent 20%, rgba(255,255,255,0.12) 50%, transparent 80%)",
                    }}
                  />
                )}
              </button>
            </form>

            {/* Footer note */}
            <p className="mt-6 text-center text-[11px] text-muted-foreground/60">
              Secure admin & driver portal · Nanjil Fleet Operations
            </p>
          </div>

          <p className="mt-5 text-center text-xs text-muted-foreground/50">
            v1.4.2 · All rights reserved
          </p>
        </motion.div>
      </div>
    </div>
  );
}

export default LoginPage;
