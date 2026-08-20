/**
 * Verifies the waitlist: join (with dedupe), and that cancelling a booking
 * promotes the earliest overlapping waiter while leaving others untouched.
 *
 *   npm run test:waitlist       (local: DATABASE_URL → docker, not Neon)
 */
import postgres from "postgres";
import { expect, it } from "vitest";

const ORG = "org_waitlist_test";
const TZ = "Asia/Manila";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const { reserveSpace, cancelReservation } = await import("../src/lib/booking/reserve");
  const { joinWaitlist, promoteWaitlistForReservation } = await import("../src/lib/booking/waitlist");

  const statusOf = async (email: string) => {
    const [row] = await sql<{ status: string }[]>`
      SELECT w.status FROM waitlist w
      JOIN customer c ON c.id = w.customer_id
      WHERE w.organization_id = ${ORG} AND c.email = ${email}
      ORDER BY w.created_at DESC LIMIT 1`;
    return row?.status ?? null;
  };

  try {
    await sql`DELETE FROM organization WHERE id = ${ORG}`;
    await sql`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Waitlist Test', ${ORG})`;
    await sql`INSERT INTO venue (organization_id, timezone, currency) VALUES (${ORG}, ${TZ}, 'PHP')`;
    const [space] = await sql<{ id: string }[]>`
      INSERT INTO space (organization_id, name, slug, price_cents, slot_minutes, sort_order)
      VALUES (${ORG}, 'Court 1', 'court-1', 90000, 60, 0) RETURNING id`;
    for (let w = 0; w < 7; w += 1) {
      await sql`INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at)
                VALUES (${space.id}::uuid, ${w}, '00:00', '23:59')`;
    }
    const at = async (dayOffset: number, hour: number): Promise<Date> => {
      const [r] = await sql<{ t: Date }[]>`
        SELECT (((now() AT TIME ZONE ${TZ})::date + ${dayOffset}::int) + make_time(${hour}::int,0,0))
                 AT TIME ZONE ${TZ} AS t`;
      return r.t;
    };
    const s1s = await at(2, 10);
    const s1e = new Date(s1s.getTime() + 3600_000);
    const s2s = await at(2, 14);
    const s2e = new Date(s2s.getTime() + 3600_000);

    /* ── book the 10:00 slot so it's taken ── */
    const booking = await reserveSpace({
      organizationId: ORG, spaceId: space.id, startsAt: s1s, endsAt: s1e,
      customer: { name: "Booker", email: "booker@x.com" },
    });

    /* ── two waiters for 10:00, one for 14:00 ── */
    await joinWaitlist({ organizationId: ORG, spaceId: space.id, startsAt: s1s, endsAt: s1e, customer: { name: "Ann", email: "ann@x.com" } });
    // Make Ann strictly earliest.
    await sql`UPDATE waitlist SET created_at = now() - interval '2 minutes'
              WHERE customer_id = (SELECT id FROM customer WHERE organization_id=${ORG} AND email='ann@x.com')`;
    await joinWaitlist({ organizationId: ORG, spaceId: space.id, startsAt: s1s, endsAt: s1e, customer: { name: "Ben", email: "ben@x.com" } });
    await joinWaitlist({ organizationId: ORG, spaceId: space.id, startsAt: s2s, endsAt: s2e, customer: { name: "Cy", email: "cy@x.com" } });

    const [{ n }] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM waitlist WHERE organization_id=${ORG}`;
    check("three waiting entries", n === "3", n);

    /* ── dedupe: Ann joins 10:00 again ── */
    const again = await joinWaitlist({ organizationId: ORG, spaceId: space.id, startsAt: s1s, endsAt: s1e, customer: { name: "Ann", email: "ann@x.com" } });
    check("re-joining the same slot is a no-op", again.already === true);
    const [{ n: n2 }] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM waitlist WHERE organization_id=${ORG}`;
    check("no duplicate waiting row", n2 === "3", n2);

    /* ── cancel the booking → promote the earliest overlapping waiter ── */
    await cancelReservation(ORG, booking.id);
    const promoted = await promoteWaitlistForReservation(ORG, booking.id);
    check("promotion notified someone", promoted.notified === true);
    check("the earliest waiter (Ann) is notified", (await statusOf("ann@x.com")) === "notified");
    check("the later waiter (Ben) still waits", (await statusOf("ben@x.com")) === "waiting");
    check("a non-overlapping waiter (Cy, 14:00) is untouched", (await statusOf("cy@x.com")) === "waiting");

    console.log(
      failures === 0
        ? "\nWaitlist verified: join + dedupe, cancel promotes the earliest overlapping waiter, others untouched.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM organization WHERE id = ${ORG}`;
    await sql.end();
  }
}

it("waitlist", async () => {
  await main();
  expect(failures, "one or more checks failed").toBe(0);
}, 30_000);
