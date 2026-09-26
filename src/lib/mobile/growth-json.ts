import { bookingsCsv, customersCsv, transactionsCsv } from "@/lib/export";
import { AT_RISK_DAYS, POINTS_PER_PESO_CENTS, reviewUrlFor } from "@/lib/engagement";
import { appUrl } from "@/lib/env";
import { icalTokenFor } from "@/lib/ical";
import { listApiKeys } from "@/lib/api-keys";
import { listCustomerHoldings, listPlans, type MembershipPlan } from "@/lib/memberships";
import { listPromoCodes, type PromoRow } from "@/lib/promo";
import { listWebhooks, WEBHOOK_EVENTS } from "@/lib/webhooks";

/**
 * The owner features the web had and the app did not (docs/API-CONTRACT.md
 * #42–#47): membership plans, promo codes, the loyalty and review settings,
 * integrations, and CSV export. The mapping lives here; the rules live in the
 * libraries the web dashboard already used, so the two cannot drift.
 */

export function planJson(p: MembershipPlan) {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    priceCents: p.priceCents,
    credits: p.credits,
    period: p.period,
    discountPct: p.benefitDiscountPct,
    validDays: p.validDays,
    active: p.active,
    holders: p.holders,
  };
}

/** #42 */
export async function plansJson(organizationId: string) {
  return { plans: (await listPlans(organizationId)).map(planJson) };
}

/** #43 — what a customer holds, for their profile. */
export async function holdingsJson(organizationId: string, customerId: string) {
  const rows = await listCustomerHoldings(organizationId, customerId);
  return rows.map((h) => ({
    id: h.id,
    planId: h.planId,
    planName: h.planName,
    kind: h.kind,
    creditsRemaining: h.creditsRemaining,
    discountPct: h.benefitDiscountPct,
    status: h.status,
    expiresAt: h.expiresAt?.toISOString() ?? null,
  }));
}

export function promoJson(p: PromoRow) {
  return {
    id: p.id,
    code: p.code,
    kind: p.kind,
    // A percentage as-is; a peso amount in centavos, like every amount.
    percent: p.kind === "percent" ? p.value : null,
    amountCents: p.kind === "amount" ? p.value : null,
    maxUses: p.maxUses,
    uses: p.uses,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    active: p.active,
  };
}

/** #44 */
export async function promosJson(organizationId: string) {
  return { codes: (await listPromoCodes(organizationId)).map(promoJson) };
}

/**
 * #45 — the review link, and the loyalty rules as the background jobs apply
 * them. The rules are shown, not edited: they are the same for every venue.
 */
export async function marketingJson(organizationId: string) {
  return {
    reviewUrl: await reviewUrlFor(organizationId),
    loyalty: {
      pesosPerPoint: POINTS_PER_PESO_CENTS / 100,
      winbackAfterDays: AT_RISK_DAYS,
    },
  };
}

/**
 * #46 — the calendar feed, webhooks and API keys. A webhook's secret is
 * returned: the owner needs it to verify deliveries, and the screen is
 * owner/admin only. An API key is never returned after creation — only its
 * prefix.
 */
export async function integrationsJson(organizationId: string) {
  const [token, webhooks, keys] = await Promise.all([
    icalTokenFor(organizationId),
    listWebhooks(organizationId),
    listApiKeys(organizationId),
  ]);
  return {
    icalUrl: token ? appUrl(`/api/calendar/${token}`) : null,
    webhookEvents: [...WEBHOOK_EVENTS],
    webhooks: webhooks.map((w) => ({
      id: w.id,
      url: w.url,
      secret: w.secret,
      events: w.events,
      active: w.active,
      createdAt: w.createdAt.toISOString(),
    })),
    apiKeys: keys.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.keyPrefix,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
      revokedAt: k.revokedAt?.toISOString() ?? null,
    })),
  };
}

export const EXPORT_KINDS = ["bookings", "customers", "transactions"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

/** #47 — the same CSVs the web dashboard downloads. */
export async function exportCsv(
  kind: ExportKind,
  organizationId: string,
  timezone: string,
): Promise<string> {
  switch (kind) {
    case "bookings":
      return bookingsCsv(organizationId, timezone);
    case "customers":
      return customersCsv(organizationId, timezone);
    case "transactions":
      return transactionsCsv(organizationId, timezone);
  }
}
