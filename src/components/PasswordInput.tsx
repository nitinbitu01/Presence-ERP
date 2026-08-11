import React, { useState } from "react";
import { Eye, EyeOff, Check, X, ShieldAlert, ShieldCheck } from "lucide-react";
import { PasswordStrengthMeter } from "./PasswordStrengthMeter";
import type { PasswordValidationResult } from "@/types/security.types";

interface PasswordInputProps {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  minLength?: number;
  maxLength?: number;
  validation?: PasswordValidationResult;
  showStrength?: boolean;
  showToggle?: boolean;
  userEmail?: string;
  className?: string;
  autoComplete?: string;
}

export const COMMON_PATTERNS = [
  "123456", "12345678", "123456789", "qwerty", "password", "admin",
  "letmein", "welcome", "12345", "password123", "admin123"
];

export function checkUserInfoInPassword(password: string, userEmail?: string): boolean {
  if (!userEmail) return false;
  const emailHandle = userEmail.toLowerCase().split("@")[0] || "";
  const parts = emailHandle.split(/[\._-]/).concat(emailHandle.replace(/[0-9]/g, ""));
  const lowerPwd = password.toLowerCase();
  for (const part of parts) {
    if (part.length >= 3 && lowerPwd.includes(part)) {
      return true;
    }
  }
  return false;
}

/**
 * Calculates password entropy bits: E = length * log2(poolSize)
 */
export function calculateEntropy(password: string): number {
  if (!password) return 0;
  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/[0-9]/.test(password)) poolSize += 10;
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) poolSize += 32;
  if (poolSize === 0) poolSize = 10;
  return Math.round(password.length * Math.log2(poolSize));
}

export function checkPasswordStrength(password: string, userEmail?: string) {
  const hasCommonPattern = COMMON_PATTERNS.some((pat) =>
    password.toLowerCase().includes(pat),
  );

  const hasUserInfo = checkUserInfoInPassword(password, userEmail);

  const checks = {
    length: password.length >= 12,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*(),.?":{}|<>]/.test(password),
    noCommonPattern: !hasCommonPattern,
    noUserInfo: !hasUserInfo,
  };

  const entropy = calculateEntropy(password);
  const score = Object.values(checks).filter(Boolean).length;

  let label = "Very Weak";
  let color = "bg-red-500 text-red-600 dark:text-red-400";
  let barWidth = "w-1/6 bg-red-500";

  if (score >= 6 && entropy >= 80) {
    label = "Very Strong ✓";
    color = "bg-emerald-600 text-emerald-600 dark:text-emerald-400";
    barWidth = "w-full bg-emerald-600";
  } else if (score >= 5 && entropy >= 60) {
    label = "Strong";
    color = "bg-emerald-500 text-emerald-600 dark:text-emerald-400";
    barWidth = "w-5/6 bg-emerald-500";
  } else if (score >= 4 && entropy >= 45) {
    label = "Medium";
    color = "bg-yellow-500 text-yellow-600 dark:text-yellow-400";
    barWidth = "w-3/6 bg-yellow-500";
  } else if (score >= 3) {
    label = "Weak";
    color = "bg-amber-500 text-amber-600 dark:text-amber-400";
    barWidth = "w-2/6 bg-amber-500";
  }

  const isStrongEnough = checks.length && checks.uppercase && checks.lowercase && checks.number && checks.special && checks.noCommonPattern && !hasUserInfo;

  return { checks, score, entropy, label, color, barWidth, isStrongEnough, hasCommonPattern, hasUserInfo };
}

export function PasswordInput({
  id = "password",
  name = "password",
  value,
  onChange,
  placeholder = "Password",
  required = false,
  disabled = false,
  minLength = 12,
  maxLength = 128,
  validation,
  showStrength = false,
  showToggle = true,
  userEmail,
  className = "",
  autoComplete = "current-password",
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const strength = checkPasswordStrength(value, userEmail);

  return (
    <div className="w-full space-y-2">
      <div className="relative flex items-center">
        <input
          id={id}
          name={name}
          type={showPassword ? "text" : "password"}
          required={required}
          disabled={disabled}
          minLength={minLength}
          maxLength={maxLength}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className={`w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary ${className}`}
        />
        {showToggle && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute right-3 text-muted-foreground hover:text-foreground transition-colors"
            title={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>

      {showStrength && validation && value.length > 0 && (
        <PasswordStrengthMeter validation={validation} showErrors={true} />
      )}

      {showStrength && !validation && value.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border/50 bg-muted/30 p-3 text-xs">
          <div className="flex items-center justify-between font-medium">
            <span className="flex items-center gap-1.5 text-foreground">
              {strength.isStrongEnough ? (
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
              ) : (
                <ShieldAlert className="h-4 w-4 text-amber-500" />
              )}
              Password Strength &amp; Entropy:
            </span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                ({strength.entropy} bits)
              </span>
              <span className={`font-semibold ${strength.color.split(" ")[1]}`}>
                {strength.label}
              </span>
            </div>
          </div>

          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div className={`h-full transition-all duration-300 ${strength.barWidth.split(" ")[1]}`} />
          </div>

          {!strength.isStrongEnough && (
            <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
              ⚠️ Password must meet all ERP security requirements:
            </p>
          )}

          <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px]">
            <div className={`flex items-center gap-1 ${strength.checks.length ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-muted-foreground"}`}>
              {strength.checks.length ? <Check className="h-3 w-3" /> : <X className="h-3 w-3 opacity-40" />}
              Min 12 characters
            </div>
            <div className={`flex items-center gap-1 ${strength.checks.uppercase ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-muted-foreground"}`}>
              {strength.checks.uppercase ? <Check className="h-3 w-3" /> : <X className="h-3 w-3 opacity-40" />}
              Uppercase (A-Z)
            </div>
            <div className={`flex items-center gap-1 ${strength.checks.lowercase ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-muted-foreground"}`}>
              {strength.checks.lowercase ? <Check className="h-3 w-3" /> : <X className="h-3 w-3 opacity-40" />}
              Lowercase (a-z)
            </div>
            <div className={`flex items-center gap-1 ${strength.checks.number ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-muted-foreground"}`}>
              {strength.checks.number ? <Check className="h-3 w-3" /> : <X className="h-3 w-3 opacity-40" />}
              Number (0-9)
            </div>
            <div className={`flex items-center gap-1 ${strength.checks.special ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-muted-foreground"}`}>
              {strength.checks.special ? <Check className="h-3 w-3" /> : <X className="h-3 w-3 opacity-40" />}
              Special char (!@#$%^&*)
            </div>
            <div className={`flex items-center gap-1 ${strength.checks.noCommonPattern ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-destructive font-medium"}`}>
              {strength.checks.noCommonPattern ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              No common patterns
            </div>
            {userEmail && (
              <div className={`col-span-2 flex items-center gap-1 ${strength.checks.noUserInfo ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-destructive font-medium"}`}>
                {strength.checks.noUserInfo ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                No email or username info
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
