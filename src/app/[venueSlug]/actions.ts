"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { clientIp, verifyTurnstile } from "@/lib/abuse";
import { BookingError } from "@/lib/booking/errors";
import { captureException } from "@/lib/observability";
import { reserveSpace } from "@/lib/booking/reserve";
import {
  enqueueBookingConfirmation,
  scheduleBookingReminder,
} from "@/lib/jobs/enqueue";
import { rateLimit } from "@/lib/rate-limit";
import { consumePromo, validatePromo } from "@/lib/promo";
import { redeemForBooking } from "@/lib/memberships";
import { sql } from "@/db";
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

    // Running amount after each discount, so promo then membership stack on the
    // remaining balance. Each step is best-effort: the booking is committed, so
    // a discount hiccup must never fail the customer.
    let amountCents = reservation.amountCents;

    // Claim the promo now that the booking exists. This is atomic (uses+1 under
    // the cap), so a code that raced to its limit between validation and here
    // simply yields no discount — the booking still stands at full price.
    if (promo) {
      try {
        const applied = await consumePromo(
          venue.organizationId,
          promo,
          reservation.id,
          amountCents,
        );
        if (applied && applied.discountCents > 0) {
          amountCents = Math.max(0, amountCents - applied.discountCents);
          await sql`
            UPDATE reservation SET amount_cents = ${amountCents}
            WHERE id = ${reservation.id}::uuid
          `;
        }
      } catch (promoError) {
        // The booking is committed; a promo hiccup must not fail the customer.
        captureException(promoError, {
          where: "bookSlot.promo",
          reservationId: reservation.id,
          organizationId: venue.organizationId,
        });
      }
    }

    // Apply a pass credit or membership discount for a returning customer,
    // matched by the booking email. Runs on whatever's left after the promo.
    try {
      const [cust] = await sql<{ id: string }[]>`
        SELECT id FROM customer
        WHERE organization_id = ${venue.organizationId} AND lower(email) = lower(${input.email})
      `;
      if (cust) {
        const redeemed = await redeemForBooking(
          venue.organizationId,
          cust.id,
          reservation.id,
          amountCents,
        );
        if (redeemed && redeemed.discountCents > 0) {
          amountCents = Math.max(0, amountCents - redeemed.discountCents);
          await sql`
            UPDATE reservation SET amount_cents = ${amountCents}
            WHERE id = ${reservation.id}::uuid
          `;
        }
      }
    } catch (memberError) {
      captureException(memberError, {
        where: "bookSlot.membership",
        reservationId: reservation.id,
        organizationId: venue.organizationId,
      });
    }

    revalidatePath(`/${input.venueSlug}`);

    // Email is off the request path and best-effort: the booking is already
    // committed, so a mail/queue hiccup must not turn a successful reservation
    // into an error for the customer. The worker owns retries.
    try {
      const job = {
        reservationId: reservation.id,
        organizationId: venue.organizationId,
      };
      await enqueueBookingConfirmation(job);
      await scheduleBookingReminder(job, reservation.startsAt);
    } catch (queueError) {
      // The booking is committed; a failed enqueue only costs the email. Record
      // it so a persistently broken queue is visible, but don't fail the user.
      captureException(queueError, {
        where: "bookSlot.enqueue",
        reservationId: reservation.id,
        organizationId: venue.organizationId,
      });
    }

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
