import { listCustomers } from "@/lib/customers";
import { fail, ok } from "@/lib/mobile/respond";
import { isFailure, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /api/mobile/venues/{slug}/customers?q= — API-CONTRACT #20.
 *
 * The booking sheet's typeahead, and the first half of the Customers screen.
 * Reuses `listCustomers`, so search and sorting behave the same here as on the
 * web rather than being reimplemented slightly differently.
 */
export async function GET(request: Request, { params }: Params) {
  const scope = await venueScope(request, (await params).slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);

  const { rows } = await listCustomers(scope.organizationId, scope.timezone, {
    search: q || undefined,
    sort: "name",
  });

  // The app's CustomerSummary mirrors CustomerListRow field for field, so this
  // is a rename of createdAt to an instant and nothing else. `lastVisitDays` is
  // a count of days, not a date — the screen says "3 weeks ago", and computing
  // that from a date on the phone would drift against the venue's own today.
  return ok({
    customers: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      tags: r.tags,
      bookings: r.bookings,
      lifetimeValueCents: r.lifetimeValueCents,
      noShowCount: r.noShowCount,
      lastVisitDays: r.lastVisitDays,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
