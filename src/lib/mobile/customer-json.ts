import { sql } from "@/db";
import {
  type CustomerBooking,
  type CustomerListRow,
  type CustomerProfile,
  type CustomerSegment,
  getCustomer,
} from "@/lib/customers";

/**
 * Customers, shaped for the app (API-CONTRACT #20–#22).
 *
 * The reads are `listCustomers` and `getCustomer` verbatim — who counts as a
 * regular, what lifetime value means and which bookings are revenue are
 * questions with one answer, and a second query here would drift from the one
 * the web already gives.
 *
 * The writes are ported from `src/app/app/customer-actions.ts` rather than
 * called: those are Server Actions that read the org from a cookie session and
 * `revalidatePath` a page this client never loads. What survives the port is
 * the part that matters — the wording of every refusal, and the rule that the
 * customer id is checked against the organisation **inside** the same
 * statement that writes, so a foreign id updates nothing rather than being
 * caught by a check that could be forgotten.
 */

/** Email is not editable: it is the `(organization_id, email)` identity key. */
const MAX_TAGS = 20;
const TAG_ALLOWED = /^[\p{L}\p{N} .&-]+$/u;

export function customerSummary(row: CustomerListRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    tags: row.tags,
    bookings: row.bookings,
    lifetimeValueCents: row.lifetimeValueCents,
    noShowCount: row.noShowCount,
    // A count of days, not a date: the screen says "3 weeks ago", and working
    // that out on the phone would drift against the venue's own today.
    lastVisitDays: row.lastVisitDays,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The four chips on V10 → the segments `listCustomers` knows. */
export function segmentOf(raw: string | null): CustomerSegment | undefined {
  switch (raw) {
    case "regulars":
      return "regulars";
    case "noShows":
      return "no_shows";
    case "newThisMonth":
      return "new";
    default:
      return undefined;
  }
}

function historyItem(b: CustomerBooking) {
  return {
    id: b.id,
    spaceName: b.spaceName,
    // "Sat 26 Sep · 17:00" — the web's label carries the year because a
    // dashboard table scans years at a time; a phone's history does not.
    whenLabel: `${b.dayLabel} · ${b.timeLabel}`,
    startsAt: b.startsAt.toISOString(),
    status: b.status,
    kind: b.kind,
    amountCents: b.amountCents,
    reference: b.reference,
    checkedInAt: b.checkedInAt?.toISOString() ?? null,
  };
}

function profileJson(p: CustomerProfile) {
  return {
    customer: {
      id: p.id,
      name: p.name,
      email: p.email,
      phone: p.phone,
      tags: p.tags,
      bookings: p.bookings,
      lifetimeValueCents: p.lifetimeValueCents,
      noShowCount: p.noShowCount,
      lastVisitDays: p.lastVisitDays,
      createdAt: p.createdAt.toISOString(),
    },
    upcoming: p.upcoming.map(historyItem),
    past: p.past.map(historyItem),
    notes: p.notes.map((n) => ({
      id: n.id,
      body: n.body,
      authorName: n.authorName,
      createdAt: n.createdAt.toISOString(),
    })),
    lastVisit: p.lastVisit?.toISOString() ?? null,
  };
}

/** #21 — the whole profile, or null when the id is not in this venue. */
export async function customerDetail(
  organizationId: string,
  customerId: string,
  timezone: string,
) {
  const profile = await getCustomer(organizationId, customerId, timezone);
  return profile ? profileJson(profile) : null;
}

/**
 * The summary a write answers with, so the list row updates without a refetch.
 * Null when the id is not in this venue — which is how every write below
 * reports a customer it could not reach.
 */
export async function customerSummaryById(
  organizationId: string,
  customerId: string,
  timezone: string,
) {
  const profile = await getCustomer(organizationId, customerId, timezone);
  return profile ? profileJson(profile).customer : null;
}

/** `tagSchema` + the cap from `addCustomerTag`, over a whole list. */
export function tagsProblem(tags: unknown): string | null {
  if (!Array.isArray(tags)) return "Tags must be a list.";
  if (tags.length > MAX_TAGS) return "That is as many tags as one customer can have.";

  const seen = new Set<string>();
  for (const raw of tags) {
    if (typeof raw !== "string") return "Tags must be text.";
    const tag = raw.trim();
    if (!tag) return "Tag can't be empty.";
    if (tag.length > 30) return "Keep tags under 30 characters.";
    if (!TAG_ALLOWED.test(tag)) return "Tags can use letters, numbers, spaces and - . &";
    if (seen.has(tag.toLowerCase())) return "That tag is already on this customer.";
    seen.add(tag.toLowerCase());
  }
  return null;
}

export function noteProblem(body: unknown): string | null {
  if (typeof body !== "string") return "Write something first.";
  const trimmed = body.trim();
  if (!trimmed) return "Write something first.";
  if (trimmed.length > 2000) return "That note is too long.";
  return null;
}

export function contactProblem(name: unknown, phone: unknown): string | null {
  if (typeof name !== "string" || !name.trim()) return "Name can't be empty.";
  if (name.trim().length > 120) return "That name is too long.";
  if (phone != null && typeof phone !== "string") return "That phone number is too long.";
  if (typeof phone === "string" && phone.trim().length > 40) {
    return "That phone number is too long.";
  }
  return null;
}

/** Writes the note only if the customer is this venue's. Null when it is not. */
export async function addNote(
  organizationId: string,
  customerId: string,
  authorUserId: string | null,
  body: string,
) {
  const [row] = await sql<
    { id: string; body: string; created_at: Date }[]
  >`
    INSERT INTO customer_note (organization_id, customer_id, author_user_id, body)
    SELECT ${organizationId}, c.id, ${authorUserId}, ${body.trim()}
    FROM customer c
    WHERE c.id = ${customerId}::uuid AND c.organization_id = ${organizationId}
    RETURNING id, body, created_at
  `;
  if (!row) return null;

  // The author is the person holding the phone, so there is no second query:
  // the session already carries their name.
  return { id: row.id, body: row.body, createdAt: row.created_at.toISOString() };
}

/** True when a note of this venue's was removed. */
export async function removeNote(
  organizationId: string,
  customerId: string,
  noteId: string,
): Promise<boolean> {
  const rows = await sql`
    DELETE FROM customer_note
    WHERE id = ${noteId}::uuid
      AND customer_id = ${customerId}::uuid
      AND organization_id = ${organizationId}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function setTags(
  organizationId: string,
  customerId: string,
  tags: string[],
): Promise<boolean> {
  const rows = await sql`
    UPDATE customer SET tags = ${tags.map((t) => t.trim())}
    WHERE id = ${customerId}::uuid AND organization_id = ${organizationId}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function setContact(
  organizationId: string,
  customerId: string,
  name: string,
  phone: string | null,
): Promise<boolean> {
  const rows = await sql`
    UPDATE customer SET name = ${name.trim()}, phone = ${phone?.trim() || null}
    WHERE id = ${customerId}::uuid AND organization_id = ${organizationId}
    RETURNING id
  `;
  return rows.length > 0;
}
