/**
 * Verifies engagement + loyalty:
 *   - accrueLoyalty awards 1 point per ₱100 of confirmed bookings, is idempotent
 *     (a second run adds nothing), and skips already-accounted history.
 *   - sendWinbacks emails an opted-in, lapsed customer once (winback_at set),
 *     and leaves a recent or opted-out customer alone.
 *   - sendReviewRequests asks once per completed booking, only when the venue
 *     has a review link and the customer opted in.
 *
 *   npm run test:engagement    (local: DATABASE_URL → docker, not Neon)
 */
import postgres from "postgres";
import { expect, it } from "vitest";

const ORG = "org_engage_test";
const TZ = "Asia/Manila";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const { accrueLoyalty, sendWinbacks, sendReviewRequests } = await import("../src/lib/engagement");

  const customer = async (name: string, optIn: boolean) => {
    const [c] = await sql<{ id: string }[]>`
      INSERT INTO customer (organization_id, name, email, marketing_opt_in)
      VALUES (${ORG}, ${name}, ${`${name}@x.com`}, ${optIn}) RETURNING id`;
    return c.id;
  };
  // A confirmed booking, N days ago at the given hour (distinct hours keep the
  // no-overlap constraint happy on a shared space). loyalty_accrued starts false
  // so the accrual job will pick it up (unlike backfilled history).
  const booking = async (
    spaceId: string,
    customerId: string,
    daysAgo: number,
    amountCents: number,
    hour: number,
  ) => {
    const [r] = await sql<{ id: string }[]>`
      INSERT INTO reservation (
        organization_id, space_id, customer_id, kind, status,
        starts_at, ends_at, amount_cents, reference
      )
      VALUES (
        ${ORG}, ${spaceId}::uuid, ${customerId}::uuid, 'rental', 'confirmed',
        (((now() AT TIME ZONE ${TZ})::date - ${daysAgo}::int) + make_time(${hour}::int,0,0)) AT TIME ZONE ${TZ},
        (((now() AT TIME ZONE ${TZ})::date - ${daysAgo}::int) + make_time(${hour}::int,0,0)) AT TIME ZONE ${TZ} + interval '1 hour',
        ${amountCents}, ${"REF-" + Math.random().toString(36).slice(2, 10)}
      ) RETURNING id`;
    return r.id;
  };

  try {
    await sql`DELETE FROM organization WHERE id = ${ORG}`;
    await sql`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Engage Test', ${ORG})`;
    await sql`INSERT INTO venue (organization_id, timezone, currency) VALUES (${ORG}, ${TZ}, 'PHP')`;
    const [space] = await sql<{ id: string }[]>`
      INSERT INTO space (organization_id, name, slug, price_cents, slot_minutes, sort_order)
      VALUES (${ORG}, 'Court 1', 'court-1', 90000, 60, 0) RETURNING id`;

    /* ── loyalty accrual ── */
    const loyal = await customer("Loyal", true);
    await booking(space.id, loyal, 5, 90000, 10); // ₱900 → 9 pts
    await booking(space.id, loyal, 3, 45000, 10); // ₱450 → 4 pts
    // Pre-existing history that predates loyalty must not be awarded.
    const historic = await booking(space.id, loyal, 400, 100000, 10);
    await sql`UPDATE reservation SET loyalty_accrued = true WHERE id = ${historic}::uuid`;

    const first = await accrueLoyalty();
    const [{ pts }] = await sql<{ pts: number }[]>`SELECT loyalty_points AS pts FROM customer WHERE id = ${loyal}::uuid`;
    check("loyalty awards 1 point per ₱100", pts === 13, `${pts}`);
    check("accrual reports the points it awarded", first.points === 13, `${first.points}`);

    const second = await accrueLoyalty();
    const [{ pts: pts2 }] = await sql<{ pts: number }[]>`SELECT loyalty_points AS pts FROM customer WHERE id = ${loyal}::uuid`;
    check("re-running accrual awards nothing", second.points === 0 && pts2 === 13, `${pts2}`);

    /* ── win-back ── */
    const lapsed = await customer("Lapsed", true); // opted in, 200 days ago
    await booking(space.id, lapsed, 200, 90000, 10);
    const recent = await customer("Recent", true); // opted in, 3 days ago
    await booking(space.id, recent, 3, 90000, 12);
    const lapsedNoOptIn = await customer("Quiet", false); // lapsed but opted out
    await booking(space.id, lapsedNoOptIn, 200, 90000, 12);

    const winbacks = await sendWinbacks();
    check("only the lapsed, opted-in customer is nudged", winbacks === 1, `${winbacks}`);
    const [{ w }] = await sql<{ w: Date | null }[]>`SELECT winback_at AS w FROM customer WHERE id = ${lapsed}::uuid`;
    check("nudged customer is stamped winback_at", w !== null);
    const [{ w: rw }] = await sql<{ w: Date | null }[]>`SELECT winback_at AS w FROM customer WHERE id = ${recent}::uuid`;
    check("a recent customer is left alone", rw === null);

    check("re-running win-back nudges no one again", (await sendWinbacks()) === 0);

    /* ── review requests ── */
    // No review link set yet: nobody is asked.
    const visitor = await customer("Visitor", true);
    const visit = await booking(space.id, visitor, 0, 90000, 3); // early today
    await sql`UPDATE reservation
              SET starts_at = now() - interval '4 hours', ends_at = now() - interval '3 hours'
              WHERE id = ${visit}::uuid`;
    check("no review requests without a review link", (await sendReviewRequests()) === 0);

    await sql`UPDATE venue SET review_url = 'https://g.page/r/example/review' WHERE organization_id = ${ORG}`;
    const asked = await sendReviewRequests();
    check("a completed visit is asked once the link is set", asked === 1, `${asked}`);
    const [{ rq }] = await sql<{ rq: Date | null }[]>`SELECT review_requested_at AS rq FROM reservation WHERE id = ${visit}::uuid`;
    check("asked booking is stamped review_requested_at", rq !== null);
    check("re-running review requests asks no one again", (await sendReviewRequests()) === 0);

    console.log(
      failures === 0
        ? "\nEngagement verified: loyalty accrual, win-back, review requests — all idempotent.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM organization WHERE id = ${ORG}`;
    await sql.end();
  }
}

it("engagement + loyalty", async () => {
  await main();
  expect(failures, "one or more checks failed").toBe(0);
}, 30_000);
