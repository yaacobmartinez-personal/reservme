import type { Metadata } from "next";
import Link from "next/link";
import { getManageableBooking } from "@/lib/booking/manage";
import { formatMoney } from "@/lib/money";
import { CancelPanel } from "./cancel-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Manage booking", robots: { index: false } };

type Params = { venueSlug: string; token: string };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-rule px-4 py-3 last:border-b-0">
      <span className="text-[0.8125rem] text-ink-3">{label}</span>
      <span className="text-right text-[0.875rem] font-medium">{value}</span>
    </div>
  );
}

export default async function ManageBookingPage({ params }: { params: Promise<Params> }) {
  const { venueSlug, token } = await params;
  const booking = await getManageableBooking(venueSlug, token);

  if (!booking) {
    return (
      <main className="flex flex-1 items-center justify-center py-20">
        <div className="shell max-w-md text-center">
          <h1 className="text-head">Booking not found</h1>
          <p className="mt-4 text-[0.9375rem] text-ink-2">
            This link may have expired or already been used. If you need to change a
            booking, contact the venue directly.
          </p>
        </div>
      </main>
    );
  }

  const cancelled = booking.status === "cancelled";
  const statusTone = cancelled
    ? "text-clay-ink"
    : booking.status === "no_show"
      ? "text-clay-ink"
      : "text-accent-ink";

  return (
    <main data-brand={booking.theme} className="flex-1 py-12 sm:py-16">
      <div className="shell max-w-md">
        {cancelled ? (
          <div className="text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-clay-soft text-clay-ink">
              <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </span>
            <h1 className="mt-5 text-head">Booking cancelled</h1>
            <p className="mt-3 text-[0.9375rem] text-ink-2">
              Your reservation at {booking.venueName} on{" "}
              <span className="font-medium text-ink">{booking.whenLabel}</span> has been
              cancelled. The slot is now open for others.
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-head">Your booking</h1>
            <p className="mt-1 text-[0.9375rem] text-ink-2">{booking.venueName}</p>
          </>
        )}

        <div className="mt-6 overflow-hidden rounded-xl border border-rule bg-card shadow-plate">
          <Row label="Space" value={booking.spaceName} />
          <Row label="When" value={booking.whenLabel} />
          <Row label="Reference" value={<span className="font-mono">{booking.reference}</span>} />
          {booking.amountCents > 0 ? (
            <Row label="Amount" value={formatMoney(booking.amountCents, booking.currency)} />
          ) : null}
          <Row
            label="Status"
            value={
              <span className={statusTone}>
                {booking.status === "no_show" ? "no-show" : booking.status}
              </span>
            }
          />
        </div>

        {cancelled ? (
          <div className="mt-6 text-center">
            <Link
              href={`/${booking.venueSlug}`}
              className="inline-block rounded-pill bg-accent px-5 py-2.5 text-[0.875rem] font-medium text-on-accent hover:bg-accent-hover"
            >
              Book again
            </Link>
          </div>
        ) : booking.cancellation.canCancel ? (
          <div className="mt-6">
            <CancelPanel slug={booking.venueSlug} token={token} />
            <p className="mt-3 text-[0.8125rem] text-ink-3">
              Free to cancel online — the slot will reopen for others.
            </p>
          </div>
        ) : (
          <div className="mt-6 rounded-lg border border-rule bg-paper-2 p-4 text-[0.875rem] text-ink-2">
            {booking.cancellation.reason}
          </div>
        )}

        <p className="mt-8 text-center text-[0.8125rem] text-ink-3">
          Powered by{" "}
          <Link href="/" className="text-accent hover:underline">
            ReservMe
          </Link>
        </p>
      </div>
    </main>
  );
}
