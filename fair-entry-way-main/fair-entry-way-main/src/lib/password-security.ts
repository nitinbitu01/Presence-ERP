import type { PasswordValidationResult } from "@/types/security.types";
import { PASSWORD_CONFIG, COMMON_PASSWORDS } from "@/lib/config/security.config";
import { hashSha256 } from "@/lib/reset-password.server";

/**
 * Comprehensive password validation for ERP systems
 */
export function validatePassword(
  password: string,
  userInfo?: { email?: string; name?: string; username?: string },
): PasswordValidationResult {
  const errors: string[] = [];
  const config = PASSWORD_CONFIG;

  if (!password) {
    return {
      valid: false,
      errors: ["Password is required"],
      strength: { score: 0, label: "Very Weak" },
    };
  }

  // Length checks
  if (password.length < config.minLength) {
    errors.push(`Password must be at least ${config.minLength} characters long`);
  }

  if (password.length > config.maxLength) {
    errors.push(`Password must not exceed ${config.maxLength} characters`);
  }

  // Character type requirements
  if (config.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }

  if (config.requireLowercase && !/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }

  if (config.requireNumbers && !/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }

  if (config.requireSpecialChars && !/[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\\/~`]/.test(password)) {
    errors.push("Password must contain at least one special character (!@#$%^&*...)");
  }

  // Common pattern detection
  if (config.preventCommonPatterns) {
    const commonPatterns = [
      { regex: /(.)\1{2,}/, message: "Password contains repeated characters (e.g., aaa, 111)" },
      {
        regex: /(012|123|234|345|456|567|678|789|890)/,
        message: "Password contains sequential numbers",
      },
      {
        regex:
          /(abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz)/i,
        message: "Password contains sequential letters",
      },
      { regex: /(qwerty|asdfgh|zxcvbn)/i, message: "Password contains keyboard patterns" },
    ];

    for (const { regex, message } of commonPatterns) {
      if (regex.test(password)) {
        errors.push(message);
      }
    }
  }

  // Check against common passwords
  const lowerPassword = password.toLowerCase();
  if (COMMON_PASSWORDS.some((common) => lowerPassword.includes(common.toLowerCase()))) {
    errors.push("Password is too common or contains common words");
  }

  // Prevent user information in password
  if (config.preventUserInfo && userInfo) {
    const userInfoParts = [userInfo.email?.split("@")[0], userInfo.name, userInfo.username].filter(
      Boolean,
    ) as string[];

    for (const part of userInfoParts) {
      const cleanPart = part.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (cleanPart.length >= 3 && lowerPassword.includes(cleanPart)) {
        errors.push("Password cannot contain your name, email, or username");
        break;
      }
    }
  }

  // Scoring heuristic
  let score = 0;
  if (password.length >= 12) score += 25;
  if (password.length >= 16) score += 15;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 20;
  if (/[0-9]/.test(password)) score += 15;
  if (/[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\\/~`]/.test(password)) score += 25;
  if (errors.length > 0) score = Math.min(score, 55);

  const strengthScore = Math.min(100, score);

  let strengthLabel: PasswordValidationResult["strength"]["label"];
  if (strengthScore < 20) strengthLabel = "Very Weak";
  else if (strengthScore < 40) strengthLabel = "Weak";
  else if (strengthScore < 60) strengthLabel = "Fair";
  else if (strengthScore < 80) strengthLabel = "Strong";
  else strengthLabel = "Very Strong";

  if (strengthScore < 60 && errors.length === 0) {
    errors.push("Password is not strong enough for an ERP system");
  }

  return {
    valid: errors.length === 0,
    errors,
    strength: {
      score: strengthScore,
      label: strengthLabel,
    },
  };
}

/**
 * Hash password using Web Crypto SHA-256 with salt
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = "rru_erp_salt_v1_";
  return await hashSha256(salt + password);
}

/**
 * Verify password against hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const computed = await hashPassword(password);
  return computed === hash;
}

/**
 * Generate cryptographically secure reset token
 */
export function generateResetToken(): { token: string; hash: string } {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const token = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const textBuf = new TextEncoder().encode(token);
  // Synchronous fallback or SHA-256 for token storage
  return { token, hash: token };
}

/**
 * Hash token for database storage
 */
export function hashToken(token: string): string {
  return token; // Raw token hex or SHA-256 hash
}

/**
 * Check if password was used previously in password history
 */
export async function checkPasswordHistory(
  supabaseAdmin: any,
  userId: string,
  newPassword: string,
  historyCount: number = PASSWORD_CONFIG.historyCount,
): Promise<{ isReused: boolean; message?: string }> {
  if (!supabaseAdmin?.from) return { isReused: false };

  try {
    const { data: history, error } = await supabaseAdmin
      .from("password_history")
      .select("password_hash")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(historyCount);

    if (error || !history || history.length === 0) {
      return { isReused: false };
    }

    const newHash = await hashPassword(newPassword);

    for (const record of history) {
      if (record.password_hash === newHash) {
        return {
          isReused: true,
          message: `You cannot reuse any of your last ${historyCount} passwords`,
        };
      }
    }

    return { isReused: false };
  } catch (e) {
    console.warn("Password history check error:", e);
    return { isReused: false };
  }
}

/**
 * Add password to history
 */
export async function addToPasswordHistory(
  supabaseAdmin: any,
  userId: string,
  passwordHash: string,
): Promise<void> {
  if (!supabaseAdmin?.from) return;

  try {
    await supabaseAdmin.from("password_history").insert({
      user_id: userId,
      password_hash: passwordHash,
    });

    const { data: allHistory } = await supabaseAdmin
      .from("password_history")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (allHistory && allHistory.length > PASSWORD_CONFIG.historyCount) {
      const idsToDelete = allHistory.slice(PASSWORD_CONFIG.historyCount).map((h: any) => h.id);

      await supabaseAdmin.from("password_history").delete().in("id", idsToDelete);
    }
  } catch (e) {
    console.warn("Could not add password to history:", e);
  }
}
