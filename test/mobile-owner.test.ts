import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The three owner screens (docs/API-CONTRACT.md #31, #32, #33).
 *
 * What is pinned here is the part that is new or that the web does not do:
 * the **last-owner guard**, which Better Auth has no opinion about and which
 * is not recoverable from inside the app; the band derived from *active*
 * spaces on every read; and the shape the insights screen reads, including
 * the two things it deliberately differs on.
 */

const ORG = "org_owner_test";
const TZ = "Asia/Manila";

let sql: postgres.Sql;
let ownerMemberId: string;
let staffMemberId: string;
const courtIds: string[] = [];

async function member(userId: string, name: string, email: string, role: string) {
  await sql`
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
    VALUES (${userId}, ${name}, ${email}, true, now(), now())
    ON CONFLICT (id) DO NOTHING
  `;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO "member" (id, organization_id, user_id, role, created_at)
    VALUES (${`m_${userId}`}, ${ORG}, ${userId}, ${role}, now())
    RETURNING id
  `;
  return row.id;
}

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  await sql`DELETE FROM organization WHERE id = ${ORG}`;
  await sql`DELETE FROM "user" WHERE email IN ('owner@owner.test','staff@owner.test','second@owner.test')`;

  await sql`INSERT INTO organization (id, name, slug, created_at) VALUES (${ORG}, 'Owner Test', 'owner-test', now())`;
  await sql`INSERT INTO venue (organization_id, timezone) VALUES (${ORG}, ${TZ})`;

  ownerMemberId = await member("u_owner_test", "Ona Owner", "owner@owner.test", "owner");
  staffMemberId = await member("u_staff_test", "Stan Staff", "staff@owner.test", "member");

  for (const [i, name] of ["Court 1", "Court 2", "Court 3"].entries()) {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO space (organization_id, name, slug, slot_minutes, sort_order, is_active, price_cents)
      VALUES (${ORG}, ${name}, ${`court-${i}`}, 60, ${i}, true, 90000)
      RETURNING id
    `;
    courtIds.push(row.id);
  }
}, 60_000);

afterAll(async () => {
  await sql`DELETE FROM organization WHERE id = ${ORG}`;
  await sql`DELETE FROM "user" WHERE email IN ('owner@owner.test','staff@owner.test','second@owner.test')`;
  await sql.end();
});

describe("the team, and the guard Better Auth does not have (#31)", () => {
  it("lists members owners first, and marks which one is you", async () => {
    const { teamJson } = await import("@/lib/mobile/team-json");
    const team = await teamJson(ORG, "u_staff_test", "member");

    expect(team.members.map((m) => m.role)).toEqual(["owner", "member"]);
    // So the screen says "you" rather than making somebody recognise their
    // own email address in a list.
    expect(team.members.find((m) => m.isSelf)?.email).toBe("staff@owner.test");
    expect(team.yourRole).toBe("member");
  });

  it("refuses to strand the venue when there is one owner left", async () => {
    const { wouldStrandVenue } = await import("@/lib/mobile/team-json");
    expect(await wouldStrandVenue(ORG, ownerMemberId)).toBe(true);
    // Demoting or removing staff strands nobody.
    expect(await wouldStrandVenue(ORG, staffMemberId)).toBe(false);
  });

  it("allows it once there is a second owner — including on yourself", async () => {
    // An owner handing the venue on and stepping down is a real thing. Since
    // only an owner can demote an owner, forbidding self-changes outright
    // would make this guard unreachable, which is how it first went wrong.
    const { wouldStrandVenue } = await import("@/lib/mobile/team-json");
    const secondId = await member("u_second_test", "Two Owner", "second@owner.test", "owner");

    expect(await wouldStrandVenue(ORG, ownerMemberId)).toBe(false);
    expect(await wouldStrandVenue(ORG, secondId)).toBe(false);

    await sql`DELETE FROM "member" WHERE id = ${secondId}`;
    expect(await wouldStrandVenue(ORG, ownerMemberId)).toBe(true);
  });

  it("refuses an invitation nobody could accept", async () => {
    const { inviteProblem } = await import("@/lib/mobile/team-json");
    expect(inviteProblem("", "member")).toBe("Who are you inviting?");
    expect(inviteProblem("   ", "member")).toBe("Who are you inviting?");
    expect(inviteProblem("not-an-email", "member")).toBe("That email doesn't look right.");
    expect(inviteProblem("someone@club.ph", "member")).toBeNull();
    expect(inviteProblem("someone@club.ph", "wizard")).toBe("That isn't a role.");
  });
});

describe("billing, and the band that is never stored (#32)", () => {
  it("derives the band from ACTIVE spaces on every read", async () => {
    // Three active courts is Club. This is the most surprising thing about
    // the screen: pausing a court for the off-season drops a band with no
    // write anywhere.
    const { billingJson } = await import("@/lib/mobile/billing-json");

    const club = await billingJson(ORG);
    expect(club.activeSpaces).toBe(3);
    expect(club.band.id).toBe("club");
    expect(club.band.pricePesos).toBe(999);

    await sql`UPDATE space SET is_active = false WHERE organization_id = ${ORG} AND slug <> 'court-0'`;
    const solo = await billingJson(ORG);
    expect(solo.activeSpaces).toBe(1);
    expect(solo.band.id).toBe("solo");

    await sql`UPDATE space SET is_active = true WHERE organization_id = ${ORG}`;
  });

  it("puts a venue with no active spaces in the entry band, not off the table", async () => {
    const { billingJson } = await import("@/lib/mobile/billing-json");
    await sql`UPDATE space SET is_active = false WHERE organization_id = ${ORG}`;

    const none = await billingJson(ORG);
    expect(none.activeSpaces).toBe(0);
    expect(none.band.id).toBe("solo");

    await sql`UPDATE space SET is_active = true WHERE organization_id = ${ORG}`;
  });

  it("takes the amount from the band, never from the request", async () => {
    const { submitProof, billingJson } = await import("@/lib/mobile/billing-json");
    await sql`DELETE FROM billing_payment WHERE organization_id = ${ORG}`;

    expect(await submitProof(ORG, "  INSTA-12345  ", "2026-09-20")).toBeNull();

    const [row] = await sql<{ amount_cents: number; reference: string }[]>`
      SELECT amount_cents, reference FROM billing_payment WHERE organization_id = ${ORG}
    `;
    // Club is ₱999; nothing in the call said so.
    expect(row.amount_cents).toBe(99900);
    expect(row.reference).toBe("INSTA-12345");

    const state = await billingJson(ORG);
    expect(state.pendingPayment?.reference).toBe("INSTA-12345");
    // A `date` column: the day the owner says they paid, with no zone on it.
    expect(state.pendingPayment?.paidAt).toBe("2026-09-20");
  });

  it("refuses a second payment while one is under review", async () => {
    const { submitProof } = await import("@/lib/mobile/billing-json");
    const refusal = await submitProof(ORG, "INSTA-99999", "2026-09-21");
    expect(refusal).toMatchObject({
      reason: "already_pending",
      message: "You already have a payment under review.",
    });

    await sql`DELETE FROM billing_payment WHERE organization_id = ${ORG}`;
  });

  it("refuses a quoted plan rather than inventing a price", async () => {
    // Sixteen spaces is Multi-site, which has no listed price.
    const { submitProof } = await import("@/lib/mobile/billing-json");
    await sql`DELETE FROM billing_payment WHERE organization_id = ${ORG}`;
    for (let i = 3; i < 16; i += 1) {
      await sql`
        INSERT INTO space (organization_id, name, slug, slot_minutes, sort_order, is_active)
        VALUES (${ORG}, ${`Court ${i}`}, ${`court-${i}`}, 60, ${i}, true)
      `;
    }

    const refusal = await submitProof(ORG, "INSTA-11111", "2026-09-21");
    expect(refusal).toMatchObject({ reason: "quoted" });

    await sql`DELETE FROM space WHERE organization_id = ${ORG} AND sort_order >= 3`;
  });

  it("keeps the proof rules the form already enforces", async () => {
    const { proofProblem } = await import("@/lib/mobile/billing-json");
    expect(proofProblem("abc", "2026-09-20")).toBe("Enter the InstaPay reference number.");
    expect(proofProblem("x".repeat(65), "2026-09-20")).toBe("That reference is too long.");
    expect(proofProblem("INSTA-1", "20/09/2026")).toBe("Pick the date you paid.");
    expect(proofProblem("INSTA-1", "2026-09-20")).toBeNull();
  });
});

describe("insights, and where it differs from the web (#33)", () => {
  it("answers the period it was asked for, and falls back rather than failing", async () => {
    const { insightsJson } = await import("@/lib/mobile/insights-json");

    expect((await insightsJson(ORG, TZ, "7d")).range).toBe("7d");
    expect((await insightsJson(ORG, TZ, "today")).range).toBe("today");
    // It arrives from a query string, so nonsense is 30 days, not a 400.
    expect((await insightsJson(ORG, TZ, "forever")).range).toBe("30d");
    expect((await insightsJson(ORG, TZ, null)).range).toBe("30d");
  });

  it("merges value and utilisation into one row per day", async () => {
    // The web draws two charts; the app draws one row per day, so the zip
    // happens here rather than on the phone.
    const { insightsJson } = await import("@/lib/mobile/insights-json");
    const insights = await insightsJson(ORG, TZ, "7d");

    expect(insights.bookedByDay).toHaveLength(7);
    for (const day of insights.bookedByDay) {
      expect(day.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof day.cents).toBe("number");
      expect(typeof day.utilisationPct).toBe("number");
    }
  });

  it("gives the heatmap a full week of full days", async () => {
    const { insightsJson } = await import("@/lib/mobile/insights-json");
    const { peakHours } = await insightsJson(ORG, TZ, "30d");
    expect(peakHours).toHaveLength(7);
    expect(peakHours.every((row) => row.length === 24)).toBe(true);
  });

  it("carries the ids a phone needs to open what it names", async () => {
    const { insightsJson } = await import("@/lib/mobile/insights-json");
    const insights = await insightsJson(ORG, TZ, "30d");

    // A bar labelled "Court 1" should open Court 1.
    expect(insights.bySpace.length).toBeGreaterThan(0);
    for (const space of insights.bySpace) {
      expect(space.spaceId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("has no awaiting-payments tile, because v1 is pay-at-venue", async () => {
    // There are no payment records to count, so the number would be a
    // permanent zero. Left out rather than shown.
    const { insightsJson } = await import("@/lib/mobile/insights-json");
    const insights = await insightsJson(ORG, TZ, "30d");
    expect(Object.keys(insights.needsYou).sort()).toEqual(["halfEmptySessions", "toCheckIn"]);
  });

  it("counts today's not-yet-checked-in in the venue's own today", async () => {
    const { insightsJson } = await import("@/lib/mobile/insights-json");
    await sql`DELETE FROM reservation WHERE organization_id = ${ORG}`;

    const [customer] = await sql<{ id: string }[]>`
      INSERT INTO customer (organization_id, name, email)
      VALUES (${ORG}, 'Ramon Cruz', 'ramon@owner.test') RETURNING id
    `;
    await sql`
      INSERT INTO reservation (organization_id, space_id, customer_id, reference, kind,
                               status, party_size, amount_cents, starts_at, ends_at)
      VALUES (${ORG}, ${courtIds[0]}::uuid, ${customer.id}::uuid, ${`OW-${Date.now()}`},
              'rental', 'confirmed', 2, 90000,
              ((now() AT TIME ZONE ${TZ})::date + time '23:00') AT TIME ZONE ${TZ},
              ((now() AT TIME ZONE ${TZ})::date + time '23:00') AT TIME ZONE ${TZ} + interval '1 hour')
    `;

    const insights = await insightsJson(ORG, TZ, "today");
    expect(insights.needsYou.toCheckIn).toBe(1);

    await sql`DELETE FROM reservation WHERE organization_id = ${ORG}`;
    await sql`DELETE FROM customer WHERE organization_id = ${ORG}`;
  });
});
