/**
 * Verifies src/lib/analytics.ts aggregations against a throwaway venue with a
 * known spread of bookings. Self-contained — creates and cleans up its own org.
 *
 *   npm run test:analytics
 *
 * Runs against whatever DATABASE_URL is set (use local docker, not prod).
 */
import postgres from "postgres";
import { expect, it } from "vitest";

const ORG = "org_analytics_test";
const TZ = "Asia/Manila";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const { getDashboard } = await import("../src/lib/analytics");

  try {
    await sql`DELETE FROM organization WHERE id = ${ORG}`;
    await sql`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Analytics Test', 'analytics-test')`;
    await sql`INSERT INTO venue (organization_id, timezone, currency) VALUES (${ORG}, ${TZ}, 'PHP')`;

    const [a] = await sql<{ id: string }[]>`
      INSERT INTO space (organization_id, name, slug, price_cents, slot_minutes, sort_order)
      VALUES (${ORG}, 'Court A', 'court-a', 100000, 60, 0) RETURNING id`;
    const [b] = await sql<{ id: string }[]>`
      INSERT INTO space (organization_id, name, slug, price_cents, slot_minutes, sort_order)
      VALUES (${ORG}, 'Court B', 'court-b', 60000, 60, 1) RETURNING id`;
    for (const s of [a.id, b.id]) {
      for (let w = 0; w < 7; w += 1) {
        await sql`INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at) VALUES (${s}::uuid, ${w}, '08:00', '22:00')`;
      }
    }

    const [alice] = await sql<{ id: string }[]>`
      INSERT INTO customer (organization_id, name, email) VALUES (${ORG}, 'Alice', 'alice@example.com') RETURNING id`;
    // Bob created 60 days ago → not "new"; give him a prior booking → "returning".
    const [bob] = await sql<{ id: string }[]>`
      INSERT INTO customer (organization_id, name, email, created_at)
      VALUES (${ORG}, 'Bob', 'bob@example.com', now() - interval '60 days') RETURNING id`;

    // Helper: insert a reservation at (today - daysAgo) local date, at localHour.
    // None are 'held', so hold_expires_at / checked_in_at just default to NULL.
    let ref = 0;
    const book = (
      spaceId: string,
      customerId: string | null,
      daysAgo: number,
      hour: number,
      status: string,
      amount: number,
    ) => sql`
      INSERT INTO reservation (organization_id, space_id, customer_id, kind, status,
        starts_at, ends_at, amount_cents, reference)
      VALUES (${ORG}, ${spaceId}::uuid, ${customerId}, 'rental', ${status},
        (((now() AT TIME ZONE ${TZ})::date - ${daysAgo}::int) + make_time(${hour}::int, 0, 0)) AT TIME ZONE ${TZ},
        (((now() AT TIME ZONE ${TZ})::date - ${daysAgo}::int) + make_time(${hour + 1}::int, 0, 0)) AT TIME ZONE ${TZ},
        ${amount}, ${`AN${ref++}`})`;

    // Current window (last 30d): 4 confirmed on A, 2 confirmed on B, 1 cancelled, 1 no-show.
    await book(a.id, alice.id, 2, 10, "confirmed", 100000);
    await book(a.id, alice.id, 5, 14, "confirmed", 100000);
    await book(a.id, bob.id, 8, 10, "confirmed", 100000);
    await book(a.id, bob.id, 1, 18, "confirmed", 100000);
    await book(b.id, alice.id, 3, 10, "confirmed", 60000);
    await book(b.id, bob.id, 6, 14, "confirmed", 60000);
    await book(b.id, alice.id, 4, 10, "cancelled", 60000);
    await book(a.id, bob.id, 7, 20, "no_show", 100000);
    // Bob's prior booking (before the window) → makes him returning.
    await book(a.id, bob.id, 45, 10, "confirmed", 100000);

    // Awaiting payment on one reservation (needs-you).
    const [pr] = await sql<{ id: string }[]>`SELECT id FROM reservation WHERE organization_id=${ORG} LIMIT 1`;
    await sql`INSERT INTO payment (organization_id, reservation_id, method, status, amount_cents)
              VALUES (${ORG}, ${pr.id}::uuid, 'gcash_proof', 'awaiting', 100000)`;

    /* ── Assert ── */
    const d = await getDashboard(ORG, TZ, 30);

    check(
      "booked value = confirmed amounts in window",
      d.kpis.bookedValueCents.value === 4 * 100000 + 2 * 60000,
      `${d.kpis.bookedValueCents.value} (expected 520000)`,
    );
    check("booking count = 6 confirmed in window", d.kpis.bookings.value === 6, `${d.kpis.bookings.value}`);
    check(
      "utilisation is a sane percentage (0–100)",
      d.kpis.utilisationPct.value >= 0 && d.kpis.utilisationPct.value <= 100 && d.kpis.utilisationPct.value > 0,
      `${d.kpis.utilisationPct.value}%`,
    );
    check(
      "booking mix counts",
      d.bookingMix.confirmed === 6 && d.bookingMix.cancelled === 1 && d.bookingMix.noShow === 1,
      JSON.stringify(d.bookingMix),
    );
    check(
      "no-show rate = 1/7 ≈ 14.3%",
      Math.abs(d.kpis.noShowRatePct.value - 14.3) < 0.5,
      `${d.kpis.noShowRatePct.value}%`,
    );
    const bySpace = new Map(d.bySpace.map((s) => [s.name, s.cents]));
    check("by-space: Court A = 400000", bySpace.get("Court A") === 400000, `${bySpace.get("Court A")}`);
    check("by-space: Court B = 120000", bySpace.get("Court B") === 120000, `${bySpace.get("Court B")}`);
    const heatTotal = d.peakHeatmap.flat().reduce((t, n) => t + n, 0);
    check("heatmap totals confirmed+no_show in window = 7", heatTotal === 7, `${heatTotal}`);
    check("customers: Alice counts as new", d.customers.newCount >= 1, `new=${d.customers.newCount}`);
    check("customers: Bob counts as returning", d.customers.returningCount >= 1, `returning=${d.customers.returningCount}`);
    check("customers: top list populated", d.customers.top.length >= 2, `${d.customers.top.length}`);
    check(
      "needs-you: one awaiting payment",
      d.needsYou.awaitingPayments.count === 1 && d.needsYou.awaitingPayments.cents === 100000,
      JSON.stringify(d.needsYou.awaitingPayments),
    );
    check("revenue series has 30 days", d.revenueSeries.length === 30, `${d.revenueSeries.length}`);

    console.log(
      failures === 0
        ? "\nAnalytics verified: aggregations match a known booking spread.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM organization WHERE id = ${ORG}`;
    await sql.end();
  }
}

it("analytics", async () => {
  await main();
  expect(failures, "one or more checks failed").toBe(0);
}, 30_000);
