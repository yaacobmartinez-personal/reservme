"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "@/db";
import { requirePlatformAdmin } from "@/lib/admin/access";
import { recordAdminAction } from "@/lib/admin/audit";
import { endImpersonation, startImpersonation } from "@/lib/admin/impersonation";
import { sendEmail } from "@/lib/email/mailer";

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

  await sql`
    UPDATE venue
       SET suspended_at = now(), suspended_reason = ${reason}
     WHERE organization_id = ${organizationId}
  `;

  await recordAdminAction({
    actorUserId: admin.userId,
    action: "admin.suspended_venue",
    organizationId,
    detail: reason ? { reason } : undefined,
  });

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
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (subject.length < 2 || body.length < 2) {
    return { status: "error", message: "Add a subject and a message." };
  }

  const [owner] = await sql<{ name: string | null; email: string | null }[]>`
    SELECT u.name, u.email
    FROM organization o
    LEFT JOIN member m ON m.organization_id = o.id AND m.role = 'owner'
    LEFT JOIN "user" u ON u.id = m.user_id
    WHERE o.id = ${organizationId}
    ORDER BY m.created_at
    LIMIT 1
  `;
  if (!owner?.email) {
    return { status: "error", message: "This venue has no owner email on file." };
  }

  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;color:#2b2622;font-size:15px;line-height:1.6;">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
  await sendEmail({
    to: owner.email,
    subject,
    html: `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#faf9f6;padding:24px 12px;"><div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e6e2da;border-radius:14px;padding:28px;">${paragraphs}<p style="margin:18px 0 0;color:#8c8477;font-size:13px;">— The ReservMe team</p></div></body></html>`,
    text: body,
  });

  await recordAdminAction({
    actorUserId: admin.userId,
    action: "admin.emailed_tenant",
    organizationId,
    detail: { subject },
  });

  return { status: "sent" };
}

export async function reactivateVenue(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const organizationId = orgId.parse(formData.get("organizationId"));

  await sql`
    UPDATE venue
       SET suspended_at = NULL, suspended_reason = NULL
     WHERE organization_id = ${organizationId}
  `;

  await recordAdminAction({
    actorUserId: admin.userId,
    action: "admin.reactivated_venue",
    organizationId,
  });

  revalidatePath("/", "layout");
}

export async function impersonate(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const organizationId = orgId.parse(formData.get("organizationId"));
  const reason = String(formData.get("reason") ?? "").trim() || null;

  await startImpersonation({
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

  // No server-side redirect: a Server Action redirect to the bare "/viewing"
  // soft-navigates, and the client router matches it against the apex
  // [venueSlug] route ("Venue not found") instead of the host-rewritten
  // /admin/viewing. The client form navigates with router.push instead, which
  // resolves correctly (the same path a nav-link click takes).
}

export async function stopImpersonating() {
  const admin = await requirePlatformAdmin();
  const ended = await endImpersonation();

  if (ended) {
    await recordAdminAction({
      actorUserId: admin.userId,
      action: "admin.impersonation_ended",
      organizationId: ended.organizationId,
    });
  }

  revalidatePath("/", "layout");
}

export async function revokeAdmin(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const userId = z.string().min(1).parse(formData.get("userId"));

  // Removing the last admin would lock everyone out of the console with no way
  // back in short of a database session.
  const [{ remaining }] = await sql<{ remaining: number }[]>`
    SELECT count(*)::int AS remaining FROM platform_admin
    WHERE revoked_at IS NULL AND user_id <> ${userId}
  `;
  if (remaining === 0) return;

  await sql`
    UPDATE platform_admin SET revoked_at = now()
    WHERE user_id = ${userId} AND revoked_at IS NULL
  `;

  await recordAdminAction({
    actorUserId: admin.userId,
    action: "admin.revoked_admin",
    target: userId,
  });

  revalidatePath("/", "layout");
}
