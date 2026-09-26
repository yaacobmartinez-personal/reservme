import { createPlan } from "@/lib/memberships";
import { plansJson } from "@/lib/mobile/growth-json";
import { fail, invalid, ok } from "@/lib/mobile/respond";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/** GET — API-CONTRACT #42. Every plan, active first. Any member may read. */
export async function GET(request: Request, { params }: Params) {
  const { slug } = await params;
  const scope = await venueScope(request, slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  return ok(await plansJson(scope.organizationId));
}

/**
 * POST — API-CONTRACT #42 `{name, kind: "pass"|"membership", price (pesos),
 * credits?, discountPct?, validDays?}`. A plan needs credits or a discount.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const result = await createPlan(scope.organizationId, await request.json().catch(() => ({})));
  if (!result.ok) return invalid({ [result.field]: result.message }, result.message);
  const plan = (await plansJson(scope.organizationId)).plans.find((p) => p.id === result.id);
  return ok({ plan }, 201);
}
