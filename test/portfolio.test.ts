/**
 * Verifies multi-location: a user in two venues sees both in the roll-up with
 * correct per-venue stats + totals; another user's venue isn't included.
 *
 *   npm run test:portfolio     (local: DATABASE_URL → docker, not Neon)
 */
import postgres from "postgres";
import { expect, it } from "vitest";

const A = "org_pf_a";
const B = "org_pf_b";
const C = "org_pf_c";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const { listUserVenues, portfolioRollup } = await import("../src/lib/portfolio");

  const u1 = `pf_u1_${Date.now()}`;
  const u2 = `pf_u2_${Date.now()}`;

  const mkUser = async (id: string) =>
    sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
        VALUES (${id}, ${id}, ${id + "@x.com"}, true, now(), now())`;
  const mkOrg = async (id: string, name: string, userId: string, spaces: number) => {
    await sql`DELETE FROM organization WHERE id = ${id}`;
    await sql`INSERT INTO organization (id, name, slug) VALUES (${id}, ${name}, ${id})`;
    await sql`INSERT INTO venue (organization_id) VALUES (${id})`;
    await sql`INSERT INTO member (id, organization_id, user_id, role, created_at)
              VALUES (${"m_" + Math.random().toString(36).slice(2)}, ${id}, ${userId}, 'owner', now())`;
    for (let i = 0; i < spaces; i += 1) {
      await sql`INSERT INTO space (organization_id, name, slug, price_cents, sort_order, is_active)
                VALUES (${id}, ${"S" + i}, ${"s" + i}, 90000, ${i}, true)`;
    }
  };
  const book = (org: string, spaceSlug: string, daysFromNow: number, amount: number, ref: string) => sql`
    INSERT INTO reservation (organization_id, space_id, kind, status, starts_at, ends_at, amount_cents, reference)
    SELECT ${org}, s.id, 'rental', 'confirmed',
      now() + (${daysFromNow}::text || ' days')::interval,
      now() + (${daysFromNow}::text || ' days')::interval + interval '1 hour',
      ${amount}, ${ref}
    FROM space s WHERE s.organization_id = ${org} AND s.slug = ${spaceSlug}`;

  try {
    await mkUser(u1);
    await mkUser(u2);
    await mkOrg(A, "Alpha Courts", u1, 2);
    await mkOrg(B, "Bravo Studio", u1, 1);
    await mkOrg(C, "Charlie (other owner)", u2, 1);

    await book(A, "s0", 2, 100000, "PFA1"); // upcoming + counts in 30d
    await book(A, "s0", -2, 60000, "PFA2"); // past, still in 30d window

    const venues = await listUserVenues(u1);
    check("listUserVenues returns both of the user's venues", venues.length === 2);
    check("it excludes another owner's venue", venues.every((v) => v.organizationId !== C));

    const p = await portfolioRollup(u1);
    check("roll-up has 2 venues", p.totals.venues === 2, `${p.totals.venues}`);
    const alpha = p.venues.find((v) => v.organizationId === A)!;
    check("Alpha: 2 active spaces", alpha.activeSpaces === 2, `${alpha.activeSpaces}`);
    check("Alpha: 1 upcoming", alpha.upcoming === 1, `${alpha.upcoming}`);
    check("Alpha: 2 bookings in 30d", alpha.bookings30 === 2, `${alpha.bookings30}`);
    check("Alpha: ₱1,600 booked value (30d)", alpha.revenue30Cents === 160000, `${alpha.revenue30Cents}`);
    const bravo = p.venues.find((v) => v.organizationId === B)!;
    check("Bravo: no bookings yet", bravo.bookings30 === 0 && bravo.upcoming === 0);

    check("totals sum across venues", p.totals.upcoming === 1 && p.totals.bookings30 === 2 && p.totals.revenue30Cents === 160000);

    console.log(
      failures === 0
        ? "\nMulti-location verified: per-venue stats + totals, owner isolation.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM organization WHERE id IN (${A}, ${B}, ${C})`;
    await sql`DELETE FROM "user" WHERE id IN (${u1}, ${u2})`;
    await sql.end();
  }
}

it("portfolio", async () => {
  await main();
  expect(failures, "one or more checks failed").toBe(0);
}, 30_000);
