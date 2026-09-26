import { adminGate, tenantDetailJson } from "@/lib/mobile/admin-json";
import { notFound, ok } from "@/lib/mobile/respond";

export const dynamic = "force-dynamic";

/** GET /api/mobile/admin/tenants/{orgId} — API-CONTRACT #36. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/mobile/admin/tenants/[orgId]">,
) {
  const gate = await adminGate(request);
  if (gate.response) return gate.response;
  const { orgId } = await ctx.params;
  const detail = await tenantDetailJson(orgId);
  return detail ? ok(detail) : notFound("No such venue.");
}
