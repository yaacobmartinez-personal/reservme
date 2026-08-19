import { sql } from "@/db";

/**
 * CSV export for owners — get bookings and customers out of the product. Values
 * are RFC 4180 escaped; everything is rendered in the venue's own timezone.
 */

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const esc = (value: string | number | null): string => {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(",")];
  for (const row of rows) lines.push(row.map(esc).join(","));
  // \r\n line endings + a trailing newline: what spreadsheets expect.
  return lines.join("\r\n") + "\r\n";
}

export async function customersCsv(organizationId: string, timezone: string): Promise<string> {
  const rows = await sql<
    {
      name: string;
      email: string;
      phone: string | null;
      bookings: number;
      ltv_cents: number;
      no_show_count: number;
      tags: string | null;
      joined: string;
    }[]
  >`
    SELECT c.name, c.email, c.phone, c.no_show_count,
      to_char(c.created_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS joined,
      array_to_string(c.tags, '; ') AS tags,
      (SELECT count(*)::int FROM reservation r
        WHERE r.customer_id = c.id AND r.status = 'confirmed'
          AND r.kind IN ('rental','session_seat')) AS bookings,
      (SELECT COALESCE(sum(r.amount_cents), 0)::int FROM reservation r
        WHERE r.customer_id = c.id AND r.status = 'confirmed'
          AND r.kind IN ('rental','session_seat')) AS ltv_cents
    FROM customer c
    WHERE c.organization_id = ${organizationId}
    ORDER BY c.name
  `;
  return toCsv(
    ["Name", "Email", "Phone", "Bookings", "Lifetime value", "No-shows", "Tags", "Joined"],
    rows.map((r) => [
      r.name,
      r.email,
      r.phone,
      r.bookings,
      (r.ltv_cents / 100).toFixed(2),
      r.no_show_count,
      r.tags,
      r.joined,
    ]),
  );
}

export async function bookingsCsv(organizationId: string, timezone: string): Promise<string> {
  const rows = await sql<
    {
      reference: string;
      space: string;
      customer: string | null;
      email: string | null;
      start: string;
      finish: string;
      status: string;
      kind: string;
      party_size: number;
      amount_cents: number;
    }[]
  >`
    SELECT r.reference, s.name AS space, c.name AS customer, c.email,
      to_char(r.starts_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD HH24:MI') AS start,
      to_char(r.ends_at   AT TIME ZONE ${timezone}, 'YYYY-MM-DD HH24:MI') AS finish,
      r.status, r.kind, r.party_size, r.amount_cents
    FROM reservation r
    JOIN space s ON s.id = r.space_id
    LEFT JOIN customer c ON c.id = r.customer_id
    WHERE r.organization_id = ${organizationId}
      AND r.kind IN ('rental','session_seat')
    ORDER BY r.starts_at DESC
    LIMIT 5000
  `;
  return toCsv(
    ["Reference", "Space", "Customer", "Email", "Start", "End", "Status", "Kind", "Party", "Amount"],
    rows.map((r) => [
      r.reference,
      r.space,
      r.customer ?? "Walk-in",
      r.email,
      r.start,
      r.finish,
      r.status,
      r.kind,
      r.party_size,
      (r.amount_cents / 100).toFixed(2),
    ]),
  );
}

/**
 * Finance-oriented export for accounting: per booking, the gross price, the
 * total discount applied (promo + membership), and the net charged.
 */
export async function transactionsCsv(
  organizationId: string,
  timezone: string,
): Promise<string> {
  const rows = await sql<
    {
      date: string;
      reference: string;
      space: string;
      customer: string | null;
      status: string;
      net: number;
      discount: number;
    }[]
  >`
    SELECT to_char(r.starts_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS date,
      r.reference, s.name AS space, c.name AS customer, r.status,
      r.amount_cents AS net,
      (COALESCE((SELECT sum(discount_cents) FROM promo_redemption pr WHERE pr.reservation_id = r.id), 0)
      + COALESCE((SELECT sum(discount_cents) FROM membership_redemption mr WHERE mr.reservation_id = r.id), 0))::int AS discount
    FROM reservation r
    JOIN space s ON s.id = r.space_id
    LEFT JOIN customer c ON c.id = r.customer_id
    WHERE r.organization_id = ${organizationId}
      AND r.kind IN ('rental','session_seat')
    ORDER BY r.starts_at DESC
    LIMIT 5000
  `;
  return toCsv(
    ["Date", "Reference", "Customer", "Space", "Status", "Gross", "Discount", "Net"],
    rows.map((r) => [
      r.date,
      r.reference,
      r.customer ?? "Walk-in",
      r.space,
      r.status,
      ((r.net + r.discount) / 100).toFixed(2),
      (r.discount / 100).toFixed(2),
      (r.net / 100).toFixed(2),
    ]),
  );
}
