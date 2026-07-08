import { useNavigate, Navigate } from "react-router-dom";
import { useState } from "react";
import { useAuth, type Role } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import {
  Mail, Lock, Loader2, Shield, Snowflake, Fuel, MapPin,
  Eye, EyeOff, ArrowRight, Truck,
} from "lucide-react";
import { motion } from "framer-motion";

function LoginPage() {
  const { login, loginAs, user } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    return <Navigate to={user.role === "driver" ? "/driver" : "/dashboard"} />;
  }

  function go(role: Role) {
    if (role === "driver") nav("/driver");
    else nav("/dashboard");
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

  async function quickLogin(role: Role) {
    setBusy(true);
    try {
      const r = await loginAs(role);
      setBusy(false);
      go(r);
    } catch (err: any) {
      setBusy(false);
      setError(err?.message || "Demo login failed");
    }
  }

  const features = [
    { icon: MapPin,    label: "Live GPS tracking",   desc: "40+ vehicles",        accent: "from-sky-500/15 to-blue-500/5",     ring: "ring-sky-500/20",    text: "text-sky-600",     span: "col-span-2 row-span-2" },
    { icon: Fuel,      label: "Fuel intelligence",   desc: "Theft alerts",        accent: "from-amber-500/15 to-orange-500/5", ring: "ring-amber-500/20",  text: "text-amber-600",   span: "col-span-2" },
    { icon: Shield,    label: "Driver safety",       desc: "AI scoring",          accent: "from-emerald-500/15 to-teal-500/5", ring: "ring-emerald-500/20",text: "text-emerald-600", span: "" },
    { icon: Snowflake, label: "Cold-chain",          desc: "2°C – 6°C",           accent: "from-cyan-500/15 to-indigo-500/5",  ring: "ring-cyan-500/20",   text: "text-cyan-600",    span: "" },
  ];

  const roles = [
    { role: "admin" as const, name: "Administrator", color: "from-blue-500 to-indigo-600" },
    { role: "manager" as const, name: "Fleet Manager", color: "from-emerald-500 to-teal-600" },
    { role: "driver" as const, name: "Driver", color: "from-amber-500 to-orange-600" },
  ];

  return (
    <div className="h-screen overflow-hidden bg-[oklch(0.98_0.01_220)] relative">
      {/* Ambient background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute top-1/3 -right-40 h-[500px] w-[500px] rounded-full bg-[oklch(0.85_0.12_200)]/30 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-[oklch(0.9_0.1_160)]/30 blur-3xl" />
      </div>

      <div className="relative h-full grid lg:grid-cols-[1.1fr_1fr] max-w-[1400px] mx-auto">
        {/* LEFT — logo + bento features */}
        <div className="hidden lg:flex flex-col justify-center p-10 xl:p-14 gap-7">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex items-center justify-center"
          >
            <div className="relative p-[1.5px] rounded-2xl bg-gradient-to-br from-primary/40 via-sky-400/30 to-emerald-400/30 shadow-[0_20px_60px_-20px_rgba(20,36,64,0.25)]">
              <div className="bg-card/90 backdrop-blur-xl rounded-[14px] px-10 py-7">
                <Logo className="h-16" />
              </div>
            </div>
          </motion.div>

          <div className="grid grid-cols-4 grid-rows-2 gap-3 max-w-xl w-full mx-auto auto-rows-fr">
            {features.map((f, i) => (
              <motion.div
                key={f.label}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.07 }}
                className={`group relative overflow-hidden rounded-2xl p-[1.2px] bg-gradient-to-br ${f.accent} ring-1 ${f.ring} hover:scale-[1.015] transition-transform duration-300 ${f.span}`}
              >
                <div className="relative h-full rounded-[14px] bg-card/85 backdrop-blur p-4 flex flex-col justify-between border border-white/40">
                  <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${f.accent} ${f.text} flex items-center justify-center ring-1 ${f.ring}`}>
                    <f.icon className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div className="mt-3">
                    <div className="text-sm font-semibold tracking-tight">{f.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{f.desc}</div>
                  </div>
                  <div className="pointer-events-none absolute -bottom-10 -right-10 h-28 w-28 rounded-full bg-white/40 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* RIGHT — login card */}
        <div className="flex flex-col justify-center items-center p-6 sm:p-10 lg:p-12 h-full">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="w-full max-w-md"
          >
            <div className="bg-card border border-border rounded-2xl shadow-xl shadow-primary/5 p-7 sm:p-8">
              <div className="lg:hidden mb-6 flex items-center justify-center">
                <div className="bg-card border border-border rounded-lg p-1.5">
                  <Logo className="h-9" />
                </div>
              </div>

              <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign in to your operations workspace.
              </p>

              <form onSubmit={submit} className="mt-6 space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Email</label>
                  <div className="mt-1.5 flex items-center gap-2 px-3 h-11 border border-input rounded-lg bg-background focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <input
                      type="email" required value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@nanjilmilk.com"
                      className="bg-transparent outline-none text-sm w-full"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Password</label>
                    <button type="button" className="text-xs text-primary hover:underline">Forgot?</button>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 px-3 h-11 border border-input rounded-lg bg-background focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition">
                    <Lock className="h-4 w-4 text-muted-foreground" />
                    <input
                      type={showPwd ? "text" : "password"} required value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="bg-transparent outline-none text-sm w-full"
                    />
                    <button type="button" onClick={() => setShowPwd((s) => !s)}
                            className="text-muted-foreground hover:text-foreground">
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                    {error}
                  </div>
                )}

                <button
                  type="submit" disabled={busy}
                  className="w-full h-11 inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-60 shadow-sm shadow-primary/30 transition"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Sign in <ArrowRight className="h-4 w-4" /></>}
                </button>
              </form>

              <div className="mt-6">
                <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <span className="flex-1 h-px bg-border" /> One-click demo <span className="flex-1 h-px bg-border" />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {roles.map((d) => (
                    <button
                      key={d.role}
                      onClick={() => quickLogin(d.role)}
                      disabled={busy}
                      className="group relative overflow-hidden p-3 border border-border rounded-lg hover:border-primary/50 hover:shadow-sm bg-background transition text-left"
                    >
                      <div className={`h-7 w-7 rounded-md bg-gradient-to-br ${d.color} text-white flex items-center justify-center mb-1.5 shadow-sm`}>
                        <Truck className="h-3.5 w-3.5" />
                      </div>
                      <div className="text-xs font-semibold">{d.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {d.role}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
