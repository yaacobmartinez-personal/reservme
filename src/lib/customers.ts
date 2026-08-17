import { sql } from "@/db";

/**
 * Customers / CRM read layer.
 *
 * Same rules as src/lib/analytics.ts: every query is scoped by organizationId
 * (taken from requireVenue(), never the caller's input), and every "date",
 * "today" and "last visit" is computed in the venue's own timezone via
 * AT TIME ZONE — never UTC bucketing.
 *
 * Money is centavos; lifetime value counts **confirmed** bookings only (a
 * cancelled or no-show booking is not revenue). No-show count is read from the
 * maintained `customer.no_show_count` column, which markNoShow() bumps.
 *
 * The list is one grouped query per page (PM override): a single CTE aggregates
 * reservations by customer, joined to the page of customers, with the total row
 * count carried back via a window function — no per-row round trips.
 */

const BOOKABLE = sql`r.kind IN ('rental','session_seat')`;

export type CustomerSegment = "all" | "new" | "at_risk" | "no_shows";
export type CustomerSort = "recent" | "name" | "bookings" | "value" | "last_visit";

export const PAGE_SIZE = 25;

export type CustomerListRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  tags: string[];
  bookings: number;
  lifetimeValueCents: number;
  noShowCount: number;
  /** Whole days since the last confirmed past booking; null if never visited. */
  lastVisitDays: number | null;
  createdAt: Date;
};

export type CustomerListResult = {
  rows: CustomerListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export type ListOpts = {
  search?: string;
  tag?: string;
  segment?: CustomerSegment;
  sort?: CustomerSort;
  page?: number;
};

/** ORDER BY whitelist — column names can't be bound, so map to fixed fragments. */
function orderBy(sort: CustomerSort) {
  switch (sort) {
    case "name":
      return sql`c.name ASC`;
    case "bookings":
      return sql`bookings DESC, c.name ASC`;
    case "value":
      return sql`ltv_cents DESC, c.name ASC`;
    case "last_visit":
      return sql`last_visit DESC NULLS LAST, c.name ASC`;
    case "recent":
    default:
      return sql`c.created_at DESC`;
  }
}

export async function listCustomers(
  organizationId: string,
  timezone: string,
  opts: ListOpts = {},
): Promise<CustomerListResult> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const offset = (page - 1) * PAGE_SIZE;
  const sort = opts.sort ?? "recent";

  // Build the filter conjunction from fragments so absent filters cost nothing.
  const filters = [sql`c.organization_id = ${organizationId}`];

  const term = opts.search?.trim();
  if (term) {
    const like = `%${term}%`;
    filters.push(
      sql`(c.name ILIKE ${like} OR c.email ILIKE ${like} OR c.phone ILIKE ${like})`,
    );
  }
  if (opts.tag) filters.push(sql`c.tags @> ARRAY[${opts.tag}]::text[]`);

  switch (opts.segment) {
    case "new":
      filters.push(
        sql`(c.created_at AT TIME ZONE ${timezone})::date > (now() AT TIME ZONE ${timezone})::date - 30`,
      );
      break;
    case "at_risk":
      // Has a past confirmed booking, but none in the last 60 days.
      filters.push(
        sql`a.last_visit IS NOT NULL AND (a.last_visit AT TIME ZONE ${timezone})::date < (now() AT TIME ZONE ${timezone})::date - 60`,
      );
      break;
    case "no_shows":
      filters.push(sql`c.no_show_count > 0`);
      break;
    default:
      break;
  }

  const where = filters.reduce((acc, f, i) =>
    i === 0 ? f : sql`${acc} AND ${f}`,
  );

  const rows = await sql<
    {
      id: string;
      name: string;
      email: string;
      phone: string | null;
      tags: string[];
      bookings: number;
      ltv_cents: number;
      no_show_count: number;
      last_visit_days: number | null;
      created_at: Date;
      total: number;
    }[]
  >`
    WITH agg AS (
      SELECT r.customer_id,
        count(*) FILTER (WHERE r.status = 'confirmed' AND ${BOOKABLE})::int AS bookings,
        COALESCE(sum(r.amount_cents) FILTER (
          WHERE r.status = 'confirmed' AND ${BOOKABLE}), 0)::int AS ltv_cents,
        max(r.starts_at) FILTER (
          WHERE r.status = 'confirmed' AND r.starts_at <= now()) AS last_visit
      FROM reservation r
      WHERE r.organization_id = ${organizationId} AND r.customer_id IS NOT NULL
      GROUP BY r.customer_id
    )
    SELECT c.id, c.name, c.email, c.phone, c.tags, c.no_show_count, c.created_at,
      COALESCE(a.bookings, 0)     AS bookings,
      COALESCE(a.ltv_cents, 0)    AS ltv_cents,
      ((now() AT TIME ZONE ${timezone})::date
        - (a.last_visit AT TIME ZONE ${timezone})::date)::int AS last_visit_days,
      (count(*) OVER())::int AS total
    FROM customer c
    LEFT JOIN agg a ON a.customer_id = c.id
    WHERE ${where}
    ORDER BY ${orderBy(sort)}
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `;

  const total = rows[0]?.total ?? 0;
  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      tags: r.tags ?? [],
      bookings: r.bookings,
      lifetimeValueCents: r.ltv_cents,
      noShowCount: r.no_show_count,
      lastVisitDays: r.last_visit_days,
      createdAt: r.created_at,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export type CustomerBooking = {
  id: string;
  spaceName: string;
  whenLabel: string;
  status: string;
  kind: string;
  amountCents: number;
};

export type CustomerNote = {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: Date;
};

export type CustomerProfile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  tags: string[];
  noShowCount: number;
  marketingOptIn: boolean;
  createdAt: Date;
  bookings: number;
  lifetimeValueCents: number;
  lastVisit: Date | null;
  upcoming: CustomerBooking[];
  past: CustomerBooking[];
  notes: CustomerNote[];
};

/** Full profile for one customer, or null if the id isn't in this org. */
export async function getCustomer(
  organizationId: string,
  customerId: string,
  timezone: string,
): Promise<CustomerProfile | null> {
  const [base] = await sql<
    {
      id: string;
      name: string;
      email: string;
      phone: string | null;
      tags: string[];
      no_show_count: number;
      marketing_opt_in: boolean;
      created_at: Date;
      bookings: number;
      ltv_cents: number;
      last_visit: Date | null;
    }[]
  >`
    SELECT c.id, c.name, c.email, c.phone, c.tags, c.no_show_count,
           c.marketing_opt_in, c.created_at,
           COALESCE(count(r.*) FILTER (
             WHERE r.status = 'confirmed' AND ${BOOKABLE}), 0)::int AS bookings,
           COALESCE(sum(r.amount_cents) FILTER (
             WHERE r.status = 'confirmed' AND ${BOOKABLE}), 0)::int AS ltv_cents,
           max(r.starts_at) FILTER (
             WHERE r.status = 'confirmed' AND r.starts_at <= now()) AS last_visit
    FROM customer c
    LEFT JOIN reservation r ON r.customer_id = c.id
    WHERE c.id = ${customerId}::uuid AND c.organization_id = ${organizationId}
    GROUP BY c.id
  `;

  if (!base) return null;

  const [bookings, notes] = await Promise.all([
    sql<
      {
        id: string;
        space_name: string;
        when_label: string;
        status: string;
        kind: string;
        amount_cents: number;
        upcoming: boolean;
      }[]
    >`
      SELECT r.id, s.name AS space_name,
             to_char(r.starts_at AT TIME ZONE ${timezone}, 'Dy DD Mon YYYY, HH24:MI') AS when_label,
             r.status, r.kind, r.amount_cents,
             (r.starts_at > now()) AS upcoming
      FROM reservation r
      JOIN space s ON s.id = r.space_id
      WHERE r.customer_id = ${customerId}::uuid
        AND r.organization_id = ${organizationId}
        AND ${BOOKABLE}
        AND r.status <> 'held'
      ORDER BY r.starts_at DESC
      LIMIT 100
    `,
    sql<
      { id: string; body: string; author_name: string | null; created_at: Date }[]
    >`
      SELECT n.id, n.body, u.name AS author_name, n.created_at
      FROM customer_note n
      LEFT JOIN "user" u ON u.id = n.author_user_id
      WHERE n.customer_id = ${customerId}::uuid
        AND n.organization_id = ${organizationId}
      ORDER BY n.created_at DESC
    `,
  ]);

  const toBooking = (b: (typeof bookings)[number]): CustomerBooking => ({
    id: b.id,
    spaceName: b.space_name,
    whenLabel: b.when_label,
    status: b.status,
    kind: b.kind,
    amountCents: b.amount_cents,
  });

  return {
    id: base.id,
    name: base.name,
    email: base.email,
    phone: base.phone,
    tags: base.tags ?? [],
    noShowCount: base.no_show_count,
    marketingOptIn: base.marketing_opt_in,
    createdAt: base.created_at,
    bookings: base.bookings,
    lifetimeValueCents: base.ltv_cents,
    lastVisit: base.last_visit,
    // upcoming comes back newest-first from the DESC sort; flip it so the next
    // booking reads top-down chronologically.
    upcoming: bookings.filter((b) => b.upcoming).reverse().map(toBooking),
    past: bookings.filter((b) => !b.upcoming).map(toBooking),
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      authorName: n.author_name,
      createdAt: n.created_at,
    })),
  };
}

/** Distinct tags in use across the org, for the list's filter dropdown. */
export async function customerFacets(organizationId: string): Promise<string[]> {
  const rows = await sql<{ tag: string }[]>`
    SELECT DISTINCT unnest(tags) AS tag
    FROM customer
    WHERE organization_id = ${organizationId}
    ORDER BY tag
  `;
  return rows.map((r) => r.tag);
}
