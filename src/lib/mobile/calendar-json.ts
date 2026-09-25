import { sql } from "@/db";
import { getCalendarDay } from "@/lib/calendar";

/**
 * The day grid, shaped for the app (API-CONTRACT #16).
 *
 * Built on the web's `getCalendarDay`, deliberately — what belongs on a day is
 * one question with one answer, and a second query would drift. The mapping
 * here is the difference between two ways of drawing the same thing: the web
 * positions a flat list of blocks by minute offset, the app draws a lane per
 * space and needs the hour rows named.
 */

/** "HH:MM" from minutes past local midnight. */
function hhmm(minutes: number): string {
  const m = Math.max(0, Math.min(1440, minutes));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export type WallClock = { y: number; mo: number; day: number; h: number; mi: number };

/** `wallClock` from calendar-actions.ts. Null when either part is malformed. */
export function wallClock(date: string, time: string): WallClock | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!d || !t) return null;
  return { y: +d[1], mo: +d[2], day: +d[3], h: +t[1], mi: +t[2] };
}

/**
 * Turns venue-local wall clock into an instant **in Postgres**, never in Node.
 *
 * `make_timestamptz(..., timezone)` is immune to the process timezone, which a
 * `new Date("2026-09-26T18:00")` in Node is not: the same string would mean a
 * different moment on a laptop in Manila and a container in Virginia.
 */
export async function instantAt(wc: WallClock, timezone: string): Promise<Date> {
  const [row] = await sql<{ at: Date }[]>`
    SELECT make_timestamptz(${wc.y}, ${wc.mo}, ${wc.day}, ${wc.h}, ${wc.mi}, 0, ${timezone}) AS at
  `;
  return row.at;
}

export async function calendarDay(organizationId: string, timezone: string, date: string) {
  const day = await getCalendarDay(organizationId, timezone, date);

  // One row per hour across the widest open→close of the day's active spaces.
  // The web sends minute offsets and positions by arithmetic; the app draws
  // named rows, and an empty day still has to be a grid rather than a blank
  // screen — which is why the axis comes from opening hours, not from what
  // happens to be booked.
  const rows: string[] = [];
  const firstHour = Math.floor(day.openMin / 60);
  const lastHour = Math.ceil(day.closeMin / 60);
  for (let hour = firstHour; hour < lastHour; hour += 1) rows.push(hhmm(hour * 60));

  const label = (block: { startLabel: string; endLabel: string }) =>
    `${block.startLabel}–${block.endLabel}`;

  const kindOf = (type: "rental" | "session" | "closure") =>
    type === "rental" ? "booking" : type === "session" ? "session" : "block";

  const item = (block: (typeof day.blocks)[number]) => ({
    id: block.id,
    kind: kindOf(block.type),
    startsAt: block.startsAt.toISOString(),
    endsAt: block.endsAt.toISOString(),
    label: label(block),
    title: block.title,
    subtitle: block.subtitle,
    customerId: block.customerId ?? null,
    reference: block.reference ?? null,
    status: block.status ?? "confirmed",
    // `getCalendarDay` flattens the instant to a boolean; the app only asks
    // whether the chip should say "in", so that is enough.
    checkedInAt: block.checkedIn ? block.startsAt.toISOString() : null,
    amountCents: block.amountCents ?? 0,
    partySize: block.partySize ?? 1,
    noShowCount: 0,
    sessionCapacity: block.capacity ?? null,
    sessionBooked: block.bookedSpots ?? null,
  });

  return {
    date: day.date,
    rows,
    lanes: day.columns.map((column) => ({
      spaceId: column.id,
      spaceName: column.name,
      slotMinutes: column.slotMinutes,
      isActive: true, // getCalendarDay returns active spaces only
      items: day.blocks
        // A venue-wide closure has no space and shuts every lane, so it is
        // drawn in all of them rather than nowhere.
        .filter((b) => b.spaceId === column.id || b.spaceId === null)
        .map(item),
    })),
  };
}

/** One closure, as the app reads a calendar item (#19). */
export async function blockItem(organizationId: string, blockId: string, timezone: string) {
  const [row] = await sql<
    {
      id: string;
      space_id: string | null;
      space_name: string | null;
      starts_at: Date;
      ends_at: Date;
      reason: string | null;
      start_label: string;
      end_label: string;
    }[]
  >`
    SELECT c.id, c.space_id, s.name AS space_name, c.starts_at, c.ends_at, c.reason,
           to_char(c.starts_at AT TIME ZONE ${timezone}, 'HH24:MI') AS start_label,
           to_char(c.ends_at AT TIME ZONE ${timezone}, 'HH24:MI') AS end_label
    FROM closure c
    LEFT JOIN space s ON s.id = c.space_id
    WHERE c.id = ${blockId}::uuid AND c.organization_id = ${organizationId}
  `;
  if (!row) return null;

  return {
    id: row.id,
    kind: "block" as const,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    label: `${row.start_label}–${row.end_label}`,
    title: row.reason ?? "Blocked",
    subtitle: row.space_name ?? "Whole venue",
    customerId: null,
    reference: null,
    status: "confirmed",
    checkedInAt: null,
    amountCents: 0,
    partySize: 1,
    noShowCount: 0,
    sessionCapacity: null,
    sessionBooked: null,
  };
}
