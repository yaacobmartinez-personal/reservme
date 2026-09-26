"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/access";
import { recordAdminAction } from "@/lib/admin/audit";
import * as ops from "@/lib/admin/operations";
import { startImpersonation } from "@/lib/admin/impersonation";
import { appUrl } from "@/lib/env";

const orgId = z.string().min(1);

/**
 * Every action re-checks admin status server-side. The console being behind a
 * hostname is routing, not authorisation — a form post can be replayed against
 * any host.
 */

export async function suspendVenue(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const organizationId = orgId.parse(formData.get("organizationId"));
  const reason = String(formData.get("reason") ?? "").trim() || null;
  await ops.suspendVenue({ userId: admin.userId }, organizationId, reason);
  revalidatePath("/", "layout");
}

export type EmailTenantState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; message: string };

/** Emails a tenant's owner from the console. Recorded to the audit trail. */
export async function emailTenant(
  _previous: EmailTenantState,
  formData: FormData,
): Promise<EmailTenantState> {
  const admin = await requirePlatformAdmin();
  const organizationId = orgId.parse(formData.get("organizationId"));
  const result = await ops.emailTenant(
    { userId: admin.userId },
    organizationId,
    String(formData.get("subject") ?? ""),
    String(formData.get("body") ?? ""),
  );
  return result.ok ? { status: "sent" } : { status: "error", message: result.message };
}

export async function reactivateVenue(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const organizationId = orgId.parse(formData.get("organizationId"));
  await ops.reactivateVenue({ userId: admin.userId }, organizationId);
  revalidatePath("/", "layout");
}

export async function impersonate(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const organizationId = orgId.parse(formData.get("organizationId"));
  const reason = String(formData.get("reason") ?? "").trim() || null;

  const token = await startImpersonation({
    adminUserId: admin.userId,
    organizationId,
    reason: reason ?? undefined,
  });

  await recordAdminAction({
    actorUserId: admin.userId,
    action: "admin.impersonation_started",
    organizationId,
    detail: reason ? { reason } : undefined,
  });

  // Hand the token to the app host, which sets the impersonation cookie there
  // and drops the admin into the tenant's *real* dashboard — every page they'd
  // see, not just a copy. Cross-origin, so this is a full browser navigation.
  redirect(appUrl(`/api/impersonate?token=${token}`));
}

export async function revokeAdmin(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const userId = z.string().min(1).parse(formData.get("userId"));
  await ops.revokeAdmin({ userId: admin.userId }, userId);
  revalidatePath("/", "layout");
}
