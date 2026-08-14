import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDayAvailability, getDaySessions } from "@/lib/booking/availability";
import { sweepExpiredHolds } from "@/lib/booking/reserve";
import { formatMoney } from "@/lib/money";
import { getLocalDates, getVenueBySlug, getVenueSpaces } from "@/lib/venue";
import { BookingForm } from "./booking-form";

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

  const linkFor = (next: { space?: string; date?: string }) => {
    const query = new URLSearchParams({
      space: next.space ?? activeSpace.slug,
      date: next.date ?? activeDate,
    });
    return `/${venue.slug}?${query}`;
  };

  return (
    <main className="flex-1 py-10 sm:py-16">
      <div className="shell max-w-3xl">
        {/* Venue identity */}
        <header className="flex items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-pill bg-accent-soft font-display text-2xl text-accent-ink">
            {venue.name.charAt(0)}
          </span>
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

        <div className="mt-8 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
          {/* Spaces */}
          {spaces.length > 1 ? (
            <nav aria-label="Spaces" className="flex flex-wrap gap-2">
              {spaces.map((space) => {
                const active = space.id === activeSpace.id;
                return (
                  <Link
                    key={space.id}
                    href={linkFor({ space: space.slug })}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "whitespace-nowrap rounded-pill border px-3.5 py-1.5 text-[0.8125rem]",
                      "transition-colors duration-[--dur-fast] ease-out",
                      active
                        ? "border-ink bg-ink text-paper"
                        : "border-rule bg-card text-ink-2 hover:border-rule-strong hover:text-ink",
                    ].join(" ")}
                  >
                    {space.name}
                  </Link>
                );
              })}
            </nav>
          ) : null}

          {/* Dates */}
          <nav aria-label="Dates" className="mt-5 grid grid-cols-7 gap-1.5">
            {dates.map((date) => {
              const active = date.d === activeDate;
              return (
                <Link
                  key={date.d}
                  href={linkFor({ date: date.d })}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "flex flex-col items-center gap-0.5 rounded-sm border py-2",
                    "transition-colors duration-[--dur-fast] ease-out",
                    active
                      ? "border-ink bg-ink text-paper"
                      : "border-rule bg-card text-ink-2 hover:border-rule-strong",
                  ].join(" ")}
                >
                  <span className="label opacity-70">{date.weekday}</span>
                  <span className="font-mono text-[0.9375rem] leading-none">
                    {date.day}
                  </span>
                </Link>
              );
            })}
          </nav>

          <p className="mt-5 flex items-baseline justify-between gap-3 border-t border-rule pt-5">
            <span className="text-[0.9375rem] font-medium">{activeSpace.name}</span>
            <span className="text-[0.875rem] text-ink-3">
              {formatMoney(activeSpace.priceCents, venue.currency)} /{" "}
              {activeSpace.slotMinutes} min
            </span>
          </p>

          <div className="mt-6">
            <BookingForm
              key={`${activeSpace.id}:${activeDate}`}
              venueSlug={venue.slug}
              spaceId={activeSpace.id}
              slots={slots}
              currency={venue.currency}
            />
          </div>
        </div>

        {/* Shared sessions */}
        {sessions.length > 0 ? (
          <section className="mt-6">
            <h2 className="text-xl">Sessions on this day</h2>
            <ul className="mt-3 space-y-2">
              {sessions.map((session) => (
                <li
                  key={session.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-accent-line bg-accent-soft p-4"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-accent-ink">
                      {session.title}
                    </span>
                    <span className="block truncate text-[0.875rem] text-accent-ink/75">
                      {session.label} ·{" "}
                      {session.spotsLeft > 0
                        ? `${session.spotsLeft} of ${session.capacity} spots left`
                        : "Full"}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[0.875rem] text-accent-ink">
                    {formatMoney(session.pricePerPersonCents, venue.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

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
