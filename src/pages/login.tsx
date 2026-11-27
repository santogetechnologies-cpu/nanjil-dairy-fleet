import { useNavigate, Navigate } from "react-router-dom";
import { useState } from "react";
import { useAuth, REDIRECT_MAP } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import loginHeroBg from "@/assets/login-hero-bg.jpg";
import {
  Mail,
  Lock,
  Loader2,
  ShieldCheck,
  UserCheck,
  Wrench,
  MapPin,
  Eye,
  EyeOff,
  ArrowRight,
  Zap,
  TrendingUp,
  Phone,
} from "lucide-react";
import { motion } from "framer-motion";

const REMEMBER_IDENTIFIER_KEY = "nanjil_remember_identifier";

function LoginPage() {
  const { login, user } = useAuth();
  const nav = useNavigate();

  const [identifier, setIdentifier] = useState<string>(() => {
    try {
      return localStorage.getItem(REMEMBER_IDENTIFIER_KEY) || "";
    } catch {
      return "";
    }
  });
  const [rememberMe, setRememberMe] = useState<boolean>(() => {
    try {
      return Boolean(localStorage.getItem(REMEMBER_IDENTIFIER_KEY));
    } catch {
      return true;
    }
  });
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={REDIRECT_MAP[user.role]} />;

  const isPhoneTyped =
    identifier.trim().length > 0 && !identifier.includes("@") && /^[0-9+\s()-]+$/.test(identifier.trim());
  const canSubmit = !busy && identifier.trim().length > 0 && password.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    try {
      if (rememberMe) {
        localStorage.setItem(REMEMBER_IDENTIFIER_KEY, identifier.trim());
      } else {
        localStorage.removeItem(REMEMBER_IDENTIFIER_KEY);
      }
    } catch {
      // Ignore storage errors
    }

    try {
      const r = await login(identifier, password);
      setBusy(false);
      if (!r.ok) {
        setError(r.error ?? "Invalid login credentials.");
      } else if (r.role) {
        nav(REDIRECT_MAP[r.role as keyof typeof REDIRECT_MAP] || "/dashboard");
      }
    } catch (err: any) {
      setBusy(false);
      setError(err?.message || "Login failed");
    }
  }

  const features = [
    { icon: MapPin, label: "Live GPS Tracking" },
    { icon: UserCheck, label: "Driver Management" },
    { icon: Wrench, label: "Fleet Maintenance" },
  ];

  const stats = [
    { icon: TrendingUp, value: "99.2%", label: "Uptime" },
    { icon: Zap, value: "<200ms", label: "Latency" },
    { icon: ShieldCheck, value: "ISO 27001", label: "Certified" },
  ];

  return (
    <div className="min-h-screen w-full relative overflow-hidden bg-[#eef7eb] flex flex-col lg:flex-row">
      {/* ── Full-Viewport Scenic Background Image ── */}
      <img
        src={loginHeroBg}
        alt="Nanjil Dairy Fleet Sunrise Highway"
        className="absolute inset-0 h-full w-full object-cover object-center select-none pointer-events-none"
      />

      {/* Contrast Scrims for Left Hero Legibility */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(105deg, rgba(6, 26, 48, 0.52) 0%, rgba(10, 42, 66, 0.24) 44%, rgba(255, 255, 255, 0) 70%)",
        }}
      />

      {/* Mobile wash for form legibility */}
      <div className="lg:hidden absolute inset-0 bg-gradient-to-b from-slate-900/35 via-slate-900/20 to-white/60 pointer-events-none z-[1]" />

      {/* ── LEFT HERO COLUMN (Desktop) ── */}
      <div className="hidden lg:flex flex-col justify-between relative z-10 w-[56%] xl:w-[58%] px-10 xl:px-14 py-9 xl:py-11">
        {/* Top Brand Row */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="flex items-center gap-3.5"
        >
          <div className="bg-white rounded-2xl px-3.5 py-2 shadow-lg border border-white/80">
            <Logo className="h-8 w-auto object-contain" />
          </div>
          <div className="leading-tight drop-shadow-xs">
            <div className="text-white font-extrabold text-xl tracking-tight">Nanjil VIP</div>
            <div className="text-white/90 text-xs font-medium tracking-wide">
              Vehicle Intelligence Platform
            </div>
          </div>
        </motion.div>

        {/* Hero Copy + 4 Frosted Glass Feature Tiles */}
        <div className="my-auto pt-4 pb-10 space-y-6 max-w-xl">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
          >
            <h1 className="text-4xl xl:text-[52px] font-extrabold text-white leading-[1.08] tracking-tight drop-shadow-md">
              Drive Smarter.
              <br />
              <span className="text-[#B8F158] relative inline-block">
                Deliver Fresher.
                <svg
                  viewBox="0 0 280 12"
                  className="w-full h-2.5 mt-0.5 text-[#86DF47]/80"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M 2 8 Q 140 1, 278 7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3.2"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </h1>

            <p className="mt-3.5 text-white/95 text-sm xl:text-[15px] max-w-md leading-relaxed font-medium drop-shadow-xs">
              AI-powered fleet management, real-time telemetry, and predictive maintenance — all in one platform.
            </p>
          </motion.div>

          {/* 3-Card Horizontal Feature Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg">
            {features.map((f, idx) => (
              <motion.div
                key={f.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.38, delay: 0.12 + idx * 0.06 }}
                className="rounded-2xl bg-slate-900/35 hover:bg-slate-900/45 border border-white/25 backdrop-blur-md px-3 py-4 text-center shadow-lg transition-all cursor-default"
              >
                <div className="h-10 w-10 mx-auto rounded-full bg-emerald-400/20 border border-emerald-300/35 flex items-center justify-center mb-2.5 text-[#B8F158]">
                  <f.icon className="h-4.5 w-4.5" strokeWidth={2} />
                </div>
                <div className="text-white text-xs font-semibold leading-snug">{f.label}</div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Bottom Stats Bar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="inline-flex items-center gap-6 px-4 py-2.5 rounded-2xl bg-slate-900/55 backdrop-blur-md border border-white/20 shadow-lg w-fit"
        >
          {stats.map((s) => (
            <div key={s.label} className="flex items-center gap-2.5">
              <s.icon className="h-4 w-4 text-[#8CE456] shrink-0" strokeWidth={2.2} />
              <div>
                <div className="text-white text-sm font-extrabold leading-tight">{s.value}</div>
                <div className="text-white/75 text-[11px] font-medium">{s.label}</div>
              </div>
            </div>
          ))}
        </motion.div>
      </div>

      {/* ── RIGHT PANEL (Floating White Login Card) ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 sm:px-10 py-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="w-full max-w-[410px]"
        >
          {/* Floating White Card */}
          <div className="95 backdrop-blur-md rounded-[28px] border border-white shadow-[0_24px_60px_-15px_rgba(12,48,20,0.28)] p-7 sm:p-9">
            {/* Centered Card Header & Nanjil Logo */}
            <div className="text-center mb-6">
              <div className="flex justify-center mb-3.5">
                <Logo className="h-12 w-auto object-contain" />
              </div>
              <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">Welcome Back</h2>
              <p className="mt-1 text-xs sm:text-sm text-slate-500">
                Sign in to your operations workspace
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Identifier Field */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-800 block">Phone Number / Email</label>
                <div className="relative flex items-center">
                  {isPhoneTyped ? (
                    <Phone className="absolute left-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
                  ) : (
                    <Mail className="absolute left-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
                  )}
                  <input
                    autoFocus
                    required
                    type="text"
                    value={identifier}
                    onChange={(e) => {
                      setIdentifier(e.target.value);
                      setError(null);
                    }}
                    placeholder="you@nanjilmilk.com"
                    className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 bg-slate-50/80 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/25 focus:border-emerald-600 transition-all"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-800 block">Password</label>
                <div className="relative flex items-center">
                  <Lock className="absolute left-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
                  <input
                    type={showPwd ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError(null);
                    }}
                    placeholder="Enter your password"
                    className="w-full h-11 pl-10 pr-11 rounded-xl border border-slate-200 bg-slate-50/80 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/25 focus:border-emerald-600 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((s) => !s)}
                    aria-label={showPwd ? "Hide password" : "Show password"}
                    className="absolute right-3.5 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Remember me & Forgot password */}
              <div className="flex items-center justify-between pt-0.5">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-[#167A2E] cursor-pointer"
                  />
                  <span>Remember me</span>
                </label>

                <button
                  type="button"
                  onClick={() =>
                    alert("Please contact your Fleet Administrator to reset your password.")
                  }
                  className="text-xs font-semibold text-[#167A2E] hover:text-[#115E23] hover:underline cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>

              {/* Error Popup */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2"
                >
                  <span className="mt-0.5">⚠</span>
                  <span>{error}</span>
                </motion.div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full h-11 mt-1 rounded-full font-bold text-sm text-white bg-[#167A2E] hover:bg-[#116123] active:bg-[#0D4D1B] focus:outline-none focus:ring-2 focus:ring-emerald-600/40 transition-all shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] font-medium text-black">
              <ShieldCheck className="h-3.5 w-3.5 text-[#000000]" />
              <span>Secure sign in · Nanjil Fleet Operations</span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default LoginPage;
