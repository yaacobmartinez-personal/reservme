import { PLANS, planForSpaces } from "@/content/marketing";
import { sql } from "@/db";
import { getBillingState, instapayConfig, listOrgPayments } from "@/lib/billing";

/**
 * Billing, shaped for the app (API-CONTRACT #32).
 *
 * `getBillingState` decides everything that matters and is reused whole. The
 * one thing added here is the **full band** rather than the web's
 * `{name, price}`: the screen names the band, prints its blurb and says which
 * space counts it covers, and re-deriving that on the phone would be a second
 * copy of the price list to keep in step.
 *
 * The band is never stored. It comes from the venue's *active* space count at
 * read time, so pausing a court for the off-season drops a band with no write
 * anywhere — which is the most surprising thing about this screen, and why it
 * says so out loud.
 */

function bandJson(activeSpaces: number) {
  const plan = activeSpaces === 0 ? PLANS[0] : planForSpaces(activeSpaces);
  return {
    id: plan.id,
    name: plan.name,
    minSpaces: plan.minSpaces,
    maxSpaces: plan.maxSpaces,
    // The app calls it pricePesos, because that is what it is — the band is
    // quoted in whole pesos and only the *amount due* is centavos.
    pricePesos: plan.price,
    blurb: plan.blurb,
  };
}

function paymentJson(p: {
  id: string;
  amountCents: number;
  reference: string;
  paidAt: Date;
  status: string;
  note: string | null;
  receiptUrl?: string | null;
  createdAt: Date;
}) {
  return {
    id: p.id,
    amountCents: p.amountCents,
    reference: p.reference,
    // A `date` column: the day the owner says they transferred, with no time
    // and no zone on it. Sending an instant would let a phone shift it a day.
    paidAt: p.paidAt.toISOString().slice(0, 10),
    status: p.status,
    note: p.note,
    receiptUrl: p.receiptUrl ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function billingJson(organizationId: string) {
  const [state, history, instapay, spaces] = await Promise.all([
    getBillingState(organizationId),
    listOrgPayments(organizationId, 6),
    instapayConfig(),
    sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM space
      WHERE organization_id = ${organizationId} AND is_active
    `,
  ]);

  const activeSpaces = spaces[0]?.n ?? 0;

  return {
    status: state.status,
    band: bandJson(activeSpaces),
    activeSpaces,
    trialEndsAt: state.trialEndsAt.toISOString(),
    paidUntil: state.paidUntil?.toISOString() ?? null,
    daysLeftInTrial: state.daysLeftInTrial,
    dueNow: state.dueNow,
    suspended: state.suspended,
    pendingPayment: state.pendingPayment
      ? paymentJson({ ...state.pendingPayment, status: "submitted", note: null })
      : null,
    history: history.map(paymentJson),
    instapay: {
      qrUrl: instapay.qrUrl,
      payee: instapay.payee,
      account: instapay.account,
    },
  };
}

/** `submitBillingPayment`'s own wording, in the same order it checks. */
export function proofProblem(reference: unknown, paidAt: unknown): string | null {
  const ref = typeof reference === "string" ? reference.trim() : "";
  if (ref.length < 4) return "Enter the InstaPay reference number.";
  if (ref.length > 64) return "That reference is too long.";
  if (typeof paidAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) {
    return "Pick the date you paid.";
  }
  return null;
}

export type ProofRefusal = { reason: "quoted" | "already_pending"; message: string };

/**
 * Records a transfer for verification.
 *
 * The amount is **never** taken from the request: it comes from the band, so
 * the form cannot declare what it owes. Refusals are `conflict` rather than
 * validation, because neither is something the owner typed wrong.
 */
export async function submitProof(
  organizationId: string,
  reference: string,
  paidAt: string,
): Promise<ProofRefusal | null> {
  const state = await getBillingState(organizationId);

  if (state.amountDueCents === null) {
    return {
      reason: "quoted",
      message: "Your plan is billed by quote — please contact us.",
    };
  }
  if (state.pendingPayment) {
    return {
      reason: "already_pending",
      message: "You already have a payment under review.",
    };
  }

  await sql`
    INSERT INTO billing_payment (organization_id, amount_cents, reference, paid_at)
    VALUES (${organizationId}, ${state.amountDueCents}, ${reference.trim()}, ${paidAt}::date)
  `;
  return null;
}
