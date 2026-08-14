import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/admin/access";
import { listTenants, monthlyRunRate, platformTotals } from "@/lib/admin/queries";
import { peso } from "@/content/marketing";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Tenants" };
export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const admin = await requirePlatformAdmin();
  const [tenants, totals] = await Promise.all([listTenants(), platformTotals()]);
  const runRate = await monthlyRunRate(tenants);

  return (
    <main className="flex-1 py-10 sm:py-14">
      <div className="shell">
        <h1 className="text-head">Tenants</h1>
        <p className="mt-2 text-[0.9375rem] text-ink-2">
          Signed in as {admin.name} ({admin.email})
        </p>

        <dl className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
          {[
            { label: "Venues", value: String(totals.tenants) },
            { label: "Suspended", value: String(totals.suspended) },
            { label: "Active spaces", value: String(totals.spaces) },
            { label: "Bookings, 30d", value: String(totals.bookings_30) },
            { label: "Run rate / mo", value: peso(runRate) },
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

        <div className="mt-10 overflow-x-auto rounded-lg border border-rule bg-card shadow-plate">
          <table className="w-full min-w-[52rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-rule">
                {["Venue", "Band", "Spaces", "Upcoming", "30d bookings", "30d value", ""].map(
                  (heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="label px-4 py-3 font-sans text-ink-3"
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {tenants.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-ink-3">
                    No venues yet.
                  </td>
                </tr>
              ) : null}

              {tenants.map((tenant) => (
                <tr key={tenant.organizationId} className="border-b border-rule last:border-b-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/tenant/${tenant.organizationId}`}
                      className="font-medium hover:text-accent"
                    >
                      {tenant.name}
                    </Link>
                    <span className="block font-mono text-[0.75rem] text-ink-3">
                      /{tenant.slug} · {tenant.timezone}
                    </span>
                    {tenant.suspendedAt ? (
                      <span className="label mt-1 inline-block rounded-pill border border-clay/40 bg-clay-soft px-2 py-0.5 text-clay-ink">
                        Suspended
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[0.9375rem]">{tenant.band.name}</span>
                    <span className="block font-mono text-[0.75rem] text-ink-3">
                      {tenant.band.price === null ? "quoted" : peso(tenant.band.price)}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[0.875rem]">
                    {tenant.activeSpaces}
                  </td>
                  <td className="px-4 py-3 font-mono text-[0.875rem]">
                    {tenant.upcomingBookings}
                  </td>
                  <td className="px-4 py-3 font-mono text-[0.875rem]">
                    {tenant.bookingsLast30}
                  </td>
                  <td className="px-4 py-3 font-mono text-[0.875rem]">
                    {formatMoney(tenant.revenueLast30Cents, tenant.currency)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/tenant/${tenant.organizationId}`}
                      className="whitespace-nowrap rounded-pill border border-rule-strong px-3 py-1.5 text-[0.8125rem] transition-colors duration-[--dur-fast] ease-out hover:border-ink"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
