import { adminGate, overviewJson } from "@/lib/mobile/admin-json";
import { ok } from "@/lib/mobile/respond";

export const dynamic = "force-dynamic";

/** GET /api/mobile/admin/overview — API-CONTRACT #35. */
export async function GET(request: Request) {
  const gate = await adminGate(request);
  if (gate.response) return gate.response;
  return ok(await overviewJson());
}
