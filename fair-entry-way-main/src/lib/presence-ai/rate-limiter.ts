// ─────────────────────────────────────────────────────────────────
// Redis-backed sliding window rate limiter
// Falls back to in-memory for local dev (no Redis)
// ─────────────────────────────────────────────────────────────────

import { AI_CONFIG } from './config';

const { windowMs, maxRequests } = AI_CONFIG.rateLimit;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
  requestId: string;
}

// ── Redis Implementation ──────────────────────────────────────────

async function redisRateLimit(userId: string): Promise<RateLimitResult> {
  try {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });

    const key = `presence:rl:${userId}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Atomic sliding window using sorted set
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);          // remove old entries
    pipeline.zadd(key, { score: now, member: `${now}` });    // add current request
    pipeline.zcard(key);                                      // count in window
    pipeline.pexpire(key, windowMs);                          // auto-expire key

    const results = await pipeline.exec();
    const count = (results[2] as number) ?? 1;

    const requestId = crypto.randomUUID();

    if (count > maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetInMs: windowMs,
        requestId,
      };
    }

    return {
      allowed: true,
      remaining: maxRequests - count,
      resetInMs: windowMs,
      requestId,
    };
  } catch {
    return memoryRateLimit(userId);
  }
}

// ── In-Memory Fallback (dev/test) ─────────────────────────────────

interface WindowEntry {
  timestamps: number[];
}

const memStore = new Map<string, WindowEntry>();

function memoryRateLimit(userId: string): RateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;

  // Lazy cleanup if store exceeds 500 entries
  if (memStore.size > 500) {
    const cutoff = now - windowMs * 2;
    for (const [key, entry] of memStore.entries()) {
      if (!entry.timestamps.some((t) => t > cutoff)) {
        memStore.delete(key);
      }
    }
  }

  const entry = memStore.get(userId) ?? { timestamps: [] };
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);
  entry.timestamps.push(now);
  memStore.set(userId, entry);

  const count = entry.timestamps.length;
  const requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  if (count > maxRequests) {
    return { allowed: false, remaining: 0, resetInMs: windowMs, requestId };
  }

  return {
    allowed: true,
    remaining: maxRequests - count,
    resetInMs: windowMs,
    requestId,
  };
}

// ── Public API ────────────────────────────────────────────────────

export async function checkRateLimit(
  userId: string,
): Promise<RateLimitResult> {
  if (
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return redisRateLimit(userId);
  }
  return memoryRateLimit(userId);
}
