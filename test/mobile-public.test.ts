import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The public, account-less half (docs/API-CONTRACT.md #1–#9).
 *
 * This is the only surface a stranger can write to, so what is pinned here is
 * mostly about what a request is *not* allowed to say: the organisation comes
 * from the slug and never the body, a space id selects among a venue's spaces
 * rather than naming one, and an idempotency key is scoped per venue.
 */

const ORG = "org_public_test";
const OTHER = "org_public_other";
const TZ = "Asia/Manila";

let sql: postgres.Sql;
let courtId: string;
let foreignSpaceId: string;

async function localDate(offsetDays: number) {
  const [row] = await sql<{ d: string }[]>`
    SELECT ((now() AT TIME ZONE ${TZ})::date + ${offsetDays}::int)::text AS d
  `;
  return row.d;
}

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  for (const id of [ORG, OTHER]) await sql`DELETE FROM organization WHERE id = ${id}`;

  await sql`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Public Test', 'public-test')`;
  await sql`
    INSERT INTO venue (organization_id, timezone, min_notice_minutes, max_horizon_days, address)
    VALUES (${ORG}, ${TZ}, 60, 30, '12 Katipunan Ave')
  `;
  await sql`INSERT INTO organization (id, name, slug) VALUES (${OTHER}, 'Other', 'public-other')`;
  await sql`INSERT INTO venue (organization_id, timezone) VALUES (${OTHER}, ${TZ})`;

  const [court] = await sql<{ id: string }[]>`
    INSERT INTO space (organization_id, name, slug, kind, slot_minutes, sort_order,
                       is_active, price_cents, capacity)
    VALUES (${ORG}, 'Court 1', 'court-1', 'court', 60, 0, true, 90000, 4)
    RETURNING id
  `;
  courtId = court.id;

  // A paused space, which must not appear on a public page at all.
  await sql`
    INSERT INTO space (organization_id, name, slug, slot_minutes, sort_order, is_active, price_cents)
    VALUES (${ORG}, 'Court 2', 'court-2', 60, 1, false, 90000)
  `;

  for (let weekday = 0; weekday < 7; weekday += 1) {
    await sql`
      INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at)
      VALUES (${courtId}::uuid, ${weekday}, '08:00', '22:00')
    `;
  }

  const [theirs] = await sql<{ id: string }[]>`
    INSERT INTO space (organization_id, name, slug, slot_minutes, sort_order, is_active, price_cents)
    VALUES (${OTHER}, 'Not Ours', 'not-ours', 60, 0, true, 50000)
    RETURNING id
  `;
  foreignSpaceId = theirs.id;
}, 60_000);

afterAll(async () => {
  for (const id of [ORG, OTHER]) await sql`DELETE FROM organization WHERE id = ${id}`;
  await sql.end();
});

describe("the venue page (#1)", () => {
  it("shows the venue's own policy and the spaces on sale", async () => {
    const { publicVenue } = await import("@/lib/mobile/public-json");
    const venue = (await publicVenue("public-test"))!;

    expect(venue.slug).toBe("public-test");
    expect(venue.timezone).toBe(TZ);
    expect(venue.minNoticeMinutes).toBe(60);
    expect(venue.maxHorizonDays).toBe(30);
    expect(venue.address).toBe("12 Katipunan Ave");
    // A paused space is not on sale, so it is not on the page.
    expect(venue.spaces.map((s) => s.name)).toEqual(["Court 1"]);
    expect(venue.spaces[0].capacity).toBe(4);
  });

  it("says whether the venue is suspended, not when", async () => {
    // When a venue was suspended is between it and the platform; the page
    // only needs to know that it is, so it can explain itself.
    const { publicVenue } = await import("@/lib/mobile/public-json");
    expect((await publicVenue("public-test"))!.suspended).toBe(false);

    await sql`UPDATE venue SET suspended_at = now(), suspended_reason = 'test' WHERE organization_id = ${ORG}`;
    const off = (await publicVenue("public-test"))!;
    expect(off.suspended).toBe(true);
    expect(Object.keys(off)).not.toContain("suspendedAt");

    await sql`UPDATE venue SET suspended_at = NULL, suspended_reason = NULL WHERE organization_id = ${ORG}`;
  });

  it("carries the peak price only when a rule actually charges more", async () => {
    const { publicVenue } = await import("@/lib/mobile/public-json");
    await sql`DELETE FROM pricing_rule WHERE organization_id = ${ORG}`;
    expect((await publicVenue("public-test"))!.spaces[0].peakPriceCents).toBeNull();

    await sql`
      INSERT INTO pricing_rule (organization_id, space_id, weekdays, starts_at, ends_at, price_cents)
      VALUES (${ORG}, ${courtId}::uuid, ARRAY[1,2,3,4,5]::smallint[], '18:00', '22:00', 120000)
    `;
    expect((await publicVenue("public-test"))!.spaces[0].peakPriceCents).toBe(120000);

    // A rule that charges the same or less is not a peak, and saying "from
    // ₱900 to ₱900" on a card is noise.
    await sql`DELETE FROM pricing_rule WHERE organization_id = ${ORG}`;
    await sql`
      INSERT INTO pricing_rule (organization_id, space_id, weekdays, starts_at, ends_at, price_cents)
      VALUES (${ORG}, ${courtId}::uuid, ARRAY[1]::smallint[], '08:00', '10:00', 70000)
    `;
    expect((await publicVenue("public-test"))!.spaces[0].peakPriceCents).toBeNull();
    await sql`DELETE FROM pricing_rule WHERE organization_id = ${ORG}`;
  });

  it("is null for a venue that does not exist", async () => {
    const { publicVenue } = await import("@/lib/mobile/public-json");
    expect(await publicVenue("no-such-venue")).toBeNull();
  });
});

describe("availability (#2)", () => {
  it("marks each slot with why it is not bookable", async () => {
    const { availabilityJson } = await import("@/lib/mobile/public-json");
    const day = await availabilityJson(ORG, courtId, await localDate(2));

    expect(day.slots.length).toBeGreaterThan(0);
    // 08:00 to 22:00 on hour-long slots.
    expect(day.slots[0].label).toBe("08:00");
    expect(day.slots.every((s) => typeof s.reason === "string")).toBe(true);
    expect(day.slots.every((s) => s.available === (s.reason === "open"))).toBe(true);
  });

  it("flags a slot a rule raised the price on", async () => {
    // The card says "peak" rather than making the customer compare two
    // numbers, and the server is the only side that knows the base price.
    const { availabilityJson } = await import("@/lib/mobile/public-json");
    await sql`DELETE FROM pricing_rule WHERE organization_id = ${ORG}`;
    await sql`
      INSERT INTO pricing_rule (organization_id, space_id, weekdays, starts_at, ends_at, price_cents)
      VALUES (${ORG}, ${courtId}::uuid, ARRAY[0,1,2,3,4,5,6]::smallint[], '18:00', '22:00', 120000)
    `;

    const day = await availabilityJson(ORG, courtId, await localDate(2));
    const evening = day.slots.find((s) => s.label === "18:00")!;
    const morning = day.slots.find((s) => s.label === "09:00")!;

    expect(evening.priceCents).toBe(120000);
    expect(evening.peak).toBe(true);
    expect(morning.priceCents).toBe(90000);
    expect(morning.peak).toBe(false);

    await sql`DELETE FROM pricing_rule WHERE organization_id = ${ORG}`;
  });

  it("answers a date past the horizon with slots, not an error", async () => {
    // Refusing would make the date strip lie about which days exist. The
    // slots come back marked, which is what the grid draws.
    const { availabilityJson } = await import("@/lib/mobile/public-json");
    const day = await availabilityJson(ORG, courtId, await localDate(60));
    expect(day.slots.every((s) => s.reason === "too_far_ahead")).toBe(true);
  });

  it("refuses a malformed date before it reaches the database", async () => {
    const { dateProblem } = await import("@/lib/mobile/public-json");
    expect(dateProblem("2026-10-01")).toBeNull();
    expect(dateProblem("01/10/2026")).toBe("Pick a date.");
    expect(dateProblem(null)).toBe("Pick a date.");
  });
});

describe("what a booking may not say (#3)", () => {
  it("never reaches another venue's space", async () => {
    // The check is that a foreign space id resolves to nothing under this
    // organisation — the id selects among a venue's spaces, it does not name
    // one. `reserveSpace` derives placement from (org, space) for exactly
    // this reason.
    const { derivePlacement } = await import("@/lib/booking/placement");
    expect(await derivePlacement(ORG, foreignSpaceId, new Date(), new Date())).toBeNull();
  });
});

describe("idempotency (#3, #4)", () => {
  it("remembers what a key produced, scoped to the venue", async () => {
    const { rememberKey, replayOf } = await import("@/lib/mobile/public-book-json");
    await sql`DELETE FROM idempotency_key WHERE organization_id IN (${ORG}, ${OTHER})`;

    const [customer] = await sql<{ id: string }[]>`
      INSERT INTO customer (organization_id, name, email)
      VALUES (${ORG}, 'Ramon Cruz', 'ramon@public.test') RETURNING id
    `;
    const [res] = await sql<{ id: string }[]>`
      INSERT INTO reservation (organization_id, space_id, customer_id, reference, kind,
                               status, party_size, amount_cents, starts_at, ends_at)
      VALUES (${ORG}, ${courtId}::uuid, ${customer.id}::uuid, ${`PB-${Date.now()}`},
              'rental', 'confirmed', 2, 90000,
              now() + interval '2 days', now() + interval '2 days' + interval '1 hour')
      RETURNING id
    `;

    expect(await replayOf(ORG, "attempt-1")).toBeNull();
    await rememberKey(ORG, "attempt-1", res.id);
    expect(await replayOf(ORG, "attempt-1")).toBe(res.id);

    // The same key under a different venue is a new request, not a way to
    // read somebody else's booking.
    expect(await replayOf(OTHER, "attempt-1")).toBeNull();

    // Recording it twice is not an error — a third retry is still a retry.
    await rememberKey(ORG, "attempt-1", res.id);
    expect(await replayOf(ORG, "attempt-1")).toBe(res.id);

    await sql`DELETE FROM reservation WHERE organization_id = ${ORG}`;
    await sql`DELETE FROM customer WHERE organization_id = ${ORG}`;
  });

  it("treats a missing or implausible key as no key at all", async () => {
    // A key must not be something an attacker can guess into. Short ones are
    // ignored rather than refused: an older app with no key still books.
    const { idempotencyKey, replayOf } = await import("@/lib/mobile/public-book-json");
    const headers = (value?: string) =>
      new Headers(value === undefined ? {} : { "idempotency-key": value });

    expect(idempotencyKey(headers())).toBeNull();
    expect(idempotencyKey(headers("short"))).toBeNull();
    expect(idempotencyKey(headers("a".repeat(200)))).toBeNull();
    expect(idempotencyKey(headers("6f1e1b3a-0d7c-4f4e-9b71-2a6a2f2d4c8e"))).not.toBeNull();

    expect(await replayOf(ORG, null)).toBeNull();
  });
});

describe("the manage token (#5, #6)", () => {
  it("is refused under the wrong venue slug", async () => {
    // The token is the whole authorisation, so it is matched against the slug
    // too — otherwise a token leaked from one venue reads under any other.
    const { getManageableBooking } = await import("@/lib/booking/manage");
    const [customer] = await sql<{ id: string }[]>`
      INSERT INTO customer (organization_id, name, email)
      VALUES (${ORG}, 'Bea Santos', 'bea@public.test') RETURNING id
    `;
    const [res] = await sql<{ manage_token: string }[]>`
      INSERT INTO reservation (organization_id, space_id, customer_id, reference, kind,
                               status, party_size, amount_cents, starts_at, ends_at)
      VALUES (${ORG}, ${courtId}::uuid, ${customer.id}::uuid, ${`PB-${Date.now()}-m`},
              'rental', 'confirmed', 2, 90000,
              now() + interval '3 days', now() + interval '3 days' + interval '1 hour')
      RETURNING manage_token
    `;

    expect(await getManageableBooking("public-test", res.manage_token)).not.toBeNull();
    expect(await getManageableBooking("public-other", res.manage_token)).toBeNull();
    // And a token that is not a uuid never reaches the database.
    expect(await getManageableBooking("public-test", "not-a-token")).toBeNull();

    await sql`DELETE FROM reservation WHERE organization_id = ${ORG}`;
    await sql`DELETE FROM customer WHERE organization_id = ${ORG}`;
  });

  it("carries everything the wallet card draws, and the token itself", async () => {
    const { getManageableBooking } = await import("@/lib/booking/manage");
    const { bookingJson } = await import("@/lib/mobile/public-book-json");

    const [customer] = await sql<{ id: string }[]>`
      INSERT INTO customer (organization_id, name, email)
      VALUES (${ORG}, 'Bea Santos', 'bea@public.test') RETURNING id
    `;
    const [res] = await sql<{ manage_token: string }[]>`
      INSERT INTO reservation (organization_id, space_id, customer_id, reference, kind,
                               status, party_size, amount_cents, starts_at, ends_at, notes)
      VALUES (${ORG}, ${courtId}::uuid, ${customer.id}::uuid, ${`PB-${Date.now()}-w`},
              'rental', 'confirmed', 3, 90000,
              now() + interval '4 days', now() + interval '4 days' + interval '1 hour',
              'Bring own rackets')
      RETURNING manage_token
    `;

    const booking = (await getManageableBooking("public-test", res.manage_token))!;
    const json = bookingJson(booking, { manageToken: res.manage_token });

    expect(json.venue.address).toBe("12 Katipunan Ave");
    expect(json.space.kind).toBe("court");
    expect(json.partySize).toBe(3);
    expect(json.notes).toBe("Bring own rackets");
    expect(json.endsAt).toMatch(/Z$/);
    expect(json.manageToken).toBe(res.manage_token);

    // Without the token in hand, it is not handed out: a booking reference is
    // not a way to cancel somebody else's game.
    expect(bookingJson(booking)).not.toHaveProperty("manageToken");

    await sql`DELETE FROM reservation WHERE organization_id = ${ORG}`;
    await sql`DELETE FROM customer WHERE organization_id = ${ORG}`;
  });
});
