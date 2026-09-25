import { listCustomers } from "@/lib/customers";
import { customerSummary, segmentOf } from "@/lib/mobile/customer-json";
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

  const { rows, total } = await listCustomers(scope.organizationId, scope.timezone, {
    search: q || undefined,
    // The chips on V10. An unknown value is no filter rather than an error:
    // a newer app asking for a segment this server does not have should show
    // everybody, not a red screen.
    segment: segmentOf(url.searchParams.get("segment")),
    sort: "name",
  });

  // `rows` is the page (25); `total` is how many match, which is what the
  // header counts — the two differ as soon as a venue has more than one page.
  return ok({ rows: rows.map(customerSummary), total });
}
