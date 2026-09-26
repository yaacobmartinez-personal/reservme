import { fail, ok } from "@/lib/mobile/respond";
import { isFailure, venueScope } from "@/lib/mobile/venue-scope";
import { waitlistEntries } from "@/lib/mobile/waitlist-json";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /api/mobile/venues/{slug}/waitlist — API-CONTRACT #23.
 *
 * Soonest slot first, and within a slot the order `promoteWaitlist` will offer
 * it in. Only entries still waiting or notified, and only for slots still
 * ahead — a queue for a slot that has already passed is history, not work.
 */
export async function GET(request: Request, { params }: Params) {
  const scope = await venueScope(request, (await params).slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  return ok({ entries: await waitlistEntries(scope.organizationId, scope.timezone) });
}
