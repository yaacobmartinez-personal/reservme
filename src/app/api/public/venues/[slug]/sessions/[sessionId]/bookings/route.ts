import { z } from "zod";
import { sql } from "@/db";
import { BookingError } from "@/lib/booking/errors";
import { getManageableBooking } from "@/lib/booking/manage";
import { announceBooking } from "@/lib/booking/public-book";
import { reserveSessionSeats } from "@/lib/booking/reserve";
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
import { getVenueBySlug } from "@/lib/venue";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; sessionId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  spots: z.coerce.number().int().min(1).max(50),
  name: z.string().trim().min(1, "Please give a name for the booking."),
  email: z.string().trim().email("Please give an email we can send the booking to."),
  phone: z.string().trim().max(40).optional(),
});

/**
 * POST …/sessions/{id}/bookings — API-CONTRACT #4. Seats in a shared session.
 *
 * Unlike a rental, this does not take the space: several people hold seats in
 * the same block, and the capacity is claimed atomically inside
 * `reserveSessionSeats`. `session_full` is the answer when the last seats went
 * between reading the page and tapping Book — the same shape as `slot_taken`,
 * and just as normal.
 *
 * No promo path here, matching the web: session pricing is per person and set
 * on the session itself.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug, sessionId } = await params;
  const venue = await getVenueBySlug(slug);
  if (!venue) return notFound("We couldn't find that venue.");
  if (venue.suspendedAt) {
    return fail(403, {
      error: "suspended",
      message: "This venue is no longer taking bookings.",
    });
  }
  if (!UUID.test(sessionId)) return notFound("We couldn't find that session.");

  // The session is checked against *this* venue before anything is claimed.
  const [session] = await sql<{ id: string }[]>`
    SELECT id FROM play_session
    WHERE id = ${sessionId}::uuid AND organization_id = ${venue.organizationId}
  `;
  if (!session) return notFound("We couldn't find that session.");

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return invalid({ [String(issue.path[0] ?? "spots")]: issue.message }, issue.message);
  }
  const input = parsed.data;

  const key = idempotencyKey(request.headers);
  const already = await replayOf(venue.organizationId, key);
  if (already) {
    const token = await manageTokenOf(already);
    const booking = token ? await getManageableBooking(venue.slug, token) : null;
    if (booking) return ok({ booking: bookingJson(booking, { manageToken: token }) }, 200);
  }

  if (!(await withinBookingLimits(request.headers, venue.organizationId))) {
    return rateLimited(TOO_MANY);
  }

  let reservation;
  try {
    reservation = await reserveSessionSeats({
      organizationId: venue.organizationId,
      sessionId,
      spots: input.spots,
      customer: { name: input.name, email: input.email, phone: input.phone },
    });
  } catch (error) {
    if (error instanceof BookingError) {
      if (error.reason === "not_found") return notFound(error.message);
      return conflict(error.reason, error.message);
    }
    throw error;
  }

  await rememberKey(venue.organizationId, key, reservation.id);
  await announceBooking(venue.organizationId, reservation.id, reservation.startsAt);

  const token = await manageTokenOf(reservation.id);
  const booking = token ? await getManageableBooking(venue.slug, token) : null;
  if (!booking) return notFound("We couldn't find that booking.");

  return ok({ booking: bookingJson(booking, { manageToken: token }) }, 201);
}
