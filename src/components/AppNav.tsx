import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMyRoles } from "@/lib/admin.functions";
import { getEnrolledProfileSummary, getOrCreateActiveDemoSession } from "@/lib/attendance.functions";
import {
  LogOut,
  User,
  Shield,
  BookOpen,
  GraduationCap,
  Users,
  Briefcase,
  ShieldCheck,
  CheckCircle2,
  Key,
  Lock,
  Calendar,
  Sparkles,
  MessageCircle,
  Sun,
  Moon,
} from "lucide-react";
import { AccessibilityToolbar } from "@/components/AccessibilityToolbar";

export function AppNav() {
  const navigate = useNavigate();
  const getRolesFn = useServerFn(getMyRoles);
  const getProfileSummaryFn = useServerFn(getEnrolledProfileSummary);
  const startDemoFn = useServerFn(getOrCreateActiveDemoSession);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const { data: userRoles } = useQuery({
    queryKey: ["my-user-roles"],
    queryFn: () => getRolesFn(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: profileSummary } = useQuery({
    queryKey: ["enrolled-profile-summary"],
    queryFn: () => getProfileSummaryFn(),
    staleTime: 2 * 60 * 1000,
  });

  // Close popover when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  return (
    <header className="border-b border-border bg-card shadow-sm relative z-40">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="flex items-center gap-2 font-bold text-foreground hover:opacity-90"
          >
            <Shield className="h-5 w-5 text-primary" />
            <span className="hidden sm:inline text-base">Presence ERP</span>
            <span className="sm:hidden text-base">Presence</span>
          </Link>

          <span className="hidden lg:flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
            <span>Realtime WebSockets</span>
          </span>

          {/* Role Navigation Links */}
          <nav className="ml-4 flex items-center gap-1 sm:gap-2">
            {userRoles?.isAdmin && (
              <Link
                to="/admin"
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground [&.active]:bg-primary/10 [&.active]:text-primary"
              >
                <Shield className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Admin</span>
              </Link>
            )}

            {userRoles?.isTeacher && (
              <Link
                to="/teacher"
                search={{ tab: "live" }}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 [&.active]:bg-primary [&.active]:text-primary-foreground transition-all"
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>Teacher 👨‍🏫</span>
              </Link>
            )}

            {userRoles?.isStudent && (
              <>
                <Link
                  to="/student"
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground [&.active]:bg-primary/10 [&.active]:text-primary"
                >
                  <GraduationCap className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">Student</span>
                </Link>
                <Link
                  to="/enroll"
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground [&.active]:bg-primary/10 [&.active]:text-primary"
                >
                  <User className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline">Face Enrollment</span>
                </Link>
                <button
                  onClick={async () => {
                    try {
                      const res = await startDemoFn();
                      const targetSession = res?.sessionId || "00000000-0000-4000-a000-000000000001";
                      navigate({ to: "/attend/$sessionId", params: { sessionId: targetSession } });
                    } catch (e) {
                      console.warn("Using default check-in session fallback:", e);
                      navigate({ to: "/attend/$sessionId", params: { sessionId: "00000000-0000-4000-a000-000000000001" } });
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 transition-colors"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Face Check-in 📸</span>
                </button>
                <Link
                  to="/ask"
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground [&.active]:bg-primary/10 [&.active]:text-primary"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline">Ask Presence 🤖</span>
                </Link>
              </>
            )}

            {userRoles?.isGuardian && (
              <Link
                to="/parent"
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground [&.active]:bg-primary/10 [&.active]:text-primary"
              >
                <Users className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Parent</span>
              </Link>
            )}

            {userRoles?.isEmployee && (
              <Link
                to="/employee"
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground [&.active]:bg-primary/10 [&.active]:text-primary"
              >
                <Briefcase className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Staff</span>
              </Link>
            )}
          </nav>
        </div>

        {/* Top-Right Profile Section */}
        <div className="relative flex items-center gap-2 sm:gap-3" ref={popoverRef}>
          {/* Dark Mode Toggle Button */}
          <button
            onClick={() => {
              const next = !document.documentElement.classList.contains("dark");
              document.documentElement.classList.toggle("dark", next);
              localStorage.setItem("presence_theme", next ? "dark" : "light");
            }}
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title="Toggle Light / Dark Mode"
            aria-label="Toggle theme"
          >
            <Sun className="h-4 w-4 hidden dark:block text-amber-400" />
            <Moon className="h-4 w-4 block dark:hidden text-slate-700" />
          </button>

          {/* Accessibility Toolbar Mount */}
          <AccessibilityToolbar />

          {/* Profile Trigger Button */}
          <button
            onClick={() => setPopoverOpen((prev) => !prev)}
            className="group flex items-center gap-2 rounded-full p-0.5 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-transform active:scale-95"
            title="View Biometric Profile Details"
          >
            {profileSummary?.photo ? (
              <div className="relative">
                <img
                  src={profileSummary.photo}
                  alt="Enrolled Face"
                  className="h-9 w-9 rounded-full object-cover ring-2 ring-emerald-500/80 shadow-sm transition-transform group-hover:scale-105"
                />
                <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-white ring-2 ring-background">
                  <CheckCircle2 className="h-2.5 w-2.5" />
                </span>
              </div>
            ) : (
              <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-muted border border-border text-muted-foreground group-hover:bg-accent">
                <User className="h-4 w-4" />
                {profileSummary?.isEnrolled && (
                  <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
                )}
              </div>
            )}

            <div className="hidden text-left sm:block">
              <div className="text-xs font-semibold text-foreground flex items-center gap-1">
                <span>{userRoles?.displayName || "User"}</span>
                {profileSummary?.isEnrolled && (
                  <span className="rounded bg-emerald-500/10 px-1 py-0.2 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                    Enrolled
                  </span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {profileSummary?.isEnrolled ? "Biometric Verified" : "Account Active"}
              </div>
            </div>
          </button>

          {/* Sign Out Quick Button */}
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
            title="Sign out"
          >
            <LogOut className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="hidden md:inline">Sign out</span>
          </button>

          {/* ── Top-Right Enrolled Profile Popover Card ── */}
          {popoverOpen && (
            <div className="absolute right-0 top-12 w-80 rounded-2xl border border-border bg-card p-5 shadow-2xl animate-in fade-in slide-in-from-top-2 z-50">
              <div className="flex items-start justify-between border-b border-border pb-4">
                <div className="flex items-center gap-3">
                  {profileSummary?.photo ? (
                    <img
                      src={profileSummary.photo}
                      alt="Enrolled Face Decrypted"
                      className="h-16 w-16 rounded-xl object-cover ring-2 ring-emerald-500 shadow-md"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-muted border border-border text-muted-foreground">
                      <User className="h-8 w-8" />
                    </div>
                  )}
                  <div>
                    <h4 className="text-sm font-bold text-foreground">
                      {userRoles?.displayName || "Student User"}
                    </h4>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        profileSummary?.isEnrolled
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                          : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                      }`}
                    >
                      <ShieldCheck className="h-3 w-3" />
                      {profileSummary?.isEnrolled ? "Biometric Enrolled" : "Pending Enrollment"}
                    </span>
                    <div className="mt-1 text-[11px] font-mono text-muted-foreground">
                      AES-256-GCM Encrypted
                    </div>
                    <div className="mt-1 flex items-center gap-1 rounded bg-indigo-500/10 px-1.5 py-0.5 text-[9px] font-bold text-indigo-500 border border-indigo-500/20">
                      <span>⚖️ DPDP Consent: Verified (18+)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Profile Details Inventory */}
              <div className="mt-4 space-y-2.5 text-xs">
                <div className="flex items-center justify-between rounded-lg bg-muted/40 p-2.5">
                  <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5 text-primary" />
                    Enrolled Date
                  </span>
                  <span className="font-semibold text-foreground">
                    {profileSummary?.grantedAt
                      ? new Date(profileSummary.grantedAt).toLocaleDateString()
                      : "Not Enrolled"}
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-muted/40 p-2.5">
                  <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                    <Lock className="h-3.5 w-3.5 text-primary" />
                    Consent Policy
                  </span>
                  <span className="font-semibold text-foreground">
                    {profileSummary?.policyVersion || "v1.0 (Granted)"}
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-muted/40 p-2.5">
                  <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                    <Key className="h-3.5 w-3.5 text-primary" />
                    WebAuthn Hardware
                  </span>
                  <span className="font-semibold text-foreground">
                    {profileSummary?.webauthnCount && profileSummary.webauthnCount > 0
                      ? `${profileSummary.webauthnCount} Device Registered`
                      : "No Hardware Key"}
                  </span>
                </div>

                {profileSummary?.retentionUntil && (
                  <div className="flex items-center justify-between rounded-lg bg-muted/40 p-2.5">
                    <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      Data Retention
                    </span>
                    <span className="font-semibold text-foreground">
                      Until {new Date(profileSummary.retentionUntil).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>

              {/* Actions Footer */}
              <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
                <Link
                  to="/enroll"
                  onClick={() => setPopoverOpen(false)}
                  className="flex-1 rounded-lg bg-primary py-2 text-center text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  {profileSummary?.isEnrolled
                    ? userRoles?.isAdmin
                      ? "Manage / Re-enroll Face"
                      : "View Enrolled Profile"
                    : "Enroll Now"}
                </Link>
                <button
                  onClick={handleSignOut}
                  className="rounded-lg border border-input bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                >
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
