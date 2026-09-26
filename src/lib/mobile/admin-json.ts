import { sql } from "@/db";
import { originFrom } from "@/lib/admin/audit";
import type { AdminActor } from "@/lib/admin/operations";
import {
  billingRadar,
  getTenant,
  growthMetrics,
  listTenants,
  monthlyRunRate,
  platformTotals,
  type TenantRow,
} from "@/lib/admin/queries";
import { getAuditLog } from "@/lib/admin/audit";
import { instapayConfig, listOrgPayments, listSubmittedPayments } from "@/lib/billing";
import { conflict, fail, notFound, ok, unauthorized } from "@/lib/mobile/respond";
import { mobileUser, type MobileUser } from "@/lib/mobile/session";

/**
 * The platform-admin half of the mobile API (docs/API-CONTRACT.md #35–#41).
 *
 * Admin status is read from `platform_admin` on every request, as the web
 * console does — never cached in a token — so a revoke takes effect on the
 * next tap, not the next sign-in. Everything here reuses the console's own
 * queries and `lib/admin/operations`, so the two surfaces cannot disagree.
 */

export type MobileAdmin = { user: MobileUser; actor: AdminActor };

/**
 * The caller, if they are a current platform admin. `null` covers both "not
 * signed in" and "signed in but not an admin"; the route answers 401 for the
 * first and **404** for the second — the console's existence is not something
 * a venue owner's token should be able to confirm.
 */
export async function mobileAdmin(
  request: Request,
): Promise<{ user: MobileUser | null; admin: MobileAdmin | null }> {
  const user = await mobileUser(request);
  if (!user) return { user: null, admin: null };
  const [row] = await sql<{ user_id: string }[]>`
    SELECT user_id FROM platform_admin
    WHERE user_id = ${user.id} AND revoked_at IS NULL
  `;
  if (!row) return { user, admin: null };
  return {
    user,
    admin: { user, actor: { userId: user.id, origin: originFrom(request.headers) } },
  };
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [row] = await sql<{ user_id: string }[]>`
    SELECT user_id FROM platform_admin WHERE user_id = ${userId} AND revoked_at IS NULL
  `;
  return Boolean(row);
}

function tenantJson(t: TenantRow) {
  return {
    orgId: t.organizationId,
    name: t.name,
    slug: t.slug,
    timezone: t.timezone,
    currency: t.currency,
    createdAt: t.createdAt.toISOString(),
    suspendedAt: t.suspendedAt?.toISOString() ?? null,
    suspendedReason: t.suspendedReason,
    billingSuspended: t.billingSuspended,
    activeSpaces: t.activeSpaces,
    memberCount: t.memberCount,
    upcomingBookings: t.upcomingBookings,
    bookingsLast30: t.bookingsLast30,
    revenueLast30Cents: t.revenueLast30Cents,
    subscription: {
      status: t.subStatus,
      trialDaysLeft: t.trialDaysLeft,
      dueNow: t.dueNow,
    },
    band: { name: t.band.name, priceCents: t.band.price === null ? null : t.band.price * 100 },
  };
}

/** #35 — the numbers on the console's front page. */
export async function overviewJson() {
  const tenants = await listTenants();
  const [totals, radar, growth, pending] = await Promise.all([
    platformTotals(),
    billingRadar(tenants),
    growthMetrics(12),
    listSubmittedPayments(),
  ]);
  return {
    totals: {
      tenants: totals.tenants,
      suspended: totals.suspended,
      activeSpaces: totals.spaces,
      bookingsLast30: totals.bookings_30,
      customers: totals.customers,
      // Whole pesos in the source (a band's price); centavos on the wire, as
      // every other amount is.
      runRateCents: (await monthlyRunRate(tenants)) * 100,
    },
    radar: {
      endingSoon: radar.endingSoon.map(tenantJson),
      inGrace: radar.inGrace.map(tenantJson),
      suspended: radar.suspended.map(tenantJson),
    },
    pendingPayments: pending.length,
    growth,
  };
}

/** #36 — every venue, optionally narrowed by name or slug. */
export async function tenantsJson(q: string | null) {
  const needle = q?.trim().toLowerCase() ?? "";
  const tenants = (await listTenants()).filter(
    (t) => !needle || t.name.toLowerCase().includes(needle) || t.slug.includes(needle),
  );
  return { tenants: tenants.map(tenantJson) };
}

/** #36 — one venue, with what the console's tenant page shows. */
export async function tenantDetailJson(organizationId: string) {
  const found = await getTenant(organizationId);
  if (!found) return null;
  const payments = await listOrgPayments(organizationId, 10);
  const [sub] = await sql<{ paid_until: Date | null; trial_ends_at: Date | null }[]>`
    SELECT paid_until, trial_ends_at FROM subscription WHERE organization_id = ${organizationId}
  `;
  return {
    tenant: {
      ...tenantJson(found.tenant),
      paidUntil: sub?.paid_until?.toISOString() ?? null,
      trialEndsAt: sub?.trial_ends_at?.toISOString() ?? null,
    },
    spaces: found.spaces.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      priceCents: s.price_cents,
      active: s.is_active,
    })),
    members: found.members.map((m) => ({
      name: m.name,
      email: m.email,
      role: m.role,
      joinedAt: m.created_at.toISOString(),
    })),
    recentBookings: found.recentBookings.map((b) => ({
      reference: b.reference,
      status: b.status,
      spaceName: b.space_name,
      customerName: b.customer_name,
      label: b.label,
      amountCents: b.amount_cents,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      reference: p.reference,
      paidAt: p.paidAt.toISOString(),
      status: p.status,
      note: p.note,
      receiptUrl: p.receiptUrl,
      createdAt: p.createdAt.toISOString(),
    })),
  };
}

/** #39 — the verification queue, oldest first. */
export async function paymentsQueueJson() {
  const rows = await listSubmittedPayments();
  return {
    payments: rows.map((p) => ({
      id: p.id,
      orgId: p.organizationId,
      venueName: p.venueName,
      amountCents: p.amountCents,
      reference: p.reference,
      paidAt: p.paidAt.toISOString(),
      receiptUrl: p.receiptUrl,
      createdAt: p.createdAt.toISOString(),
    })),
  };
}

/** #40 — the platform's InstaPay details. */
export async function billingConfigJson() {
  const config = await instapayConfig();
  return {
    qrUrl: config.qrUrl,
    payee: config.payee,
    account: config.account,
    configured: config.configured,
  };
}

/** #41 — the audit trail, newest first. `ip` stays on the server. */
export async function auditJson(limit: number) {
  const entries = await getAuditLog(Math.min(Math.max(limit, 1), 200));
  return {
    entries: entries.map((e) => ({
      id: e.id,
      actorName: e.actorName,
      actorEmail: e.actorEmail,
      action: e.action,
      organizationName: e.organizationName,
      target: e.target,
      impersonating: e.impersonating,
      detail: e.detail,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

/** #41 — current platform admins, with who is asking marked. */
export async function adminsJson(selfId: string) {
  const rows = await sql<
    { user_id: string; name: string; email: string; granted_at: Date }[]
  >`
    SELECT pa.user_id, u.name, u.email, pa.granted_at
    FROM platform_admin pa JOIN "user" u ON u.id = pa.user_id
    WHERE pa.revoked_at IS NULL
    ORDER BY pa.granted_at
  `;
  return {
    admins: rows.map((r) => ({
      userId: r.user_id,
      name: r.name,
      email: r.email,
      grantedAt: r.granted_at.toISOString(),
      isSelf: r.user_id === selfId,
    })),
  };
}

/**
 * Every admin route starts here: 401 without a session, 404 for a signed-in
 * non-admin.
 */
export async function adminGate(
  request: Request,
): Promise<{ admin: MobileAdmin; response?: never } | { admin?: never; response: Response }> {
  const { user, admin } = await mobileAdmin(request);
  if (!user) return { response: unauthorized() };
  if (!admin) return { response: notFound() };
  return { admin };
}

/** An operation's refusal, as the app reads it. */
export function outcomeResponse(
  outcome: { ok: true } | { ok: false; reason: string; message: string },
): Response {
  if (outcome.ok) return ok({ ok: true });
  switch (outcome.reason) {
    case "not_found":
      return notFound(outcome.message);
    case "invalid":
      return fail(400, { error: "invalid", message: outcome.message });
    case "send_failed":
      return fail(502, { error: "send_failed", message: outcome.message });
    default:
      return conflict(outcome.reason, outcome.message);
  }
}
