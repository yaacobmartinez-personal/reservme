import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDayAvailability, getDaySessions } from "@/lib/booking/availability";
import { sweepExpiredHolds } from "@/lib/booking/reserve";
import { getLocalDates, getVenueBySlug, getVenueSpaces } from "@/lib/venue";
import { VenueBooking } from "./venue-booking";

export const dynamic = "force-dynamic";

type Params = { venueSlug: string };
type Search = { space?: string; date?: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { venueSlug } = await params;
  const venue = await getVenueBySlug(venueSlug);
  if (!venue) return { title: "Venue not found" };

  return {
    title: `Book ${venue.name}`,
    description: venue.tagline ?? `Reserve online at ${venue.name}.`,
  };
}

export default async function VenuePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { venueSlug } = await params;
  const { space: spaceParam, date: dateParam } = await searchParams;

  const venue = await getVenueBySlug(venueSlug);
  if (!venue) notFound();

  // A suspended venue takes no new bookings. Existing reservations stand —
  // cancelling someone's Saturday court over a billing dispute is the venue's
  // call, not ours.
  if (venue.suspendedAt) {
    return (
      <main className="flex flex-1 items-center justify-center py-20">
        <div className="shell max-w-md text-center">
          <h1 className="text-head">{venue.name}</h1>
          <p className="mt-4 text-sub text-ink-2">
            This venue isn&rsquo;t taking online bookings at the moment.
          </p>
          <p className="mt-3 text-[0.875rem] text-ink-3">
            If you already have a reservation it still stands — contact the venue
            directly if you need to change it.
          </p>
        </div>
      </main>
    );
  }

  // Expired holds shouldn't keep a slot looking taken. The scheduled sweep is
  // the real mechanism; this just means a customer never sees a stale hold.
  await sweepExpiredHolds();

  const spaces = await getVenueSpaces(venue.organizationId);
  if (spaces.length === 0) notFound();

  const activeSpace = spaces.find((s) => s.slug === spaceParam) ?? spaces[0];
  const dates = await getLocalDates(venue.timezone, 7);
  const activeDate = dates.find((d) => d.d === dateParam)?.d ?? dates[0].d;

  const [slots, sessions] = await Promise.all([
    getDayAvailability(venue.organizationId, activeSpace.id, activeDate),
    getDaySessions(venue.organizationId, activeSpace.id, activeDate),
  ]);

  return (
    <main data-brand={venue.theme} className="flex-1 py-10 sm:py-16">
      <div className="shell max-w-3xl">
        {/* Cover photo */}
        {venue.coverUrl ? (
          <div className="mb-6 overflow-hidden rounded-xl border border-rule">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={venue.coverUrl} alt="" className="h-40 w-full object-cover sm:h-52" />
          </div>
        ) : null}

        {/* Venue identity */}
        <header className="flex items-center gap-4">
          {venue.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={venue.logo}
              alt={venue.name}
              className="size-14 shrink-0 rounded-pill border border-rule object-cover"
            />
          ) : (
            <span className="grid size-14 shrink-0 place-items-center rounded-pill bg-accent-soft font-display text-2xl text-accent-ink">
              {venue.name.charAt(0)}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-head">{venue.name}</h1>
            {venue.tagline ? (
              <p className="mt-1 text-[0.9375rem] text-ink-2">{venue.tagline}</p>
            ) : null}
          </div>
        </header>

        {venue.address ? (
          <p className="mt-4 text-[0.875rem] text-ink-3">{venue.address}</p>
        ) : null}

        <div className="mt-8">
          <VenueBooking
            venueSlug={venue.slug}
            currency={venue.currency}
            spaces={spaces}
            activeSpace={activeSpace}
            dates={dates}
            activeDate={activeDate}
            slots={slots}
            sessions={sessions}
            basePath={`/${venue.slug}`}
          />
        </div>

        <footer className="mt-10 border-t border-rule pt-6 text-[0.8125rem] text-ink-3">
          <p>
            {venue.cancellationMode === "never"
              ? "Bookings can't be cancelled online — contact the venue."
              : venue.cancellationMode === "anytime"
                ? "Cancel online any time before the start."
                : `Cancel online up to ${venue.cancellationGraceHours} hours before the start.`}
          </p>
          {venue.refundTerms ? <p className="mt-1">{venue.refundTerms}</p> : null}
          <p className="mt-4">
            Powered by <Link href="/" className="text-accent hover:underline">ReservMe</Link>
          </p>
        </footer>
      </div>
    </main>
  );
}
