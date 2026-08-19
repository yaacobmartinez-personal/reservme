"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "@/db";
import { requireRole } from "@/lib/tenancy";

/**
 * Owner-created open-play / class sessions. Registration already works on the
 * public page (reserveSessionSeats); this is the missing create side. A session
 * occupies the space, so we refuse to place one over an existing confirmed
 * rental — the reserve path already stops rentals over sessions; this closes the
 * other direction.
 */

const MANAGE = ["owner", "admin"] as const;

function toCents(input: FormDataEntryValue | null): number {
  const value = Number.parseFloat(String(input ?? "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

function wallClock(date: string, time: string) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  return { y: +d[1], mo: +d[2], day: +d[3], h: +t[1], mi: +t[2] };
}

export async function createSession(formData: FormData) {
  const venue = await requireRole(...MANAGE);
  const parsed = z
    .object({
      spaceId: z.string().uuid(),
      title: z.string().trim().min(1, "Give the session a title.").max(120),
      date: z.string(),
      start: z.string(),
      end: z.string(),
      capacity: z.coerce.number().int().min(1).max(500),
      repeatWeeks: z.coerce.number().int().min(0).max(11).default(0),
    })
    .safeParse({
      spaceId: formData.get("spaceId"),
      title: formData.get("title"),
      date: formData.get("date"),
      start: formData.get("start"),
      end: formData.get("end"),
      capacity: formData.get("capacity"),
      repeatWeeks: formData.get("repeatWeeks") ?? 0,
    });
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const data = parsed.data;
  const priceCents = toCents(formData.get("price"));

  const s = wallClock(data.date, data.start);
  const e = wallClock(data.date, data.end);
  if (!s || !e) throw new Error("Please give a valid date and time.");
  if (data.end <= data.start) throw new Error("The end must be after the start.");

  const tz = venue.timezone;
  // First occurrence must be free of a confirmed rental — fail loudly if not.
  const [conflict] = await sql<{ x: number }[]>`
    SELECT 1 AS x FROM reservation r
    WHERE r.space_id = ${data.spaceId}::uuid
      AND r.status IN ('held','confirmed') AND r.kind = 'rental'
      AND r.during && tstzrange(
        make_timestamptz(${s.y}, ${s.mo}, ${s.day}, ${s.h}, ${s.mi}, 0, ${tz}),
        make_timestamptz(${e.y}, ${e.mo}, ${e.day}, ${e.h}, ${e.mi}, 0, ${tz}), '[)')
  `;
  if (conflict) throw new Error("That time already has a booking on this space.");

  // Insert each week; later weeks that clash with a rental are skipped.
  for (let i = 0; i <= data.repeatWeeks; i += 1) {
    await sql`
      INSERT INTO play_session (organization_id, space_id, title, starts_at, ends_at, capacity, price_per_person_cents)
      SELECT ${venue.organizationId}, sp.id, ${data.title},
        make_timestamptz(${s.y}, ${s.mo}, ${s.day}, ${s.h}, ${s.mi}, 0, ${tz}) + make_interval(weeks => ${i}),
        make_timestamptz(${e.y}, ${e.mo}, ${e.day}, ${e.h}, ${e.mi}, 0, ${tz}) + make_interval(weeks => ${i}),
        ${data.capacity}, ${priceCents}
      FROM space sp
      WHERE sp.id = ${data.spaceId}::uuid AND sp.organization_id = ${venue.organizationId}
        AND NOT EXISTS (
          SELECT 1 FROM reservation r
          WHERE r.space_id = sp.id AND r.status IN ('held','confirmed') AND r.kind = 'rental'
            AND r.during && tstzrange(
              make_timestamptz(${s.y}, ${s.mo}, ${s.day}, ${s.h}, ${s.mi}, 0, ${tz}) + make_interval(weeks => ${i}),
              make_timestamptz(${e.y}, ${e.mo}, ${e.day}, ${e.h}, ${e.mi}, 0, ${tz}) + make_interval(weeks => ${i}), '[)')
        )
    `;
  }

  revalidatePath(`/spaces/${data.spaceId}`);
  revalidatePath("/calendar");
}

export async function cancelSession(formData: FormData) {
  const venue = await requireRole(...MANAGE);
  const sessionId = z.string().uuid().parse(formData.get("sessionId"));
  const spaceId = z.string().uuid().parse(formData.get("spaceId"));
  await sql`
    UPDATE play_session SET cancelled = true
     WHERE id = ${sessionId}::uuid AND organization_id = ${venue.organizationId}
  `;
  revalidatePath(`/spaces/${spaceId}`);
  revalidatePath("/calendar");
}
