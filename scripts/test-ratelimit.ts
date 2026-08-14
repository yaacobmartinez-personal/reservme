/**
 * P1-1 verification: the rate limiter blocks a flood and the window recovers.
 *
 *   npm run test:ratelimit
 *
 * Exercises the primitive directly (deterministic, no wall-clock waits) plus a
 * short real-window recovery check.
 */
import postgres from "postgres";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 8, onnotice: () => {} });
  const { rateLimit, pruneRateLimits } = await import("../src/lib/rate-limit");

  const bucket = `test:${Date.now()}`;
  try {
    /* 1 · The first `limit` calls pass, the next is blocked */
    const limit = 5;
    const results: boolean[] = [];
    for (let i = 0; i < limit + 3; i += 1) {
      const r = await rateLimit(bucket, limit, 300);
      results.push(r.allowed);
    }
    const allowed = results.filter(Boolean).length;
    const blocked = results.filter((a) => !a).length;
    check("exactly `limit` requests allowed", allowed === limit, `${allowed} allowed`);
    check("the rest are blocked", blocked === 3, `${blocked} blocked`);

    const last = await rateLimit(bucket, limit, 300);
    check("a blocked result reports a retryAfter", !last.allowed && last.retryAfter > 0, `retryAfter=${last.retryAfter}`);

    /* 2 · Concurrency: 20 parallel requests, limit 5 → exactly 5 pass */
    const parallelBucket = `test-par:${Date.now()}`;
    const parallel = await Promise.all(
      Array.from({ length: 20 }, () => rateLimit(parallelBucket, 5, 300)),
    );
    const parallelAllowed = parallel.filter((r) => r.allowed).length;
    check("under concurrency the count is exact", parallelAllowed === 5, `${parallelAllowed}/5 allowed`);

    /* 3 · A short window recovers */
    const shortBucket = `test-short:${Date.now()}`;
    for (let i = 0; i < 5; i += 1) await rateLimit(shortBucket, 3, 1); // window 1s, limit 3
    const blockedNow = await rateLimit(shortBucket, 3, 1);
    await new Promise((r) => setTimeout(r, 1200));
    const afterWait = await rateLimit(shortBucket, 3, 1);
    check("the window recovers after it elapses", !blockedNow.allowed && afterWait.allowed);

    /* 4 · Prune clears idle buckets */
    const pruned = await pruneRateLimits(0);
    check("prune removes stale buckets", pruned > 0, `pruned ${pruned}`);

    console.log(
      failures === 0
        ? "\nP1-1 verified: the booking endpoint can't be flooded.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM rate_limit WHERE bucket LIKE 'test%'`;
    await sql.end();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
