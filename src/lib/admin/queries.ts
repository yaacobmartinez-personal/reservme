import { sql } from "@/db";
import { PLANS, planForSpaces } from "@/content/marketing";

export type TenantRow = {
  organizationId: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  createdAt: Date;
  suspendedAt: Date | null;
  suspendedReason: string | null;
  activeSpaces: number;
  memberCount: number;
  upcomingBookings: number;
  bookingsLast30: number;
  revenueLast30Cents: number;
  /** Derived from active space count — the same bands the pricing page sells. */
  band: { name: string; price: number | null };
};

function withBand(activeSpaces: number) {
  const plan = activeSpaces === 0 ? PLANS[0] : planForSpaces(activeSpaces);
  return { name: plan.name, price: plan.price };
}

export async function listTenants(): Promise<TenantRow[]> {
  const rows = await sql<
    {
      organization_id: string;
      name: string;
      slug: string;
      timezone: string;
      currency: string;
      created_at: Date;
      suspended_at: Date | null;
      suspended_reason: string | null;
      active_spaces: number;
      member_count: number;
      upcoming_bookings: number;
      bookings_last_30: number;
      revenue_last_30_cents: number;
    }[]
  >`
    SELECT
      o.id AS organization_id, o.name, o.slug, o.created_at,
      v.timezone, v.currency, v.suspended_at, v.suspended_reason,
      (SELECT count(*)::int FROM space s
        WHERE s.organization_id = o.id AND s.is_active) AS active_spaces,
      (SELECT count(*)::int FROM member m
        WHERE m.organization_id = o.id) AS member_count,
      (SELECT count(*)::int FROM reservation r
        WHERE r.organization_id = o.id
          AND r.status IN ('held','confirmed')
          AND r.kind IN ('rental','session_seat')
          AND r.starts_at > now()) AS upcoming_bookings,
      (SELECT count(*)::int FROM reservation r
        WHERE r.organization_id = o.id
          AND r.kind IN ('rental','session_seat')
          AND r.created_at > now() - interval '30 days') AS bookings_last_30,
      (SELECT COALESCE(sum(r.amount_cents), 0)::int FROM reservation r
        WHERE r.organization_id = o.id
          AND r.status = 'confirmed'
          AND r.created_at > now() - interval '30 days') AS revenue_last_30_cents
    FROM organization o
    JOIN venue v ON v.organization_id = o.id
    ORDER BY v.suspended_at NULLS FIRST, o.created_at DESC
  `;

  return rows.map((row) => ({
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    currency: row.currency,
    createdAt: row.created_at,
    suspendedAt: row.suspended_at,
    suspendedReason: row.suspended_reason,
    activeSpaces: row.active_spaces,
    memberCount: row.member_count,
    upcomingBookings: row.upcoming_bookings,
    bookingsLast30: row.bookings_last_30,
    revenueLast30Cents: row.revenue_last_30_cents,
    band: withBand(row.active_spaces),
  }));
}

export async function getTenant(organizationId: string) {
  const [tenant] = (await listTenants()).filter(
    (row) => row.organizationId === organizationId,
  );
  if (!tenant) return null;

  const [spaces, members, recentBookings] = await Promise.all([
    sql<
      { id: string; name: string; kind: string; price_cents: number; is_active: boolean }[]
    >`
      SELECT id, name, kind, price_cents, is_active
      FROM space WHERE organization_id = ${organizationId}
      ORDER BY sort_order, name
    `,
    sql<{ name: string; email: string; role: string; created_at: Date }[]>`
      SELECT u.name, u.email, m.role, m.created_at
      FROM member m JOIN "user" u ON u.id = m.user_id
      WHERE m.organization_id = ${organizationId}
      ORDER BY m.created_at
    `,
    sql<
      {
        reference: string;
        status: string;
        space_name: string;
        customer_name: string | null;
        label: string;
        amount_cents: number;
      }[]
    >`
      SELECT r.reference, r.status, s.name AS space_name,
             c.name AS customer_name,
             to_char(r.starts_at AT TIME ZONE ${tenant.timezone}, 'DD Mon HH24:MI') AS label,
             r.amount_cents
      FROM reservation r
      JOIN space s ON s.id = r.space_id
      LEFT JOIN customer c ON c.id = r.customer_id
      WHERE r.organization_id = ${organizationId}
        AND r.kind IN ('rental','session_seat')
      ORDER BY r.created_at DESC
      LIMIT 15
    `,
  ]);

  return { tenant, spaces, members, recentBookings };
}

export async function platformTotals() {
  const [row] = await sql<
    {
      tenants: number;
      suspended: number;
      spaces: number;
      bookings_30: number;
      customers: number;
    }[]
  >`
    SELECT
      (SELECT count(*)::int FROM organization) AS tenants,
      (SELECT count(*)::int FROM venue WHERE suspended_at IS NOT NULL) AS suspended,
      (SELECT count(*)::int FROM space WHERE is_active) AS spaces,
      (SELECT count(*)::int FROM reservation
        WHERE created_at > now() - interval '30 days'
          AND kind IN ('rental','session_seat')) AS bookings_30,
      (SELECT count(*)::int FROM customer) AS customers
  `;
  return row;
}

/** What we would bill this month if every tenant were charged their band today. */
export async function monthlyRunRate(tenants: TenantRow[]) {
  return tenants
    .filter((tenant) => !tenant.suspendedAt)
    .reduce((total, tenant) => total + (tenant.band.price ?? 0), 0);
}
