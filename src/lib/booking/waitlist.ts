import { sql } from "@/db";
import { sendEmail } from "@/lib/email/mailer";
import { apexUrl } from "@/lib/env";

/**
 * Waitlist. A customer asks to be told if a taken slot frees; on a cancellation
 * we notify the earliest waiter for the freed slot with a booking link. It's a
 * notification, not an auto-hold — first to re-book wins, which keeps the
 * double-booking guarantee untouched (they go through the same reserve path).
 */

type CustomerDetails = { name: string; email: string; phone?: string };

async function upsertCustomer(organizationId: string, details: CustomerDetails): Promise<string> {
  const email = details.email.trim().toLowerCase();
  const name = details.name.trim();
  const phone = details.phone?.trim() || null;

  const [existing] = await sql<{ id: string }[]>`
    SELECT id FROM customer WHERE organization_id = ${organizationId} AND email = ${email}`;
  if (existing) return existing.id;

  const [inserted] = await sql<{ id: string }[]>`
    INSERT INTO customer (organization_id, name, email, phone)
    VALUES (${organizationId}, ${name}, ${email}, ${phone})
    ON CONFLICT (organization_id, email) DO NOTHING
    RETURNING id`;
  if (inserted) return inserted.id;

  const [raced] = await sql<{ id: string }[]>`
    SELECT id FROM customer WHERE organization_id = ${organizationId} AND email = ${email}`;
  return raced.id;
}

export async function joinWaitlist(input: {
  organizationId: string;
  spaceId: string;
  startsAt: Date;
  endsAt: Date;
  customer: CustomerDetails;
}): Promise<{ ok: true; already: boolean }> {
  const customerId = await upsertCustomer(input.organizationId, input.customer);

  const rows = await sql`
    INSERT INTO waitlist (organization_id, space_id, starts_at, ends_at, customer_id)
    VALUES (${input.organizationId}, ${input.spaceId}::uuid, ${input.startsAt}, ${input.endsAt}, ${customerId}::uuid)
    ON CONFLICT (space_id, starts_at, customer_id) WHERE status = 'waiting' DO NOTHING
    RETURNING id
  `;
  // No row back = they were already waiting for this exact slot.
  return { ok: true, already: rows.length === 0 };
}

/** Promote + notify the earliest waiter for the slot a just-cancelled booking freed. */
export async function promoteWaitlistForReservation(
  organizationId: string,
  reservationId: string,
): Promise<{ notified: boolean }> {
  const [r] = await sql<{ space_id: string; starts_at: Date; ends_at: Date }[]>`
    SELECT space_id, starts_at, ends_at FROM reservation
    WHERE id = ${reservationId}::uuid AND organization_id = ${organizationId}`;
  if (!r) return { notified: false };
  return promoteWaitlist(organizationId, r.space_id, r.starts_at, r.ends_at);
}

export async function promoteWaitlist(
  organizationId: string,
  spaceId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<{ notified: boolean }> {
  const promoted = await sql.begin(async (tx) => {
    const [entry] = await tx<
      {
        id: string;
        customer_name: string;
        customer_email: string;
        venue_slug: string;
        venue_name: string;
        space_name: string;
        space_slug: string;
        when_label: string;
        local_date: string;
      }[]
    >`
      SELECT w.id, c.name AS customer_name, c.email AS customer_email,
             o.slug AS venue_slug, o.name AS venue_name,
             s.name AS space_name, s.slug AS space_slug,
             to_char(w.starts_at AT TIME ZONE v.timezone, 'Dy DD Mon, HH24:MI') AS when_label,
             to_char(w.starts_at AT TIME ZONE v.timezone, 'YYYY-MM-DD') AS local_date
      FROM waitlist w
      JOIN customer c     ON c.id = w.customer_id
      JOIN organization o ON o.id = w.organization_id
      JOIN venue v        ON v.organization_id = w.organization_id
      JOIN space s        ON s.id = w.space_id
      WHERE w.space_id = ${spaceId}::uuid
        AND w.status = 'waiting'
        AND w.starts_at < ${endsAt}
        AND w.ends_at > ${startsAt}
      ORDER BY w.created_at
      LIMIT 1
      FOR UPDATE OF w SKIP LOCKED
    `;
    if (!entry) return null;
    await tx`UPDATE waitlist SET status = 'notified', notified_at = now() WHERE id = ${entry.id}::uuid`;
    return entry;
  });

  if (!promoted) return { notified: false };

  const url = apexUrl(`/${promoted.venue_slug}?space=${promoted.space_slug}&date=${promoted.local_date}`);
  await sendEmail({
    to: promoted.customer_email,
    subject: `A slot just opened at ${promoted.venue_name}`,
    html: `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2b2622;background:#faf9f6;padding:24px 12px;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e6e2da;border-radius:14px;padding:28px;">
        <h1 style="margin:0 0 8px;font-size:20px;">A slot opened up</h1>
        <p style="margin:0 0 16px;color:#6b645c;font-size:15px;line-height:1.6;">Good news, ${promoted.customer_name} — a spot you were waiting for at <strong>${promoted.venue_name}</strong> is free: ${promoted.space_name}, ${promoted.when_label}. Book it before someone else does.</p>
        <a href="${url}" style="display:inline-block;background:#2f6b52;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:999px;">Book this slot</a>
      </div></body></html>`,
    text: `A slot opened up at ${promoted.venue_name}: ${promoted.space_name}, ${promoted.when_label}.\nBook it: ${url}\n`,
  });

  return { notified: true };
}
