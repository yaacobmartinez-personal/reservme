import { reactivateVenue } from "@/lib/admin/operations";
import { adminGate, outcomeResponse } from "@/lib/mobile/admin-json";

export const dynamic = "force-dynamic";

/** POST /api/mobile/admin/tenants/{orgId}/reactivate — API-CONTRACT #37. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/mobile/admin/tenants/[orgId]/reactivate">,
) {
  const gate = await adminGate(request);
  if (gate.response) return gate.response;
  const { orgId } = await ctx.params;
  return outcomeResponse(await reactivateVenue(gate.admin.actor, orgId));
}
