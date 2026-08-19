import { PLANS, planForSpaces } from "@/content/marketing";
import { sql } from "@/db";

/**
 * Subscription billing — venue → ReservMe. The band (what a venue owes) is never
 * stored: it's derived from **active** space count at read time, so pausing a
 * space for the off-season drops a band with no write. We store only trial /
 * subscription state and the InstaPay transfers owners submit for verification.
 *
 * Policy: we nudge relentlessly, then auto-suspend after a grace period. A
 * venue whose free month (or paid period) lapses is emailed, and if still
 * unpaid GRACE_DAYS later its public booking page is turned off — recorded on
 * venue.suspended_at with BILLING_SUSPEND_REASON. Paying lifts that suspension;
 * a manual/abuse suspension (any other reason) is never touched by billing.
 */

/** Days a venue stays live after its free month / paid period ends. */
export const GRACE_DAYS = 10;

/**
 * Marks a suspension the billing system created for non-payment. The exact
 * string is the contract: an approved payment clears a suspension with this
 * reason, and only this reason — so an admin's manual suspension survives.
 */
export const BILLING_SUSPEND_REASON = "Overdue — unpaid past the grace period";

export type Band = { name: string; price: number | null };

function bandFor(activeSpaces: number): Band {
  const plan = activeSpaces === 0 ? PLANS[0] : planForSpaces(activeSpaces);
  return { name: plan.name, price: plan.price };
}

export type PendingPayment = {
  id: string;
  reference: string;
  amountCents: number;
  paidAt: Date;
  createdAt: Date;
};

export type BillingState = {
  status: "trialing" | "active" | "past_due" | "cancelled" | "comped";
  band: Band;
  trialEndsAt: Date;
  paidUntil: Date | null;
  /** Whole days until the trial ends (never negative); null once not trialing. */
  daysLeftInTrial: number | null;
  dueNow: boolean;
  /** True once billing has turned the public page off for non-payment. */
  suspended: boolean;
  /** band.price × 100, or null for the multi-site "quote" band. */
  amountDueCents: number | null;
  pendingPayment: PendingPayment | null;
};

type StateRow = {
  status: BillingState["status"];
  trial_ends_at: Date;
  paid_until: Date | null;
  active_spaces: number;
  days_left: number;
  due_now: boolean;
  suspended: boolean;
};

// Shared projection so getBillingState and listBilling agree on every rule (both
// query `organization o LEFT JOIN subscription s`). A missing subscription row
// (shouldn't happen after backfill + signup) is handled with COALESCE from the
// org's created_at rather than a write on a read path.
const STATE_COLUMNS = sql`
  COALESCE(s.status, 'trialing') AS status,
  COALESCE(s.trial_ends_at, o.created_at + interval '1 month') AS trial_ends_at,
  s.paid_until,
  (SELECT count(*)::int FROM space sp WHERE sp.organization_id = o.id AND sp.is_active) AS active_spaces,
  GREATEST(0, CEIL(EXTRACT(EPOCH FROM (COALESCE(s.trial_ends_at, o.created_at + interval '1 month') - now())) / 86400))::int AS days_left,
  (
    (COALESCE(s.status, 'trialing') = 'trialing'
      AND now() > COALESCE(s.trial_ends_at, o.created_at + interval '1 month'))
    OR (s.status IN ('active','past_due') AND s.paid_until IS NOT NULL AND now() > s.paid_until)
  ) AS due_now,
  (v.suspended_at IS NOT NULL AND v.suspended_reason = ${BILLING_SUSPEND_REASON}) AS suspended
`;

function toState(row: StateRow, pending: PendingPayment | null): BillingState {
  const band = bandFor(row.active_spaces);
  return {
    status: row.status,
    band,
    trialEndsAt: row.trial_ends_at,
    paidUntil: row.paid_until,
    daysLeftInTrial: row.status === "trialing" ? row.days_left : null,
    dueNow: row.due_now,
    suspended: row.suspended,
    amountDueCents: band.price === null ? null : band.price * 100,
    pendingPayment: pending,
  };
}

export async function getBillingState(organizationId: string): Promise<BillingState> {
  const [row] = await sql<StateRow[]>`
    SELECT ${STATE_COLUMNS}
    FROM organization o
    LEFT JOIN subscription s ON s.organization_id = o.id
    LEFT JOIN venue v ON v.organization_id = o.id
    WHERE o.id = ${organizationId}
  `;
  if (!row) {
    // Org doesn't exist — return a neutral trialing shape rather than throwing.
    return toState(
      { status: "trialing", trial_ends_at: new Date(), paid_until: null, active_spaces: 0, days_left: 0, due_now: false, suspended: false },
      null,
    );
  }
  const [pending] = await sql<
    { id: string; reference: string; amount_cents: number; paid_at: Date; created_at: Date }[]
  >`
    SELECT id, reference, amount_cents, paid_at, created_at
    FROM billing_payment
    WHERE organization_id = ${organizationId} AND status = 'submitted'
    ORDER BY created_at DESC LIMIT 1
  `;
  return toState(
    row,
    pending
      ? {
          id: pending.id,
          reference: pending.reference,
          amountCents: pending.amount_cents,
          paidAt: pending.paid_at,
          createdAt: pending.created_at,
        }
      : null,
  );
}

/**
 * Lifts a suspension the billing system created — called when a payment is
 * approved or the venue is comped. Scoped to BILLING_SUSPEND_REASON, so an
 * admin's manual suspension (abuse, etc.) is never cleared by a payment.
 */
export async function liftBillingSuspension(organizationId: string): Promise<void> {
  await sql`
    UPDATE venue SET suspended_at = NULL, suspended_reason = NULL
    WHERE organization_id = ${organizationId} AND suspended_reason = ${BILLING_SUSPEND_REASON}
  `;
}

export type BillingRow = BillingState & {
  organizationId: string;
  name: string;
  slug: string;
  activeSpaces: number;
};

/** All venues for the admin billing view, with their billing state. */
export async function listBilling(): Promise<BillingRow[]> {
  const rows = await sql<(StateRow & { organization_id: string; name: string; slug: string })[]>`
    SELECT o.id AS organization_id, o.name, o.slug, ${STATE_COLUMNS}
    FROM organization o
    JOIN venue v ON v.organization_id = o.id
    LEFT JOIN subscription s ON s.organization_id = o.id
    ORDER BY o.created_at DESC
  `;
  return rows.map((row) => ({
    ...toState(row, null),
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    activeSpaces: row.active_spaces,
  }));
}

export type SubmittedPayment = {
  id: string;
  organizationId: string;
  venueName: string;
  amountCents: number;
  reference: string;
  paidAt: Date;
  createdAt: Date;
};

/** The verification queue for the admin — submitted, not yet reviewed. */
export async function listSubmittedPayments(): Promise<SubmittedPayment[]> {
  const rows = await sql<
    {
      id: string;
      organization_id: string;
      name: string;
      amount_cents: number;
      reference: string;
      paid_at: Date;
      created_at: Date;
    }[]
  >`
    SELECT p.id, p.organization_id, o.name, p.amount_cents, p.reference, p.paid_at, p.created_at
    FROM billing_payment p
    JOIN organization o ON o.id = p.organization_id
    WHERE p.status = 'submitted'
    ORDER BY p.created_at
  `;
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    venueName: r.name,
    amountCents: r.amount_cents,
    reference: r.reference,
    paidAt: r.paid_at,
    createdAt: r.created_at,
  }));
}

export type OrgPayment = {
  id: string;
  amountCents: number;
  reference: string;
  paidAt: Date;
  status: "submitted" | "approved" | "rejected";
  note: string | null;
  createdAt: Date;
};

/** A venue's own recent payment submissions, for the owner billing page. */
export async function listOrgPayments(organizationId: string, limit = 6): Promise<OrgPayment[]> {
  const rows = await sql<
    {
      id: string;
      amount_cents: number;
      reference: string;
      paid_at: Date;
      status: OrgPayment["status"];
      note: string | null;
      created_at: Date;
    }[]
  >`
    SELECT id, amount_cents, reference, paid_at, status, note, created_at
    FROM billing_payment
    WHERE organization_id = ${organizationId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: r.id,
    amountCents: r.amount_cents,
    reference: r.reference,
    paidAt: r.paid_at,
    status: r.status,
    note: r.note,
    createdAt: r.created_at,
  }));
}

/* ── Platform InstaPay QR config (platform_setting, admin-editable) ── */

export type InstapayConfig = {
  qrUrl: string | null;
  payee: string | null;
  account: string | null;
  /** Enough set to actually show a payable QR panel. */
  configured: boolean;
};

const INSTAPAY_KEYS = ["instapay_qr_url", "instapay_payee", "instapay_account"] as const;

export async function instapayConfig(): Promise<InstapayConfig> {
  const rows = await sql<{ key: string; value: string }[]>`
    SELECT key, value FROM platform_setting WHERE key IN ${sql([...INSTAPAY_KEYS])}
  `;
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const qrUrl = m.get("instapay_qr_url") ?? null;
  const payee = m.get("instapay_payee") ?? null;
  const account = m.get("instapay_account") ?? null;
  return { qrUrl, payee, account, configured: Boolean(qrUrl && payee) };
}

export async function setPlatformSettings(
  entries: Record<string, string>,
  updatedBy: string,
): Promise<void> {
  for (const [key, raw] of Object.entries(entries)) {
    const value = raw.trim();
    if (!value) {
      await sql`DELETE FROM platform_setting WHERE key = ${key}`;
      continue;
    }
    await sql`
      INSERT INTO platform_setting (key, value, updated_by, updated_at)
      VALUES (${key}, ${value}, ${updatedBy}, now())
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
    `;
  }
}
