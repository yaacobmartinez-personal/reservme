import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Peak pricing and closures (docs/API-CONTRACT.md #29).
 *
 * The rules being pinned here are the two that are easy to get wrong and
 * invisible until a customer is charged the wrong amount or books a court that
 * is shut: a pricing rule's times are wall clock with no zone at all, and a
 * closure's are instants built in the venue's zone **in Postgres**. Plus the
 * tenancy guarantee, which for these writes lives inside the statement rather
 * than in a check before it.
 */

const ORG = "org_rules_test";
const OTHER = "org_rules_other";
const TZ = "Asia/Manila";

let sql: postgres.Sql;
let courtId: string;
let foreignSpaceId: string;

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  for (const id of [ORG, OTHER]) await sql`DELETE FROM organization WHERE id = ${id}`;

  await sql`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Rules Test', 'rules-test')`;
  await sql`INSERT INTO venue (organization_id, timezone) VALUES (${ORG}, ${TZ})`;
  await sql`INSERT INTO organization (id, name, slug) VALUES (${OTHER}, 'Other', 'rules-other')`;
  await sql`INSERT INTO venue (organization_id, timezone) VALUES (${OTHER}, ${TZ})`;

  const [mine] = await sql<{ id: string }[]>`
    INSERT INTO space (organization_id, name, slug, slot_minutes, sort_order, is_active)
    VALUES (${ORG}, 'Court 1', 'court-1', 60, 0, true) RETURNING id
  `;
  courtId = mine.id;

  const [theirs] = await sql<{ id: string }[]>`
    INSERT INTO space (organization_id, name, slug, slot_minutes, sort_order, is_active)
    VALUES (${OTHER}, 'Not Ours', 'not-ours', 60, 0, true) RETURNING id
  `;
  foreignSpaceId = theirs.id;
}, 60_000);

afterAll(async () => {
  for (const id of [ORG, OTHER]) await sql`DELETE FROM organization WHERE id = ${id}`;
  await sql.end();
});

describe("what a peak-price rule refuses (#29)", () => {
  it("wants at least one day, in the app's own words", async () => {
    const { pricingProblem } = await import("@/lib/mobile/space-rules");
    const base = { weekdays: [1], startsAt: "18:00", endsAt: "22:00", priceCents: 120000 };

    expect(pricingProblem(base)).toBeNull();
    expect(pricingProblem({ ...base, weekdays: [] })).toBe("Pick at least one day.");
    expect(pricingProblem({ ...base, weekdays: undefined })).toBe("Pick at least one day.");
    // A weekday outside 0–6 is not a day either.
    expect(pricingProblem({ ...base, weekdays: [7] })).toBe("Pick at least one day.");
  });

  it("wants the end after the start, and both as HH:MM", async () => {
    const { pricingProblem } = await import("@/lib/mobile/space-rules");
    const base = { weekdays: [1], startsAt: "18:00", endsAt: "22:00" };

    expect(pricingProblem({ ...base, endsAt: "18:00" })).toBe(
      "The end time must be after the start.",
    );
    expect(pricingProblem({ ...base, endsAt: "17:00" })).toBe(
      "The end time must be after the start.",
    );
    expect(pricingProblem({ ...base, startsAt: "6:00" })).toBe("Use HH:MM.");
    expect(pricingProblem({ ...base, endsAt: "24:00" })).toBe("Use HH:MM.");
  });

  it("keeps the label short and the price sane", async () => {
    const { pricingProblem } = await import("@/lib/mobile/space-rules");
    const base = { weekdays: [1], startsAt: "18:00", endsAt: "22:00" };

    expect(pricingProblem({ ...base, label: "x".repeat(61) })).toBe("Keep the label short.");
    expect(pricingProblem({ ...base, priceCents: -1 })).toBe("That price isn't valid.");
    expect(pricingProblem({ ...base, priceCents: 1.5 })).toBe("That price isn't valid.");
  });

  it("dedupes and orders the days, and empties a blank label", async () => {
    const { pricingRule } = await import("@/lib/mobile/space-rules");
    const rule = pricingRule({
      label: "   ",
      weekdays: [5, 1, 5],
      startsAt: "18:00",
      endsAt: "22:00",
      priceCents: 120000,
    });
    expect(rule.weekdays).toEqual([1, 5]);
    // Null rather than "": the editor shows the window when there is no label,
    // and an empty string would print as a blank line above it.
    expect(rule.label).toBeNull();
  });
});

describe("writing a rule (#29)", () => {
  it("stores the window as wall clock, with no zone on it at all", async () => {
    // `time` columns carry no offset: 18:00 is 18:00 wherever the server runs,
    // which is the whole point — a peak hour is a venue's evening, not a UTC
    // instant, and it must not move when the clocks change.
    const { addPricingRule, pricingRule } = await import("@/lib/mobile/space-rules");
    await sql`DELETE FROM pricing_rule WHERE organization_id = ${ORG}`;

    expect(
      await addPricingRule(
        ORG,
        courtId,
        pricingRule({
          label: "Peak",
          weekdays: [1, 3, 5],
          startsAt: "18:00",
          endsAt: "22:00",
          priceCents: 120000,
        }),
      ),
    ).toBe(true);

    const [row] = await sql<
      { starts_at: string; ends_at: string; weekdays: number[]; price_cents: number }[]
    >`
      SELECT starts_at::text, ends_at::text, weekdays, price_cents
      FROM pricing_rule WHERE space_id = ${courtId}::uuid
    `;
    expect(row.starts_at).toBe("18:00:00");
    expect(row.ends_at).toBe("22:00:00");
    expect(row.weekdays).toEqual([1, 3, 5]);
    expect(row.price_cents).toBe(120000);
  });

  it("writes nothing for a space belonging to someone else", async () => {
    // The ownership test is inside the INSERT … SELECT, so there is no check
    // in front of it that could be forgotten.
    const { addPricingRule, pricingRule } = await import("@/lib/mobile/space-rules");
    const rule = pricingRule({
      weekdays: [1],
      startsAt: "18:00",
      endsAt: "22:00",
      priceCents: 1,
    });

    expect(await addPricingRule(ORG, foreignSpaceId, rule)).toBe(false);
    const [count] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pricing_rule WHERE space_id = ${foreignSpaceId}::uuid
    `;
    expect(count.n).toBe(0);
  });

  it("removes a rule once, and refuses another venue's", async () => {
    const { removePricingRule } = await import("@/lib/mobile/space-rules");
    await sql`DELETE FROM pricing_rule WHERE organization_id = ${ORG}`;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO pricing_rule (organization_id, space_id, weekdays, starts_at, ends_at, price_cents)
      VALUES (${ORG}, ${courtId}::uuid, ARRAY[1]::smallint[], '18:00', '22:00', 1)
      RETURNING id
    `;

    expect(await removePricingRule(ORG, row.id)).toBe(true);
    expect(await removePricingRule(ORG, row.id)).toBe(false);
  });
});

describe("a closure, which may run across days (#29)", () => {
  it("refuses a window that ends before it starts", async () => {
    const { closureWindow } = await import("@/lib/mobile/space-rules");
    expect(
      closureWindow({ date: "2026-12-24", from: "08:00", toDate: "2026-12-24", to: "08:00" }),
    ).toBe("Please give a valid start and end.");
    expect(
      closureWindow({ date: "2026-12-26", from: "08:00", toDate: "2026-12-24", to: "22:00" }),
    ).toBe("Please give a valid start and end.");
    expect(closureWindow({ date: "24/12/2026", from: "08:00", to: "22:00" })).toBe(
      "Please give a valid start and end.",
    );
  });

  it("takes a missing end date as the same day", async () => {
    // The sheet only asks for one date when a closure is an afternoon.
    const { closureWindow } = await import("@/lib/mobile/space-rules");
    const window = closureWindow({ date: "2026-12-24", from: "08:00", to: "22:00" });
    expect(window).not.toBe("Please give a valid start and end.");
    expect(typeof window === "string" ? null : window.to.day).toBe(24);
  });

  it("builds the instants in the venue's zone, not the server's", async () => {
    // 08:00 in Manila is 00:00 UTC. Casting a wall-clock string in Node would
    // round-trip through the *process* timezone and silently shift the window.
    const { addClosure, closureWindow } = await import("@/lib/mobile/space-rules");
    await sql`DELETE FROM closure WHERE organization_id = ${ORG}`;

    const window = closureWindow({
      date: "2026-12-24",
      from: "08:00",
      toDate: "2026-12-26",
      to: "22:00",
    });
    if (typeof window === "string") throw new Error(window);

    expect(await addClosure(ORG, TZ, courtId, window, "Christmas")).toBe(true);
    const [row] = await sql<{ starts_at: Date; ends_at: Date; reason: string }[]>`
      SELECT starts_at, ends_at, reason FROM closure WHERE organization_id = ${ORG}
    `;
    expect(row.starts_at.toISOString()).toBe("2026-12-24T00:00:00.000Z");
    expect(row.ends_at.toISOString()).toBe("2026-12-26T14:00:00.000Z");
    expect(row.reason).toBe("Christmas");
  });

  it("shuts the whole venue when no space is named", async () => {
    const { addClosure, closureWindow } = await import("@/lib/mobile/space-rules");
    await sql`DELETE FROM closure WHERE organization_id = ${ORG}`;
    const window = closureWindow({ date: "2026-12-24", from: "08:00", to: "22:00" });
    if (typeof window === "string") throw new Error(window);

    expect(await addClosure(ORG, TZ, null, window, null)).toBe(true);
    const [row] = await sql<{ space_id: string | null }[]>`
      SELECT space_id FROM closure WHERE organization_id = ${ORG}
    `;
    expect(row.space_id).toBeNull();
  });

  it("refuses to close another venue's space", async () => {
    const { addClosure, closureWindow } = await import("@/lib/mobile/space-rules");
    await sql`DELETE FROM closure WHERE organization_id = ${ORG}`;
    const window = closureWindow({ date: "2026-12-24", from: "08:00", to: "22:00" });
    if (typeof window === "string") throw new Error(window);

    expect(await addClosure(ORG, TZ, foreignSpaceId, window, null)).toBe(false);
    const [count] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM closure WHERE organization_id = ${ORG}
    `;
    expect(count.n).toBe(0);
  });

  it("keeps the reason short", async () => {
    const { reasonProblem } = await import("@/lib/mobile/space-rules");
    expect(reasonProblem(null)).toBeNull();
    expect(reasonProblem("Resurfacing")).toBeNull();
    expect(reasonProblem("x".repeat(201))).toBe("Keep the reason short.");
  });

  it("removes a closure once", async () => {
    const { removeClosure } = await import("@/lib/mobile/space-rules");
    await sql`DELETE FROM closure WHERE organization_id = ${ORG}`;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO closure (organization_id, space_id, starts_at, ends_at)
      VALUES (${ORG}, ${courtId}::uuid, now() + interval '1 day', now() + interval '2 days')
      RETURNING id
    `;
    expect(await removeClosure(ORG, row.id)).toBe(true);
    expect(await removeClosure(ORG, row.id)).toBe(false);
  });
});

describe("what the editor reads back (#28 + #29)", () => {
  it("shows a venue-wide closure on a space that has none of its own", async () => {
    // Otherwise the owner sees an open day that is not open. The closure is not
    // this space's, but it shuts it.
    const { spaceDetail } = await import("@/lib/mobile/venue-json");
    await sql`DELETE FROM closure WHERE organization_id = ${ORG}`;
    await sql`
      INSERT INTO closure (organization_id, space_id, starts_at, ends_at, reason)
      VALUES (${ORG}, NULL, now() + interval '1 day', now() + interval '2 days', 'Typhoon')
    `;

    const detail = await spaceDetail(ORG, courtId);
    expect(detail?.closures).toHaveLength(1);
    expect(detail?.closures[0].spaceId).toBeNull();
  });

  it("leaves a closure that has already passed off the editor", async () => {
    const { spaceDetail } = await import("@/lib/mobile/venue-json");
    await sql`DELETE FROM closure WHERE organization_id = ${ORG}`;
    await sql`
      INSERT INTO closure (organization_id, space_id, starts_at, ends_at)
      VALUES (${ORG}, ${courtId}::uuid, now() - interval '2 days', now() - interval '1 day')
    `;
    expect((await spaceDetail(ORG, courtId))?.closures).toHaveLength(0);
  });
});
