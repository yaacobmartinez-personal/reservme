import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Nothing here should reach a mail provider; the email test reads what would
// have been sent.
const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn<
    (email: { to: string; html: string }) => Promise<{ ok: true; id: null; delivered: false }>
  >(async () => ({ ok: true, id: null, delivered: false })),
}));
vi.mock("@/lib/email/mailer", () => ({ sendEmail }));

/**
 * The platform-admin console, as the app reaches it (docs/API-CONTRACT.md
 * #35–#41). What is pinned is money and access: how far an approval extends a
 * subscription, that approving twice is not two months, which suspension a
 * payment lifts and which it must leave, the last-admin guard, and that every
 * decision leaves an attributed audit row.
 */

const ORG = "org_admin_test";
const OTHER = "org_admin_test_2";
const ADMIN = "u_admin_test";
const SECOND_ADMIN = "u_admin_test_2";
const OWNER = "u_admin_owner";
const ORIGIN = { ip: "203.0.113.9", userAgent: "reservme-flutter/test" };
const actor = { userId: ADMIN, origin: ORIGIN };

let sql: postgres.Sql;

async function user(id: string, name: string, email: string) {
  await sql`
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
    VALUES (${id}, ${name}, ${email}, true, now(), now())
    ON CONFLICT (id) DO NOTHING
  `;
}

async function payment(org: string, reference: string) {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO billing_payment (organization_id, amount_cents, reference, paid_at, status)
    VALUES (${org}, 99900, ${reference}, now(), 'submitted')
    RETURNING id
  `;
  return row.id;
}

async function lastAudit(action: string) {
  const [row] = await sql<
    { actor_user_id: string; organization_id: string | null; ip: string | null; user_agent: string | null; detail: Record<string, unknown> | null }[]
  >`
    SELECT actor_user_id, organization_id, ip, user_agent, detail
    FROM admin_audit WHERE action = ${action} AND actor_user_id = ${ADMIN}
    ORDER BY created_at DESC LIMIT 1
  `;
  return row;
}

async function cleanup() {
  await sql`DELETE FROM admin_audit WHERE actor_user_id IN (${ADMIN}, ${SECOND_ADMIN})`;
  await sql`DELETE FROM organization WHERE id IN (${ORG}, ${OTHER})`;
  await sql`DELETE FROM platform_admin WHERE user_id IN (${ADMIN}, ${SECOND_ADMIN})`;
  await sql`DELETE FROM "user" WHERE id IN (${ADMIN}, ${SECOND_ADMIN}, ${OWNER})`;
}

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  await cleanup();

  await user(ADMIN, "Ada Admin", "ada@admin.test");
  await user(SECOND_ADMIN, "Ben Admin", "ben@admin.test");
  await user(OWNER, "Olga Owner", "olga@admin.test");
  await sql`INSERT INTO platform_admin (user_id) VALUES (${ADMIN})`;

  for (const [id, name, slug] of [
    [ORG, "Admin Test Courts", "admin-test-courts"],
    [OTHER, "Second Venue", "admin-test-second"],
  ]) {
    await sql`INSERT INTO organization (id, name, slug, created_at) VALUES (${id}, ${name}, ${slug}, now())`;
    await sql`INSERT INTO venue (organization_id, timezone) VALUES (${id}, 'Asia/Manila')`;
    await sql`
      INSERT INTO subscription (organization_id, status, trial_ends_at)
      VALUES (${id}, 'trialing', now() + interval '10 days')
    `;
  }
  await sql`
    INSERT INTO member (id, organization_id, user_id, role, created_at)
    VALUES ('m_admin_owner', ${ORG}, ${OWNER}, 'owner', now())
  `;
}, 60_000);

afterAll(async () => {
  await cleanup();
  await sql.end();
});

beforeEach(async () => {
  await sql`DELETE FROM billing_payment WHERE organization_id IN (${ORG}, ${OTHER})`;
  await sql`
    UPDATE subscription SET status = 'trialing', paid_until = NULL,
           trial_ends_at = now() + interval '10 days'
    WHERE organization_id IN (${ORG}, ${OTHER})
  `;
  await sql`UPDATE venue SET suspended_at = NULL, suspended_reason = NULL WHERE organization_id IN (${ORG}, ${OTHER})`;
});

describe("who counts as a platform admin", () => {
  it("is read from platform_admin, and a revoke takes effect at once", async () => {
    const { isPlatformAdmin } = await import("@/lib/mobile/admin-json");
    expect(await isPlatformAdmin(ADMIN)).toBe(true);
    expect(await isPlatformAdmin(OWNER)).toBe(false);

    await sql`INSERT INTO platform_admin (user_id) VALUES (${SECOND_ADMIN})`;
    expect(await isPlatformAdmin(SECOND_ADMIN)).toBe(true);
    await sql`UPDATE platform_admin SET revoked_at = now() WHERE user_id = ${SECOND_ADMIN}`;
    expect(await isPlatformAdmin(SECOND_ADMIN)).toBe(false);
    await sql`DELETE FROM platform_admin WHERE user_id = ${SECOND_ADMIN}`;
  });
});

describe("approving a payment (#39)", () => {
  it("extends a month past the trial end when paid during the trial", async () => {
    const { approvePayment } = await import("@/lib/admin/operations");
    const id = await payment(ORG, "REF-TRIAL");

    expect(await approvePayment(actor, id)).toEqual({ ok: true });

    const [sub] = await sql<{ status: string; days: number }[]>`
      SELECT status,
             EXTRACT(EPOCH FROM (paid_until - trial_ends_at)) / 86400 AS days
      FROM subscription WHERE organization_id = ${ORG}
    `;
    expect(sub.status).toBe("active");
    // Paying early never costs the venue days: the month starts where the
    // trial ends, not today.
    expect(Math.round(Number(sub.days))).toBeGreaterThanOrEqual(28);
    expect(Math.round(Number(sub.days))).toBeLessThanOrEqual(31);
  });

  it("is not a second month when approved twice", async () => {
    const { approvePayment } = await import("@/lib/admin/operations");
    const id = await payment(ORG, "REF-TWICE");

    await approvePayment(actor, id);
    const [before] = await sql<{ paid_until: Date }[]>`SELECT paid_until FROM subscription WHERE organization_id = ${ORG}`;

    const again = await approvePayment(actor, id);
    expect(again).toMatchObject({ ok: false, reason: "not_submitted" });
    const [after] = await sql<{ paid_until: Date }[]>`SELECT paid_until FROM subscription WHERE organization_id = ${ORG}`;
    expect(after.paid_until.getTime()).toBe(before.paid_until.getTime());
  });

  it("lifts a billing suspension but never a manual one", async () => {
    const { approvePayment } = await import("@/lib/admin/operations");
    const { BILLING_SUSPEND_REASON } = await import("@/lib/billing");

    await sql`UPDATE venue SET suspended_at = now(), suspended_reason = ${BILLING_SUSPEND_REASON} WHERE organization_id = ${ORG}`;
    await sql`UPDATE venue SET suspended_at = now(), suspended_reason = 'Abuse report' WHERE organization_id = ${OTHER}`;

    await approvePayment(actor, await payment(ORG, "REF-LIFT"));
    await approvePayment(actor, await payment(OTHER, "REF-KEEP"));

    const rows = await sql<{ organization_id: string; suspended_at: Date | null }[]>`
      SELECT organization_id, suspended_at FROM venue WHERE organization_id IN (${ORG}, ${OTHER})
    `;
    const by = new Map(rows.map((r) => [r.organization_id, r.suspended_at]));
    expect(by.get(ORG)).toBeNull();
    expect(by.get(OTHER)).not.toBeNull();
  });

  it("leaves an attributed audit row with where it came from", async () => {
    const { approvePayment } = await import("@/lib/admin/operations");
    await approvePayment(actor, await payment(ORG, "REF-AUDIT"));

    const row = await lastAudit("admin.approved_payment");
    expect(row.organization_id).toBe(ORG);
    expect(row.ip).toBe(ORIGIN.ip);
    expect(row.user_agent).toBe(ORIGIN.userAgent);
    expect(row.detail).toMatchObject({ reference: "REF-AUDIT", amountCents: 99900 });
  });
});

describe("rejecting a payment (#39)", () => {
  it("records the note and leaves the subscription alone", async () => {
    const { rejectPayment } = await import("@/lib/admin/operations");
    const id = await payment(ORG, "REF-BAD");

    expect(await rejectPayment(actor, id, "No transfer with that reference")).toEqual({ ok: true });
    const [pay] = await sql<{ status: string; note: string }[]>`SELECT status, note FROM billing_payment WHERE id = ${id}`;
    expect(pay).toEqual({ status: "rejected", note: "No transfer with that reference" });
    const [sub] = await sql<{ status: string }[]>`SELECT status FROM subscription WHERE organization_id = ${ORG}`;
    expect(sub.status).toBe("trialing");

    expect(await rejectPayment(actor, id, null)).toMatchObject({ reason: "not_submitted" });
  });
});

describe("billing overrides (#38)", () => {
  it("marks paid through the end of the chosen day", async () => {
    const { markPaidUntil } = await import("@/lib/admin/operations");
    await markPaidUntil(actor, ORG, "2031-03-15");

    const [sub] = await sql<{ status: string; day: string }[]>`
      SELECT status, to_char(paid_until AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
      FROM subscription WHERE organization_id = ${ORG}
    `;
    // Inclusive: paid *through* the 15th, so it runs out as the 16th begins.
    expect(sub).toEqual({ status: "active", day: "2031-03-16" });
  });

  it("comps, lifting a billing suspension", async () => {
    const { compSubscription } = await import("@/lib/admin/operations");
    const { BILLING_SUSPEND_REASON } = await import("@/lib/billing");
    await sql`UPDATE venue SET suspended_at = now(), suspended_reason = ${BILLING_SUSPEND_REASON} WHERE organization_id = ${ORG}`;

    await compSubscription(actor, ORG);

    const [row] = await sql<{ status: string; suspended_at: Date | null }[]>`
      SELECT s.status, v.suspended_at FROM subscription s JOIN venue v USING (organization_id)
      WHERE s.organization_id = ${ORG}
    `;
    expect(row).toEqual({ status: "comped", suspended_at: null });
  });

  it("answers not_found for a venue that does not exist", async () => {
    const { cancelSubscription } = await import("@/lib/admin/operations");
    expect(await cancelSubscription(actor, "org_nope")).toMatchObject({ reason: "not_found" });
  });
});

describe("suspending a venue (#37)", () => {
  it("suspends with a reason, reactivates, and audits both", async () => {
    const { reactivateVenue, suspendVenue } = await import("@/lib/admin/operations");

    await suspendVenue(actor, ORG, "Chargeback dispute");
    const [down] = await sql<{ suspended_reason: string }[]>`SELECT suspended_reason FROM venue WHERE organization_id = ${ORG}`;
    expect(down.suspended_reason).toBe("Chargeback dispute");
    expect((await lastAudit("admin.suspended_venue")).detail).toEqual({ reason: "Chargeback dispute" });

    await reactivateVenue(actor, ORG);
    const [up] = await sql<{ suspended_at: Date | null }[]>`SELECT suspended_at FROM venue WHERE organization_id = ${ORG}`;
    expect(up.suspended_at).toBeNull();
    expect((await lastAudit("admin.reactivated_venue")).organization_id).toBe(ORG);
  });
});

describe("emailing a tenant (#37)", () => {
  it("refuses an empty message", async () => {
    const { emailTenant } = await import("@/lib/admin/operations");
    expect(await emailTenant(actor, ORG, "Hi", " ")).toMatchObject({ reason: "invalid" });
  });

  it("escapes what the admin typed, so a message cannot inject markup", async () => {
    sendEmail.mockClear();
    const { emailTenant } = await import("@/lib/admin/operations");

    expect(
      await emailTenant(actor, ORG, "Your invoice", "Pay <b>now</b>\n\nThanks"),
    ).toEqual({ ok: true });

    const sent = sendEmail.mock.calls[0][0];
    expect(sent.to).toBe("olga@admin.test");
    expect(sent.html).toContain("Pay &lt;b&gt;now&lt;/b&gt;");
    expect(sent.html).not.toContain("<b>now</b>");
  });

  it("says so when the venue has no owner email", async () => {
    const { emailTenant } = await import("@/lib/admin/operations");
    expect(await emailTenant(actor, OTHER, "Hello", "Anyone there?")).toMatchObject({
      reason: "no_owner_email",
    });
  });
});

describe("revoking an admin (#41)", () => {
  it("will not remove the last one", async () => {
    const { revokeAdmin } = await import("@/lib/admin/operations");
    expect(await revokeAdmin(actor, ADMIN)).toMatchObject({ ok: false, reason: "last_admin" });
    const [row] = await sql<{ revoked_at: Date | null }[]>`SELECT revoked_at FROM platform_admin WHERE user_id = ${ADMIN}`;
    expect(row.revoked_at).toBeNull();
  });

  it("removes one of two", async () => {
    const { revokeAdmin } = await import("@/lib/admin/operations");
    await sql`INSERT INTO platform_admin (user_id) VALUES (${SECOND_ADMIN}) ON CONFLICT (user_id) DO UPDATE SET revoked_at = NULL`;

    expect(await revokeAdmin(actor, SECOND_ADMIN)).toEqual({ ok: true });
    expect(await lastAudit("admin.revoked_admin")).toBeTruthy();
    await sql`DELETE FROM platform_admin WHERE user_id = ${SECOND_ADMIN}`;
  });
});

describe("what the console screens read (#35, #36, #41)", () => {
  it("finds tenants by name or slug", async () => {
    const { tenantsJson } = await import("@/lib/mobile/admin-json");
    const byName = await tenantsJson("admin test courts");
    expect(byName.tenants.map((t) => t.orgId)).toEqual([ORG]);
    const bySlug = await tenantsJson("admin-test-second");
    expect(bySlug.tenants.map((t) => t.orgId)).toEqual([OTHER]);
  });

  it("gives amounts in centavos, like every other amount on the wire", async () => {
    const { overviewJson, tenantsJson } = await import("@/lib/mobile/admin-json");
    const { tenants } = await tenantsJson("admin-test-courts");
    const band = tenants[0].band;
    if (band.priceCents !== null) expect(band.priceCents % 100).toBe(0);

    const overview = await overviewJson();
    expect(overview.totals.runRateCents % 100).toBe(0);
    expect(overview.growth).toHaveLength(12);
  });

  it("returns null for a venue that does not exist", async () => {
    const { tenantDetailJson } = await import("@/lib/mobile/admin-json");
    expect(await tenantDetailJson("org_nope")).toBeNull();
    const detail = await tenantDetailJson(ORG);
    expect(detail?.members.map((m) => m.email)).toEqual(["olga@admin.test"]);
  });

  it("keeps the IP address on the server", async () => {
    const { suspendVenue } = await import("@/lib/admin/operations");
    const { auditJson } = await import("@/lib/mobile/admin-json");
    await suspendVenue(actor, OTHER, null);

    const { entries } = await auditJson(20);
    const mine = entries.find((e) => e.action === "admin.suspended_venue");
    expect(mine).toBeDefined();
    expect(mine).not.toHaveProperty("ip");
  });
});

describe("the gate every admin route starts with", () => {
  it("answers 401 with no session", async () => {
    const { adminGate } = await import("@/lib/mobile/admin-json");
    const gate = await adminGate(new Request("http://app.localhost:3000/api/mobile/admin/overview"));
    expect(gate.response?.status).toBe(401);
  });

  it("answers 401 for a token that is not a session", async () => {
    const { adminGate } = await import("@/lib/mobile/admin-json");
    const gate = await adminGate(
      new Request("http://app.localhost:3000/api/mobile/admin/overview", {
        headers: { authorization: "Bearer not-a-real-token" },
      }),
    );
    expect(gate.response?.status).toBe(401);
  });
});
