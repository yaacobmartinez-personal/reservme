import { sql } from "@/db";

/**
 * The owner calendar's read model: everything on the day grid for one venue-
 * local date, across all active spaces — rentals, open-play sessions, and
 * closures — each positioned by minute-of-day so the client can lay it out with
 * no timezone maths of its own.
 *
 * Same rule as analytics/availability: every "day", start and end is computed
 * in the venue's own zone via AT TIME ZONE, never UTC. Positions are minutes
 * from local midnight, clamped to the day so a multi-day closure still draws
 * inside the grid.
 */

export type CalendarColumn = {
  id: string;
  name: string;
  slotMinutes: number;
};

export type CalendarBlock = {
  type: "rental" | "session" | "closure";
  id: string;
  /** null only for a venue-wide closure (spans every column). */
  spaceId: string | null;
  startsAt: Date;
  endsAt: Date;
  /** Minutes from local midnight, clamped to [0, 1440]. */
  startMin: number;
  endMin: number;
  startLabel: string;
  endLabel: string;
  title: string;
  subtitle: string | null;
  // rental-only
  status?: string;
  checkedIn?: boolean;
  customerId?: string | null;
  partySize?: number;
  amountCents?: number;
  reference?: string;
  // session-only
  capacity?: number;
  bookedSpots?: number;
};

export type CalendarDay = {
  date: string;
  /** Grid time axis, minutes from midnight (venue-local). */
  openMin: number;
  closeMin: number;
  columns: CalendarColumn[];
  blocks: CalendarBlock[];
};

export async function getCalendarDay(
  organizationId: string,
  timezone: string,
  localDate: string,
): Promise<CalendarDay> {
  const [columns, axis, rentals, sessions, closures] = await Promise.all([
    sql<CalendarColumn[]>`
      SELECT id, name, slot_minutes AS "slotMinutes"
      FROM space
      WHERE organization_id = ${organizationId} AND is_active
      ORDER BY sort_order, name
    `,
    // Widest open→close across the day's active spaces, for the axis. Falls back
    // to 06:00–22:00 when nothing opens that weekday.
    sql<{ open_min: number; close_min: number }[]>`
      SELECT
        COALESCE(MIN(EXTRACT(HOUR FROM oh.opens_at) * 60 + EXTRACT(MINUTE FROM oh.opens_at)), 360)::int AS open_min,
        COALESCE(MAX(EXTRACT(HOUR FROM oh.closes_at) * 60 + EXTRACT(MINUTE FROM oh.closes_at)), 1320)::int AS close_min
      FROM opening_hours oh
      JOIN space s ON s.id = oh.space_id
      WHERE s.organization_id = ${organizationId} AND s.is_active
        AND oh.weekday = EXTRACT(DOW FROM ${localDate}::date)::smallint
    `,
    sql<
      {
        id: string;
        space_id: string;
        starts_at: Date;
        ends_at: Date;
        start_min: number;
        end_min: number;
        start_label: string;
        end_label: string;
        customer_id: string | null;
        customer_name: string | null;
        status: string;
        checked_in: boolean;
        party_size: number;
        amount_cents: number;
        reference: string;
      }[]
    >`
      SELECT r.id, r.space_id, r.starts_at, r.ends_at,
        GREATEST(0, EXTRACT(EPOCH FROM ((r.starts_at AT TIME ZONE ${timezone}) - ${localDate}::date)) / 60)::int AS start_min,
        LEAST(1440, EXTRACT(EPOCH FROM ((r.ends_at   AT TIME ZONE ${timezone}) - ${localDate}::date)) / 60)::int AS end_min,
        to_char(r.starts_at AT TIME ZONE ${timezone}, 'HH24:MI') AS start_label,
        to_char(r.ends_at   AT TIME ZONE ${timezone}, 'HH24:MI') AS end_label,
        r.customer_id, c.name AS customer_name,
        r.status, (r.checked_in_at IS NOT NULL) AS checked_in,
        r.party_size, r.amount_cents, r.reference
      FROM reservation r
      LEFT JOIN customer c ON c.id = r.customer_id
      WHERE r.organization_id = ${organizationId}
        AND r.kind = 'rental'
        AND r.status IN ('held', 'confirmed', 'no_show')
        AND (r.starts_at AT TIME ZONE ${timezone})::date = ${localDate}::date
      ORDER BY r.starts_at
    `,
    sql<
      {
        id: string;
        space_id: string;
        starts_at: Date;
        ends_at: Date;
        start_min: number;
        end_min: number;
        start_label: string;
        end_label: string;
        title: string;
        capacity: number;
        booked_spots: number;
      }[]
    >`
      SELECT ps.id, ps.space_id, ps.starts_at, ps.ends_at,
        GREATEST(0, EXTRACT(EPOCH FROM ((ps.starts_at AT TIME ZONE ${timezone}) - ${localDate}::date)) / 60)::int AS start_min,
        LEAST(1440, EXTRACT(EPOCH FROM ((ps.ends_at   AT TIME ZONE ${timezone}) - ${localDate}::date)) / 60)::int AS end_min,
        to_char(ps.starts_at AT TIME ZONE ${timezone}, 'HH24:MI') AS start_label,
        to_char(ps.ends_at   AT TIME ZONE ${timezone}, 'HH24:MI') AS end_label,
        ps.title, ps.capacity, ps.booked_spots
      FROM play_session ps
      WHERE ps.organization_id = ${organizationId}
        AND ps.cancelled = false
        AND (ps.starts_at AT TIME ZONE ${timezone})::date = ${localDate}::date
      ORDER BY ps.starts_at
    `,
    sql<
      {
        id: string;
        space_id: string | null;
        starts_at: Date;
        ends_at: Date;
        start_min: number;
        end_min: number;
        start_label: string;
        end_label: string;
        reason: string | null;
      }[]
    >`
      SELECT c.id, c.space_id, c.starts_at, c.ends_at,
        GREATEST(0, EXTRACT(EPOCH FROM ((c.starts_at AT TIME ZONE ${timezone}) - ${localDate}::date)) / 60)::int AS start_min,
        LEAST(1440, EXTRACT(EPOCH FROM ((c.ends_at   AT TIME ZONE ${timezone}) - ${localDate}::date)) / 60)::int AS end_min,
        to_char(c.starts_at AT TIME ZONE ${timezone}, 'HH24:MI') AS start_label,
        to_char(c.ends_at   AT TIME ZONE ${timezone}, 'HH24:MI') AS end_label,
        c.reason
      FROM closure c
      WHERE c.organization_id = ${organizationId}
        AND tstzrange(c.starts_at, c.ends_at, '[)')
            && tstzrange(
                 (${localDate}::date)::timestamp AT TIME ZONE ${timezone},
                 (${localDate}::date + 1)::timestamp AT TIME ZONE ${timezone}, '[)')
      ORDER BY c.starts_at
    `,
  ]);

  const blocks: CalendarBlock[] = [
    ...rentals.map((r): CalendarBlock => ({
      type: "rental",
      id: r.id,
      spaceId: r.space_id,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      startMin: r.start_min,
      endMin: r.end_min,
      startLabel: r.start_label,
      endLabel: r.end_label,
      title: r.customer_name ?? "Walk-in",
      subtitle: null,
      status: r.status,
      checkedIn: r.checked_in,
      customerId: r.customer_id,
      partySize: r.party_size,
      amountCents: r.amount_cents,
      reference: r.reference,
    })),
    ...sessions.map((s): CalendarBlock => ({
      type: "session",
      id: s.id,
      spaceId: s.space_id,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      startMin: s.start_min,
      endMin: s.end_min,
      startLabel: s.start_label,
      endLabel: s.end_label,
      title: s.title,
      subtitle: `${s.booked_spots}/${s.capacity} booked`,
      capacity: s.capacity,
      bookedSpots: s.booked_spots,
    })),
    ...closures.map((c): CalendarBlock => ({
      type: "closure",
      id: c.id,
      spaceId: c.space_id,
      startsAt: c.starts_at,
      endsAt: c.ends_at,
      startMin: c.start_min,
      endMin: c.end_min,
      startLabel: c.start_label,
      endLabel: c.end_label,
      title: c.reason ?? "Closed",
      subtitle: null,
    })),
  ];

  const bounds = axis[0] ?? { open_min: 360, close_min: 1320 };
  // Never let a booking fall off the top/bottom of the axis: widen to include
  // anything that lands outside opening hours (a staff after-hours entry).
  let openMin = bounds.open_min;
  let closeMin = bounds.close_min;
  for (const b of blocks) {
    if (b.type === "closure") continue; // closures shouldn't stretch the axis
    openMin = Math.min(openMin, b.startMin);
    closeMin = Math.max(closeMin, b.endMin);
  }
  // Snap to whole hours for a tidy axis, and guarantee a sane minimum height.
  openMin = Math.max(0, Math.floor(openMin / 60) * 60);
  closeMin = Math.min(1440, Math.ceil(closeMin / 60) * 60);
  if (closeMin - openMin < 60) closeMin = Math.min(1440, openMin + 60);

  return { date: localDate, openMin, closeMin, columns, blocks };
}
