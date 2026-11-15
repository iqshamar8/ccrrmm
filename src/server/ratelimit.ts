/**
 * Fixed-window rate limiter stored in PostgreSQL, so limits hold across every
 * server instance and restart. One atomic UPSERT per check.
 */
import { withPlatform } from "./db";
import { AppError } from "./errors";

export async function hit(key: string, limit: number, windowSec: number) {
  const rows = await withPlatform((tx) => tx.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO "RateLimit" (key, "windowStart", count) VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSec}) THEN 1 ELSE "RateLimit".count + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSec}) THEN now() ELSE "RateLimit"."windowStart" END
    RETURNING count, "windowStart"`);
  const r = rows[0];
  const retryAfter = Math.max(1, Math.ceil((+r.windowStart + windowSec * 1000 - Date.now()) / 1000));
  return { allowed: r.count <= limit, count: r.count, retryAfter };
}

/** Throws 429 when `key` exceeded `limit` hits in the current window. */
export async function rateLimit(key: string, limit: number, windowSec: number) {
  const r = await hit(key, limit, windowSec);
  if (!r.allowed) throw new AppError(429, "RATE_LIMIT", `Too many requests — try again in ${r.retryAfter}s`, { retryAfter: r.retryAfter });
  return r;
}

export async function resetLimit(key: string) {
  await withPlatform((tx) => tx.rateLimit.deleteMany({ where: { key } }));
}

/** Housekeeping: drop windows older than a day. */
export async function pruneRateLimits() {
  return withPlatform((tx) => tx.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 86400000) } } }));
}
