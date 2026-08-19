import type { Metadata } from "next";
import { requireVenue } from "@/lib/tenancy";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const PLANNED = [
  {
    title: "Pay at booking",
    body: "Take full payment or a deposit the moment a customer books — no more chasing no-shows.",
  },
  {
    title: "GCash & cards",
    body: "Collect via GCash/QR and cards through a Philippine payment gateway, straight to your account.",
  },
  {
    title: "Sell passes online",
    body: "Let customers buy your passes and memberships themselves — credits land on their account automatically.",
  },
  {
    title: "Automatic refunds",
    body: "Refund to the original method on an eligible cancellation, following your policy.",
  },
];

export default async function PaymentsPage() {
  await requireVenue();

  return (
    <main className="flex-1 py-8 sm:py-12">
      <div className="shell-wide">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-head">Payments</h1>
          <span className="label rounded-pill bg-accent-soft px-2.5 py-0.5 text-accent-ink">
            Coming soon
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-[0.9375rem] text-ink-2">
          Collecting payment from customers at the time of booking is on the way. For
          now, bookings are <b>pay-at-venue</b> — you settle up in person, and your
          ReservMe subscription is handled under{" "}
          <span className="font-medium">Billing</span>.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {PLANNED.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-rule bg-card p-5 shadow-plate"
            >
              <div className="flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-full bg-accent-soft text-[0.75rem] text-accent-ink">
                  ✓
                </span>
                <h2 className="font-medium">{f.title}</h2>
              </div>
              <p className="mt-2 text-[0.875rem] text-ink-2">{f.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-dashed border-rule-strong bg-paper-2 p-6 text-center">
          <p className="text-[0.9375rem] text-ink-2">
            We&rsquo;ll let you know the moment online payments go live.
          </p>
          <p className="mt-1 text-[0.8125rem] text-ink-3">
            Nothing to set up today — your booking page keeps working as it does now.
          </p>
        </div>
      </div>
    </main>
  );
}
