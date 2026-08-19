import type { Metadata } from "next";
import { sql } from "@/db";
import { formatMoney } from "@/lib/money";
import { listPromoCodes } from "@/lib/promo";
import { requireVenue } from "@/lib/tenancy";
import { setPromoActive } from "./actions";
import { PromoForm } from "./promo-form";
import { ReviewLinkForm } from "./review-form";

export const metadata: Metadata = { title: "Marketing" };
export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  const venue = await requireVenue();
  const [codes, [venueRow]] = await Promise.all([
    listPromoCodes(venue.organizationId),
    sql<{ review_url: string | null }[]>`
      SELECT review_url FROM venue WHERE organization_id = ${venue.organizationId}
    `,
  ]);

  const expiryFmt = new Intl.DateTimeFormat("en-PH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: venue.timezone,
  });

  return (
    <main className="flex-1 py-8 sm:py-12">
      <div className="shell max-w-3xl">
        <h1 className="text-head">Marketing</h1>
        <p className="mt-2 text-[0.9375rem] text-ink-2">
          Promo codes discount a customer&rsquo;s booking at checkout. Set a percentage
          or a fixed peso amount, and cap the number of uses if you like.
        </p>

        <div className="mt-8">
          <PromoForm />
        </div>

        <h2 className="mt-10 text-[0.9375rem] font-medium text-ink-2">Your codes</h2>
        {codes.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-rule-strong bg-paper-2 p-10 text-center text-[0.9375rem] text-ink-3">
            No promo codes yet. Create one above.
          </p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-xl border border-rule bg-card shadow-plate">
            <table className="w-full text-[0.9375rem]">
              <thead>
                <tr className="border-b border-rule bg-paper-2 text-left text-[0.8125rem] text-ink-3">
                  <th className="px-4 py-2.5 font-medium">Code</th>
                  <th className="px-4 py-2.5 font-medium">Discount</th>
                  <th className="px-4 py-2.5 font-medium">Used</th>
                  <th className="px-4 py-2.5 font-medium">Expires</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.id} className="border-b border-rule last:border-b-0">
                    <td className="px-4 py-3 font-mono font-medium">{c.code}</td>
                    <td className="px-4 py-3">
                      {c.kind === "percent"
                        ? `${c.value}% off`
                        : `${formatMoney(c.value, venue.currency)} off`}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-ink-2">
                      {c.uses}
                      {c.maxUses !== null ? ` / ${c.maxUses}` : ""}
                    </td>
                    <td className="px-4 py-3 text-ink-2">
                      {c.expiresAt ? expiryFmt.format(c.expiresAt) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-pill px-2 py-0.5 text-[0.75rem] ${
                          c.active
                            ? "bg-accent-soft text-accent-ink"
                            : "bg-paper-3 text-ink-3"
                        }`}
                      >
                        {c.active ? "active" : "paused"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <form action={setPromoActive}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="active" value={c.active ? "false" : "true"} />
                        <button
                          type="submit"
                          className="text-[0.875rem] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
                        >
                          {c.active ? "Pause" : "Resume"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2 className="mt-12 text-head">Engagement</h2>
        <p className="mt-2 text-[0.9375rem] text-ink-2">
          Automatic emails that bring customers back. Win-back nudges go to
          opted-in customers who haven&rsquo;t visited in a while; review requests
          go out after a visit once you set a link below.
        </p>

        <div className="mt-6">
          <ReviewLinkForm reviewUrl={venueRow?.review_url ?? null} />
        </div>
      </div>
    </main>
  );
}
