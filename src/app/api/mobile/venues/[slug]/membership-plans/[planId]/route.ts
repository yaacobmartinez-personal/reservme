import { setPlanActive } from "@/lib/memberships";
import { plansJson } from "@/lib/mobile/growth-json";
import { fail, invalid, notFound, ok } from "@/lib/mobile/respond";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; planId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH — API-CONTRACT #42 `{active}`. Pausing a plan stops new grants;
 * everyone who holds it keeps what they have.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { slug, planId } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(planId)) return notFound("We couldn't find that plan.");

  const body = (await request.json().catch(() => null)) as { active?: unknown } | null;
  if (typeof body?.active !== "boolean") return invalid({ active: "Say whether it's on or off." });

  const found = await setPlanActive(scope.organizationId, planId, body.active);
  if (!found) return notFound("We couldn't find that plan.");
  const plan = (await plansJson(scope.organizationId)).plans.find((p) => p.id === planId);
  return ok({ plan });
}
