import { addPricingRule, pricingProblem, pricingRule } from "@/lib/mobile/space-rules";
import { fail, invalid, notFound, ok } from "@/lib/mobile/respond";
import { spaceDetail } from "@/lib/mobile/venue-json";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; spaceId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST — API-CONTRACT #29. A peak-price window on one space.
 *
 * Owner or admin, like every structural write: a rule changes what every
 * future booking costs, which is not a desk decision.
 *
 * The answer is the whole space, not the rule, so the editor redraws from one
 * round trip rather than patching its own copy and hoping it matches.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug, spaceId } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(spaceId)) return notFound("We couldn't find that space.");

  const body = (await request.json().catch(() => null)) ?? {};
  const problem = pricingProblem(body);
  if (problem) {
    return invalid(
      { [problem === "Pick at least one day." ? "weekdays" : "endsAt"]: problem },
      problem,
    );
  }

  const written = await addPricingRule(scope.organizationId, spaceId, pricingRule(body));
  if (!written) return notFound("We couldn't find that space.");

  return ok({ space: await spaceDetail(scope.organizationId, spaceId) }, 201);
}
