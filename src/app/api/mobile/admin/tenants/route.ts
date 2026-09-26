import { adminGate, tenantsJson } from "@/lib/mobile/admin-json";
import { ok } from "@/lib/mobile/respond";

export const dynamic = "force-dynamic";

/** GET /api/mobile/admin/tenants?q= — API-CONTRACT #36. */
export async function GET(request: Request) {
  const gate = await adminGate(request);
  if (gate.response) return gate.response;
  return ok(await tenantsJson(new URL(request.url).searchParams.get("q")));
}
