import { sql } from "@/db";
import { sendEmail } from "@/lib/email/mailer";
import { venueUrl } from "@/lib/env";

/**
 * Engagement + loyalty. Three idempotent operations a background job runs:
 *
 *   - accrueLoyalty:       award 1 point per ₱100 of a confirmed booking, once.
 *   - sendWinbacks:        email a lapsed ("at risk") customer a nudge, once.
 *   - sendReviewRequests:  ask for a review after a completed booking, once.
 *
 * Each is safe to re-run: a per-row flag (reservation.loyalty_accrued /
 * reservation.review_requested_at / customer.winback_at) records what has
 * already been done, so a repeated run is a no-op.
 */

export const POINTS_PER_PESO_CENTS = 10000; // ₱100 = 1 point.
export const AT_RISK_DAYS = 60; // No confirmed visit in this many days = at risk.

/** Awards loyalty for confirmed bookings not yet counted. Returns totals. */
export async function accrueLoyalty(): Promise<{ customers: number; points: number }> {
  return sql.begin(async (tx) => {
    // Claim the pending rows up front, so anything inserted mid-run is left for
    // the next pass rather than counted or skipped ambiguously.
    const claimed = await tx<{ customer_id: string; points: number }[]>`
      UPDATE reservation
         SET loyalty_accrued = true
       WHERE status = 'confirmed' AND loyalty_accrued = false AND customer_id IS NOT NULL
      RETURNING customer_id, floor(amount_cents / ${POINTS_PER_PESO_CENTS})::int AS points
    `;

    const perCustomer = new Map<string, number>();
    for (const r of claimed) {
      perCustomer.set(r.customer_id, (perCustomer.get(r.customer_id) ?? 0) + r.points);
    }

    let points = 0;
    for (const [customerId, pts] of perCustomer) {
      if (pts <= 0) continue;
      await tx`UPDATE customer SET loyalty_points = loyalty_points + ${pts} WHERE id = ${customerId}::uuid`;
      points += pts;
    }

    return { customers: perCustomer.size, points };
  });
}

type WinbackRow = {
  id: string;
  name: string;
  email: string;
  org_name: string;
  slug: string;
  last_visit_days: number;
};

function shell(heading: string, body: string, cta: { href: string; label: string }): string {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2b2622;background:#faf9f6;padding:24px 12px;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e6e2da;border-radius:14px;padding:28px;">
      <h1 style="margin:0 0 8px;font-size:20px;">${heading}</h1>${body}
      <a href="${cta.href}" style="display:inline-block;margin-top:6px;background:#2f6b52;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:999px;">${cta.label}</a>
    </div></body></html>`;
}

/** Emails opted-in, lapsed customers a win-back nudge — each at most once. */
export async function sendWinbacks(): Promise<number> {
  const rows = await sql<WinbackRow[]>`
    SELECT c.id, c.name, c.email, o.name AS org_name, o.slug,
           (now()::date - (last.starts_at AT TIME ZONE v.timezone)::date)::int AS last_visit_days
    FROM customer c
    JOIN organization o ON o.id = c.organization_id
    JOIN venue v        ON v.organization_id = o.id
    JOIN LATERAL (
      SELECT max(r.starts_at) AS starts_at
      FROM reservation r
      WHERE r.customer_id = c.id AND r.status = 'confirmed' AND r.starts_at <= now()
    ) last ON true
    WHERE c.marketing_opt_in = true
      AND c.winback_at IS NULL
      AND last.starts_at IS NOT NULL
      AND (last.starts_at AT TIME ZONE v.timezone)::date
            < (now() AT TIME ZONE v.timezone)::date - ${AT_RISK_DAYS}::int
  `;

  let sent = 0;
  for (const r of rows) {
    await sendEmail({
      to: r.email,
      subject: `We miss you at ${r.org_name}`,
      html: shell(
        `We miss you, ${r.name.split(" ")[0]}`,
        `<p style="margin:0 0 16px;color:#6b645c;font-size:15px;line-height:1.6;">It's been a while since your last visit to ${r.org_name}. Your spot is waiting — book a time that suits you.</p>`,
        { href: venueUrl(r.slug), label: "Book again" },
      ),
      text: `It's been a while since your last visit to ${r.org_name}. Book again: ${venueUrl(r.slug)}`,
    });
    await sql`UPDATE customer SET winback_at = now() WHERE id = ${r.id}::uuid`;
    sent += 1;
  }
  return sent;
}

type ReviewRow = {
  id: string;
  ref: string;
  customer_name: string;
  customer_email: string;
  org_name: string;
  review_url: string;
};

/** Asks for a review after a completed booking — each booking at most once. */
export async function sendReviewRequests(): Promise<number> {
  // A confirmed booking that ended between 2 and 72 hours ago: long enough that
  // the visit happened, recent enough to be worth asking. Only venues that have
  // set a review link, and customers who opted in.
  const rows = await sql<ReviewRow[]>`
    SELECT r.id, r.reference AS ref, c.name AS customer_name, c.email AS customer_email,
           o.name AS org_name, v.review_url
    FROM reservation r
    JOIN organization o ON o.id = r.organization_id
    JOIN venue v        ON v.organization_id = o.id
    JOIN customer c     ON c.id = r.customer_id
    WHERE r.status = 'confirmed'
      AND r.review_requested_at IS NULL
      AND v.review_url IS NOT NULL
      AND c.marketing_opt_in = true
      AND r.ends_at < now() - interval '2 hours'
      AND r.ends_at > now() - interval '72 hours'
  `;

  let sent = 0;
  for (const r of rows) {
    await sendEmail({
      to: r.customer_email,
      subject: `How was your visit to ${r.org_name}?`,
      html: shell(
        "How did we do?",
        `<p style="margin:0 0 16px;color:#6b645c;font-size:15px;line-height:1.6;">Thanks for visiting ${r.org_name}, ${r.customer_name.split(" ")[0]}. If you have a moment, we'd love a quick review — it really helps.</p>`,
        { href: r.review_url, label: "Leave a review" },
      ),
      text: `Thanks for visiting ${r.org_name}. Leave a review: ${r.review_url}`,
    });
    await sql`UPDATE reservation SET review_requested_at = now() WHERE id = ${r.id}::uuid`;
    sent += 1;
  }
  return sent;
}

/**
 * The owner's review link (Google, Facebook…). Review requests only go out
 * once one is set. Returns the refusal in the owner's words, or null.
 */
export function reviewUrlProblem(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "Enter a full link, e.g. https://g.page/…";
  const trimmed = value.trim();
  if (trimmed === "") return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:"
      ? null
      : "Enter a full link, e.g. https://g.page/…";
  } catch {
    return "Enter a full link, e.g. https://g.page/…";
  }
}

export async function setReviewUrl(organizationId: string, value: string | null): Promise<void> {
  const url = value?.trim() ? value.trim() : null;
  await sql`UPDATE venue SET review_url = ${url} WHERE organization_id = ${organizationId}`;
}

export async function reviewUrlFor(organizationId: string): Promise<string | null> {
  const [row] = await sql<{ review_url: string | null }[]>`
    SELECT review_url FROM venue WHERE organization_id = ${organizationId}
  `;
  return row?.review_url ?? null;
}
