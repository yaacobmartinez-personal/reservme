import { getDashboard, rangeDays } from "@/lib/analytics";

/**
 * Insights, shaped for the app (API-CONTRACT #33).
 *
 * `getDashboard` is reused whole — every bucket, hour and "today" in it is
 * already computed in the venue's timezone, and the kind rules it encodes are
 * the ones that are easy to get subtly wrong: `rental` + `session_seat` drive
 * counts and value, `rental` + `session_block` drive utilisation. Counting
 * seats as occupancy would show a full court as over-booked.
 *
 * Two deliberate differences from the web's dashboard:
 *
 * * **Value by day is one series, not two.** The web draws revenue and
 *   utilisation as separate charts; the app puts them on one row per day, so
 *   they are merged here rather than zipped on the phone.
 * * **No "awaiting payments" tile.** v1 is pay-at-venue, so there are no
 *   payment records to count and the number would be a permanent zero. Left
 *   out rather than shown.
 */
export async function insightsJson(
  organizationId: string,
  timezone: string,
  period: string | null,
) {
  const { key, days } = rangeDays(period ?? undefined);
  const d = await getDashboard(organizationId, timezone, days);

  const utilisationByDay = new Map(d.utilisationSeries.map((u) => [u.day, u.pct]));

  return {
    range: key,
    bookedValueCents: d.kpis.bookedValueCents,
    bookings: d.kpis.bookings,
    utilisationPct: d.kpis.utilisationPct,
    noShowRatePct: d.kpis.noShowRatePct,
    bookedByDay: d.revenueSeries.map((r) => ({
      day: r.day,
      cents: r.cents,
      utilisationPct: utilisationByDay.get(r.day) ?? 0,
    })),
    peakHours: d.peakHeatmap,
    mix: d.bookingMix,
    bySpace: d.bySpace,
    customers: d.customers,
    needsYou: {
      toCheckIn: d.needsYou.toCheckIn,
      halfEmptySessions: d.needsYou.halfEmptySessions.map((s) => ({
        id: s.id,
        title: s.title,
        // The instant, not the web's pre-rendered label: the phone draws its
        // own in the venue's zone, next to every other time on the screen.
        startsAt: s.startsAt.toISOString(),
        spotsLeft: s.left,
        capacity: s.capacity,
      })),
    },
  };
}
