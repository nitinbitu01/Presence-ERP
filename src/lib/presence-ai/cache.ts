// ─────────────────────────────────────────────────────────────────
// Redis-backed semantic cache with in-memory fallback
// Key insight: cache by (userId + question hash), NOT full history
// because multi-turn responses are inherently unique
// ─────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import { AI_CONFIG } from './config';

const { ttlMs } = AI_CONFIG.cache;

export interface CachedResponse {
  answer: string;
  sources: unknown[];
  model: string;
}

function makeKey(userId: string, question: string): string {
  const normalized = question.toLowerCase().trim().replace(/\s+/g, ' ');
  const hash = crypto
    .createHash('sha256')
    .update(`${userId}::${normalized}`)
    .digest('hex');
  return `presence:cache:${hash}`;
}

// ── Redis Cache ───────────────────────────────────────────────────

async function redisGet(key: string): Promise<CachedResponse | null> {
  try {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
    const raw = await redis.get<CachedResponse>(key);
    return raw ?? null;
  } catch {
    return memGet(key);
  }
}

async function redisSet(key: string, value: CachedResponse): Promise<void> {
  try {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
    await redis.set(key, value, { px: ttlMs });
  } catch {
    memSet(key, value);
  }
}

// ── In-Memory Fallback ────────────────────────────────────────────

interface MemEntry {
  value: CachedResponse;
  expiresAt: number;
}

const memCache = new Map<string, MemEntry>();
const MAX_MEM = AI_CONFIG.cache.maxSize;

function memGet(key: string): CachedResponse | null {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memCache.delete(key);
    return null;
  }
  // LRU: re-insert
  memCache.delete(key);
  memCache.set(key, entry);
  return entry.value;
}

function memSet(key: string, value: CachedResponse): void {
  if (memCache.size >= MAX_MEM) {
    const oldest = memCache.keys().next().value;
    if (oldest) memCache.delete(oldest);
  }
  memCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// ── Public API ────────────────────────────────────────────────────

const useRedis =
  !!process.env.UPSTASH_REDIS_REST_URL &&
  !!process.env.UPSTASH_REDIS_REST_TOKEN;

export async function getCached(
  userId: string,
  question: string,
): Promise<CachedResponse | null> {
  const key = makeKey(userId, question);
  return useRedis ? redisGet(key) : memGet(key);
}

export async function setCached(
  userId: string,
  question: string,
  value: CachedResponse,
): Promise<void> {
  const key = makeKey(userId, question);
  return useRedis ? redisSet(key, value) : void memSet(key, value);
}
