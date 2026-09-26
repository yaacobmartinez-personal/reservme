import { sql } from "@/db";
import { recordAdminAction, type AdminOrigin } from "@/lib/admin/audit";
import { instapayConfig, liftBillingSuspension, setPlatformSettings } from "@/lib/billing";
import { COVER_MAX_BYTES } from "@/lib/branding";
import { sendEmail } from "@/lib/email/mailer";
import { dropImage, storeImage } from "@/lib/storage/r2";

/**
 * What a platform admin can do, once — the web console's server actions and
 * the app's admin API both call these, so the two cannot drift on what an
 * approval extends or which suspension a payment lifts.
 *
 * Every function takes the acting admin and the request origin, and writes the
 * audit trail itself: a money or access decision without an attributed record
 * is the thing this module exists to prevent. Authorisation is the caller's
 * job and happens before any of these run.
 */
export type AdminActor = { userId: string; origin?: AdminOrigin };

type Outcome = { ok: true } | { ok: false; reason: string; message: string };

const done: Outcome = { ok: true };

/* ── Venue access ──────────────────────────────────────────────────── */

export async function suspendVenue(
  actor: AdminActor,
  organizationId: string,
  reason: string | null,
): Promise<Outcome> {
  const rows = await sql`
    UPDATE venue
       SET suspended_at = now(), suspended_reason = ${reason}
     WHERE organization_id = ${organizationId}
    RETURNING organization_id
  `;
  if (rows.length === 0) return { ok: false, reason: "not_found", message: "No such venue." };

  await recordAdminAction({
    actorUserId: actor.userId,
    action: "admin.suspended_venue",
    organizationId,
    detail: reason ? { reason } : undefined,
    origin: actor.origin,
  });
  return done;
}

export async function reactivateVenue(
  actor: AdminActor,
  organizationId: string,
): Promise<Outcome> {
  const rows = await sql`
    UPDATE venue
       SET suspended_at = NULL, suspended_reason = NULL
     WHERE organization_id = ${organizationId}
    RETURNING organization_id
  `;
  if (rows.length === 0) return { ok: false, reason: "not_found", message: "No such venue." };

  await recordAdminAction({
    actorUserId: actor.userId,
    action: "admin.reactivated_venue",
    organizationId,
    origin: actor.origin,
  });
  return done;
}

/** Emails a tenant's first owner. Recorded with the subject, not the body. */
export async function emailTenant(
  actor: AdminActor,
  organizationId: string,
  subject: string,
  body: string,
): Promise<Outcome> {
  if (subject.trim().length < 2 || body.trim().length < 2) {
    return { ok: false, reason: "invalid", message: "Add a subject and a message." };
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
    return {
      ok: false,
      reason: "no_owner_email",
      message: "This venue has no owner email on file.",
    };
  }

  const escape = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = body
    .trim()
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;color:#2b2622;font-size:15px;line-height:1.6;">${escape(p).replace(/\n/g, "<br/>")}</p>`,
    )
    .join("");
  const sent = await sendEmail({
    to: owner.email,
    subject: subject.trim(),
    html: `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#faf9f6;padding:24px 12px;"><div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e6e2da;border-radius:14px;padding:28px;">${paragraphs}<p style="margin:18px 0 0;color:#8c8477;font-size:13px;">— The ReservMe team</p></div></body></html>`,
    text: body.trim(),
  });
  if (!sent.ok) {
    return { ok: false, reason: "send_failed", message: "The email didn't go. Try again." };
  }

  await recordAdminAction({
    actorUserId: actor.userId,
    action: "admin.emailed_tenant",
    organizationId,
    detail: { subject: subject.trim() },
    origin: actor.origin,
  });
  return done;
}

/* ── Money ─────────────────────────────────────────────────────────── */

/**
 * Approves a submitted payment and extends the subscription a month from the
 * later of now and the current paid-through (or trial end), so paying early
 * never costs the venue days. A billing suspension lifts; a manual one does
 * not.
 */
export async function approvePayment(actor: AdminActor, paymentId: string): Promise<Outcome> {
  const approved = await sql.begin(async (tx) => {
    const [pay] = await tx<{ organization_id: string; amount_cents: number; reference: string }[]>`
      UPDATE billing_payment
         SET status = 'approved', reviewed_by = ${actor.userId}, reviewed_at = now()
       WHERE id = ${paymentId}::uuid AND status = 'submitted'
      RETURNING organization_id, amount_cents, reference
    `;
    if (!pay) return null;

    await tx`
      UPDATE subscription
         SET status = 'active',
             paid_until = GREATEST(now(), COALESCE(paid_until, trial_ends_at)) + interval '1 month',
             updated_at = now()
       WHERE organization_id = ${pay.organization_id}
    `;
    return pay;
  });

  if (!approved) {
    return {
      ok: false,
      reason: "not_submitted",
      message: "That payment has already been reviewed.",
    };
  }

  await liftBillingSuspension(approved.organization_id);
  await recordAdminAction({
    actorUserId: actor.userId,
    action: "admin.approved_payment",
    organizationId: approved.organization_id,
    detail: { reference: approved.reference, amountCents: approved.amount_cents },
    origin: actor.origin,
  });
  return done;
}

export async function rejectPayment(
  actor: AdminActor,
  paymentId: string,
  note: string | null,
): Promise<Outcome> {
  const [pay] = await sql<{ organization_id: string; reference: string }[]>`
    UPDATE billing_payment
       SET status = 'rejected', reviewed_by = ${actor.userId}, reviewed_at = now(), note = ${note}
     WHERE id = ${paymentId}::uuid AND status = 'submitted'
    RETURNING organization_id, reference
  `;
  if (!pay) {
    return {
      ok: false,
      reason: "not_submitted",
      message: "That payment has already been reviewed.",
    };
  }

  await recordAdminAction({
    actorUserId: actor.userId,
    action: "admin.rejected_payment",
    organizationId: pay.organization_id,
    detail: note ? { reference: pay.reference, note } : { reference: pay.reference },
    origin: actor.origin,
  });
  return done;
}

/** Marks a venue paid through the end of `date` (YYYY-MM-DD, inclusive). */
export async function markPaidUntil(
  actor: AdminActor,
  organizationId: string,
  date: string,
): Promise<Outcome> {
  const rows = await sql`
    UPDATE subscription
       SET status = 'active', paid_until = (${date}::date + interval '1 day')::timestamptz, updated_at = now()
     WHERE organization_id = ${organizationId}
    RETURNING organization_id
  `;
  if (rows.length === 0) {
    return { ok: false, reason: "not_found", message: "This venue has no subscription." };
  }
  await liftBillingSuspension(organizationId);

  await recordAdminAction({
    actorUserId: actor.userId,
    action: "admin.marked_paid",
    organizationId,
    detail: { paidUntil: date },
    origin: actor.origin,
  });
  return done;
}

export async function compSubscription(
  actor: AdminActor,
  organizationId: string,
): Promise<Outcome> {
  const rows = await sql`
    UPDATE subscription SET status = 'comped', updated_at = now()
     WHERE organization_id = ${organizationId}
    RETURNING organization_id
  `;
  if (rows.length === 0) {
    return { ok: false, reason: "not_found", message: "This venue has no subscription." };
  }
  await liftBillingSuspension(organizationId);
  await recordAdminAction({
    actorUserId: actor.userId,
    action: "admin.comped",
    organizationId,
    origin: actor.origin,
  });
  return done;
}

export async function cancelSubscription(
  actor: AdminActor,
  organizationId: string,
): Promise<Outcome> {
  const rows = await sql`
    UPDATE subscription SET status = 'cancelled', updated_at = now()
     WHERE organization_id = ${organizationId}
    RETURNING organization_id
  `;
  if (rows.length === 0) {
    return { ok: false, reason: "not_found", message: "This venue has no subscription." };
  }
  await recordAdminAction({
    actorUserId: actor.userId,
    action: "admin.cancelled_subscription",
    organizationId,
    origin: actor.origin,
  });
  return done;
}

/**
 * The platform's InstaPay details. A pasted https URL passes through; an
 * uploaded QR (a data URL) goes to storage, and the one it replaces is
 * dropped.
 */
export async function updateBillingConfig(
  actor: AdminActor,
  input: { qrUrl: string; payee: string; account: string },
): Promise<Outcome> {
  let qrUrl = input.qrUrl.trim();
  if (qrUrl.startsWith("data:")) {
    const stored = await storeImage(qrUrl, "platform/instapay", COVER_MAX_BYTES);
    if (!stored.ok) return { ok: false, reason: "invalid", message: stored.error };
    qrUrl = stored.url;
  }

  const before = await instapayConfig();
  await setPlatformSettings(
    {
      instapay_qr_url: qrUrl,
      instapay_payee: input.payee,
      instapay_account: input.account,
    },
    actor.userId,
  );
  if (before.qrUrl && before.qrUrl !== qrUrl) await dropImage(before.qrUrl);

  await recordAdminAction({
    actorUserId: actor.userId,
    action: "admin.updated_billing_config",
    origin: actor.origin,
  });
  return done;
}

/* ── Admins ────────────────────────────────────────────────────────── */

/**
 * Revokes a platform admin. Refuses to remove the last one: that would lock
 * everybody out of the console with no way back short of a database session.
 */
export async function revokeAdmin(actor: AdminActor, userId: string): Promise<Outcome> {
  const [{ remaining }] = await sql<{ remaining: number }[]>`
    SELECT count(*)::int AS remaining FROM platform_admin
    WHERE revoked_at IS NULL AND user_id <> ${userId}
  `;
  if (remaining === 0) {
    return {
      ok: false,
      reason: "last_admin",
      message: "That's the last platform admin. Grant someone else first.",
    };
  }

  const rows = await sql`
    UPDATE platform_admin SET revoked_at = now()
    WHERE user_id = ${userId} AND revoked_at IS NULL
    RETURNING user_id
  `;
  if (rows.length === 0) {
    return { ok: false, reason: "not_found", message: "That person isn't an admin." };
  }

  await recordAdminAction({
    actorUserId: actor.userId,
    action: "admin.revoked_admin",
    target: userId,
    origin: actor.origin,
  });
  return done;
}
