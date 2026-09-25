import { z } from "zod";
import { sql } from "@/db";
import { slugify } from "@/lib/slug";

/**
 * `spaceSchema` from src/app/app/actions.ts, in JSON rather than FormData.
 *
 * The bounds are the web's, unchanged: the app's own `SpaceInput.validate`
 * copies them, so both surfaces refuse the same space for the same reason.
 */
export const spaceSchema = z.object({
  name: z.string().trim().min(1, "Give the space a name.").max(80, "That name is too long."),
  kind: z.string().trim().min(1).max(40).default("court"),
  capacity: z.coerce.number().int().min(1).max(500).default(1),
  slotMinutes: z.coerce.number().int().min(15).max(1440).default(60),
  bufferMinutes: z.coerce.number().int().min(0).max(240).default(0),
  priceCents: z.coerce.number().int().min(0).max(100_000_000).default(0),
});

export type SpaceInput = z.infer<typeof spaceSchema>;

/**
 * `uniqueSpaceSlug` — a space's slug is unique per venue and appears in the
 * share link, so "Court 1" twice has to become court-1 and court-1-2 rather
 * than failing on the unique index.
 */
export async function uniqueSpaceSlug(organizationId: string, name: string): Promise<string> {
  const base = slugify(name, "space");
  const rows = await sql<{ slug: string }[]>`
    SELECT slug FROM space WHERE organization_id = ${organizationId}
  `;
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;

  for (let n = 2; n < 999; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Wall clock in the venue's own zone. Never an instant — see `opening_hours`. */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const hoursSchema = z.object({
  hours: z
    .array(
      z.object({
        weekday: z.coerce.number().int().min(0).max(6),
        opensAt: z.string().regex(TIME, "Use HH:MM."),
        closesAt: z.string().regex(TIME, "Use HH:MM."),
      }),
    )
    .max(7),
});

/**
 * Drops anything the database would refuse anyway, and the last row wins for a
 * repeated weekday. `setOpeningHours` does the same by ignoring bad rows rather
 * than failing the save: a week is edited as a whole, and refusing all seven
 * days because one pair is inverted loses the other six.
 */
export function usableHours(rows: z.infer<typeof hoursSchema>["hours"]) {
  const byDay = new Map<number, { weekday: number; opensAt: string; closesAt: string }>();
  for (const row of rows) {
    if (row.closesAt <= row.opensAt) continue;
    byDay.set(row.weekday, row);
  }
  return [...byDay.values()].sort((a, b) => a.weekday - b.weekday);
}
