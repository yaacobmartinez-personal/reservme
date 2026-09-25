import { sql } from "@/db";

/**
 * The wire shapes for spaces and venue settings (API-CONTRACT #24, #28, #30).
 *
 * One place, because every write returns the whole object back: the app's
 * controllers replace their state with what the server says rather than
 * guessing what changed, so a PATCH that returned a different shape from a GET
 * would show as a screen that half-updates.
 */

export type SpaceRow = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  capacity: number;
  slot_minutes: number;
  buffer_minutes: number;
  price_cents: number;
  is_active: boolean;
  image_url: string | null;
};

/** Live bookings still ahead of now, per space — what a delete would strand. */
async function upcomingBySpace(organizationId: string): Promise<Map<string, number>> {
  const rows = await sql<{ space_id: string; n: number }[]>`
    SELECT space_id, count(*)::int AS n
    FROM reservation
    WHERE organization_id = ${organizationId}
      AND status IN ('held', 'confirmed')
      AND kind IN ('rental', 'session_seat')
      AND starts_at > now()
    GROUP BY space_id
  `;
  return new Map(rows.map((r) => [r.space_id, r.n]));
}

/**
 * The list (#24). `peakPriceCents` is the highest a rule charges when it beats
 * the base price — the card says "from ₱X" only when there is a higher X.
 */
export async function spaceSummaries(organizationId: string) {
  const [spaces, upcoming] = await Promise.all([
    sql<(SpaceRow & { peak_price_cents: number | null; session_count: number })[]>`
      SELECT s.*,
             (SELECT max(p.price_cents) FROM pricing_rule p WHERE p.space_id = s.id)
               AS peak_price_cents,
             (SELECT count(*)::int FROM play_session ps
               WHERE ps.space_id = s.id AND NOT ps.cancelled AND ps.starts_at > now())
               AS session_count
      FROM space s
      WHERE s.organization_id = ${organizationId}
      ORDER BY s.sort_order, s.name
    `,
    upcomingBySpace(organizationId),
  ]);

  return spaces.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    slotMinutes: s.slot_minutes,
    priceCents: s.price_cents,
    peakPriceCents:
      s.peak_price_cents != null && s.peak_price_cents > s.price_cents ? s.peak_price_cents : null,
    isActive: s.is_active,
    imageUrl: s.image_url,
    sessionSummary:
      s.session_count > 0
        ? `${s.session_count} open play ${s.session_count === 1 ? "session" : "sessions"} ahead`
        : null,
    upcomingBookings: upcoming.get(s.id) ?? 0,
  }));
}

/** The editor (#28). Null when the space is not this venue's. */
export async function spaceDetail(organizationId: string, spaceId: string) {
  const [space] = await sql<SpaceRow[]>`
    SELECT * FROM space
    WHERE id = ${spaceId}::uuid AND organization_id = ${organizationId}
  `;
  if (!space) return null;

  const [hours, rules, closures, sessions, upcoming] = await Promise.all([
    sql<{ weekday: number; opens_at: string; closes_at: string }[]>`
      SELECT weekday, opens_at::text, closes_at::text
      FROM opening_hours WHERE space_id = ${spaceId}::uuid ORDER BY weekday
    `,
    sql<{
      id: string;
      label: string | null;
      weekdays: number[];
      starts_at: string;
      ends_at: string;
      price_cents: number;
    }[]>`
      SELECT id, label, weekdays, starts_at::text, ends_at::text, price_cents
      FROM pricing_rule WHERE space_id = ${spaceId}::uuid ORDER BY starts_at
    `,
    // A venue-wide closure (space_id NULL) shuts this space too, so the editor
    // has to show it — otherwise the owner sees an open day that is not.
    sql<{
      id: string;
      space_id: string | null;
      space_name: string | null;
      starts_at: Date;
      ends_at: Date;
      reason: string | null;
    }[]>`
      SELECT c.id, c.space_id, s.name AS space_name, c.starts_at, c.ends_at, c.reason
      FROM closure c
      LEFT JOIN space s ON s.id = c.space_id
      WHERE c.organization_id = ${organizationId}
        AND (c.space_id = ${spaceId}::uuid OR c.space_id IS NULL)
        AND c.ends_at > now()
      ORDER BY c.starts_at
    `,
    sql<{
      id: string;
      title: string;
      starts_at: Date;
      ends_at: Date;
      capacity: number;
      booked_spots: number;
      cancelled: boolean;
    }[]>`
      SELECT id, title, starts_at, ends_at, capacity, booked_spots, cancelled
      FROM play_session
      WHERE space_id = ${spaceId}::uuid AND ends_at > now()
      ORDER BY starts_at
    `,
    upcomingBySpace(organizationId),
  ]);

  return {
    id: space.id,
    name: space.name,
    slug: space.slug,
    kind: space.kind,
    capacity: space.capacity,
    slotMinutes: space.slot_minutes,
    bufferMinutes: space.buffer_minutes,
    priceCents: space.price_cents,
    isActive: space.is_active,
    imageUrl: space.image_url,
    // A closed day is an absent row, never a row with a flag — that is what
    // `setOpeningHours` writes and what availability reads.
    hours: hours.map((h) => ({
      weekday: h.weekday,
      opensAt: h.opens_at.slice(0, 5),
      closesAt: h.closes_at.slice(0, 5),
    })),
    pricingRules: rules.map((r) => ({
      id: r.id,
      label: r.label,
      weekdays: r.weekdays,
      startsAt: r.starts_at.slice(0, 5),
      endsAt: r.ends_at.slice(0, 5),
      priceCents: r.price_cents,
    })),
    closures: closures.map((c) => ({
      id: c.id,
      spaceId: c.space_id,
      spaceName: c.space_name,
      startsAt: c.starts_at.toISOString(),
      endsAt: c.ends_at.toISOString(),
      reason: c.reason,
    })),
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      startsAt: s.starts_at.toISOString(),
      endsAt: s.ends_at.toISOString(),
      capacity: s.capacity,
      bookedSpots: s.booked_spots,
      cancelled: s.cancelled,
    })),
    upcomingBookings: upcoming.get(space.id) ?? 0,
  };
}

/**
 * Venue settings (#30), including the suspension the whole app reads.
 *
 * Deliberately a **superset** of two shapes, because one endpoint serves two
 * callers that parse it differently: the settings screen reads it as
 * `VenueSettings`, and onboarding's "go live" reads the very same field as a
 * `VenueMembership` — which needs `orgId`, `role` and `activeSpaces`, none of
 * which settings cares about. Returning only one shape made the PATCH answer
 * 200 and the app say "Something went wrong", because the parse threw.
 *
 * Both models ignore keys they do not know, so one object satisfies both. If a
 * third caller appears, add its fields here rather than branching on who asked.
 */
export async function venueSettings(organizationId: string, role?: string) {
  const [row] = await sql<
    {
      slug: string;
      name: string;
      logo: string | null;
      tagline: string | null;
      address: string | null;
      timezone: string;
      currency: string;
      theme: string;
      cover_url: string | null;
      min_notice_minutes: number;
      max_horizon_days: number;
      cancellation_mode: string;
      cancellation_grace_hours: number;
      refund_terms: string | null;
      gcash_name: string | null;
      suspended_at: Date | null;
      suspended_reason: string | null;
    }[]
  >`
    SELECT o.slug, o.name, o.logo, v.tagline, v.address, v.timezone, v.currency,
           v.theme, v.cover_url, v.min_notice_minutes, v.max_horizon_days,
           v.cancellation_mode, v.cancellation_grace_hours, v.refund_terms,
           v.gcash_name, v.suspended_at, v.suspended_reason
    FROM organization o
    JOIN venue v ON v.organization_id = o.id
    WHERE o.id = ${organizationId}
  `;
  if (!row) return null;

  const [{ active_spaces: activeSpaces }] = await sql<{ active_spaces: number }[]>`
    SELECT count(*)::int AS active_spaces
    FROM space WHERE organization_id = ${organizationId} AND is_active
  `;

  return {
    // For VenueMembership (onboarding's go-live); ignored by VenueSettings.
    orgId: organizationId,
    role: role ?? "owner",
    activeSpaces,

    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    address: row.address,
    timezone: row.timezone,
    currency: row.currency,
    theme: row.theme,
    logoUrl: row.logo,
    coverUrl: row.cover_url,
    minNoticeMinutes: row.min_notice_minutes,
    maxHorizonDays: row.max_horizon_days,
    cancellationMode: row.cancellation_mode,
    cancellationGraceHours: row.cancellation_grace_hours,
    refundTerms: row.refund_terms,
    gcashName: row.gcash_name,
    suspended: row.suspended_at !== null,
    suspendedReason: row.suspended_reason,
  };
}
