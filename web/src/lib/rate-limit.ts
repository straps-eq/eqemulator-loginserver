import { cacheIncr, cacheTTL } from "./redis";

/**
 * Rate limiter backed by Redis (shared across processes) with
 * automatic in-memory fallback if Redis is unavailable.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ ok: boolean; remaining: number; retryAfterMs: number }> {
  const windowSec = Math.ceil(windowMs / 1000);
  const rlKey = `rl:${key}`;

  const count = await cacheIncr(rlKey, windowSec);

  if (count > limit) {
    const ttl = await cacheTTL(rlKey);
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: ttl > 0 ? ttl : windowMs,
    };
  }

  return { ok: true, remaining: limit - count, retryAfterMs: 0 };
}
