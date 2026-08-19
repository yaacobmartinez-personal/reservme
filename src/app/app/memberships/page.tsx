import type { Metadata } from "next";
import { formatMoney } from "@/lib/money";
import { listPlans } from "@/lib/memberships";
import { requireVenue } from "@/lib/tenancy";
import { setPlanActive } from "./actions";
import { PlanForm } from "./plan-form";

export const metadata: Metadata = { title: "Memberships" };
export const dynamic = "force-dynamic";

function benefitLabel(
  credits: number | null,
  pct: number | null,
  period: string,
): string {
  const parts: string[] = [];
  if (credits != null) parts.push(`${credits} credit${credits === 1 ? "" : "s"}`);
  if (pct != null) parts.push(`${pct}% off bookings`);
  const base = parts.join(" + ") || "—";
  return period === "monthly" ? `${base} / month` : base;
}

export default async function MembershipsPage() {
  const venue = await requireVenue();
  const plans = await listPlans(venue.organizationId);

  return (
    <main className="flex-1 py-8 sm:py-12">
      <div className="shell-wide">
        <h1 className="text-head">Memberships &amp; passes</h1>
        <p className="mt-2 max-w-2xl text-[0.9375rem] text-ink-2">
          Sell packs of booking credits or recurring memberships. Grant a plan to a
          customer from their profile; credits are used automatically when they book,
          and any discount applies to what&rsquo;s left. Payment is collected at your
          venue.
        </p>

        <div className="mt-8">
          <PlanForm />
        </div>

        <h2 className="mt-10 text-[0.9375rem] font-medium text-ink-2">Your plans</h2>
        {plans.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-rule-strong bg-paper-2 p-10 text-center text-[0.9375rem] text-ink-3">
            No plans yet. Create one above.
          </p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-xl border border-rule bg-card shadow-plate">
            <table className="w-full text-[0.9375rem]">
              <thead>
                <tr className="border-b border-rule bg-paper-2 text-left text-[0.8125rem] text-ink-3">
                  <th className="px-4 py-2.5 font-medium">Plan</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Benefit</th>
                  <th className="px-4 py-2.5 font-medium">Price</th>
                  <th className="px-4 py-2.5 font-medium">Holders</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className="border-b border-rule last:border-b-0">
                    <td className="px-4 py-3 font-medium">{p.name}</td>
                    <td className="px-4 py-3 capitalize text-ink-2">{p.kind}</td>
                    <td className="px-4 py-3 text-ink-2">
                      {benefitLabel(p.credits, p.benefitDiscountPct, p.period)}
                      {p.validDays != null ? (
                        <span className="block text-[0.8125rem] text-ink-3">
                          valid {p.validDays} days
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatMoney(p.priceCents, venue.currency)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-ink-2">{p.holders}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-pill px-2 py-0.5 text-[0.75rem] ${
                          p.active ? "bg-accent-soft text-accent-ink" : "bg-paper-3 text-ink-3"
                        }`}
                      >
                        {p.active ? "active" : "paused"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <form action={setPlanActive}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="active" value={p.active ? "false" : "true"} />
                        <button
                          type="submit"
                          className="text-[0.875rem] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
                        >
                          {p.active ? "Pause" : "Resume"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
