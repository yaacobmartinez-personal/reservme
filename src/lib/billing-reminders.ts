import { PLANS, planForSpaces } from "@/content/marketing";
import { sql } from "@/db";
import { BILLING_SUSPEND_REASON, GRACE_DAYS } from "@/lib/billing";
import { sendEmail } from "@/lib/email/mailer";
import { appUrl } from "@/lib/env";
import { formatMoney } from "@/lib/money";

/**
 * Billing nudges. A daily job (scripts/worker.ts) emails an owner when their
 * free month is ending soon or has lapsed — each state once, tracked by
 * trial_reminder_at / due_reminder_at so a re-run doesn't re-send.
 */

type DueRow = {
  organization_id: string;
  org_name: string;
  active_spaces: number;
  days_left: number;
  owner_name: string | null;
  owner_email: string | null;
};

function amountFor(activeSpaces: number): string | null {
  const plan = activeSpaces === 0 ? PLANS[0] : planForSpaces(activeSpaces);
  return plan.price === null ? null : formatMoney(plan.price * 100, "PHP");
}

function shell(heading: string, body: string): string {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2b2622;background:#faf9f6;padding:24px 12px;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e6e2da;border-radius:14px;padding:28px;">
      <h1 style="margin:0 0 8px;font-size:20px;">${heading}</h1>${body}
      <a href="${appUrl("/billing")}" style="display:inline-block;margin-top:6px;background:#2f6b52;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:999px;">Go to billing</a>
    </div></body></html>`;
}

export async function sendBillingReminders(): Promise<{ trialSoon: number; pastDue: number }> {
  // Free month ending within 5 days — not yet reminded.
  const soon = await sql<DueRow[]>`
    SELECT o.id AS organization_id, o.name AS org_name,
      (SELECT count(*)::int FROM space sp WHERE sp.organization_id = o.id AND sp.is_active) AS active_spaces,
      CEIL(EXTRACT(EPOCH FROM (s.trial_ends_at - now())) / 86400)::int AS days_left,
      u.name AS owner_name, u.email AS owner_email
    FROM subscription s
    JOIN organization o ON o.id = s.organization_id
    LEFT JOIN member m ON m.organization_id = o.id AND m.role = 'owner'
    LEFT JOIN "user" u ON u.id = m.user_id
    WHERE s.status = 'trialing' AND s.trial_reminder_at IS NULL
      AND s.trial_ends_at BETWEEN now() AND now() + interval '5 days'
  `;
  let trialSoon = 0;
  for (const r of soon) {
    if (r.owner_email) {
      const amount = amountFor(r.active_spaces);
      await sendEmail({
        to: r.owner_email,
        subject: `Your free month ends in ${r.days_left} day${r.days_left === 1 ? "" : "s"}`,
        html: shell(
          "Your free month is ending",
          `<p style="margin:0 0 16px;color:#6b645c;font-size:15px;line-height:1.6;">Hi ${r.owner_name ?? "there"}, ${r.org_name}'s free month ends in ${r.days_left} day${r.days_left === 1 ? "" : "s"}${amount ? ` — ${amount}/mo after` : ""}. Set up payment to keep everything running.</p>`,
        ),
        text: `${r.org_name}'s free month ends in ${r.days_left} days${amount ? ` — ${amount}/mo after` : ""}. Set up payment: ${appUrl("/billing")}`,
      });
    }
    await sql`UPDATE subscription SET trial_reminder_at = now() WHERE organization_id = ${r.organization_id}`;
    trialSoon += 1;
  }

  // Free month lapsed — not yet reminded for past-due.
  const due = await sql<DueRow[]>`
    SELECT o.id AS organization_id, o.name AS org_name,
      (SELECT count(*)::int FROM space sp WHERE sp.organization_id = o.id AND sp.is_active) AS active_spaces,
      0 AS days_left, u.name AS owner_name, u.email AS owner_email
    FROM subscription s
    JOIN organization o ON o.id = s.organization_id
    LEFT JOIN member m ON m.organization_id = o.id AND m.role = 'owner'
    LEFT JOIN "user" u ON u.id = m.user_id
    WHERE s.status = 'trialing' AND s.due_reminder_at IS NULL AND now() > s.trial_ends_at
  `;
  let pastDue = 0;
  for (const r of due) {
    if (r.owner_email) {
      const amount = amountFor(r.active_spaces);
      await sendEmail({
        to: r.owner_email,
        subject: `Your free month has ended — ${r.org_name}`,
        html: shell(
          "Your free month has ended",
          `<p style="margin:0 0 16px;color:#6b645c;font-size:15px;line-height:1.6;">Hi ${r.owner_name ?? "there"}, ${r.org_name}'s free month has ended${amount ? ` — ${amount}/mo` : ""}. Pay to keep taking bookings.</p>`,
        ),
        text: `${r.org_name}'s free month has ended${amount ? ` — ${amount}/mo` : ""}. Pay: ${appUrl("/billing")}`,
      });
    }
    await sql`UPDATE subscription SET due_reminder_at = now() WHERE organization_id = ${r.organization_id}`;
    pastDue += 1;
  }

  return { trialSoon, pastDue };
}

/**
 * Turns off the public booking page for venues that are still unpaid GRACE_DAYS
 * after their free month (or paid period) ended. Records it on venue.suspended_at
 * with BILLING_SUSPEND_REASON so a later payment can lift it. Comped and
 * cancelled venues are left alone, and a venue already suspended (for any reason)
 * is never touched. Returns how many were suspended.
 */
export async function suspendOverdue(): Promise<number> {
  const rows = await sql<
    { organization_id: string; org_name: string; owner_name: string | null; owner_email: string | null }[]
  >`
    SELECT o.id AS organization_id, o.name AS org_name, u.name AS owner_name, u.email AS owner_email
    FROM subscription s
    JOIN organization o ON o.id = s.organization_id
    JOIN venue v ON v.organization_id = o.id
    LEFT JOIN member m ON m.organization_id = o.id AND m.role = 'owner'
    LEFT JOIN "user" u ON u.id = m.user_id
    WHERE v.suspended_at IS NULL
      AND s.status NOT IN ('comped', 'cancelled')
      AND (
        (s.status = 'trialing' AND now() > s.trial_ends_at + make_interval(days => ${GRACE_DAYS}))
        OR (s.status IN ('active', 'past_due')
              AND s.paid_until IS NOT NULL
              AND now() > s.paid_until + make_interval(days => ${GRACE_DAYS}))
      )
  `;

  let suspended = 0;
  for (const r of rows) {
    // Guard on suspended_at again so a suspension that landed between the select
    // and here (a manual one, say) is not overwritten.
    const [done] = await sql<{ organization_id: string }[]>`
      UPDATE venue
         SET suspended_at = now(), suspended_reason = ${BILLING_SUSPEND_REASON}
       WHERE organization_id = ${r.organization_id} AND suspended_at IS NULL
      RETURNING organization_id
    `;
    if (!done) continue;
    suspended += 1;

    if (r.owner_email) {
      await sendEmail({
        to: r.owner_email,
        subject: `${r.org_name}'s booking page has been paused`,
        html: shell(
          "Your booking page is paused",
          `<p style="margin:0 0 16px;color:#6b645c;font-size:15px;line-height:1.6;">Hi ${r.owner_name ?? "there"}, ${r.org_name}'s booking page is now paused because payment is overdue. Your data is safe — settle up and it comes straight back online.</p>`,
        ),
        text: `${r.org_name}'s booking page is paused for non-payment. Pay to reactivate: ${appUrl("/billing")}`,
      });
    }
  }
  return suspended;
}
