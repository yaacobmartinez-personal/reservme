import { sql } from "@/db";
import { apexUrl } from "@/lib/env";
import { sendEmail, type SendResult } from "./mailer";
import {
  bookingConfirmationEmail,
  bookingReminderEmail,
  type BookingEmailData,
} from "./templates";

/**
 * Loads everything an email needs about a reservation in one query, rendered in
 * the venue's own timezone. Returns null if the reservation is gone or has no
 * customer email (a walk-in the owner keyed in), in which case there is nobody
 * to write to.
 */
async function loadBookingEmailData(
  reservationId: string,
  organizationId: string,
): Promise<{ to: string; data: BookingEmailData } | null> {
  const [row] = await sql<
    {
      email: string | null;
      customer_name: string | null;
      venue_name: string;
      venue_slug: string;
      space_name: string;
      when_label: string;
      reference: string;
      amount_cents: number;
      currency: string;
      address: string | null;
    }[]
  >`
    SELECT c.email, c.name AS customer_name,
           o.name AS venue_name, o.slug AS venue_slug, s.name AS space_name,
           to_char(r.starts_at AT TIME ZONE v.timezone, 'Dy DD Mon, HH24:MI')
             || '–' ||
             to_char(r.ends_at AT TIME ZONE v.timezone, 'HH24:MI') AS when_label,
           r.reference, r.amount_cents, v.currency, v.address
    FROM reservation r
    JOIN organization o ON o.id = r.organization_id
    JOIN venue v        ON v.organization_id = o.id
    JOIN space s        ON s.id = r.space_id
    LEFT JOIN customer c ON c.id = r.customer_id
    WHERE r.id = ${reservationId}::uuid
      AND r.organization_id = ${organizationId}
  `;

  if (!row || !row.email) return null;

  return {
    to: row.email,
    data: {
      customerName: row.customer_name ?? "there",
      venueName: row.venue_name,
      venueSlug: row.venue_slug,
      spaceName: row.space_name,
      whenLabel: row.when_label,
      reference: row.reference,
      amountCents: row.amount_cents,
      currency: row.currency,
      address: row.address,
      manageUrl: apexUrl(`/${row.venue_slug}`),
    },
  };
}

export async function sendBookingConfirmation(
  reservationId: string,
  organizationId: string,
): Promise<SendResult> {
  const loaded = await loadBookingEmailData(reservationId, organizationId);
  if (!loaded) return { ok: true, id: null, delivered: false };

  const email = bookingConfirmationEmail(loaded.data);
  return sendEmail({ to: loaded.to, ...email });
}

export async function sendBookingReminder(
  reservationId: string,
  organizationId: string,
): Promise<SendResult> {
  const loaded = await loadBookingEmailData(reservationId, organizationId);
  if (!loaded) return { ok: true, id: null, delivered: false };

  // Don't remind about a booking that was cancelled after the reminder was
  // scheduled.
  const [live] = await sql<{ id: string }[]>`
    SELECT id FROM reservation
    WHERE id = ${reservationId}::uuid AND status = 'confirmed'
  `;
  if (!live) return { ok: true, id: null, delivered: false };

  const email = bookingReminderEmail(loaded.data);
  return sendEmail({ to: loaded.to, ...email });
}
