import { z } from "zod";
import { clientIp } from "@/lib/abuse";
import { BookingError } from "@/lib/booking/errors";
import { getBookingForCancel, getManageableBooking } from "@/lib/booking/manage";
import { moveReservation } from "@/lib/booking/reserve";
import { bookingJson } from "@/lib/mobile/public-book-json";
import { conflict, fail, invalid, notFound, ok, rateLimited } from "@/lib/mobile/respond";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** The cancellation policy, said as though it were about moving a booking. */
function changeWording(reason: string | null): string {
  if (!reason) return "This booking can't be changed online.";
  return reason
    .replace("can't be cancelled online", "can't be changed online")
    .replace("doesn't allow online cancellation", "doesn't allow online changes")
    .replace("This booking can't be cancelled.", "This booking can't be changed.");
}

type Params = { params: Promise<{ slug: string; token: string }> };

const schema = z.object({
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
});

/**
 * POST …/bookings/{token}/reschedule — API-CONTRACT #8.
 *
 * `staff: false`, deliberately: a customer moving their own booking must clear
 * the same notice window and horizon as a fresh public booking. The staff path
 * relaxes those because a member of staff is standing in front of the person;
 * nobody is standing in front of a phone.
 *
 * The booking keeps its own length — `moveReservation` carries it — so
 * `endsAt` in the body is ignored rather than trusted. A client that could set
 * its own end could buy an hour and take three.
 *
 * Eligibility is the cancellation policy: a booking you may not cancel is one
 * you may not move, or the policy would be a formality you could walk around.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug, token } = await params;

  const limit = await rateLimit(`reschedule:ip:${clientIp(request.headers)}`, 10, 60);
  if (!limit.allowed) {
    return rateLimited("Too many attempts — please try again in a minute.");
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return invalid({ startsAt: "Please pick a valid time." }, "Please pick a valid time.");
  }

  const booking = await getBookingForCancel(slug, token);
  if (!booking) return notFound("This link is no longer valid.");

  if (!booking.eligibility.canCancel) {
    // 422: the request was well formed and the policy says no. The app shows
    // this in place of the picker rather than as a failure.
    //
    // The reason is re-worded: `cancelEligibility` writes for the cancel
    // button, and telling somebody who tapped "Move" that it "can't be
    // cancelled online" reads as an answer to a question they did not ask.
    // The *rule* is shared; the sentence is not.
    return fail(422, {
      error: "refused",
      message: changeWording(booking.eligibility.reason),
    });
  }

  try {
    await moveReservation(
      booking.organizationId,
      booking.reservationId,
      booking.spaceId,
      parsed.data.startsAt,
      { staff: false },
    );
  } catch (error) {
    if (error instanceof BookingError) {
      if (error.reason === "not_found") return notFound(error.message);
      return conflict(error.reason, error.message);
    }
    throw error;
  }

  const after = await getManageableBooking(slug, token);
  if (!after) return notFound("This link is no longer valid.");
  return ok({ booking: bookingJson(after, { manageToken: token }) });
}
