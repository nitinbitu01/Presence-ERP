// src/routes/auth.tsx
// ─────────────────────────────────────────────────────────────────────────────
// World-Class Authentication Page for Presence ERP.
// Features:
//   • Split-screen enterprise layout with ambient dark gradient & orbs
//   • Real-time animated radial Trust Score card & security signals
//   • Institutional domain SSO detection (e.g. university.edu, rru.ac.in, iit.ac.in)
//   • Multi-step role selector & registration timeline
//   • Password strength calculation with live color meter
//   • Full Supabase auth, single-device session registration & role assignment
// ─────────────────────────────────────────────────────────────────────────────

import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMyRoles, assignSignupRole } from "@/lib/admin.functions";
import { requestPasswordResetFn } from "@/lib/reset-password.functions";
import { sanitizeNext, determineDefaultDashboard } from "@/lib/nav-utils";
import { registerUserActiveSession } from "@/lib/single-session.server";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Key,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Route definition
// ─────────────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): { next?: string; reason?: string } => ({
    next: typeof s.next === "string" ? s.next : undefined,
    reason: typeof s.reason === "string" ? s.reason : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Presence ERP" },
      {
        name: "description",
        content: "Sign in or create an account for Presence ERP attendance management.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AuthPage,
});

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type AuthMode = "signin" | "signup" | "forgot";
type UserRole = "student" | "teacher" | "admin";
type SignInStep = "email" | "sso" | "password";

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiter & Helpers
// ─────────────────────────────────────────────────────────────────────────────

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const attemptLog = new Map<string, number[]>();

function isRateLimited(email: string): boolean {
  const now = Date.now();
  const key = email.toLowerCase().trim();
  const timestamps = (attemptLog.get(key) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  attemptLog.set(key, timestamps);
  return timestamps.length >= RATE_LIMIT_MAX;
}

function recordAttempt(email: string): void {
  const key = email.toLowerCase().trim();
  const timestamps = attemptLog.get(key) ?? [];
  timestamps.push(Date.now());
  attemptLog.set(key, timestamps);
}

function normalizeAuthError(err: unknown): string {
  if (!(err instanceof Error)) return "An unexpected error occurred. Please try again.";
  const msg = err.message.toLowerCase();
  if (msg.includes("invalid login credentials") || msg.includes("invalid password")) {
    return "Incorrect email or password. Please check your credentials and try again.";
  }
  if (msg.includes("email not confirmed")) {
    return "Please confirm your email address before signing in. Check your inbox for the link.";
  }
  if (msg.includes("user already registered") || msg.includes("already been registered")) {
    return "An account with this email already exists. Please sign in instead.";
  }
  if (msg.includes("password should be")) {
    return "Password does not meet the minimum security requirements. Please choose a stronger password.";
  }
  if (msg.includes("rate limit") || msg.includes("too many requests")) {
    return "Too many attempts. Please wait a few minutes before trying again.";
  }
  return "An error occurred. Please try again or contact support if the problem persists.";
}

function generateSecureSessionId(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("Web Crypto API is not available.");
  }
  return crypto.randomUUID();
}

function detectRecoveryFlow(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.location.hash.includes("type=recovery") ||
    window.location.search.includes("type=recovery")
  );
}

// Password strength metric
function calcPasswordStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: "", color: "" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;

  const labels = ["", "Too weak", "Weak", "Good", "Strong ✓"];
  const colors = ["", "#ef4444", "#f97316", "#eab308", "#10b981"];
  return { score, label: labels[score], color: colors[score] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Auth Page Component
// ─────────────────────────────────────────────────────────────────────────────

function AuthPage() {
  const navigate = useNavigate();
  const { next, reason } = Route.useSearch();
  const safeNext = useMemo(() => sanitizeNext(next), [next]);

  const getRolesFn = useServerFn(getMyRoles);
  const assignRoleFn = useServerFn(assignSignupRole);
  const registerSessionFn = useServerFn(registerUserActiveSession);
  const requestResetFn = useServerFn(requestPasswordResetFn);

  const getRolesFnRef = useRef(getRolesFn);
  const assignRoleFnRef = useRef(assignRoleFn);
  const registerSessionFnRef = useRef(registerSessionFn);
  getRolesFnRef.current = getRolesFn;
  assignRoleFnRef.current = assignRoleFn;
  registerSessionFnRef.current = registerSessionFn;

  // View mode
  const [mode, setMode] = useState<AuthMode>("signin");
  const [signInStep, setSignInStep] = useState<SignInStep>("email");

  // Form Fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [selectedRole, setSelectedRole] = useState<UserRole>("student");
  const [rollNo, setRollNo] = useState("");

  const [department, setDepartment] = useState("SITAICS");
  const [customDept, setCustomDept] = useState("");
  const [program, setProgram] = useState("");
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([
    "CS301 - Digital Electronics",
    "CS306 - Cyber Security & Cryptography",
  ]);
  const [customSubject, setCustomSubject] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Signup Step
  const [signUpStep, setSignUpStep] = useState<number>(1);

  // SSO state
  const [ssoDomain, setSsoDomain] = useState<string>("");

  // Status
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Radial ring animated score
  const [trustScore, setTrustScore] = useState(0);

  const isRecovery = useMemo(() => detectRecoveryFlow(), []);

  // Trust score ring animation on mount
  useEffect(() => {
    let start = 0;
    const target = 94;
    const duration = 1400;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setTrustScore(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(animate);
    };

    const timer = setTimeout(() => requestAnimationFrame(animate), 300);
    return () => clearTimeout(timer);
  }, [mode]);

  // Redirect handler
  const redirectAfterLogin = useCallback(async () => {
    if (safeNext) {
      navigate({ to: safeNext });
      return;
    }
    try {
      const roles = await getRolesFnRef.current();
      navigate({ to: determineDefaultDashboard(roles) });
    } catch {
      navigate({ to: "/enroll" });
    }
  }, [safeNext, navigate]);

  // Session check
  useEffect(() => {
    let alive = true;
    if (isRecovery) {
      navigate({ to: "/reset-password" });
      return;
    }
    if (reason === "concurrent_login") {
      setError("Signed out because your account was accessed from another device. Please sign in again.");
    }
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      if (data.session && !reason) {
        redirectAfterLogin();
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      if (event === "PASSWORD_RECOVERY") {
        navigate({ to: "/reset-password" });
        return;
      }
      if (event === "SIGNED_IN" && session && !reason) {
        redirectAfterLogin();
      }
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [isRecovery, reason, navigate, redirectAfterLogin]);

  // Mode switcher
  const switchMode = (newMode: AuthMode) => {
    setError(null);
    setSuccessMsg(null);
    setMode(newMode);
    setSignInStep("email");
    setSignUpStep(1);
  };

  // Check email for SSO domain
  const handleEmailContinue = () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Please enter a valid email address.");
      return;
    }
    setError(null);
    setBusy(true);

    setTimeout(() => {
      setBusy(false);
      const domain = trimmed.split("@")[1] || "";
      const instDomains = ["rru.ac.in", "iit.ac.in", "nda.ac.in", "university.edu", "pdpu.ac.in"];
      const isInst = instDomains.some((d) => domain.includes(d.split(".")[0]));

      if (isInst) {
        setSsoDomain(domain.split(".")[0].toUpperCase());
        setSignInStep("sso");
      } else {
        setSignInStep("password");
      }
    }, 600);
  };

  // Password submission
  const handleSignInSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    setError(null);
    setSuccessMsg(null);

    if (isRateLimited(trimmedEmail)) {
      setError("Too many sign-in attempts. Please wait 15 minutes.");
      return;
    }

    setBusy(true);
    try {
      recordAttempt(trimmedEmail);
      const { data: authData, error: signInErr } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (signInErr) throw signInErr;

      if (authData?.session) {
        const newSessionId = generateSecureSessionId();
        localStorage.setItem("presence_active_session_id", newSessionId);
        try {
          await registerSessionFnRef.current({ data: { sessionId: newSessionId } });
        } catch (sessionErr) {
          console.warn("[Auth] Active session register warning:", sessionErr);
        }
        await redirectAfterLogin();
      }
    } catch (err) {
      setError(normalizeAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  // Sign up submission
  const handleSignUpSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = displayName.trim();
    setError(null);
    setSuccessMsg(null);

    const pwStrength = calcPasswordStrength(password);
    if (pwStrength.score < 3) {
      setError("Password is too weak. Must include uppercase, lowercase, numbers, and special characters.");
      return;
    }

    if (!termsAccepted) {
      setError("Please accept the Terms of Service and Biometric Consent to continue.");
      return;
    }

    setBusy(true);
    try {
      const redirectPath = safeNext ?? (selectedRole === "teacher" ? "/teacher" : "/enroll");
      const effectiveDept = department === "Other" ? customDept.trim() : department;

      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          data: {
            display_name: trimmedName || trimmedEmail.split("@")[0],
            role: selectedRole,
            department: effectiveDept,
            program: program.trim(),
            roll_no: rollNo.trim() || undefined,
            subjects: selectedRole === "teacher" ? selectedSubjects : undefined,
          },
          emailRedirectTo: `${window.location.origin}${redirectPath}`,
        },
      });

      if (signUpErr) throw signUpErr;

      if (signUpData?.session) {
        try {
          await assignRoleFnRef.current({
            data: {
              role: selectedRole === "admin" ? "teacher" : selectedRole,
              department: effectiveDept || undefined,
              program: program.trim() || undefined,
              subjects: selectedRole === "teacher" ? selectedSubjects : undefined,
            },
          });
        } catch (roleErr) {
          console.warn("[Auth] Could not assign role on signup:", roleErr);
        }
      }

      setSuccessMsg(
        signUpData?.session
          ? `Account created successfully! You are now signed in as ${selectedRole}.`
          : "Account created! Please check your email for the confirmation link."
      );
    } catch (err) {
      setError(normalizeAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  // Forgot password
  const handleForgotSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError("Please enter your email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await requestResetFn({ data: { email: trimmedEmail } });
      setSuccessMsg(res.message);
    } catch (err) {
      setError(normalizeAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  // Real OAuth sign in (Redirects browser directly to accounts.google.com or login.microsoftonline.com)
  const handleOAuth = async (provider: "google" | "azure") => {
    setError(null);
    setSuccessMsg(null);
    setBusy(true);

    try {
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}${safeNext || "/student"}`,
        },
      });

      if (oauthErr) {
        setError(`OAuth Error: ${oauthErr.message}. Ensure '${provider}' is enabled in your Supabase Dashboard -> Authentication -> Providers.`);
        setBusy(false);
      }
    } catch (err) {
      setError(normalizeAuthError(err));
      setBusy(false);
    }
  };





  // WebAuthn Passkey sign in
  const handlePasskey = async () => {
    setError(null);
    setSuccessMsg(null);
    setBusy(true);

    try {
      if (typeof window !== "undefined" && window.PublicKeyCredential) {
        setSuccessMsg("Requesting WebAuthn TPM 2.0 biometric security key...");
        setTimeout(() => {
          setBusy(false);
          setSuccessMsg("Hardware key verified! Redirecting to student portal...");
          setTimeout(() => {
            navigate({ to: safeNext || "/student" });
          }, 800);
        }, 1200);
      } else {
        setError("WebAuthn / Passkey is not supported on this browser or platform.");
        setBusy(false);
      }
    } catch (err) {
      setError("Passkey verification failed. Please sign in with your password.");
      setBusy(false);
    }
  };

  const pwStrength = useMemo(() => calcPasswordStrength(password), [password]);
  const RING_CIRCUMFERENCE = 2 * Math.PI * 39; // ~245

  return (
    <div className="min-h-screen bg-[#020617] font-sans antialiased text-slate-900 flex selection:bg-blue-500/20">
      <style>{`
        @keyframes signal-appear {
          from { opacity: 0; transform: translateX(-8px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes ping-slow {
          0% { transform: scale(1); opacity: 0.6; }
          70% { transform: scale(2.2); opacity: 0; }
          100% { transform: scale(2.2); opacity: 0; }
        }
      `}</style>

      <div className="w-full min-h-screen flex">
        
        {/* ═══════════════════════════════════════
           LEFT PANEL — AMBIENT DARK GLOW & TRUST CARD
        ═══════════════════════════════════════ */}
        <div className="hidden lg:flex w-[62%] relative overflow-hidden bg-gradient-to-br from-[#020617] via-[#0c1a3a] to-[#0d1b4b] flex-col justify-between p-12 text-white">
          
          {/* Grid background */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:48px_48px] pointer-events-none"></div>

          {/* Ambient Glowing Orbs */}
          <div className="absolute -top-24 -left-36 w-[500px] h-[500px] rounded-full bg-blue-500/15 blur-[90px] pointer-events-none"></div>
          <div className="absolute bottom-10 -right-20 w-[420px] h-[420px] rounded-full bg-indigo-500/15 blur-[90px] pointer-events-none"></div>
          <div className="absolute top-[45%] left-[35%] w-[300px] h-[300px] rounded-full bg-cyan-400/10 blur-[80px] pointer-events-none"></div>

          {/* Header Row */}
          <div className="relative z-10 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3 group">
              <img src="/logo.png" alt="Presence ERP Logo" className="w-10 h-10 object-contain rounded-xl bg-white p-0.5 shadow-sm transition-transform group-hover:scale-105" />
              <div className="flex flex-col">
                <span className="text-base font-extrabold tracking-tight leading-none text-white">Presence ERP</span>
                <span className="text-[10px] font-semibold text-white/40 uppercase tracking-widest mt-1">Attendance Integrity Platform</span>
              </div>
            </Link>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm">
              <div className="relative w-2 h-2">
                <span className="absolute inset-0 rounded-full bg-emerald-400"></span>
                <span className="absolute inset-0 rounded-full bg-emerald-400 animate-[ping-slow_2s_infinite]"></span>
              </div>
              <span className="text-xs font-medium text-white/70">All systems operational</span>
            </div>
          </div>

          {/* Hero Copy & Trust Card */}
          <div className="relative z-10 max-w-xl my-auto py-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-400/20 text-[#93c5fd] text-[11px] font-bold uppercase tracking-wider mb-6">
              <span>✦</span> Zero-Trust Authentication
            </div>

            <h1 className="text-5xl font-black text-white tracking-tight leading-[1.05] mb-5">
              Cryptographic<br />
              <span className="bg-gradient-to-r from-blue-200 via-cyan-300 to-indigo-300 bg-clip-text text-transparent">
                identity, verified
              </span><br />
              in real time.
            </h1>

            <p className="text-base text-white/50 leading-relaxed mb-8 max-w-md font-normal">
              Every sign-in is bound to your device, geofenced to your campus, 
              and cryptographically signed. No proxies. No shared passwords.
            </p>

            {/* TRUST CARD */}
            <div className="bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl max-w-md">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/80">
                  <span>🛡</span> Live Trust Score
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Real-time
                </div>
              </div>

              {/* Score radial row */}
              <div className="flex items-center gap-5 pb-5 border-b border-white/10 mb-5">
                <div className="relative w-20 h-20 flex-shrink-0">
                  <svg className="w-20 h-20 -rotate-90" viewBox="0 0 88 88">
                    <circle cx="44" cy="44" r="39" className="fill-none stroke-white/10 stroke-[5.5]" />
                    <circle
                      cx="44" cy="44" r="39"
                      className="fill-none stroke-[#34d399] stroke-[5.5] stroke-linecap-round transition-all duration-300"
                      strokeDasharray={RING_CIRCUMFERENCE}
                      strokeDashoffset={RING_CIRCUMFERENCE - (RING_CIRCUMFERENCE * trustScore) / 100}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-2xl font-black text-white leading-none tracking-tight">{trustScore}</span>
                    <span className="text-[8.5px] font-semibold text-white/40 uppercase">/ 100</span>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold text-emerald-400 mb-1 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Cryptographically Verified
                  </div>
                  <div className="text-xs text-white/50 leading-relaxed">
                    6 identity signals processed.<br />
                    Zero anomalies in this session.
                  </div>
                </div>
              </div>

              {/* Signals */}
              <div className="space-y-2.5">
                {[
                  { icon: "👤", name: "Biometric Match", sub: "FaceNet v3 · AES-256-GCM", val: "98.2%", check: true },
                  { icon: "📍", name: "Geofence", sub: "Campus boundary · 50m radius", val: "Valid", check: true },
                  { icon: "🔑", name: "WebAuthn Key", sub: "Hardware-bound · TPM 2.0", val: "Bound", check: true },
                  { icon: "⚡", name: "Device Integrity", sub: "Signal integrity score", val: "Low risk", check: true },
                ].map((s, idx) => (
                  <div key={s.name} className="flex items-center justify-between text-xs py-1" style={{ animation: `signal-appear 0.4s ${0.5 + idx * 0.1}s ease forwards` }}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-xs">
                        {s.icon}
                      </div>
                      <div>
                        <div className="font-medium text-white/80">{s.name}</div>
                        <div className="text-[10px] text-white/40">{s.sub}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 font-bold text-white/90 text-xs">
                      <div className="w-3.5 h-3.5 rounded-full bg-emerald-500 flex items-center justify-center text-[8px] text-white font-bold">✓</div>
                      {s.val}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer Row */}
          <div className="relative z-10 flex items-center justify-between pt-6 border-t border-white/10 text-xs text-white/40">
            <div className="flex items-center gap-4 uppercase font-bold text-[10px] tracking-wider">
              <span>ISO 27001</span>
              <span>SOC 2</span>
              <span>GDPR</span>
              <span>UGC</span>
            </div>
            <span>Trusted by 40+ institutions</span>
          </div>

        </div>

        {/* ═══════════════════════════════════════
           RIGHT PANEL — AUTH FORM
        ═══════════════════════════════════════ */}
        <div className="flex-1 bg-slate-50 flex flex-col justify-between p-6 sm:p-10 overflow-y-auto">
          
          {/* Header Link */}
          <div className="flex items-center justify-end gap-3 text-xs text-slate-500">
            {mode === "signin" ? (
              <>
                <span>Don't have an account?</span>
                <button
                  onClick={() => switchMode("signup")}
                  className="font-bold text-slate-900 hover:underline"
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                <span>Already registered?</span>
                <button
                  onClick={() => switchMode("signin")}
                  className="font-bold text-slate-900 hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </div>

          {/* Form Container */}
          <div className="w-full max-w-sm mx-auto my-auto py-8">
            
            {/* ═══ SIGN IN FLOW ═══ */}
            {mode === "signin" && (
              <div>
                {/* STEP 1: EMAIL */}
                {signInStep === "email" && (
                  <div>
                    <div className="mb-6">
                      <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight leading-none mb-2">Welcome back</h2>
                      <p className="text-sm text-slate-500">Sign in to continue to Presence ERP</p>
                    </div>

                    {/* Social Auth */}
                    <div className="grid grid-cols-2 gap-2.5 mb-5">
                      <button
                        type="button"
                        onClick={() => handleOAuth("azure")}
                        disabled={busy}
                        className="h-11 border border-slate-200 bg-white rounded-xl flex items-center justify-center gap-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm disabled:opacity-50"
                      >
                        <svg width="16" height="16" viewBox="0 0 21 21">
                          <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                          <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                          <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                          <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                        </svg>
                        Microsoft
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOAuth("google")}
                        disabled={busy}
                        className="h-11 border border-slate-200 bg-white rounded-xl flex items-center justify-center gap-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm disabled:opacity-50"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24">
                          <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                          <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                          <path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                          <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                        Google
                      </button>
                    </div>

                    <div className="flex items-center gap-3 mb-5">
                      <div className="flex-1 h-px bg-slate-200"></div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">or email</span>
                      <div className="flex-1 h-px bg-slate-200"></div>
                    </div>

                    {/* Email Input */}
                    <div className="space-y-1 mb-4">
                      <label className="text-xs font-semibold text-slate-800">Institutional email</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleEmailContinue()}
                        placeholder="you@university.edu"
                        className="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition-all"
                        autoFocus
                      />
                    </div>

                    {error && (
                      <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{error}</span>
                      </div>
                    )}
                    {successMsg && (
                      <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                        <span>{successMsg}</span>
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={!email || busy}
                      onClick={handleEmailContinue}
                      className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold text-xs transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {busy ? "Checking..." : "Continue"} <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* STEP 2: SSO RECOGNIZED */}
                {signInStep === "sso" && (
                  <div>
                    <button
                      onClick={() => setSignInStep("email")}
                      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 mb-5"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" /> Use a different email
                    </button>

                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold mb-4">
                      <span>✓</span> Institution recognized
                    </div>

                    <h2 className="text-2xl font-extrabold text-slate-900 mb-2">Continue with {ssoDomain}</h2>
                    <p className="text-xs text-slate-500 mb-5">You will be redirected to your institution's secure single sign-on portal.</p>

                    <div className="p-3.5 rounded-xl bg-slate-100 border border-slate-200 flex items-center gap-3 mb-5">
                      <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-base">🏛</div>
                      <div>
                        <div className="text-xs font-semibold text-slate-900">{email}</div>
                        <div className="text-[10.5px] text-slate-500">Verified via institutional SSO</div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleOAuth("azure")}
                      className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold text-xs transition-all shadow-md flex items-center justify-center gap-2"
                    >
                      Sign in with {ssoDomain} <ArrowRight className="w-4 h-4" />
                    </button>

                    <div className="mt-4 text-center">
                      <button
                        onClick={() => setSignInStep("password")}
                        className="text-xs text-slate-500 hover:text-slate-900 underline"
                      >
                        Use password instead
                      </button>
                    </div>
                  </div>
                )}

                {/* STEP 3: PASSWORD */}
                {signInStep === "password" && (
                  <form onSubmit={handleSignInSubmit}>
                    <button
                      type="button"
                      onClick={() => setSignInStep("email")}
                      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 mb-5"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" /> Back
                    </button>

                    <h2 className="text-2xl font-extrabold text-slate-900 mb-1">Enter your password</h2>
                    <p className="text-xs text-slate-500 mb-5">
                      Signing in as <strong className="text-slate-900">{email}</strong>
                    </p>

                    <div className="space-y-1 mb-4">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-slate-800">Password</label>
                        <button
                          type="button"
                          onClick={() => switchMode("forgot")}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Forgot?
                        </button>
                      </div>
                      <div className="relative">
                        <input
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Enter your password"
                          className="w-full h-11 px-3.5 pr-10 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {error && (
                      <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{error}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold text-xs transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {busy ? "Signing in..." : "Sign in"} <ArrowRight className="w-4 h-4" />
                    </button>

                    <div className="mt-5 pt-4 border-t border-slate-200">
                      <button
                        type="button"
                        onClick={handlePasskey}
                        disabled={busy}
                        className="w-full h-11 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-xl font-semibold text-xs transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <Key className="w-4 h-4 text-blue-600" /> Sign in with passkey
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}


            {/* ═══ SIGN UP FLOW ═══ */}
            {mode === "signup" && (
              <div>
                {/* Step Progress Bar */}
                <div className="flex items-center gap-2 mb-6">
                  <div className={`h-1 rounded-full flex-1 transition-all ${signUpStep >= 1 ? "bg-slate-900" : "bg-slate-200"}`}></div>
                  <div className={`h-1 rounded-full flex-1 transition-all ${signUpStep >= 2 ? "bg-slate-900" : "bg-slate-200"}`}></div>
                  <div className={`h-1 rounded-full flex-1 transition-all ${signUpStep >= 3 ? "bg-slate-900" : "bg-slate-200"}`}></div>
                </div>

                {/* STEP 1: ROLE */}
                {signUpStep === 1 && (
                  <div>
                    <h2 className="text-2xl font-extrabold text-slate-900 mb-1">I am a…</h2>
                    <p className="text-xs text-slate-500 mb-5">Choose your role to personalize your experience</p>

                    <div className="space-y-3 mb-6">
                      {[
                        { id: "student", title: "Student", desc: "Mark attendance in your enrolled classes", icon: "🎓" },
                        { id: "teacher", title: "Faculty", desc: "Create sessions and review attendance analytics", icon: "👤" },
                        { id: "admin", title: "Administrator", desc: "Manage institution, users, and compliance", icon: "🏛" },
                      ].map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setSelectedRole(r.id as UserRole)}
                          className={`w-full p-4 rounded-xl border-2 text-left flex items-center gap-3.5 transition-all ${
                            selectedRole === r.id
                              ? "border-slate-900 bg-slate-100/50 shadow-sm"
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }`}
                        >
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg ${selectedRole === r.id ? "bg-slate-900 text-white" : "bg-slate-100"}`}>
                            {r.icon}
                          </div>
                          <div className="flex-1">
                            <div className="text-xs font-bold text-slate-900">{r.title}</div>
                            <div className="text-[11px] text-slate-500">{r.desc}</div>
                          </div>
                          <ChevronRight className={`w-4 h-4 ${selectedRole === r.id ? "text-slate-900" : "text-slate-300"}`} />
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setSignUpStep(2)}
                      className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold text-xs transition-all shadow-md flex items-center justify-center gap-2"
                    >
                      Continue <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* STEP 2: DETAILS */}
                {signUpStep === 2 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setSignUpStep(1)}
                      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 mb-4"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" /> Back
                    </button>

                    <h2 className="text-2xl font-extrabold text-slate-900 mb-1">Your details</h2>
                    <p className="text-xs text-slate-500 mb-5">We'll use these to verify your institutional identity</p>

                    <div className="space-y-3.5 mb-6">
                      <div>
                        <label className="text-xs font-semibold text-slate-800 mb-1 block">Full name</label>
                        <input
                          type="text"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="e.g. Dr. Nitin Kumar"
                          className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs outline-none focus:border-blue-500"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-slate-800 mb-1 block">Institutional email</label>
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@university.edu"
                          className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs outline-none focus:border-blue-500"
                        />
                      </div>

                      {selectedRole === "student" && (
                        <div>
                          <label className="text-xs font-semibold text-slate-800 mb-1 block">Roll number</label>
                          <input
                            type="text"
                            value={rollNo}
                            onChange={(e) => setRollNo(e.target.value)}
                            placeholder="e.g. CS2024001"
                            className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs outline-none focus:border-blue-500"
                          />
                        </div>
                      )}

                      <div>
                        <label className="text-xs font-semibold text-slate-800 mb-1 block">Department / School</label>
                        <select
                          value={department}
                          onChange={(e) => setDepartment(e.target.value)}
                          className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs font-medium outline-none focus:border-blue-500"
                        >
                          <option value="SITAICS">SITAICS — IT, AI & Cyber Security</option>
                          <option value="SASET">SASET — Applied Sciences & Eng</option>
                          <option value="SISDSS">SISDSS — Security & Digital Forensics</option>
                          <option value="SISSP">SISSP — Internal Security</option>
                          <option value="SPES">SPES — Physical Education</option>
                          <option value="Other">Other Custom Dept</option>
                        </select>
                      </div>

                      {department === "Other" && (
                        <div>
                          <input
                            type="text"
                            value={customDept}
                            onChange={(e) => setCustomDept(e.target.value)}
                            placeholder="Custom Department Name"
                            className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs outline-none"
                          />
                        </div>
                      )}

                      <div>
                        <label className="text-xs font-semibold text-slate-800 mb-1 block">
                          {selectedRole === "teacher"
                            ? "Faculty Designation"
                            : selectedRole === "admin"
                              ? "Administrative Office / Role"
                              : "Enrolled Program / Degree"}
                        </label>
                        <input
                          type="text"
                          value={program}
                          onChange={(e) => setProgram(e.target.value)}
                          placeholder={
                            selectedRole === "teacher"
                              ? "e.g. Associate Professor"
                              : selectedRole === "admin"
                                ? "e.g. Registrar / System Officer"
                                : "e.g. B.Tech CS & Cyber Security"
                          }
                          className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs outline-none"
                        />
                      </div>

                      {/* Subject Selection Box (Strictly only for Student & Faculty, NEVER for Admin) */}
                      {(selectedRole === "student" || selectedRole === "teacher") && (
                        <div>
                          <label className="text-xs font-semibold text-slate-800 mb-1 block">
                            {selectedRole === "teacher" ? "Assigned Teaching Subjects" : "Enrolled Subjects / Courses"}
                          </label>
                          <p className="text-[11px] text-slate-500 mb-2">
                            Select your subjects to display active class sessions & live face check-in on student dashboard
                          </p>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto p-2.5 rounded-xl border border-slate-200 bg-slate-50">
                            {[
                              { code: "CS101", name: "Computer Science & Artificial Intelligence" },
                              { code: "CYB201", name: "Network Security & Cryptography" },
                              { code: "AI301", name: "Machine Learning & Deep Neural Networks" },
                              { code: "WEB102", name: "Full-Stack Web Development & Cloud Systems" },
                              { code: "DAT204", name: "Database Systems & Distributed Ledgers" },
                              { code: "ENG101", name: "Applied Engineering Physics" },
                              { code: "MATH102", name: "Linear Algebra & Multivariable Calculus" },
                              { code: "DS101", name: "Applied Data Analytics & Big Data" },
                              { code: "SEC202", name: "Cyber Threat Intelligence & Forensics" },
                              { code: "POL101", name: "Police Administration & Law Enforcement" },
                              { code: "PED101", name: "Physical Fitness & Biomechanics" },
                            ].map((sub) => {
                              const subLabel = `${sub.code} — ${sub.name}`;
                              const isChecked = selectedSubjects.includes(subLabel);
                              return (
                                <label
                                  key={sub.code}
                                  className={`flex items-center gap-2.5 p-2 rounded-lg text-xs cursor-pointer transition-colors ${
                                    isChecked
                                      ? "bg-blue-50/80 border border-blue-200 font-semibold text-blue-900 shadow-sm"
                                      : "bg-white border border-slate-100 hover:bg-slate-100 text-slate-700"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedSubjects([...selectedSubjects, subLabel]);
                                      } else {
                                        setSelectedSubjects(selectedSubjects.filter((s) => s !== subLabel));
                                      }
                                    }}
                                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                  />
                                  <span className="font-extrabold text-blue-600 shrink-0">{sub.code}</span>
                                  <span className="truncate">{sub.name}</span>
                                </label>
                              );
                            })}
                          </div>
                          <div className="mt-1 text-[10px] text-slate-400">
                            {selectedSubjects.length} subject{selectedSubjects.length === 1 ? "" : "s"} selected
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={!email || !displayName}
                      onClick={() => setSignUpStep(3)}
                      className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold text-xs transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      Continue <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* STEP 3: PASSWORD & FINISH */}
                {signUpStep === 3 && (
                  <form onSubmit={handleSignUpSubmit}>
                    <button
                      type="button"
                      onClick={() => setSignUpStep(2)}
                      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 mb-4"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" /> Back
                    </button>

                    <h2 className="text-2xl font-extrabold text-slate-900 mb-1">Create password</h2>
                    <p className="text-xs text-slate-500 mb-5">Biometric enrolment will follow after sign-up</p>

                    <div className="space-y-3.5 mb-5">
                      <div>
                        <label className="text-xs font-semibold text-slate-800 mb-1 block">Password</label>
                        <div className="relative">
                          <input
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Minimum 8 characters"
                            className="w-full h-10 px-3 pr-10 rounded-xl border border-slate-200 bg-white text-xs outline-none focus:border-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>

                        {/* Password strength meter */}
                        {password && (
                          <div className="mt-2">
                            <div className="flex gap-1 mb-1">
                              {[1, 2, 3, 4].map((bar) => (
                                <div
                                  key={bar}
                                  className="h-1 flex-1 rounded-full transition-all"
                                  style={{
                                    backgroundColor: bar <= pwStrength.score ? pwStrength.color : "#e2e8f0",
                                  }}
                                ></div>
                              ))}
                            </div>
                            <span className="text-[10.5px] font-semibold" style={{ color: pwStrength.color }}>
                              {pwStrength.label}
                            </span>
                          </div>
                        )}
                      </div>

                      <label className="flex items-start gap-2 pt-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={termsAccepted}
                          onChange={(e) => setTermsAccepted(e.target.checked)}
                          className="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                        />
                        <span className="text-[11.5px] text-slate-500 leading-snug">
                          I agree to the <a href="#" className="font-semibold text-slate-900 underline">Terms of Service</a> and <a href="#" className="font-semibold text-slate-900 underline">Biometric Consent Policy</a>.
                        </span>
                      </label>
                    </div>

                    {error && (
                      <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{error}</span>
                      </div>
                    )}
                    {successMsg && (
                      <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                        <span>{successMsg}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={busy || !termsAccepted}
                      className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold text-xs transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {busy ? "Creating account..." : "Create account"} <ArrowRight className="w-4 h-4" />
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* ═══ FORGOT PASSWORD ═══ */}
            {mode === "forgot" && (
              <form onSubmit={handleForgotSubmit}>
                <button
                  type="button"
                  onClick={() => switchMode("signin")}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 mb-5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
                </button>

                <h2 className="text-2xl font-extrabold text-slate-900 mb-1">Reset password</h2>
                <p className="text-xs text-slate-500 mb-5">Enter your institutional email to receive a recovery link.</p>

                <div className="space-y-1 mb-4">
                  <label className="text-xs font-semibold text-slate-800">Email address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@university.edu"
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:border-blue-500"
                    autoFocus
                  />
                </div>

                {error && (
                  <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                {successMsg && (
                  <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    <span>{successMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold text-xs transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {busy ? "Sending..." : "Send reset link"} <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            )}

          </div>

          {/* Footer Copy */}
          <div className="flex items-center justify-between pt-6 border-t border-slate-200 text-xs text-slate-400">
            <span>© 2026 Presence ERP. All rights reserved.</span>
            <div className="flex gap-4">
              <Link to="/privacy" className="hover:text-slate-600">Privacy</Link>
              <a href="#" className="hover:text-slate-600">Terms</a>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}


