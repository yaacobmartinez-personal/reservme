import { sql } from "@/db";

/**
 * Multi-location. The org model already lets a user belong to several
 * organizations (each org = one venue); this reads the set they belong to and
 * rolls up their numbers. Each venue stays its own isolated tenant — this only
 * aggregates for the owner's own view.
 */

export type UserVenue = {
  organizationId: string;
  name: string;
  slug: string;
  role: string;
};

export async function listUserVenues(userId: string): Promise<UserVenue[]> {
  const rows = await sql<{ organization_id: string; name: string; slug: string; role: string }[]>`
    SELECT o.id AS organization_id, o.name, o.slug, m.role
    FROM member m
    JOIN organization o ON o.id = m.organization_id
    JOIN venue v        ON v.organization_id = o.id
    WHERE m.user_id = ${userId}
    ORDER BY o.created_at
  `;
  return rows.map((r) => ({
    organizationId: r.organization_id,
    name: r.name,
    slug: r.slug,
    role: r.role,
  }));
}

export type PortfolioVenue = {
  organizationId: string;
  name: string;
  slug: string;
  activeSpaces: number;
  upcoming: number;
  bookings30: number;
  revenue30Cents: number;
};

export type Portfolio = {
  venues: PortfolioVenue[];
  totals: { venues: number; upcoming: number; bookings30: number; revenue30Cents: number };
};

export async function portfolioRollup(userId: string): Promise<Portfolio> {
  const rows = await sql<
    {
      organization_id: string;
      name: string;
      slug: string;
      active_spaces: number;
      upcoming: number;
      bookings_30: number;
      revenue_30: number;
    }[]
  >`
    SELECT o.id AS organization_id, o.name, o.slug,
      (SELECT count(*)::int FROM space s
        WHERE s.organization_id = o.id AND s.is_active) AS active_spaces,
      (SELECT count(*)::int FROM reservation r
        WHERE r.organization_id = o.id AND r.status IN ('held','confirmed')
          AND r.kind IN ('rental','session_seat') AND r.starts_at > now()) AS upcoming,
      (SELECT count(*)::int FROM reservation r
        WHERE r.organization_id = o.id AND r.kind IN ('rental','session_seat')
          AND r.created_at > now() - interval '30 days') AS bookings_30,
      (SELECT COALESCE(sum(r.amount_cents), 0)::int FROM reservation r
        WHERE r.organization_id = o.id AND r.status = 'confirmed'
          AND r.created_at > now() - interval '30 days') AS revenue_30
    FROM member m
    JOIN organization o ON o.id = m.organization_id
    JOIN venue v        ON v.organization_id = o.id
    WHERE m.user_id = ${userId}
    ORDER BY o.created_at
  `;

  const venues: PortfolioVenue[] = rows.map((r) => ({
    organizationId: r.organization_id,
    name: r.name,
    slug: r.slug,
    activeSpaces: r.active_spaces,
    upcoming: r.upcoming,
    bookings30: r.bookings_30,
    revenue30Cents: r.revenue_30,
  }));

  return {
    venues,
    totals: {
      venues: venues.length,
      upcoming: venues.reduce((t, v) => t + v.upcoming, 0),
      bookings30: venues.reduce((t, v) => t + v.bookings30, 0),
      revenue30Cents: venues.reduce((t, v) => t + v.revenue30Cents, 0),
    },
  };
}
