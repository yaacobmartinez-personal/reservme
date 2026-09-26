import { revokeAdmin } from "@/lib/admin/operations";
import { adminGate, outcomeResponse } from "@/lib/mobile/admin-json";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/admin/admins/{userId}/revoke — API-CONTRACT #41.
 * The last admin cannot be revoked (409 `last_admin`). Granting stays a
 * script (scripts/grant-admin.ts): making someone a platform admin should
 * need database access, not a phone.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/mobile/admin/admins/[userId]/revoke">,
) {
  const gate = await adminGate(request);
  if (gate.response) return gate.response;
  const { userId } = await ctx.params;
  return outcomeResponse(await revokeAdmin(gate.admin.actor, userId));
}
