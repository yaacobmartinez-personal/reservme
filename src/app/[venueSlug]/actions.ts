"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { clientIp, verifyTurnstile } from "@/lib/abuse";
import { BookingError } from "@/lib/booking/errors";
import { captureException } from "@/lib/observability";
import { reserveSpace } from "@/lib/booking/reserve";
import { announceBooking, applyBookingDiscounts } from "@/lib/booking/public-book";
import { rateLimit } from "@/lib/rate-limit";
import { validatePromo } from "@/lib/promo";
import { getVenueBySlug } from "@/lib/venue";

const bookingSchema = z.object({
  venueSlug: z.string().min(1),
  spaceId: z.string().uuid(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  name: z.string().trim().min(1, "Please give a name for the booking."),
  email: z.string().trim().email("That email doesn't look right."),
  phone: z.string().trim().optional(),
  promo: z.string().trim().max(40).optional(),
  turnstileToken: z.string().optional(),
});

// One person booking a few courts is normal; a script filling a calendar is
// not. These are deliberately generous — they stop floods, not real customers.
const IP_LIMIT = { max: 8, windowSeconds: 300 };
const VENUE_LIMIT = { max: 40, windowSeconds: 300 };

export type BookingState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "booked"; reference: string; label: string };

export async function bookSlot(
  _previous: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const parsed = bookingSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  const input = parsed.data;

  // The organisation is resolved from the slug on the server. It is never
  // taken from the form — a hidden field is the client's word for which
  // tenant to write to.
  const venue = await getVenueBySlug(input.venueSlug);
  if (!venue || venue.suspendedAt) {
    // Checked here as well as on the page: a suspended venue must refuse the
    // write, not merely stop rendering the form.
    return { status: "error", message: "This venue is no longer taking bookings." };
  }

  // Abuse controls, before any write. The booking endpoint is public and
  // unauthenticated, so it is the one place a script could flood a venue's
  // calendar. Rate-limit by client IP and by venue; verify Turnstile if it's
  // configured (a no-op pass until then).
  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);

  const [ipCheck, venueCheck] = await Promise.all([
    rateLimit(`book:ip:${ip}`, IP_LIMIT.max, IP_LIMIT.windowSeconds),
    rateLimit(
      `book:venue:${venue.organizationId}`,
      VENUE_LIMIT.max,
      VENUE_LIMIT.windowSeconds,
    ),
  ]);

  if (!ipCheck.allowed || !venueCheck.allowed) {
    return {
      status: "error",
      message: "Too many booking attempts just now. Please wait a minute and try again.",
    };
  }

  if (!(await verifyTurnstile(input.turnstileToken ?? null, ip))) {
    return {
      status: "error",
      message: "We couldn't verify that you're human. Please refresh and try again.",
    };
  }

  // Validate the promo (if any) before writing the booking, so a bad code is a
  // clean error rather than a committed reservation we then can't discount. The
  // real claim happens atomically after the booking is made.
  const promo = input.promo && input.promo.length > 0 ? input.promo : null;
  if (promo) {
    const check = await validatePromo(venue.organizationId, promo);
    if (!check.ok) return { status: "error", message: check.reason };
  }

  try {
    const reservation = await reserveSpace({
      organizationId: venue.organizationId,
      spaceId: input.spaceId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      customer: { name: input.name, email: input.email, phone: input.phone },
    });

    // Promo then membership, stacking on the remaining balance. Shared with
    // the app's endpoint so what a booking is worth is one answer, not two.
    await applyBookingDiscounts(
      venue.organizationId,
      reservation.id,
      reservation.amountCents,
      input.email,
      promo,
    );

    revalidatePath(`/${input.venueSlug}`);

    await announceBooking(venue.organizationId, reservation.id, reservation.startsAt);

    const label = new Intl.DateTimeFormat("en-PH", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: venue.timezone,
    }).format(reservation.startsAt);

    return { status: "booked", reference: reservation.reference, label };
  } catch (error) {
    if (error instanceof BookingError) {
      // A lost race — and equally a slot the page thought was open but the
      // write refused (now closed, past notice, out of hours) — means the grid
      // the customer is looking at is stale. Refresh so they see the real
      // availability rather than being told to try again blindly.
      revalidatePath(`/${input.venueSlug}`);
      return { status: "error", message: error.message };
    }

    captureException(error, {
      where: "bookSlot",
      venueSlug: input.venueSlug,
      spaceId: input.spaceId,
    });
    return {
      status: "error",
      message: "Something went wrong on our side. Nothing was charged — please try again.",
    };
  }
}
