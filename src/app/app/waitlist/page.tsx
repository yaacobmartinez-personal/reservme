import type { Metadata } from "next";
import { listWaitlist } from "@/lib/booking/waitlist";
import { requireVenue } from "@/lib/tenancy";

export const metadata: Metadata = { title: "Waitlist" };
export const dynamic = "force-dynamic";

export default async function WaitlistPage() {
  const venue = await requireVenue();
  const entries = await listWaitlist(venue.organizationId, venue.timezone);

  // Group by slot so an owner sees "3 waiting for Court 2, Sat 18:00".
  const groups = new Map<string, typeof entries>();
  for (const e of entries) {
    const key = `${e.spaceName}__${e.whenLabel}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }

  return (
    <main className="flex-1 py-8 sm:py-12">
      <div className="shell-wide">
        <h1 className="text-head">Waitlist</h1>
        <p className="mt-2 text-[0.9375rem] text-ink-2">
          People waiting on a taken slot. When one frees, the first in line is emailed
          automatically.
        </p>

        {entries.length === 0 ? (
          <p className="mt-8 rounded-lg border border-dashed border-rule-strong bg-paper-2 p-10 text-center text-[0.9375rem] text-ink-3">
            No one is waiting right now.
          </p>
        ) : (
          <div className="mt-6 space-y-4">
            {[...groups.values()].map((group) => (
              <section
                key={`${group[0].spaceName}-${group[0].whenLabel}`}
                className="overflow-hidden rounded-xl border border-rule bg-card shadow-plate"
              >
                <header className="flex items-baseline justify-between gap-3 border-b border-rule bg-paper-2 px-4 py-2.5">
                  <span className="font-medium">{group[0].spaceName}</span>
                  <span className="text-[0.875rem] text-ink-3">{group[0].whenLabel}</span>
                </header>
                <ul>
                  {group.map((e, i) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule px-4 py-3 last:border-b-0">
                      <span className="w-5 text-center font-mono text-[0.8125rem] text-ink-3">{i + 1}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{e.customerName}</span>
                        <span className="block truncate text-[0.8125rem] text-ink-3">{e.customerEmail}</span>
                      </span>
                      <span className="ml-auto text-[0.75rem] text-ink-3">joined {e.createdLabel}</span>
                      <span
                        className={`rounded-pill px-2 py-0.5 text-[0.75rem] ${
                          e.status === "notified" ? "bg-accent-soft text-accent-ink" : "bg-paper-3 text-ink-2"
                        }`}
                      >
                        {e.status === "notified" ? "notified" : "waiting"}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
