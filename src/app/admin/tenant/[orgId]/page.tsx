import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { peso } from "@/content/marketing";
import { requirePlatformAdmin } from "@/lib/admin/access";
import { recordAdminAction } from "@/lib/admin/audit";
import { getTenant } from "@/lib/admin/queries";
import { apexUrl } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { impersonate, reactivateVenue, suspendVenue } from "../../actions";

export const metadata: Metadata = { title: "Tenant" };
export const dynamic = "force-dynamic";

export default async function TenantPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const admin = await requirePlatformAdmin();
  const { orgId } = await params;

  const data = await getTenant(orgId);
  if (!data) notFound();

  const { tenant, spaces, members, recentBookings } = data;

  // Opening a tenant is itself a cross-tenant read, so it is on the record.
  await recordAdminAction({
    actorUserId: admin.userId,
    action: "admin.viewed_tenant",
    organizationId: orgId,
  });

  return (
    <main className="flex-1 py-10 sm:py-14">
      <div className="shell">
        <Link href="/" className="text-[0.875rem] text-ink-2 hover:text-accent">
          ← All tenants
        </Link>

        <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-head">{tenant.name}</h1>
            <p className="mt-2 font-mono text-[0.875rem] text-ink-3">
              {apexUrl(`/${tenant.slug}`).replace(/^https?:\/\//, "")} ·{" "}
              {tenant.timezone} · {tenant.currency}
            </p>
            {tenant.suspendedAt ? (
              <p className="mt-3 rounded-sm border border-clay/40 bg-clay-soft px-3 py-2 text-[0.875rem] text-clay-ink">
                Suspended{tenant.suspendedReason ? ` — ${tenant.suspendedReason}` : ""}.
                The public booking page is closed.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <form action={impersonate}>
              <input type="hidden" name="organizationId" value={tenant.organizationId} />
              <input
                type="text"
                name="reason"
                placeholder="Reason (logged)"
                className="mr-2 h-10 w-48 rounded-sm border border-rule bg-card px-3 text-[0.875rem]"
              />
              <button
                type="submit"
                className="h-10 whitespace-nowrap rounded-pill bg-ink px-4 text-[0.875rem] font-medium text-paper transition-opacity duration-[--dur-fast] ease-out hover:opacity-90"
              >
                View as venue
              </button>
            </form>

            {tenant.suspendedAt ? (
              <form action={reactivateVenue}>
                <input type="hidden" name="organizationId" value={tenant.organizationId} />
                <button
                  type="submit"
                  className="h-10 whitespace-nowrap rounded-pill border border-rule-strong px-4 text-[0.875rem] transition-colors duration-[--dur-fast] ease-out hover:border-ink"
                >
                  Reactivate
                </button>
              </form>
            ) : (
              <form action={suspendVenue}>
                <input type="hidden" name="organizationId" value={tenant.organizationId} />
                <input
                  type="text"
                  name="reason"
                  placeholder="Reason (logged)"
                  className="mr-2 h-10 w-48 rounded-sm border border-rule bg-card px-3 text-[0.875rem]"
                />
                <button
                  type="submit"
                  className="h-10 whitespace-nowrap rounded-pill border border-clay/50 px-4 text-[0.875rem] text-clay-ink transition-colors duration-[--dur-fast] ease-out hover:border-clay"
                >
                  Suspend
                </button>
              </form>
            )}
          </div>
        </header>

        <dl className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            {
              label: "Band",
              value: `${tenant.band.name}${tenant.band.price === null ? "" : ` · ${peso(tenant.band.price)}`}`,
            },
            { label: "Active spaces", value: String(tenant.activeSpaces) },
            { label: "Staff", value: String(tenant.memberCount) },
            {
              label: "30d value",
              value: formatMoney(tenant.revenueLast30Cents, tenant.currency),
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="min-w-0 rounded-lg border border-rule bg-card p-5 shadow-plate"
            >
              <dt className="text-[0.875rem] text-ink-3">{stat.label}</dt>
              <dd className="mt-2 truncate font-display text-2xl leading-none tracking-[-0.02em]">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section>
            <h2 className="text-xl">Spaces</h2>
            <ul className="mt-3 overflow-hidden rounded-lg border border-rule bg-card">
              {spaces.map((space) => (
                <li
                  key={space.id}
                  className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3 last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[0.9375rem]">{space.name}</span>
                    <span className="block text-[0.8125rem] text-ink-3">{space.kind}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[0.875rem] text-ink-2">
                    {formatMoney(space.price_cents, tenant.currency)}
                    {space.is_active ? "" : " · off"}
                  </span>
                </li>
              ))}
              {spaces.length === 0 ? (
                <li className="px-4 py-6 text-center text-ink-3">No spaces yet.</li>
              ) : null}
            </ul>

            <h2 className="mt-8 text-xl">Staff</h2>
            <ul className="mt-3 overflow-hidden rounded-lg border border-rule bg-card">
              {members.map((member) => (
                <li
                  key={member.email}
                  className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3 last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[0.9375rem]">{member.name}</span>
                    <span className="block truncate text-[0.8125rem] text-ink-3">
                      {member.email}
                    </span>
                  </span>
                  <span className="label shrink-0 text-ink-3">{member.role}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-xl">Recent bookings</h2>
            <ul className="mt-3 overflow-hidden rounded-lg border border-rule bg-card">
              {recentBookings.map((booking) => (
                <li
                  key={booking.reference}
                  className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3 last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[0.9375rem]">
                      {booking.customer_name ?? "Walk-in"}
                    </span>
                    <span className="block truncate text-[0.8125rem] text-ink-3">
                      {booking.label} · {booking.space_name}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-[0.8125rem]">
                      {formatMoney(booking.amount_cents, tenant.currency)}
                    </span>
                    <span className="block font-mono text-[0.75rem] text-ink-3">
                      {booking.status}
                    </span>
                  </span>
                </li>
              ))}
              {recentBookings.length === 0 ? (
                <li className="px-4 py-6 text-center text-ink-3">No bookings yet.</li>
              ) : null}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
