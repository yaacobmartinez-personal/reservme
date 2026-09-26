import { adminGate, paymentsQueueJson } from "@/lib/mobile/admin-json";
import { ok } from "@/lib/mobile/respond";

export const dynamic = "force-dynamic";

/** GET /api/mobile/admin/payments — API-CONTRACT #39. Submitted, oldest first. */
export async function GET(request: Request) {
  const gate = await adminGate(request);
  if (gate.response) return gate.response;
  return ok(await paymentsQueueJson());
}
