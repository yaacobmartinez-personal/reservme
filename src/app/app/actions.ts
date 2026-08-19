"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "@/db";
import { COVER_MAX_BYTES, validateImageDataUrl } from "@/lib/branding";
import { slugify } from "@/lib/slug";
import { requireRole } from "@/lib/tenancy";

/**
 * Owner venue management. Every action:
 *   - re-checks the role server-side (requireRole), never trusting the UI;
 *   - takes organizationId from the session, never from the form;
 *   - scopes every write with organization_id so one venue can't touch another.
 *
 * "member" (staff) can run the day — check-in, cancel — but not reshape the
 * venue. Structural edits are owner/admin only.
 */

const MANAGE = ["owner", "admin"] as const;

/** Owner types pesos ("900" or "900.50"); we store centavos. */
function toCents(input: FormDataEntryValue | null): number {
  const value = Number.parseFloat(String(input ?? "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

async function uniqueSpaceSlug(organizationId: string, name: string): Promise<string> {
  const base = slugify(name, "space");
  const taken = new Set(
    (
      await sql<{ slug: string }[]>`
        SELECT slug FROM space WHERE organization_id = ${organizationId}
      `
    ).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; n < 999; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

const spaceSchema = z.object({
  name: z.string().trim().min(1, "Give the space a name.").max(80),
  kind: z.string().trim().min(1).max(40).default("court"),
  capacity: z.coerce.number().int().min(1).max(500).default(1),
  slotMinutes: z.coerce.number().int().min(15).max(1440).default(60),
  bufferMinutes: z.coerce.number().int().min(0).max(240).default(0),
});

export async function createSpace(formData: FormData) {
  const venue = await requireRole(...MANAGE);
  const parsed = spaceSchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind") ?? "court",
    capacity: formData.get("capacity") ?? 1,
    slotMinutes: formData.get("slotMinutes") ?? 60,
    bufferMinutes: formData.get("bufferMinutes") ?? 0,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  const data = parsed.data;
  const priceCents = toCents(formData.get("price"));
  const slug = await uniqueSpaceSlug(venue.organizationId, data.name);

  await sql.begin(async (tx) => {
    const [{ next }] = await tx<{ next: number }[]>`
      SELECT COALESCE(max(sort_order) + 1, 0) AS next
      FROM space WHERE organization_id = ${venue.organizationId}
    `;

    const [space] = await tx<{ id: string }[]>`
      INSERT INTO space (organization_id, name, slug, kind, capacity,
                         slot_minutes, buffer_minutes, price_cents, sort_order)
      VALUES (${venue.organizationId}, ${data.name}, ${slug}, ${data.kind},
              ${data.capacity}, ${data.slotMinutes}, ${data.bufferMinutes},
              ${priceCents}, ${next})
      RETURNING id
    `;

    // A space with no opening hours is unbookable, which would defeat the point
    // of adding one. Seed a sensible daily window the owner can then refine.
    for (let weekday = 0; weekday < 7; weekday += 1) {
      await tx`
        INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at)
        VALUES (${space.id}::uuid, ${weekday}, '08:00', '22:00')
      `;
    }
  });

  revalidatePath("/spaces");
  revalidatePath("/");
}

export async function updateSpace(formData: FormData) {
  const venue = await requireRole(...MANAGE);
  const spaceId = z.string().uuid().parse(formData.get("spaceId"));
  const parsed = spaceSchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind") ?? "court",
    capacity: formData.get("capacity") ?? 1,
    slotMinutes: formData.get("slotMinutes") ?? 60,
    bufferMinutes: formData.get("bufferMinutes") ?? 0,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  const data = parsed.data;
  const priceCents = toCents(formData.get("price"));

  await sql`
    UPDATE space
       SET name = ${data.name}, kind = ${data.kind}, capacity = ${data.capacity},
           slot_minutes = ${data.slotMinutes}, buffer_minutes = ${data.bufferMinutes},
           price_cents = ${priceCents}
     WHERE id = ${spaceId}::uuid AND organization_id = ${venue.organizationId}
  `;

  revalidatePath(`/spaces/${spaceId}`);
  revalidatePath("/spaces");
}

export async function setSpaceActive(formData: FormData) {
  const venue = await requireRole(...MANAGE);
  const spaceId = z.string().uuid().parse(formData.get("spaceId"));
  const active = formData.get("active") === "true";

  await sql`
    UPDATE space SET is_active = ${active}
     WHERE id = ${spaceId}::uuid AND organization_id = ${venue.organizationId}
  `;

  revalidatePath("/spaces");
  revalidatePath(`/spaces/${spaceId}`);
  revalidatePath("/");
}

/**
 * Sets or clears a space's photo. The client sends a data URL to set, "" to
 * clear, or the KEEP sentinel to leave the existing image untouched (so a
 * re-save doesn't have to resend the whole payload). Same allowlist + byte cap
 * as venue cover images.
 */
const KEEP_IMAGE = "__keep__";

export async function updateSpaceImage(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const venue = await requireRole(...MANAGE);
  const spaceId = z.string().uuid().parse(formData.get("spaceId"));
  const raw = String(formData.get("image") ?? "");

  if (raw !== KEEP_IMAGE) {
    let imageUrl: string | null = null;
    if (raw !== "") {
      const check = validateImageDataUrl(raw, COVER_MAX_BYTES);
      if (!check.ok) return { ok: false, error: check.error };
      imageUrl = raw;
    }
    await sql`
      UPDATE space SET image_url = ${imageUrl}
       WHERE id = ${spaceId}::uuid AND organization_id = ${venue.organizationId}
    `;
  }

  revalidatePath("/spaces");
  revalidatePath(`/spaces/${spaceId}`);
  return { ok: true };
}

/**
 * Replaces a space's whole weekly schedule from the edit grid. A day is open
 * only if its checkbox is set and the times are valid; everything else is
 * deleted, so unchecking a day closes it.
 */
export async function setOpeningHours(formData: FormData) {
  const venue = await requireRole(...MANAGE);
  const spaceId = z.string().uuid().parse(formData.get("spaceId"));

  const time = z.string().regex(/^\d{2}:\d{2}$/);
  const rows: { weekday: number; opens: string; closes: string }[] = [];

  for (let weekday = 0; weekday < 7; weekday += 1) {
    if (formData.get(`open_${weekday}`) !== "on") continue;
    const opens = time.safeParse(formData.get(`opens_${weekday}`));
    const closes = time.safeParse(formData.get(`closes_${weekday}`));
    if (!opens.success || !closes.success) continue;
    if (closes.data <= opens.data) continue; // CHECK would reject it anyway
    rows.push({ weekday, opens: opens.data, closes: closes.data });
  }

  await sql.begin(async (tx) => {
    // Ownership check folded into the write: the delete only touches rows whose
    // space belongs to this org.
    await tx`
      DELETE FROM opening_hours
      WHERE space_id = ${spaceId}::uuid
        AND space_id IN (SELECT id FROM space WHERE organization_id = ${venue.organizationId})
    `;
    for (const row of rows) {
      await tx`
        INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at)
        VALUES (${spaceId}::uuid, ${row.weekday}, ${row.opens}, ${row.closes})
      `;
    }
  });

  revalidatePath(`/spaces/${spaceId}`);
}

export async function addClosure(formData: FormData) {
  const venue = await requireRole(...MANAGE);
  const parsed = z
    .object({
      spaceId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
      startsAt: z.string().min(1),
      endsAt: z.string().min(1),
      reason: z.string().trim().max(200).optional(),
    })
    .safeParse({
      spaceId: formData.get("spaceId") || "",
      startsAt: formData.get("startsAt"),
      endsAt: formData.get("endsAt"),
      reason: formData.get("reason") ?? undefined,
    });
  if (!parsed.success) throw new Error("Please give a valid start and end.");

  const { spaceId, startsAt, endsAt, reason } = parsed.data;

  const start = wallClockParts(startsAt);
  const end = wallClockParts(endsAt);
  if (!start || !end) throw new Error("Please give a valid start and end.");

  // Build the instants with make_timestamptz from integer wall-clock parts.
  //
  // Do NOT do `${str}::timestamp AT TIME ZONE ${tz}` here: binding a wall-clock
  // string as a parameter and casting it to `timestamp without time zone`
  // round-trips through the driver in the *Node process* timezone, which is not
  // the venue's, and silently shifts the instant. make_timestamptz takes the
  // zone explicitly and is immune to both the process tz and the session tz.
  await sql`
    INSERT INTO closure (organization_id, space_id, starts_at, ends_at, reason)
    VALUES (
      ${venue.organizationId},
      ${spaceId ?? null},
      make_timestamptz(${start.y}, ${start.mo}, ${start.d}, ${start.h}, ${start.mi}, 0, ${venue.timezone}),
      make_timestamptz(${end.y}, ${end.mo}, ${end.d}, ${end.h}, ${end.mi}, 0, ${venue.timezone}),
      ${reason ?? null}
    )
  `;

  revalidatePath("/settings");
}

/** Splits a datetime-local value ("YYYY-MM-DDTHH:MM") into integer parts. */
function wallClockParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  return {
    y: Number(match[1]),
    mo: Number(match[2]),
    d: Number(match[3]),
    h: Number(match[4]),
    mi: Number(match[5]),
  };
}

export async function removeClosure(formData: FormData) {
  const venue = await requireRole(...MANAGE);
  const closureId = z.string().uuid().parse(formData.get("closureId"));

  await sql`
    DELETE FROM closure
     WHERE id = ${closureId}::uuid AND organization_id = ${venue.organizationId}
  `;

  revalidatePath("/settings");
}

export async function addPricingRule(formData: FormData) {
  const venue = await requireRole(...MANAGE);
  const spaceId = z.string().uuid().parse(formData.get("spaceId"));
  const time = z.string().regex(/^\d{2}:\d{2}$/);
  const starts = time.parse(formData.get("starts"));
  const ends = time.parse(formData.get("ends"));
  if (ends <= starts) throw new Error("The end time must be after the start.");

  const label = String(formData.get("label") ?? "").trim() || null;
  const priceCents = toCents(formData.get("price"));

  const weekdays: number[] = [];
  for (let d = 0; d < 7; d += 1) if (formData.get(`wd_${d}`) === "on") weekdays.push(d);
  if (weekdays.length === 0) throw new Error("Pick at least one day.");

  // The INSERT ... SELECT ties the rule to a space in this org — a foreign
  // spaceId matches no rows and writes nothing.
  await sql`
    INSERT INTO pricing_rule (organization_id, space_id, label, weekdays, starts_at, ends_at, price_cents)
    SELECT ${venue.organizationId}, s.id, ${label}, ${weekdays}::smallint[], ${starts}, ${ends}, ${priceCents}
    FROM space s
    WHERE s.id = ${spaceId}::uuid AND s.organization_id = ${venue.organizationId}
  `;
  revalidatePath(`/spaces/${spaceId}`);
}

export async function removePricingRule(formData: FormData) {
  const venue = await requireRole(...MANAGE);
  const ruleId = z.string().uuid().parse(formData.get("ruleId"));
  const spaceId = z.string().uuid().parse(formData.get("spaceId"));
  await sql`
    DELETE FROM pricing_rule
     WHERE id = ${ruleId}::uuid AND organization_id = ${venue.organizationId}
  `;
  revalidatePath(`/spaces/${spaceId}`);
}

export async function updateVenueSettings(formData: FormData) {
  const venue = await requireRole(...MANAGE);

  const parsed = z
    .object({
      name: z.string().trim().min(1).max(120),
      tagline: z.string().trim().max(200).optional(),
      address: z.string().trim().max(200).optional(),
      timezone: z.string().trim().min(1).max(64),
      currency: z.string().trim().length(3),
      minNoticeMinutes: z.coerce.number().int().min(0).max(20160),
      maxHorizonDays: z.coerce.number().int().min(1).max(365),
      cancellationMode: z.enum(["anytime", "grace", "never"]),
      cancellationGraceHours: z.coerce.number().int().min(0).max(720),
      refundTerms: z.string().trim().max(1000).optional(),
      gcashName: z.string().trim().max(120).optional(),
    })
    .safeParse({
      name: formData.get("name"),
      tagline: formData.get("tagline") ?? undefined,
      address: formData.get("address") ?? undefined,
      timezone: formData.get("timezone"),
      currency: formData.get("currency"),
      minNoticeMinutes: formData.get("minNoticeMinutes"),
      maxHorizonDays: formData.get("maxHorizonDays"),
      cancellationMode: formData.get("cancellationMode"),
      cancellationGraceHours: formData.get("cancellationGraceHours"),
      refundTerms: formData.get("refundTerms") ?? undefined,
      gcashName: formData.get("gcashName") ?? undefined,
    });
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  const data = parsed.data;

  await sql.begin(async (tx) => {
    await tx`
      UPDATE organization SET name = ${data.name}
       WHERE id = ${venue.organizationId}
    `;
    await tx`
      UPDATE venue
         SET timezone = ${data.timezone},
             currency = ${data.currency.toUpperCase()},
             tagline = ${data.tagline ?? null},
             address = ${data.address ?? null},
             min_notice_minutes = ${data.minNoticeMinutes},
             max_horizon_days = ${data.maxHorizonDays},
             cancellation_mode = ${data.cancellationMode},
             cancellation_grace_hours = ${data.cancellationGraceHours},
             refund_terms = ${data.refundTerms ?? null},
             gcash_name = ${data.gcashName ?? null}
       WHERE organization_id = ${venue.organizationId}
    `;
  });

  revalidatePath("/settings");
  revalidatePath("/");
}

