import type { Metadata } from "next";
import { Dashboard } from "@/components/dashboard/dashboard";
import { getDashboard, rangeDays } from "@/lib/analytics";
import { sweepExpiredHolds } from "@/lib/booking/reserve";
import { listOwnerSpaces } from "@/lib/owner";
import { requireVenue } from "@/lib/tenancy";
import { getRunSheet } from "@/lib/venue";
import { FirstSpace } from "./spaces/space-forms";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const venue = await requireVenue();
  await sweepExpiredHolds();

  const spaces = await listOwnerSpaces(venue.organizationId);

  // A venue with no spaces has nothing to book. Guide the owner to the one
  // action that matters instead of showing an empty dashboard.
  if (spaces.length === 0) {
    return (
      <main className="flex-1 py-14 sm:py-20">
        <div className="shell max-w-xl">
          <p className="label text-ink-3">Welcome to {venue.name}</p>
          <h1 className="mt-3 text-head">Add your first space</h1>
          <p className="mt-3 text-[0.9375rem] text-ink-2">
            A space is anything people book on its own — a court, a room, a table,
            a boat. Add one and your booking page goes live at{" "}
            <span className="font-mono text-ink">reservme.pro/{venue.slug}</span>.
          </p>
          <div className="mt-8 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
            <FirstSpace />
          </div>
        </div>
      </main>
    );
  }

  const { key: activeRange, days } = rangeDays((await searchParams).range);
  const [data, runSheet] = await Promise.all([
    getDashboard(venue.organizationId, venue.timezone, days),
    getRunSheet(venue.organizationId, venue.timezone),
  ]);

  return (
    <main className="flex-1 py-8 sm:py-12">
      <div className="shell">
        <Dashboard
          venue={venue}
          data={data}
          runSheet={runSheet}
          activeRange={activeRange}
        />
      </div>
    </main>
  );
}
