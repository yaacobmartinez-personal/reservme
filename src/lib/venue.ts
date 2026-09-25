import { sql } from "@/db";

export type PublicVenue = {
  organizationId: string;
  name: string;
  slug: string;
  tagline: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  theme: string;
  logo: string | null;
  coverUrl: string | null;
  cancellationMode: string;
  cancellationGraceHours: number;
  refundTerms: string | null;
  gcashName: string | null;
  /** How far ahead customers may book — the date picker's ceiling. */
  maxHorizonDays: number;
  /** How soon before a slot a customer may still book it — the floor. */
  minNoticeMinutes: number;
  /** Set by a platform admin. A suspended venue takes no new bookings. */
  suspendedAt: Date | null;
};

export type VenueSpace = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  priceCents: number;
  slotMinutes: number;
  bufferMinutes: number;
  capacity: number;
  sortOrder: number;
  imageUrl: string | null;
  /** The highest price any rule charges here, when the space has rules. */
  peakPriceCents: number | null;
};

export async function getVenueBySlug(slug: string): Promise<PublicVenue | null> {
  const [row] = await sql<
    {
      organization_id: string;
      name: string;
      slug: string;
      tagline: string | null;
      address: string | null;
      timezone: string;
      currency: string;
      theme: string;
      logo: string | null;
      cover_url: string | null;
      cancellation_mode: string;
      cancellation_grace_hours: number;
      refund_terms: string | null;
      gcash_name: string | null;
      max_horizon_days: number;
      min_notice_minutes: number;
      suspended_at: Date | null;
    }[]
  >`
    SELECT o.id AS organization_id, o.name, o.slug, o.logo,
           v.tagline, v.address, v.timezone, v.currency, v.theme, v.cover_url,
           v.cancellation_mode, v.cancellation_grace_hours, v.refund_terms,
           v.gcash_name, v.max_horizon_days, v.min_notice_minutes, v.suspended_at
    FROM organization o
    JOIN venue v ON v.organization_id = o.id
    WHERE o.slug = ${slug}
  `;

  if (!row) return null;

  return {
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    tagline: row.tagline,
    address: row.address,
    timezone: row.timezone,
    currency: row.currency,
    theme: row.theme,
    logo: row.logo,
    coverUrl: row.cover_url,
    cancellationMode: row.cancellation_mode,
    cancellationGraceHours: row.cancellation_grace_hours,
    refundTerms: row.refund_terms,
    gcashName: row.gcash_name,
    maxHorizonDays: row.max_horizon_days,
    minNoticeMinutes: row.min_notice_minutes,
    suspendedAt: row.suspended_at,
  };
}

export async function getVenueSpaces(organizationId: string): Promise<VenueSpace[]> {
  const rows = await sql<
    {
      id: string;
      name: string;
      slug: string;
      kind: string;
      price_cents: number;
      slot_minutes: number;
      buffer_minutes: number;
      capacity: number;
      sort_order: number;
      image_url: string | null;
      peak_price_cents: number | null;
    }[]
  >`
    SELECT s.id, s.name, s.slug, s.kind, s.price_cents, s.slot_minutes,
           s.buffer_minutes, s.capacity, s.sort_order, s.image_url,
           (SELECT max(pr.price_cents) FROM pricing_rule pr
             WHERE pr.space_id = s.id AND pr.price_cents > s.price_cents) AS peak_price_cents
    FROM space s
    WHERE s.organization_id = ${organizationId} AND s.is_active = true
    ORDER BY s.sort_order, s.name
  `;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    priceCents: row.price_cents,
    slotMinutes: row.slot_minutes,
    bufferMinutes: row.buffer_minutes,
    capacity: row.capacity,
    sortOrder: row.sort_order,
    imageUrl: row.image_url,
    peakPriceCents: row.peak_price_cents,
  }));
}

/** The next `count` local dates for a venue, starting today in its own zone. */
export async function getLocalDates(timezone: string, count: number, startOffset = 0) {
  const rows = await sql<{ d: string; weekday: string; day: string }[]>`
    SELECT to_char(d, 'YYYY-MM-DD') AS d,
           to_char(d, 'Dy')          AS weekday,
           to_char(d, 'DD')          AS day
    FROM generate_series(
      (now() AT TIME ZONE ${timezone})::date + ${startOffset}::int,
      (now() AT TIME ZONE ${timezone})::date + ${startOffset + count - 1}::int,
      interval '1 day'
    ) AS d
  `;
  return rows;
}

export type DateWindow = {
  /** Today in the venue's timezone (YYYY-MM-DD) — the date picker's floor. */
  today: string;
  /** today + horizon (YYYY-MM-DD) — the date picker's ceiling. */
  maxDate: string;
  /** The chosen day, clamped into [today, maxDate]. */
  activeDate: string;
  /** The visible week strip (up to 7 days, aligned to weeks from today). */
  dates: Awaited<ReturnType<typeof getLocalDates>>;
  /** First day of the previous/next week, or null at the bounds. */
  prevWeekDate: string | null;
  nextWeekDate: string | null;
};

/**
 * A pageable week of dates plus the picker bounds. The strip is aligned to
 * 7-day pages from today so picking a day doesn't scroll it; the customer jumps
 * further out with the prev/next-week controls or the date picker, capped at the
 * venue's booking horizon.
 */
export async function getDateWindow(
  timezone: string,
  horizonDays: number,
  selected?: string,
): Promise<DateWindow> {
  const [{ today, max_date }] = await sql<{ today: string; max_date: string }[]>`
    SELECT to_char((now() AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD') AS today,
           to_char((now() AT TIME ZONE ${timezone})::date + ${horizonDays}::int, 'YYYY-MM-DD') AS max_date
  `;

  const DAY = 86_400_000;
  const base = Date.parse(today); // UTC midnight of the venue-local date
  const iso = (offset: number) => new Date(base + offset * DAY).toISOString().slice(0, 10);

  const rawOffset =
    selected && /^\d{4}-\d{2}-\d{2}$/.test(selected)
      ? Math.round((Date.parse(selected) - base) / DAY)
      : 0;
  const selOffset = Math.max(0, Math.min(horizonDays, rawOffset));
  const weekStart = Math.floor(selOffset / 7) * 7;
  const count = Math.min(7, horizonDays - weekStart + 1);

  return {
    today,
    maxDate: max_date,
    activeDate: iso(selOffset),
    dates: await getLocalDates(timezone, count, weekStart),
    prevWeekDate: weekStart > 0 ? iso(weekStart - 7) : null,
    nextWeekDate: weekStart + 7 <= horizonDays ? iso(weekStart + 7) : null,
  };
}

/** Today's run sheet for the dashboard, in the venue's own timezone. */
export async function getRunSheet(organizationId: string, timezone: string) {
  return await sql<
    {
      id: string;
      reference: string;
      space_name: string;
      customer_name: string | null;
      customer_phone: string | null;
      label: string;
      status: string;
      kind: string;
      party_size: number;
      amount_cents: number;
      checked_in_at: Date | null;
    }[]
  >`
    SELECT r.id, r.reference, s.name AS space_name,
           c.name AS customer_name, c.phone AS customer_phone,
           to_char(r.starts_at AT TIME ZONE ${timezone}, 'HH24:MI')
             || '–' ||
             to_char(r.ends_at AT TIME ZONE ${timezone}, 'HH24:MI') AS label,
           r.status, r.kind, r.party_size, r.amount_cents, r.checked_in_at
    FROM reservation r
    JOIN space s ON s.id = r.space_id
    LEFT JOIN customer c ON c.id = r.customer_id
    WHERE r.organization_id = ${organizationId}
      AND r.status IN ('held', 'confirmed')
      AND r.kind IN ('rental', 'session_seat')
      AND (r.starts_at AT TIME ZONE ${timezone})::date
          = (now() AT TIME ZONE ${timezone})::date
    ORDER BY r.starts_at, s.sort_order
  `;
}

export async function getVenueStats(organizationId: string, timezone: string) {
  const [row] = await sql<
    {
      today_count: string;
      upcoming_count: string;
      active_spaces: string;
      awaiting_payment: string;
      today_revenue_cents: string;
    }[]
  >`
    SELECT
      count(*) FILTER (
        WHERE r.status IN ('held','confirmed')
          AND (r.starts_at AT TIME ZONE ${timezone})::date
              = (now() AT TIME ZONE ${timezone})::date
      )::text AS today_count,
      count(*) FILTER (
        WHERE r.status IN ('held','confirmed') AND r.starts_at > now()
      )::text AS upcoming_count,
      (SELECT count(*) FROM space
        WHERE organization_id = ${organizationId} AND is_active)::text AS active_spaces,
      (SELECT count(*) FROM payment
        WHERE organization_id = ${organizationId} AND status = 'awaiting')::text
        AS awaiting_payment,
      COALESCE(sum(r.amount_cents) FILTER (
        WHERE r.status = 'confirmed'
          AND (r.starts_at AT TIME ZONE ${timezone})::date
              = (now() AT TIME ZONE ${timezone})::date
      ), 0)::text AS today_revenue_cents
    FROM reservation r
    WHERE r.organization_id = ${organizationId}
      AND r.kind IN ('rental', 'session_seat')
  `;

  return {
    todayCount: Number(row.today_count),
    upcomingCount: Number(row.upcoming_count),
    activeSpaces: Number(row.active_spaces),
    awaitingPayment: Number(row.awaiting_payment),
    todayRevenueCents: Number(row.today_revenue_cents),
  };
}
