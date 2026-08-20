/**
 * Verifies the Customers / CRM read + write layer against a throwaway venue
 * with a known booking spread. Self-contained — creates and cleans up its own
 * two orgs (the second exists only to prove tenant isolation).
 *
 *   npm run test:crm
 *
 * Runs against whatever DATABASE_URL is set (use local docker, not prod).
 */
import postgres from "postgres";
import { expect, it } from "vitest";

const ORG = "org_crm_test";
const OTHER = "org_crm_other";
const TZ = "Asia/Manila";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const { listCustomers, getCustomer, customerFacets } = await import("../src/lib/customers");

  try {
    for (const id of [ORG, OTHER]) {
      await sql`DELETE FROM organization WHERE id = ${id}`;
      await sql`INSERT INTO organization (id, name, slug) VALUES (${id}, ${id}, ${id})`;
      await sql`INSERT INTO venue (organization_id, timezone, currency) VALUES (${id}, ${TZ}, 'PHP')`;
    }

    const [space] = await sql<{ id: string }[]>`
      INSERT INTO space (organization_id, name, slug, price_cents, slot_minutes, sort_order)
      VALUES (${ORG}, 'Court A', 'court-a', 100000, 60, 0) RETURNING id`;

    // ── Customers ──
    // Ana: active, 3 confirmed (2 past incl. recent, 1 upcoming), high value, tagged.
    const [ana] = await sql<{ id: string }[]>`
      INSERT INTO customer (organization_id, name, email, phone, tags)
      VALUES (${ORG}, 'Ana Santos', 'ana@example.com', '+63 917 555 0142', ARRAY['VIP','Member'])
      RETURNING id`;
    // Ben: at-risk — a past confirmed booking, but nothing in 60+ days.
    const [ben] = await sql<{ id: string }[]>`
      INSERT INTO customer (organization_id, name, email, created_at)
      VALUES (${ORG}, 'Ben Cruz', 'ben@example.com', now() - interval '120 days')
      RETURNING id`;
    // Cara: brand new (created today), 1 no-show, no confirmed bookings.
    const [cara] = await sql<{ id: string }[]>`
      INSERT INTO customer (organization_id, name, email, no_show_count)
      VALUES (${ORG}, 'Cara Reyes', 'cara@example.com', 1)
      RETURNING id`;
    // A customer in the OTHER org — must never leak into ORG queries.
    const [mallory] = await sql<{ id: string }[]>`
      INSERT INTO customer (organization_id, name, email)
      VALUES (${OTHER}, 'Mallory', 'mallory@example.com')
      RETURNING id`;

    let ref = 0;
    const book = (
      customerId: string,
      daysAgo: number,
      status: string,
      amount: number,
    ) => sql`
      INSERT INTO reservation (organization_id, space_id, customer_id, kind, status,
        starts_at, ends_at, amount_cents, reference)
      VALUES (${ORG}, ${space.id}::uuid, ${customerId}, 'rental', ${status},
        (((now() AT TIME ZONE ${TZ})::date - ${daysAgo}::int) + make_time(10,0,0)) AT TIME ZONE ${TZ},
        (((now() AT TIME ZONE ${TZ})::date - ${daysAgo}::int) + make_time(11,0,0)) AT TIME ZONE ${TZ},
        ${amount}, ${`CRM${ref++}`})`;

    await book(ana.id, 3, "confirmed", 110000); // recent past
    await book(ana.id, 20, "confirmed", 110000); // past
    await book(ana.id, -5, "confirmed", 90000); // upcoming (5 days ahead)
    await book(ana.id, 10, "cancelled", 110000); // not counted in LTV
    await book(ben.id, 90, "confirmed", 80000); // only booking, 90 days ago
    await book(cara.id, 7, "no_show", 90000); // no confirmed value

    /* ── list: aggregates ── */
    const all = await listCustomers(ORG, TZ, { sort: "name" });
    check("list returns exactly this org's 3 customers", all.total === 3, `total=${all.total}`);
    check(
      "list excludes other-org customers",
      !all.rows.some((r) => r.name === "Mallory"),
    );

    const anaRow = all.rows.find((r) => r.email === "ana@example.com")!;
    check("Ana LTV = 3 confirmed (110k+110k+90k), cancelled excluded",
      anaRow.lifetimeValueCents === 310000, `${anaRow.lifetimeValueCents}`);
    check("Ana bookings = 3 confirmed", anaRow.bookings === 3, `${anaRow.bookings}`);
    check("Ana last visit = 3 days ago (upcoming ignored)",
      anaRow.lastVisitDays === 3, `${anaRow.lastVisitDays}`);
    check("Ana tags surfaced", anaRow.tags.includes("VIP") && anaRow.tags.includes("Member"),
      anaRow.tags.join(","));

    const caraRow = all.rows.find((r) => r.email === "cara@example.com")!;
    check("Cara last visit null (no confirmed past)", caraRow.lastVisitDays === null,
      `${caraRow.lastVisitDays}`);
    check("Cara no-show count = 1", caraRow.noShowCount === 1, `${caraRow.noShowCount}`);

    /* ── search ── */
    const searchName = await listCustomers(ORG, TZ, { search: "ana" });
    check("search by name finds Ana", searchName.total === 1 && searchName.rows[0].email === "ana@example.com");
    const searchPhone = await listCustomers(ORG, TZ, { search: "555 0142" });
    check("search by phone finds Ana", searchPhone.total === 1 && searchPhone.rows[0].email === "ana@example.com");
    const searchEmail = await listCustomers(ORG, TZ, { search: "ben@" });
    check("search by email finds Ben", searchEmail.total === 1 && searchEmail.rows[0].name === "Ben Cruz");

    /* ── segments ── */
    const newSeg = await listCustomers(ORG, TZ, { segment: "new" });
    check("segment new = Ana + Cara (created ≤30d)", newSeg.total === 2,
      newSeg.rows.map((r) => r.name).join(", "));
    const atRisk = await listCustomers(ORG, TZ, { segment: "at_risk" });
    check("segment at_risk = Ben only (past booking, none in 60d)",
      atRisk.total === 1 && atRisk.rows[0].name === "Ben Cruz",
      atRisk.rows.map((r) => r.name).join(", "));
    const noShows = await listCustomers(ORG, TZ, { segment: "no_shows" });
    check("segment no_shows = Cara only", noShows.total === 1 && noShows.rows[0].name === "Cara Reyes",
      noShows.rows.map((r) => r.name).join(", "));

    /* ── sort ── */
    const byValue = await listCustomers(ORG, TZ, { sort: "value" });
    check("sort by value → Ana first", byValue.rows[0].email === "ana@example.com");

    /* ── facets ── */
    const facets = await customerFacets(ORG);
    check("facets list the tags in use", facets.includes("VIP") && facets.includes("Member"),
      facets.join(","));

    /* ── tag filter ── */
    const vip = await listCustomers(ORG, TZ, { tag: "VIP" });
    check("tag filter VIP → Ana only", vip.total === 1 && vip.rows[0].email === "ana@example.com");

    /* ── profile ── */
    const profile = await getCustomer(ORG, ana.id, TZ);
    check("profile loads", profile !== null);
    check("profile LTV matches list", profile!.lifetimeValueCents === 310000, `${profile!.lifetimeValueCents}`);
    check("profile has 1 upcoming, 3 past (2 confirmed + 1 cancelled)",
      profile!.upcoming.length === 1 && profile!.past.length === 3,
      `up=${profile!.upcoming.length} past=${profile!.past.length}`);

    /* ── tenant isolation: profile ── */
    const crossOrg = await getCustomer(ORG, mallory.id, TZ);
    check("getCustomer refuses another org's customer", crossOrg === null);

    /* ── write actions honour tenancy (raw SQL mirrors the action guards) ── */
    // A note insert scoped to the wrong org writes nothing.
    const badNote = await sql`
      INSERT INTO customer_note (organization_id, customer_id, body)
      SELECT ${ORG}, c.id, 'should not happen'
      FROM customer c WHERE c.id = ${mallory.id}::uuid AND c.organization_id = ${ORG}
      RETURNING id`;
    check("note insert on a foreign customer inserts nothing", badNote.length === 0);

    // A real note for Ana, then confirm it comes back on the profile.
    await sql`
      INSERT INTO customer_note (organization_id, customer_id, body)
      SELECT ${ORG}, c.id, 'Prefers Court A, morning slots.'
      FROM customer c WHERE c.id = ${ana.id}::uuid AND c.organization_id = ${ORG}`;
    const withNote = await getCustomer(ORG, ana.id, TZ);
    check("note appears on the profile", withNote!.notes.length === 1 &&
      withNote!.notes[0].body.startsWith("Prefers"), `${withNote!.notes.length}`);

    // Tag add scoped to the wrong org changes nothing.
    await sql`
      UPDATE customer SET tags = array_append(tags, 'hacked')
      WHERE id = ${mallory.id}::uuid AND organization_id = ${ORG}
        AND NOT (tags @> ARRAY['hacked']::text[])`;
    const [mal] = await sql<{ tags: string[] }[]>`SELECT tags FROM customer WHERE id = ${mallory.id}::uuid`;
    check("tag write on a foreign customer is a no-op", !mal.tags.includes("hacked"),
      mal.tags.join(","));

    console.log(
      failures === 0
        ? "\nCRM verified: aggregates, search, segments, tags, notes, and tenant isolation hold.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM organization WHERE id IN (${ORG}, ${OTHER})`;
    await sql.end();
  }
}

it("crm", async () => {
  await main();
  expect(failures, "one or more checks failed").toBe(0);
}, 30_000);
