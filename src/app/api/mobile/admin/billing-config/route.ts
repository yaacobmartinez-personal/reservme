import { z } from "zod";
import { updateBillingConfig } from "@/lib/admin/operations";
import { adminGate, billingConfigJson, outcomeResponse } from "@/lib/mobile/admin-json";
import { invalid, ok } from "@/lib/mobile/respond";

export const dynamic = "force-dynamic";

/** GET /api/mobile/admin/billing-config — API-CONTRACT #40. */
export async function GET(request: Request) {
  const gate = await adminGate(request);
  if (gate.response) return gate.response;
  return ok(await billingConfigJson());
}

const schema = z.object({
  // An https URL, or a data URL of a freshly picked QR image (stored to R2).
  qrUrl: z.string().trim().max(1_200_000).default(""),
  payee: z.string().trim().max(120).default(""),
  account: z.string().trim().max(120).default(""),
});

/**
 * PUT /api/mobile/admin/billing-config `{qrUrl, payee, account}` — API-CONTRACT #40.
 * An empty field clears that setting.
 */
export async function PUT(request: Request) {
  const gate = await adminGate(request);
  if (gate.response) return gate.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return invalid({ [String(issue?.path[0] ?? "qrUrl")]: issue?.message ?? "Invalid." });
  }
  const result = await updateBillingConfig(gate.admin.actor, parsed.data);
  if (!result.ok) return outcomeResponse(result);
  return ok(await billingConfigJson());
}
