import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { portfolioRollup } from "@/lib/portfolio";
import { currentVenue } from "@/lib/tenancy";
import { OpenVenue } from "./open-venue";

export const metadata: Metadata = { title: "All venues" };
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");

  const [portfolio, active] = await Promise.all([
    portfolioRollup(session.user.id),
    currentVenue(),
  ]);
  const { venues, totals } = portfolio;

  const stats = [
    { label: "Venues", value: String(totals.venues) },
    { label: "Upcoming", value: String(totals.upcoming) },
    { label: "Bookings, 30d", value: String(totals.bookings30) },
    { label: "Value, 30d", value: formatMoney(totals.revenue30Cents, "PHP") },
  ];

  return (
    <main className="flex-1 py-8 sm:py-12">
      <div className="shell-wide">
        <h1 className="text-head">All venues</h1>
        <p className="mt-2 text-[0.9375rem] text-ink-2">
          Everything you run, rolled up. Booked value is booked, not collected.
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-rule bg-card p-4 shadow-plate">
              <dt className="text-[0.8125rem] text-ink-3">{s.label}</dt>
              <dd className="mt-1.5 font-display text-2xl leading-none tracking-[-0.02em]">{s.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-8 overflow-x-auto rounded-xl border border-rule bg-card shadow-plate">
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-rule">
                {["Venue", "Spaces", "Upcoming", "30d bookings", "30d value", ""].map((h) => (
                  <th key={h} scope="col" className="label px-4 py-3 font-sans text-ink-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {venues.map((v) => {
                const isActive = active?.organizationId === v.organizationId;
                return (
                  <tr key={v.organizationId} className="border-b border-rule last:border-b-0">
                    <td className="px-4 py-3">
                      <span className="font-medium">{v.name}</span>
                      {isActive ? (
                        <span className="ml-2 rounded-pill bg-accent-soft px-2 py-0.5 text-[0.6875rem] text-accent-ink">
                          current
                        </span>
                      ) : null}
                      <span className="block font-mono text-[0.75rem] text-ink-3">
                        reservme.pro/{v.slug}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{v.activeSpaces}</td>
                    <td className="px-4 py-3 tabular-nums">{v.upcoming}</td>
                    <td className="px-4 py-3 tabular-nums">{v.bookings30}</td>
                    <td className="px-4 py-3 tabular-nums">{formatMoney(v.revenue30Cents, "PHP")}</td>
                    <td className="px-4 py-3 text-right">
                      <OpenVenue organizationId={v.organizationId} isActive={isActive} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
