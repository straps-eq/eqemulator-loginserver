/**
 * Redis client with graceful in-memory fallback.
 * If REDIS_URL is not set or Redis is unreachable, all operations
 * silently fall back to in-memory Maps (single-process only).
 */
import Redis from "ioredis";

let redis: Redis | null = null;
let redisAvailable = false;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    redis.on("connect", () => { redisAvailable = true; });
    redis.on("error", () => { redisAvailable = false; });
    redis.on("close", () => { redisAvailable = false; });

    redis.connect().catch(() => { redisAvailable = false; });
  } catch {
    redis = null;
  }

  return redis;
}

// ── In-memory fallbacks ──

const memCache = new Map<string, { value: string; expiresAt: number }>();

// Prune expired in-memory entries every 60s
setInterval(() => {
  const now = Date.now();
  const expired: string[] = [];
  memCache.forEach((v, k) => { if (now > v.expiresAt) expired.push(k); });
  expired.forEach((k) => memCache.delete(k));
}, 60_000);

// ── Public API ──

/** Set a key with TTL (seconds). Returns true on success. */
export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  const r = getRedis();
  if (r && redisAvailable) {
    try {
      await r.set(key, value, "EX", ttlSeconds);
      return true;
    } catch { /* fall through to memory */ }
  }
  memCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  return true;
}

/** Get a key. Returns null if not found or expired. */
export async function cacheGet(key: string): Promise<string | null> {
  const r = getRedis();
  if (r && redisAvailable) {
    try {
      return await r.get(key);
    } catch { /* fall through to memory */ }
  }
  const entry = memCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) memCache.delete(key);
    return null;
  }
  return entry.value;
}

/** Check if a key exists. */
export async function cacheExists(key: string): Promise<boolean> {
  const r = getRedis();
  if (r && redisAvailable) {
    try {
      return (await r.exists(key)) === 1;
    } catch { /* fall through to memory */ }
  }
  const entry = memCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) memCache.delete(key);
    return false;
  }
  return true;
}

/** Increment a key, setting initial value and TTL if it doesn't exist. Returns new value. */
export async function cacheIncr(key: string, ttlSeconds: number): Promise<number> {
  const r = getRedis();
  if (r && redisAvailable) {
    try {
      const val = await r.incr(key);
      if (val === 1) await r.expire(key, ttlSeconds);
      return val;
    } catch { /* fall through to memory */ }
  }
  const entry = memCache.get(key);
  const now = Date.now();
  if (!entry || now > entry.expiresAt) {
    memCache.set(key, { value: "1", expiresAt: now + ttlSeconds * 1000 });
    return 1;
  }
  const newVal = parseInt(entry.value, 10) + 1;
  entry.value = String(newVal);
  return newVal;
}

/** Get the TTL remaining on a key in milliseconds. -1 if no TTL, -2 if key doesn't exist. */
export async function cacheTTL(key: string): Promise<number> {
  const r = getRedis();
  if (r && redisAvailable) {
    try {
      const ttl = await r.pttl(key);
      return ttl;
    } catch { /* fall through to memory */ }
  }
  const entry = memCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) return -2;
  return entry.expiresAt - Date.now();
}

/** Whether Redis is connected (vs in-memory fallback). */
export function isRedisConnected(): boolean {
  return redisAvailable;
}
