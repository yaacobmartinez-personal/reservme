import { z } from "zod";
import { getManageableBooking } from "@/lib/booking/manage";
import { BookingError } from "@/lib/booking/errors";
import { announceBooking, applyBookingDiscounts } from "@/lib/booking/public-book";
import { reserveSpace } from "@/lib/booking/reserve";
import { sql } from "@/db";
import {
  bookingJson,
  idempotencyKey,
  manageTokenOf,
  rememberKey,
  replayOf,
  TOO_MANY,
  withinBookingLimits,
} from "@/lib/mobile/public-book-json";
import { conflict, fail, invalid, notFound, ok, rateLimited } from "@/lib/mobile/respond";
import { validatePromo } from "@/lib/promo";
import { getVenueBySlug } from "@/lib/venue";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

const schema = z.object({
  spaceId: z.string().uuid(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  name: z.string().trim().min(1, "Please give a name for the booking."),
  email: z.string().trim().email("Please give an email we can send the booking to."),
  phone: z.string().trim().max(40).optional(),
  promo: z.string().trim().max(40).optional(),
  partySize: z.coerce.number().int().min(1).max(500).default(1),
});

/**
 * POST /api/public/venues/{slug}/bookings — API-CONTRACT #3.
 *
 * The one endpoint a stranger can write with, so the order of what happens
 * here is the security design, not a style:
 *
 * 1. the organisation comes from the **slug**, never the body — a space id in
 *    the request selects among that venue's spaces and nothing else;
 * 2. a suspended venue refuses the write, not merely the form;
 * 3. abuse limits before any write;
 * 4. an `Idempotency-Key` already seen returns the booking it made, so a
 *    retry after a dropped connection cannot book the slot twice.
 *
 * Availability is only a prediction: `reserveSpace` re-derives every rule and
 * the exclusion constraint has the final word, which is why `slot_taken` is a
 * normal answer here rather than a bug.
 */
export async function POST(request: Request, { params }: Params) {
  const venue = await getVenueBySlug((await params).slug);
  if (!venue) return notFound("We couldn't find that venue.");
  if (venue.suspendedAt) {
    return fail(403, {
      error: "suspended",
      message: "This venue is no longer taking bookings.",
    });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return invalid({ [String(issue.path[0] ?? "spaceId")]: issue.message }, issue.message);
  }
  const input = parsed.data;

  const key = idempotencyKey(request.headers);
  const already = await replayOf(venue.organizationId, key);
  if (already) {
    // The same attempt, arriving twice. Answer with what it made the first
    // time rather than making another one.
    const token = await manageTokenOf(already);
    const booking = token ? await getManageableBooking(venue.slug, token) : null;
    if (booking) return ok({ booking: bookingJson(booking, { manageToken: token }) }, 200);
  }

  if (!(await withinBookingLimits(request.headers, venue.organizationId))) {
    return rateLimited(TOO_MANY);
  }

  const promo = input.promo && input.promo.length > 0 ? input.promo : null;
  if (promo) {
    // Checked before the write, so a bad code is a clean refusal rather than a
    // committed booking we then cannot discount.
    const check = await validatePromo(venue.organizationId, promo);
    if (!check.ok) return invalid({ promo: check.reason }, check.reason);
  }

  let reservation;
  try {
    reservation = await reserveSpace({
      organizationId: venue.organizationId,
      spaceId: input.spaceId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      partySize: input.partySize,
      customer: { name: input.name, email: input.email, phone: input.phone },
    });
  } catch (error) {
    if (error instanceof BookingError) {
      if (error.reason === "not_found") return notFound(error.message);
      return conflict(error.reason, error.message);
    }
    throw error;
  }

  await applyBookingDiscounts(
    venue.organizationId,
    reservation.id,
    reservation.amountCents,
    input.email,
    promo,
  );
  await rememberKey(venue.organizationId, key, reservation.id);
  await announceBooking(venue.organizationId, reservation.id, reservation.startsAt);

  const [row] = await sql<{ manage_token: string }[]>`
    SELECT manage_token FROM reservation WHERE id = ${reservation.id}::uuid
  `;
  const booking = await getManageableBooking(venue.slug, row.manage_token);
  if (!booking) return notFound("We couldn't find that booking.");

  // The manage token comes back exactly once, here: it is the capability that
  // stands in for an account, and the device wallet is where it lives.
  return ok({ booking: bookingJson(booking, { manageToken: row.manage_token }) }, 201);
}
