import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { removeCustomerTag } from "@/app/app/customer-actions";
import { grantToCustomer } from "@/app/app/memberships/actions";
import { type CustomerBooking, getCustomer } from "@/lib/customers";
import { listCustomerHoldings, listPlans } from "@/lib/memberships";
import { formatMoney } from "@/lib/money";
import { requireVenue } from "@/lib/tenancy";
import { AddNoteForm, AddTagForm, ContactEditor } from "./profile-forms";
import { DeleteNoteButton } from "./note-actions";

export const metadata: Metadata = { title: "Customer" };
export const dynamic = "force-dynamic";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const STATUS_STYLE: Record<string, string> = {
  confirmed: "bg-accent-soft text-accent-ink",
  no_show: "bg-clay-soft text-clay-ink",
  cancelled: "bg-paper-3 text-ink-3",
};

const STATUS_LABEL: Record<string, string> = {
  confirmed: "confirmed",
  no_show: "no-show",
  cancelled: "cancelled",
};

function fmtDateTime(d: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeZone: timezone,
  }).format(d);
}

export default async function CustomerProfilePage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const venue = await requireVenue();
  const { customerId } = await params;
  const customer = await getCustomer(venue.organizationId, customerId, venue.timezone);
  if (!customer) notFound();

  const [holdings, plans] = await Promise.all([
    listCustomerHoldings(venue.organizationId, customer.id),
    listPlans(venue.organizationId),
  ]);
  const activePlans = plans.filter((p) => p.active);

  const memberSince = new Intl.DateTimeFormat("en-PH", {
    month: "short",
    year: "numeric",
    timeZone: venue.timezone,
  }).format(customer.createdAt);

  const tiles = [
    { label: "Lifetime value", value: formatMoney(customer.lifetimeValueCents, venue.currency) },
    { label: "Bookings", value: String(customer.bookings) },
    { label: "Loyalty points", value: customer.loyaltyPoints.toLocaleString("en-PH") },
    { label: "No-shows", value: String(customer.noShowCount) },
    { label: "Member since", value: memberSince },
  ];

  return (
    <main className="flex-1 py-8 sm:py-12">
      <div className="shell-wide">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/customers"
            className="inline-flex items-center gap-1.5 text-[0.8125rem] text-ink-2 transition-colors duration-[--dur-fast] ease-out hover:text-ink"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4">
              <path d="M12 4l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Customers
          </Link>
          <Link
            href={`/calendar?newFor=${customer.id}`}
            className="inline-flex items-center gap-1.5 rounded-pill bg-accent px-3.5 py-1.5 text-[0.8125rem] font-medium text-on-accent transition-colors duration-[--dur-fast] ease-out hover:bg-accent-hover"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4">
              <path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            New booking
          </Link>
        </div>

        {/* Header */}
        <section className="mt-4 rounded-xl border border-rule bg-card p-5 shadow-plate sm:p-6">
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[0.9375rem] font-medium text-accent-ink"
            >
              {initials(customer.name)}
            </span>
            <div className="min-w-0 flex-1">
              <ContactEditor
                customerId={customer.id}
                name={customer.name}
                email={customer.email}
                phone={customer.phone}
              />
              {/* Tags */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {customer.tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-pill bg-accent-soft py-0.5 pl-2.5 pr-1 text-[0.75rem] text-accent-ink"
                  >
                    {t}
                    <form action={removeCustomerTag}>
                      <input type="hidden" name="customerId" value={customer.id} />
                      <input type="hidden" name="tag" value={t} />
                      <button
                        type="submit"
                        aria-label={`Remove tag ${t}`}
                        className="flex size-4 items-center justify-center rounded-full text-accent-ink/70 hover:bg-accent-line hover:text-accent-ink"
                      >
                        <svg viewBox="0 0 12 12" aria-hidden="true" className="size-2.5">
                          <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      </button>
                    </form>
                  </span>
                ))}
                <AddTagForm customerId={customer.id} />
              </div>
            </div>
          </div>

          {/* Stat tiles */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-lg bg-paper-2 p-4">
                <p className="text-[0.8125rem] text-ink-3">{t.label}</p>
                <p className="mt-1 font-display text-2xl leading-none tracking-[-0.02em]">
                  {t.value}
                </p>
              </div>
            ))}
          </div>
          {customer.lastVisit ? (
            <p className="mt-3 text-[0.8125rem] text-ink-3">
              Last visit {fmtDateTime(customer.lastVisit, venue.timezone)}
            </p>
          ) : null}
        </section>

        {/* Passes & memberships */}
        <section className="mt-6 rounded-xl border border-rule bg-card p-5 shadow-plate sm:p-6">
          <h2 className="text-[0.9375rem] font-semibold">Passes &amp; memberships</h2>

          {holdings.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {holdings.map((h) => (
                <li
                  key={h.id}
                  className={`rounded-lg border px-3 py-2 text-[0.8125rem] ${
                    h.status === "active"
                      ? "border-accent-line bg-accent-soft text-accent-ink"
                      : "border-rule bg-paper-2 text-ink-3"
                  }`}
                >
                  <span className="font-medium">{h.planName}</span>
                  <span className="ml-2">
                    {h.creditsRemaining} credit{h.creditsRemaining === 1 ? "" : "s"}
                    {h.benefitDiscountPct != null ? ` · ${h.benefitDiscountPct}% off` : ""}
                  </span>
                  {h.status !== "active" ? <span className="ml-2">· {h.status}</span> : null}
                  {h.expiresAt ? (
                    <span className="ml-2 opacity-80">
                      · expires {fmtDateTime(h.expiresAt, venue.timezone)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[0.875rem] text-ink-3">No passes or memberships yet.</p>
          )}

          {activePlans.length > 0 ? (
            <form action={grantToCustomer} className="mt-4 flex flex-wrap items-center gap-2">
              <input type="hidden" name="customerId" value={customer.id} />
              <select
                name="planId"
                required
                defaultValue=""
                className="h-10 rounded-sm border border-rule bg-paper-2 px-3 text-[0.875rem]"
              >
                <option value="" disabled>
                  Choose a plan…
                </option>
                {activePlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatMoney(p.priceCents, venue.currency)}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="h-10 whitespace-nowrap rounded-pill bg-accent px-4 text-[0.875rem] font-medium text-on-accent hover:bg-accent-hover"
              >
                Grant
              </button>
            </form>
          ) : (
            <p className="mt-3 text-[0.8125rem] text-ink-3">
              Create a plan on the{" "}
              <Link href="/memberships" className="underline hover:text-ink">
                Memberships
              </Link>{" "}
              page to grant one here.
            </p>
          )}
        </section>

        {/* Body: history + notes */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          {/* Booking history */}
          <section>
            <h2 className="text-[0.9375rem] font-semibold">Booking history</h2>
            {customer.upcoming.length === 0 && customer.past.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-rule-strong bg-paper-2 p-6 text-center text-[0.875rem] text-ink-3">
                No bookings yet.
              </p>
            ) : (
              <div className="mt-3 space-y-5">
                {customer.upcoming.length > 0 ? (
                  <BookingList
                    caption="Upcoming"
                    bookings={customer.upcoming}
                    currency={venue.currency}
                  />
                ) : null}
                {customer.past.length > 0 ? (
                  <BookingList
                    caption="Past"
                    bookings={customer.past}
                    currency={venue.currency}
                  />
                ) : null}
              </div>
            )}
          </section>

          {/* Notes */}
          <section>
            <h2 className="text-[0.9375rem] font-semibold">Notes</h2>
            <AddNoteForm customerId={customer.id} />
            {customer.notes.length === 0 ? (
              <p className="mt-3 text-[0.875rem] text-ink-3">No notes yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {customer.notes.map((n) => (
                  <li
                    key={n.id}
                    className="group rounded-lg border border-rule bg-card p-3 shadow-plate"
                  >
                    <p className="whitespace-pre-wrap text-[0.875rem]">{n.body}</p>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[0.75rem] text-ink-3">
                      <span>
                        {n.authorName ?? "Staff"} · {fmtDateTime(n.createdAt, venue.timezone)}
                      </span>
                      <DeleteNoteButton noteId={n.id} customerId={customer.id} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function BookingList({
  caption,
  bookings,
  currency,
}: {
  caption: string;
  bookings: CustomerBooking[];
  currency: string;
}) {
  return (
    <div>
      <p className="label mb-2 text-ink-3">{caption}</p>
      <ul className="overflow-hidden rounded-lg border border-rule bg-card">
        {bookings.map((b) => (
          <li
            key={b.id}
            className="flex items-center gap-3 border-b border-rule p-3 last:border-b-0"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[0.875rem]">{b.whenLabel}</span>
              <span className="block truncate text-[0.75rem] text-ink-3">{b.spaceName}</span>
            </span>
            <span
              className={`shrink-0 rounded-pill px-2 py-0.5 text-[0.6875rem] ${
                STATUS_STYLE[b.status] ?? "bg-paper-3 text-ink-3"
              }`}
            >
              {STATUS_LABEL[b.status] ?? b.status}
            </span>
            <span className="w-16 shrink-0 text-right text-[0.875rem] tabular-nums">
              {formatMoney(b.amountCents, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
