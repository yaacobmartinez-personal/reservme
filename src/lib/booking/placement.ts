import { sql } from "@/db";
import { BookingError } from "./errors";

export type Placement = {
  price_cents: number;
  slot_minutes: number;
  is_active: boolean;
  too_soon: boolean;
  too_far: boolean;
  within_hours: boolean;
  closed: boolean;
  session_conflict: boolean;
};

/**
 * Re-derives, from the database, everything that decides whether a rental may
 * sit on (spaceId, startsAt–endsAt): price, grid step, active flag, opening
 * hours, closures, the notice/horizon windows, and a shared session already on
 * the court. A prediction the write still re-checks — availability is never
 * authoritative. Returns null when the space isn't this org's.
 *
 * Shared by the public path (reserveSpace), the staff path, and moveReservation
 * so all three read identical facts; only the *policy* they enforce differs.
 */
export async function derivePlacement(
  organizationId: string,
  spaceId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<Placement | null> {
  const [row] = await sql<Placement[]>`
    SELECT
      -- Peak/off-peak: the slot's start time may carry a rule price (must match
      -- what availability showed) — fall back to the space's base price.
      COALESCE(
        (SELECT pr.price_cents FROM pricing_rule pr
          WHERE pr.space_id = s.id
            AND EXTRACT(DOW FROM (${startsAt}::timestamptz AT TIME ZONE v.timezone))::smallint = ANY(pr.weekdays)
            AND (${startsAt}::timestamptz AT TIME ZONE v.timezone)::time >= pr.starts_at
            AND (${startsAt}::timestamptz AT TIME ZONE v.timezone)::time <  pr.ends_at
          ORDER BY pr.created_at DESC LIMIT 1),
        s.price_cents
      ) AS price_cents,
      s.slot_minutes,
      s.is_active,
      ${startsAt}::timestamptz < now() + make_interval(mins => v.min_notice_minutes) AS too_soon,
      ${startsAt}::timestamptz > now() + make_interval(days => v.max_horizon_days)   AS too_far,
      EXISTS (
        SELECT 1 FROM opening_hours oh
        WHERE oh.space_id = s.id
          AND oh.weekday = EXTRACT(DOW FROM (${startsAt}::timestamptz AT TIME ZONE v.timezone))::smallint
          AND (${startsAt}::timestamptz AT TIME ZONE v.timezone)::time >= oh.opens_at
          AND (${endsAt}::timestamptz   AT TIME ZONE v.timezone)::time <= oh.closes_at
          AND (${startsAt}::timestamptz AT TIME ZONE v.timezone)::date
              = (${endsAt}::timestamptz AT TIME ZONE v.timezone)::date
      ) AS within_hours,
      EXISTS (
        SELECT 1 FROM closure c
        WHERE c.organization_id = s.organization_id
          AND (c.space_id = s.id OR c.space_id IS NULL)
          AND tstzrange(c.starts_at, c.ends_at, '[)')
              && tstzrange(${startsAt}::timestamptz, ${endsAt}::timestamptz, '[)')
      ) AS closed,
      EXISTS (
        SELECT 1 FROM play_session ps
        WHERE ps.space_id = s.id
          AND ps.cancelled = false
          AND tstzrange(ps.starts_at, ps.ends_at, '[)')
              && tstzrange(${startsAt}::timestamptz, ${endsAt}::timestamptz, '[)')
      ) AS session_conflict
    FROM space s
    JOIN venue v ON v.organization_id = s.organization_id
    WHERE s.id = ${spaceId}::uuid AND s.organization_id = ${organizationId}
  `;
  return row ?? null;
}

/**
 * Turns a placement into a go / no-go. The `staff` path relaxes only *policy* —
 * the notice window, the booking horizon, and the one-slot length limit (staff
 * may book N consecutive slots) — and keeps every *physical* guarantee: the
 * space must be active, within opening hours, not closed, and not on top of a
 * shared session. Overlap itself is enforced by the constraint on write.
 * Physical invariants are never overridable, whoever is booking.
 */
export function validatePlacement(placement: Placement, minutes: number, staff: boolean): void {
  if (!placement.is_active) throw new BookingError("space_inactive");
  // Public: exactly one grid step. Staff: any positive whole number of steps.
  const lengthOk = staff
    ? minutes > 0 && minutes % placement.slot_minutes === 0
    : minutes > 0 && minutes === placement.slot_minutes;
  if (!lengthOk) throw new BookingError("bad_slot");
  if (placement.closed) throw new BookingError("closed");
  // A rental cannot be sold on top of a shared session's footprint.
  if (placement.session_conflict) throw new BookingError("slot_taken");
  if (!placement.within_hours) throw new BookingError("outside_hours");
  if (!staff && placement.too_soon) throw new BookingError("too_soon");
  if (!staff && placement.too_far) throw new BookingError("too_far_ahead");
}
