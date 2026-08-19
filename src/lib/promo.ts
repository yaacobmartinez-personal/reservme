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
