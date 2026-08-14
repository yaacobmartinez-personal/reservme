import type { Metadata } from "next";
import { VenueDashboard } from "@/components/dashboard/venue-dashboard";
import { sweepExpiredHolds } from "@/lib/booking/reserve";
import { listOwnerSpaces } from "@/lib/owner";
import { requireVenue } from "@/lib/tenancy";
import { FirstSpace } from "./spaces/space-forms";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const venue = await requireVenue();
  await sweepExpiredHolds();

  const spaces = await listOwnerSpaces(venue.organizationId);

  // A venue with no spaces has nothing to book. Guide the owner to the one
  // action that matters instead of showing an empty run sheet.
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

  return (
    <main className="flex-1 py-10 sm:py-14">
      <div className="shell">
        <VenueDashboard venue={venue} />
      </div>
    </main>
  );
}
