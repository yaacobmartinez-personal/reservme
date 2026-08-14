import { sql } from "@/db";

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the window resets — for a Retry-After hint. */
  retryAfter: number;
  remaining: number;
};

/**
 * Fixed-window counter, decided in a single atomic upsert.
 *
 * The window rolls forward in place: if the stored window has expired the row
 * resets to 1, otherwise it increments. Two racing requests both run the same
 * upsert, so the count is exact under concurrency — no read-then-write gap.
 *
 * Fixed windows can allow a short burst across a boundary (up to ~2× at the
 * seam), which is fine for the abuse we're guarding: stopping a script from
 * filling a calendar, not metering a paid API.
 */
export async function rateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const [row] = await sql<{ count: number; age_seconds: number }[]>`
    INSERT INTO rate_limit (bucket, window_start, count)
    VALUES (${bucket}, now(), 1)
    ON CONFLICT (bucket) DO UPDATE SET
      count = CASE
        WHEN rate_limit.window_start < now() - make_interval(secs => ${windowSeconds})
        THEN 1 ELSE rate_limit.count + 1 END,
      window_start = CASE
        WHEN rate_limit.window_start < now() - make_interval(secs => ${windowSeconds})
        THEN now() ELSE rate_limit.window_start END
    RETURNING count, EXTRACT(EPOCH FROM now() - window_start)::int AS age_seconds
  `;

  const allowed = row.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - row.count),
    retryAfter: allowed ? 0 : Math.max(1, windowSeconds - row.age_seconds),
  };
}

/** Clears idle buckets. Wired into the worker's hold-sweep tick. */
export async function pruneRateLimits(olderThanSeconds = 3600): Promise<number> {
  const rows = await sql<{ bucket: string }[]>`
    DELETE FROM rate_limit
     WHERE window_start < now() - make_interval(secs => ${olderThanSeconds})
    RETURNING bucket
  `;
  return rows.length;
}
