import { sql } from "@/db";
import type { CancellationMode } from "@/db/schema";

/**
 * Owner-side reads. Unlike src/lib/venue.ts (which serves the public booking
 * page and only ever sees active spaces), these show everything the owner
 * manages, including deactivated spaces. Every function takes organizationId
 * from the caller, which must have resolved it through requireVenue().
 */

export type OwnerSpace = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  capacity: number;
  slotMinutes: number;
  bufferMinutes: number;
  priceCents: number;
  isActive: boolean;
  sortOrder: number;
  openDays: number;
};

export async function listOwnerSpaces(organizationId: string): Promise<OwnerSpace[]> {
  const rows = await sql<
    {
      id: string;
      name: string;
      slug: string;
      kind: string;
      capacity: number;
      slot_minutes: number;
      buffer_minutes: number;
      price_cents: number;
      is_active: boolean;
      sort_order: number;
      open_days: number;
    }[]
  >`
    SELECT s.id, s.name, s.slug, s.kind, s.capacity, s.slot_minutes,
           s.buffer_minutes, s.price_cents, s.is_active, s.sort_order,
           (SELECT count(DISTINCT weekday)::int FROM opening_hours oh
             WHERE oh.space_id = s.id) AS open_days
    FROM space s
    WHERE s.organization_id = ${organizationId}
    ORDER BY s.is_active DESC, s.sort_order, s.name
  `;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    capacity: row.capacity,
    slotMinutes: row.slot_minutes,
    bufferMinutes: row.buffer_minutes,
    priceCents: row.price_cents,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    openDays: row.open_days,
  }));
}

export async function getOwnerSpace(
  organizationId: string,
  spaceId: string,
): Promise<OwnerSpace | null> {
  const [row] = (await listOwnerSpaces(organizationId)).filter((s) => s.id === spaceId);
  return row ?? null;
}

export type DayHours = {
  weekday: number;
  opensAt: string; // "HH:MM"
  closesAt: string;
};

/** One row per weekday the space is open, in venue-local time. */
export async function getOpeningHours(spaceId: string): Promise<DayHours[]> {
  const rows = await sql<{ weekday: number; opens_at: string; closes_at: string }[]>`
    SELECT weekday,
           to_char(opens_at, 'HH24:MI')  AS opens_at,
           to_char(closes_at, 'HH24:MI') AS closes_at
    FROM opening_hours
    WHERE space_id = ${spaceId}::uuid
    ORDER BY weekday
  `;
  return rows.map((r) => ({
    weekday: r.weekday,
    opensAt: r.opens_at,
    closesAt: r.closes_at,
  }));
}

export type OwnerClosure = {
  id: string;
  spaceId: string | null;
  spaceName: string | null;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
};

export async function getClosures(
  organizationId: string,
  timezone: string,
): Promise<(OwnerClosure & { label: string })[]> {
  const rows = await sql<
    {
      id: string;
      space_id: string | null;
      space_name: string | null;
      starts_at: Date;
      ends_at: Date;
      reason: string | null;
      label: string;
    }[]
  >`
    SELECT c.id, c.space_id, s.name AS space_name, c.starts_at, c.ends_at, c.reason,
           to_char(c.starts_at AT TIME ZONE ${timezone}, 'DD Mon HH24:MI')
             || ' – ' ||
             to_char(c.ends_at AT TIME ZONE ${timezone}, 'DD Mon HH24:MI') AS label
    FROM closure c
    LEFT JOIN space s ON s.id = c.space_id
    WHERE c.organization_id = ${organizationId}
      AND c.ends_at > now()
    ORDER BY c.starts_at
  `;
  return rows.map((r) => ({
    id: r.id,
    spaceId: r.space_id,
    spaceName: r.space_name,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    reason: r.reason,
    label: r.label,
  }));
}

export type VenueSettings = {
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  tagline: string | null;
  address: string | null;
  minNoticeMinutes: number;
  maxHorizonDays: number;
  cancellationMode: CancellationMode;
  cancellationGraceHours: number;
  refundTerms: string | null;
  gcashName: string | null;
  gcashQrUrl: string | null;
};

export async function getVenueSettings(
  organizationId: string,
): Promise<VenueSettings | null> {
  const [row] = await sql<
    {
      name: string;
      slug: string;
      timezone: string;
      currency: string;
      tagline: string | null;
      address: string | null;
      min_notice_minutes: number;
      max_horizon_days: number;
      cancellation_mode: CancellationMode;
      cancellation_grace_hours: number;
      refund_terms: string | null;
      gcash_name: string | null;
      gcash_qr_url: string | null;
    }[]
  >`
    SELECT o.name, o.slug, v.timezone, v.currency, v.tagline, v.address,
           v.min_notice_minutes, v.max_horizon_days, v.cancellation_mode,
           v.cancellation_grace_hours, v.refund_terms, v.gcash_name, v.gcash_qr_url
    FROM organization o
    JOIN venue v ON v.organization_id = o.id
    WHERE o.id = ${organizationId}
  `;

  if (!row) return null;

  return {
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    currency: row.currency,
    tagline: row.tagline,
    address: row.address,
    minNoticeMinutes: row.min_notice_minutes,
    maxHorizonDays: row.max_horizon_days,
    cancellationMode: row.cancellation_mode,
    cancellationGraceHours: row.cancellation_grace_hours,
    refundTerms: row.refund_terms,
    gcashName: row.gcash_name,
    gcashQrUrl: row.gcash_qr_url,
  };
}
