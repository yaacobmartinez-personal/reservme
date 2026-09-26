import { suspendVenue } from "@/lib/admin/operations";
import { adminGate, outcomeResponse } from "@/lib/mobile/admin-json";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/admin/tenants/{orgId}/suspend `{reason?}` — API-CONTRACT #37.
 * Takes the public page and new bookings down; existing bookings stay.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/mobile/admin/tenants/[orgId]/suspend">,
) {
  const gate = await adminGate(request);
  if (gate.response) return gate.response;
  const { orgId } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
  const reason =
    typeof body.reason === "string" ? body.reason.trim().slice(0, 300) || null : null;
  return outcomeResponse(await suspendVenue(gate.admin.actor, orgId, reason));
}
