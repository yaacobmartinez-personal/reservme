import { z } from "zod";
import { sql } from "@/db";
import { BookingError } from "@/lib/booking/errors";
import { bookRentalAsStaff } from "@/lib/booking/reserve";
import { redeemForBooking } from "@/lib/memberships";
import { wallClock } from "@/lib/mobile/calendar-json";
import { conflict, fail, invalid, notFound, ok } from "@/lib/mobile/respond";
import { runSheetEntry } from "@/lib/mobile/today-json";
import { isFailure, venueScope } from "@/lib/mobile/venue-scope";
import { emitBookingEvent } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/** `bookingSchema` from calendar-actions.ts, in JSON. */
const schema = z.object({
  spaceId: z.string().uuid(),
  date: z.string(),
  time: z.string(),
  slotCount: z.coerce.number().int().min(1).max(24).default(1),
  partySize: z.coerce.number().int().min(1).max(500).default(1),
  notes: z.string().trim().max(500).optional(),
  customerId: z.string().uuid().optional(),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().max(40).optional(),
});

/**
 * POST /api/mobile/venues/{slug}/bookings — API-CONTRACT #17.
 *
 * The walk-in. `bookRentalAsStaff` relaxes **policy only** — minimum notice,
 * the booking horizon, and the public path's one-slot limit — and keeps every
 * physical rule: the space must be active and open, not closed, not on a
 * session, and not overlapping. The desk can take a booking for tonight; it
 * cannot double-book a court.
 *
 * Any member: this is the job.
 */
export async function POST(request: Request, { params }: Params) {
  const scope = await venueScope(request, (await params).slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return invalid({ [String(issue.path[0] ?? "spaceId")]: issue.message }, "Check the booking details.");
  }
  const input = parsed.data;

  const wc = wallClock(input.date, input.time);
  if (!wc) return invalid({ time: "That start time isn't valid." });

  // The customer is either one of ours by id, or a name and email the engine
  // upserts. Looking the id up in-org is what stops a booking being pinned to
  // another venue's customer.
  let customer: { name: string; email: string; phone?: string };
  if (input.customerId) {
    const [row] = await sql<{ name: string; email: string; phone: string | null }[]>`
      SELECT name, email, phone FROM customer
      WHERE id = ${input.customerId}::uuid AND organization_id = ${scope.organizationId}
    `;
    if (!row) return notFound("That customer no longer exists.");
    customer = { name: row.name, email: row.email, phone: row.phone ?? undefined };
  } else {
    if (!input.name || !input.email) {
      return invalid(
        { name: "Choose a customer, or enter a name and email." },
        "Choose a customer, or enter a name and email.",
      );
    }
    customer = { name: input.name, email: input.email, phone: input.phone };
  }

  // Both instants are built in Postgres from wall-clock parts, and the space's
  // own slot length sizes the booking — so "2 slots" means two of *its* slots,
  // not two hours.
  const [row] = await sql<{ starts_at: Date; ends_at: Date }[]>`
    SELECT
      make_timestamptz(${wc.y}, ${wc.mo}, ${wc.day}, ${wc.h}, ${wc.mi}, 0, ${scope.timezone}) AS starts_at,
      make_timestamptz(${wc.y}, ${wc.mo}, ${wc.day}, ${wc.h}, ${wc.mi}, 0, ${scope.timezone})
        + make_interval(mins => s.slot_minutes * ${input.slotCount}) AS ends_at
    FROM space s
    WHERE s.id = ${input.spaceId}::uuid AND s.organization_id = ${scope.organizationId}
  `;
  if (!row) return notFound("That space no longer exists.");

  try {
    const booking = await bookRentalAsStaff({
      organizationId: scope.organizationId,
      spaceId: input.spaceId,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      customer,
      partySize: input.partySize,
      notes: input.notes,
    });

    // A pass credit or membership discount, if this customer has one. The web
    // does the same after a manual booking; skipping it here would charge a
    // member full price at the desk and the right price online.
    const [cust] = await sql<{ id: string }[]>`
      SELECT id FROM customer
      WHERE organization_id = ${scope.organizationId} AND lower(email) = lower(${customer.email})
    `;
    if (cust) {
      const redeemed = await redeemForBooking(
        scope.organizationId,
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

    await emitBookingEvent(scope.organizationId, "booking.created", booking.id);

    const entry = await runSheetEntry(scope.organizationId, booking.id, scope.timezone);
    return ok({ booking: entry }, 201);
  } catch (error) {
    if (error instanceof BookingError) {
      // `slot_taken` is the one the desk sees most, and it is not a failure so
      // much as news: somebody got there first. The app re-reads the grid.
      return conflict(error.reason, error.message);
    }
    throw error;
  }
}
