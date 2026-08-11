import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect, useMemo } from "react";
import {
  KeyRound,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  ShieldCheck,
  Loader2,
  Info,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  validateResetTokenFn,
  completePasswordResetFn,
  checkPasswordPwnedFn,
} from "@/lib/reset-password.functions";
import { validatePassword } from "@/lib/password-security";
import { PasswordInput } from "@/components/PasswordInput";
import type { PasswordValidationResult } from "@/types/security.types";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (s: Record<string, unknown>): { token?: string } =>
    typeof s.token === "string" ? { token: s.token } : {},
  head: () => ({
    meta: [
      { title: "Reset Password — Presence ERP" },
      { name: "description", content: "Set a new password for your Presence ERP account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { token: searchToken } = Route.useSearch();
  const rawToken = searchToken || "";

  const validateToken = useServerFn(validateResetTokenFn);
  const completeReset = useServerFn(completePasswordResetFn);
  const checkPwned = useServerFn(checkPasswordPwnedFn);

  const [tokenStatus, setTokenStatus] = useState<"loading" | "valid" | "invalid">("loading");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [isSupabaseSession, setIsSupabaseSession] = useState(false);
  const [userEmail, setUserEmail] = useState<string>("");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [pwnedState, setPwnedState] = useState<{
    checking: boolean;
    pwned: boolean;
    count: number;
  } | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Real-time password validation using ERP policy
  const passwordValidation: PasswordValidationResult | null = useMemo(() => {
    if (!password) return null;
    return validatePassword(password, { email: userEmail });
  }, [password, userEmail]);

  // Validate token or detect Supabase Auth recovery session on mount
  useEffect(() => {
    let isMounted = true;

    const checkRecoverySession = async () => {
      const { data } = await supabase.auth.getSession();
      const isRecovery =
        typeof window !== "undefined" &&
        (window.location.hash.includes("type=recovery") ||
          window.location.hash.includes("access_token") ||
          window.location.search.includes("type=recovery"));

      if (data.session || isRecovery) {
        if (!isMounted) return;
        setIsSupabaseSession(true);
        setTokenStatus("valid");
        setUserEmail(data.session?.user?.email || "");
        return true;
      }
      return false;
    };

    checkRecoverySession().then((hasSession) => {
      if (hasSession) return;
      if (!rawToken) {
        if (!isMounted) return;
        setTokenStatus("invalid");
        setTokenError("No password reset token provided. Please request a new link.");
        return;
      }

      validateToken({ data: { token: rawToken } })
        .then((res) => {
          if (!isMounted) return;
          if (res.valid) {
            setTokenStatus("valid");
          } else {
            setTokenStatus("invalid");
            setTokenError(res.reason || "Reset link is invalid or has expired.");
          }
        })
        .catch((e: unknown) => {
          if (!isMounted) return;
          setTokenStatus("invalid");
          setTokenError(e instanceof Error ? e.message : "Failed to validate reset link.");
        });
    });

    return () => {
      isMounted = false;
    };
  }, [rawToken, validateToken]);

  // Debounced Have I Been Pwned check on password change
  useEffect(() => {
    if (!password || password.length < 8) {
      setPwnedState(null);
      return;
    }

    const timer = setTimeout(() => {
      setPwnedState({ checking: true, pwned: false, count: 0 });
      checkPwned({ data: { password } })
        .then((res) => {
          setPwnedState({ checking: false, pwned: res.pwned, count: res.count });
        })
        .catch(() => {
          setPwnedState(null);
        });
    }, 800);

    return () => clearTimeout(timer);
  }, [password, checkPwned]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSuccess(null);

    if (passwordValidation && !passwordValidation.valid) {
      setErr(passwordValidation.errors[0] || "Password does not meet ERP security standards.");
      return;
    }

    if (password !== confirmPassword) {
      setErr("Passwords do not match.");
      return;
    }

    if (pwnedState?.pwned) {
      setErr(
        `This password has appeared in ${pwnedState.count.toLocaleString()} known data breaches. Please choose a unique password that hasn't been compromised.`,
      );
      return;
    }

    setBusy(true);
    try {
      if (isSupabaseSession) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        await supabase.auth.signOut();
        setSuccess("Password updated successfully! All sessions have been logged out. Redirecting to sign in...");
      } else {
        const res = await completeReset({
          data: {
            token: rawToken,
            password,
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "Browser",
            timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
          },
        });
        setSuccess(res.message);
      }

      setTimeout(() => {
        navigate({ to: "/auth" });
      }, 4000);
    } catch (e: unknown) {
      setErr(
        e instanceof Error
          ? e.message
          : "Failed to reset password. The reset link may have expired or been used already.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12 bg-background">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card/90 backdrop-blur-md p-8 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <img
            src="/logo.png"
            alt="Logo"
            className="h-10 w-auto object-contain"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
          <div>
            <div className="font-bold text-foreground text-lg leading-snug">
              Presence ERP
            </div>
            <div className="text-xs text-muted-foreground font-medium">
              National Security is Supreme • Presence ERP
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <KeyRound className="h-4 w-4" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Set New Password</h1>
        </div>

        <p className="text-xs text-muted-foreground mb-6">
          Create a strong, unique password for your ERP account. Your password will be securely encrypted.
        </p>

        {/* Loading State */}
        {tokenStatus === "loading" ? (
          <div className="mt-8 flex flex-col items-center justify-center py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              Validating security token...
            </p>
          </div>
        ) : tokenStatus === "invalid" ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-5 text-sm text-destructive flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-base">Invalid or Expired Link</p>
                <p className="mt-1 text-xs leading-relaxed opacity-90">{tokenError}</p>
              </div>
            </div>

            <div className="pt-2">
              <Link
                to="/auth"
                className="w-full inline-flex justify-center items-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 transition-colors"
              >
                Request a New Reset Link
              </Link>
            </div>
          </div>
        ) : success ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-5 text-sm text-emerald-700 dark:text-emerald-300 flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-base">Password Updated Successfully!</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{success}</p>
              </div>
            </div>

            <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-4 text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Security Notice</p>
                <ul className="mt-1 space-y-0.5 list-disc list-inside text-muted-foreground">
                  <li>All active sessions have been terminated</li>
                  <li>A confirmation email has been sent to your inbox</li>
                  <li>Use your new password to sign in</li>
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-5">
            {/* Security Requirements Info */}
            <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 text-xs text-blue-700 dark:text-blue-300">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold mb-1">ERP Security Requirements:</p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    <li>• Minimum 12 characters</li>
                    <li>• Uppercase &amp; lowercase letters</li>
                    <li>• At least one number &amp; special character</li>
                    <li>• Cannot reuse last 5 passwords</li>
                    <li>• Must not appear in known data breaches</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* New Password Input */}
            <div>
              <label htmlFor="new-password" className="block text-xs font-semibold text-foreground mb-1.5">
                New Password
              </label>
              <PasswordInput
                id="new-password"
                name="new-password"
                required
                minLength={12}
                maxLength={128}
                placeholder="Enter your new password"
                value={password}
                onChange={setPassword}
                validation={passwordValidation || undefined}
                showStrength={true}
                userEmail={userEmail}
                autoComplete="new-password"
              />
            </div>

            {/* Pwned Password Check */}
            {pwnedState && password.length >= 8 && (
              <div className="text-xs flex items-center gap-1.5 -mt-2">
                {pwnedState.checking ? (
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Checking password against known data breaches...
                  </span>
                ) : pwnedState.pwned ? (
                  <span className="text-destructive font-medium flex items-center gap-1">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                    ⚠️ Found in {pwnedState.count.toLocaleString()} data breaches (unsafe - choose another)
                  </span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                    ✓ Password not found in known data breaches
                  </span>
                )}
              </div>
            )}

            {/* Confirm Password Input */}
            <div>
              <label htmlFor="confirm-password" className="block text-xs font-semibold text-foreground mb-1.5">
                Confirm New Password
              </label>
              <PasswordInput
                id="confirm-password"
                name="confirm-password"
                required
                minLength={12}
                maxLength={128}
                placeholder="Re-enter your new password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                showStrength={false}
                autoComplete="new-password"
              />

              {confirmPassword && password !== confirmPassword && (
                <p className="mt-1.5 text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Passwords do not match
                </p>
              )}
            </div>

            {/* Error Message */}
            {err && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{err}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={
                busy ||
                tokenStatus !== "valid" ||
                (passwordValidation && !passwordValidation.valid) ||
                password !== confirmPassword ||
                pwnedState?.pwned ||
                pwnedState?.checking
              }
              className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow transition-all hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Updating Password…
                </>
              ) : (
                <>
                  <KeyRound className="h-4 w-4" />
                  Update Password &amp; Sign Out All Sessions
                </>
              )}
            </button>

            {/* Security Notice */}
            <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">🔒 Security Notice</p>
              <p className="leading-relaxed">
                After updating your password, all active sessions will be terminated for security. You&apos;ll need to sign in again on all devices.
              </p>
            </div>
          </form>
        )}

        {/* Footer */}
        <div className="mt-6 text-xs text-muted-foreground border-t border-border pt-4 text-center">
          <Link
            to="/auth"
            className="inline-flex items-center gap-1 hover:text-foreground font-medium transition-colors"
          >
            ← Return to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
