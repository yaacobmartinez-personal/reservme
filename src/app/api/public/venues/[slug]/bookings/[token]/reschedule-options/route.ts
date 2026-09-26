import { getDayAvailability } from "@/lib/booking/availability";
import { getManageableBooking } from "@/lib/booking/manage";
import { notFound, ok } from "@/lib/mobile/respond";
import { getLocalDates } from "@/lib/venue";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; token: string }> };

/**
 * GET …/bookings/{token}/reschedule-options?days=7 — API-CONTRACT #7.
 *
 * Open slots on the **same space**, over the next `days` venue-local dates.
 * Same space on purpose: moving a booking is not rebooking it, and offering
 * another court would quietly change what the customer paid for.
 *
 * Built on `getDayAvailability` like every other slot grid, so the notice
 * window, the horizon, closures and the buffer are all decided in one place.
 * The web's `rescheduleOptions` narrows each slot to a time and an instant for
 * its own picker; the app draws the same grid it books from, so the slots come
 * back whole.
 */
export async function GET(request: Request, { params }: Params) {
  const { slug, token } = await params;
  const booking = await getManageableBooking(slug, token);
  if (!booking) return notFound("This link is no longer valid.");

  const raw = Number(new URL(request.url).searchParams.get("days") ?? 7);
  const days = Number.isFinite(raw) ? Math.min(30, Math.max(1, Math.trunc(raw))) : 7;

  const dates = await getLocalDates(booking.timezone, days);
  const out = [];
  for (const date of dates) {
    const slots = await getDayAvailability(booking.organizationId, booking.spaceId, date.d);
    out.push({
      date: date.d,
      slots: slots
        .filter((s) => s.available)
        .map((s) => ({
          startsAt: s.startsAt.toISOString(),
          endsAt: s.endsAt.toISOString(),
          label: s.label,
          available: s.available,
          reason: s.reason,
          priceCents: s.priceCents,
          peak: s.peak,
        })),
    });
  }

  return ok({ days: out });
}
