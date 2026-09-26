import { sql } from "@/db";

/**
 * Dashboard analytics. Every bucket, hour, and "today" is computed in the
 * venue's own timezone (AT TIME ZONE), never UTC — same rule as getRunSheet.
 *
 * Money is centavos throughout; format in the component. In the pay-at-venue
 * model `amount_cents` on a confirmed reservation is *booked value*, not
 * collected cash — the UI labels it accordingly.
 *
 * Kinds: 'rental' and 'session_seat' are what customers book (counts, value);
 * 'rental' and 'session_block' are what occupy the space (utilisation).
 */

export type RangeKey = "today" | "7d" | "30d" | "90d";

export const RANGES: { key: RangeKey; label: string; days: number }[] = [
  { key: "today", label: "Today", days: 1 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
];

export function rangeDays(key: string | undefined): { key: RangeKey; days: number } {
  const found = RANGES.find((r) => r.key === key);
  return found ? { key: found.key, days: found.days } : { key: "30d", days: 30 };
}

export type Kpi = {
  value: number;
  previous: number;
  deltaPct: number | null; // null when previous is 0 (no baseline)
  series: number[]; // per-day, current window
};

export type DashboardData = {
  days: number;
  kpis: {
    bookedValueCents: Kpi;
    bookings: Kpi;
    utilisationPct: Kpi;
    noShowRatePct: Kpi;
  };
  revenueSeries: { day: string; cents: number }[];
  utilisationSeries: { day: string; pct: number }[];
  peakHeatmap: number[][]; // [dow 0-6][hour 0-23] = booking count
  bookingMix: { confirmed: number; cancelled: number; noShow: number };
  bySpace: { spaceId: string; name: string; cents: number }[];
  customers: {
    newCount: number;
    returningCount: number;
    repeatRatePct: number;
    top: { customerId: string; name: string; bookings: number }[];
  };
  needsYou: {
    awaitingPayments: { count: number; cents: number };
    halfEmptySessions: {
      id: string;
      title: string;
      label: string;
      startsAt: Date;
      left: number;
      capacity: number;
    }[];
    toCheckIn: number;
  };
};

type DailyRow = {
  day: string;
  booked_cents: number;
  confirmed: number;
  cancelled: number;
  no_show: number;
  booked_hours: number;
};
type BookableRow = { day: string; bookable_hours: number };

function delta(value: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((value - previous) / previous) * 1000) / 10;
}

export async function getDashboard(
  organizationId: string,
  timezone: string,
  days: number,
): Promise<DashboardData> {
  const span = days * 2; // current + previous window for deltas

  const [daily, bookable, heatmap, mix, spaces, cust, awaiting, sessions, checkins] =
    await Promise.all([
      // ── per-day counts / value / booked-hours over the 2× window ──
      sql<DailyRow[]>`
        WITH d AS (
          SELECT generate_series(
            (now() AT TIME ZONE ${timezone})::date - ${span - 1}::int,
            (now() AT TIME ZONE ${timezone})::date,
            interval '1 day')::date AS day
        )
        SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
          COALESCE(sum(r.amount_cents) FILTER (
            WHERE r.status='confirmed' AND r.kind IN ('rental','session_seat')),0)::int AS booked_cents,
          count(r.*) FILTER (
            WHERE r.status='confirmed' AND r.kind IN ('rental','session_seat'))::int AS confirmed,
          count(r.*) FILTER (
            WHERE r.status='cancelled' AND r.kind IN ('rental','session_seat'))::int AS cancelled,
          count(r.*) FILTER (
            WHERE r.status='no_show' AND r.kind IN ('rental','session_seat'))::int AS no_show,
          COALESCE(sum(EXTRACT(EPOCH FROM (r.ends_at - r.starts_at))/3600) FILTER (
            WHERE r.status='confirmed' AND r.kind IN ('rental','session_block')),0)::float AS booked_hours
        FROM d
        LEFT JOIN reservation r
          ON r.organization_id = ${organizationId}
         AND (r.starts_at AT TIME ZONE ${timezone})::date = d.day
        GROUP BY d.day ORDER BY d.day
      `,
      // ── bookable hours per day from opening hours (ignores closures) ──
      sql<BookableRow[]>`
        WITH d AS (
          SELECT generate_series(
            (now() AT TIME ZONE ${timezone})::date - ${span - 1}::int,
            (now() AT TIME ZONE ${timezone})::date,
            interval '1 day')::date AS day
        )
        SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
          COALESCE(sum(EXTRACT(EPOCH FROM (oh.closes_at - oh.opens_at))/3600),0)::float AS bookable_hours
        FROM d
        LEFT JOIN space s ON s.organization_id = ${organizationId} AND s.is_active
        LEFT JOIN opening_hours oh ON oh.space_id = s.id
          AND oh.weekday = EXTRACT(DOW FROM d.day)::int
        GROUP BY d.day ORDER BY d.day
      `,
      // ── peak heatmap (current window) ──
      sql<{ dow: number; hour: number; n: number }[]>`
        SELECT EXTRACT(DOW  FROM r.starts_at AT TIME ZONE ${timezone})::int AS dow,
               EXTRACT(HOUR FROM r.starts_at AT TIME ZONE ${timezone})::int AS hour,
               count(*)::int AS n
        FROM reservation r
        WHERE r.organization_id = ${organizationId}
          AND r.status IN ('confirmed','no_show')
          AND r.kind IN ('rental','session_seat')
          AND (r.starts_at AT TIME ZONE ${timezone})::date
              > (now() AT TIME ZONE ${timezone})::date - ${days}::int
        GROUP BY dow, hour
      `,
      // ── booking mix (current window) ──
      sql<{ status: string; n: number }[]>`
        SELECT r.status, count(*)::int AS n
        FROM reservation r
        WHERE r.organization_id = ${organizationId}
          AND r.kind IN ('rental','session_seat')
          AND r.status IN ('confirmed','cancelled','no_show')
          AND (r.starts_at AT TIME ZONE ${timezone})::date
              > (now() AT TIME ZONE ${timezone})::date - ${days}::int
        GROUP BY r.status
      `,
      // ── booked value by space (current window) ──
      sql<{ space_id: string; name: string; cents: number }[]>`
        SELECT s.id AS space_id, s.name, COALESCE(sum(r.amount_cents),0)::int AS cents
        FROM space s
        LEFT JOIN reservation r
          ON r.space_id = s.id AND r.status='confirmed'
         AND r.kind IN ('rental','session_seat')
         AND (r.starts_at AT TIME ZONE ${timezone})::date
             > (now() AT TIME ZONE ${timezone})::date - ${days}::int
        WHERE s.organization_id = ${organizationId}
        GROUP BY s.id, s.name ORDER BY cents DESC
      `,
      // ── customers: new / returning / top (current window) ──
      sql<
        {
          new_count: number;
          returning_count: number;
          total_booked: number;
          top: { customerId: string; name: string; bookings: number }[];
        }[]
      >`
        WITH booked AS (
          SELECT r.customer_id, count(*)::int AS n
          FROM reservation r
          WHERE r.organization_id = ${organizationId}
            AND r.status='confirmed' AND r.kind IN ('rental','session_seat')
            AND r.customer_id IS NOT NULL
            AND (r.starts_at AT TIME ZONE ${timezone})::date
                > (now() AT TIME ZONE ${timezone})::date - ${days}::int
          GROUP BY r.customer_id
        ),
        prior AS (
          SELECT DISTINCT r.customer_id
          FROM reservation r
          WHERE r.organization_id = ${organizationId}
            AND r.status='confirmed'
            AND (r.starts_at AT TIME ZONE ${timezone})::date
                <= (now() AT TIME ZONE ${timezone})::date - ${days}::int
        )
        SELECT
          (SELECT count(*)::int FROM customer c
            WHERE c.organization_id = ${organizationId}
              AND (c.created_at AT TIME ZONE ${timezone})::date
                  > (now() AT TIME ZONE ${timezone})::date - ${days}::int) AS new_count,
          (SELECT count(*)::int FROM booked b WHERE b.customer_id IN (SELECT customer_id FROM prior)) AS returning_count,
          (SELECT count(*)::int FROM booked) AS total_booked,
          COALESCE((
            SELECT json_agg(t) FROM (
              SELECT c.id AS "customerId", c.name, b.n AS bookings
              FROM booked b JOIN customer c ON c.id = b.customer_id
              ORDER BY b.n DESC, c.name LIMIT 5
            ) t
          ), '[]'::json) AS top
      `,
      // ── needs you: awaiting payments ──
      sql<{ count: number; cents: number }[]>`
        SELECT count(*)::int AS count, COALESCE(sum(amount_cents),0)::int AS cents
        FROM payment
        WHERE organization_id = ${organizationId} AND status='awaiting'
      `,
      // ── needs you: half-empty upcoming sessions ──
      sql<
        {
          id: string;
          title: string;
          label: string;
          starts_at: Date;
          left: number;
          capacity: number;
        }[]
      >`
        SELECT ps.id, ps.title, ps.starts_at,
          to_char(ps.starts_at AT TIME ZONE ${timezone}, 'Dy DD Mon HH24:MI') AS label,
          (ps.capacity - ps.booked_spots) AS left, ps.capacity
        FROM play_session ps
        WHERE ps.organization_id = ${organizationId}
          AND ps.cancelled = false
          AND ps.starts_at > now()
          AND ps.booked_spots * 2 < ps.capacity
        ORDER BY ps.starts_at LIMIT 5
      `,
      // ── needs you: today's confirmed not yet checked in ──
      sql<{ n: number }[]>`
        SELECT count(*)::int AS n
        FROM reservation r
        WHERE r.organization_id = ${organizationId}
          AND r.status='confirmed' AND r.kind IN ('rental','session_seat')
          AND r.checked_in_at IS NULL
          AND (r.starts_at AT TIME ZONE ${timezone})::date
              = (now() AT TIME ZONE ${timezone})::date
      `,
    ]);

  // Merge daily + bookable by day, split current / previous windows.
  const bookableByDay = new Map(bookable.map((b) => [b.day, b.bookable_hours]));
  const merged = daily.map((r) => ({
    ...r,
    bookable_hours: bookableByDay.get(r.day) ?? 0,
  }));
  const current = merged.slice(days); // last `days`
  const previous = merged.slice(0, days);

  const sum = (rows: typeof merged, pick: (r: (typeof merged)[number]) => number) =>
    rows.reduce((t, r) => t + pick(r), 0);

  const curValue = sum(current, (r) => r.booked_cents);
  const prevValue = sum(previous, (r) => r.booked_cents);
  const curBookings = sum(current, (r) => r.confirmed);
  const prevBookings = sum(previous, (r) => r.confirmed);

  const utilPct = (rows: typeof merged) => {
    const b = sum(rows, (r) => r.booked_hours);
    const cap = sum(rows, (r) => r.bookable_hours);
    return cap > 0 ? Math.min(100, Math.round((b / cap) * 1000) / 10) : 0;
  };
  const noShowPct = (rows: typeof merged) => {
    const ns = sum(rows, (r) => r.no_show);
    const denom = sum(rows, (r) => r.confirmed) + ns;
    return denom > 0 ? Math.round((ns / denom) * 1000) / 10 : 0;
  };

  const curUtil = utilPct(current);
  const curNoShow = noShowPct(current);

  const heat: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const h of heatmap) heat[h.dow][h.hour] = h.n;

  const mixMap = new Map(mix.map((m) => [m.status, m.n]));
  const custRow = cust[0];
  const returningCount = custRow?.returning_count ?? 0;
  const totalBooked = custRow?.total_booked ?? 0;

  return {
    days,
    kpis: {
      bookedValueCents: {
        value: curValue,
        previous: prevValue,
        deltaPct: delta(curValue, prevValue),
        series: current.map((r) => r.booked_cents),
      },
      bookings: {
        value: curBookings,
        previous: prevBookings,
        deltaPct: delta(curBookings, prevBookings),
        series: current.map((r) => r.confirmed),
      },
      utilisationPct: {
        value: curUtil,
        previous: utilPct(previous),
        deltaPct: delta(curUtil, utilPct(previous)),
        series: current.map((r) =>
          r.bookable_hours > 0
            ? Math.min(100, Math.round((r.booked_hours / r.bookable_hours) * 1000) / 10)
            : 0,
        ),
      },
      noShowRatePct: {
        value: curNoShow,
        previous: noShowPct(previous),
        deltaPct: delta(curNoShow, noShowPct(previous)),
        series: current.map((r) => {
          const denom = r.confirmed + r.no_show;
          return denom > 0 ? Math.round((r.no_show / denom) * 1000) / 10 : 0;
        }),
      },
    },
    revenueSeries: current.map((r) => ({ day: r.day, cents: r.booked_cents })),
    utilisationSeries: current.map((r) => ({
      day: r.day,
      pct:
        r.bookable_hours > 0
          ? Math.min(100, Math.round((r.booked_hours / r.bookable_hours) * 1000) / 10)
          : 0,
    })),
    peakHeatmap: heat,
    bookingMix: {
      confirmed: mixMap.get("confirmed") ?? 0,
      cancelled: mixMap.get("cancelled") ?? 0,
      noShow: mixMap.get("no_show") ?? 0,
    },
    bySpace: spaces.map((s) => ({ spaceId: s.space_id, name: s.name, cents: s.cents })),
    customers: {
      newCount: custRow?.new_count ?? 0,
      returningCount,
      repeatRatePct: totalBooked > 0 ? Math.round((returningCount / totalBooked) * 100) : 0,
      top: custRow?.top ?? [],
    },
    needsYou: {
      awaitingPayments: { count: awaiting[0]?.count ?? 0, cents: awaiting[0]?.cents ?? 0 },
      halfEmptySessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        label: s.label,
        startsAt: s.starts_at,
        left: s.left,
        capacity: s.capacity,
      })),
      toCheckIn: checkins[0]?.n ?? 0,
    },
  };
}
