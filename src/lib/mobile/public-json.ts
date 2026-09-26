import { getDayAvailability, getDaySessions, type Slot } from "@/lib/booking/availability";
import { getVenueBySlug, getVenueSpaces, type PublicVenue, type VenueSpace } from "@/lib/venue";

/**
 * The public, account-less half of the app (API-CONTRACT #1, #2).
 *
 * Everything here answers an **unauthenticated** request, which changes what
 * care is owed: there is no membership to scope by, so the venue slug in the
 * path is the whole of the authorisation, and every one of these reads is
 * deliberately about a venue that has chosen to be public.
 *
 * What is *not* here is anything the venue would not put on a poster. A
 * suspended venue still answers — its page has to explain itself rather than
 * 404 — but it carries `suspended: true` and takes no bookings.
 */

function spaceJson(space: VenueSpace) {
  return {
    id: space.id,
    name: space.name,
    slug: space.slug,
    kind: space.kind,
    capacity: space.capacity,
    slotMinutes: space.slotMinutes,
    bufferMinutes: space.bufferMinutes,
    priceCents: space.priceCents,
    // `getVenueSpaces` returns active spaces only; the flag is here because
    // the app's model carries it and a false would be a lie.
    isActive: true,
    sortOrder: space.sortOrder,
    imageUrl: space.imageUrl,
    peakPriceCents: space.peakPriceCents,
    // Null, meaning "not counted", rather than 0, which would read as "none
    // left". Counting open slots per space costs a full availability pass per
    // space on the busiest page there is — see docs/DEFERRED.md D22.
    openToday: null,
  };
}

export function venueJson(venue: PublicVenue, spaces: VenueSpace[]) {
  return {
    id: venue.organizationId,
    slug: venue.slug,
    name: venue.name,
    tagline: venue.tagline,
    address: venue.address,
    timezone: venue.timezone,
    currency: venue.currency,
    theme: venue.theme,
    logoUrl: venue.logo,
    coverUrl: venue.coverUrl,
    minNoticeMinutes: venue.minNoticeMinutes,
    maxHorizonDays: venue.maxHorizonDays,
    cancellationMode: venue.cancellationMode,
    cancellationGraceHours: venue.cancellationGraceHours,
    refundTerms: venue.refundTerms,
    gcashName: venue.gcashName,
    // A boolean, not the instant: when a venue was suspended is between it and
    // the platform, and the page only needs to know that it is.
    suspended: venue.suspendedAt !== null,
    spaces: spaces.map(spaceJson),
  };
}

/** #1 — the venue page, or null when there is no such venue. */
export async function publicVenue(slug: string) {
  const venue = await getVenueBySlug(slug);
  if (!venue) return null;
  return venueJson(venue, await getVenueSpaces(venue.organizationId));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function dateProblem(date: string | null): string | null {
  if (!date || !DATE.test(date)) return "Pick a date.";
  return null;
}

function slotJson(slot: Slot) {
  return {
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    label: slot.label,
    available: slot.available,
    reason: slot.reason,
    priceCents: slot.priceCents,
    peak: slot.peak,
  };
}

/**
 * #2 — one space, one venue-local date.
 *
 * Availability is a **prediction**. The exclusion constraint in the database
 * is the authority, so a slot that reads `open` here can still come back
 * `slot_taken` on booking, and both surfaces are built around that rather than
 * around this being the truth.
 */
export async function availabilityJson(
  organizationId: string,
  spaceId: string,
  date: string,
) {
  const [slots, sessions] = await Promise.all([
    getDayAvailability(organizationId, spaceId, date),
    getDaySessions(organizationId, spaceId, date),
  ]);

  return {
    date,
    slots: slots.map(slotJson),
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      label: s.label,
      capacity: s.capacity,
      bookedSpots: s.bookedSpots,
      pricePerPersonCents: s.pricePerPersonCents,
    })),
  };
}
