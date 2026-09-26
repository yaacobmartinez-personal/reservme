import { sql } from "@/db";
import { getLocalDates } from "@/lib/venue";
import { getDayAvailability } from "./availability";

/**
 * Customer self-service: read a booking by its manage token and decide whether
 * the customer may cancel it, honouring the venue's cancellation policy.
 *
 * Unlike the owner cancel path (which bypasses policy), the customer path must
 * enforce it — so the eligibility rule lives here as a pure function, used both
 * to render the page and, re-derived, in the cancel action.
 */

export type CancellationMode = "anytime" | "grace" | "never";

export type CancelEligibility = { canCancel: boolean; reason: string | null };

/** Pure — the single source of truth for "can this be cancelled online now?". */
export function cancelEligibility(
  status: string,
  startsAt: Date,
  mode: CancellationMode,
  graceHours: number,
  now: Date = new Date(),
): CancelEligibility {
  if (status !== "confirmed") {
    const reason =
      status === "cancelled"
        ? "This booking is already cancelled."
        : status === "no_show"
          ? "This booking is marked as a no-show."
          : status === "held"
            ? "This booking isn't confirmed yet."
            : "This booking can't be cancelled.";
    return { canCancel: false, reason };
  }

  if (startsAt.getTime() <= now.getTime()) {
    return { canCancel: false, reason: "This booking has already passed." };
  }

  if (mode === "never") {
    return {
      canCancel: false,
      reason: "This venue doesn't allow online cancellation — please contact them.",
    };
  }

  if (mode === "grace") {
    const cutoff = startsAt.getTime() - graceHours * 3600_000;
    if (now.getTime() > cutoff) {
      return {
        canCancel: false,
        reason: `This is within ${graceHours} hours of the start, so it can't be cancelled online — please contact the venue.`,
      };
    }
  }

  return { canCancel: true, reason: null };
}

export type ManageableBooking = {
  organizationId: string;
  reservationId: string;
  venueName: string;
  venueSlug: string;
  theme: string;
  spaceId: string;
  spaceName: string;
  timezone: string;
  slotMinutes: number;
  whenLabel: string;
  reference: string;
  amountCents: number;
  currency: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  kind: string;
  partySize: number;
  checkedInAt: Date | null;
  notes: string | null;
  spaceKind: string;
  address: string | null;
  cancellation: CancelEligibility;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The booking behind a manage token, or null (unknown/rotated token, or the slug
 * doesn't match). Not gated on suspension — a customer must still be able to
 * cancel an existing booking when the venue has stopped taking new ones.
 */
export async function getManageableBooking(
  venueSlug: string,
  token: string,
): Promise<ManageableBooking | null> {
  if (!UUID.test(token)) return null;

  const [row] = await sql<
    {
      organization_id: string;
      reservation_id: string;
      venue_name: string;
      venue_slug: string;
      theme: string;
      space_id: string;
      space_name: string;
      timezone: string;
      slot_minutes: number;
      when_label: string;
      reference: string;
      amount_cents: number;
      currency: string;
      status: string;
      starts_at: Date;
      ends_at: Date;
      kind: string;
      party_size: number;
      checked_in_at: Date | null;
      notes: string | null;
      space_kind: string;
      address: string | null;
      cancellation_mode: CancellationMode;
      cancellation_grace_hours: number;
    }[]
  >`
    SELECT r.organization_id, r.id AS reservation_id,
           o.name AS venue_name, o.slug AS venue_slug, v.theme,
           s.id AS space_id, s.name AS space_name, s.slot_minutes, v.timezone,
           to_char(r.starts_at AT TIME ZONE v.timezone, 'Dy DD Mon, HH24:MI')
             || '–' ||
             to_char(r.ends_at AT TIME ZONE v.timezone, 'HH24:MI') AS when_label,
           r.reference, r.amount_cents, v.currency, r.status, r.starts_at,
           r.ends_at, r.kind, r.party_size, r.checked_in_at, r.notes,
           s.kind AS space_kind, v.address,
           v.cancellation_mode, v.cancellation_grace_hours
    FROM reservation r
    JOIN organization o ON o.id = r.organization_id
    JOIN venue v        ON v.organization_id = o.id
    JOIN space s        ON s.id = r.space_id
    WHERE r.manage_token = ${token}::uuid AND o.slug = ${venueSlug}
  `;

  if (!row) return null;

  return {
    organizationId: row.organization_id,
    reservationId: row.reservation_id,
    venueName: row.venue_name,
    venueSlug: row.venue_slug,
    theme: row.theme,
    spaceId: row.space_id,
    spaceName: row.space_name,
    timezone: row.timezone,
    slotMinutes: row.slot_minutes,
    whenLabel: row.when_label,
    reference: row.reference,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    kind: row.kind,
    partySize: row.party_size,
    checkedInAt: row.checked_in_at,
    notes: row.notes,
    spaceKind: row.space_kind,
    address: row.address,
    cancellation: cancelEligibility(
      row.status,
      row.starts_at,
      row.cancellation_mode,
      row.cancellation_grace_hours,
    ),
  };
}

/** Look up just the ids + policy for the cancel action (re-derives eligibility). */
export async function getBookingForCancel(
  venueSlug: string,
  token: string,
): Promise<{
  organizationId: string;
  reservationId: string;
  spaceId: string;
  eligibility: CancelEligibility;
} | null> {
  if (!UUID.test(token)) return null;
  const [row] = await sql<
    {
      organization_id: string;
      reservation_id: string;
      space_id: string;
      status: string;
      starts_at: Date;
      ends_at: Date;
      kind: string;
      party_size: number;
      checked_in_at: Date | null;
      notes: string | null;
      space_kind: string;
      address: string | null;
      cancellation_mode: CancellationMode;
      cancellation_grace_hours: number;
    }[]
  >`
    SELECT r.organization_id, r.id AS reservation_id, r.space_id, r.status, r.starts_at,
           v.cancellation_mode, v.cancellation_grace_hours
    FROM reservation r
    JOIN organization o ON o.id = r.organization_id
    JOIN venue v        ON v.organization_id = o.id
    WHERE r.manage_token = ${token}::uuid AND o.slug = ${venueSlug}
  `;
  if (!row) return null;
  return {
    organizationId: row.organization_id,
    reservationId: row.reservation_id,
    spaceId: row.space_id,
    eligibility: cancelEligibility(
      row.status,
      row.starts_at,
      row.cancellation_mode,
      row.cancellation_grace_hours,
    ),
  };
}

export type RescheduleDay = {
  date: string;
  weekday: string;
  dayNum: string;
  slots: { time: string; startsAtISO: string }[];
};

/** Open slots on this space over the next `days` local dates, for the picker. */
export async function rescheduleOptions(
  organizationId: string,
  spaceId: string,
  timezone: string,
  days = 7,
): Promise<RescheduleDay[]> {
  const dates = await getLocalDates(timezone, days);
  const out: RescheduleDay[] = [];
  for (const d of dates) {
    const slots = await getDayAvailability(organizationId, spaceId, d.d);
    out.push({
      date: d.d,
      weekday: d.weekday,
      dayNum: d.day,
      slots: slots
        .filter((s) => s.available)
        .map((s) => ({ time: s.label, startsAtISO: s.startsAt.toISOString() })),
    });
  }
  return out;
}
