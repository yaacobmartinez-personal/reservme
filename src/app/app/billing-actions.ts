"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "@/db";
import { getBillingState } from "@/lib/billing";
import { requireRole } from "@/lib/tenancy";

/**
 * Owner submits an InstaPay transfer for verification. Billing is an owner/admin
 * concern (requireRole), never staff. The amount is derived server-side from the
 * venue's band — the form can't declare what it owes.
 */

export type SubmitResult = { ok: true } | { ok: false; error: string };

export async function submitBillingPayment(formData: FormData): Promise<SubmitResult> {
  const venue = await requireRole("owner", "admin");

  const parsed = z
    .object({
      reference: z.string().trim().min(4, "Enter the InstaPay reference number.").max(64),
      paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date you paid."),
    })
    .safeParse({
      reference: formData.get("reference"),
      paidAt: formData.get("paidAt"),
    });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const state = await getBillingState(venue.organizationId);
  if (state.amountDueCents === null) {
    return { ok: false, error: "Your plan is billed by quote — please contact us." };
  }
  if (state.pendingPayment) {
    return { ok: false, error: "You already have a payment under review." };
  }

  await sql`
    INSERT INTO billing_payment (organization_id, amount_cents, reference, paid_at)
    VALUES (${venue.organizationId}, ${state.amountDueCents}, ${parsed.data.reference}, ${parsed.data.paidAt}::date)
  `;

  revalidatePath("/billing");
  revalidatePath("/");
  return { ok: true };
}
