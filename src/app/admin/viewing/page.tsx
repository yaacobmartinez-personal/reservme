import type { Metadata } from "next";
import Link from "next/link";
import { VenueDashboard } from "@/components/dashboard/venue-dashboard";
import { requirePlatformAdmin } from "@/lib/admin/access";
import { sweepExpiredHolds } from "@/lib/booking/reserve";
import { currentVenue } from "@/lib/tenancy";

export const metadata: Metadata = { title: "Viewing as venue" };
export const dynamic = "force-dynamic";

/**
 * The impersonated view. Same component the real owner sees, rendered inside
 * the admin console under the banner in the layout — so it is never possible
 * to be looking at someone else's venue without knowing it.
 */
export default async function ViewingPage() {
  await requirePlatformAdmin();
  const venue = await currentVenue();

  if (!venue?.impersonatedBy) {
    return (
      <main className="flex-1 py-16">
        <div className="shell max-w-xl">
          <h1 className="text-head">Not viewing anyone</h1>
          <p className="mt-3 text-[0.9375rem] text-ink-2">
            That impersonation session has ended or expired. They last 30 minutes.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-pill bg-ink px-5 py-2.5 text-[0.9375rem] text-paper"
          >
            Back to tenants
          </Link>
        </div>
      </main>
    );
  }

  await sweepExpiredHolds();

  return (
    <main className="flex-1 py-10 sm:py-14">
      <div className="shell">
        <VenueDashboard venue={venue} />
      </div>
    </main>
  );
}
