import { getManageableBooking } from "@/lib/booking/manage";
import { bookingJson } from "@/lib/mobile/public-book-json";
import { notFound, ok } from "@/lib/mobile/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; token: string }> };

/**
 * GET …/bookings/{token} — API-CONTRACT #5.
 *
 * The token *is* the authorisation: there is no account behind a customer
 * booking, and this is the same capability the confirmation email hands out.
 * `getManageableBooking` matches it against the slug too, so a token cannot be
 * read under the wrong venue.
 *
 * Deliberately not gated on suspension: a customer must still be able to open
 * and cancel an existing booking when the venue has stopped taking new ones.
 *
 * The token comes back in the body because the caller already has it — this is
 * how the device wallet refreshes a booking it stored.
 */
export async function GET(_request: Request, { params }: Params) {
  const { slug, token } = await params;
  const booking = await getManageableBooking(slug, token);
  if (!booking) return notFound("This link is no longer valid.");

  return ok({ booking: bookingJson(booking, { manageToken: token }) });
}
