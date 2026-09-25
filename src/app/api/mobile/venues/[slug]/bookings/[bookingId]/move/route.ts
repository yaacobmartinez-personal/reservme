import { z } from "zod";
import { BookingError } from "@/lib/booking/errors";
import { moveReservation } from "@/lib/booking/reserve";
import { instantAt, wallClock } from "@/lib/mobile/calendar-json";
import { conflict, fail, invalid, notFound, ok } from "@/lib/mobile/respond";
import { runSheetEntry } from "@/lib/mobile/today-json";
import { isFailure, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; bookingId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  spaceId: z.string().uuid(),
  date: z.string(),
  time: z.string(),
});

/**
 * POST /api/mobile/venues/{slug}/bookings/{id}/move — API-CONTRACT #18.
 *
 * A move carries the booking's own length to the new slot and reprices it
 * there — an 18:00 peak hour costs what 18:00 costs, wherever it came from.
 * Moving onto a taken slot is refused rather than forced: the exclusion
 * constraint is the authority, not the grid the desk was looking at.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug, bookingId } = await params;
  const scope = await venueScope(request, slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(bookingId)) return notFound("We couldn't find that booking.");

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid({ time: "Check the new time." });

  const wc = wallClock(parsed.data.date, parsed.data.time);
  if (!wc) return invalid({ time: "That start time isn't valid." });

  try {
    await moveReservation(
      scope.organizationId,
      bookingId,
      parsed.data.spaceId,
      await instantAt(wc, scope.timezone),
    );
  } catch (error) {
    if (error instanceof BookingError) {
      if (error.reason === "not_found") return notFound(error.message);
      return conflict(error.reason, error.message);
    }
    throw error;
  }

  const booking = await runSheetEntry(scope.organizationId, bookingId, scope.timezone);
  return booking ? ok({ booking }) : notFound("We couldn't find that booking.");
}
