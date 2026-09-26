import { sql } from "@/db";

/**
 * Availability is *derived*, never authoritative. If this disagrees with the
 * database, the database is right — `reservation_no_overlap` is what actually
 * decides whether a booking exists. Treat everything here as a good-faith
 * prediction that the write may still reject.
 */

export type Slot = {
  startsAt: Date;
  endsAt: Date;
  /** "09:00", already in the venue's own timezone. */
  label: string;
  available: boolean;
  reason: "open" | "taken" | "closed" | "too_soon" | "too_far_ahead";
  priceCents: number;
  /** True when a pricing rule raised this slot above the space's base price. */
  peak: boolean;
};

type SlotRow = {
  starts_at: Date;
  ends_at: Date;
  label: string;
  taken: boolean;
  closed: boolean;
  too_soon: boolean;
  too_far: boolean;
  price_cents: number;
  base_price_cents: number;
};

/**
 * Slots for one space on one local calendar date.
 *
 * Generated in *local* time and converted per-slot, not generated in UTC with
 * a fixed step — the latter drifts by an hour across a DST boundary. The
 * Philippines has no DST, but a venue in Madrid does, and the cost of doing it
 * correctly here is one `AT TIME ZONE`.
 */
export async function getDayAvailability(
  organizationId: string,
  spaceId: string,
  localDate: string,
): Promise<Slot[]> {
  const rows = await sql<SlotRow[]>`
    WITH cfg AS (
      SELECT
        s.id            AS space_id,
        s.slot_minutes,
        s.buffer_minutes,
        s.price_cents,
        s.is_active,
        v.timezone,
        v.min_notice_minutes,
        v.max_horizon_days,
        ${localDate}::date AS local_date
      FROM space s
      JOIN venue v ON v.organization_id = s.organization_id
      WHERE s.id = ${spaceId}::uuid
        AND s.organization_id = ${organizationId}
    ),
    -- Opening hours are weekday + local time-of-day, so the local date has to
    -- be resolved in the venue's zone before we know which weekday it is.
    slots AS (
      SELECT
        cfg.*,
        gs.local_start,
        gs.local_start + make_interval(mins => cfg.slot_minutes) AS local_end
      FROM cfg
      JOIN opening_hours oh
        ON oh.space_id = cfg.space_id
       AND oh.weekday  = EXTRACT(DOW FROM cfg.local_date)::smallint
      CROSS JOIN LATERAL generate_series(
        cfg.local_date + oh.opens_at,
        cfg.local_date + oh.closes_at - make_interval(mins => cfg.slot_minutes),
        make_interval(mins => cfg.slot_minutes)
      ) AS gs(local_start)
    ),
    resolved AS (
      SELECT
        slots.*,
        (slots.local_start AT TIME ZONE slots.timezone) AS starts_at,
        (slots.local_end   AT TIME ZONE slots.timezone) AS ends_at
      FROM slots
    )
    SELECT
      r.starts_at,
      r.ends_at,
      to_char(r.local_start, 'HH24:MI') AS label,
      -- Peak/off-peak: a matching rule overrides the base price for this slot.
      COALESCE(
        (SELECT pr.price_cents FROM pricing_rule pr
          WHERE pr.space_id = r.space_id
            AND EXTRACT(DOW FROM r.local_start)::smallint = ANY(pr.weekdays)
            AND r.local_start::time >= pr.starts_at
            AND r.local_start::time <  pr.ends_at
          ORDER BY pr.created_at DESC LIMIT 1),
        r.price_cents
      ) AS price_cents,
      r.price_cents AS base_price_cents,
      -- A live reservation within buffer distance blocks the slot. The buffer
      -- is enforced here, not by the constraint: the constraint guards literal
      -- overlap, which is the part that must never be wrong.
      EXISTS (
        SELECT 1 FROM reservation res
        WHERE res.space_id = r.space_id
          AND res.kind   IN ('rental', 'session_block')
          AND res.status IN ('held', 'confirmed')
          AND res.during && tstzrange(
                r.starts_at - make_interval(mins => r.buffer_minutes),
                r.ends_at   + make_interval(mins => r.buffer_minutes),
                '[)')
      ) AS taken,
      (NOT r.is_active) OR EXISTS (
        SELECT 1 FROM closure c
        WHERE c.organization_id = ${organizationId}
          AND (c.space_id = r.space_id OR c.space_id IS NULL)
          AND tstzrange(c.starts_at, c.ends_at, '[)') && tstzrange(r.starts_at, r.ends_at, '[)')
      ) AS closed,
      r.starts_at < now() + make_interval(mins => r.min_notice_minutes) AS too_soon,
      r.starts_at > now() + make_interval(days => r.max_horizon_days)   AS too_far
    FROM resolved r
    ORDER BY r.starts_at
  `;

  return rows.map((row) => {
    const reason: Slot["reason"] = row.closed
      ? "closed"
      : row.taken
        ? "taken"
        : row.too_soon
          ? "too_soon"
          : row.too_far
            ? "too_far_ahead"
            : "open";

    return {
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      label: row.label,
      available: reason === "open",
      reason,
      priceCents: row.price_cents,
      peak: row.price_cents > row.base_price_cents,
    };
  });
}

export type SessionSummary = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  label: string;
  capacity: number;
  bookedSpots: number;
  spotsLeft: number;
  pricePerPersonCents: number;
};

/** Shared sessions on a space for one local date, with spots remaining. */
export async function getDaySessions(
  organizationId: string,
  spaceId: string,
  localDate: string,
): Promise<SessionSummary[]> {
  const rows = await sql<
    {
      id: string;
      title: string;
      starts_at: Date;
      ends_at: Date;
      label: string;
      capacity: number;
      booked_spots: number;
      price_per_person_cents: number;
    }[]
  >`
    SELECT
      ps.id,
      ps.title,
      ps.starts_at,
      ps.ends_at,
      to_char(ps.starts_at AT TIME ZONE v.timezone, 'HH24:MI')
        || '–' ||
        to_char(ps.ends_at AT TIME ZONE v.timezone, 'HH24:MI') AS label,
      ps.capacity,
      ps.booked_spots,
      ps.price_per_person_cents
    FROM play_session ps
    JOIN venue v ON v.organization_id = ps.organization_id
    WHERE ps.organization_id = ${organizationId}
      AND ps.space_id = ${spaceId}::uuid
      AND ps.cancelled = false
      AND (ps.starts_at AT TIME ZONE v.timezone)::date = ${localDate}::date
    ORDER BY ps.starts_at
  `;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    label: row.label,
    capacity: row.capacity,
    bookedSpots: row.booked_spots,
    spotsLeft: row.capacity - row.booked_spots,
    pricePerPersonCents: row.price_per_person_cents,
  }));
}
