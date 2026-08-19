import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/admin/access";
import {
  billingRadar,
  growthMetrics,
  listTenants,
  monthlyRunRate,
  platformTotals,
  type TenantRow,
} from "@/lib/admin/queries";
import { peso } from "@/content/marketing";
import { formatMoney } from "@/lib/money";
import { GrowthChart } from "./growth-chart";

export const metadata: Metadata = { title: "Tenants" };
export const dynamic = "force-dynamic";

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "trialing", label: "Trialing" },
  { key: "overdue", label: "Overdue" },
  { key: "suspended", label: "Suspended" },
] as const;

/** One display status per tenant — drives the chip and the filter. */
function statusOf(t: TenantRow): { key: string; label: string; cls: string } {
  if (t.suspendedAt) return { key: "suspended", label: "suspended", cls: "bg-clay-soft text-clay-ink" };
  if (t.dueNow) return { key: "overdue", label: "overdue", cls: "bg-clay-soft text-clay-ink" };
  if (t.subStatus === "trialing")
    return { key: "trialing", label: `trial · ${t.trialDaysLeft}d`, cls: "bg-paper-3 text-ink-2" };
  if (t.subStatus === "comped") return { key: "active", label: "comped", cls: "bg-accent-soft text-accent-ink" };
  if (t.subStatus === "cancelled") return { key: "cancelled", label: "cancelled", cls: "bg-paper-3 text-ink-3" };
  return { key: "active", label: "active", cls: "bg-accent-soft text-accent-ink" };
}

function RadarCard({
  title,
  tone,
  tenants,
  detail,
}: {
  title: string;
  tone: string;
  tenants: TenantRow[];
  detail: (t: TenantRow) => string;
}) {
  return (
    <div className="rounded-lg border border-rule bg-card p-4 shadow-plate">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{title}</span>
        <span className={`rounded-pill px-2 py-0.5 text-[0.75rem] ${tone}`}>{tenants.length}</span>
      </div>
      {tenants.length === 0 ? (
        <p className="mt-3 text-[0.8125rem] text-ink-3">Nothing here — all clear.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {tenants.slice(0, 6).map((t) => (
            <li key={t.organizationId} className="flex items-baseline justify-between gap-2 text-[0.875rem]">
              <Link href={`/tenant/${t.organizationId}`} className="truncate hover:text-accent">
                {t.name}
              </Link>
              <span className="shrink-0 font-mono text-[0.75rem] text-ink-3">{detail(t)}</span>
            </li>
          ))}
          {tenants.length > 6 ? (
            <li className="text-[0.75rem] text-ink-3">+{tenants.length - 6} more</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const admin = await requirePlatformAdmin();
  const { q = "", status = "all" } = await searchParams;

  const [allTenants, totals, growth] = await Promise.all([
    listTenants(),
    platformTotals(),
    growthMetrics(12),
  ]);
  const runRate = await monthlyRunRate(allTenants);
  const radar = await billingRadar(allTenants);

  const query = q.trim().toLowerCase();
  const tenants = allTenants.filter((t) => {
    const matchesQuery =
      !query || t.name.toLowerCase().includes(query) || t.slug.toLowerCase().includes(query);
    const matchesStatus = status === "all" || statusOf(t).key === status;
    return matchesQuery && matchesStatus;
  });

  const filterHref = (key: string) => {
    const p = new URLSearchParams();
    if (query) p.set("q", q);
    if (key !== "all") p.set("status", key);
    const s = p.toString();
    return s ? `/?${s}` : "/";
  };

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
            <div key={stat.label} className="min-w-0 rounded-lg border border-rule bg-card p-5 shadow-plate">
              <dt className="text-[0.875rem] text-ink-3">{stat.label}</dt>
              <dd className="mt-2 font-display text-3xl leading-none tracking-[-0.03em]">{stat.value}</dd>
            </div>
          ))}
        </dl>

        {/* Needs attention */}
        <h2 className="mt-10 text-[0.9375rem] font-semibold text-ink-2">Needs attention</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <RadarCard
            title="Trials ending"
            tone="bg-paper-3 text-ink-2"
            tenants={radar.endingSoon}
            detail={(t) => `${t.trialDaysLeft}d left`}
          />
          <RadarCard
            title="Overdue — in grace"
            tone="bg-clay-soft text-clay-ink"
            tenants={radar.inGrace}
            detail={(t) => (t.band.price === null ? "quoted" : peso(t.band.price))}
          />
          <RadarCard
            title="Suspended (unpaid)"
            tone="bg-clay-soft text-clay-ink"
            tenants={radar.suspended}
            detail={(t) => (t.band.price === null ? "quoted" : peso(t.band.price))}
          />
        </div>

        {/* Growth */}
        <div className="mt-10 rounded-lg border border-rule bg-card p-5 shadow-plate">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[0.9375rem] font-semibold text-ink-2">Growth · last 12 months</h2>
            <span className="text-[0.8125rem] text-ink-3">
              new venues &amp; cancellations · total venues (line)
            </span>
          </div>
          <div className="mt-4">
            <GrowthChart data={growth} />
          </div>
        </div>

        {/* Search + filters */}
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <form method="GET" className="flex items-center gap-2">
            {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search name or slug…"
              className="h-10 w-56 rounded-pill border border-rule bg-card px-4 text-[0.875rem]"
            />
          </form>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={filterHref(f.key)}
                aria-current={status === f.key ? "page" : undefined}
                className={`rounded-pill px-3 py-1.5 text-[0.8125rem] transition-colors duration-[--dur-fast] ease-out ${
                  status === f.key
                    ? "bg-ink text-paper"
                    : "border border-rule-strong text-ink-2 hover:border-ink hover:text-ink"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <span className="ml-auto text-[0.8125rem] text-ink-3">
            {tenants.length} of {allTenants.length}
          </span>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-rule bg-card shadow-plate">
          <table className="w-full min-w-[52rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-rule">
                {["Venue", "Status", "Band", "Spaces", "Upcoming", "30d bookings", "30d value", ""].map(
                  (heading) => (
                    <th key={heading} scope="col" className="label px-4 py-3 font-sans text-ink-3">
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {tenants.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-ink-3">
                    No venues match.
                  </td>
                </tr>
              ) : null}

              {tenants.map((tenant) => {
                const st = statusOf(tenant);
                return (
                  <tr key={tenant.organizationId} className="border-b border-rule last:border-b-0">
                    <td className="px-4 py-3">
                      <Link href={`/tenant/${tenant.organizationId}`} className="font-medium hover:text-accent">
                        {tenant.name}
                      </Link>
                      <span className="block font-mono text-[0.75rem] text-ink-3">
                        /{tenant.slug} · {tenant.timezone}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-pill px-2 py-0.5 text-[0.75rem] ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[0.9375rem]">{tenant.band.name}</span>
                      <span className="block font-mono text-[0.75rem] text-ink-3">
                        {tenant.band.price === null ? "quoted" : peso(tenant.band.price)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[0.875rem]">{tenant.activeSpaces}</td>
                    <td className="px-4 py-3 font-mono text-[0.875rem]">{tenant.upcomingBookings}</td>
                    <td className="px-4 py-3 font-mono text-[0.875rem]">{tenant.bookingsLast30}</td>
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
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
