/**
 * Verifies memberships/passes: granting seeds credits + expiry; a booking
 * spends one credit (covering the slot) and records a redemption; an exhausted
 * pass falls back to a membership's % discount; a free slot spends nothing;
 * expired holdings don't redeem; and holdings are org-scoped.
 *
 *   npm run test:memberships   (local: DATABASE_URL → docker, not Neon)
 */
import postgres from "postgres";

const ORG = "org_member_test";
const TZ = "Asia/Manila";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const { grantMembership, redeemForBooking, listCustomerHoldings } = await import(
    "../src/lib/memberships"
  );
  const { reserveSpace } = await import("../src/lib/booking/reserve");

  const plan = async (
    name: string,
    kind: "pass" | "membership",
    credits: number | null,
    pct: number | null,
    validDays: number | null,
  ) => {
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO membership_plan (organization_id, name, kind, price_cents, credits, period, benefit_discount_pct, valid_days)
      VALUES (${ORG}, ${name}, ${kind}, 400000, ${credits}, ${kind === "membership" ? "monthly" : "one_time"}, ${pct}, ${validDays})
      RETURNING id`;
    return p.id;
  };

  try {
    await sql`DELETE FROM organization WHERE id = ${ORG}`;
    await sql`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Member Test', ${ORG})`;
    await sql`INSERT INTO venue (organization_id, timezone, currency) VALUES (${ORG}, ${TZ}, 'PHP')`;
    const [space] = await sql<{ id: string }[]>`
      INSERT INTO space (organization_id, name, slug, price_cents, slot_minutes, sort_order)
      VALUES (${ORG}, 'Court 1', 'court-1', 90000, 60, 0) RETURNING id`;
    for (let w = 0; w < 7; w += 1) {
      await sql`INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at)
                VALUES (${space.id}::uuid, ${w}, '00:00', '23:59')`;
    }
    // A real reservation for the redemption FK.
    const [r] = await sql<{ t: Date }[]>`
      SELECT (((now() AT TIME ZONE ${TZ})::date + 2) + make_time(10,0,0)) AT TIME ZONE ${TZ} AS t`;
    const [r2] = await sql<{ t: Date }[]>`
      SELECT (((now() AT TIME ZONE ${TZ})::date + 2) + make_time(11,0,0)) AT TIME ZONE ${TZ} AS t`;
    const booking = await reserveSpace({
      organizationId: ORG, spaceId: space.id, startsAt: r.t, endsAt: r2.t,
      customer: { name: "Holder", email: "holder@x.com" },
    });
    const [cust] = await sql<{ id: string }[]>`SELECT id FROM customer WHERE organization_id=${ORG} AND email='holder@x.com'`;
    const CID = cust.id;
    const RID = booking.id;

    /* ── pass credits ── */
    const passPlan = await plan("3-pack", "pass", 3, null, 30);
    const grant = await grantMembership(ORG, CID, passPlan);
    check("granting succeeds", grant.ok);
    const [h0] = await listCustomerHoldings(ORG, CID);
    check("holding seeded with 3 credits", h0?.creditsRemaining === 3, `${h0?.creditsRemaining}`);
    check("holding has an expiry", h0?.expiresAt !== null);

    const red1 = await redeemForBooking(ORG, CID, RID, 90000);
    check("a credit covers the slot in full", red1?.creditsUsed === 1 && red1?.discountCents === 90000, JSON.stringify(red1));
    const [{ c1 }] = await sql<{ c1: number }[]>`SELECT credits_remaining AS c1 FROM customer_membership WHERE customer_id=${CID}::uuid`;
    check("balance drops to 2", c1 === 2, `${c1}`);

    await redeemForBooking(ORG, CID, RID, 90000);
    await redeemForBooking(ORG, CID, RID, 90000);
    const [{ c2 }] = await sql<{ c2: number }[]>`SELECT credits_remaining AS c2 FROM customer_membership WHERE customer_id=${CID}::uuid`;
    check("pass empties to 0", c2 === 0, `${c2}`);

    const exhausted = await redeemForBooking(ORG, CID, RID, 90000);
    check("an empty pass with no discount yields nothing", exhausted === null);

    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM membership_redemption WHERE organization_id=${ORG}`;
    check("three credit redemptions recorded", n === 3, `${n}`);

    /* ── membership discount fallback ── */
    const discPlan = await plan("Gold", "membership", null, 20, null);
    await grantMembership(ORG, CID, discPlan);
    const disc = await redeemForBooking(ORG, CID, RID, 90000);
    check("membership applies a % discount when no credits", disc?.creditsUsed === 0 && disc?.discountCents === 18000, JSON.stringify(disc));

    /* ── a free slot spends nothing ── */
    const passPlan2 = await plan("Freebie-pack", "pass", 2, null, null);
    await grantMembership(ORG, CID, passPlan2);
    const free = await redeemForBooking(ORG, CID, RID, 0);
    check("a ₱0 slot never consumes a credit", free === null);

    /* ── expiry ── */
    const expPlan = await plan("Expired-pack", "pass", 5, null, 30);
    const eg = await grantMembership(ORG, CID, expPlan);
    if (eg.ok) await sql`UPDATE customer_membership SET expires_at = now() - interval '1 day' WHERE id=${eg.id}::uuid`;
    // The still-valid Freebie-pack (2 credits) should be used instead of the expired one.
    const afterExpiry = await redeemForBooking(ORG, CID, RID, 90000);
    check("an expired holding is skipped for a valid one", afterExpiry?.creditsUsed === 1, JSON.stringify(afterExpiry));
    const [{ ec }] = await sql<{ ec: number }[]>`SELECT credits_remaining AS ec FROM customer_membership WHERE id=${eg.ok ? eg.id : ""}::uuid`;
    check("the expired pass keeps its credits", ec === 5, `${ec}`);

    /* ── org isolation ── */
    const otherGrant = await grantMembership("org_not_mine", CID, passPlan);
    check("can't grant a plan that isn't the org's", otherGrant.ok === false);

    console.log(
      failures === 0
        ? "\nMemberships verified: credits, discount fallback, free-slot, expiry, isolation.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM organization WHERE id = ${ORG}`;
    await sql`DELETE FROM organization WHERE id = 'org_not_mine'`;
    await sql.end();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
