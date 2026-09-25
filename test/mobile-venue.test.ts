import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The database half of the mobile API (docs/API-CONTRACT.md #24, #28, #30).
 *
 * Two things are under test, and both are the kind that only a real Postgres
 * catches: that `venueScope` refuses to cross a tenant boundary, and that the
 * wire shapes come out with the types and casing the app parses — times as
 * wall clock, instants as ISO, a closed day as a *missing row*.
 *
 * Fixtures are built here rather than taken from the seed, so this file does
 * not break when the demo world changes.
 */

const ORG = "org_mobile_test";
const OTHER = "org_mobile_other";

let sql: postgres.Sql;
let owner: string;
let outsider: string;
let member: string;
let spaceId: string;

// venueScope reads the bearer token through Better Auth, which needs a real
// session. A session row + its token is exactly what the bearer plugin turns
// back into a session, so the request below is indistinguishable from the app's.
function request(token: string | null): Request {
  return new Request("https://app.reservme.pro/api/mobile/venues/mobile-test", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

async function mkUser(id: string) {
  await sql`
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
    VALUES (${id}, ${id}, ${`${id}@reservme.test`}, true, now(), now())
  `;
  const token = `tok_${id}`;
  await sql`
    INSERT INTO "session" (id, expires_at, token, created_at, updated_at, user_id)
    VALUES (${`sess_${id}`}, now() + interval '30 days', ${token}, now(), now(), ${id})
  `;
  return token;
}

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });

  await sql`DELETE FROM organization WHERE id IN (${ORG}, ${OTHER})`;
  await sql`DELETE FROM "user" WHERE id LIKE 'mob_%'`;

  owner = await mkUser("mob_owner");
  member = await mkUser("mob_member");
  outsider = await mkUser("mob_outsider");

  await sql`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Mobile Test', 'mobile-test')`;
  await sql`
    INSERT INTO venue (organization_id, timezone, currency, theme, tagline)
    VALUES (${ORG}, 'Asia/Manila', 'PHP', 'pine', 'Book a court in seconds')
  `;
  await sql`
    INSERT INTO member (id, organization_id, user_id, role, created_at)
    VALUES ('m_mob_owner', ${ORG}, 'mob_owner', 'owner', now()),
           ('m_mob_member', ${ORG}, 'mob_member', 'member', now())
  `;

  // A second venue the outsider owns, so "not found" is about membership
  // rather than about the venue not existing.
  await sql`INSERT INTO organization (id, name, slug) VALUES (${OTHER}, 'Other', 'mobile-other')`;
  await sql`INSERT INTO venue (organization_id) VALUES (${OTHER})`;
  await sql`
    INSERT INTO member (id, organization_id, user_id, role, created_at)
    VALUES ('m_mob_out', ${OTHER}, 'mob_outsider', 'owner', now())
  `;

  const [space] = await sql<{ id: string }[]>`
    INSERT INTO space (organization_id, name, slug, kind, capacity, slot_minutes,
                       buffer_minutes, price_cents, sort_order, is_active)
    VALUES (${ORG}, 'Court 1', 'court-1', 'court', 1, 60, 10, 90000, 0, true)
    RETURNING id
  `;
  spaceId = space.id;

  // Monday to Saturday. Sunday is closed, which in this schema means no row.
  for (const weekday of [1, 2, 3, 4, 5, 6]) {
    await sql`
      INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at)
      VALUES (${spaceId}::uuid, ${weekday}, '09:00', '22:00')
    `;
  }

  await sql`
    INSERT INTO pricing_rule (organization_id, space_id, label, weekdays, starts_at, ends_at, price_cents)
    VALUES (${ORG}, ${spaceId}::uuid, 'Peak', ARRAY[1,2,3]::smallint[], '18:00', '22:00', 120000)
  `;
}, 60_000);

afterAll(async () => {
  await sql`DELETE FROM organization WHERE id IN (${ORG}, ${OTHER})`;
  await sql`DELETE FROM "user" WHERE id LIKE 'mob_%'`;
  await sql.end();
});

describe("venueScope", () => {
  it("resolves a venue the caller belongs to, with their role", async () => {
    const { venueScope, isFailure } = await import("@/lib/mobile/venue-scope");
    const scope = await venueScope(request(owner), "mobile-test");
    expect(isFailure(scope)).toBe(false);
    if (isFailure(scope)) return;
    expect(scope.organizationId).toBe(ORG);
    expect(scope.role).toBe("owner");
    expect(scope.timezone).toBe("Asia/Manila");
  });

  it("is case-insensitive about the slug, like the booking page", async () => {
    const { venueScope, isFailure } = await import("@/lib/mobile/venue-scope");
    expect(isFailure(await venueScope(request(owner), "MOBILE-TEST"))).toBe(false);
  });

  it("refuses with 401 when there is no token", async () => {
    const { venueScope } = await import("@/lib/mobile/venue-scope");
    const scope = await venueScope(request(null), "mobile-test");
    expect(scope).toMatchObject({ status: 401 });
  });

  it("answers 404 for a venue the caller is not in, NOT 403", async () => {
    // 403 would confirm the venue exists, which turns this into a directory of
    // every venue on the platform. The venue below really does exist.
    const { venueScope } = await import("@/lib/mobile/venue-scope");
    const scope = await venueScope(request(outsider), "mobile-test");
    expect(scope).toMatchObject({ status: 404 });
  });

  it("answers 403 when they belong but the role is too low", async () => {
    // Here 403 is right: they already know the venue exists. Naming the reason
    // matters — a member who cannot change a space should know it is their
    // role, not a bug.
    const { venueScope, MANAGE } = await import("@/lib/mobile/venue-scope");
    const scope = await venueScope(request(member), "mobile-test", MANAGE);
    expect(scope).toMatchObject({ status: 403 });
    expect("message" in scope && scope.message).toMatch(/owner or admin/);
  });

  it("lets a member through for reads", async () => {
    const { venueScope, isFailure } = await import("@/lib/mobile/venue-scope");
    expect(isFailure(await venueScope(request(member), "mobile-test"))).toBe(false);
  });
});

describe("the space shapes the app parses (#24, #28)", () => {
  it("lists a space with the fields its card needs", async () => {
    const { spaceSummaries } = await import("@/lib/mobile/venue-json");
    const [space] = await spaceSummaries(ORG);
    expect(space).toMatchObject({
      id: spaceId,
      name: "Court 1",
      kind: "court",
      slotMinutes: 60,
      priceCents: 90000,
      isActive: true,
      imageUrl: null,
      upcomingBookings: 0,
    });
  });

  it("shows a peak price only when a rule beats the base", async () => {
    const { spaceSummaries } = await import("@/lib/mobile/venue-json");
    expect((await spaceSummaries(ORG))[0].peakPriceCents).toBe(120000);

    await sql`UPDATE pricing_rule SET price_cents = 80000 WHERE organization_id = ${ORG}`;
    expect((await spaceSummaries(ORG))[0].peakPriceCents).toBeNull();
    await sql`UPDATE pricing_rule SET price_cents = 120000 WHERE organization_id = ${ORG}`;
  });

  it("returns the week as wall clock, with the closed day simply absent", async () => {
    const { spaceDetail } = await import("@/lib/mobile/venue-json");
    const detail = await spaceDetail(ORG, spaceId);
    expect(detail).not.toBeNull();
    expect(detail!.hours).toHaveLength(6);
    expect(detail!.hours.some((h) => h.weekday === 0)).toBe(false);
    // "09:00", never "09:00:00" and never an instant — opening hours as
    // instants break silently twice a year wherever the clocks move.
    expect(detail!.hours[0].opensAt).toBe("09:00");
    expect(detail!.hours[0].closesAt).toBe("22:00");
  });

  it("returns pricing rules as wall clock with their weekday array", async () => {
    const { spaceDetail } = await import("@/lib/mobile/venue-json");
    const [rule] = (await spaceDetail(ORG, spaceId))!.pricingRules;
    expect(rule).toMatchObject({ label: "Peak", startsAt: "18:00", endsAt: "22:00", priceCents: 120000 });
    expect(rule.weekdays).toEqual([1, 2, 3]);
  });

  it("includes a venue-wide closure, because it shuts this space too", async () => {
    // Otherwise the editor shows an open day that is not open.
    const { spaceDetail } = await import("@/lib/mobile/venue-json");
    await sql`
      INSERT INTO closure (organization_id, space_id, starts_at, ends_at, reason)
      VALUES (${ORG}, NULL, now() + interval '1 day', now() + interval '2 days', 'Typhoon')
    `;
    const closures = (await spaceDetail(ORG, spaceId))!.closures;
    expect(closures).toHaveLength(1);
    expect(closures[0]).toMatchObject({ spaceId: null, reason: "Typhoon" });
    // Instants, so the app can render them in the venue's own zone.
    expect(closures[0].startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    await sql`DELETE FROM closure WHERE organization_id = ${ORG}`;
  });

  it("refuses to read a space from another venue", async () => {
    const { spaceDetail } = await import("@/lib/mobile/venue-json");
    expect(await spaceDetail(OTHER, spaceId)).toBeNull();
  });
});

describe("space slugs (#28)", () => {
  it("uses the name when it is free", async () => {
    const { uniqueSpaceSlug } = await import("@/lib/mobile/space-input");
    expect(await uniqueSpaceSlug(ORG, "Court 2")).toBe("court-2");
  });

  it("suffixes rather than colliding, because the slug is in share links", async () => {
    // "Court 1" already exists in this venue. A venue with two courts of the
    // same name is ordinary; failing on the unique index is not an answer.
    const { uniqueSpaceSlug } = await import("@/lib/mobile/space-input");
    expect(await uniqueSpaceSlug(ORG, "Court 1")).toBe("court-1-2");
  });

  it("keeps counting past the first suffix", async () => {
    const { uniqueSpaceSlug } = await import("@/lib/mobile/space-input");
    await sql`
      INSERT INTO space (organization_id, name, slug, sort_order)
      VALUES (${ORG}, 'Court 1', 'court-1-2', 9)
    `;
    expect(await uniqueSpaceSlug(ORG, "Court 1")).toBe("court-1-3");
    await sql`DELETE FROM space WHERE organization_id = ${ORG} AND slug = 'court-1-2'`;
  });

  it("is scoped per venue — two venues may both have court-1", async () => {
    const { uniqueSpaceSlug } = await import("@/lib/mobile/space-input");
    expect(await uniqueSpaceSlug(OTHER, "Court 1")).toBe("court-1");
  });

  it("falls back for a name with nothing slug-able in it", async () => {
    const { uniqueSpaceSlug } = await import("@/lib/mobile/space-input");
    expect(await uniqueSpaceSlug(ORG, "!!!")).toMatch(/^space-/);
  });
});

describe("the venue shape the app parses (#30)", () => {
  it("carries the settings screen's fields", async () => {
    const { venueSettings } = await import("@/lib/mobile/venue-json");
    const venue = await venueSettings(ORG, "owner");
    expect(venue).toMatchObject({
      slug: "mobile-test",
      name: "Mobile Test",
      tagline: "Book a court in seconds",
      timezone: "Asia/Manila",
      currency: "PHP",
      theme: "pine",
      cancellationMode: "grace",
      suspended: false,
    });
  });

  it("also carries what a VenueMembership needs, because one PATCH serves both", async () => {
    // Found on a device: the PATCH answered 200 and the app said "Something
    // went wrong", because onboarding parses this as a VenueMembership while
    // settings parses it as VenueSettings. One object has to satisfy both.
    const { venueSettings } = await import("@/lib/mobile/venue-json");
    const venue = await venueSettings(ORG, "owner");
    expect(venue).toMatchObject({ orgId: ORG, role: "owner", activeSpaces: 1 });
  });

  it("counts only active spaces, since the billing band moves with them", async () => {
    const { venueSettings } = await import("@/lib/mobile/venue-json");
    await sql`UPDATE space SET is_active = false WHERE id = ${spaceId}::uuid`;
    expect((await venueSettings(ORG, "owner"))!.activeSpaces).toBe(0);
    await sql`UPDATE space SET is_active = true WHERE id = ${spaceId}::uuid`;
  });

  it("reports a suspension, which every screen reads", async () => {
    const { venueSettings } = await import("@/lib/mobile/venue-json");
    await sql`
      UPDATE venue SET suspended_at = now(), suspended_reason = 'Overdue'
      WHERE organization_id = ${ORG}
    `;
    const venue = await venueSettings(ORG, "owner");
    expect(venue).toMatchObject({ suspended: true, suspendedReason: "Overdue" });
    await sql`UPDATE venue SET suspended_at = NULL, suspended_reason = NULL WHERE organization_id = ${ORG}`;
  });

  it("is null for an organisation with no venue row", async () => {
    const { venueSettings } = await import("@/lib/mobile/venue-json");
    expect(await venueSettings("org_does_not_exist")).toBeNull();
  });
});

describe("memberships (#13)", () => {
  it("shapes each venue the way the picker reads it", async () => {
    const { membershipsFor } = await import("@/lib/mobile/session");
    const venues = await membershipsFor("mob_owner");
    expect(venues).toHaveLength(1);
    expect(venues[0]).toMatchObject({
      orgId: ORG,
      slug: "mobile-test",
      name: "Mobile Test",
      role: "owner",
      timezone: "Asia/Manila",
      currency: "PHP",
      theme: "pine",
      suspended: false,
      activeSpaces: 1,
    });
  });

  it("gives an unknown role the least privilege rather than failing", async () => {
    const { membershipsFor } = await import("@/lib/mobile/session");
    await sql`UPDATE member SET role = 'bookkeeper' WHERE id = 'm_mob_owner'`;
    expect((await membershipsFor("mob_owner"))[0].role).toBe("member");
    await sql`UPDATE member SET role = 'owner' WHERE id = 'm_mob_owner'`;
  });

  it("is empty for a user in no venue — a valid state, not an error", async () => {
    const { membershipsFor } = await import("@/lib/mobile/session");
    expect(await membershipsFor("mob_nobody")).toEqual([]);
  });
});
