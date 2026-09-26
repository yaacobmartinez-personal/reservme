import { sql } from "@/db";

/**
 * Read-only iCal feed of a venue's upcoming bookings. The per-venue token is the
 * only credential, so the lookup is by token and nothing else. Served on the app
 * host under /api/calendar/<token> (the proxy 404s /api on the apex host).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function venueByIcalToken(
  token: string,
): Promise<{ organizationId: string; name: string; timezone: string } | null> {
  if (!UUID_RE.test(token)) return null; // avoid a cast error on junk input
  const [row] = await sql<{ organization_id: string; name: string; timezone: string }[]>`
    SELECT o.id AS organization_id, o.name, v.timezone
    FROM venue v JOIN organization o ON o.id = v.organization_id
    WHERE v.ical_token = ${token}::uuid
  `;
  return row
    ? { organizationId: row.organization_id, name: row.name, timezone: row.timezone }
    : null;
}

function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** JS Date → iCal UTC stamp, e.g. 20260819T100000Z. */
function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export async function buildIcalFeed(
  organizationId: string,
  name: string,
  timezone: string,
): Promise<string> {
  const rows = await sql<
    {
      reference: string;
      starts_at: Date;
      ends_at: Date;
      space_name: string;
      customer_name: string | null;
    }[]
  >`
    SELECT r.reference, r.starts_at, r.ends_at, s.name AS space_name, c.name AS customer_name
    FROM reservation r
    JOIN space s ON s.id = r.space_id
    LEFT JOIN customer c ON c.id = r.customer_id
    WHERE r.organization_id = ${organizationId} AND r.status = 'confirmed'
      AND r.ends_at > now() - interval '1 day'
      AND r.starts_at < now() + interval '120 days'
    ORDER BY r.starts_at
  `;

  const now = stamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ReservMe//Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)} bookings`,
    `X-WR-TIMEZONE:${timezone}`,
  ];
  for (const r of rows) {
    const title = r.space_name + (r.customer_name ? ` — ${r.customer_name}` : "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${r.reference}@reservme.pro`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(r.starts_at)}`,
      `DTEND:${stamp(r.ends_at)}`,
      `SUMMARY:${esc(title)}`,
      `DESCRIPTION:${esc(`Ref ${r.reference}`)}`,
      "STATUS:CONFIRMED",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/**
 * Rotates the feed token. Every calendar subscribed with the old URL stops
 * updating — that is the point: it is how a leaked link is shut off.
 */
export async function rotateIcalToken(organizationId: string): Promise<string> {
  const [row] = await sql<{ ical_token: string }[]>`
    UPDATE venue SET ical_token = gen_random_uuid()
    WHERE organization_id = ${organizationId}
    RETURNING ical_token
  `;
  return row.ical_token;
}

export async function icalTokenFor(organizationId: string): Promise<string | null> {
  const [row] = await sql<{ ical_token: string | null }[]>`
    SELECT ical_token FROM venue WHERE organization_id = ${organizationId}
  `;
  return row?.ical_token ?? null;
}
