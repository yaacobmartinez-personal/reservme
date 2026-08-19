/**
 * Verifies peak/off-peak pricing: a rule overrides the base price for matching
 * slots in BOTH the availability the customer sees and the amount they're
 * charged; non-matching slots keep the base price.
 *
 *   npm run test:pricing      (local: DATABASE_URL → docker, not Neon)
 */
import postgres from "postgres";

const ORG = "org_pricing_test";
const TZ = "Asia/Manila";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const { getDayAvailability } = await import("../src/lib/booking/availability");
  const { reserveSpace } = await import("../src/lib/booking/reserve");

  try {
    await sql`DELETE FROM organization WHERE id = ${ORG}`;
    await sql`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Pricing Test', ${ORG})`;
    await sql`INSERT INTO venue (organization_id, timezone, currency) VALUES (${ORG}, ${TZ}, 'PHP')`;
    const [space] = await sql<{ id: string }[]>`
      INSERT INTO space (organization_id, name, slug, price_cents, slot_minutes, sort_order)
      VALUES (${ORG}, 'Court 1', 'court-1', 90000, 60, 0) RETURNING id`; // base ₱900
    for (let w = 0; w < 7; w += 1) {
      await sql`INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at)
                VALUES (${space.id}::uuid, ${w}, '00:00', '23:59')`;
    }
    // Peak ₱1,400, every day 18:00–22:00.
    await sql`
      INSERT INTO pricing_rule (organization_id, space_id, label, weekdays, starts_at, ends_at, price_cents)
      VALUES (${ORG}, ${space.id}::uuid, 'Peak', ARRAY[0,1,2,3,4,5,6]::smallint[], '18:00', '22:00', 140000)`;

    const [{ d }] = await sql<{ d: string }[]>`
      SELECT to_char((now() AT TIME ZONE ${TZ})::date + 2, 'YYYY-MM-DD') AS d`;
    const at = async (hour: number): Promise<Date> => {
      const [r] = await sql<{ t: Date }[]>`
        SELECT (((now() AT TIME ZONE ${TZ})::date + 2) + make_time(${hour}::int,0,0)) AT TIME ZONE ${TZ} AS t`;
      return r.t;
    };

    /* ── availability reflects the rule ── */
    const slots = await getDayAvailability(ORG, space.id, d);
    const peak = slots.find((s) => s.label === "18:00");
    const off = slots.find((s) => s.label === "10:00");
    check("peak slot shows the rule price (₱1,400)", peak?.priceCents === 140000, `${peak?.priceCents}`);
    check("off-peak slot shows the base price (₱900)", off?.priceCents === 90000, `${off?.priceCents}`);

    /* ── the charge matches ── */
    const peakBooking = await reserveSpace({
      organizationId: ORG, spaceId: space.id, startsAt: await at(18), endsAt: await at(19),
      customer: { name: "Peak", email: "peak@x.com" },
    });
    check("a peak booking is charged the rule price", peakBooking.amountCents === 140000, `${peakBooking.amountCents}`);

    const offBooking = await reserveSpace({
      organizationId: ORG, spaceId: space.id, startsAt: await at(10), endsAt: await at(11),
      customer: { name: "Off", email: "off@x.com" },
    });
    check("an off-peak booking is charged the base price", offBooking.amountCents === 90000, `${offBooking.amountCents}`);

    console.log(
      failures === 0
        ? "\nPricing verified: rule price shown + charged for matching slots, base otherwise.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM organization WHERE id = ${ORG}`;
    await sql.end();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
