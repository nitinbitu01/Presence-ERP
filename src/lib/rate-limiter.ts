import type { RateLimitConfig } from "@/types/security.types";
import { RATE_LIMIT_CONFIG } from "@/lib/config/security.config";
import { checkRateLimit as checkMemoryRateLimit } from "@/lib/attendance-crypto.server";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  blockedUntil?: Date;
}

/**
 * Check and enforce rate limits for password reset attempts
 */
export async function checkRateLimit(
  supabaseAdmin: any,
  identifier: string,
  attemptType = "password_reset",
  config: RateLimitConfig = RATE_LIMIT_CONFIG,
): Promise<RateLimitResult> {
  const now = new Date();

  // 1. In-memory check first (fast edge fail)
  const memoryKey = `rate_limit:${attemptType}:${identifier}`;
  const memAllowed = await checkMemoryRateLimit(
    memoryKey,
    config.maxAttempts,
    Math.round(config.windowMs / 1000),
  );

  if (!memAllowed) {
    const blockedUntil = new Date(now.getTime() + config.blockDurationMs);
    return {
      allowed: false,
      remaining: 0,
      resetAt: blockedUntil,
      blockedUntil,
    };
  }

  if (!supabaseAdmin?.from) {
    return {
      allowed: true,
      remaining: config.maxAttempts - 1,
      resetAt: new Date(now.getTime() + config.windowMs),
    };
  }

  try {
    // 2. Database check
    const { data: existing } = await supabaseAdmin
      .from("rate_limit_attempts")
      .select("*")
      .eq("identifier", identifier)
      .eq("attempt_type", attemptType)
      .maybeSingle();

    if (existing?.blocked_until && new Date(existing.blocked_until) > now) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(existing.blocked_until),
        blockedUntil: new Date(existing.blocked_until),
      };
    }

    const windowExpired =
      !existing ||
      new Date(existing.last_attempt_at).getTime() + config.windowMs < now.getTime();

    if (windowExpired) {
      await supabaseAdmin.from("rate_limit_attempts").upsert(
        {
          identifier,
          attempt_type: attemptType,
          attempts: 1,
          first_attempt_at: now.toISOString(),
          last_attempt_at: now.toISOString(),
          blocked_until: null,
        },
        { onConflict: "identifier,attempt_type" },
      );

      return {
        allowed: true,
        remaining: config.maxAttempts - 1,
        resetAt: new Date(now.getTime() + config.windowMs),
      };
    }

    const newAttempts = (existing.attempts || 1) + 1;

    if (newAttempts > config.maxAttempts) {
      const blockedUntil = new Date(now.getTime() + config.blockDurationMs);
      await supabaseAdmin
        .from("rate_limit_attempts")
        .update({
          attempts: newAttempts,
          last_attempt_at: now.toISOString(),
          blocked_until: blockedUntil.toISOString(),
        })
        .eq("identifier", identifier)
        .eq("attempt_type", attemptType);

      return {
        allowed: false,
        remaining: 0,
        resetAt: blockedUntil,
        blockedUntil,
      };
    }

    await supabaseAdmin
      .from("rate_limit_attempts")
      .update({
        attempts: newAttempts,
        last_attempt_at: now.toISOString(),
      })
      .eq("identifier", identifier)
      .eq("attempt_type", attemptType);

    return {
      allowed: true,
      remaining: config.maxAttempts - newAttempts,
      resetAt: new Date(new Date(existing.first_attempt_at).getTime() + config.windowMs),
    };
  } catch (e) {
    console.warn("DB rate limiting check error:", e);
    return {
      allowed: true,
      remaining: config.maxAttempts - 1,
      resetAt: new Date(now.getTime() + config.windowMs),
    };
  }
}

/**
 * Reset rate limit for identifier (use after successful auth)
 */
export async function resetRateLimit(
  supabaseAdmin: any,
  identifier: string,
  attemptType = "password_reset",
): Promise<void> {
  try {
    if (supabaseAdmin?.from) {
      await supabaseAdmin
        .from("rate_limit_attempts")
        .delete()
        .eq("identifier", identifier)
        .eq("attempt_type", attemptType);
    }
  } catch (e) {
    console.warn("Reset rate limit error:", e);
  }
}
