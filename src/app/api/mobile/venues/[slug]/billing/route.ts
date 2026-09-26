import { billingJson } from "@/lib/mobile/billing-json";
import { fail, ok } from "@/lib/mobile/respond";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /api/mobile/venues/{slug}/billing — API-CONTRACT #32.
 *
 * Owner or admin, matching `billing-actions.ts` — not staff. What the venue
 * owes is not desk information.
 */
export async function GET(request: Request, { params }: Params) {
  const scope = await venueScope(request, (await params).slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  return ok({ billing: await billingJson(scope.organizationId) });
}
