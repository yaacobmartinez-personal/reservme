import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The owner features that were web-only (docs/API-CONTRACT.md #42–#47):
 * membership plans and grants, promo codes, the review link and loyalty
 * rules, integrations, and CSV export. What is pinned is what the app would
 * get wrong on its own: which unit an amount is in, which zone an expiry is
 * in, what a customer's profile now carries, and which secrets are shown once.
 */

const ORG = "org_growth_test";
const OTHER = "org_growth_other";
const TZ = "Asia/Manila";

let sql: postgres.Sql;
let customerId: string;

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  await sql`DELETE FROM organization WHERE id IN (${ORG}, ${OTHER})`;
  for (const [id, slug] of [
    [ORG, "growth-test"],
    [OTHER, "growth-other"],
  ]) {
    await sql`INSERT INTO organization (id, name, slug, created_at) VALUES (${id}, ${slug}, ${slug}, now())`;
    await sql`INSERT INTO venue (organization_id, timezone) VALUES (${id}, ${TZ})`;
  }
  const [c] = await sql<{ id: string }[]>`
    INSERT INTO customer (organization_id, name, email, loyalty_points)
    VALUES (${ORG}, 'Lia Loyal', 'lia@growth.test', 12)
    RETURNING id
  `;
  customerId = c.id;
}, 60_000);

afterAll(async () => {
  await sql`DELETE FROM organization WHERE id IN (${ORG}, ${OTHER})`;
  await sql.end();
});

describe("membership plans (#42)", () => {
  it("needs credits or a discount, and says so in the owner's words", async () => {
    const { createPlan } = await import("@/lib/memberships");
    const result = await createPlan(ORG, { name: "Nothing", kind: "pass", price: 500 });
    expect(result).toEqual({
      ok: false,
      field: "credits",
      message: "A plan needs either credits or a discount (or both).",
    });
  });

  it("takes whole pesos in, answers in centavos, and lets the kind decide the period", async () => {
    const { createPlan } = await import("@/lib/memberships");
    const { plansJson } = await import("@/lib/mobile/growth-json");

    const pass = await createPlan(ORG, { name: "10-pack", kind: "pass", price: "4500", credits: "10", validDays: "90" });
    const club = await createPlan(ORG, { name: "Club", kind: "membership", price: 999, discountPct: 20 });
    expect(pass.ok && club.ok).toBe(true);

    const { plans } = await plansJson(ORG);
    const byName = new Map(plans.map((p) => [p.name, p]));
    expect(byName.get("10-pack")).toMatchObject({
      priceCents: 450000,
      credits: 10,
      validDays: 90,
      period: "one_time",
      discountPct: null,
      active: true,
      holders: 0,
    });
    expect(byName.get("Club")).toMatchObject({ period: "monthly", discountPct: 20, credits: null });
  });

  it("refuses a second plan with the same name", async () => {
    const { createPlan } = await import("@/lib/memberships");
    expect(await createPlan(ORG, { name: "Club", kind: "membership", price: 1, discountPct: 5 })).toMatchObject({
      ok: false,
      field: "name",
      message: "You already have a plan named Club.",
    });
  });

  it("cannot pause another venue's plan", async () => {
    const { setPlanActive } = await import("@/lib/memberships");
    const [plan] = await sql<{ id: string }[]>`SELECT id FROM membership_plan WHERE organization_id = ${ORG} LIMIT 1`;
    expect(await setPlanActive(OTHER, plan.id, false)).toBe(false);
    expect(await setPlanActive(ORG, plan.id, false)).toBe(true);
    await setPlanActive(ORG, plan.id, true);
  });
});

describe("a customer's profile (#21, #43)", () => {
  it("carries loyalty points, opt-in and holdings once a plan is granted", async () => {
    const { grantMembership } = await import("@/lib/memberships");
    const { customerDetail } = await import("@/lib/mobile/customer-json");
    const [plan] = await sql<{ id: string }[]>`
      SELECT id FROM membership_plan WHERE organization_id = ${ORG} AND name = '10-pack'
    `;

    const before = await customerDetail(ORG, customerId, TZ);
    expect(before?.customer.loyaltyPoints).toBe(12);
    expect(before?.customer.marketingOptIn).toBe(false);
    expect(before?.holdings).toEqual([]);

    expect(await grantMembership(ORG, customerId, plan.id)).toMatchObject({ ok: true });

    const after = await customerDetail(ORG, customerId, TZ);
    expect(after?.holdings).toHaveLength(1);
    expect(after?.holdings[0]).toMatchObject({
      planName: "10-pack",
      kind: "pass",
      creditsRemaining: 10,
      status: "active",
    });
    // Valid for 90 days from the grant.
    const days = (Date.parse(after!.holdings[0].expiresAt!) - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(90);
  });

  it("will not grant a paused plan", async () => {
    const { grantMembership, setPlanActive } = await import("@/lib/memberships");
    const [plan] = await sql<{ id: string }[]>`
      SELECT id FROM membership_plan WHERE organization_id = ${ORG} AND name = 'Club'
    `;
    await setPlanActive(ORG, plan.id, false);
    expect(await grantMembership(ORG, customerId, plan.id)).toEqual({
      ok: false,
      error: "That plan isn't available.",
    });
    await setPlanActive(ORG, plan.id, true);
  });
});

describe("promo codes (#44)", () => {
  it("upper-cases the code and stores a peso amount in centavos", async () => {
    const { createPromo } = await import("@/lib/promo");
    const { promosJson } = await import("@/lib/mobile/growth-json");

    expect(await createPromo(ORG, TZ, { code: "save50", kind: "amount", value: "50" })).toMatchObject({
      ok: true,
      code: "SAVE50",
    });
    const code = (await promosJson(ORG)).codes.find((c) => c.code === "SAVE50");
    expect(code).toMatchObject({ kind: "amount", amountCents: 5000, percent: null, uses: 0, active: true });
  });

  it("keeps a percentage between 1 and 100", async () => {
    const { createPromo } = await import("@/lib/promo");
    expect(await createPromo(ORG, TZ, { code: "HALF", kind: "percent", value: 150 })).toMatchObject({
      ok: false,
      field: "value",
      message: "A percentage discount must be between 1 and 100.",
    });
  });

  it("expires at the end of the day in the venue's zone, not UTC's", async () => {
    const { createPromo } = await import("@/lib/promo");
    const { promosJson } = await import("@/lib/mobile/growth-json");

    await createPromo(ORG, TZ, { code: "NEWYEAR", kind: "percent", value: 10, expiresAt: "2031-01-01" });
    const code = (await promosJson(ORG)).codes.find((c) => c.code === "NEWYEAR");
    // 23:59:59 Manila on 1 Jan is 15:59:59 UTC the same day.
    expect(code?.expiresAt).toBe("2031-01-01T15:59:59.000Z");
  });

  it("refuses spaces and duplicates", async () => {
    const { createPromo } = await import("@/lib/promo");
    expect(await createPromo(ORG, TZ, { code: "two words", kind: "percent", value: 5 })).toMatchObject({
      field: "code",
    });
    expect(await createPromo(ORG, TZ, { code: "Save50", kind: "percent", value: 5 })).toMatchObject({
      ok: false,
      message: "You already have a code named SAVE50.",
    });
  });
});

describe("marketing (#45)", () => {
  it("accepts a real link, refuses anything else, and clears on empty", async () => {
    const { reviewUrlProblem, setReviewUrl } = await import("@/lib/engagement");
    const { marketingJson } = await import("@/lib/mobile/growth-json");

    expect(reviewUrlProblem("g.page/growth")).toBe("Enter a full link, e.g. https://g.page/…");
    expect(reviewUrlProblem("javascript:alert(1)")).not.toBeNull();
    expect(reviewUrlProblem("https://g.page/growth")).toBeNull();
    expect(reviewUrlProblem("")).toBeNull();

    await setReviewUrl(ORG, " https://g.page/growth ");
    expect(await marketingJson(ORG)).toEqual({
      reviewUrl: "https://g.page/growth",
      loyalty: { pesosPerPoint: 100, winbackAfterDays: 60 },
    });
    await setReviewUrl(ORG, "");
    expect((await marketingJson(ORG)).reviewUrl).toBeNull();
  });
});

describe("integrations (#46)", () => {
  it("rotating the feed changes its URL", async () => {
    const { rotateIcalToken } = await import("@/lib/ical");
    const { integrationsJson } = await import("@/lib/mobile/growth-json");

    const before = (await integrationsJson(ORG)).icalUrl;
    await rotateIcalToken(ORG);
    const after = (await integrationsJson(ORG)).icalUrl;
    expect(after).toMatch(/\/api\/calendar\/[0-9a-f-]{36}$/);
    expect(after).not.toBe(before);
  });

  it("shows an API key's prefix, never the key", async () => {
    const { createApiKey } = await import("@/lib/api-keys");
    const { integrationsJson } = await import("@/lib/mobile/growth-json");

    const { key } = await createApiKey(ORG, "Accounting");
    const listed = JSON.stringify(await integrationsJson(ORG));
    expect(listed).not.toContain(key);
    expect(listed).toContain(key.slice(0, 14));
  });

  it("lists a webhook with the secret the owner needs to verify it", async () => {
    const { createWebhook } = await import("@/lib/webhooks");
    const { integrationsJson } = await import("@/lib/mobile/growth-json");

    const { secret } = await createWebhook(ORG, "https://hooks.test/in", ["booking.created"]);
    const { webhooks, webhookEvents } = await integrationsJson(ORG);
    expect(webhooks[0]).toMatchObject({ url: "https://hooks.test/in", secret, events: ["booking.created"] });
    expect(webhookEvents).toEqual(["booking.created", "booking.cancelled"]);
  });
});

describe("export (#47)", () => {
  it("produces each CSV with its header row", async () => {
    const { exportCsv } = await import("@/lib/mobile/growth-json");
    const bookings = await exportCsv("bookings", ORG, TZ);
    const customers = await exportCsv("customers", ORG, TZ);
    const transactions = await exportCsv("transactions", ORG, TZ);

    // CRLF line endings: what spreadsheets expect.
    expect(transactions.split("\r\n")[0]).toBe("Date,Reference,Customer,Space,Status,Gross,Discount,Net");
    expect(customers).toContain("lia@growth.test");
    expect(bookings.endsWith("\r\n")).toBe(true);
  });
});
