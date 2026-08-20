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
import { peso, PLANS } from "@/content/marketing";
import { formatMoney } from "@/lib/money";
import { KpiTile, Panel } from "@/components/dashboard/panels";
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
  tenants,
  detail,
}: {
  title: string;
  tenants: TenantRow[];
  detail: (t: TenantRow) => string;
}) {
  return (
    <Panel title={title} hint={String(tenants.length)}>
      {tenants.length === 0 ? (
        <p className="text-[0.8125rem] text-ink-3">Nothing here — all clear.</p>
      ) : (
        <ul className="space-y-1.5">
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
    </Panel>
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

  // KPI series/deltas from the 12-month growth.
  const cumSeries = growth.map((g) => g.cumulative);
  const signupSeries = growth.map((g) => g.signups);
  const last = growth.length - 1;
  const pctDelta = (curr: number, prev: number) =>
    prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null;
  const venuesDelta = last >= 1 ? pctDelta(cumSeries[last], cumSeries[last - 1]) : null;
  const newThisMonth = growth[last]?.signups ?? 0;
  const newDelta = last >= 1 ? pctDelta(newThisMonth, growth[last - 1].signups) : null;

  // Venues by band.
  const bandCounts = new Map<string, number>();
  for (const t of allTenants) bandCounts.set(t.band.name, (bandCounts.get(t.band.name) ?? 0) + 1);
  const maxBand = Math.max(1, ...bandCounts.values());
  const bandRows = PLANS.filter((p) => bandCounts.has(p.name)).map((p) => ({
    name: p.name,
    count: bandCounts.get(p.name) ?? 0,
    pct: ((bandCounts.get(p.name) ?? 0) / maxBand) * 100,
  }));

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
      <div className="shell space-y-4">
        <header>
          <p className="label text-ink-3">Platform overview</p>
          <h1 className="mt-2 text-head">Tenants</h1>
          <p className="mt-1 text-[0.875rem] text-ink-2">
            Signed in as {admin.name} ({admin.email})
          </p>
        </header>

        {/* KPI row */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiTile label="Venues" value={String(totals.tenants)} deltaPct={venuesDelta} series={cumSeries} />
          <KpiTile label="New this month" value={String(newThisMonth)} deltaPct={newDelta} series={signupSeries} />
          <KpiTile label="Run rate / mo" value={peso(runRate)} deltaPct={null} series={[]} />
          <KpiTile label="Bookings, 30d" value={String(totals.bookings_30)} deltaPct={null} series={[]} />
        </div>

        {/* Growth + bands */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title="Growth · last 12 months" hint="new & cancelled · total (line)" className="lg:col-span-2">
            <GrowthChart data={growth} />
          </Panel>
          <Panel title="Venues by band">
            {bandRows.length === 0 ? (
              <p className="text-[0.8125rem] text-ink-3">No venues yet.</p>
            ) : (
              <ul className="space-y-3">
                {bandRows.map((b) => (
                  <li key={b.name} className="flex items-center gap-3 text-[0.875rem]">
                    <span className="w-20 shrink-0 text-ink-2">{b.name}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-pill bg-paper-3">
                      <span className="block h-full rounded-pill bg-accent" style={{ width: `${b.pct}%` }} />
                    </span>
                    <span className="w-6 shrink-0 text-right font-mono text-[0.8125rem] text-ink-3">
                      {b.count}
                    </span>
                  </li>
                ))}
                <li className="border-t border-rule pt-2 text-[0.75rem] text-ink-3">
                  {totals.suspended} suspended · {totals.spaces} active spaces
                </li>
              </ul>
            )}
          </Panel>
        </div>

        {/* Needs attention */}
        <div className="grid gap-4 sm:grid-cols-3">
          <RadarCard title="Trials ending" tenants={radar.endingSoon} detail={(t) => `${t.trialDaysLeft}d left`} />
          <RadarCard
            title="Overdue — in grace"
            tenants={radar.inGrace}
            detail={(t) => (t.band.price === null ? "quoted" : peso(t.band.price))}
          />
          <RadarCard
            title="Suspended (unpaid)"
            tenants={radar.suspended}
            detail={(t) => (t.band.price === null ? "quoted" : peso(t.band.price))}
          />
        </div>

        {/* Tenants */}
        <Panel title="All venues" hint={`${tenants.length} of ${allTenants.length}`}>
          <div className="flex flex-wrap items-center gap-3">
            <form method="GET" className="flex items-center gap-2">
              {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search name or slug…"
                className="h-10 w-56 rounded-pill border border-rule bg-paper-2 px-4 text-[0.875rem]"
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
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-rule">
            <table className="w-full min-w-[52rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-rule bg-paper-2">
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
        </Panel>
      </div>
    </main>
  );
}
