import Link from "next/link";
import {
  cancelBooking,
  checkInBooking,
  noShowBooking,
  undoCheckInBooking,
} from "@/app/app/booking-actions";
import { apexUrl } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import type { ActiveVenue } from "@/lib/tenancy";
import { getRunSheet, getVenueStats } from "@/lib/venue";

const RUN_SHEET_VARIANT = {
  solid: "border-ink bg-ink text-paper hover:opacity-90",
  plain: "border-rule text-ink-2 hover:border-rule-strong hover:text-ink",
  danger: "border-rule text-ink-3 hover:border-clay/50 hover:text-clay-ink",
} as const;

/** A single run-sheet action rendered as its own form (server action). */
function RunSheetButton({
  action,
  id,
  label,
  variant = "plain",
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  label: string;
  variant?: keyof typeof RUN_SHEET_VARIANT;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="reservationId" value={id} />
      <button
        type="submit"
        className={[
          "whitespace-nowrap rounded-pill border px-3 py-1.5 text-[0.8125rem]",
          "transition-colors duration-[--dur-fast] ease-out",
          RUN_SHEET_VARIANT[variant],
        ].join(" ")}
      >
        {label}
      </button>
    </form>
  );
}

const STATUS_STYLE: Record<string, string> = {
  confirmed: "border-accent-line bg-accent-soft text-accent-ink",
  held: "border-clay/40 bg-clay-soft text-clay-ink",
};

/**
 * The venue's own view of today. Rendered both for the real owner on
 * app.reservme.pro and for a platform admin impersonating them inside the
 * admin console, so the two can never drift apart.
 */
export async function VenueDashboard({ venue }: { venue: ActiveVenue }) {
  const [runSheet, stats] = await Promise.all([
    getRunSheet(venue.organizationId, venue.timezone),
    getVenueStats(venue.organizationId, venue.timezone),
  ]);

  const today = new Intl.DateTimeFormat("en-PH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: venue.timezone,
  }).format(new Date());

  const bookingUrl = apexUrl(`/${venue.slug}`);

  return (
    <>
      <p className="label text-ink-3">{today}</p>
      <h1 className="mt-2 text-head">{venue.name}</h1>
      <p className="mt-2 text-[0.9375rem] text-ink-2">
        Booking page:{" "}
        <a
          href={bookingUrl}
          className="rounded-xs text-accent underline decoration-accent-line underline-offset-4 hover:decoration-accent"
        >
          {bookingUrl.replace(/^https?:\/\//, "")}
        </a>
      </p>

      <dl className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Bookings today", value: String(stats.todayCount) },
          { label: "Upcoming", value: String(stats.upcomingCount) },
          {
            label: "Taken today",
            value: formatMoney(stats.todayRevenueCents, venue.currency),
          },
          { label: "Active spaces", value: String(stats.activeSpaces) },
        ].map((stat) => (
          <div
            key={stat.label}
            className="min-w-0 rounded-lg border border-rule bg-card p-5 shadow-plate"
          >
            <dt className="text-[0.875rem] text-ink-3">{stat.label}</dt>
            <dd className="mt-2 font-display text-3xl leading-none tracking-[-0.03em]">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <section className="mt-10">
        <h2 className="text-2xl">Run sheet</h2>

        {runSheet.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-rule-strong bg-card p-10 text-center">
            <p className="text-[0.9375rem] text-ink-2">Nothing booked today yet.</p>
            <p className="mt-2 text-[0.875rem] text-ink-3">
              Share{" "}
              <Link href={bookingUrl} className="text-accent hover:underline">
                the booking page
              </Link>{" "}
              and reservations land here.
            </p>
          </div>
        ) : (
          <ul className="mt-4 overflow-hidden rounded-lg border border-rule bg-card shadow-plate">
            {runSheet.map((booking) => {
              const checkedIn = booking.checked_in_at !== null;
              const badgeStyle = checkedIn
                ? "border-accent bg-accent text-on-accent"
                : (STATUS_STYLE[booking.status] ?? "border-rule text-ink-3");
              return (
                <li
                  key={booking.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-rule p-4 last:border-b-0 sm:p-5"
                >
                  <span className="w-24 shrink-0 font-mono text-[0.875rem]">
                    {booking.label}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {booking.customer_name ?? "Walk-in"}
                    </span>
                    <span className="block truncate text-[0.875rem] text-ink-3">
                      {booking.space_name}
                      {booking.kind === "session_seat"
                        ? ` · ${booking.party_size} spot${booking.party_size === 1 ? "" : "s"}`
                        : ""}
                      {booking.customer_phone ? ` · ${booking.customer_phone}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[0.875rem] text-ink-2">
                    {formatMoney(booking.amount_cents, venue.currency)}
                  </span>
                  <span
                    className={[
                      "label shrink-0 rounded-pill border px-2.5 py-1",
                      badgeStyle,
                    ].join(" ")}
                  >
                    {booking.status === "held"
                      ? "Holding"
                      : checkedIn
                        ? "Checked in"
                        : "Confirmed"}
                  </span>

                  <div className="flex w-full items-center gap-1.5 sm:w-auto">
                    {booking.status === "confirmed" ? (
                      checkedIn ? (
                        <RunSheetButton
                          action={undoCheckInBooking}
                          id={booking.id}
                          label="Undo"
                        />
                      ) : (
                        <>
                          <RunSheetButton
                            action={checkInBooking}
                            id={booking.id}
                            label="Check in"
                            variant="solid"
                          />
                          <RunSheetButton
                            action={noShowBooking}
                            id={booking.id}
                            label="No-show"
                          />
                        </>
                      )
                    ) : null}
                    <RunSheetButton
                      action={cancelBooking}
                      id={booking.id}
                      label="Cancel"
                      variant="danger"
                    />
                    <span className="ml-auto font-mono text-[0.75rem] text-ink-3 sm:ml-2">
                      {booking.reference}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
