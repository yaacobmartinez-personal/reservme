import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDayAvailability, getDaySessions } from "@/lib/booking/availability";
import { sweepExpiredHolds } from "@/lib/booking/reserve";
import { getDateWindow, getVenueBySlug, getVenueSpaces } from "@/lib/venue";
import { VenueBooking } from "../venue-booking";
import { EmbedResizer } from "./embed-resizer";

export const dynamic = "force-dynamic";

type Params = { venueSlug: string };
type Search = { space?: string; date?: string };

// The embed is a fragment of another site — never index it on its own.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Framed booking widget: the same booking card as the venue page, stripped of
 * the cover, big header and footer so it drops cleanly into a customer's own
 * website. Framing is allowed via a frame-ancestors header (see next.config.ts),
 * and EmbedResizer keeps the iframe sized to its content.
 */
export default async function EmbedPage({
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

  if (venue.suspendedAt) {
    return (
      <main data-brand={venue.theme} className="p-4">
        <p className="text-[0.9375rem] text-ink-2">
          {venue.name} isn&rsquo;t taking online bookings at the moment.
        </p>
        <EmbedResizer />
      </main>
    );
  }

  await sweepExpiredHolds();

  const spaces = await getVenueSpaces(venue.organizationId);
  if (spaces.length === 0) notFound();

  const activeSpace = spaces.find((s) => s.slug === spaceParam) ?? spaces[0];
  const dateWindow = await getDateWindow(venue.timezone, venue.maxHorizonDays, dateParam);
  const activeDate = dateWindow.activeDate;

  const [slots, sessions] = await Promise.all([
    getDayAvailability(venue.organizationId, activeSpace.id, activeDate),
    getDaySessions(venue.organizationId, activeSpace.id, activeDate),
  ]);

  return (
    <main data-brand={venue.theme} className="bg-paper p-3 sm:p-4">
      {venue.coverUrl ? (
        <div className="mb-3 overflow-hidden rounded-lg border border-rule">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={venue.coverUrl} alt="" className="h-24 w-full object-cover sm:h-28" />
        </div>
      ) : null}

      <header className="mb-4 flex items-center gap-3">
        {venue.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={venue.logo}
            alt={venue.name}
            className="size-11 shrink-0 rounded-pill border border-rule object-cover"
          />
        ) : (
          <span className="grid size-11 shrink-0 place-items-center rounded-pill bg-accent-soft font-display text-lg text-accent-ink">
            {venue.name.charAt(0)}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-[1.0625rem] font-semibold leading-tight">{venue.name}</h1>
          {venue.tagline ? (
            <p className="truncate text-[0.8125rem] text-ink-3">{venue.tagline}</p>
          ) : null}
        </div>
      </header>

      <VenueBooking
        venueSlug={venue.slug}
        currency={venue.currency}
        spaces={spaces}
        activeSpace={activeSpace}
        dateWindow={dateWindow}
        slots={slots}
        sessions={sessions}
        basePath={`/${venue.slug}/embed`}
      />

      <p className="mt-4 text-center text-[0.75rem] text-ink-3">
        Powered by{" "}
        <Link href="/" target="_blank" className="text-accent hover:underline">
          ReservMe
        </Link>
      </p>

      <EmbedResizer />
    </main>
  );
}
