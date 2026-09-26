import { rejectPayment } from "@/lib/admin/operations";
import { adminGate, outcomeResponse } from "@/lib/mobile/admin-json";
import { notFound } from "@/lib/mobile/respond";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/mobile/admin/payments/{id}/reject `{note?}` — API-CONTRACT #39. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/mobile/admin/payments/[paymentId]/reject">,
) {
  const gate = await adminGate(request);
  if (gate.response) return gate.response;
  const { paymentId } = await ctx.params;
  if (!UUID.test(paymentId)) return notFound("No such payment.");
  const body = (await request.json().catch(() => ({}))) as { note?: unknown };
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) || null : null;
  return outcomeResponse(await rejectPayment(gate.admin.actor, paymentId, note));
}
