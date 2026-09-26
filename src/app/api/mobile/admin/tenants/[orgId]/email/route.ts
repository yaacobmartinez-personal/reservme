import { emailTenant } from "@/lib/admin/operations";
import { adminGate, outcomeResponse } from "@/lib/mobile/admin-json";

export const dynamic = "force-dynamic";

/** POST /api/mobile/admin/tenants/{orgId}/email `{subject, body}` — API-CONTRACT #37. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/mobile/admin/tenants/[orgId]/email">,
) {
  const gate = await adminGate(request);
  if (gate.response) return gate.response;
  const { orgId } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { subject?: unknown; body?: unknown };
  const subject = typeof body.subject === "string" ? body.subject.slice(0, 200) : "";
  const text = typeof body.body === "string" ? body.body.slice(0, 5000) : "";
  return outcomeResponse(await emailTenant(gate.admin.actor, orgId, subject, text));
}
