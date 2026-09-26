import { approvePayment } from "@/lib/admin/operations";
import { adminGate, outcomeResponse } from "@/lib/mobile/admin-json";
import { notFound } from "@/lib/mobile/respond";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/mobile/admin/payments/{id}/approve — API-CONTRACT #39.
 * Extends a month from the later of now and the paid-through date. Approving
 * twice is a 409, not a second month.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/mobile/admin/payments/[paymentId]/approve">,
) {
  const gate = await adminGate(request);
  if (gate.response) return gate.response;
  const { paymentId } = await ctx.params;
  if (!UUID.test(paymentId)) return notFound("No such payment.");
  return outcomeResponse(await approvePayment(gate.admin.actor, paymentId));
}
