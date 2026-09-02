import { useNavigate, Navigate } from "react-router-dom";
import { useState } from "react";
import { useAuth, REDIRECT_MAP } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import {
  Mail, Lock, Loader2, Shield, Wrench, Fuel, MapPin,
  Eye, EyeOff, ArrowRight, Zap, TrendingUp, Phone
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

function LoginPage() {
  const { login, loginWithPhone, user } = useAuth();
  const nav = useNavigate();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={REDIRECT_MAP[user.role]} />;

  const isEmail = identifier.includes("@");
  const isPhoneOrDriver = !isEmail && identifier.trim().length > 0;
  const showPasswordField = isEmail || isPhoneOrDriver;

  const canSubmit =
    !busy &&
    identifier.trim().length > 0 &&
    showPasswordField &&
    password.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (isPhoneOrDriver) {
        const r = await loginWithPhone(identifier, password);
        setBusy(false);
        if (!r.ok) setError(r.error ?? "Driver login failed");
        else nav("/driver");
      } else {
        const r = await login(identifier, password);
        setBusy(false);
        if (!r.ok) setError(r.error ?? "Login failed");
        else if (r.role) nav(REDIRECT_MAP[r.role as keyof typeof REDIRECT_MAP]);
      }
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
    },
    {
      icon: Fuel,
      label: "Fuel Intelligence",
      desc: "AI-powered theft detection & consumption analytics",
    },
    {
      icon: Shield,
      label: "Driver Management",
      desc: "Behaviour scoring & incident prevention",
    },
    {
      icon: Wrench,
      label: "Fleet Maintenance",
      desc: "Preventative service schedules & automated alerts",
    },
  ];

  const stats = [
    { icon: TrendingUp, value: "99.2%", label: "Uptime" },
    { icon: Zap, value: "<200ms", label: "Latency" },
    { icon: Shield, value: "ISO 27001", label: "Certified" },
  ];

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#f4f6f9] relative flex">

      {/* ── LEFT PANEL (Dark Blue Branding) ────────────────────── */}
      <div className="hidden lg:flex flex-col relative w-[52%] xl:w-[55%] overflow-hidden bg-[#071330]">
        {/* Subtle mesh background */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#091b47] via-[#071330] to-[#040a1c]" />

        {/* Ambient glow effects */}
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/15 blur-[90px] pointer-events-none" />
        <div className="absolute bottom-[-5%] right-[-5%] w-[45%] h-[45%] rounded-full bg-indigo-500/10 blur-[90px] pointer-events-none" />

        <div className="relative flex flex-col h-full px-12 xl:px-16 py-12 justify-between z-10">
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex items-center gap-3"
          >
            <div className="bg-white/10 backdrop-blur-md border border-white/15 rounded-2xl p-2.5 shadow-lg">
              <Logo className="h-10" />
            </div>
            <div className="leading-tight">
              <div className="text-white font-bold text-lg tracking-tight">Nanjil VIP</div>
              <div className="text-white/60 text-xs font-medium tracking-wide">Vehicle Intelligence Platform</div>
            </div>
          </motion.div>

          {/* Main Hero Section */}
          <div className="flex-1 flex flex-col justify-center gap-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.08 }}
            >
              <h1 className="text-4xl xl:text-5xl font-bold text-white leading-[1.15] tracking-tight">
                Drive smarter.<br />
                <span className="bg-gradient-to-r from-cyan-300 via-sky-300 to-indigo-300 bg-clip-text text-transparent">
                  Deliver faster.
                </span>
              </h1>
              <p className="mt-4 text-white/60 text-sm max-w-md leading-relaxed">
                AI-powered fleet management, real-time telemetry, and predictive maintenance — all in one platform.
              </p>
            </motion.div>

            {/* Feature Cards Grid */}
            <div className="grid grid-cols-2 gap-3.5 max-w-md">
              {features.map((f, idx) => (
                <motion.div
                  key={f.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.15 + idx * 0.07 }}
                  className="bg-white/5 border border-white/10 backdrop-blur-md rounded-2xl p-4 hover:bg-white/8 transition-all cursor-default"
                >
                  <div className="h-9 w-9 rounded-xl bg-white/10 flex items-center justify-center mb-3 text-cyan-300">
                    <f.icon className="h-4.5 w-4.5" strokeWidth={2} />
                  </div>
                  <div className="text-white/90 text-xs font-semibold leading-tight">{f.label}</div>
                  <div className="text-white/45 text-[10px] mt-1 leading-relaxed">{f.desc}</div>
                </motion.div>
              ))}
            </div>

            {/* Bottom Stats */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="flex items-center gap-6"
            >
              {stats.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <s.icon className="h-3.5 w-3.5 text-cyan-400/70" />
                  <div>
                    <div className="text-white/90 text-sm font-bold">{s.value}</div>
                    <div className="text-white/40 text-[10px]">{s.label}</div>
                  </div>
                </div>
              ))}
            </motion.div>
          </div>

          {/* Footer copyright */}
          <div className="text-white/30 text-[11px]">
            © {new Date().getFullYear()} Nanjil Integrated Dairy Development
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL (Light Background Card) ─────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 sm:px-10 relative">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="w-full max-w-[420px] relative z-10"
        >
          {/* Mobile Logo Header */}
          <div className="lg:hidden mb-8 flex flex-col items-center gap-2 text-center">
            <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-md">
              <Logo className="h-10" />
            </div>
            <div>
              <div className="font-bold text-lg text-slate-800 tracking-tight">Nanjil VIP</div>
              <div className="text-slate-500 text-xs">Vehicle Intelligence Platform</div>
            </div>
          </div>

          {/* Main Card */}
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xl shadow-slate-200/50 p-8 sm:p-9">
            <div className="mb-7">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h2>
              <p className="mt-1 text-xs sm:text-sm text-slate-500">
                Sign in to your operations workspace
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Identifier Field */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  {isEmail ? "EMAIL ADDRESS" : isPhoneOrDriver ? "PHONE NUMBER / DRIVER NAME" : "PHONE NUMBER / EMAIL"}
                </label>
                <div className="relative flex items-center">
                  {isEmail ? (
                    <Mail className="absolute left-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
                  ) : (
                    <Phone className="absolute left-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
                  )}
                  <input
                    autoFocus
                    required
                    type="text"
                    value={identifier}
                    onChange={(e) => { setIdentifier(e.target.value); setError(null); }}
                    placeholder="you@nanjilmilk.com"
                    className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 bg-slate-50/50 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600 transition-all"
                  />
                </div>
              </div>

              {/* Password Field */}
              <AnimatePresence>
                {showPasswordField && (
                  <motion.div
                    key="password-field"
                    initial={{ opacity: 0, height: 0, y: -6 }}
                    animate={{ opacity: 1, height: "auto", y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-1.5 overflow-hidden"
                  >
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        PASSWORD
                      </label>
                      <button
                        type="button"
                        onClick={() => alert("Please contact your Fleet Administrator to reset your password.")}
                        className="text-[11px] font-medium text-blue-600 hover:text-blue-700 hover:underline"
                      >
                        Forgot password?
                      </button>
                    </div>

                    <div className="relative flex items-center">
                      <Lock className="absolute left-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
                      <input
                        type={showPwd ? "text" : "password"}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full h-11 pl-10 pr-11 rounded-xl border border-slate-200 bg-slate-50/50 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600 transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwd((s) => !s)}
                        className="absolute right-3.5 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Error Popup */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2"
                >
                  <span className="mt-0.5">⚠</span>
                  <span>{error}</span>
                </motion.div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full h-11 mt-2 rounded-xl font-semibold text-sm text-white bg-[#0038b8] hover:bg-[#002f9c] active:bg-[#002782] focus:outline-none focus:ring-2 focus:ring-blue-600/40 transition-all shadow-md shadow-blue-900/10 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <span>Sign in</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-4 text-center text-[11px] text-slate-400">
              Secure sign in · Nanjil Fleet Operations
            </p>
          </div>

          <p className="mt-5 text-center text-xs text-slate-400">
            v1.4.2 · All rights reserved
          </p>
        </motion.div>
      </div>
    </div>
  );
}

export default LoginPage;
