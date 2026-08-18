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
      suspended_at: Date | null;
    }[]
  >`
    SELECT o.id AS organization_id, o.name, o.slug, o.logo,
           v.tagline, v.address, v.timezone, v.currency, v.theme, v.cover_url,
           v.cancellation_mode, v.cancellation_grace_hours, v.refund_terms,
           v.gcash_name, v.suspended_at
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
    }[]
  >`
    SELECT id, name, slug, kind, price_cents, slot_minutes
    FROM space
    WHERE organization_id = ${organizationId} AND is_active = true
    ORDER BY sort_order, name
  `;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    priceCents: row.price_cents,
    slotMinutes: row.slot_minutes,
  }));
}

/** The next `count` local dates for a venue, starting today in its own zone. */
export async function getLocalDates(timezone: string, count: number) {
  const rows = await sql<{ d: string; weekday: string; day: string }[]>`
    SELECT to_char(d, 'YYYY-MM-DD') AS d,
           to_char(d, 'Dy')          AS weekday,
           to_char(d, 'DD')          AS day
    FROM generate_series(
      (now() AT TIME ZONE ${timezone})::date,
      (now() AT TIME ZONE ${timezone})::date + ${count - 1}::int,
      interval '1 day'
    ) AS d
  `;
  return rows;
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
