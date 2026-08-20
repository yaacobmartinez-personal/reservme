/**
 * Exercises the owner-side read queries in src/lib/owner.ts against a
 * throwaway venue with spaces, hours, a pricing rule, a closure and a session.
 * Self-contained — creates and cleans up its own org.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ORG = "org_owner_test";
const TZ = "Asia/Manila";
const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });

let spaceId: string;

beforeAll(async () => {
  await sql`DELETE FROM organization WHERE id = ${ORG}`;
  await sql`
    INSERT INTO organization (id, name, slug, logo)
    VALUES (${ORG}, 'Owner Test', 'owner-test', 'https://cdn.example/logo.png')`;
  await sql`
    INSERT INTO venue (organization_id, timezone, currency, theme, cover_url,
                       tagline, address, min_notice_minutes, max_horizon_days,
                       gcash_name, gcash_qr_url)
    VALUES (${ORG}, ${TZ}, 'PHP', 'ocean', 'https://cdn.example/cover.jpg',
            'Best courts in QC', '12 Katipunan Ave', 120, 21,
            'Owner Juan', 'https://cdn.example/qr.png')`;

  const [active] = await sql<{ id: string }[]>`
    INSERT INTO space (organization_id, name, slug, price_cents, slot_minutes,
                       sort_order, is_active, image_url)
    VALUES (${ORG}, 'Court 1', 'court-1', 90000, 60, 0, true,
            'https://cdn.example/court.jpg')
    RETURNING id`;
  spaceId = active.id;

  // A deactivated space, to exercise the "active first" ordering.
  await sql`
    INSERT INTO space (organization_id, name, slug, price_cents, slot_minutes, sort_order, is_active)
    VALUES (${ORG}, 'Old Court', 'old-court', 50000, 60, 1, false)`;

  for (const w of [1, 2, 3, 4, 5]) {
    await sql`
      INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at)
      VALUES (${spaceId}::uuid, ${w}, '08:00', '22:00')`;
  }

  await sql`
    INSERT INTO pricing_rule (organization_id, space_id, label, weekdays, starts_at, ends_at, price_cents)
    VALUES (${ORG}, ${spaceId}::uuid, 'Peak', ARRAY[5, 6], '18:00', '22:00', 120000)`;

  await sql`
    INSERT INTO closure (organization_id, space_id, starts_at, ends_at, reason)
    VALUES (${ORG}, ${spaceId}::uuid, now() + interval '1 day',
            now() + interval '1 day 2 hours', 'Maintenance')`;

  await sql`
    INSERT INTO play_session (organization_id, space_id, title, starts_at, ends_at, capacity,
                              booked_spots, price_per_person_cents, cancelled)
    VALUES (${ORG}, ${spaceId}::uuid, 'Open Play', now() + interval '2 days',
            now() + interval '2 days 2 hours', 8, 2, 15000, false)`;
});

afterAll(async () => {
  await sql`DELETE FROM organization WHERE id = ${ORG}`;
});

describe("getBranding", () => {
  it("returns the venue's theme, logo and cover", async () => {
    const { getBranding } = await import("@/lib/owner");
    const b = await getBranding(ORG);
    expect(b.theme).toBe("ocean");
    expect(b.logo).toBe("https://cdn.example/logo.png");
    expect(b.coverUrl).toBe("https://cdn.example/cover.jpg");
  });
});

describe("listOwnerSpaces / getOwnerSpace", () => {
  it("lists every space, active ones first, with open-day counts", async () => {
    const { listOwnerSpaces } = await import("@/lib/owner");
    const spaces = await listOwnerSpaces(ORG);
    expect(spaces).toHaveLength(2);
    expect(spaces[0].isActive).toBe(true);
    expect(spaces[1].isActive).toBe(false);
    expect(spaces[0].openDays).toBe(5);
    expect(spaces[0].imageUrl).toBe("https://cdn.example/court.jpg");
    expect(spaces[0].priceCents).toBe(90000);
  });

  it("resolves one space by id and null for a stranger", async () => {
    const { getOwnerSpace } = await import("@/lib/owner");
    expect((await getOwnerSpace(ORG, spaceId))?.name).toBe("Court 1");
    expect(await getOwnerSpace(ORG, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("getOpeningHours", () => {
  it("returns one HH:MM row per open weekday, ordered", async () => {
    const { getOpeningHours } = await import("@/lib/owner");
    const hours = await getOpeningHours(spaceId);
    expect(hours.map((h) => h.weekday)).toEqual([1, 2, 3, 4, 5]);
    expect(hours[0].opensAt).toBe("08:00");
    expect(hours[0].closesAt).toBe("22:00");
  });
});

describe("listPricingRules", () => {
  it("returns the peak rule with its weekdays and HH:MM window", async () => {
    const { listPricingRules } = await import("@/lib/owner");
    const rules = await listPricingRules(spaceId);
    expect(rules).toHaveLength(1);
    expect(rules[0].label).toBe("Peak");
    expect(rules[0].weekdays).toEqual([5, 6]);
    expect(rules[0].startsAt).toBe("18:00");
    expect(rules[0].priceCents).toBe(120000);
  });
});

describe("getClosures", () => {
  it("returns the future closure with a formatted label", async () => {
    const { getClosures } = await import("@/lib/owner");
    const closures = await getClosures(ORG, TZ);
    expect(closures).toHaveLength(1);
    expect(closures[0].reason).toBe("Maintenance");
    expect(closures[0].spaceName).toBe("Court 1");
    expect(closures[0].label).toContain("–");
  });
});

describe("listSpaceSessions", () => {
  it("returns the upcoming session with capacity and booked spots", async () => {
    const { listSpaceSessions } = await import("@/lib/owner");
    const sessions = await listSpaceSessions(spaceId, TZ);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe("Open Play");
    expect(sessions[0].capacity).toBe(8);
    expect(sessions[0].bookedSpots).toBe(2);
    expect(sessions[0].priceCents).toBe(15000);
  });
});

describe("getVenueSettings", () => {
  it("returns the venue's policy + payout settings", async () => {
    const { getVenueSettings } = await import("@/lib/owner");
    const s = await getVenueSettings(ORG);
    expect(s).not.toBeNull();
    expect(s?.name).toBe("Owner Test");
    expect(s?.slug).toBe("owner-test");
    expect(s?.timezone).toBe(TZ);
    expect(s?.minNoticeMinutes).toBe(120);
    expect(s?.maxHorizonDays).toBe(21);
    expect(s?.gcashName).toBe("Owner Juan");
    expect(s?.gcashQrUrl).toBe("https://cdn.example/qr.png");
  });

  it("returns null for an unknown org", async () => {
    const { getVenueSettings } = await import("@/lib/owner");
    expect(await getVenueSettings("org_does_not_exist")).toBeNull();
  });
});
