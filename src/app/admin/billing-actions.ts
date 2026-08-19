"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "@/db";
import { requirePlatformAdmin } from "@/lib/admin/access";
import { recordAdminAction } from "@/lib/admin/audit";
import { liftBillingSuspension, setPlatformSettings } from "@/lib/billing";

/**
 * Platform billing actions. Every one re-checks admin status server-side and is
 * written to the audit log — money decisions must leave a trace attributed to
 * the real human.
 */

const paymentId = z.string().uuid();
const orgId = z.string().min(1);

export async function approveBillingPayment(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const id = paymentId.parse(formData.get("paymentId"));

  const approved = await sql.begin(async (tx) => {
    const [pay] = await tx<{ organization_id: string; amount_cents: number; reference: string }[]>`
      UPDATE billing_payment
         SET status = 'approved', reviewed_by = ${admin.userId}, reviewed_at = now()
       WHERE id = ${id}::uuid AND status = 'submitted'
      RETURNING organization_id, amount_cents, reference
    `;
    if (!pay) return null;

    // Extend from the later of now / the current paid-through (or trial end), so
    // paying early never costs the venue days.
    await tx`
      UPDATE subscription
         SET status = 'active',
             paid_until = GREATEST(now(), COALESCE(paid_until, trial_ends_at)) + interval '1 month',
             updated_at = now()
       WHERE organization_id = ${pay.organization_id}
    `;
    return pay;
  });

  if (approved) {
    // A verified payment brings a billing-suspended venue back online.
    await liftBillingSuspension(approved.organization_id);
    await recordAdminAction({
      actorUserId: admin.userId,
      action: "admin.approved_payment",
      organizationId: approved.organization_id,
      detail: { reference: approved.reference, amountCents: approved.amount_cents },
    });
  }

  revalidatePath("/", "layout");
}

export async function rejectBillingPayment(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const id = paymentId.parse(formData.get("paymentId"));
  const note = String(formData.get("note") ?? "").trim() || null;

  const [pay] = await sql<{ organization_id: string; reference: string }[]>`
    UPDATE billing_payment
       SET status = 'rejected', reviewed_by = ${admin.userId}, reviewed_at = now(), note = ${note}
     WHERE id = ${id}::uuid AND status = 'submitted'
    RETURNING organization_id, reference
  `;

  if (pay) {
    await recordAdminAction({
      actorUserId: admin.userId,
      action: "admin.rejected_payment",
      organizationId: pay.organization_id,
      detail: note ? { reference: pay.reference, note } : { reference: pay.reference },
    });
  }

  revalidatePath("/", "layout");
}

export async function markPaidUntil(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const organizationId = orgId.parse(formData.get("organizationId"));
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(formData.get("paidUntil"));

  await sql`
    UPDATE subscription
       SET status = 'active', paid_until = (${date}::date + interval '1 day')::timestamptz, updated_at = now()
     WHERE organization_id = ${organizationId}
  `;
  await liftBillingSuspension(organizationId);

  await recordAdminAction({
    actorUserId: admin.userId,
    action: "admin.marked_paid",
    organizationId,
    detail: { paidUntil: date },
  });

  revalidatePath("/", "layout");
}

export async function compSubscription(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const organizationId = orgId.parse(formData.get("organizationId"));
  await sql`
    UPDATE subscription SET status = 'comped', updated_at = now()
     WHERE organization_id = ${organizationId}
  `;
  await liftBillingSuspension(organizationId);
  await recordAdminAction({
    actorUserId: admin.userId,
    action: "admin.comped",
    organizationId,
  });
  revalidatePath("/", "layout");
}

export async function cancelSubscription(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const organizationId = orgId.parse(formData.get("organizationId"));
  await sql`
    UPDATE subscription SET status = 'cancelled', updated_at = now()
     WHERE organization_id = ${organizationId}
  `;
  await recordAdminAction({
    actorUserId: admin.userId,
    action: "admin.cancelled_subscription",
    organizationId,
  });
  revalidatePath("/", "layout");
}

export async function updateBillingConfig(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = z
    .object({
      qrUrl: z.string().trim().max(2000).optional().or(z.literal("")),
      payee: z.string().trim().max(120).optional().or(z.literal("")),
      account: z.string().trim().max(120).optional().or(z.literal("")),
    })
    .parse({
      qrUrl: formData.get("qrUrl") ?? "",
      payee: formData.get("payee") ?? "",
      account: formData.get("account") ?? "",
    });

  await setPlatformSettings(
    {
      instapay_qr_url: parsed.qrUrl ?? "",
      instapay_payee: parsed.payee ?? "",
      instapay_account: parsed.account ?? "",
    },
    admin.userId,
  );

  await recordAdminAction({
    actorUserId: admin.userId,
    action: "admin.updated_billing_config",
  });

  revalidatePath("/", "layout");
}
