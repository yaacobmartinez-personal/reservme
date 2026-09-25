import { sql } from "@/db";

/**
 * The run sheet and its stats (API-CONTRACT #14, #15).
 *
 * A superset of the web's `getRunSheet` / `getVenueStats`, because the phone
 * shows things the dashboard does not: the instants (the app renders them in
 * the venue's own zone rather than trusting a preformatted string), the
 * customer's no-show count and whether this is their first visit — both of
 * which decide how a member greets someone at the counter.
 *
 * Two rules from the web that are easy to lose and expensive to get wrong:
 *
 * - **A block is a closure, never a reservation.** `kind IN ('rental',
 *   'session_seat')` is what keeps "Court 3 — net repair" off the run sheet.
 * - **Today is the venue's today**, computed with `AT TIME ZONE`, not the
 *   server's. A venue in Manila and a server in Virginia disagree about what
 *   day it is for half of every day.
 */

const ENTRY_COLUMNS = sql`
  r.id, r.reference, s.name AS space_name,
  c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone,
  r.starts_at, r.ends_at, r.status, r.kind, r.party_size, r.amount_cents,
  r.checked_in_at,
  COALESCE(c.no_show_count, 0) AS no_show_count,
  ps.title AS session_title, ps.capacity AS session_capacity,
  ps.booked_spots AS session_booked,
  -- Their history here, this booking excluded. A cancelled booking is not a
  -- visit: "2 visits" next to someone who has never turned up reads as a lie.
  (
    SELECT count(*)::int FROM reservation o
    WHERE o.customer_id = c.id
      AND o.organization_id = r.organization_id
      AND o.id <> r.id
      AND o.status <> 'cancelled'
  ) AS previous_visits
`;

type EntryRow = {
  id: string;
  reference: string;
  space_name: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  starts_at: Date;
  ends_at: Date;
  status: string;
  kind: string;
  party_size: number;
  amount_cents: number;
  checked_in_at: Date | null;
  no_show_count: number;
  session_title: string | null;
  session_capacity: number | null;
  session_booked: number | null;
  previous_visits: number;
};

/** "18:00–19:00", in the venue's own zone. An en dash, as the web renders it. */
function label(row: EntryRow, timezone: string): string {
  const at = (when: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(when);
  return `${at(row.starts_at)}–${at(row.ends_at)}`;
}

function entry(row: EntryRow, timezone: string) {
  return {
    id: row.id,
    reference: row.reference,
    spaceName: row.space_name,
    customerId: row.customer_id,
    // An open-play seat has no customer row of its own on the block line, so
    // the session's title stands in — otherwise the row reads as nameless.
    customerName: row.customer_name ?? row.session_title,
    customerPhone: row.customer_phone,
    label: label(row, timezone),
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    status: row.status,
    kind: row.kind,
    partySize: row.party_size,
    amountCents: row.amount_cents,
    checkedInAt: row.checked_in_at?.toISOString() ?? null,
    noShowCount: row.no_show_count,
    firstVisit: row.customer_id !== null && row.previous_visits === 0,
    sessionCapacity: row.session_capacity,
    sessionBooked: row.session_booked,
  };
}

/** One row, for what an action hands back (#15). Null when it is not ours. */
export async function runSheetEntry(organizationId: string, reservationId: string, timezone: string) {
  const [row] = await sql<EntryRow[]>`
    SELECT ${ENTRY_COLUMNS}
    FROM reservation r
    JOIN space s ON s.id = r.space_id
    LEFT JOIN customer c ON c.id = r.customer_id
    LEFT JOIN play_session ps ON ps.id = r.session_id
    WHERE r.id = ${reservationId}::uuid AND r.organization_id = ${organizationId}
  `;
  return row ? entry(row, timezone) : null;
}

/** The whole screen (#14). */
export async function todayView(organizationId: string, timezone: string) {
  const [rows, stats, [{ today }]] = await Promise.all([
    sql<EntryRow[]>`
      SELECT ${ENTRY_COLUMNS}
      FROM reservation r
      JOIN space s ON s.id = r.space_id
      LEFT JOIN customer c ON c.id = r.customer_id
      LEFT JOIN play_session ps ON ps.id = r.session_id
      WHERE r.organization_id = ${organizationId}
        AND r.status IN ('held', 'confirmed')
        AND r.kind IN ('rental', 'session_seat')
        AND (r.starts_at AT TIME ZONE ${timezone})::date
            = (now() AT TIME ZONE ${timezone})::date
      ORDER BY r.starts_at, s.sort_order
    `,
    sql<
      {
        today_count: number;
        checked_in: number;
        upcoming_count: number;
        active_spaces: number;
        total_spaces: number;
        today_revenue_cents: number;
      }[]
    >`
      SELECT
        count(*) FILTER (
          WHERE r.status IN ('held','confirmed')
            AND r.kind IN ('rental','session_seat')
            AND (r.starts_at AT TIME ZONE ${timezone})::date
                = (now() AT TIME ZONE ${timezone})::date
        )::int AS today_count,
        count(*) FILTER (
          WHERE r.status IN ('held','confirmed')
            AND r.kind IN ('rental','session_seat')
            AND r.checked_in_at IS NOT NULL
            AND (r.starts_at AT TIME ZONE ${timezone})::date
                = (now() AT TIME ZONE ${timezone})::date
        )::int AS checked_in,
        count(*) FILTER (
          WHERE r.status IN ('held','confirmed')
            AND r.kind IN ('rental','session_seat')
            AND r.starts_at > now()
        )::int AS upcoming_count,
        (SELECT count(*) FROM space
          WHERE organization_id = ${organizationId} AND is_active)::int AS active_spaces,
        (SELECT count(*) FROM space
          WHERE organization_id = ${organizationId})::int AS total_spaces,
        -- Confirmed only: a held booking is not money yet, and showing it as
        -- today's takings would overstate every morning.
        COALESCE(sum(r.amount_cents) FILTER (
          WHERE r.status = 'confirmed'
            AND r.kind IN ('rental','session_seat')
            AND (r.starts_at AT TIME ZONE ${timezone})::date
                = (now() AT TIME ZONE ${timezone})::date
        ), 0)::int AS today_revenue_cents
      FROM reservation r
      WHERE r.organization_id = ${organizationId}
    `,
    sql<{ today: string }[]>`
      SELECT (now() AT TIME ZONE ${timezone})::date::text AS today
    `,
  ]);

  const s = stats[0];
  return {
    // The venue's date, so the header cannot say Tuesday to a venue having
    // Wednesday.
    date: today,
    stats: {
      todayCount: s?.today_count ?? 0,
      checkedIn: s?.checked_in ?? 0,
      upcomingCount: s?.upcoming_count ?? 0,
      activeSpaces: s?.active_spaces ?? 0,
      totalSpaces: s?.total_spaces ?? 0,
      todayRevenueCents: s?.today_revenue_cents ?? 0,
    },
    runSheet: rows.map((row) => entry(row, timezone)),
  };
}
