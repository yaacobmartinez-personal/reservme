import { z } from "zod";
import { sql } from "@/db";

/**
 * Memberships, packages & passes.
 *
 * A "pass" is a one-time pack of booking credits; a "membership" is a recurring
 * plan that may carry credits and/or a % discount. Owners define plans and
 * grant them to customers (payment is pay-at-venue, like the subscription).
 *
 * At booking, redeemForBooking() spends one credit to cover a slot, or failing
 * that applies the plan's discount — atomically, so a credit can't be spent
 * twice under concurrency. Redemption runs after any promo, on the remaining
 * amount.
 */

export type PlanKind = "pass" | "membership";
export type PlanPeriod = "one_time" | "monthly";

export type MembershipPlan = {
  id: string;
  name: string;
  kind: PlanKind;
  priceCents: number;
  credits: number | null;
  period: PlanPeriod;
  benefitDiscountPct: number | null;
  validDays: number | null;
  active: boolean;
  holders: number;
};

export async function listPlans(organizationId: string): Promise<MembershipPlan[]> {
  const rows = await sql<
    {
      id: string;
      name: string;
      kind: PlanKind;
      price_cents: number;
      credits: number | null;
      period: PlanPeriod;
      benefit_discount_pct: number | null;
      valid_days: number | null;
      active: boolean;
      holders: number;
    }[]
  >`
    SELECT p.id, p.name, p.kind, p.price_cents, p.credits, p.period,
           p.benefit_discount_pct, p.valid_days, p.active,
           (SELECT count(*)::int FROM customer_membership cm
             WHERE cm.plan_id = p.id AND cm.status = 'active') AS holders
    FROM membership_plan p
    WHERE p.organization_id = ${organizationId}
    ORDER BY p.active DESC, p.created_at DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    priceCents: r.price_cents,
    credits: r.credits,
    period: r.period,
    benefitDiscountPct: r.benefit_discount_pct,
    validDays: r.valid_days,
    active: r.active,
    holders: r.holders,
  }));
}

export type CustomerHolding = {
  id: string;
  planId: string;
  planName: string;
  kind: PlanKind;
  creditsRemaining: number;
  benefitDiscountPct: number | null;
  status: "active" | "expired" | "cancelled";
  expiresAt: Date | null;
};

/** A customer's active holdings, newest first — for the CRM profile. */
export async function listCustomerHoldings(
  organizationId: string,
  customerId: string,
): Promise<CustomerHolding[]> {
  const rows = await sql<
    {
      id: string;
      plan_id: string;
      plan_name: string;
      kind: PlanKind;
      credits_remaining: number;
      benefit_discount_pct: number | null;
      status: "active" | "expired" | "cancelled";
      expires_at: Date | null;
    }[]
  >`
    SELECT cm.id, cm.plan_id, p.name AS plan_name, p.kind,
           cm.credits_remaining, p.benefit_discount_pct, cm.status, cm.expires_at
    FROM customer_membership cm
    JOIN membership_plan p ON p.id = cm.plan_id
    WHERE cm.organization_id = ${organizationId} AND cm.customer_id = ${customerId}::uuid
    ORDER BY (cm.status = 'active') DESC, cm.created_at DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    planId: r.plan_id,
    planName: r.plan_name,
    kind: r.kind,
    creditsRemaining: r.credits_remaining,
    benefitDiscountPct: r.benefit_discount_pct,
    status: r.status,
    expiresAt: r.expires_at,
  }));
}

/** Sells/grants a plan to a customer, seeding credits and an expiry. */
export async function grantMembership(
  organizationId: string,
  customerId: string,
  planId: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const [plan] = await sql<{ credits: number | null; valid_days: number | null }[]>`
    SELECT credits, valid_days FROM membership_plan
    WHERE id = ${planId}::uuid AND organization_id = ${organizationId} AND active
  `;
  if (!plan) return { ok: false, error: "That plan isn't available." };

  const [row] = await sql<{ id: string }[]>`
    INSERT INTO customer_membership
      (organization_id, customer_id, plan_id, credits_remaining, expires_at)
    VALUES (
      ${organizationId}, ${customerId}::uuid, ${planId}::uuid,
      ${plan.credits ?? 0},
      ${plan.valid_days === null
        ? sql`NULL`
        : sql`now() + (${plan.valid_days} || ' days')::interval`}
    )
    RETURNING id
  `;
  return { ok: true, id: row.id };
}

/**
 * Redeems a benefit against a booking: consume one credit to cover the slot, or
 * else apply the plan's % discount. Returns null when there's nothing to apply.
 * A free slot (baseCents = 0) never consumes a credit.
 */
export async function redeemForBooking(
  organizationId: string,
  customerId: string,
  reservationId: string,
  baseCents: number,
): Promise<{ creditsUsed: number; discountCents: number } | null> {
  if (baseCents <= 0) return null;

  return sql.begin(async (tx) => {
    // 1) Spend a credit from the soonest-expiring holding that has one.
    const [claimed] = await tx<{ id: string }[]>`
      UPDATE customer_membership
      SET credits_remaining = credits_remaining - 1
      WHERE id = (
        SELECT cm.id FROM customer_membership cm
        WHERE cm.organization_id = ${organizationId} AND cm.customer_id = ${customerId}::uuid
          AND cm.status = 'active' AND cm.credits_remaining > 0
          AND (cm.expires_at IS NULL OR cm.expires_at > now())
        ORDER BY (cm.expires_at IS NULL), cm.expires_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `;
    if (claimed) {
      await tx`
        INSERT INTO membership_redemption
          (organization_id, customer_membership_id, reservation_id, credits_used, discount_cents)
        VALUES (${organizationId}, ${claimed.id}::uuid, ${reservationId}::uuid, 1, ${baseCents})
      `;
      return { creditsUsed: 1, discountCents: baseCents };
    }

    // 2) No credit — fall back to the best active % discount.
    const [disc] = await tx<{ id: string; pct: number }[]>`
      SELECT cm.id, p.benefit_discount_pct AS pct
      FROM customer_membership cm
      JOIN membership_plan p ON p.id = cm.plan_id
      WHERE cm.organization_id = ${organizationId} AND cm.customer_id = ${customerId}::uuid
        AND cm.status = 'active'
        AND (cm.expires_at IS NULL OR cm.expires_at > now())
        AND p.benefit_discount_pct IS NOT NULL AND p.benefit_discount_pct > 0
      ORDER BY p.benefit_discount_pct DESC
      LIMIT 1
    `;
    if (!disc) return null;

    const discountCents = Math.min(baseCents, Math.floor((baseCents * disc.pct) / 100));
    if (discountCents <= 0) return null;
    await tx`
      INSERT INTO membership_redemption
        (organization_id, customer_membership_id, reservation_id, credits_used, discount_cents)
      VALUES (${organizationId}, ${disc.id}::uuid, ${reservationId}::uuid, 0, ${discountCents})
    `;
    return { creditsUsed: 0, discountCents };
  });
}

/* ── Plans: create and pause (web action and mobile API share these) ── */

const optionalInt = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" || v == null ? undefined : v), schema.optional());

export const planInputSchema = z
  .object({
    name: z.string().trim().min(2, "Give the plan a name.").max(60),
    kind: z.enum(["pass", "membership"]),
    /** Whole pesos, as the owner types it. */
    price: z.coerce.number().min(0, "Price can't be negative."),
    credits: optionalInt(z.coerce.number().int().positive("Credits must be a whole number above zero.")),
    discountPct: optionalInt(z.coerce.number().int().min(1).max(100)),
    validDays: optionalInt(z.coerce.number().int().positive("Days must be a whole number above zero.")),
  })
  .refine((d) => d.credits != null || d.discountPct != null, {
    message: "A plan needs either credits or a discount (or both).",
    path: ["credits"],
  });

export type PlanInput = z.infer<typeof planInputSchema>;

export type PlanOutcome =
  | { ok: true; id: string; name: string }
  | { ok: false; field: string; message: string };

/**
 * Creates a plan. A pass is one-time; a membership renews monthly — the kind
 * decides the period, the owner does not pick it separately.
 */
export async function createPlan(organizationId: string, raw: unknown): Promise<PlanOutcome> {
  const parsed = planInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, field: String(issue.path[0] ?? "name"), message: issue.message };
  }
  const d = parsed.data;
  const period: PlanPeriod = d.kind === "membership" ? "monthly" : "one_time";
  try {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO membership_plan
        (organization_id, name, kind, price_cents, credits, period, benefit_discount_pct, valid_days)
      VALUES (
        ${organizationId}, ${d.name}, ${d.kind}, ${Math.round(d.price * 100)},
        ${d.credits ?? null}, ${period}, ${d.discountPct ?? null}, ${d.validDays ?? null}
      )
      RETURNING id
    `;
    return { ok: true, id: row.id, name: d.name };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      return { ok: false, field: "name", message: `You already have a plan named ${d.name}.` };
    }
    throw error;
  }
}

/** Pauses or resumes a plan. Holders keep what they have either way. */
export async function setPlanActive(
  organizationId: string,
  planId: string,
  active: boolean,
): Promise<boolean> {
  const rows = await sql`
    UPDATE membership_plan SET active = ${active}
    WHERE id = ${planId}::uuid AND organization_id = ${organizationId}
    RETURNING id
  `;
  return rows.length > 0;
}
