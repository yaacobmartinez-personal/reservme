/**
 * Verifies promo codes: validation (unknown / expired / paused / used-up /
 * case-insensitive), the discount maths (percent, fixed amount, capped at the
 * booking total), and that consumption is atomic — a capped code can't be
 * redeemed past its limit and each use records a redemption row.
 *
 *   npm run test:promo      (local: DATABASE_URL → docker, not Neon)
 */
import postgres from "postgres";

const ORG = "org_promo_test";
const TZ = "Asia/Manila";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const { validatePromo, consumePromo, listPromoCodes } = await import("../src/lib/promo");
  const { reserveSpace } = await import("../src/lib/booking/reserve");

  try {
    await sql`DELETE FROM organization WHERE id = ${ORG}`;
    await sql`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Promo Test', ${ORG})`;
    await sql`INSERT INTO venue (organization_id, timezone, currency) VALUES (${ORG}, ${TZ}, 'PHP')`;
    const [space] = await sql<{ id: string }[]>`
      INSERT INTO space (organization_id, name, slug, price_cents, slot_minutes, sort_order)
      VALUES (${ORG}, 'Court 1', 'court-1', 90000, 60, 0) RETURNING id`;
    for (let w = 0; w < 7; w += 1) {
      await sql`INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at)
                VALUES (${space.id}::uuid, ${w}, '00:00', '23:59')`;
    }

    // A real reservation to hang redemptions off (reservation_id has an FK).
    const [r] = await sql<{ t: Date }[]>`
      SELECT (((now() AT TIME ZONE ${TZ})::date + 2) + make_time(10,0,0)) AT TIME ZONE ${TZ} AS t`;
    const [r2] = await sql<{ t: Date }[]>`
      SELECT (((now() AT TIME ZONE ${TZ})::date + 2) + make_time(11,0,0)) AT TIME ZONE ${TZ} AS t`;
    const booking = await reserveSpace({
      organizationId: ORG, spaceId: space.id, startsAt: r.t, endsAt: r2.t,
      customer: { name: "Redeemer", email: "redeem@x.com" },
    });
    const RID = booking.id;

    // Seed codes.
    await sql`INSERT INTO promo_code (organization_id, code, kind, value) VALUES (${ORG}, 'SAVE10', 'percent', 10)`;
    await sql`INSERT INTO promo_code (organization_id, code, kind, value, max_uses) VALUES (${ORG}, 'BIG', 'amount', 10000, 2)`;
    await sql`INSERT INTO promo_code (organization_id, code, kind, value, expires_at) VALUES (${ORG}, 'OLD', 'percent', 50, now() - interval '1 day')`;
    await sql`INSERT INTO promo_code (organization_id, code, kind, value, active) VALUES (${ORG}, 'PAUSED', 'percent', 20, false)`;

    /* ── validation ── */
    check("unknown code is rejected", !(await validatePromo(ORG, "NOPE")).ok);
    check("live code validates", (await validatePromo(ORG, "SAVE10")).ok);
    check("expired code is rejected", !(await validatePromo(ORG, "OLD")).ok);
    check("paused code is rejected", !(await validatePromo(ORG, "PAUSED")).ok);
    check("validation is case-insensitive", (await validatePromo(ORG, "save10")).ok);

    /* ── discount maths ── */
    const pct = await consumePromo(ORG, "SAVE10", RID, 90000);
    check("percent discount is 10% of the total", pct?.discountCents === 9000, `${pct?.discountCents}`);

    const capped = await consumePromo(ORG, "BIG", RID, 5000);
    check("fixed discount is capped at the total", capped?.discountCents === 5000, `${capped?.discountCents}`);

    const full = await consumePromo(ORG, "BIG", RID, 30000);
    check("fixed discount below the total is the full amount", full?.discountCents === 10000, `${full?.discountCents}`);

    /* ── atomic exhaustion ── */
    const exhausted = await consumePromo(ORG, "BIG", RID, 30000);
    check("a code at its use cap yields no discount", exhausted === null);

    const [{ uses }] = await sql<{ uses: number }[]>`SELECT uses FROM promo_code WHERE organization_id=${ORG} AND code='BIG'`;
    check("BIG shows exactly 2 uses", uses === 2, `${uses}`);

    const oldConsume = await consumePromo(ORG, "OLD", RID, 90000);
    check("an expired code can't be consumed", oldConsume === null);

    /* ── redemptions recorded ── */
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM promo_redemption WHERE organization_id = ${ORG}`;
    check("one redemption row per successful use", n === 3, `${n}`);

    /* ── listing ── */
    const listed = await listPromoCodes(ORG);
    check("owner sees all four codes", listed.length === 4, `${listed.length}`);
    check("listing surfaces use counts", listed.find((c) => c.code === "BIG")?.uses === 2);

    console.log(
      failures === 0
        ? "\nPromo codes verified: validation, discount maths, atomic caps, redemptions.\n"
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
