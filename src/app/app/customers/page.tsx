import type { Metadata } from "next";
import Link from "next/link";
import {
  type CustomerSegment,
  type CustomerSort,
  customerFacets,
  listCustomers,
} from "@/lib/customers";
import { formatMoney } from "@/lib/money";
import { requireVenue } from "@/lib/tenancy";
import { CustomerFilters } from "./customer-filters";

export const metadata: Metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

const SEGMENTS = new Set<CustomerSegment>(["all", "new", "at_risk", "no_shows"]);
const SORTS = new Set<CustomerSort>(["recent", "name", "bookings", "value", "last_visit"]);

/** "Ana Santos" → "AS"; single word → first two letters. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function lastVisitLabel(days: number | null): string {
  if (days === null) return "—";
  if (days <= 0) return "Today";
  if (days === 1) return "1d";
  return `${days}d`;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    segment?: string;
    tag?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const venue = await requireVenue();
  const sp = await searchParams;

  const segment = SEGMENTS.has(sp.segment as CustomerSegment)
    ? (sp.segment as CustomerSegment)
    : "all";
  const sort = SORTS.has(sp.sort as CustomerSort) ? (sp.sort as CustomerSort) : "recent";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const search = sp.q?.trim() || undefined;
  const tag = sp.tag?.trim() || undefined;

  const [{ rows, total, pageSize, pageCount }, tags] = await Promise.all([
    listCustomers(venue.organizationId, venue.timezone, {
      search,
      tag,
      segment,
      sort,
      page,
    }),
    customerFacets(venue.organizationId),
  ]);

  const filtered = Boolean(search || tag || segment !== "all");
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  // Preserve the active filters when paging.
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (tag) params.set("tag", tag);
    if (segment !== "all") params.set("segment", segment);
    if (sort !== "recent") params.set("sort", sort);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/customers?${qs}` : "/customers";
  };

  const cols =
    "sm:grid-cols-[minmax(0,1.8fr)_minmax(0,1.2fr)_4rem_7rem_5rem_4.5rem]";

  return (
    <main className="flex-1 py-8 sm:py-12">
      <div className="shell-wide">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <h1 className="text-head">Customers</h1>
          <span className="text-[0.875rem] text-ink-3">
            {total} {total === 1 ? "person" : "people"}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {/* Download routes, not pages — a plain anchor triggers the file download. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/export/customers"
              className="rounded-pill border border-rule px-3 py-1.5 text-[0.8125rem] text-ink-2 transition-colors duration-[--dur-fast] ease-out hover:border-rule-strong hover:text-ink"
            >
              Export customers
            </a>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/export/bookings"
              className="rounded-pill border border-rule px-3 py-1.5 text-[0.8125rem] text-ink-2 transition-colors duration-[--dur-fast] ease-out hover:border-rule-strong hover:text-ink"
            >
              Export bookings
            </a>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/export/transactions"
              className="rounded-pill border border-rule px-3 py-1.5 text-[0.8125rem] text-ink-2 transition-colors duration-[--dur-fast] ease-out hover:border-rule-strong hover:text-ink"
            >
              Export transactions
            </a>
          </div>
        </header>

        <div className="mt-6">
          <CustomerFilters tags={tags} />
        </div>

        {rows.length === 0 ? (
          <p className="mt-8 rounded-lg border border-dashed border-rule-strong bg-paper-2 p-10 text-center text-[0.9375rem] text-ink-3">
            {filtered
              ? "No customers match these filters."
              : "No customers yet. They'll appear here the moment someone books."}
          </p>
        ) : (
          <>
            <div className="mt-6 overflow-hidden rounded-xl border border-rule bg-card shadow-plate">
              {/* Column header — desktop only; mobile rows carry an inline meta line. */}
              <div
                className={`hidden items-center gap-3 border-b border-rule bg-paper-2 px-4 py-2.5 text-[0.75rem] text-ink-3 sm:grid ${cols}`}
              >
                <span>Customer</span>
                <span>Tags</span>
                <span className="text-right">Bookings</span>
                <span className="text-right">Value</span>
                <span className="text-right">Last visit</span>
                <span className="text-right">No-shows</span>
              </div>

              <ul>
                {rows.map((c) => (
                  <li key={c.id} className="border-b border-rule last:border-b-0">
                    <Link
                      href={`/customers/${c.id}`}
                      className={`grid items-center gap-3 px-4 py-3 transition-colors duration-[--dur-fast] ease-out hover:bg-paper-2 ${cols}`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-paper-3 text-[0.75rem] font-medium text-ink-2"
                        >
                          {initials(c.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{c.name}</span>
                          <span className="block truncate text-[0.8125rem] text-ink-3">
                            {c.email}
                          </span>
                          {/* Mobile-only compact stats */}
                          <span className="mt-0.5 block text-[0.75rem] text-ink-3 sm:hidden">
                            {c.bookings} booking{c.bookings === 1 ? "" : "s"} ·{" "}
                            {formatMoney(c.lifetimeValueCents, venue.currency)} ·{" "}
                            {lastVisitLabel(c.lastVisitDays)}
                            {c.noShowCount > 0 ? ` · ${c.noShowCount} no-show` : ""}
                          </span>
                        </span>
                      </div>

                      <span className="hidden min-w-0 items-center gap-1 sm:flex">
                        {c.tags.length === 0 ? (
                          <span className="text-[0.8125rem] text-ink-3">—</span>
                        ) : (
                          <>
                            {c.tags.slice(0, 2).map((t) => (
                              <span
                                key={t}
                                className="max-w-[6rem] truncate rounded-pill bg-accent-soft px-2 py-0.5 text-[0.75rem] text-accent-ink"
                              >
                                {t}
                              </span>
                            ))}
                            {c.tags.length > 2 ? (
                              <span className="text-[0.75rem] text-ink-3">
                                +{c.tags.length - 2}
                              </span>
                            ) : null}
                          </>
                        )}
                      </span>

                      <span className="hidden text-right text-[0.875rem] tabular-nums sm:block">
                        {c.bookings}
                      </span>
                      <span className="hidden text-right text-[0.875rem] tabular-nums sm:block">
                        {formatMoney(c.lifetimeValueCents, venue.currency)}
                      </span>
                      <span className="hidden text-right text-[0.875rem] text-ink-2 tabular-nums sm:block">
                        {lastVisitLabel(c.lastVisitDays)}
                      </span>
                      <span
                        className={`hidden text-right text-[0.875rem] tabular-nums sm:block ${
                          c.noShowCount > 0 ? "text-clay-ink" : "text-ink-3"
                        }`}
                      >
                        {c.noShowCount || "—"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Pagination */}
            <div className="mt-4 flex items-center justify-between text-[0.8125rem] text-ink-3">
              <span>
                {from}–{to} of {total}
              </span>
              {pageCount > 1 ? (
                <div className="flex items-center gap-2">
                  <PageLink href={pageHref(page - 1)} disabled={page <= 1}>
                    Prev
                  </PageLink>
                  <span className="tabular-nums">
                    Page {page} of {pageCount}
                  </span>
                  <PageLink href={pageHref(page + 1)} disabled={page >= pageCount}>
                    Next
                  </PageLink>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const cls =
    "rounded-pill border px-3 py-1.5 text-[0.8125rem] transition-colors duration-[--dur-fast] ease-out";
  if (disabled) {
    return (
      <span className={`${cls} border-rule text-ink-3 opacity-50`} aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={`${cls} border-rule-strong text-ink hover:border-ink`}>
      {children}
    </Link>
  );
}
