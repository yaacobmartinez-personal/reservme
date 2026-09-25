import { z } from "zod";
import { sql } from "@/db";
import { BookingError } from "@/lib/booking/errors";
import {
  cancelReservation,
  markNoShow,
  undoCheckIn,
} from "@/lib/booking/reserve";
import { promoteWaitlistForReservation } from "@/lib/booking/waitlist";
import { conflict, fail, notFound, ok } from "@/lib/mobile/respond";
import { runSheetEntry } from "@/lib/mobile/today-json";
import { isFailure, venueScope } from "@/lib/mobile/venue-scope";
import { emitBookingEvent } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; bookingId: string; action: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["checkin", "undo-checkin", "no-show", "cancel"]);

const body = z.object({ at: z.string().datetime().optional() });

/**
 * POST /api/mobile/venues/{slug}/bookings/{id}/{checkin|undo-checkin|no-show|cancel}
 * — API-CONTRACT #15.
 *
 * Four actions in one handler because they differ only in the verb: same
 * membership check, same scoping, same reply. Each returns the row the way the
 * run sheet reads it, so the app replaces one line rather than refetching the
 * screen — which matters at a counter with a queue.
 *
 * **Any member**, deliberately. Running the day is what every staff account is
 * for; owner/admin gates the structural edits, not the desk.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug, bookingId, action } = await params;

  if (!ACTIONS.has(action)) return notFound("Unknown action.");

  const scope = await venueScope(request, slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(bookingId)) return notFound("We couldn't find that booking.");

  const parsed = body.safeParse(await request.json().catch(() => ({})));
  const at = parsed.success && parsed.data.at ? new Date(parsed.data.at) : null;

  try {
    switch (action) {
      case "checkin":
        await checkIn(scope.organizationId, bookingId, at);
        break;
      case "undo-checkin":
        await undoCheckIn(scope.organizationId, bookingId);
        break;
      case "no-show":
        await markNoShow(scope.organizationId, bookingId);
        break;
      case "cancel":
        await cancelReservation(scope.organizationId, bookingId);
        // The web does both of these after a staff cancel, and the app's
        // customers feel the second one: the slot is free again, so whoever
        // is waiting on it should be told.
        await emitBookingEvent(scope.organizationId, "booking.cancelled", bookingId);
        await promoteWaitlistForReservation(scope.organizationId, bookingId);
        break;
    }
  } catch (error) {
    if (error instanceof BookingError) {
      // The helpers answer `not_found` for both "not yours" and "wrong state" —
      // the UPDATE simply matches no row. Tell them apart here, because the
      // app's sheet has something useful to say about the second and nothing
      // about the first.
      const [row] = await sql<{ status: string; checked_in_at: Date | null }[]>`
        SELECT status, checked_in_at FROM reservation
        WHERE id = ${bookingId}::uuid AND organization_id = ${scope.organizationId}
      `;
      if (!row) return notFound("We couldn't find that booking.");
      return conflict(
        `already_${row.status}`,
        refusal(action, row.status),
        { status: row.status },
      );
    }
    throw error;
  }

  const booking = await runSheetEntry(scope.organizationId, bookingId, scope.timezone);
  return booking ? ok({ booking }) : notFound("We couldn't find that booking.");
}

/**
 * Check-in with an optional time, for a member catching up on a rush after it
 * has passed. The supplied instant is clamped into the booking's own window: a
 * check-in before the slot opens or after it ends is a typo, and storing it
 * would put an arrival outside the booking it belongs to.
 */
async function checkIn(organizationId: string, id: string, at: Date | null) {
  const [row] = await sql<{ id: string }[]>`
    UPDATE reservation
       SET checked_in_at = ${
         at
           ? sql`LEAST(GREATEST(${at}::timestamptz, starts_at), LEAST(ends_at, now()))`
           : sql`now()`
       }
     WHERE id = ${id}::uuid
       AND organization_id = ${organizationId}
       AND status = 'confirmed'
    RETURNING id
  `;
  if (!row) throw new BookingError("not_found");
  return row.id;
}

function refusal(action: string, status: string): string {
  if (status === "cancelled") return "That booking was cancelled.";
  if (status === "no_show") return "That booking is already marked a no-show.";
  if (status === "held" && action !== "cancel") {
    return "That booking isn't confirmed yet.";
  }
  return "That booking can't be changed now.";
}
