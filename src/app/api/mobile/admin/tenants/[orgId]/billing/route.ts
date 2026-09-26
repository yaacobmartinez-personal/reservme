import { z } from "zod";
import { cancelSubscription, compSubscription, markPaidUntil } from "@/lib/admin/operations";
import { adminGate, outcomeResponse } from "@/lib/mobile/admin-json";
import { invalid } from "@/lib/mobile/respond";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("mark_paid"),
    paidUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  }),
  z.object({ action: z.literal("comp") }),
  z.object({ action: z.literal("cancel") }),
]);

/**
 * POST /api/mobile/admin/tenants/{orgId}/billing — API-CONTRACT #38.
 * `{action: "mark_paid", paidUntil: "YYYY-MM-DD"}` (inclusive) | `{action: "comp"}`
 * | `{action: "cancel"}`. Marking paid and comping lift a *billing* suspension;
 * a manual one stays.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/mobile/admin/tenants/[orgId]/billing">,
) {
  const gate = await adminGate(request);
  if (gate.response) return gate.response;
  const { orgId } = await ctx.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return invalid({ [String(issue?.path[0] ?? "action")]: issue?.message ?? "Invalid." });
  }
  const input = parsed.data;
  const actor = gate.admin.actor;
  const outcome =
    input.action === "mark_paid"
      ? await markPaidUntil(actor, orgId, input.paidUntil)
      : input.action === "comp"
        ? await compSubscription(actor, orgId)
        : await cancelSubscription(actor, orgId);
  return outcomeResponse(outcome);
}
