import { grantMembership } from "@/lib/memberships";
import { holdingsJson } from "@/lib/mobile/growth-json";
import { conflict, fail, invalid, notFound, ok } from "@/lib/mobile/respond";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; customerId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST — API-CONTRACT #43 `{planId}`. Records a pass or membership the
 * customer has bought at the desk — pay-at-venue, like everything else — and
 * seeds its credits and expiry. Answers with the customer's holdings.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug, customerId } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(customerId)) return notFound("We couldn't find that customer.");

  const body = (await request.json().catch(() => null)) as { planId?: unknown } | null;
  const planId = typeof body?.planId === "string" ? body.planId : "";
  if (!UUID.test(planId)) return invalid({ planId: "Pick a plan." });

  // The customer must be this venue's: a customer id from another venue is
  // not found here, not granted a plan it cannot see.
  const [customer] = await sql<{ id: string }[]>`
    SELECT id FROM customer WHERE id = ${customerId}::uuid AND organization_id = ${scope.organizationId}
  `;
  if (!customer) return notFound("We couldn't find that customer.");

  const granted = await grantMembership(scope.organizationId, customerId, planId);
  if (!granted.ok) return conflict("plan_unavailable", granted.error);
  return ok({ holdings: await holdingsJson(scope.organizationId, customerId) }, 201);
}
