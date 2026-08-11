import { useMemo } from "react";
import { ShieldCheck, ShieldAlert, Shield } from "lucide-react";
import type { PasswordValidationResult } from "@/types/security.types";

interface PasswordStrengthMeterProps {
  validation: PasswordValidationResult;
  showErrors?: boolean;
}

export function PasswordStrengthMeter({
  validation,
  showErrors = true,
}: PasswordStrengthMeterProps) {
  const { strength, errors, valid } = validation;

  const strengthColor = useMemo(() => {
    if (strength.score < 20) return "bg-red-500";
    if (strength.score < 40) return "bg-orange-500";
    if (strength.score < 60) return "bg-yellow-500";
    if (strength.score < 80) return "bg-blue-500";
    return "bg-green-500";
  }, [strength.score]);

  const strengthTextColor = useMemo(() => {
    if (strength.score < 20) return "text-red-600 dark:text-red-400";
    if (strength.score < 40) return "text-orange-600 dark:text-orange-400";
    if (strength.score < 60) return "text-yellow-600 dark:text-yellow-400";
    if (strength.score < 80) return "text-blue-600 dark:text-blue-400";
    return "text-green-600 dark:text-green-400";
  }, [strength.score]);

  const StrengthIcon = useMemo(() => {
    if (strength.score < 60) return ShieldAlert;
    if (strength.score < 80) return Shield;
    return ShieldCheck;
  }, [strength.score]);

  return (
    <div className="mt-2 space-y-2">
      {/* Strength bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground font-medium">Password Strength</span>
          <span className={`font-semibold flex items-center gap-1 ${strengthTextColor}`}>
            <StrengthIcon className="h-3.5 w-3.5" />
            {strength.label}
          </span>
        </div>
        <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${strengthColor}`}
            style={{ width: `${strength.score}%` }}
          />
        </div>
      </div>

      {/* Validation errors */}
      {showErrors && errors.length > 0 && (
        <ul className="text-xs space-y-1">
          {errors.map((error, idx) => (
            <li key={idx} className="flex items-start gap-1.5 text-red-600 dark:text-red-400">
              <span className="text-red-500 mt-0.5">•</span>
              <span>{error}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Requirements checklist when valid */}
      {valid && (
        <div className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="font-medium">All ERP security requirements met</span>
        </div>
      )}
    </div>
  );
}
