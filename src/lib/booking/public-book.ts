import { sql } from "@/db";
import { enqueueBookingConfirmation, scheduleBookingReminder } from "@/lib/jobs/enqueue";
import { captureException } from "@/lib/observability";
import { redeemForBooking } from "@/lib/memberships";
import { consumePromo } from "@/lib/promo";
import { emitBookingEvent } from "@/lib/webhooks";

/**
 * Everything that happens *after* a public booking is committed: the
 * discounts that stack onto it, and the mail and webhooks it sets off.
 *
 * Extracted so the web form and the app's endpoint cannot drift. They differ
 * legitimately in what comes before — a Turnstile token on one, an
 * `Idempotency-Key` on the other — but what a booking is worth and who hears
 * about it must be one answer, not two that were the same on the day they
 * were written.
 *
 * Every step is **best effort on purpose**. The reservation is already
 * committed by the time this runs, so a promo that raced to its cap, a
 * membership lookup that fails, or a queue that is down must never turn a
 * booking the customer successfully made into an error they see.
 */
export async function applyBookingDiscounts(
  organizationId: string,
  reservationId: string,
  startingCents: number,
  email: string,
  promo: string | null,
): Promise<number> {
  let amountCents = startingCents;

  // Claim the promo now that the booking exists. This is atomic (uses+1 under
  // the cap), so a code that raced to its limit between validation and here
  // simply yields no discount — the booking still stands at full price.
  if (promo) {
    try {
      const applied = await consumePromo(organizationId, promo, reservationId, amountCents);
      if (applied && applied.discountCents > 0) {
        amountCents = Math.max(0, amountCents - applied.discountCents);
        await sql`
          UPDATE reservation SET amount_cents = ${amountCents}
          WHERE id = ${reservationId}::uuid
        `;
      }
    } catch (promoError) {
      captureException(promoError, {
        where: "publicBook.promo",
        reservationId,
        organizationId,
      });
    }
  }

  // A pass credit or membership discount for a returning customer, matched by
  // the booking email. Runs on whatever is left after the promo.
  try {
    const [cust] = await sql<{ id: string }[]>`
      SELECT id FROM customer
      WHERE organization_id = ${organizationId} AND lower(email) = lower(${email})
    `;
    if (cust) {
      const redeemed = await redeemForBooking(
        organizationId,
        cust.id,
        reservationId,
        amountCents,
      );
      if (redeemed && redeemed.discountCents > 0) {
        amountCents = Math.max(0, amountCents - redeemed.discountCents);
        await sql`
          UPDATE reservation SET amount_cents = ${amountCents}
          WHERE id = ${reservationId}::uuid
        `;
      }
    }
  } catch (memberError) {
    captureException(memberError, {
      where: "publicBook.membership",
      reservationId,
      organizationId,
    });
  }

  return amountCents;
}

/**
 * The confirmation email, the reminder and the webhook.
 *
 * Off the request path and best effort: the booking is committed, so a mail or
 * queue hiccup must not turn a successful reservation into an error. The
 * worker owns retries.
 */
export async function announceBooking(
  organizationId: string,
  reservationId: string,
  startsAt: Date,
): Promise<void> {
  try {
    const job = { reservationId, organizationId };
    await enqueueBookingConfirmation(job);
    await scheduleBookingReminder(job, startsAt);
    await emitBookingEvent(organizationId, "booking.created", reservationId);
  } catch (queueError) {
    // A failed enqueue only costs the email. Record it so a persistently
    // broken queue is visible, but do not fail the customer.
    captureException(queueError, {
      where: "publicBook.enqueue",
      reservationId,
      organizationId,
    });
  }
}
