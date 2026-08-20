"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "@/db";
import { BookingError } from "@/lib/booking/errors";
import { listCustomers } from "@/lib/customers";
import { redeemForBooking } from "@/lib/memberships";
import { emitBookingEvent } from "@/lib/webhooks";
import {
  bookRentalAsStaff,
  moveReservation as moveReservationEngine,
  type CustomerDetails,
} from "@/lib/booking/reserve";
import { requireVenue } from "@/lib/tenancy";

/**
 * Calendar writes — the staff booking surface. Every action takes the org from
 * the session (requireVenue), scopes every read/write to it, and goes through
 * the booking engine's staff path, which keeps every physical guarantee (no
 * overlap, closures, sessions, active space) while relaxing only policy (notice
 * window, horizon, single-slot length). Results are returned, not thrown, so
 * the panel can show "that slot's taken" inline instead of crashing.
 */

export type BookingResult = { ok: true; reference?: string } | { ok: false; error: string };

/** "YYYY-MM-DD" + "HH:MM" → integer wall-clock parts (validated). */
function wallClock(date: string, time: string) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  return {
    y: Number(d[1]),
    mo: Number(d[2]),
    day: Number(d[3]),
    h: Number(t[1]),
    mi: Number(t[2]),
  };
}

const bookingSchema = z.object({
  spaceId: z.string().uuid(),
  date: z.string(),
  time: z.string(),
  slotCount: z.coerce.number().int().min(1).max(24),
  partySize: z.coerce.number().int().min(1).max(500).default(1),
  notes: z.string().trim().max(500).optional(),
  customerId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("").transform(() => undefined)),
  phone: z.string().trim().max(40).optional(),
});

export async function createManualBooking(formData: FormData): Promise<BookingResult> {
  const venue = await requireVenue();

  const parsed = bookingSchema.safeParse({
    spaceId: formData.get("spaceId"),
    date: formData.get("date"),
    time: formData.get("time"),
    slotCount: formData.get("slotCount") ?? 1,
    partySize: formData.get("partySize") ?? 1,
    notes: formData.get("notes") ?? undefined,
    customerId: formData.get("customerId") ?? "",
    name: formData.get("name") ?? undefined,
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Please check the booking details." };
  const data = parsed.data;

  const wc = wallClock(data.date, data.time);
  if (!wc) return { ok: false, error: "That start time isn't valid." };

  // Resolve the customer: an existing one is looked up in-org; otherwise the
  // typed name+email become (or match) a customer via the engine's upsert.
  let customer: CustomerDetails;
  if (data.customerId) {
    const [c] = await sql<{ name: string; email: string; phone: string | null }[]>`
      SELECT name, email, phone FROM customer
      WHERE id = ${data.customerId}::uuid AND organization_id = ${venue.organizationId}
    `;
    if (!c) return { ok: false, error: "That customer no longer exists." };
    customer = { name: c.name, email: c.email, phone: c.phone ?? undefined };
  } else {
    if (!data.name || !data.email) {
      return { ok: false, error: "Choose a customer, or enter a name and email." };
    }
    customer = { name: data.name, email: data.email, phone: data.phone };
  }

  // Build the two instants in SQL from wall-clock parts (immune to the Node
  // process timezone — same reasoning as addClosure), and read the space's grid
  // step to size the booking. Also confirms the space is this org's.
  const [row] = await sql<{ starts_at: Date; ends_at: Date }[]>`
    SELECT
      make_timestamptz(${wc.y}, ${wc.mo}, ${wc.day}, ${wc.h}, ${wc.mi}, 0, ${venue.timezone}) AS starts_at,
      make_timestamptz(${wc.y}, ${wc.mo}, ${wc.day}, ${wc.h}, ${wc.mi}, 0, ${venue.timezone})
        + make_interval(mins => s.slot_minutes * ${data.slotCount}) AS ends_at
    FROM space s
    WHERE s.id = ${data.spaceId}::uuid AND s.organization_id = ${venue.organizationId}
  `;
  if (!row) return { ok: false, error: "That space no longer exists." };

  try {
    const booking = await bookRentalAsStaff({
      organizationId: venue.organizationId,
      spaceId: data.spaceId,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      customer,
      partySize: data.partySize,
      notes: data.notes,
    });

    // Apply a pass credit / membership discount for this customer, if any.
    const [cust] = await sql<{ id: string }[]>`
      SELECT id FROM customer
      WHERE organization_id = ${venue.organizationId} AND lower(email) = lower(${customer.email})
    `;
    if (cust) {
      const redeemed = await redeemForBooking(
        venue.organizationId,
        cust.id,
        booking.id,
        booking.amountCents,
      );
      if (redeemed && redeemed.discountCents > 0) {
        await sql`
          UPDATE reservation
          SET amount_cents = GREATEST(0, amount_cents - ${redeemed.discountCents})
          WHERE id = ${booking.id}::uuid
        `;
      }
    }

    await emitBookingEvent(venue.organizationId, "booking.created", booking.id);

    revalidatePath("/calendar");
    revalidatePath("/");
    return { ok: true, reference: booking.reference };
  } catch (error) {
    if (error instanceof BookingError) return { ok: false, error: error.message };
    throw error;
  }
}

const moveSchema = z.object({
  reservationId: z.string().uuid(),
  spaceId: z.string().uuid(),
  date: z.string(),
  time: z.string(),
});

export async function moveReservation(formData: FormData): Promise<BookingResult> {
  const venue = await requireVenue();
  const parsed = moveSchema.safeParse({
    reservationId: formData.get("reservationId"),
    spaceId: formData.get("spaceId"),
    date: formData.get("date"),
    time: formData.get("time"),
  });
  if (!parsed.success) return { ok: false, error: "Please check the new time." };
  const data = parsed.data;

  const wc = wallClock(data.date, data.time);
  if (!wc) return { ok: false, error: "That start time isn't valid." };

  const [row] = await sql<{ starts_at: Date }[]>`
    SELECT make_timestamptz(${wc.y}, ${wc.mo}, ${wc.day}, ${wc.h}, ${wc.mi}, 0, ${venue.timezone}) AS starts_at
  `;

  try {
    await moveReservationEngine(
      venue.organizationId,
      data.reservationId,
      data.spaceId,
      row.starts_at,
    );
    revalidatePath("/calendar");
    return { ok: true };
  } catch (error) {
    if (error instanceof BookingError) return { ok: false, error: error.message };
    throw error;
  }
}

const blockSchema = z.object({
  spaceId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  reason: z.string().trim().max(200).optional(),
});

export async function blockOff(formData: FormData): Promise<BookingResult> {
  const venue = await requireVenue();
  const parsed = blockSchema.safeParse({
    spaceId: formData.get("spaceId") ?? "",
    date: formData.get("date"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Please give a valid range." };
  const data = parsed.data;

  const s = wallClock(data.date, data.startTime);
  const e = wallClock(data.date, data.endTime);
  if (!s || !e) return { ok: false, error: "Please give a valid start and end." };
  if (data.endTime <= data.startTime) return { ok: false, error: "The end must be after the start." };

  await sql`
    INSERT INTO closure (organization_id, space_id, starts_at, ends_at, reason)
    VALUES (
      ${venue.organizationId},
      ${data.spaceId ?? null},
      make_timestamptz(${s.y}, ${s.mo}, ${s.day}, ${s.h}, ${s.mi}, 0, ${venue.timezone}),
      make_timestamptz(${e.y}, ${e.mo}, ${e.day}, ${e.h}, ${e.mi}, 0, ${venue.timezone}),
      ${data.reason ?? null}
    )
  `;

  revalidatePath("/calendar");
  revalidatePath("/settings");
  return { ok: true };
}

export type CustomerHit = { id: string; name: string; email: string; phone: string | null };

/** Typeahead for the booking panel — the top matches for a query, in-org. */
export async function searchCustomers(query: string): Promise<CustomerHit[]> {
  const venue = await requireVenue();
  const parsed = z.string().max(200).safeParse(query);
  if (!parsed.success) return [];
  const q = parsed.data.trim();
  if (q.length < 1) return [];
  const { rows } = await listCustomers(venue.organizationId, venue.timezone, {
    search: q,
    sort: "name",
  });
  return rows.slice(0, 6).map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
  }));
}

/** Remove a closure from the calendar (undo a block-off). */
export async function removeBlock(formData: FormData): Promise<BookingResult> {
  const venue = await requireVenue();
  const closureId = z.string().uuid().safeParse(formData.get("closureId"));
  if (!closureId.success) return { ok: false, error: "Unknown block." };

  await sql`
    DELETE FROM closure
    WHERE id = ${closureId.data}::uuid AND organization_id = ${venue.organizationId}
  `;
  revalidatePath("/calendar");
  return { ok: true };
}
