import { clientIp } from "@/lib/abuse";
import { BookingError } from "@/lib/booking/errors";
import { getBookingForCancel, getManageableBooking } from "@/lib/booking/manage";
import { cancelReservation } from "@/lib/booking/reserve";
import { promoteWaitlistForReservation } from "@/lib/booking/waitlist";
import { bookingJson } from "@/lib/mobile/public-book-json";
import { notFound, ok, rateLimited } from "@/lib/mobile/respond";
import { rateLimit } from "@/lib/rate-limit";
import { emitBookingEvent } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; token: string }> };

/**
 * POST …/bookings/{token}/cancel — API-CONTRACT #6.
 *
 * Eligibility is **re-derived here** from the venue's own policy. The app has
 * a copy of the rule and greys the button out with it, but that copy is a
 * courtesy: a phone holding a stale booking must not be able to cancel
 * something the venue's policy says it cannot.
 *
 * A refusal is an `outcome`, not an error status: "you're inside the 24-hour
 * window" is an answer the screen shows in place of the button, and a 4xx
 * would make it look like something broke.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug, token } = await params;

  // Anonymous, so by IP — the token is the only thing identifying the caller
  // and it is the thing being guessed at.
  const limit = await rateLimit(`cancel:ip:${clientIp(request.headers)}`, 10, 60);
  if (!limit.allowed) {
    return rateLimited("Too many attempts — please try again in a minute.");
  }

  const booking = await getBookingForCancel(slug, token);
  if (!booking) return notFound("This link is no longer valid.");

  if (!booking.eligibility.canCancel) {
    return ok({
      outcome: "refused",
      reason: booking.eligibility.reason ?? "This booking can't be cancelled online.",
    });
  }

  try {
    await cancelReservation(booking.organizationId, booking.reservationId);
    await emitBookingEvent(booking.organizationId, "booking.cancelled", booking.reservationId);
    // The freed slot may have someone waiting — notify the first in line.
    await promoteWaitlistForReservation(booking.organizationId, booking.reservationId);
  } catch (error) {
    // Already gone (a double tap, or the venue cancelled it first). The state
    // the customer wanted is the state they are in, so this is not a failure.
    if (!(error instanceof BookingError)) throw error;
  }

  const after = await getManageableBooking(slug, token);
  return ok({
    outcome: "cancelled",
    booking: after ? bookingJson(after, { manageToken: token }) : null,
  });
}
