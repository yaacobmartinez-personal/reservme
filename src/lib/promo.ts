import { z } from "zod";
import { sql } from "@/db";

/**
 * Promo / discount codes. Validation is a read (for the form); consumption is an
 * atomic uses+1 under the cap, so a limited code can't be over-redeemed even
 * under concurrent bookings. The discount is capped at the booking amount.
 */

export type PromoValidation = { ok: true } | { ok: false; reason: string };

export async function validatePromo(organizationId: string, code: string): Promise<PromoValidation> {
  const [row] = await sql<
    { active: boolean; expires_at: Date | null; max_uses: number | null; uses: number }[]
  >`
    SELECT active, expires_at, max_uses, uses
    FROM promo_code
    WHERE organization_id = ${organizationId} AND lower(code) = lower(${code.trim()})
  `;
  if (!row) return { ok: false, reason: "That promo code isn't recognised." };
  if (!row.active) return { ok: false, reason: "That promo code is no longer active." };
  if (row.expires_at && row.expires_at.getTime() <= Date.now()) {
    return { ok: false, reason: "That promo code has expired." };
  }
  if (row.max_uses !== null && row.uses >= row.max_uses) {
    return { ok: false, reason: "That promo code has been fully used." };
  }
  return { ok: true };
}

/** Atomically claim a use and return the discount, or null if it can't be used. */
export async function consumePromo(
  organizationId: string,
  code: string,
  reservationId: string,
  baseCents: number,
): Promise<{ discountCents: number } | null> {
  return sql.begin(async (tx) => {
    const [claimed] = await tx<{ id: string; kind: string; value: number }[]>`
      UPDATE promo_code SET uses = uses + 1
      WHERE organization_id = ${organizationId} AND lower(code) = lower(${code.trim()})
        AND active
        AND (expires_at IS NULL OR expires_at > now())
        AND (max_uses IS NULL OR uses < max_uses)
      RETURNING id, kind, value
    `;
    if (!claimed) return null;

    const discount =
      claimed.kind === "percent"
        ? Math.min(baseCents, Math.floor((baseCents * claimed.value) / 100))
        : Math.min(baseCents, claimed.value);

    await tx`
      INSERT INTO promo_redemption (organization_id, promo_code_id, reservation_id, discount_cents)
      VALUES (${organizationId}, ${claimed.id}::uuid, ${reservationId}::uuid, ${discount})
    `;
    return { discountCents: discount };
  });
}

export type PromoRow = {
  id: string;
  code: string;
  kind: "percent" | "amount";
  value: number;
  maxUses: number | null;
  uses: number;
  expiresAt: Date | null;
  active: boolean;
};

export async function listPromoCodes(organizationId: string): Promise<PromoRow[]> {
  const rows = await sql<
    {
      id: string;
      code: string;
      kind: "percent" | "amount";
      value: number;
      max_uses: number | null;
      uses: number;
      expires_at: Date | null;
      active: boolean;
    }[]
  >`
    SELECT id, code, kind, value, max_uses, uses, expires_at, active
    FROM promo_code
    WHERE organization_id = ${organizationId}
    ORDER BY active DESC, created_at DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    kind: r.kind,
    value: r.value,
    maxUses: r.max_uses,
    uses: r.uses,
    expiresAt: r.expires_at,
    active: r.active,
  }));
}

/* ── Codes: create and pause (web action and mobile API share these) ── */

export const promoInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2, "A code needs at least 2 characters.")
      .max(40)
      .regex(/^[A-Za-z0-9]+$/, "Use letters and numbers only — no spaces."),
    kind: z.enum(["percent", "amount"]),
    /** A percentage, or whole pesos off. */
    value: z.coerce.number().int().positive("Enter a discount greater than zero."),
    maxUses: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.coerce.number().int().positive("Uses must be a whole number above zero.").optional(),
    ),
    /** Venue-local `YYYY-MM-DD`; the code works through the end of that day. */
    expiresAt: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.").optional(),
    ),
  })
  .refine((d) => d.kind !== "percent" || (d.value >= 1 && d.value <= 100), {
    message: "A percentage discount must be between 1 and 100.",
    path: ["value"],
  });

export type PromoOutcome =
  | { ok: true; id: string; code: string }
  | { ok: false; field: string; message: string };

/**
 * Creates a code, upper-cased. A percentage is stored as-is and a peso amount
 * in centavos. The expiry is end of day in the **venue's** zone, so a code set
 * to expire "today" works through closing.
 */
export async function createPromo(
  organizationId: string,
  timezone: string,
  raw: unknown,
): Promise<PromoOutcome> {
  const parsed = promoInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, field: String(issue.path[0] ?? "code"), message: issue.message };
  }
  const input = parsed.data;
  const code = input.code.toUpperCase();
  const value = input.kind === "amount" ? input.value * 100 : input.value;
  // make_timestamptz from integer parts, never `${str}::timestamp AT TIME ZONE`:
  // a bound wall-clock string is typed as a timestamp by the driver and shifts
  // by the session's offset — "end of 1 Jan" came back eight hours early.
  const expiresAt = input.expiresAt
    ? (() => {
        const [y, m, d] = input.expiresAt.split("-").map(Number);
        return sql`make_timestamptz(${y}::int, ${m}::int, ${d}::int, 23, 59, 59, ${timezone}::text)`;
      })()
    : sql`NULL`;
  try {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO promo_code (organization_id, code, kind, value, max_uses, expires_at)
      VALUES (${organizationId}, ${code}, ${input.kind}, ${value}, ${input.maxUses ?? null}, ${expiresAt})
      RETURNING id
    `;
    return { ok: true, id: row.id, code };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      return { ok: false, field: "code", message: `You already have a code named ${code}.` };
    }
    throw error;
  }
}

export async function setPromoActive(
  organizationId: string,
  promoId: string,
  active: boolean,
): Promise<boolean> {
  const rows = await sql`
    UPDATE promo_code SET active = ${active}
    WHERE id = ${promoId}::uuid AND organization_id = ${organizationId}
    RETURNING id
  `;
  return rows.length > 0;
}
