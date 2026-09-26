import { removePricingRule } from "@/lib/mobile/space-rules";
import { fail, notFound, ok } from "@/lib/mobile/respond";
import { spaceDetail } from "@/lib/mobile/venue-json";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; spaceId: string; ruleId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GONE = "That rule is already gone.";

/**
 * DELETE — API-CONTRACT #29.
 *
 * Deleting a rule does not reprice anything already booked: a booking stores
 * the amount it was taken at, and a venue that lowers its peak rate has not
 * agreed to refund last week's games.
 */
export async function DELETE(request: Request, { params }: Params) {
  const { slug, spaceId, ruleId } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(spaceId) || !UUID.test(ruleId)) return notFound(GONE);

  const removed = await removePricingRule(scope.organizationId, ruleId);
  if (!removed) return notFound(GONE);

  return ok({ space: await spaceDetail(scope.organizationId, spaceId) });
}
