/**
 * Server-side Reset Password business logic & security handlers.
 * Implements Google / GitHub / Stripe / ERP Enterprise Level Security:
 * - Anti-user-enumeration (always generic response)
 * - Rate limiting per IP, per Email, and per Reset Attempt (MAX 5 attempts, 15-min lockout)
 * - 32-byte CSPRNG raw token generation
 * - SHA-256 token hashing prior to DB insertion
 * - Invalidation of prior unused tokens
 * - Have I Been Pwned (HIBP) k-Anonymity API password breach check
 * - Immediate token single-use invalidation (unusable even within expiry window)
 * - Strict ERP Password Policy (12+ chars, A-Z, a-z, 0-9, special, no common patterns, no user info)
 * - Global session revocation upon reset (forces re-login everywhere)
 * - Audit Trail security logging (PASSWORD_RESET_COMPLETED)
 * - Transactional security emails
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkRateLimit } from "@/lib/attendance-crypto.server";
import { sendPasswordResetEmail, sendPasswordChangedNotification } from "./notifications.server";
import { logger } from "./logger.server";

const textEncoder = new TextEncoder();

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
 * Validate ERP Password Requirements
 */
export function validateErpPassword(password: string, userEmail?: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!password || password.length < 12) {
    errors.push("Password must be at least 12 characters long.");
  }
  if (password.length > 128) {
    errors.push("Password must not exceed 128 characters.");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter (A-Z).");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter (a-z).");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number (0-9).");
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push("Password must contain at least one special character (!@#$%^&*).");
  }

  const lowerPwd = password.toLowerCase();
  for (const pat of COMMON_PATTERNS) {
    if (lowerPwd.includes(pat)) {
      errors.push(`Password contains a forbidden common pattern ("${pat}").`);
      break;
    }
  }

  if (checkUserInfoInPassword(password, userEmail)) {
    errors.push("Password must not contain parts of your email address or username.");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Compute SHA-256 hex hash of a string using Web Crypto API
 */
export async function hashSha256(data: string): Promise<string> {
  const buf = textEncoder.encode(data);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute SHA-1 hex hash of a string (used for HIBP k-Anonymity query)
 */
export async function hashSha1(data: string): Promise<string> {
  const buf = textEncoder.encode(data);
  const digest = await crypto.subtle.digest("SHA-1", buf);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * Generate a cryptographically secure random token (32 bytes = 256 bits of entropy)
 * Returns raw token (for email link) and SHA-256 hash (for DB storage).
 */
export async function generateResetToken(): Promise<{ rawToken: string; tokenHash: string }> {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const rawToken = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const tokenHash = await hashSha256(rawToken);
  return { rawToken, tokenHash };
}

/**
 * Have I Been Pwned (HIBP) Passwords API check using k-Anonymity.
 * Sends ONLY the first 5 characters of the SHA-1 password hash over HTTPS to HIBP.
 * The raw password or full hash NEVER leaves the server.
 */
export async function checkPasswordPwned(
  password: string,
): Promise<{ pwned: boolean; count: number }> {
  try {
    const fullHash = await hashSha1(password);
    const prefix = fullHash.slice(0, 5);
    const suffix = fullHash.slice(5);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "User-Agent": "Presence-Presence-PasswordCheck/1.0" },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (!res.ok) {
      return { pwned: false, count: 0 };
    }

    const bodyText = await res.text();
    const lines = bodyText.split("\n");

    for (const line of lines) {
      const [lineSuffix, lineCountStr] = line.trim().split(":");
      if (lineSuffix && lineSuffix.toUpperCase() === suffix) {
        const count = parseInt(lineCountStr || "0", 10);
        return { pwned: true, count };
      }
    }

    return { pwned: false, count: 0 };
  } catch (e) {
    console.warn("HIBP password breach check failed or timed out:", e);
    return { pwned: false, count: 0 };
  }
}

/**
 * Handle password reset request.
 * Enforces rate limiting per IP and per Email.
 * Always returns generic success response to prevent user enumeration.
 */
export async function requestPasswordReset(
  email: string,
  clientIp: string,
  reqOrigin?: string,
): Promise<{ ok: boolean; message: string }> {
  const normalizedEmail = email.toLowerCase().trim();

  // Rate limiting: 5 requests per hour (3600 sec) per IP and per Email
  const ipRateLimitKey = `pwd_reset_ip:${clientIp || "unknown"}`;
  const emailRateLimitKey = `pwd_reset_email:${normalizedEmail}`;

  const ipAllowed = await checkRateLimit(ipRateLimitKey, 5, 3600);
  if (!ipAllowed) {
    throw new Error("Too many password reset requests from this IP. Please try again in an hour.");
  }

  const emailAllowed = await checkRateLimit(emailRateLimitKey, 5, 3600);
  if (!emailAllowed) {
    throw new Error(
      "Too many password reset requests for this email. Please try again in an hour.",
    );
  }

  const genericResponse = {
    ok: true,
    message:
      "If an account exists associated with that email, a password reset link has been sent.",
  };

  // Find user by email using Supabase Admin Auth API
  let userId: string | null = null;
  try {
    const { data: users, error } = await supabaseAdmin.auth.admin.listUsers();
    if (!error && users?.users) {
      const match = users.users.find((u) => u.email?.toLowerCase() === normalizedEmail);
      if (match) {
        userId = match.id;
      }
    }
  } catch (e) {
    console.error("Error looking up user for password reset:", e);
  }

  if (!userId) {
    const hash = await hashSha256(normalizedEmail);
    userId = `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-a${hash.substring(17, 20)}-${hash.substring(20, 32)}`;
  }

  try {
    // Invalidate prior unused tokens for this user
    await supabaseAdmin
      .from("password_reset_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("used_at", null);

    // Generate new CSPRNG token & hash
    const { rawToken, tokenHash } = await generateResetToken();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes expiry

    // Store SHA-256 hashed token in DB
    const { error: insertError } = await supabaseAdmin.from("password_reset_tokens").insert({
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      ip_address: clientIp,
    });

    if (insertError) {
      console.error("Error storing password reset token:", insertError);
      return genericResponse;
    }

    // Build reset URL
    const origin = reqOrigin || "http://localhost:8787";
    const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(rawToken)}`;

    console.info(`\n========================================`);
    console.info(`[PASSWORD RESET LINK GENERATED]`);
    console.info(`Email: ${normalizedEmail}`);
    console.info(`Reset Link: ${resetUrl}`);
    console.info(`========================================\n`);

    const emailSent = await sendPasswordResetEmail(normalizedEmail, resetUrl, 30);

    if (!emailSent) {
      console.info(
        `Resend not configured/failed. Triggering Supabase Auth native email fallback for ${normalizedEmail}...`,
      );
      await supabaseAdmin.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${origin}/reset-password`,
      });
    }
  } catch (e) {
    console.error("Error generating/dispatching password reset token:", e);
  }

  return genericResponse;
}

/**
 * Validate a raw reset token without using it.
 * Used for pre-flight check when rendering the reset password page.
 */
export async function verifyResetToken(
  rawToken: string,
): Promise<{ valid: boolean; userId?: string; reason?: string }> {
  if (!rawToken || rawToken.length < 16) {
    return { valid: false, reason: "Invalid token format." };
  }

  const tokenHash = await hashSha256(rawToken);

  const { data: record, error } = await supabaseAdmin
    .from("password_reset_tokens")
    .select("id, user_id, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !record) {
    return { valid: false, reason: "Reset link is invalid or has expired." };
  }

  if (record.used_at) {
    return { valid: false, reason: "This reset link has already been used." };
  }

  const expiresAt = new Date(record.expires_at).getTime();
  if (Date.now() > expiresAt) {
    return { valid: false, reason: "This reset link has expired. Please request a new one." };
  }

  return { valid: true, userId: record.user_id };
}

/**
 * Complete password reset:
 * 1. Brute-force rate limit protection (MAX 5 attempts per 15 mins)
 * 2. Token validation (single-use check)
 * 3. ERP Password Requirement Check & HIBP data breach status
 * 4. Updates password via Supabase Admin
 * 5. Immediately invalidates token
 * 6. Revokes all active user sessions globally (force re-login everywhere)
 * 7. Security audit event logging & email notification
 */
export async function completePasswordReset(
  rawToken: string,
  newPassword: string,
  clientIp: string,
  userAgent = "Unknown",
): Promise<{ ok: boolean; message: string }> {
  // 1. Brute-force Rate Limiting (MAX 5 attempts per 15 mins = 900 seconds)
  const attemptKey = `pwd_reset_complete_attempt:${clientIp}:${(await hashSha256(rawToken)).slice(0, 12)}`;
  const rateLimitAllowed = await checkRateLimit(attemptKey, 5, 900);
  if (!rateLimitAllowed) {
    throw new Error("Too many password reset attempts. This action is temporarily locked for 15 minutes.");
  }

  // 2. Token validation
  const tokenResult = await verifyResetToken(rawToken);
  if (!tokenResult.valid || !tokenResult.userId) {
    throw new Error(tokenResult.reason || "Invalid or expired token.");
  }

  const userId = tokenResult.userId;

  // Fetch user object to get email for user-info password check
  let userEmail: string | undefined = undefined;
  try {
    const { data: userObj } = await supabaseAdmin.auth.admin.getUserById(userId);
    userEmail = userObj?.user?.email;
  } catch (e) {
    console.warn("Could not fetch user email for password policy check:", e);
  }

  // 3. ERP Password Strength & Policy Check
  const policyCheck = validateErpPassword(newPassword, userEmail);
  if (!policyCheck.valid) {
    throw new Error(policyCheck.errors[0]);
  }

  // 4. Have I Been Pwned (HIBP) Breach Check
  const pwnedResult = await checkPasswordPwned(newPassword);
  if (pwnedResult.pwned) {
    throw new Error(
      `This password has appeared in a known data breach (${pwnedResult.count.toLocaleString()} times). For your security, please choose a different password.`,
    );
  }

  // 5. Update Password in Supabase Auth Admin
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: newPassword,
  });

  if (updateError) {
    throw new Error(`Failed to update password: ${updateError.message}`);
  }

  // 6. Invalidate token immediately (single-use guarantee)
  const tokenHash = await hashSha256(rawToken);
  await supabaseAdmin
    .from("password_reset_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", tokenHash);

  // 7. Revoke ALL active sessions & refresh tokens for user (force re-login everywhere)
  try {
    await supabaseAdmin.auth.admin.signOut(userId, "global");
  } catch (e) {
    console.error("Warning: Global signout error during password reset:", e);
  }

  // 8. Security Audit Trail Logging
  logger.security("PASSWORD_RESET", "Password reset completed successfully", {
    userId,
    clientIp,
    userAgent,
    timestamp: new Date().toISOString(),
    tokenHashPrefix: tokenHash.slice(0, 12),
  });

  try {
    await supabaseAdmin.from("attendance_events").insert({
      session_id: "00000000-0000-4000-a000-000000000000",
      student_id: userId,
      event_type: "PASSWORD_RESET_COMPLETED",
      reason_code: "SECURITY_PASSWORD_CHANGED",
      gate_reasons: {
        ip: clientIp,
        userAgent,
        timestamp: new Date().toISOString(),
        tokenHashPrefix: tokenHash.slice(0, 12),
      },
    });
  } catch (e) {
    console.warn("Could not insert password reset security audit log into DB:", e);
  }

  // 9. Send email notification
  if (userEmail) {
    try {
      await sendPasswordChangedNotification(userEmail, clientIp);
    } catch (e) {
      console.error("Error sending password changed notification email:", e);
    }
  }

  return {
    ok: true,
    message:
      "Password updated successfully. All existing sessions have been ended. Please sign in with your new password.",
  };
}
