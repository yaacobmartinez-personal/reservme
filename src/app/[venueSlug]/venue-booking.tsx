import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { getDayAvailability, getDaySessions } from "@/lib/booking/availability";
import type { DateWindow, getVenueSpaces } from "@/lib/venue";
import { BookingForm } from "./booking-form";
import { DateJump } from "./date-jump";
import { WaitlistJoin } from "./waitlist-join";

type Spaces = Awaited<ReturnType<typeof getVenueSpaces>>;
type Slots = Awaited<ReturnType<typeof getDayAvailability>>;
type Sessions = Awaited<ReturnType<typeof getDaySessions>>;

/**
 * The booking card — spaces, dates, price, the form, the waitlist and any shared
 * sessions. Shared by the full venue page and the /embed route so an embedded
 * widget can never drift from the real page. `basePath` keeps the space/date
 * links inside whichever surface is rendering it (/slug vs /slug/embed).
 */
export function VenueBooking({
  venueSlug,
  currency,
  spaces,
  activeSpace,
  dateWindow,
  slots,
  sessions,
  basePath,
}: {
  venueSlug: string;
  currency: string;
  spaces: Spaces;
  activeSpace: Spaces[number];
  dateWindow: DateWindow;
  slots: Slots;
  sessions: Sessions;
  basePath: string;
}) {
  const { today, maxDate, activeDate, dates, prevWeekDate, nextWeekDate } = dateWindow;
  const linkFor = (next: { space?: string; date?: string }) => {
    const query = new URLSearchParams({
      space: next.space ?? activeSpace.slug,
      date: next.date ?? activeDate,
    });
    return `${basePath}?${query}`;
  };

  return (
    <>
      <div className="rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
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

        <div className="mt-5 flex items-center gap-1.5">
          {prevWeekDate ? (
            <Link
              href={linkFor({ date: prevWeekDate })}
              aria-label="Previous week"
              className="flex size-9 shrink-0 items-center justify-center rounded-sm border border-rule text-ink-2 transition-colors duration-[--dur-fast] ease-out hover:border-rule-strong hover:text-ink"
            >
              ‹
            </Link>
          ) : (
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-sm border border-rule text-ink-3 opacity-40"
            >
              ‹
            </span>
          )}

          <nav aria-label="Dates" className="grid flex-1 grid-cols-7 gap-1.5">
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
                  <span className="font-mono text-[0.9375rem] leading-none">{date.day}</span>
                </Link>
              );
            })}
          </nav>

          {nextWeekDate ? (
            <Link
              href={linkFor({ date: nextWeekDate })}
              aria-label="Next week"
              className="flex size-9 shrink-0 items-center justify-center rounded-sm border border-rule text-ink-2 transition-colors duration-[--dur-fast] ease-out hover:border-rule-strong hover:text-ink"
            >
              ›
            </Link>
          ) : (
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-sm border border-rule text-ink-3 opacity-40"
            >
              ›
            </span>
          )}
        </div>

        <div className="mt-3">
          <DateJump
            basePath={basePath}
            spaceSlug={activeSpace.slug}
            value={activeDate}
            min={today}
            max={maxDate}
          />
        </div>

        <p className="mt-5 flex items-baseline justify-between gap-3 border-t border-rule pt-5">
          <span className="text-[0.9375rem] font-medium">{activeSpace.name}</span>
          <span className="text-[0.875rem] text-ink-3">
            {formatMoney(activeSpace.priceCents, currency)} / {activeSpace.slotMinutes} min
          </span>
        </p>

        <div className="mt-6">
          <BookingForm
            key={`${activeSpace.id}:${activeDate}`}
            venueSlug={venueSlug}
            spaceId={activeSpace.id}
            slots={slots}
            currency={currency}
          />
        </div>
      </div>

      <WaitlistJoin
        venueSlug={venueSlug}
        spaceId={activeSpace.id}
        takenSlots={slots
          .filter((s) => s.reason === "taken")
          .map((s) => ({
            time: s.label,
            startsAtISO: s.startsAt.toISOString(),
            endsAtISO: s.endsAt.toISOString(),
          }))}
      />

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
                  {formatMoney(session.pricePerPersonCents, currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
