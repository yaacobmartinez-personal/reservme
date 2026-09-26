"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/access";
import * as ops from "@/lib/admin/operations";

/**
 * Platform billing actions. Every one re-checks admin status server-side and is
 * written to the audit log — money decisions must leave a trace attributed to
 * the real human.
 */

const paymentId = z.string().uuid();
const orgId = z.string().min(1);

export async function approveBillingPayment(formData: FormData) {
  const admin = await requirePlatformAdmin();
  await ops.approvePayment({ userId: admin.userId }, paymentId.parse(formData.get("paymentId")));
  revalidatePath("/", "layout");
}

export async function rejectBillingPayment(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const note = String(formData.get("note") ?? "").trim() || null;
  await ops.rejectPayment({ userId: admin.userId }, paymentId.parse(formData.get("paymentId")), note);
  revalidatePath("/", "layout");
}

export async function markPaidUntil(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const organizationId = orgId.parse(formData.get("organizationId"));
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(formData.get("paidUntil"));
  await ops.markPaidUntil({ userId: admin.userId }, organizationId, date);
  revalidatePath("/", "layout");
}

export async function compSubscription(formData: FormData) {
  const admin = await requirePlatformAdmin();
  await ops.compSubscription({ userId: admin.userId }, orgId.parse(formData.get("organizationId")));
  revalidatePath("/", "layout");
}

export async function cancelSubscription(formData: FormData) {
  const admin = await requirePlatformAdmin();
  await ops.cancelSubscription({ userId: admin.userId }, orgId.parse(formData.get("organizationId")));
  revalidatePath("/", "layout");
}

export async function updateBillingConfig(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = z
    .object({
      // Large cap so an uploaded QR image (a data URL) fits; a pasted URL is tiny.
      qrUrl: z.string().trim().max(1_200_000).optional().or(z.literal("")),
      payee: z.string().trim().max(120).optional().or(z.literal("")),
      account: z.string().trim().max(120).optional().or(z.literal("")),
    })
    .parse({
      qrUrl: formData.get("qrUrl") ?? "",
      payee: formData.get("payee") ?? "",
      account: formData.get("account") ?? "",
    });
  const result = await ops.updateBillingConfig(
    { userId: admin.userId },
    { qrUrl: parsed.qrUrl ?? "", payee: parsed.payee ?? "", account: parsed.account ?? "" },
  );
  if (!result.ok) throw new Error(result.message);
  revalidatePath("/", "layout");
}
